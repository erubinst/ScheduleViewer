"""
Script to run the scheduler and store results in MongoDB
This creates the initial schedule for a scenario and stores it per resource
"""

from pymongo import MongoClient
from datetime import datetime
import json
import tempfile
import os

# Import your scheduler
from tds.executer import run_scheduler

# MongoDB connection (same as your backend)
MONGO_URI = ''

# Configuration
SCENARIO_NAME = 'p3_w3_scenario'


def run_and_store_schedule():
    """
    Run the scheduler for a scenario and store results in MongoDB
    """
    
    print("=" * 60)
    print("Scheduler Runner & Storage")
    print("=" * 60)
    
    # Connect to MongoDB
    print("\n📡 Connecting to MongoDB Atlas...")
    try:
        client = MongoClient(MONGO_URI)
        db = client.task_scheduler
        scenarios = db.scenarios
        resource_schedules = db.resource_schedules
        
        # Test connection
        db.command('ping')
        print("✅ Connected to MongoDB!")
    except Exception as e:
        print(f"❌ Failed to connect to MongoDB: {str(e)}")
        return False
    
    # Get the scenario
    print(f"\n🔍 Loading scenario '{SCENARIO_NAME}'...")
    scenario = scenarios.find_one({'name': SCENARIO_NAME})
    
    if not scenario:
        print(f"❌ Scenario '{SCENARIO_NAME}' not found!")
        print(f"\nMake sure you've run: python upload_scenario_standalone.py")
        return False
    
    print(f"✅ Scenario loaded!")
    
    # Extract parameters
    request_data = scenario['request_data']
    travel_matrix = scenario['travel_matrix']
    params = request_data.get('parameters', {})
    
    if not params:
        print(f"❌ No parameters found in scenario!")
        print(f"   Add 'parameters' section to your request.json")
        return False
    
    epoch_date = params.get('epoch_date')
    print(f"\n⚙️  Using parameters:")
    print(f"   Epoch date: {epoch_date}")
    print(f"   Global start: {params.get('global_start')}")
    print(f"   Global end: {params.get('global_end')}")
    
    # Create temporary files for the scheduler
    print(f"\n📝 Creating temporary files for scheduler...")
    with tempfile.TemporaryDirectory() as tmpdir:
        request_path = os.path.join(tmpdir, 'request.json')
        travel_path = os.path.join(tmpdir, 'travel_matrix.json')
        
        # Write files
        with open(request_path, 'w') as f:
            json.dump(request_data, f, indent=2)
        
        with open(travel_path, 'w') as f:
            json.dump(travel_matrix, f, indent=2)
        
        print(f"✅ Temporary files created")
        
        # Run the scheduler
        print(f"\n🚀 Running scheduler...")
        try:
            df = run_scheduler(request_path, travel_path, epoch_date)
            print(f"✅ Scheduler completed!")
            print(f"   Generated {len(df)} schedule entries")
        except Exception as e:
            print(f"❌ Scheduler failed: {str(e)}")
            import traceback
            traceback.print_exc()
            return False
    
    # Show sample of results
    print(f"\n📊 Sample results:")
    print(df.head(10).to_string())
    
    # Store results per resource
    print(f"\n💾 Storing schedule in MongoDB...")
    
    # Clear existing schedules for this scenario
    resource_schedules.delete_many({'scenario_name': SCENARIO_NAME})
    print(f"   Cleared old schedules for '{SCENARIO_NAME}'")
    
    # Group by resource and store
    resources = df['resource'].unique()
    stored_count = 0
    
    for resource_name in resources:
        resource_df = df[df['resource'] == resource_name]
        
        # Convert DataFrame to list of dicts
        tasks = resource_df.to_dict('records')
        
        # Create document
        schedule_doc = {
            'scenario_name': SCENARIO_NAME,
            'resource_name': resource_name,
            'tasks': tasks,
            'created_at': datetime.utcnow()
        }
        
        try:
            resource_schedules.insert_one(schedule_doc)
            print(f"   ✅ Stored schedule for '{resource_name}' ({len(tasks)} entries)")
            stored_count += 1
        except Exception as e:
            print(f"   ❌ Failed to store '{resource_name}': {str(e)}")
    
    # Summary
    print("\n" + "=" * 60)
    print("Summary:")
    print("=" * 60)
    print(f"✅ Scheduler ran successfully")
    print(f"📊 Total entries: {len(df)}")
    print(f"👥 Resources: {len(resources)}")
    print(f"💾 Stored: {stored_count} resource schedules")
    
    print("\n" + "=" * 60)
    print("✅ Complete!")
    print("=" * 60)
    print("\nNext steps:")
    print("1. Users can now log in with resource usernames")
    print("2. View Schedule will show their personal schedule")
    print("3. Ready for demo!")
    
    return True


if __name__ == '__main__':
    run_and_store_schedule()