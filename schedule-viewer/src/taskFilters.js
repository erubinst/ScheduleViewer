export function includeTaskForDisplay(task) {
    const name = String(task.task_name || task.taskName || '').toLowerCase();
    if (!name.includes('downtime')) return true;
    return (
      name.includes('travel') ||
      name.includes('pickup') ||
      name.includes('dropoff')
    );
  }