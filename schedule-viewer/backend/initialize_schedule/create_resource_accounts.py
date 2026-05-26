"""
Standalone script to create user accounts for all resources in a scenario
All accounts will have password: "tester"
"""

from flask_bcrypt import Bcrypt
from datetime import datetime
from flask import Flask

from mongo_client import create_mongo_client

# MongoDB connection (same as your backend)
MONGO_URI = 'mongodb+srv://erubinst:dbUserPassword@scheduleviewer.3la41u6.mongodb.net/task_scheduler?retryWrites=true&w=majority&appName=ScheduleViewer'

# Configuration
SCENARIO_NAME = 'p3_w3_scenario'
DEFAULT_PASSWORD = 'tester'  # All resources will have this password


def create_resource_accounts():
    """Create user accounts for all resources in the scenario"""
    
    print("=" * 60)
    print("Resource Account Creation Tool")
    print("=" * 60)
    
    # Connect to MongoDB
    print("\n📡 Connecting to MongoDB Atlas...")
    try:
        client = create_mongo_client(MONGO_URI)
        db = client.task_scheduler
        scenarios = db.scenarios
        users = db.users
        
        # Test connection
        db.command('ping')
        print("✅ Connected to MongoDB!")
    except Exception as e:
        print(f"❌ Failed to connect to MongoDB: {str(e)}")
        return False
    
    # Initialize bcrypt for password hashing
    app = Flask(__name__)
    bcrypt = Bcrypt(app)
    
    # Get the scenario
    print(f"\n🔍 Loading scenario '{SCENARIO_NAME}'...")
    scenario = scenarios.find_one({'name': SCENARIO_NAME})
    
    if not scenario:
        print(f"❌ Scenario '{SCENARIO_NAME}' not found!")
        print(f"\nMake sure you've run: python upload_scenario_standalone.py")
        return False
    
    print(f"✅ Scenario loaded!")
    
    # Extract resources
    resources = scenario['request_data']['resourceTypes']
    print(f"\n👥 Found {len(resources)} resources:")
    for resource in resources:
        print(f"   - {resource['name']}")
    
    # Hash the password once (same for all)
    print(f"\n🔐 Hashing password...")
    hashed_password = bcrypt.generate_password_hash(DEFAULT_PASSWORD).decode('utf-8')
    print(f"✅ Password hashed")
    
    # Create accounts
    print(f"\n📝 Creating user accounts...")
    created_count = 0
    recreated_count = 0
    
    for resource in resources:
        username = resource['name']
        
        # Check if user already exists
        existing_user = users.find_one({'username': username})
        
        if existing_user:
            print(f"   🗑️  Deleting existing account for '{username}'...")
            users.delete_one({'username': username})
            recreated_count += 1
        
        # Create user account
        user_doc = {
            'username': username,
            'password': hashed_password,
            'created_at': datetime.utcnow()
        }
        
        try:
            users.insert_one(user_doc)
            if existing_user:
                print(f"   ✅ Recreated account for '{username}'")
            else:
                print(f"   ✅ Created account for '{username}'")
                created_count += 1
        except Exception as e:
            print(f"   ❌ Failed to create '{username}': {str(e)}")
    
    # Summary
    print("\n" + "=" * 60)
    print("Summary:")
    print("=" * 60)
    print(f"✅ New accounts: {created_count}")
    print(f"🔄 Recreated: {recreated_count}")
    print(f"📊 Total resources: {len(resources)}")
    
    # Show login credentials
    print("\n" + "=" * 60)
    print("Login Credentials:")
    print("=" * 60)
    print(f"Password for ALL accounts: {DEFAULT_PASSWORD}")
    print("\nUsernames:")
    for resource in resources:
        print(f"   - {resource['name']}")
    
    print("\n" + "=" * 60)
    print("✅ Setup complete!")
    print("=" * 60)
    print("\nYou can now:")
    print("1. Log in to the UI with any resource username")
    print("2. Run your scheduler to generate schedules")
    print("3. Store results per resource")
    
    # Show all users in database
    print("\n📋 All users in database:")
    all_users = list(users.find({}, {'_id': 0, 'username': 1, 'created_at': 1}))
    for user in all_users:
        print(f"   - {user['username']}")
    
    return True


if __name__ == '__main__':
    create_resource_accounts()