"""
Flask Backend with MongoDB Authentication
Simple username/password system for Task Scheduler
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_bcrypt import Bcrypt
from pymongo import MongoClient
from bson import ObjectId
from datetime import datetime, timedelta
import jwt
import os
import json
import re
import traceback
import pandas as pd

from add_task import retrieve_current_schedule, retrieve_scenario
from tds.executer import reload_tds, add_task

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
app.config['MONGO_URI'] = 'mongodb+srv://erubinst:dbUserPassword@scheduleviewer.3la41u6.mongodb.net/task_scheduler?retryWrites=true&w=majority&appName=ScheduleViewer'

# Initialize
bcrypt = Bcrypt(app)
client = MongoClient(app.config['MONGO_URI'])
db = client.task_scheduler

# Collections
users = db.users
schedules = db.schedules
scenarios = db.scenarios
resource_schedules = db.resource_schedules

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

        user = users.find_one({'username': username})
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

        print("[SCHEDULE] Incoming request")
        print(f"[SCHEDULE] Payload keys: {list(data.keys())}")
        print(f"[SCHEDULE] taskData type: {type(task_data).__name__}")
        print(f"[SCHEDULE] selectedCapabilities type: {type(data.get('selectedCapabilities')).__name__}")

        if not isinstance(task_data, dict):
            return jsonify({'error': 'taskData must be an object'}), 400

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
            scenario_name = get_user_scenario_name(username)
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
            print(f"[SCHEDULE] Parsed times -> est: {est_value}, lft: {lft_value}, duration: {duration_value}")
        except ValueError as e:
            print(f"[SCHEDULE] Validation error: {e}")
            return jsonify({'error': str(e)}), 400

        new_task_rows = [{
            'task_name': task_data.get('taskName'),
            'required_capabilities': data.get('selectedCapabilities', []),
            'locations': [task_data.get('location'), task_data.get('location')],
            'est': est_value,
            'lft': lft_value,
            'duration': duration_value,
            'task_type': task_data.get('taskType')
        }]

        new_task_df = pd.DataFrame(new_task_rows)
        print(f"[SCHEDULE] Calling add_task with rows: {len(new_task_df)}")
        assignments_df = add_task(tds, new_task_df)
        print(f"[SCHEDULE] add_task returned type: {type(assignments_df).__name__}")

        print(f"[SCHEDULE] Assignments DF shape: {assignments_df.shape if hasattr(assignments_df, 'shape') else 'N/A'}")
        print(f"[SCHEDULE] Assignments DF columns: {list(assignments_df.columns) if hasattr(assignments_df, 'columns') else 'N/A'}")
        if hasattr(assignments_df, 'head'):
            print(f"[SCHEDULE] Assignments DF:\n{assignments_df}")

        output_rows = normalize_add_task_result(assignments_df)
        print(f"[SCHEDULE] Output rows for response: {len(output_rows)}")
        if output_rows and len(output_rows) > 0:
            print(f"[SCHEDULE] First output row: {output_rows[0]}")

        # Enrich with timing and location from resource_schedules
        scenario_name = get_user_scenario_name(username)
        output_rows = enrich_assignments_with_task_info(output_rows, scenario_name)
        print(f"[SCHEDULE] Enrichment complete for scenario: {scenario_name}")

        return jsonify({
            'message': 'Task added',
            'assignments': output_rows
        }), 200

    except Exception as e:
        print(f"[SCHEDULE] Unhandled error ({type(e).__name__}): {e}")
        try:
            print(f"[SCHEDULE] Raw request body: {request.get_data(as_text=True)}")
        except Exception:
            print("[SCHEDULE] Raw request body unavailable")
        traceback.print_exc()
        return jsonify({'error': 'Failed to create schedule'}), 500


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
    print(f"MongoDB URI: {app.config['MONGO_URI']}")
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