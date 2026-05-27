"""
Flask Backend with MongoDB Authentication
Simple username/password system for Task Scheduler
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_bcrypt import Bcrypt
from bson import ObjectId
from datetime import datetime, timedelta
import jwt
import os
import json
import re
import traceback
import pandas as pd

from add_task import retrieve_current_schedule, retrieve_scenario
from mongo_client import create_mongo_client
from tds.executer import reload_tds, add_task, export_schedule, apply_assignment
from pymongo.errors import ServerSelectionTimeoutError, AutoReconnect

app = Flask(__name__)
CORS(app)  # Enable CORS for React frontend

# Custom JSON encoder to handle datetime objects as ISO strings
class CustomJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        return super().default(obj)

app.json_encoder = CustomJSONEncoder

# Configuration
app.config['SECRET_KEY'] = 'your-secret-key-change-this-in-production'
# MongoDB Atlas connection
app.config['MONGO_URI'] = os.getenv(
    'MONGO_URI',
    'mongodb+srv://erubinst:dbUserPassword@scheduleviewer.3la41u6.mongodb.net/task_scheduler?retryWrites=true&w=majority&appName=ScheduleViewer'
)

# Initialize
bcrypt = Bcrypt(app)
client = create_mongo_client(app.config['MONGO_URI'])
db = client.task_scheduler

# Collections
users = db.users
schedules = db.schedules
scenarios = db.scenarios
resource_schedules = db.resource_schedules
inbox_messages = db.inbox_messages

# Maps username -> TDS object for the duration of their session
user_tds_store = {}
user_epoch_store = {}


def _serialize_value(value):
    if value is None:
        return None
    if isinstance(value, (datetime, pd.Timestamp)):
        return value.isoformat()
    if isinstance(value, list):
        return [_serialize_value(v) for v in value]
    if isinstance(value, dict):
        return {k: _serialize_value(v) for k, v in value.items()}
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def dataframe_to_records(df):
    if df is None or not hasattr(df, 'to_dict'):
        return []
    records = df.to_dict(orient='records')
    return [{k: _serialize_value(v) for k, v in row.items()} for row in records]


def normalize_add_task_result(result):
    """Normalize add_task result into a list of dict rows for frontend table rendering."""
    if result is None:
        return []
    if hasattr(result, 'to_dict'):
        return dataframe_to_records(result)

    serialized = _serialize_value(result)
    if isinstance(serialized, dict):
        return [serialized]
    if isinstance(serialized, list):
        if all(isinstance(item, dict) for item in serialized):
            return serialized
        return [{'value': item} for item in serialized]
    return [{'value': serialized}]


def enrich_assignments_with_task_info(output_rows, scenario_name):
    """
    For each assignment row, look up the prior task in resource_schedules and
    attach prior_task_start_lb and prior_task_location.

    - capability_assignment: the prior task is the second element of each repr
      string, i.e. the task this new task will be scheduled after.
    - transport_assignment: the prior task is from before_pickup_prior_task,
      i.e. the task the driver is finishing before doing the pickup.

    Results are stored as:
      - row['capability_assignment_enriched']: list of dicts with raw + prior_task_*
      - t['prior_task_name'], t['prior_task_start_lb'], t['prior_task_location']
        added in-place to each transport assignment dict
    """
    if not output_rows or not scenario_name:
        return output_rows

    # Build a flat task_name -> {start_lb, location} lookup from all resource docs
    # for this scenario in a single query.
    docs = list(resource_schedules.find(
        {'scenario_name': scenario_name},
        {'tasks': 1, '_id': 0}
    ))
    task_lookup = {}
    for doc in docs:
        for t in (doc.get('tasks') or []):
            name = t.get('task_name')
            if name:
                task_lookup[name] = {
                    'end_lb': t.get('end_lb'),
                    'location': t.get('location'),
                }

    for row in output_rows:

        # ── Capability assignments ────────────────────────────────────
        enriched_caps = []
        for raw in (row.get('capability_assignment') or []):
            match = re.search(r'<Task (\S+) ', raw)
            task_id = match.group(1) if match else None
            info = task_lookup.get(task_id, {})
            enriched_caps.append({
                'raw':                 raw,
                'prior_task_name':     task_id,
                'prior_task_end_lb': _serialize_value(info.get('end_lb')),
                'prior_task_location': info.get('location'),
            })
        if enriched_caps:
            row['capability_assignment_enriched'] = enriched_caps

        # ── Transport assignments ─────────────────────────────────────
        for t in (row.get('transport_assignment') or []):
            pickup_raw = str(t.get('before_pickup_prior_task') or '')
            match = re.search(r'<Task (\S+) ', pickup_raw)
            task_id = match.group(1) if match else None
            info = task_lookup.get(task_id, {})
            t['prior_task_name']     = task_id
            t['prior_task_end_lb'] = _serialize_value(info.get('end_lb'))
            t['prior_task_location'] = info.get('location')

    return output_rows


def parse_positive_int(value, field_name):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field_name} must be an integer")
    if parsed <= 0:
        raise ValueError(f"{field_name} must be > 0")
    return parsed


def datetime_to_epoch_minutes(datetime_str, epoch_str):
    if not datetime_str or not epoch_str:
        raise ValueError("Missing datetime or epoch_date")
    dt = datetime.fromisoformat(datetime_str)
    epoch = datetime.fromisoformat(epoch_str)
    return int((dt - epoch).total_seconds() // 60)


def redact_mongo_uri(uri):
    """Mask credentials in MongoDB URIs before logging."""
    if not uri or '@' not in uri:
        return uri
    return re.sub(r'(mongodb\+srv://)([^@]+)(@)', r'\1***:***\3', uri)


def initialize_user_tds(username):
    """Fetch scenario + schedule from MongoDB, call reload_tds, and store the result."""
    try:
        rschedule = resource_schedules.find_one(
            {'resource_name': {'$regex': f'^{username}$', '$options': 'i'}},
            sort=[('created_at', -1)]
        )
        scenario_name = rschedule.get('scenario_name') if rschedule else None
        if not scenario_name:
            print(f"[TDS] No scenario found for '{username}'")
            return

        print(f"[TDS] Fetching schedule and scenario '{scenario_name}' for '{username}'...")
        current_schedule = retrieve_current_schedule(scenario_name)
        print(f"[TDS] Schedule loaded: {len(current_schedule)} tasks")
        scenario_data = retrieve_scenario(scenario_name)
        print(f"[TDS] Scenario loaded. Calling reload_tds...")
        user_tds_store[username] = reload_tds(scenario_data, current_schedule)
        user_epoch_store[username] = scenario_data[2]
        print(f"[TDS] ✓ TDS ready for '{username}' (scenario: {scenario_name})")
    except Exception as e:
        print(f"[TDS] Error loading TDS for '{username}': {type(e).__name__}: {e}")


# Helper function to create JWT token
def create_token(user_id, username):
    payload = {
        'user_id': str(user_id),
        'username': username,
        'exp': datetime.utcnow() + timedelta(days=7)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')


# Helper function to verify JWT token
def verify_token(token):
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


# ======================= AUTH ROUTES =======================

@app.route('/api/register', methods=['POST'])
def register():
    """
    Create a new user account
    Expects: { "username": "john", "password": "password123" }
    """
    try:
        data = request.json
        username = data.get('username', '').strip()
        password = data.get('password', '')

        if not username or not password:
            return jsonify({'error': 'Username and password are required'}), 400
        if len(username) < 3:
            return jsonify({'error': 'Username must be at least 3 characters'}), 400
        if len(password) < 6:
            return jsonify({'error': 'Password must be at least 6 characters'}), 400
        if users.find_one({'username': username}):
            return jsonify({'error': 'Username already exists'}), 400

        hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
        user_data = {
            'username': username,
            'password': hashed_password,
            'created_at': datetime.utcnow()
        }
        result = users.insert_one(user_data)
        token = create_token(result.inserted_id, username)

        return jsonify({
            'message': 'Account created successfully',
            'token': token,
            'username': username
        }), 201

    except Exception as e:
        print(f"Registration error: {str(e)}")
        return jsonify({'error': 'Registration failed'}), 500


@app.route('/api/login', methods=['POST'])
def login():
    """
    Log in a user
    Expects: { "username": "john", "password": "password123" }
    """
    try:
        data = request.json
        username = data.get('username', '').strip()
        password = data.get('password', '')

        print(f"[LOGIN] Attempting login for user: {username}")

        try:
            user = users.find_one({'username': username})
        except (ServerSelectionTimeoutError, AutoReconnect) as e:
            print(f"[LOGIN] MongoDB connectivity error: {type(e).__name__}: {e}")
            return jsonify({
                'error': 'Database is temporarily unreachable. Check Atlas network access/VPN and TLS connectivity.'
            }), 503

        if not user:
            print(f"[LOGIN] User not found: {username}")
            return jsonify({'error': 'Invalid username or password'}), 401

        if not bcrypt.check_password_hash(user['password'], password):
            print(f"[LOGIN] Invalid password for user: {username}")
            return jsonify({'error': 'Invalid username or password'}), 401

        print(f"[LOGIN] Password valid for user: {username}")
        token = create_token(user['_id'], username)
        print(f"[LOGIN] Token created for user: {username}")

        print(f"[LOGIN] Starting TDS initialization for user: {username}")
        initialize_user_tds(username)
        print(f"[LOGIN] TDS initialization completed for user: {username}")

        print(f"[LOGIN] Login successful for user: {username}")
        return jsonify({
            'message': 'Login successful',
            'token': token,
            'username': username
        }), 200

    except Exception as e:
        print(f"[LOGIN] ERROR: {type(e).__name__}: {e}")
        traceback.print_exc()
        return jsonify({'error': 'Login failed'}), 500


@app.route('/api/verify-token', methods=['POST'])
def verify_user_token():
    """
    Verify if a token is still valid
    Expects: { "token": "jwt-token-here" }
    """
    try:
        data = request.json
        token = data.get('token')
        if not token:
            return jsonify({'valid': False}), 200
        payload = verify_token(token)
        if payload:
            return jsonify({'valid': True, 'username': payload['username']}), 200
        else:
            return jsonify({'valid': False}), 200
    except Exception as e:
        print(f"Token verification error: {str(e)}")
        return jsonify({'valid': False}), 200


# ======================= SCHEDULE ROUTES =======================

def get_user_scenario_name(username):
    """Resolve the latest scenario name associated with a user/resource."""
    rschedule = resource_schedules.find_one(
        {'resource_name': {'$regex': f'^{username}$', '$options': 'i'}},
        sort=[('created_at', -1)]
    )
    return rschedule.get('scenario_name') if rschedule else None


def task_exists_in_scenario(scenario_name, task_name):
    """Check whether a task with this name already exists in the scenario."""
    if not scenario_name or not task_name:
        return False
    existing = resource_schedules.find_one(
        {
            'scenario_name': scenario_name,
            'tasks.task_name': {
                '$regex': f'^{re.escape(task_name)}$',
                '$options': 'i'
            }
        },
        {'_id': 1}
    )
    return existing is not None


def _extract_resource_and_capability(raw):
    resource = re.search(r'<Resource (\w+)', str(raw or ''))
    capability = re.search(r"'([^']+)'\)$", str(raw or ''))
    return (
        resource.group(1) if resource else None,
        capability.group(1) if capability else None,
    )


def _extract_driver(raw):
    match = re.search(r'<Resource (\w+)', str(raw or ''))
    return match.group(1) if match else None


def _build_assignment_inbox_docs(assignments, task_data, scenario_name, created_by):
    """Create one inbox document per involved person with combined assignment+transport text."""
    task_name = (task_data or {}).get('taskName') or 'Unnamed Task'
    task_type = (task_data or {}).get('taskType') or 'task'
    task_location = (task_data or {}).get('location') or 'unknown location'
    earliest_start = (task_data or {}).get('earliestStartTime')

    recipient_context = {}
    for row in (assignments or []):
        for cap in (row.get('capability_assignment_enriched') or []):
            resource, capability = _extract_resource_and_capability(cap.get('raw'))
            if not resource:
                continue
            ctx = recipient_context.setdefault(resource, {'caps': [], 'transports': []})
            cap_text = capability or 'required capability'
            prior_loc = cap.get('prior_task_location')
            if prior_loc and task_location:
                ctx['caps'].append(f"You are assigned to {cap_text} for '{task_name}', traveling from {prior_loc} to {task_location}.")
            else:
                ctx['caps'].append(f"You are assigned to {cap_text} for '{task_name}'.")

        for t in (row.get('transport_assignment') or []):
            driver = _extract_driver(t.get('before_resource'))
            passenger = t.get('driven_resource')
            pickup_loc = t.get('prior_task_location') or 'pickup location'

            if driver:
                dctx = recipient_context.setdefault(driver, {'caps': [], 'transports': []})
                if passenger:
                    dctx['transports'].append(
                        f"Transport needed: pick up {passenger} at {pickup_loc} and bring them to {task_location}."
                    )
                else:
                    dctx['transports'].append(
                        f"Transport needed for '{task_name}' from {pickup_loc} to {task_location}."
                    )

            if passenger:
                pctx = recipient_context.setdefault(passenger, {'caps': [], 'transports': []})
                if driver:
                    pctx['transports'].append(
                        f"Transport update: {driver} will pick you up at {pickup_loc} and bring you to {task_location}."
                    )

    docs = []
    created_at = datetime.utcnow()
    for recipient, ctx in recipient_context.items():
        lines = []
        lines.extend(ctx.get('caps') or [])
        lines.extend(ctx.get('transports') or [])
        if not lines:
            continue
        body = ' '.join(lines)
        schedule_text = f" Task type: {task_type}." if task_type else ''
        start_text = f" Earliest start: {earliest_start}." if earliest_start else ''
        docs.append({
            'recipient': recipient,
            'sender': 'Task Scheduler',
            'subject': f"Assignment for {task_name}",
            'message': f"{body}{schedule_text}{start_text}",
            'task_name': task_name,
            'task_type': task_type,
            'task_location': task_location,
            'scenario_name': scenario_name,
            'created_by': created_by,
            'created_at': created_at,
            'read': False,
        })
    return docs


def _serialize_inbox_doc(doc):
    return {
        'id': str(doc.get('_id')),
        'recipient': doc.get('recipient'),
        'sender': doc.get('sender'),
        'subject': doc.get('subject'),
        'message': doc.get('message'),
        'created_at': _serialize_value(doc.get('created_at')),
        'read': bool(doc.get('read', False)),
    }


def _save_accepted_task_to_schedule(username, scenario_name, task_data, epoch_date, assignments, selected_capabilities=None):
    """
    Completely rewrite the resource schedules for a scenario by regenerating from the modified TDS.
    
    This follows the same pattern as run_initial_schedule.py:
    - Gets the modified TDS from user_tds_store
    - Retrieves scenario data (request_data, travel_matrix)
    - Calls run_scheduler to generate the complete modified schedule
    - Clears existing resource_schedules for this scenario
    - Saves all tasks grouped by resource
    
    Args:
        username: Username whose TDS has been modified
        scenario_name: Name of the scenario
        task_data: Original task input data (for logging)
        epoch_date: ISO datetime string for epoch reference
    
    Returns:
        Dict with status and count of resources updated
    """
    try:
        if not username or not scenario_name:
            print("[SAVE_TASK] Missing username or scenario_name")
            return {'success': False, 'message': 'Missing required data', 'updated_count': 0}
        
        task_name = (task_data or {}).get('taskName') or 'Unnamed Task'
        
        # Get the TDS from user store (it's been modified by add_task)
        tds = user_tds_store.get(username)
        if tds is None:
            print(f"[SAVE_TASK] No TDS found for user '{username}'")
            return {'success': False, 'message': 'TDS not initialized', 'updated_count': 0}
        
        # Extract schedule DataFrame directly from the modified TDS
        print(f"[SAVE_TASK] Extracting schedule from modified TDS via export_schedule...")
        try:
            df = export_schedule(tds, epoch_date)
            # print the df rows with the task_name matching the new task
            print(f"[SAVE_TASK] Schedule entries for task '{task_name}':")
            for _, row in df[df['task_name'] == task_name].iterrows():
                print(f"  - {row.to_dict()}")
            print(f"[SAVE_TASK] ✓ Schedule extracted from TDS: {len(df)} entries")
        except Exception as e:
            print(f"[SAVE_TASK] Failed to extract schedule from TDS exporter: {type(e).__name__}: {e}")
            traceback.print_exc()
            return {'success': False, 'message': f'TDS export failed: {str(e)}', 'updated_count': 0}
        
        # Clear existing schedules for this scenario (overwrite)
        print(f"[SAVE_TASK] Clearing old schedules for scenario '{scenario_name}'...")
        cleared = resource_schedules.delete_many({'scenario_name': scenario_name})
        print(f"[SAVE_TASK] Deleted {cleared.deleted_count} old resource schedule documents")

        resources = df['resource'].unique()
        stored_count = 0
            
        for resource_name in resources:
            try:
                resource_df = df[df['resource'] == resource_name]
                tasks = resource_df.to_dict('records')
                
                schedule_doc = {
                    'scenario_name': scenario_name,
                    'resource_name': resource_name,
                    'tasks': tasks,
                    'created_at': datetime.utcnow()
                }
                
                resource_schedules.insert_one(schedule_doc)
                print(f"[SAVE_TASK] ✓ Stored schedule for '{resource_name}' ({len(tasks)} entries)")
                stored_count += 1
            except Exception as e:
                print(f"[SAVE_TASK] ❌ Failed to store '{resource_name}': {type(e).__name__}: {e}")
        
        if stored_count > 0:
            print(f"[SAVE_TASK] ✓ Successfully saved new task '{task_name}' and regenerated all schedules")
            # Also add the task to the scenario's request_data (templates + orders)
            try:
                scenario_doc = scenarios.find_one({'name': scenario_name})
                if scenario_doc:
                    display_name = task_data.get('taskName') or task_name

                    # Use explicit capabilities supplied by the UI (may be empty list).
                    required_caps = [str(c).strip() for c in (selected_capabilities or []) if str(c).strip()]

                    new_template = {
                        'name': display_name,
                        'type': 'meets',
                        'requiredCapabilities': required_caps,
                        'subtasks': [
                            {
                                'taskName': display_name,
                                'type': 'executable',
                                'requiredCapabilities': required_caps,
                                'duration': int(task_data.get('duration') or 0),
                                'start-location': '@start-location',
                                'end-location': '@end-location',
                                'task_type': task_data.get('taskType')
                            }
                        ]
                    }

                    new_order = {
                        'name': display_name,
                        'quantity': 1,
                        'earlieststartdate': task_data.get('earliestStartTime'),
                        'duedate': task_data.get('latestDueDate'),
                        'start-location': task_data.get('location'),
                        'end-location': task_data.get('location'),
                        'tasks': [display_name]
                    }

                    update_result = scenarios.update_one(
                        {'name': scenario_name},
                        {'$push': {
                            'request_data.templates': new_template,
                            'request_data.orders': new_order
                        }}
                    )
                    print(f"[SAVE_TASK] ✓ Appended template/order to scenario '{scenario_name}' (matched: {update_result.matched_count}, modified: {update_result.modified_count})")
                else:
                    print(f"[SAVE_TASK] ⚠ Scenario '{scenario_name}' not found; skipping template/order update")
            except Exception as e:
                print(f"[SAVE_TASK] ⚠ Failed to update scenario templates/orders: {type(e).__name__}: {e}")

            return {'success': True, 'message': 'Schedule regenerated and saved', 'updated_count': stored_count}
        
        else:
            return {'success': False, 'message': 'No resource schedules were saved', 'updated_count': 0}
            
    except Exception as e:
        print(f"[SAVE_TASK] ❌ Error saving task: {type(e).__name__}: {e}")
        traceback.print_exc()
        return {'success': False, 'message': str(e), 'updated_count': 0}


@app.route('/api/locations', methods=['POST'])
def get_locations():
    """
    Return location names from scenarios.travel_matrix keys.
    Expects: { "token": "jwt", "scenario_name": "optional" }
    """
    try:
        data = request.json
        token = data.get('token')

        payload = verify_token(token)
        if not payload:
            return jsonify({'error': 'Invalid or expired token'}), 401

        username = payload['username']
        scenario_name = data.get('scenario_name') or get_user_scenario_name(username)
        if not scenario_name:
            return jsonify({'scenario_name': None, 'locations': []}), 200

        scenario = scenarios.find_one({'name': scenario_name})
        travel_matrix = scenario.get('travel_matrix', {}) if scenario else {}

        if isinstance(travel_matrix, dict):
            locations = sorted([k for k in travel_matrix.keys() if isinstance(k, str)])
        else:
            locations = []

        return jsonify({'scenario_name': scenario_name, 'locations': locations}), 200

    except Exception as e:
        print(f"Get locations error: {str(e)}")
        return jsonify({'error': 'Failed to retrieve locations'}), 500


@app.route('/api/capabilities', methods=['POST'])
def get_capabilities():
    """
    Return all unique capabilities from scenarios.request_data.resourceTypes[*].capabilities.
    Expects: { "token": "jwt", "scenario_name": "optional" }
    """
    try:
        data = request.json
        token = data.get('token')

        payload = verify_token(token)
        if not payload:
            return jsonify({'error': 'Invalid or expired token'}), 401

        username = payload['username']
        scenario_name = data.get('scenario_name') or get_user_scenario_name(username)
        if not scenario_name:
            return jsonify({'scenario_name': None, 'capabilities': []}), 200

        scenario = scenarios.find_one({'name': scenario_name})
        request_data = scenario.get('request_data', {}) if scenario else {}
        resource_types = request_data.get('resourceTypes', [])

        capabilities_set = set()
        for rt in resource_types:
            caps = rt.get('capabilities', [])
            if isinstance(caps, list):
                capabilities_set.update(caps)

        capabilities = sorted([c for c in capabilities_set if c not in ['traveler', 'transport']])
        return jsonify({'scenario_name': scenario_name, 'capabilities': capabilities}), 200

    except Exception as e:
        print(f"Get capabilities error: {str(e)}")
        return jsonify({'error': 'Failed to retrieve capabilities'}), 500


@app.route('/api/schedule', methods=['POST'])
def create_schedule():
    """
    Add a task in TDS and return the resulting output dataframe
    Expects: { "token": "jwt", "taskData": {...} }
    """
    try:
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            print(f"[SCHEDULE] Invalid JSON payload type: {type(data).__name__}")
            return jsonify({'error': 'Invalid JSON payload'}), 400

        token = data.get('token')
        task_data = data.get('taskData')
        selected_capabilities = data.get('selectedCapabilities', [])

        print("[SCHEDULE] Incoming request")
        print(f"[SCHEDULE] Payload keys: {list(data.keys())}")
        print(f"[SCHEDULE] taskData type: {type(task_data).__name__}")
        print(f"[SCHEDULE] selectedCapabilities type: {type(selected_capabilities).__name__}")

        if not isinstance(task_data, dict):
            return jsonify({'error': 'taskData must be an object'}), 400

        if selected_capabilities is None:
            selected_capabilities = []
        if not isinstance(selected_capabilities, list):
            return jsonify({'error': 'selectedCapabilities must be an array'}), 400
        selected_capabilities = [str(c).strip() for c in selected_capabilities if str(c).strip()]

        required_task_fields = ['taskName', 'taskType', 'duration', 'earliestStartTime', 'latestDueDate', 'location']
        missing_fields = [field for field in required_task_fields if task_data.get(field) in [None, '']]
        if missing_fields:
            print(f"[SCHEDULE] Missing task fields: {missing_fields}")
            return jsonify({'error': f"Missing required task fields: {', '.join(missing_fields)}"}), 400

        payload = verify_token(token)
        if not payload:
            return jsonify({'error': 'Invalid or expired token'}), 401

        username = payload['username']
        print(f"[SCHEDULE] User verified: {username}")
        scenario_name = get_user_scenario_name(username)
        if not scenario_name:
            return jsonify({'error': 'No scenario is associated with this user'}), 400

        task_name = str(task_data.get('taskName') or '').strip()
        if task_exists_in_scenario(scenario_name, task_name):
            return jsonify({'error': f"Task '{task_name}' already exists. Please choose a unique task name."}), 409

        tds = user_tds_store.get(username)
        if tds is None:
            print(f"[SCHEDULE] No cached TDS for {username}; initializing")
            initialize_user_tds(username)
            tds = user_tds_store.get(username)
        if tds is None:
            print(f"[SCHEDULE] TDS initialization failed for {username}")
            return jsonify({'error': 'TDS is not initialized for this user'}), 400

        epoch_date = user_epoch_store.get(username)
        if not epoch_date:
            print(f"[SCHEDULE] No cached epoch_date for {username}; loading from scenario")
            if scenario_name:
                scenario_data = retrieve_scenario(scenario_name)
                epoch_date = scenario_data[2]
                user_epoch_store[username] = epoch_date
        if not epoch_date:
            print(f"[SCHEDULE] Epoch date missing for {username}")
            return jsonify({'error': 'Epoch date is not initialized for this user'}), 400
        print(f"[SCHEDULE] epoch_date: {epoch_date}")

        try:
            duration_value = parse_positive_int(task_data.get('duration'), 'duration')
            est_value = datetime_to_epoch_minutes(task_data.get('earliestStartTime'), epoch_date)
            lft_value = datetime_to_epoch_minutes(task_data.get('latestDueDate'), epoch_date)
            if lft_value < est_value:
                raise ValueError('latestDueDate must be on or after earliestStartTime')
            print(f"[SCHEDULE] Parsed times -> est: {est_value}, lft: {lft_value}, duration: {duration_value}")
        except ValueError as e:
            print(f"[SCHEDULE] Validation error: {e}")
            return jsonify({'error': str(e)}), 400

        new_task_rows = [{
            'task_name': task_name,
            'required_capabilities': selected_capabilities,
            'locations': [task_data.get('location'), task_data.get('location')],
            'est': est_value,
            'lft': lft_value,
            'duration': duration_value,
            'task_type': task_data.get('taskType')
        }]

        new_task_df = pd.DataFrame(new_task_rows)
        print(f"[SCHEDULE] Calling add_task with rows: {len(new_task_df)}")
        try:
            assignments_df = add_task(tds, new_task_df)
            # Persist the modified TDS so later flows (e.g. assignment acceptance)
            # operate on the updated state rather than the cached pre-change TDS.
            if username:
                user_tds_store[username] = tds
                print(f"[SCHEDULE] Persisted modified TDS for user: {username}")
        except Exception as e:
            print(f"[SCHEDULE] add_task failed ({type(e).__name__}): {e}")
            print(f"[SCHEDULE] Reinitializing TDS after add_task failure for {username}")
            initialize_user_tds(username)
            message = str(e)
            if 'already exists' in message or 'Inconsistent STN' in message:
                return jsonify({'error': message}), 400
            return jsonify({'error': f"Failed to create task assignment: {message}"}), 500
        print(f"[SCHEDULE] add_task returned type: {type(assignments_df).__name__}")

        print(f"[SCHEDULE] Assignments DF shape: {assignments_df.shape if hasattr(assignments_df, 'shape') else 'N/A'}")
        print(f"[SCHEDULE] Assignments DF columns: {list(assignments_df.columns) if hasattr(assignments_df, 'columns') else 'N/A'}")
        if hasattr(assignments_df, 'head'):
            print(f"[SCHEDULE] Assignments DF:\n{assignments_df}")

        tds = apply_assignment(tds, assignments_df)
        output_rows = normalize_add_task_result(assignments_df)
        print(f"[SCHEDULE] Output rows for response: {len(output_rows)}")
        if output_rows and len(output_rows) > 0:
            print(f"[SCHEDULE] First output row: {output_rows[0]}")

        # Enrich with timing and location from resource_schedules
        output_rows = enrich_assignments_with_task_info(output_rows, scenario_name)
        print(f"[SCHEDULE] Enrichment complete for scenario: {scenario_name}")

        return jsonify({
            'message': 'Task added',
            'assignments': output_rows
        }), 200

    except (ServerSelectionTimeoutError, AutoReconnect) as e:
        print(f"[SCHEDULE] MongoDB connectivity error: {type(e).__name__}: {e}")
        return jsonify({
            'error': 'Database is temporarily unreachable. Check Atlas network access/VPN and TLS connectivity.'
        }), 503
    except Exception as e:
        print(f"[SCHEDULE] Unhandled error ({type(e).__name__}): {e}")
        try:
            print(f"[SCHEDULE] Raw request body: {request.get_data(as_text=True)}")
        except Exception:
            print("[SCHEDULE] Raw request body unavailable")
        traceback.print_exc()
        return jsonify({'error': f'Failed to create schedule: {type(e).__name__}: {e}'}), 500


@app.route('/api/current-schedule', methods=['POST'])
def get_current_schedule():
    """
    Get the user's current/latest schedule from resource_schedules
    Expects: { "token": "jwt" }
    """
    try:
        data = request.json
        token = data.get('token')

        payload = verify_token(token)
        if not payload:
            return jsonify({'error': 'Invalid or expired token'}), 401

        username = payload['username']

        schedule = resource_schedules.find_one(
            {'resource_name': {'$regex': f'^{username}$', '$options': 'i'}},
            sort=[('created_at', -1)]
        )

        if schedule and schedule.get('tasks'):
            resource_name = schedule.get('resource_name') or username
            tasks_with_person = [
                {**t, 'person': t.get('person') or resource_name}
                for t in schedule['tasks']
            ]
            return jsonify({
                'username': username,
                'scenario_name': schedule.get('scenario_name'),
                'tasks': tasks_with_person
            }), 200
        else:
            return jsonify({
                'username': username,
                'scenario_name': None,
                'tasks': []
            }), 200

    except Exception as e:
        print(f"Get schedule error: {str(e)}")
        return jsonify({'error': 'Failed to retrieve schedule'}), 500


@app.route('/api/all-resource-schedules', methods=['POST'])
def get_all_resource_schedules():
    """
    Get schedules for every resource in the database (all events, everyone).
    Used by the Gantt chart to show one row per person. No filtering by scenario.
    Expects: { "token": "jwt" }
    """
    try:
        data = request.json
        token = data.get('token')

        payload = verify_token(token)
        if not payload:
            return jsonify({'error': 'Invalid or expired token'}), 401

        pipeline = [
            {'$sort': {'created_at': -1}},
            {'$group': {'_id': '$resource_name', 'doc': {'$first': '$$ROOT'}}},
            {'$replaceRoot': {'newRoot': '$doc'}}
        ]
        docs = list(resource_schedules.aggregate(pipeline))

        tasks_with_person = []
        resource_names = []
        for doc in docs:
            rname = doc.get('resource_name') or doc.get('_id')
            if not rname:
                continue
            resource_names.append(rname)
            for t in doc.get('tasks') or []:
                tasks_with_person.append({**t, 'person': t.get('person') or rname})

        scenario_name = docs[0].get('scenario_name') if docs else None
        return jsonify({
            'scenario_name': scenario_name,
            'resource_names': resource_names,
            'tasks': tasks_with_person
        }), 200

    except Exception as e:
        print(f"Get all schedules error: {str(e)}")
        return jsonify({'error': 'Failed to retrieve schedules'}), 500


@app.route('/api/assignment-decision', methods=['POST'])
def save_assignment_decision():
    """
    When assignment is accepted:
    1. Save the task to resource_schedules (MongoDB) for all assigned resources
    2. Create inbox messages for assigned personnel
    
    When rejected: Only record the rejection (no data save)
    
    Expects: {
      "token": "jwt",
      "accepted": true|false,
      "taskData": {...},
      "assignments": [...]
    }
    """
    try:
        data = request.get_json(silent=True) or {}
        token = data.get('token')
        accepted = bool(data.get('accepted'))
        task_data = data.get('taskData') or {}
        assignments = data.get('assignments') or []

        payload = verify_token(token)
        if not payload:
            return jsonify({'error': 'Invalid or expired token'}), 401

        username = payload['username']
        scenario_name = get_user_scenario_name(username)
        
        if not accepted:
            print(f"[ASSIGN_DECISION] Assignment rejected by {username}; rebuilding TDS from scenario")
            try:
                initialize_user_tds(username)
                return jsonify({'message': 'Assignment rejected; TDS rebuilt from scenario'}), 200
            except Exception as e:
                print(f"[ASSIGN_DECISION] ⚠ Failed to rebuild TDS for {username}: {type(e).__name__}: {e}")
                return jsonify({'message': 'Assignment rejected', 'tds_rebuild_error': str(e)}), 200

        # Step 1: Save task to resource_schedules (convert TDS assignments to MongoDB storage)
        print(f"[ASSIGN_DECISION] Processing accepted assignment for user {username}")
        epoch_date = user_epoch_store.get(username)
        
        selected_capabilities = data.get('selectedCapabilities') or []
        save_result = _save_accepted_task_to_schedule(username, scenario_name, task_data, epoch_date, assignments, selected_capabilities)
        print(f"[ASSIGN_DECISION] Save result: {save_result}")
        
        if not save_result.get('success'):
            print(f"[ASSIGN_DECISION] ⚠ Task save failed: {save_result.get('message')}")
            return jsonify({
                'message': 'Task could not be saved to schedule',
                'error_detail': save_result.get('message'),
                'schedule_saved': False,
                'inbox_created': 0
            }), 400

        # Step 2: Create inbox messages for assigned personnel
        docs = _build_assignment_inbox_docs(assignments, task_data, scenario_name, username)
        inbox_count = 0
        if docs:
            try:
                inbox_messages.insert_many(docs)
                inbox_count = len(docs)
                print(f"[ASSIGN_DECISION] ✓ Created {inbox_count} inbox message(s)")
            except Exception as e:
                print(f"[ASSIGN_DECISION] ⚠ Failed to create inbox messages: {type(e).__name__}: {e}")
                # Don't fail the whole request if inbox creation fails
        
        return jsonify({
            'message': 'Assignment accepted and saved',
            'schedule_saved': True,
            'resources_updated': save_result.get('updated_count', 0),
            'inbox_created': inbox_count
        }), 201

    except (ServerSelectionTimeoutError, AutoReconnect) as e:
        print(f"[ASSIGN_DECISION] MongoDB connectivity error: {type(e).__name__}: {e}")
        return jsonify({'error': 'Database is temporarily unreachable'}), 503
    except Exception as e:
        print(f"[ASSIGN_DECISION] Unhandled error: {type(e).__name__}: {e}")
        traceback.print_exc()
        return jsonify({'error': 'Failed to save assignment decision'}), 500


@app.route('/api/inbox', methods=['POST'])
def get_inbox_messages():
    """Fetch inbox messages for the authenticated user/resource."""
    try:
        data = request.get_json(silent=True) or {}
        token = data.get('token')

        payload = verify_token(token)
        if not payload:
            return jsonify({'error': 'Invalid or expired token'}), 401

        username = payload['username']
        docs = list(inbox_messages.find(
            {'recipient': {'$regex': f'^{re.escape(username)}$', '$options': 'i'}},
            sort=[('created_at', -1)]
        ))

        return jsonify({'messages': [_serialize_inbox_doc(doc) for doc in docs]}), 200

    except (ServerSelectionTimeoutError, AutoReconnect) as e:
        print(f"Get inbox DB error: {type(e).__name__}: {e}")
        return jsonify({'error': 'Database is temporarily unreachable'}), 503
    except Exception as e:
        print(f"Get inbox error: {type(e).__name__}: {e}")
        return jsonify({'error': 'Failed to fetch inbox messages'}), 500


# ======================= ADMIN/UTILITY ROUTES =======================

@app.route('/api/users', methods=['GET'])
def list_users():
    """List all users (for debugging/admin)"""
    all_users = list(users.find({}, {'password': 0}))
    for user in all_users:
        user['_id'] = str(user['_id'])
    return jsonify({'users': all_users}), 200


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        db.command('ping')
        return jsonify({'status': 'healthy', 'database': 'connected'}), 200
    except Exception as e:
        return jsonify({'status': 'unhealthy', 'database': 'disconnected', 'error': str(e)}), 500


if __name__ == '__main__':
    print("=" * 60)
    print("Task Scheduler Backend Server")
    print("=" * 60)
    print(f"Server running on: http://localhost:5000")
    print(f"MongoDB URI: {redact_mongo_uri(app.config['MONGO_URI'])}")
    print("\nAvailable endpoints:")
    print("  POST /api/register      - Create new account")
    print("  POST /api/login         - Log in (loads TDS into memory)")
    print("  POST /api/verify-token  - Verify JWT token")
    print("  POST /api/locations     - Get location dropdown values")
    print("  POST /api/capabilities  - Get capabilities checklist values")
    print("  POST /api/schedule      - Add task and return input df")
    print("  POST /api/current-schedule - Get user's current schedule")
    print("  POST /api/all-resource-schedules - All resources (multi-person Gantt)")
    print("  GET  /health            - Health check")
    print("  GET  /api/users         - List all users (debug)")
    print("=" * 60)

    app.run(debug=True, port=5000)