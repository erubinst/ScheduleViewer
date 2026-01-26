import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts';

function GanttChart({ tasks }) {
  // Group tasks by person
  const people = [...new Set(tasks.map(t => t.person))];
  
  // Prepare data for the chart
  const chartData = people.map(person => {
    const personTasks = tasks.filter(t => t.person === person);
    const row = { person };
    
    personTasks.forEach((task, index) => {
      row[`task${index}_start`] = task.start;
      row[`task${index}_duration`] = task.duration;
      row[`task${index}_name`] = task.taskName;
      row[`task${index}_color`] = task.color;
    });
    
    return row;
  });

  const maxTime = 16; // 8 AM to 12 AM (16 hours)

  // Custom tooltip
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const taskIndex = payload[0].dataKey.match(/task(\d+)_duration/)?.[1];
      
      if (taskIndex !== undefined) {
        const taskName = data[`task${taskIndex}_name`];
        const start = data[`task${taskIndex}_start`];
        const duration = data[`task${taskIndex}_duration`];
        const startTime = 8 + start;
        const endTime = startTime + duration;
        
        return (
          <div style={{
            background: 'white',
            padding: '16px',
            border: '2px solid #ccc',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
          }}>
            <p style={{ fontWeight: 'bold', fontSize: '18px', marginBottom: '8px' }}>{taskName}</p>
            <p style={{ fontSize: '16px' }}>Person: {data.person}</p>
            <p style={{ fontSize: '16px' }}>Time: {startTime}:00 - {endTime}:00</p>
            <p style={{ fontSize: '16px' }}>Duration: {duration} hours</p>
          </div>
        );
      }
    }
    return null;
  };

  // Find max number of tasks
  const maxTasks = Math.max(...chartData.map(person => {
    return Object.keys(person).filter(key => key.includes('_duration')).length;
  }));

  return (
    <div className="gantt-chart-container">
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
          ticks={[0, 2, 4, 6, 8, 10, 12, 14, 16]}
          tickFormatter={(value) => `${8 + value}:00`}
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
        
        {/* Render bars for each task */}
        {Array.from({ length: maxTasks }).map((_, taskIndex) => (
          <Bar
            key={taskIndex}
            dataKey={`task${taskIndex}_duration`}
            stackId="a"
          >
            {chartData.map((entry, index) => {
              const color = entry[`task${taskIndex}_color`] || '#8884d8';
              return <Cell key={`cell-${index}`} fill={color} />;
            })}
          </Bar>
        ))}
      </BarChart>
    </div>
  );
}

export default GanttChart;