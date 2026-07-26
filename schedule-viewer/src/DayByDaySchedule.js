import React, { useState, useRef, useEffect } from 'react';
import { includeTaskForDisplay } from './taskFilters';
import { buildDetailPopupTransportInfo, isPickupTask, isDropoffTask, isTravelTask } from './taskRelationshipHelpers';

const DAY_START_HOUR_UTC = 5;
const DAY_END_HOUR_UTC = 24;
const HOUR_HEIGHT_PX = 60;
const VISIBLE_HOURS = DAY_END_HOUR_UTC - DAY_START_HOUR_UTC + 1;
const SLOT_MINUTES = 15;

const CALENDAR_BLUE = '#3b82f6';
const TRAVEL_GRAY = 'rgba(148, 163, 184, 0.55)';
const DRAG_BLUE = 'rgba(59, 130, 246, 0.45)';
const DRAG_GRAY = 'rgba(148, 163, 184, 0.30)';

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
 * Snap a UTC minute value to the nearest 15-min slot,
 * clamped to [DAY_START_HOUR_UTC*60, (DAY_END_HOUR_UTC)*60].
 */
function snapToSlot(totalMinutes) {
  const snapped = Math.round(totalMinutes / SLOT_MINUTES) * SLOT_MINUTES;
  const min = DAY_START_HOUR_UTC * 60;
  const max = DAY_END_HOUR_UTC * 60;
  return Math.max(min, Math.min(max, snapped));
}

/** Return a new ISO string with the UTC time shifted by `deltaMinutes`. */
function shiftIso(iso, deltaMinutes) {
  const d = new Date(iso);
  d.setUTCMinutes(d.getUTCMinutes() + deltaMinutes);
  return d.toISOString();
}

/** Format UTC time as "3:00PM" */
function formatTimeFromIso(iso) {
  const d = new Date(iso);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${dh}:${String(m).padStart(2, '0')}${ampm}`;
}

/**
 * Given a list of all tasks for a day, find travel tasks that belong to this
 * presence event. "Belonging" = the travel block ends just before the event
 * starts (within 90 min) or starts right after it ends (return travel).
 * We also match by checking if the travel task's name/destination tokens
 * overlap the presence task's name tokens.
 */
function findAssociatedTravelGroups(presenceTask, allDayGroups) {
  const presStart = new Date(presenceTask.start_lb).getTime();
  const presEnd = new Date(presenceTask.end_lb).getTime();
  const WINDOW_MS = 90 * 60 * 1000;

  return allDayGroups.filter(item => {
    if (item.type !== 'travel-group') return false;
    const tStart = new Date(item.start_lb).getTime();
    const tEnd = new Date(item.end_lb).getTime();
    // Travel that arrives just before event (outbound)
    if (tEnd <= presStart && presStart - tEnd <= WINDOW_MS) return true;
    // Travel that departs just after event (return)
    if (tStart >= presEnd && tStart - presEnd <= WINDOW_MS) return true;
    return false;
  });
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

  const result = [];
  for (const p of presence) {
    result.push({ type: 'presence', task: p });
  }
  for (const g of groups) {
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

// ─── Draggable calendar block ─────────────────────────────────────────────────

/**
 * A wrapper that handles mousedown → drag → mouseup to compute a new snapped
 * start time, then calls onDragComplete(newStartIso) if the slot actually changed.
 *
 * Props:
 *   top, height         — px position on the timeline
 *   startIso, endIso    — current times
 *   minTopPx            — lower bound in px (block cannot start above this)
 *   maxTopPx            — upper bound in px (block cannot start below this)
 *   onDragComplete(newStartIso, newEndIso)
 *   children
 */
function DraggableBlock({
  top, height, startIso, endIso,
  minTopPx = 0, maxTopPx = Infinity,
  onDragComplete,
  style = {},
  className = '',
  children,
}) {
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const originalTop = useRef(0);
  const ghostRef = useRef(null);
  const containerRef = useRef(null);

  const pxToMinutes = (px) => (px / HOUR_HEIGHT_PX) * 60;
  const minutesToPx = (min) => (min / 60) * HOUR_HEIGHT_PX;

  const handleMouseDown = (e) => {
    // Only left-click; ignore clicks on buttons inside the block
    if (e.button !== 0) return;
    if (e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    e.stopPropagation();

    isDragging.current = true;
    dragStartY.current = e.clientY;
    originalTop.current = top;

    // Create ghost
    const ghost = document.createElement('div');
    ghost.style.cssText = `
      position: fixed;
      pointer-events: none;
      z-index: 9999;
      opacity: 0.6;
      background: #3b82f6;
      border-radius: 6px;
      width: ${containerRef.current?.offsetWidth ?? 80}px;
      height: ${height}px;
      top: ${e.clientY - height / 2}px;
      left: ${containerRef.current?.getBoundingClientRect().left ?? 0}px;
    `;
    document.body.appendChild(ghost);
    ghostRef.current = ghost;

    const onMouseMove = (me) => {
      if (!isDragging.current) return;
      const dy = me.clientY - dragStartY.current;
      const newTop = Math.max(minTopPx, Math.min(maxTopPx, originalTop.current + dy));
      ghost.style.top = `${me.clientY - height / 2}px`;
      // Snap indicator — update ghost label if you want
    };

    const onMouseUp = (me) => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      if (ghostRef.current) {
        document.body.removeChild(ghostRef.current);
        ghostRef.current = null;
      }

      const dy = me.clientY - dragStartY.current;
      const rawNewTop = originalTop.current + dy;
      const clampedTop = Math.max(minTopPx, Math.min(maxTopPx, rawNewTop));

      // Convert top px → UTC minutes from midnight
      const topFromDayStart = clampedTop; // px from DAY_START_HOUR_UTC
      const minutesFromDayStart = pxToMinutes(topFromDayStart);
      const rawUtcMinutes = DAY_START_HOUR_UTC * 60 + minutesFromDayStart;
      const snappedUtcMinutes = snapToSlot(rawUtcMinutes);

      // Duration in minutes (unchanged)
      const durationMs = new Date(endIso) - new Date(startIso);
      const durationMinutes = durationMs / (1000 * 60);

      // Build new ISO strings preserving date
      const base = new Date(startIso);
      base.setUTCHours(Math.floor(snappedUtcMinutes / 60));
      base.setUTCMinutes(snappedUtcMinutes % 60);
      base.setUTCSeconds(0);
      base.setUTCMilliseconds(0);
      const newStartIso = base.toISOString();
      const newEnd = new Date(base.getTime() + durationMs);
      const newEndIso = newEnd.toISOString();

      // Only fire if actually moved (more than half a slot)
      const originalUtcMinutes =
        new Date(startIso).getUTCHours() * 60 + new Date(startIso).getUTCMinutes();
      if (Math.abs(snappedUtcMinutes - originalUtcMinutes) >= SLOT_MINUTES / 2) {
        onDragComplete?.(newStartIso, newEndIso);
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        ...style,
        top: `${top}px`,
        height: `${height}px`,
        cursor: 'grab',
        userSelect: 'none',
      }}
      onMouseDown={handleMouseDown}
    >
      {children}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function DayByDaySchedule({ tasks, currentUser, onDeleteTask, onRescheduleTask }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [dateOffset, setDateOffset] = useState(0); // for daily view
  const [detailTask, setDetailTask] = useState(null);
  const [travelGroup, setTravelGroup] = useState(null);
  const [deleteCandidate, setDeleteCandidate] = useState(null);

  // Pending reschedule confirmation state
  const [pendingMove, setPendingMove] = useState(null);
  /*
    pendingMove = {
      type: 'presence' | 'travel-group',
      // presence:
      task,          // original task object
      newStart,      // new ISO string
      newEnd,
      // travel-group:
      travelItem,    // original travel-group item
      newTravelStart,
      newTravelEnd,
      // info for display:
      oldStartLabel,
      newStartLabel,
      dateLabel,
      affectedOthers,  // string | null
    }
  */

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
    const modalDayKey = new Date(detailTask.display_start || detailTask.start_lb).toISOString().split('T')[0];
    // Include overnight tasks (e.g. downtime that started the prior evening)
    const allTasksForDay = (tasks || []).filter((t) => {
      const start = t.display_start || t.start_lb;
      const end = t.display_end || t.end_lb;
      if (!start) return false;
      const startDay = new Date(start).toISOString().split('T')[0];
      const endDay = end ? new Date(end).toISOString().split('T')[0] : startDay;
      return startDay === modalDayKey || endDay === modalDayKey;
    });
    transportModal = buildDetailPopupTransportInfo(detailTask, currentUser, allTasksForDay, formatTime);
  }

  // ── Travel group modal data ──────────────────────────────────────────────
  let travelModal = null;
  if (travelGroup != null) {
    const anchorTask = travelGroup.tasks.find(
      (t) => (t.capability === 'travel') || normalizedTitle(t).startsWith('travel')
    ) ?? travelGroup.tasks[0];
    const modalDayKey = toLocalDateString(new Date(anchorTask.display_start || anchorTask.start_lb));
    // Include overnight tasks so downtime.location can resolve for DRIVING origin
    const allTasksForDay = (tasks || []).filter((t) => {
      const start = t.display_start || t.start_lb;
      const end = t.display_end || t.end_lb;
      if (!start) return false;
      const startDay = toLocalDateString(new Date(start));
      const endDay = end ? new Date(end).toISOString().split('T')[0] : startDay;
      return startDay === modalDayKey || endDay === modalDayKey;
    });
    travelModal = buildDetailPopupTransportInfo(
      anchorTask,
      currentUser,
      allTasksForDay,
      formatTime,
      travelGroup.tasks
    );
  }

  // ── Detect other people affected by a presence-event move ─────────────────
  /**
   * Returns a human-readable string if anyone else's tasks depend on this
   * presence event (i.e. there are transport/pickup/dropoff tasks for it
   * belonging to a different resource), or null if no one else is affected.
   */
  function detectAffectedOthers(presenceTask, allDayTasks) {
    const user = String(currentUser ?? '').toLowerCase();
    const affected = new Set();
    for (const t of allDayTasks) {
      const res = String(t?.resource ?? t?.resource_name ?? '').toLowerCase();
      if (res === user || !res) continue;
      // Check if this task is transport/pickup/dropoff and time-adjacent to the event
      const isTransit = isTravelOrTransitTask(t) ||
        String(t?.capability ?? '').toLowerCase().includes('transport');
      if (!isTransit) continue;
      const tStart = new Date(t.start_lb).getTime();
      const tEnd = new Date(t.end_lb).getTime();
      const pStart = new Date(presenceTask.start_lb).getTime();
      const pEnd = new Date(presenceTask.end_lb).getTime();
      const WINDOW = 90 * 60 * 1000;
      if (
        (tEnd <= pStart && pStart - tEnd <= WINDOW) ||
        (tStart >= pEnd && tStart - pEnd <= WINDOW)
      ) {
        affected.add(String(t?.resource ?? t?.resource_name ?? ''));
      }
    }
    if (affected.size === 0) return null;
    const names = [...affected].join(', ');
    return `Also affects: ${names}`;
  }

  // ── Drag handlers ──────────────────────────────────────────────────────────

  /**
   * Called when a PRESENCE event block is dropped at a new time.
   * Moves the event AND shifts all associated travel groups by the same delta.
   */
  function handlePresenceDragComplete(task, allDayGroups, allDayTasks, newStartIso, newEndIso) {
    const oldStart = formatTime(task.start_lb);
    const dateLabel = new Date(task.start_lb).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', timeZone: 'UTC'
    });
    const newStartLabel = formatTime(newStartIso);
    const affectedOthers = detectAffectedOthers(task, allDayTasks);

    // Find travel groups that travel to/from this event
    const linkedTravel = findAssociatedTravelGroups(task, allDayGroups);

    setPendingMove({
      type: 'presence',
      task,
      newStart: newStartIso,
      newEnd: newEndIso,
      linkedTravel,
      oldStartLabel: oldStart,
      newStartLabel,
      dateLabel,
      affectedOthers,
    });
  }

  /**
   * Called when a TRAVEL GROUP block is dropped at a new time.
   * Travel cannot go past or overlap its anchor event.
   */
  function handleTravelDragComplete(travelItem, allDayGroups, newStartIso, newEndIso) {
    const oldStart = formatTime(travelItem.start_lb);
    const dateLabel = new Date(travelItem.start_lb).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', timeZone: 'UTC'
    });
    const newStartLabel = formatTime(newStartIso);

    setPendingMove({
      type: 'travel-group',
      travelItem,
      newTravelStart: newStartIso,
      newTravelEnd: newEndIso,
      oldStartLabel: oldStart,
      newStartLabel,
      dateLabel,
      affectedOthers: null,
    });
  }

  /**
   * User confirmed the move in the modal — apply it.
   */
  function confirmMove() {
    if (!pendingMove) return;
    onRescheduleTask?.(pendingMove);
    setPendingMove(null);
  }

  // ── Bounds calculation for drag constraints ────────────────────────────────

  /**
   * For a travel group, compute maxTopPx so it cannot start after its anchor event.
   * We find the nearest presence event that starts after this travel group ends.
   */
  function travelMaxTopPx(travelItem, renderItems) {
    const tEnd = new Date(travelItem.end_lb).getTime();
    const tStart = new Date(travelItem.start_lb).getTime();
    const duration = tEnd - tStart;

    // Find presence events that start at or after travel ends (possible anchor)
    let anchorStart = null;
    for (const item of renderItems) {
      if (item.type !== 'presence') continue;
      const pStart = new Date(item.task.start_lb).getTime();
      if (pStart >= tEnd || (pStart > tStart && pStart <= tEnd + 90 * 60 * 1000)) {
        if (anchorStart === null || pStart < anchorStart) {
          anchorStart = pStart;
        }
      }
    }

    if (anchorStart === null) return (VISIBLE_HOURS - 1) * HOUR_HEIGHT_PX;

    // Travel start must stay before anchorStart — so travel end ≤ anchorStart
    // maxStartMs = anchorStart - duration
    const anchorStartMinutesFromDayStart =
      (anchorStart / 1000 / 60) - DAY_START_HOUR_UTC * 60;
    // anchorStart is absolute ms, convert to "minutes from UTC midnight"
    const anchorDate = new Date(anchorStart);
    const anchorUtcMinutes = anchorDate.getUTCHours() * 60 + anchorDate.getUTCMinutes();
    const maxStartUtcMinutes = anchorUtcMinutes - duration / (1000 * 60);
    const maxStartPx = ((maxStartUtcMinutes - DAY_START_HOUR_UTC * 60) / 60) * HOUR_HEIGHT_PX;
    return Math.max(0, maxStartPx);
  }

  return (
    <div className="calendar-view">

      {/* ── Reschedule confirmation modal ────────────────────────────────────── */}
      {pendingMove != null && (
        <div
          className="daybyday-modal-overlay"
          role="presentation"
          onClick={() => setPendingMove(null)}
        >
          <div
            className="daybyday-modal-panel daybyday-modal-panel--confirm"
            role="dialog"
            aria-modal="true"
            aria-label="Confirm reschedule"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="daybyday-modal-content">
              <h2 style={{ fontWeight: 700, marginTop: 0 }}>Move Event?</h2>
              <p style={{ marginBottom: 8 }}>
                {pendingMove.type === 'presence'
                  ? <>
                    Move <strong>{taskDisplayName(pendingMove.task) || 'this event'}</strong> from{' '}
                    <strong>{pendingMove.oldStartLabel}</strong> to{' '}
                    <strong>{pendingMove.newStartLabel}</strong> on {pendingMove.dateLabel}?
                    {pendingMove.linkedTravel.length > 0 && (
                      <span style={{ display: 'block', marginTop: 6, fontSize: 13, opacity: 0.8 }}>
                        {pendingMove.linkedTravel.length} associated travel block
                        {pendingMove.linkedTravel.length > 1 ? 's' : ''} will shift with it.
                      </span>
                    )}
                  </>
                  : <>
                    Move travel from <strong>{pendingMove.oldStartLabel}</strong> to{' '}
                    <strong>{pendingMove.newStartLabel}</strong> on {pendingMove.dateLabel}?
                    <span style={{ display: 'block', marginTop: 6, fontSize: 13, opacity: 0.8 }}>
                      The associated event time will not change.
                    </span>
                  </>
                }
              </p>
              {pendingMove.affectedOthers && (
                <p style={{
                  marginTop: 8, marginBottom: 16,
                  fontSize: 13, color: '#b45309',
                  background: '#fef3c7', borderRadius: 6, padding: '6px 10px'
                }}>
                  ⚠️ {pendingMove.affectedOthers}
                </p>
              )}
              <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
                <button
                  type="button"
                  className="daybyday-confirm-btn daybyday-confirm-btn--danger"
                  onClick={confirmMove}
                >
                  Yes, Move It
                </button>
                <button
                  type="button"
                  className="daybyday-confirm-btn daybyday-confirm-btn--cancel"
                  onClick={() => setPendingMove(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
              {/* Event times: prefer display_start / display_end for what the user sees */}
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
              <p><strong>START:</strong> {formatTime(travelGroup.display_start || travelGroup.start_lb)}</p>
              <p><strong>END:</strong> {formatTime(travelGroup.display_end || travelGroup.end_lb)}</p>

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
                      <DraggableBlock
                        key={`presence-${idx}-${task.start_lb}`}
                        className="calendar-task"
                        style={{ backgroundColor: CALENDAR_BLUE, position: 'absolute', left: 2, right: 2 }}
                        top={top}
                        height={height}
                        startIso={task.start_lb}
                        endIso={task.end_lb}
                        minTopPx={0}
                        maxTopPx={maxVisibleTop}
                        onDragComplete={(newStart, newEnd) =>
                          handlePresenceDragComplete(task, renderItems, dayTasks, newStart, newEnd)
                        }
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
                      </DraggableBlock>
                    );
                  }

                  if (item.type === 'travel-group') {
                    const top = getTimePosition(item.start_lb);
                    const height = getHeightFromTimes(item.start_lb, item.end_lb);
                    if (top < 0 || top > maxVisibleTop) return null;

                    const maxTop = travelMaxTopPx(item, renderItems);

                    return (
                      <DraggableBlock
                        key={`travel-${idx}-${item.start_lb}`}
                        className="calendar-task calendar-task--travel-group"
                        style={{ backgroundColor: TRAVEL_GRAY, position: 'absolute', left: 2, right: 2 }}
                        top={top}
                        height={height}
                        startIso={item.start_lb}
                        endIso={item.end_lb}
                        minTopPx={0}
                        maxTopPx={maxTop}
                        onDragComplete={(newStart, newEnd) =>
                          handleTravelDragComplete(item, renderItems, newStart, newEnd)
                        }
                      >
                        <button
                          type="button"
                          className="task-blue-detail-link task-blue-detail-link--travel-only"
                          onClick={(e) => { e.stopPropagation(); setTravelGroup(item); }}
                        >
                          Details
                        </button>
                      </DraggableBlock>
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