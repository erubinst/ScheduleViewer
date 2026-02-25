# backend processing for adding a task to the schedule, eventually integrated with frontend.

# Steps:
# 1. Given a scenario name, retrieve the task_schedule from the mongodb.
# 2. Use an arbitrary example for add task, eventually will be replaced by the frontend input.
# 3. Call the tds function to add a task to the schedule.

from initialize_schedule.run_initial_schedule import get_scenario
from pymongo import MongoClient
from tds.executer import add_task
import pandas as pd

MONGO_URI = 'mongodb+srv://erubinst:dbUserPassword@scheduleviewer.3la41u6.mongodb.net/task_scheduler?retryWrites=true&w=majority&appName=ScheduleViewer'

def retrieve_current_schedule(scenario_name):
    """Retrieve the current task schedule for a given scenario from MongoDB
    
    Returns a DataFrame with all tasks from all resources for the given scenario.
    Each row represents one task with columns:
    resource, task_name, start_lb, start_ub, end_lb, end_ub, capability, location, etc.
    """
    try:
        client = MongoClient(MONGO_URI)
        db = client.task_scheduler
        resource_schedulers = db.resource_schedules
        
        # Find ALL documents with the given scenario_name
        # Each document represents one resource's schedule
        schedule_cursor = resource_schedulers.find({'scenario_name': scenario_name})
        
        # Convert cursor to list of documents
        schedule_list = list(schedule_cursor)
        
        # Flatten all tasks into a single list
        all_tasks = []
        for resource_doc in schedule_list:
            for task in resource_doc.get('tasks', []):
                all_tasks.append(task)
        
        # Convert to DataFrame
        df = pd.DataFrame(all_tasks)
        # rename resource to resource_name and task_name to order
        df.rename(columns={'resource': 'resource_name', 'task_name': 'order'}, inplace=True)
        # filter out any with order containing "travel" since those are not real tasks
        df = df[df['order'].str.contains('travel', na=False) == False]
        # go through each resource and remove any tasks that are {resource_name}_header or {resource_name}_footer since those are not real tasks either
        # cannot use contains must be exact match
        for resource_doc in schedule_list:
            resource_name = resource_doc['resource_name']
            df = df[df['order'] != f"{resource_name}_header"]
            df = df[df['order'] != f"{resource_name}_footer"]
        return df

    except Exception as e:
        print(f"❌ Error retrieving schedule: {str(e)}")
        return None
    finally:
        if 'client' in locals():
            client.close()


def retrieve_scenario(scenario_name):
    # format dict to (request, travel_matrix, epoch_date)
    scenario = get_scenario(scenario_name)
    if not scenario:
        raise ValueError(f"Scenario '{scenario_name}' not found")
    return (
        scenario['request_data'],
        scenario.get('travel_matrix', None),
        scenario['request_data'].get('parameters', {}).get('epoch_date')
    )


current_schedule = retrieve_current_schedule('p3_w3_scenario')
scenario_data = retrieve_scenario('p3_w3_scenario')
# Example new task to add (replace with frontend input eventually) assume task is df in format  ['task_name', 'required_capabilities', 'est', 'lft', 'duration']
new_task = pd.DataFrame([{
    'task_name': 'new_task_1',
    'required_capabilities': ['goosedaughter_presence'],
    'est': 346080,
    'lft': 350000,
    'duration': 2,
    'locations': ['Vintage', 'Vintage'],
    'task_type': 'social',
}])
# Call the add_task function from tds.executer
updated_schedule = add_task(new_task, scenario_data, current_schedule)
