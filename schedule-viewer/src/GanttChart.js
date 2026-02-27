import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList } from 'recharts';
// buildin gantt chart using stacked bar charts

const HOUR_0 = 5;
// Minimum bar width (px) before we show the task name on the bar; set to 0 to always show
const MIN_BAR_WIDTH_PX = 50;
const MIDNIGHT_OFFSET = 19; // 8am → midnight (hours from 8am)
const SEG_PREFIX = 'seg';

// Same event-type differentiation as DayByDaySchedule (travel = gray, pickup/dropoff = yellow, else blue)
function getTaskColor(taskName) {
  if (!taskName) return '#1e3a8a';
  const name = String(taskName).toLowerCase();
  if (name.includes('travel')) return '#94a3b8';
  if (name.includes('pickup') || name.includes('dropoff')) return '#f59e0b';
  return '#1e3a8a';
}

function normalizeTask(task, defaultPerson) { //standardizing a task
  let start;
  let duration;

  if (task.start_lb != null && task.end_lb != null) {
    const startDate = new Date(task.start_lb);
    const endDate = new Date(task.end_lb);
    const startHours = startDate.getUTCHours() + startDate.getUTCMinutes() / 60;
    const endHours = endDate.getUTCHours() + endDate.getUTCMinutes() / 60;
    start = startHours - HOUR_0;
    duration = endHours - startHours;
  } else {
    start = Number(task.start) || 0;
    duration = Number(task.duration) || 0;
  }

  start = Math.max(0, Math.min(start, MIDNIGHT_OFFSET));
  duration = Math.max(0, Math.min(duration, MIDNIGHT_OFFSET - start));

  return {
    person: task.person || task.resource_name || defaultPerson || 'Me',
    taskName: task.task_name || task.taskName,
    start,
    duration,
    color: task.color || getTaskColor(task.task_name || task.taskName)
  };
}

// Format decimal hours (0–16) as "HH:MM" (5:00–24:00)
function formatTime(hoursFrom8am) {
  const totalMins = Math.round(hoursFrom8am * 60);
  const h = HOUR_0 + Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h >= 24) return '24:00';
  return `${h}:${String(m).padStart(2, '0')}`;
}

// Format duration in hours as "1h 30m"
function formatDuration(hours) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// Renders the task name on the bar (always visible, no hover). Used as LabelList content.
function renderBarLabel(segmentIndex, minWidthPx) {
  return function BarLabelContent(props) {
    const { value, payload, viewBox } = props;
    const x = props.x ?? viewBox?.x ?? 0;
    const y = props.y ?? viewBox?.y ?? 0;
    const width = props.width ?? viewBox?.width ?? 0;
    const height = props.height ?? viewBox?.height ?? 0;
    if (!payload || value == null || value <= 0) return null;
    const isGap = payload[`${SEG_PREFIX}${segmentIndex}_isGap`];
    const name = payload[`${SEG_PREFIX}${segmentIndex}_name`];
    if (isGap || !name) return null;
    const barWidthPx = typeof width === 'number' && width > 0 ? width : 80;
    if (barWidthPx < minWidthPx) return null;
    const approxCharWidth = 7;
    const maxChars = Math.max(2, Math.floor((barWidthPx - 12) / approxCharWidth));
    const displayName = name.length <= maxChars ? name : name.slice(0, maxChars - 1) + '…';
    return (
      <text
        x={x + 6}
        y={y + height / 2}
        dy={4}
        fill="white"
        fontSize={12}
        fontWeight={500}
        style={{ pointerEvents: 'none' }}
      >
        {displayName}
      </text>
    );
  };
}

function GanttChart({ tasks, defaultPerson, dateLabel, resourceOrder }) {
  if (!tasks || tasks.length === 0) {
    return (
      <div className="gantt-chart-container" style={{ padding: 20 }}>
        <p>No tasks to display.</p>
      </div>
    );
  }

  const normalized = tasks.map(t => normalizeTask(t, defaultPerson));
  const peopleFromData = [...new Set(normalized.map(t => t.person))];
  const people =
    resourceOrder && resourceOrder.length > 0
      ? resourceOrder
      : peopleFromData;

  // Build segment-based data so bars appear at correct times (gap + task, gap + task, ...)
  let maxSegments = 0;
  const chartData = people.map(person => {
    const personTasks = normalized
      .filter(t => t.person === person)
      .sort((a, b) => a.start - b.start);

    const segments = [];
    let end = 0;

    personTasks.forEach(task => {
      const gap = Math.max(0, task.start - end);
      if (gap > 0.001) {
        segments.push({
          len: gap,
          isGap: true,
          name: null,
          start: null,
          duration: null,
          color: 'transparent'
        });
      }
      segments.push({
        len: task.duration,
        isGap: false,
        name: task.taskName,
        start: task.start,
        duration: task.duration,
        color: task.color
      });
      end = task.start + task.duration;
    });

    if (segments.length > maxSegments) maxSegments = segments.length;

    const row = { person };
    segments.forEach((seg, i) => {
      row[`${SEG_PREFIX}${i}_len`] = seg.len;
      row[`${SEG_PREFIX}${i}_isGap`] = seg.isGap;
      row[`${SEG_PREFIX}${i}_name`] = seg.name;
      row[`${SEG_PREFIX}${i}_start`] = seg.start;
      row[`${SEG_PREFIX}${i}_duration`] = seg.duration;
      row[`${SEG_PREFIX}${i}_color`] = seg.color;
    });
    return row;
  });

  // Pad rows so every row has the same number of segment keys
  chartData.forEach(row => {
    for (let i = 0; i < maxSegments; i++) {
      if (row[`${SEG_PREFIX}${i}_len`] == null) {
        row[`${SEG_PREFIX}${i}_len`] = 0;
        row[`${SEG_PREFIX}${i}_isGap`] = true;
        row[`${SEG_PREFIX}${i}_color`] = 'transparent';
      }
    }
  });

  const maxTime = MIDNIGHT_OFFSET;
  const displayDate =
    dateLabel ||
    (tasks[0]?.start_lb
      ? new Date(tasks[0].start_lb).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric'
        })
      : null);

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const data = payload[0].payload;
    const match = payload[0].dataKey.match(new RegExp(`${SEG_PREFIX}(\\d+)_len`));
    const segIndex = match ? match[1] : null;
    if (segIndex == null) return null;
    const isGap = data[`${SEG_PREFIX}${segIndex}_isGap`];
    if (isGap) return null;

    const taskName = data[`${SEG_PREFIX}${segIndex}_name`];
    const start = data[`${SEG_PREFIX}${segIndex}_start`];
    const duration = data[`${SEG_PREFIX}${segIndex}_duration`];
    if (start == null || duration == null) return null;

    const startStr = formatTime(start);
    const endStr = formatTime(start + duration);
    const durationStr = formatDuration(duration);

    return (
      <div
        style={{
          background: 'white',
          padding: 16,
          border: '2px solid #ccc',
          borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        }}
      >
        <p style={{ fontWeight: 'bold', fontSize: 18, marginBottom: 8 }}>{taskName}</p>
        <p style={{ fontSize: 16 }}>Person: {data.person}</p>
        <p style={{ fontSize: 16 }}>Time: {startStr} – {endStr}</p>
        <p style={{ fontSize: 16 }}>Duration: {durationStr}</p>
      </div>
    );
  };

  return (
    <div className="gantt-chart-container">
      {displayDate && (
        <p className="gantt-chart-date" style={{ marginBottom: 8, fontSize: 16, color: '#64748b' }}>
          {displayDate}
        </p>
      )}
      <BarChart
        width={800}
        height={400}
        data={chartData}
        layout="vertical"
        margin={{ top: 20, right: 30, left: 100, bottom: 20 }}
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          type="number"
          domain={[0, maxTime]}
          ticks={Array.from(
            { length: Math.floor(MIDNIGHT_OFFSET / 2) + 1 },
            (_, i) => i * 2
          )}
          tickFormatter={value => (value === 16 ? '24:00' : `${HOUR_0 + value}:00`)}
          label={{ value: 'Time', position: 'insideBottom', offset: -10, style: { fontSize: 16 } }}
          style={{ fontSize: 14 }}
        />
        <YAxis
          type="category"
          dataKey="person"
          width={90}
          style={{ fontSize: 16 }}
        />
        <Tooltip content={<CustomTooltip />} />
        {Array.from({ length: maxSegments }).map((_, i) => (
          <Bar key={i} dataKey={`${SEG_PREFIX}${i}_len`} stackId="a" isAnimationActive={false}>
            <LabelList
              dataKey={`${SEG_PREFIX}${i}_len`}
              content={props => renderBarLabel(i, MIN_BAR_WIDTH_PX)({ ...props, payload: chartData[props.index] })}
              position="insideLeft"
            />
            {chartData.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry[`${SEG_PREFIX}${i}_isGap`] ? 'transparent' : (entry[`${SEG_PREFIX}${i}_color`] || '#1e3a8a')}
                stroke={entry[`${SEG_PREFIX}${i}_isGap`] ? 'none' : undefined}
              />
            ))}
          </Bar>
        ))}
      </BarChart>
    </div>
  );
}

export default GanttChart;
