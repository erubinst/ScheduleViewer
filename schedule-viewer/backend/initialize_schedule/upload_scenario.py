"""
Standalone script to upload scenario data directly to MongoDB
Run this once to populate the database with your scenario
"""

from pymongo import MongoClient
import json
from datetime import datetime

# MongoDB connection (same as your backend)
MONGO_URI = 'mongodb+srv://erubinst:dbUserPassword@scheduleviewer.3la41u6.mongodb.net/task_scheduler?retryWrites=true&w=majority&appName=ScheduleViewer'

# Scenario configuration
SCENARIO_NAME = 'p3_w3_scenario'
REQUEST_FILE = '/Users/erubinst/ICLL/pythonSTN/tds/p3_w3_scenario/request.json'
TRAVEL_FILE = '/Users/erubinst/ICLL/pythonSTN/tds/p3_w3_scenario/travel_matrix.json'


def upload_scenario():
    """Upload scenario directly to MongoDB"""
    
    print("=" * 60)
    print("Scenario Upload Tool")
    print("=" * 60)
    
    # Connect to MongoDB
    print("\n📡 Connecting to MongoDB Atlas...")
    try:
        client = MongoClient(MONGO_URI)
        db = client.task_scheduler
        scenarios = db.scenarios
        
        # Test connection
        db.command('ping')
        print("✅ Connected to MongoDB!")
    except Exception as e:
        print(f"❌ Failed to connect to MongoDB: {str(e)}")
        return False
    
    # Load files
    print(f"\n📁 Loading scenario files...")
    print(f"   Request file: {REQUEST_FILE}")
    print(f"   Travel file: {TRAVEL_FILE}")
    
    try:
        with open(REQUEST_FILE, 'r') as f:
            request_data = json.load(f)
        
        with open(TRAVEL_FILE, 'r') as f:
            travel_matrix = json.load(f)
        
        print(f"✅ Files loaded successfully")
        print(f"   Resources: {len(request_data['resourceTypes'])}")
        print(f"   Templates: {len(request_data['templates'])}")
        print(f"   Orders: {len(request_data['orders'])}")
        print(f"   Locations: {len(travel_matrix)}")
        
        # Extract parameters from request_data
        params = request_data.get('parameters', {})
        if params:
            print(f"\n⚙️  Scenario parameters:")
            for key, value in params.items():
                print(f"   {key}: {value}")
        else:
            print(f"\n⚠️  No parameters found in request.json")
            print(f"   Add a 'parameters' section to your request.json")
        
    except FileNotFoundError as e:
        print(f"❌ Error: Could not find file - {e}")
        print(f"\nMake sure you have:")
        print(f"   - {REQUEST_FILE}")
        print(f"   - {TRAVEL_FILE}")
        print(f"\nIn the same directory as this script")
        return False
    except json.JSONDecodeError as e:
        print(f"❌ Error: Invalid JSON in file - {e}")
        return False
    
    # Check if scenario already exists
    print(f"\n🔍 Checking if scenario '{SCENARIO_NAME}' already exists...")
    existing = scenarios.find_one({'name': SCENARIO_NAME})
    
    if existing:
        print(f"⚠️  Scenario '{SCENARIO_NAME}' already exists!")
        response = input("   Do you want to replace it? (yes/no): ")
        if response.lower() != 'yes':
            print("❌ Upload cancelled")
            return False
        else:
            scenarios.delete_one({'name': SCENARIO_NAME})
            print("🗑️  Deleted existing scenario")
    
    # Upload scenario
    print(f"\n📤 Uploading scenario to MongoDB...")
    scenario_doc = {
        'name': SCENARIO_NAME,
        'request_data': request_data,
        'travel_matrix': travel_matrix,
        'created_at': datetime.utcnow()
    }
    
    # Parameters are already inside request_data, no need to duplicate
    
    try:
        result = scenarios.insert_one(scenario_doc)
        print(f"✅ Scenario uploaded successfully!")
        print(f"   Scenario ID: {result.inserted_id}")
        
    except Exception as e:
        print(f"❌ Failed to upload: {str(e)}")
        return False
    
    # List all scenarios
    print(f"\n📊 All scenarios in database:")
    all_scenarios = list(scenarios.find({}, {'_id': 0, 'name': 1, 'created_at': 1}))
    for scenario in all_scenarios:
        print(f"   - {scenario['name']} (created: {scenario['created_at']})")
    
    # Show resources that will become accounts
    print(f"\n👥 Resources in this scenario:")
    for resource in request_data['resourceTypes']:
        print(f"   - {resource['name']}")
    
    print("\n" + "=" * 60)
    print("✅ Upload complete!")
    print("=" * 60)
    print("\nNext steps:")
    print("1. Run: python create_resource_accounts.py")
    print("   (This will create user accounts for all resources)")
    print("2. Then you can initialize and run the scheduler")
    
    return True


if __name__ == '__main__':
    upload_scenario()