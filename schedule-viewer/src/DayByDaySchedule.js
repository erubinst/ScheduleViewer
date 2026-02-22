import React, { useState } from 'react';

function DayByDaySchedule({ tasks }) {
  const [weekOffset, setWeekOffset] = useState(0);
  
  // finds the date --> just highlighting the current date
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Group tasks by date
  const tasksByDate = {};
  
  tasks.forEach(task => {
    // Parse the start_lb date (ISO format: "2026-01-14T08:01:00.000+00:00" or GMT format)
    const date = new Date(task.start_lb);
    const dateStr = date.toISOString().split('T')[0]; // Get "2026-01-14"
    
    if (!tasksByDate[dateStr]) {
      tasksByDate[dateStr] = [];
    }
    
    tasksByDate[dateStr].push(task);
  });
  
  // Sort dates and get all unique dates
  const allDates = Object.keys(tasksByDate).sort();
  
  if (allDates.length === 0) {
    return <div className="empty-schedule">No tasks scheduled</div>;
  }
  
  // Calculate weeks
  const daysPerWeek = 7;
  const totalWeeks = Math.ceil(allDates.length / daysPerWeek);
  const startIdx = weekOffset * daysPerWeek;
  const endIdx = Math.min(startIdx + daysPerWeek, allDates.length);


  // only built using dates from task that exist, so if no task exists for a date
  // then no date exists in calendar
  
  // const currentWeekDates = allDates.slice(startIdx, endIdx);

  const getSunday = (offset) => {
    const now = new Date();
    // want to change now to previous or next beginning of the week dpeending on input
    now.setDate(now.getDate() + (offset * 7));
    const dayOfWeek = now.getDay();
    const diff = now.getDate() - dayOfWeek;

    const sunday = new Date(now.setDate(diff));
    sunday.setHours(0,0,0,0);
    return sunday;
  };

  const startOfViewWeek = getSunday(weekOffset);

  const currentWeekDates = [];
  for (let i = 0; i < 7; i++) {
    const nextDay = new Date(startOfViewWeek);
    nextDay.setDate(startOfViewWeek.getDate() + i);

    const dateStr = nextDay.toISOString().split('T')[0];
    currentWeekDates.push(dateStr);
  }

  
  // Format date for column header
  const formatDateHeader = (dateStr) => {
    const date = new Date(dateStr + 'T00:00:00Z');
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    const dayNum = date.getUTCDate();
    return { dayName, dayNum };
  };
  
  // Format time for display
  const formatTime = (datetimeStr) => {
    const date = new Date(datetimeStr);
    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    const displayMinutes = minutes.toString().padStart(2, '0');
    return `${displayHour}:${displayMinutes}${ampm}`;
  };
  

  // removing pickup/dropoff differentiation in schedule view
  // const mergedTasks = tasks.reduce((acc, currentTask) =>
  // {
  //   const name = currentTask.task_name.toLowerCase();
  //   if (name.includes('pickup') || name.includes('dropoff')) {
  //     // finding travel task closest in time to pickup/dropoff
  //     const travelTask = acc.find(t =>
  //       t.task_name.toLowerCase().includes('travel') && 
  //       Math.abs(new Date(t.start_lb) - new Date(currentTask.start_lb)) < 3600000
  //       );
  //     if (travelTask) {
  //       travelTask.rideDetails = (travelTask.rideDetails ? travelTask.rideDetails + ", " : "") + currentTask.task_name;
  //       return acc;
  //     }
  //   }
  //   acc.push(currentTask);
  //   return acc;
  // }, []);


  // Get task color based on task name
  const getTaskColor = (taskName) => {
    // gray one
    if (taskName.includes('travel')) return '#94a3b8';
    // yellow one
    if (taskName.includes('pickup') || taskName.includes('dropoff')) return '#f59e0b';
    
    
    //default blue
    return '#3b82f6'; 
  };
  
  // Calculate position based on time (8am = 0, midnight = 16 hours)
  const getTimePosition = (datetimeStr) => {
    const date = new Date(datetimeStr);
    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const totalMinutes = (hours * 60) + minutes;
    const startMinutes = 8 * 60; // 8am
    const minutesFromStart = totalMinutes - startMinutes;
    // Each hour = 60px
    return (minutesFromStart / 60) * 60;
  };
  
  // Calculate height based on duration
  const getTaskHeight = (task) => {
    const start = new Date(task.start_lb);
    const end = new Date(task.end_lb);
    const durationMinutes = (end - start) / (1000 * 60);
    return (durationMinutes / 60) * 60; // 60px per hour
  };
  
  return (
    // navigating different weeks in the calendar
    <div className="calendar-view">
      {/* Week navigation */}
      
        <div className="week-navigation">
          <button 
            className="week-nav-btn"
            onClick={() => setWeekOffset(weekOffset - 1)}
            // disabled={weekOffset === 0}
          >
            ← Previous Week
          </button>
          <span className="week-indicator">
            {/* Week {weekOffset + 1} of {totalWeeks} */}
            {startOfViewWeek.toLocaleDateString('en-US', { 
              month: 'long', 
              year: 'numeric' 
            })}
          </span>
          <button 
            className="week-nav-btn"
            onClick={() => setWeekOffset(weekOffset + 1)}
            // disabled={weekOffset >= totalWeeks - 1}
          >
            Next Week →
          </button>
        </div>

      
      {/* Calendar grid */}
      <div className="calendar-grid">
        {/* Time labels column */}
        <div className="time-column">
          <div className="time-header"></div>
          {[...Array(17)].map((_, i) => {
            const hour = i + 8;
            const displayHour = hour > 12 ? hour - 12 : hour;
            const ampm = hour >= 12 ? 'PM' : 'AM';
            return (
              <div key={i} className="time-label" style={{ height: '60px' }}>
                {displayHour}{ampm}
              </div>
            );
          })}
        </div>
        
        {/* Day columns */}
        {currentWeekDates.map(dateStr => {
          const { dayName, dayNum } = formatDateHeader(dateStr);
          const dayTasks = tasksByDate[dateStr] || [];
          
          return (
            <div key={dateStr} className="day-column">
              <div className="day-header">
                <div className="day-name">{dayName}</div>
                {/* <div className="day-number">{dayNum}</div> */}
                <div className={`day-number ${dateStr === todayStr ? 'today-highlight' : ''}`}>
                  {dayNum}</div>
              </div>
              
              <div className="day-timeline">
                {/* Hour grid lines */}
                {[...Array(17)].map((_, i) => (
                  <div key={i} className="hour-line" style={{ top: `${i * 60}px` }}></div>
                ))}
                
                {/* Tasks */}
                {dayTasks.map((task, idx) => {
                  const top = getTimePosition(task.start_lb);
                  const height = getTaskHeight(task);
                  const color = getTaskColor(task.task_name);
                  
                  // Skip if position is negative (before 8am) or too large
                  if (top < 0 || top > 1000) return null;
                  
                  return (
                    <div
                      key={idx}
                      className="calendar-task"
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        backgroundColor: color
                      }}
                    >
                      <div className="task-time-small">{formatTime(task.start_lb)}</div>
                      <div className="task-name-small">{task.task_name}</div>
                      {task.location && <div className="task-location-small">📍 {task.location}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default DayByDaySchedule;