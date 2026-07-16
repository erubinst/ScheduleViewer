import React, { useState, useEffect } from 'react';
import { includeTaskForDisplay } from './taskFilters';
import { buildDetailPopupTransportInfo, isPickupTask, isDropoffTask, isTravelTask } from './taskRelationshipHelpers';

const DAY_START_HOUR_UTC = 5;
const DAY_END_HOUR_UTC = 24;
const HOUR_HEIGHT_PX = 60;
const VISIBLE_HOURS = DAY_END_HOUR_UTC - DAY_START_HOUR_UTC + 1;

const CALENDAR_BLUE = '#3b82f6';
const TRAVEL_GRAY = 'rgba(148, 163, 184, 0.55)';

function taskDisplayName(task) {
  const v = task.task_name ?? task.taskName ?? task.order;
  return v != null ? String(v).trim() : '';
}

const toLocalDateString = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

function normalizedTitle(task) {
  return taskDisplayName(task).toLowerCase().replace(/_/g, ' ');
}

function isTravelOrTransitTask(task) {
  const n = normalizedTitle(task);
  return (
    n.startsWith('travel') ||
    n.startsWith('pickup') ||
    n.startsWith('pick up') ||
    n.startsWith('dropoff') ||
    n.startsWith('drop off')
  );
}

function isPresenceTask(task) {
  const c = task?.capability;
  return typeof c === 'string' && c.includes('presence');
}

function getTaskColorFromTitle(task) {
  const n = normalizedTitle(task);
  if (n.startsWith('pickup') || n.startsWith('pick up') || n.startsWith('dropoff') || n.startsWith('drop off')) {
    return '#f59e0b';
  }
  if (n.startsWith('travel')) return TRAVEL_GRAY;
  return CALENDAR_BLUE;
}

function isBlueCalendarEvent(task) {
  return getTaskColorFromTitle(task) === CALENDAR_BLUE;
}

/**
 * Groups travel/pickup/dropoff tasks that belong to the same trip into a single
 * rendered bar. Two transit tasks are in the same group if they overlap or are
 * within 5 minutes of each other (pickup → travel chains are adjacent, not overlapping).
 *
 * Returns an array of either:
 *   { type: 'presence', task }
 *   { type: 'travel-group', tasks, start_lb, end_lb }
 */
function groupDayTasks(dayTasks) {
  // Separate presence (blue) from transit tasks
  const presence = [];
  const transit = [];

  for (const task of dayTasks) {
    if (isTravelOrTransitTask(task)) {
      transit.push(task);
    } else {
      presence.push(task);
    }
  }

  // Sort transit by display start time (fallback to start_lb)
  const sorted = [...transit].sort((a, b) => {
    const aStart = new Date(a.display_start || a.start_lb);
    const bStart = new Date(b.display_start || b.start_lb);
    return aStart - bStart;
  });

  // Cluster into groups where consecutive tasks are within 5 min of each other
  const GAP_MS = 5 * 60 * 1000;
  const groups = [];
  let current = null;

  for (const task of sorted) {
    const taskStart = new Date(task.display_start || task.start_lb).getTime();
    const taskEnd = new Date(task.display_end || task.end_lb).getTime();

    if (!current) {
      current = { tasks: [task], startMs: taskStart, endMs: taskEnd };
    } else {
      const gap = taskStart - current.endMs;
      if (gap <= GAP_MS) {
        current.tasks.push(task);
        current.endMs = Math.max(current.endMs, taskEnd);
      } else {
        groups.push(current);
        current = { tasks: [task], startMs: taskStart, endMs: taskEnd };
      }
    }
  }
  if (current) groups.push(current);

  // Build final render list: presence tasks + travel groups, each tagged with type
  const result = [];

  for (const p of presence) {
    result.push({ type: 'presence', task: p });
  }

  for (const g of groups) {
    // Reconstruct synthetic start/end ISO strings from the cluster boundaries
    const startTask = g.tasks.reduce((a, b) =>
      new Date(a.display_start || a.start_lb) < new Date(b.display_start || b.start_lb) ? a : b
    );
    const endTask = g.tasks.reduce((a, b) =>
      new Date(a.display_end || a.end_lb) > new Date(b.display_end || b.end_lb) ? a : b
    );
    result.push({
      type: 'travel-group',
      tasks: g.tasks,
      start_lb: startTask.display_start || startTask.start_lb,
      end_lb: endTask.display_end || endTask.end_lb,
    });
  }

  return result;
}

function DayByDaySchedule({ tasks, currentUser, onDeleteTask }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [dateOffset, setDateOffset] = useState(0); // for daily view
  const [detailTask, setDetailTask] = useState(null);
  const [travelGroup, setTravelGroup] = useState(null);   // for travel popup
  const [deleteCandidate, setDeleteCandidate] = useState(null); // for delete confirm

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Group tasks by date
  const tasksByDate = {};
  (tasks || []).filter(includeTaskForDisplay).forEach(task => {
    const startVal = task.display_start || task.start_lb;
    if (!startVal) return;
    const date = new Date(startVal);
    const dateStr = toLocalDateString(date);
    if (!tasksByDate[dateStr]) tasksByDate[dateStr] = [];
    tasksByDate[dateStr].push(task);
  });

  const allDates = Object.keys(tasksByDate).sort();

  if (allDates.length === 0) {
    return <div className="empty-schedule">No tasks scheduled</div>;
  }

  const getSunday = (offset) => {
    const now = new Date();
    now.setDate(now.getDate() + offset * 7);
    const dayOfWeek = now.getDay();
    const sunday = new Date(now.setDate(now.getDate() - dayOfWeek));
    sunday.setHours(0, 0, 0, 0);
    return sunday;
  };

  const startOfViewWeek = getSunday(weekOffset);
  const currentWeekDates = [];
  
  if (isMobile) {
    const d = new Date();
    d.setDate(d.getDate() + dateOffset);
    currentWeekDates.push(toLocalDateString(d));
  } else {
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfViewWeek);
      d.setDate(startOfViewWeek.getDate() + i);
      currentWeekDates.push(toLocalDateString(d));
    }
  }

  const formatWeekRange = (start) => {
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const startMonth = start.toLocaleDateString('en-US', { month: 'short' });
    const startDay = start.getDate();
    const endMonth = end.toLocaleDateString('en-US', { month: 'short' });
    const endDay = end.getDate();
    const startYear = start.getFullYear();
    const endYear = end.getFullYear();

    if (startMonth === endMonth && startYear === endYear) {
      return `${startMonth} ${startDay} to ${endDay}, ${startYear}`;
    } else if (startYear === endYear) {
      return `${startMonth} ${startDay} to ${endMonth} ${endDay}, ${startYear}`;
    } else {
      return `${startMonth} ${startDay}, ${startYear} to ${endMonth} ${endDay}, ${endYear}`;
    }
  };

  const formatDateHeader = (dateStr) => {
    const date = new Date(dateStr + 'T00:00:00Z');
    const dayName = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
    const dayNum = date.getUTCDate();
    return { dayName, dayNum };
  };

  const formatTime = (datetimeStr) => {
    const date = new Date(datetimeStr);
    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    const displayMinutes = minutes.toString().padStart(2, '0');
    return `${displayHour}:${displayMinutes}${ampm}`;
  };

  const getTimePosition = (datetimeStr) => {
    const date = new Date(datetimeStr);
    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    const totalMinutes = hours * 60 + minutes;
    const startMinutes = DAY_START_HOUR_UTC * 60;
    return ((totalMinutes - startMinutes) / 60) * HOUR_HEIGHT_PX;
  };

  const getHeightFromTimes = (start_lb, end_lb) => {
    const durationMinutes = (new Date(end_lb) - new Date(start_lb)) / (1000 * 60);
    return (durationMinutes / 60) * HOUR_HEIGHT_PX;
  };

  const renderTransportLines = (lines) => {
    if (!lines || (lines.length === 1 && lines[0] === 'N/A')) {
      return <p style={{ marginTop: 0 }}>N/A</p>;
    }
    return (
      <ul className="daybyday-modal-transport-list">
        {lines.map((line, i) => (
          <li key={`${i}-${line.slice(0, 40)}`}>{line}</li>
        ))}
      </ul>
    );
  };

  // ── Presence event modal data ──────────────────────────────────────────────
  let transportModal = null;
  if (detailTask != null) {
    const modalDayKey = toLocalDateString(new Date(detailTask.display_start || detailTask.start_lb));
    const allTasksForDay = (tasks || []).filter(
      (t) => {
        const tv = t.display_start || t.start_lb;
        return tv && toLocalDateString(new Date(tv)) === modalDayKey;
      }
    );
    transportModal = buildDetailPopupTransportInfo(detailTask, currentUser, allTasksForDay, formatTime);
  }

  // ── Travel group modal data ────────────────────────────────────────────────
  // Use the first travel task in the group as the "anchor" for transport info
  let travelModal = null;
  if (travelGroup != null) {
    const anchorTask = travelGroup.tasks.find(
      (t) => (t.capability === 'travel') || normalizedTitle(t).startsWith('travel')
    ) ?? travelGroup.tasks[0];
    const modalDayKey = toLocalDateString(new Date(anchorTask.display_start || anchorTask.start_lb));
    const allTasksForDay = (tasks || []).filter(
      (t) => {
        const tv = t.display_start || t.start_lb;
        return tv && toLocalDateString(new Date(tv)) === modalDayKey;
      }
    );
    // Scope to this gray bar’s segments only so DRIVING / pickup / dropoff times aren’t mixed with other trips
    travelModal = buildDetailPopupTransportInfo(
      anchorTask,
      currentUser,
      allTasksForDay,
      formatTime,
      travelGroup.tasks
    );
  }

  return (
    <div className="calendar-view">

      {/* ── Presence event detail modal ───────────────────────────────────── */}
      {detailTask != null && (
        <div
          className="daybyday-modal-overlay"
          role="presentation"
          onClick={() => setDetailTask(null)}
        >
          <div
            className="daybyday-modal-panel daybyday-modal-panel--empty"
            role="dialog"
            aria-modal="true"
            aria-label="Event details"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="daybyday-modal-close"
              aria-label="Close"
              onClick={() => setDetailTask(null)}
            >
              x
            </button>
            <div className="daybyday-modal-content">
              <h1 style={{ fontWeight: 700, marginTop: 0 }}>
                {taskDisplayName(detailTask) || '—'}
              </h1>
              <p><strong>LOCATION:</strong> {detailTask.location ?? '—'}</p>
              <p><strong>START:</strong> {formatTime(detailTask.start_lb)}</p>
              <p><strong>START:</strong> {formatTime(detailTask.display_start || detailTask.start_lb)}</p>
              <p><strong>END:</strong> {formatTime(detailTask.display_end || detailTask.end_lb)}</p>

              {transportModal && (
                <p style={{ marginTop: 12, fontSize: 14, opacity: 0.9 }}>
                  {transportModal.summaryLine}
                </p>
              )}

              <hr />

              {transportModal && (
                <>
                  <p style={{ marginBottom: 4 }}><strong>DRIVING:</strong></p>
                  {renderTransportLines(transportModal.drivingLines)}
                  <p style={{ marginBottom: 4, marginTop: 12 }}><strong>PICKING UP:</strong></p>
                  {renderTransportLines(transportModal.pickingUpLines)}
                  <p style={{ marginBottom: 4, marginTop: 12 }}><strong>PICKED UP BY:</strong></p>
                  {renderTransportLines(transportModal.pickedUpByLines)}
                  <p style={{ marginBottom: 4, marginTop: 12 }}><strong>DROPPED OFF BY:</strong></p>
                  {renderTransportLines(transportModal.droppedOffByLines)}
                  <p style={{ marginBottom: 4, marginTop: 12 }}><strong>DROPPING OFF:</strong></p>
                  {renderTransportLines(transportModal.droppingOffLines)}
                </>
              )}

              {/* Delete button — presence events only */}
              <hr style={{ marginTop: 16 }} />
              <button
                type="button"
                className="daybyday-modal-delete-btn"
                onClick={() => {
                  setDetailTask(null);
                  setDeleteCandidate(detailTask);
                }}
              >
                🗑 Delete Event
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Travel group detail modal ─────────────────────────────────────── */}
      {travelGroup != null && (
        <div
          className="daybyday-modal-overlay"
          role="presentation"
          onClick={() => setTravelGroup(null)}
        >
          <div
            className="daybyday-modal-panel daybyday-modal-panel--travel"
            role="dialog"
            aria-modal="true"
            aria-label="Travel details"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="daybyday-modal-close"
              aria-label="Close"
              onClick={() => setTravelGroup(null)}
            >
              x
            </button>
            <div className="daybyday-modal-content">
              <h1 style={{ fontWeight: 700, marginTop: 0 }}>Travel</h1>
              <p><strong>START:</strong> {formatTime(travelGroup.start_lb)}</p>
              <p><strong>END:</strong> {formatTime(travelGroup.end_lb)}</p>

              <hr />

              {travelModal && (
                <>
                  <p style={{ marginBottom: 4 }}><strong>DRIVING:</strong></p>
                  {renderTransportLines(travelModal.drivingLines)}
                  <p style={{ marginBottom: 4, marginTop: 12 }}><strong>PICKING UP:</strong></p>
                  {renderTransportLines(travelModal.pickingUpLines)}
                  <p style={{ marginBottom: 4, marginTop: 12 }}><strong>DROPPING OFF:</strong></p>
                  {renderTransportLines(travelModal.droppingOffLines)}
                </>
              )}

              {/* Segments list — shows individual tasks inside the group */}
              <hr style={{ marginTop: 16 }} />
              <p style={{ marginBottom: 4 }}><strong>SEGMENTS:</strong></p>
              <ul className="daybyday-modal-transport-list">
                {travelGroup.tasks.map((t, i) => (
                  <li key={i}>
                    {formatTime(t.display_start || t.start_lb)} – {formatTime(t.display_end || t.end_lb)}{' '}
                    <span style={{ opacity: 0.6, fontSize: 12 }}>
                      {taskDisplayName(t)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirmation modal ─────────────────────────────────────── */}
      {deleteCandidate != null && (
        <div
          className="daybyday-modal-overlay"
          role="presentation"
          onClick={() => setDeleteCandidate(null)}
        >
          <div
            className="daybyday-modal-panel daybyday-modal-panel--confirm"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm delete"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="daybyday-modal-content">
              <h2 style={{ fontWeight: 700, marginTop: 0 }}>Delete Event?</h2>
              <p style={{ marginBottom: 24 }}>
                Are you sure you want to delete{' '}
                <strong>{taskDisplayName(deleteCandidate) || 'this event'}</strong>?
                This cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  type="button"
                  className="daybyday-confirm-btn daybyday-confirm-btn--danger"
                  onClick={() => {
                    onDeleteTask?.(deleteCandidate);
                    setDeleteCandidate(null);
                  }}
                >
                  Yes, Delete
                </button>
                <button
                  type="button"
                  className="daybyday-confirm-btn daybyday-confirm-btn--cancel"
                  onClick={() => setDeleteCandidate(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Week navigation ───────────────────────────────────────────────── */}
      <div className="week-navigation">
        <button className="week-nav-btn" onClick={() => isMobile ? setDateOffset(dateOffset - 1) : setWeekOffset(weekOffset - 1)}>
          {isMobile ? '←' : '← Previous Week'}
        </button>
        <span className="week-indicator">
          {isMobile ? (() => {
            const d = new Date();
            d.setDate(d.getDate() + dateOffset);
            return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          })() : formatWeekRange(startOfViewWeek)}
        </span>
        <button className="week-nav-btn" onClick={() => isMobile ? setDateOffset(dateOffset + 1) : setWeekOffset(weekOffset + 1)}>
          {isMobile ? '→' : 'Next Week →'}
        </button>
      </div>

      {/* ── Calendar grid ─────────────────────────────────────────────────── */}
      <div className="calendar-grid">
        {/* Time labels */}
        <div className="time-column">
          <div className="time-header"></div>
          {[...Array(VISIBLE_HOURS)].map((_, i) => {
            const hour = (i + DAY_START_HOUR_UTC) % 24;
            const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
            const ampm = hour >= 12 ? 'PM' : 'AM';
            return (
              <div key={i} className="time-label" style={{ height: `${HOUR_HEIGHT_PX}px` }}>
                {displayHour}{ampm}
              </div>
            );
          })}
        </div>

        {/* Day columns */}
        {currentWeekDates.map(dateStr => {
          const { dayName, dayNum } = formatDateHeader(dateStr);
          const dayTasks = tasksByDate[dateStr] || [];
          const maxVisibleTop = (VISIBLE_HOURS - 1) * HOUR_HEIGHT_PX;

          // Group travel/pickup/dropoff into clusters; keep presence tasks separate
          const renderItems = groupDayTasks(dayTasks);

          return (
            <div key={dateStr} className="day-column">
              <div className="day-header">
                <div className="day-name">{dayName}</div>
                <div className={`day-number ${dateStr === todayStr ? 'today-highlight' : ''}`}>
                  {dayNum}
                </div>
              </div>

              <div className="day-timeline" style={{ height: `${VISIBLE_HOURS * HOUR_HEIGHT_PX}px` }}>
                {/* Hour grid lines */}
                {[...Array(VISIBLE_HOURS)].map((_, i) => (
                  <div key={i} className="hour-line" style={{ top: `${i * HOUR_HEIGHT_PX}px` }} />
                ))}

                {/* Render items */}
                {renderItems.map((item, idx) => {
                  if (item.type === 'presence') {
                    const { task } = item;
                    const startVal = task.display_start || task.start_lb;
                    const endVal = task.display_end || task.end_lb;
                    if (!startVal || !endVal) return null;
                    const top = getTimePosition(startVal);
                    const height = getHeightFromTimes(startVal, endVal);
                    if (top < 0 || top > maxVisibleTop) return null;

                    return (
                      <div
                        key={`presence-${idx}-${startVal}`}
                        className="calendar-task"
                        style={{ top: `${top}px`, height: `${height}px`, backgroundColor: CALENDAR_BLUE }}
                      >
                        <div className="task-time-small">{formatTime(startVal)}</div>
                        <div className="task-name-small">{taskDisplayName(task) || '—'}</div>
                        {task.location && (
                          <div className="task-location-small">📍 {task.location}</div>
                        )}
                        <button
                          type="button"
                          className="task-blue-detail-link"
                          onClick={(e) => { e.stopPropagation(); setDetailTask(task); }}
                        >
                          Details
                        </button>
                      </div>
                    );
                  }

                  if (item.type === 'travel-group') {
                    const top = getTimePosition(item.start_lb);
                    const height = getHeightFromTimes(item.start_lb, item.end_lb);
                    if (top < 0 || top > maxVisibleTop) return null;

                    return (
                      <div
                        key={`travel-${idx}-${item.start_lb}`}
                        className="calendar-task calendar-task--travel-group"
                        style={{ top: `${top}px`, height: `${height}px`, backgroundColor: TRAVEL_GRAY }}
                      >
                        <button
                          type="button"
                          className="task-blue-detail-link task-blue-detail-link--travel-only"
                          onClick={(e) => { e.stopPropagation(); setTravelGroup(item); }}
                        >
                          Details
                        </button>
                      </div>
                    );
                  }

                  return null;
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