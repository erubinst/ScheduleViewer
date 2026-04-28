"""
Scenario generator — pulls resource_types, travel_matrix, and all_tasks
from MongoDB, computes actual timestamps from offsets, and uploads the
generated scenario to the scenarios collection.

Usage:
    python generate_scenario.py <date>   e.g.  python generate_scenario.py 2026-01-14
"""

import sys
import json
import re
from datetime import datetime, timedelta, timezone
from pymongo import MongoClient

# ── Config ────────────────────────────────────────────────────────────────────

MONGO_URI = 'mongodb+srv://erubinst:dbUserPassword@scheduleviewer.3la41u6.mongodb.net/task_scheduler?retryWrites=true&w=majority&appName=ScheduleViewer'
DB_NAME   = 'task_scheduler'

# ── Helpers ───────────────────────────────────────────────────────────────────

def get_sunday_of_week(date_str: str) -> datetime:
    """Return Sunday 00:00 UTC for the week containing date_str."""
    d = datetime.fromisoformat(date_str).replace(tzinfo=timezone.utc)
    d = d.replace(hour=0, minute=0, second=0, microsecond=0)
    days_since_sunday = (d.weekday() + 1) % 7
    return d - timedelta(days=days_since_sunday)

def offset_to_dt(anchor: datetime, offset_minutes: int) -> datetime:
    return anchor + timedelta(minutes=offset_minutes)

def dt_to_str(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M")

def get_jan1(year: int) -> datetime:
    return datetime(year, 1, 1, 0, 0, 0, tzinfo=timezone.utc)

def annual_offset_to_dt(year: int, offset_minutes: int) -> datetime:
    return get_jan1(year) + timedelta(minutes=offset_minutes)

def is_in_week(dt: datetime, sunday: datetime) -> bool:
    return sunday <= dt < sunday + timedelta(days=7)

def task_name_to_snake(name: str) -> str:
    return re.sub(r'(?<!^)(?=[A-Z])', '_', name).lower()

# ── Generator ─────────────────────────────────────────────────────────────────

def generate_scenario(input_date_str: str, db) -> dict:
    sunday = get_sunday_of_week(input_date_str)
    year   = sunday.year
    epoch_date = dt_to_str(sunday)

    # ── Load from MongoDB ─────────────────────────────────────────────────────
    print("\n📦 Loading data from MongoDB...")

    resource_types = list(db.resourceTypes.find({}, {'_id': 0}))
    print(f"   ✅ resource_types:  {len(resource_types)} documents")

    travel_matrix_doc = db.travelMatrix.find_one(
        {'name': 'default'}, {'_id': 0, 'name': 0, 'createdAt': 0, 'updatedAt': 0}
    )
    if not travel_matrix_doc:
        raise ValueError("No travel_matrix document with name='default' found.")
    travel_matrix = travel_matrix_doc['matrix']
    print(f"   ✅ travel_matrix:   {len(travel_matrix)} locations")

    all_tasks = list(db.all_tasks.find({}, {'_id': 0}))
    print(f"   ✅ all_tasks:       {len(all_tasks)} documents")

    # ── Build resourceTypes with computed downtime timestamps ─────────────────
    computed_resources = []
    for rt in resource_types:
        computed_resources.append({
            "name":         rt["name"],
            "type":         rt["type"],
            "location":     rt["location"],
            "capabilities": rt["capabilities"],
            "downtimes": [
                {
                    "start_time": dt_to_str(offset_to_dt(sunday, dt["start_offset"])),
                    "end_time":   dt_to_str(offset_to_dt(sunday, dt["end_offset"])),
                    "duration":   dt["duration"],
                    "location":   dt["location"],
                }
                for dt in rt.get("downtimes", [])
            ]
        })

    # ── Build templates and orders from tasks ─────────────────────────────────
    templates = []
    orders    = []

    for task in all_tasks:
        recurrence = task["recurrence"]

        if recurrence == "weekly":
            start_dt = offset_to_dt(sunday, task["earlieststartdate"])
            due_dt   = offset_to_dt(sunday, task["duedate"])

        elif recurrence == "annually":
            start_dt = annual_offset_to_dt(year, task["earlieststartdate"])
            due_dt   = annual_offset_to_dt(year, task["duedate"])
            # Skip if this annual task doesn't fall in the requested week
            if not is_in_week(start_dt, sunday) and not is_in_week(due_dt, sunday):
                continue

        elif recurrence == "monthly":
            first_of_month = sunday.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            start_dt = offset_to_dt(first_of_month, task["earlieststartdate"])
            due_dt   = offset_to_dt(first_of_month, task["duedate"])

        else:
            print(f"   ⚠️  Unknown recurrence '{recurrence}' for task '{task['name']}' — skipping.")
            continue

        templates.append({
            "name": task["name"],
            "type": "meets",
            "requiredCapabilities": [],
            "subtasks": [
                {
                    "taskName":             task_name_to_snake(task["name"]),
                    "type":                 "executable",
                    "requiredCapabilities": task["requiredCapabilities"],
                    "duration":             task["duration"],
                    "start-location":       "@start-location",
                    "end-location":         "@end-location",
                    "task_type":            task["task_type"],
                }
            ]
        })

        orders.append({
            "name":              task["name"],
            "quantity":          1,
            "earlieststartdate": dt_to_str(start_dt),
            "duedate":           dt_to_str(due_dt),
            "start-location":    task["location"],
            "end-location":      task["location"],
            "tasks":             [task["name"]],
        })

    scenario = {
        "name": f"scenario_week_{epoch_date[:10]}",
        "request_data": {
            "parameters": {
                "epoch_date": epoch_date
            },
            "resourceTypes":     computed_resources,
            "templates":         templates,
            "orders":            orders,
            "order-constraints": []
        },
        "travel_matrix": travel_matrix,
        "created_at":    datetime.now(timezone.utc),
    }

    return scenario

# ── Upload ────────────────────────────────────────────────────────────────────

def upload_scenario(scenario: dict, db) -> bool:
    scenarios = db.scenarios
    name = scenario["name"]

    print(f"\n🔍 Checking if scenario '{name}' already exists...")
    existing = scenarios.find_one({'name': name})

    if existing:
        print(f"⚠️  Scenario '{name}' already exists!")
        response = input("   Do you want to replace it? (yes/no): ")
        if response.lower() != 'yes':
            print("❌ Upload cancelled.")
            return False
        scenarios.delete_one({'name': name})
        print("🗑️  Deleted existing scenario.")

    print(f"\n📤 Uploading scenario '{name}' to MongoDB...")
    try:
        result = scenarios.insert_one(scenario)
        print(f"✅ Scenario uploaded successfully!")
        print(f"   Scenario ID: {result.inserted_id}")
    except Exception as e:
        print(f"❌ Failed to upload: {e}")
        return False

    return True

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("Scenario Generator & Upload Tool")
    print("=" * 60)

    if len(sys.argv) < 2:
        print("Usage: python generate_scenario.py <date>  e.g. 2026-01-14")
        sys.exit(1)

    input_date = sys.argv[1]

    # Connect to MongoDB
    print("\n📡 Connecting to MongoDB Atlas...")
    try:
        client = MongoClient(MONGO_URI)
        db = client[DB_NAME]
        db.command('ping')
        print("✅ Connected to MongoDB!")
    except Exception as e:
        print(f"❌ Failed to connect to MongoDB: {e}")
        sys.exit(1)

    # Generate scenario
    try:
        scenario = generate_scenario(input_date, db)
    except Exception as e:
        print(f"❌ Failed to generate scenario: {e}")
        sys.exit(1)

    rd = scenario["request_data"]
    print(f"\n📋 Generated scenario: {scenario['name']}")
    print(f"   Epoch date:  {rd['parameters']['epoch_date']}")
    print(f"   Resources:   {len(rd['resourceTypes'])}")
    print(f"   Templates:   {len(rd['templates'])}")
    print(f"   Orders:      {len(rd['orders'])}")

    # Write local JSON for inspection before uploading
    output_file = f"scenario_{input_date}.json"
    with open(output_file, "w") as f:
        json.dump(scenario, f, indent=2, default=str)
    print(f"\n💾 Local copy saved to {output_file}")

    # Upload to MongoDB
    success = upload_scenario(scenario, db)

    # Summary
    print(f"\n📊 All scenarios in database:")
    for s in db.scenarios.find({}, {'_id': 0, 'name': 1, 'created_at': 1}):
        print(f"   - {s['name']} (created: {s.get('created_at', 'N/A')})")

    print("\n" + "=" * 60)
    print("✅ Done!" if success else "⚠️  Finished with warnings.")
    print("=" * 60)


if __name__ == '__main__':
    main()