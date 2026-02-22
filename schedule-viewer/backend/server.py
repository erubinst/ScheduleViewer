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

# Helper function to create JWT token
def create_token(user_id, username):
    payload = {
        'user_id': str(user_id),
        'username': username,
        'exp': datetime.utcnow() + timedelta(days=7)  # Token expires in 7 days
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
        
        # Validation
        if not username or not password:
            return jsonify({'error': 'Username and password are required'}), 400
        
        if len(username) < 3:
            return jsonify({'error': 'Username must be at least 3 characters'}), 400
        
        if len(password) < 6:
            return jsonify({'error': 'Password must be at least 6 characters'}), 400
        
        # Check if user already exists
        if users.find_one({'username': username}):
            return jsonify({'error': 'Username already exists'}), 400
        
        # Hash password
        hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
        
        # Create user
        user_data = {
            'username': username,
            'password': hashed_password,
            'created_at': datetime.utcnow()
        }
        result = users.insert_one(user_data)
        
        # Create token
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
        
        # Find user
        user = users.find_one({'username': username})
        
        if not user:
            return jsonify({'error': 'Invalid username or password'}), 401
        
        # Check password
        if not bcrypt.check_password_hash(user['password'], password):
            return jsonify({'error': 'Invalid username or password'}), 401
        
        # Create token
        token = create_token(user['_id'], username)
        
        return jsonify({
            'message': 'Login successful',
            'token': token,
            'username': username
        }), 200
        
    except Exception as e:
        print(f"Login error: {str(e)}")
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
            return jsonify({
                'valid': True,
                'username': payload['username']
            }), 200
        else:
            return jsonify({'valid': False}), 200
            
    except Exception as e:
        print(f"Token verification error: {str(e)}")
        return jsonify({'valid': False}), 200


# ======================= SCHEDULE ROUTES =======================

@app.route('/api/schedule', methods=['POST'])
def create_schedule():
    """
    Create schedule options for a new task
    Expects: { "token": "jwt", "taskData": {...} }
    """
    try:
        data = request.json
        token = data.get('token')
        task_data = data.get('taskData')
        
        # Verify token
        payload = verify_token(token)
        if not payload:
            return jsonify({'error': 'Invalid or expired token'}), 401
        
        username = payload['username']
        
        print(f"Creating schedule for user: {username}")
        print(f"Task data: {task_data}")
        
        # TODO: Replace this with your actual scheduler algorithm
        # For now, return mock schedules
        schedules = generate_mock_schedules(task_data, username)
        
        return jsonify({'schedules': schedules}), 200
        
    except Exception as e:
        print(f"Schedule creation error: {str(e)}")
        return jsonify({'error': 'Failed to create schedule'}), 500


@app.route('/api/save-schedule', methods=['POST'])
def save_schedule():
    """
    Save the selected schedule
    Expects: { "token": "jwt", "schedule": {...} }
    """
    try:
        data = request.json
        token = data.get('token')
        schedule = data.get('schedule')
        
        # Verify token
        payload = verify_token(token)
        if not payload:
            return jsonify({'error': 'Invalid or expired token'}), 401
        
        username = payload['username']
        
        # Save schedule to database
        schedule_data = {
            'username': username,
            'schedule': schedule,
            'created_at': datetime.utcnow()
        }
        
        result = schedules.insert_one(schedule_data)
        
        print(f"Saved schedule for user {username}: {result.inserted_id}")
        
        return jsonify({
            'message': 'Schedule saved successfully',
            'schedule_id': str(result.inserted_id)
        }), 200
        
    except Exception as e:
        print(f"Save schedule error: {str(e)}")
        return jsonify({'error': 'Failed to save schedule'}), 500


@app.route('/api/current-schedule', methods=['POST'])
def get_current_schedule():
    """
    Get the user's current/latest schedule from resource_schedules
    Expects: { "token": "jwt" }
    """
    try:
        data = request.json
        token = data.get('token')
        
        # Verify token
        payload = verify_token(token)
        if not payload:
            return jsonify({'error': 'Invalid or expired token'}), 401
        
        username = payload['username']
        
        # Get the user's schedule from resource_schedules collection
        # Case-insensitive matching on resource_name
        schedule = resource_schedules.find_one(
            {'resource_name': {'$regex': f'^{username}$', '$options': 'i'}},
            sort=[('created_at', -1)]
        )
        
        if schedule and schedule.get('tasks'):
            # Attach resource_name as person on each task for Gantt chart / multi-format frontend
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
            # Return empty schedule
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

        # Always return everyone: latest document per resource_name (no scenario filter)
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


# ======================= HELPER FUNCTIONS =======================

def generate_mock_schedules(task_data, username):
    """
    Generate mock schedule options
    Replace this with your actual scheduling algorithm
    """
    duration_in_hours = float(task_data['duration']) / 60
    task_name = task_data['taskName']
    
    # Option 1: Morning schedule
    option1 = {
        'id': 1,
        'name': 'Schedule Option 1',
        'tasks': [
            {'person': 'Alex', 'taskName': 'Team Standup', 'start': 0, 'duration': 0.5, 'color': '#94a3b8'},
            {'person': 'Jordan', 'taskName': 'Team Standup', 'start': 0, 'duration': 0.5, 'color': '#94a3b8'},
            {'person': 'Sam', 'taskName': 'Team Standup', 'start': 0, 'duration': 0.5, 'color': '#94a3b8'},
            {'person': 'Taylor', 'taskName': 'Code Review', 'start': 0.5, 'duration': 1, 'color': '#94a3b8'},
            {'person': 'Casey', 'taskName': 'Documentation', 'start': 1, 'duration': 2, 'color': '#94a3b8'},
            
            {'person': 'Alex', 'taskName': task_name, 'start': 1, 'duration': duration_in_hours, 'color': '#3b82f6'},
            {'person': 'Jordan', 'taskName': task_name, 'start': 1, 'duration': duration_in_hours, 'color': '#3b82f6'},
            
            {'person': 'Alex', 'taskName': 'Client Call', 'start': 1 + duration_in_hours + 0.5, 'duration': 1, 'color': '#94a3b8'},
            {'person': 'Jordan', 'taskName': 'Development', 'start': 1 + duration_in_hours + 0.5, 'duration': 2, 'color': '#94a3b8'},
            {'person': 'Sam', 'taskName': 'Testing', 'start': 2, 'duration': 3, 'color': '#94a3b8'},
            {'person': 'Taylor', 'taskName': 'Design Work', 'start': 2, 'duration': 2.5, 'color': '#94a3b8'},
            {'person': 'Casey', 'taskName': 'Research', 'start': 4, 'duration': 2, 'color': '#94a3b8'},
        ]
    }
    
    # Option 2: Afternoon schedule
    option2 = {
        'id': 2,
        'name': 'Schedule Option 2',
        'tasks': [
            {'person': 'Alex', 'taskName': 'Team Standup', 'start': 0, 'duration': 0.5, 'color': '#94a3b8'},
            {'person': 'Jordan', 'taskName': 'Team Standup', 'start': 0, 'duration': 0.5, 'color': '#94a3b8'},
            {'person': 'Sam', 'taskName': 'Team Standup', 'start': 0, 'duration': 0.5, 'color': '#94a3b8'},
            {'person': 'Taylor', 'taskName': 'Development', 'start': 0.5, 'duration': 3, 'color': '#94a3b8'},
            {'person': 'Casey', 'taskName': 'Client Meeting', 'start': 1, 'duration': 1.5, 'color': '#94a3b8'},
            {'person': 'Alex', 'taskName': 'Email Review', 'start': 1, 'duration': 1, 'color': '#94a3b8'},
            {'person': 'Jordan', 'taskName': 'Code Review', 'start': 1, 'duration': 1.5, 'color': '#94a3b8'},
            {'person': 'Sam', 'taskName': 'Bug Fixes', 'start': 2, 'duration': 2, 'color': '#94a3b8'},
            
            {'person': 'Taylor', 'taskName': task_name, 'start': 4, 'duration': duration_in_hours, 'color': '#10b981'},
            {'person': 'Casey', 'taskName': task_name, 'start': 3, 'duration': duration_in_hours, 'color': '#10b981'},
            {'person': 'Alex', 'taskName': task_name, 'start': 4, 'duration': duration_in_hours, 'color': '#10b981'},
            
            {'person': 'Jordan', 'taskName': 'Testing', 'start': 5, 'duration': 2, 'color': '#94a3b8'},
            {'person': 'Sam', 'taskName': 'Documentation', 'start': 5.5, 'duration': 1.5, 'color': '#94a3b8'},
        ]
    }
    
    return [option1, option2]


# ======================= ADMIN/UTILITY ROUTES =======================

@app.route('/api/users', methods=['GET'])
def list_users():
    """
    List all users (for debugging/admin)
    """
    all_users = list(users.find({}, {'password': 0}))  # Exclude passwords
    for user in all_users:
        user['_id'] = str(user['_id'])
    return jsonify({'users': all_users}), 200


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        # Test database connection
        db.command('ping')
        return jsonify({
            'status': 'healthy',
            'database': 'connected'
        }), 200
    except Exception as e:
        return jsonify({
            'status': 'unhealthy',
            'database': 'disconnected',
            'error': str(e)
        }), 500


if __name__ == '__main__':
    print("=" * 60)
    print("Task Scheduler Backend Server")
    print("=" * 60)
    print(f"Server running on: http://localhost:5000")
    print(f"MongoDB URI: {app.config['MONGO_URI']}")
    print("\nAvailable endpoints:")
    print("  POST /api/register      - Create new account")
    print("  POST /api/login         - Log in")
    print("  POST /api/verify-token  - Verify JWT token")
    print("  POST /api/schedule      - Create schedule options")
    print("  POST /api/save-schedule - Save selected schedule")
    print("  POST /api/current-schedule - Get user's current schedule")
    print("  POST /api/all-resource-schedules - All resources (multi-person Gantt)")
    print("  GET  /health            - Health check")
    print("  GET  /api/users         - List all users (debug)")
    print("=" * 60)
    
    app.run(debug=True, port=5000)