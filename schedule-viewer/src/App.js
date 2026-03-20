import React, { useState, useEffect } from 'react';
import './App.css';
import GanttChart from './GanttChart';
import DayByDaySchedule from './DayByDaySchedule';
import AssignmentCard from './AssignmentCard';  // ← NEW

const API_URL = 'http://127.0.0.1:5000';

function App() {
  // Auth state
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState(null);
  const [username, setUsername] = useState(null);
  const [showSignup, setShowSignup] = useState(false);

  // Login/Signup form state
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Check for existing token on load
  useEffect(() => {
    const savedToken = localStorage.getItem('taskSchedulerToken');
    const savedUsername = localStorage.getItem('taskSchedulerUsername');
    if (savedToken && savedUsername) {
      verifyToken(savedToken, savedUsername);
    }
  }, []);

  // Verify token with backend
  const verifyToken = async (tokenToVerify, usernameToVerify) => {
    try {
      const response = await fetch(`${API_URL}/api/verify-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenToVerify })
      });
      const data = await response.json();
      if (data.valid) {
        setToken(tokenToVerify);
        setUsername(usernameToVerify);
        setIsLoggedIn(true);
        loadCurrentSchedule(tokenToVerify);
        loadLocations(tokenToVerify);
        loadCapabilities(tokenToVerify);
      } else {
        handleLogout();
      }
    } catch (error) {
      console.error('Token verification failed:', error);
      handleLogout();
    }
  };

  // Load user's current schedule
  const loadCurrentSchedule = async (userToken) => {
    try {
      const response = await fetch(`${API_URL}/api/current-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: userToken })
      });
      if (response.ok) {
        const data = await response.json();
        setCurrentSchedule(data);
      }
    } catch (error) {
      console.error('Failed to load schedule:', error);
    }
  };

  // Load capabilities
  const loadCapabilities = async (userToken) => {
    try {
      const response = await fetch(`${API_URL}/api/capabilities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: userToken })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setAvailableCapabilities(data.capabilities || []);
      } else {
        console.error('Failed to load capabilities:', data.error || 'unknown error');
        setAvailableCapabilities([]);
      }
    } catch (error) {
      console.error('Failed to load capabilities:', error);
      setAvailableCapabilities([]);
    }
  };

  // Load location options
  const loadLocations = async (userToken) => {
    try {
      const response = await fetch(`${API_URL}/api/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: userToken })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setLocationOptions(data.locations || []);
      } else {
        console.error('Failed to load locations:', data.error || 'unknown error');
        setLocationOptions([]);
      }
    } catch (error) {
      console.error('Failed to load locations:', error);
      setLocationOptions([]);
    }
  };

  // Load all resources' schedules for Gantt
  const loadAllResourceSchedules = async (userToken) => {
    setGanttLoading(true);
    setGanttError(null);
    try {
      const response = await fetch(`${API_URL}/api/all-resource-schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: userToken })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setAllResourcesSchedule({
          tasks: data.tasks || [],
          scenario_name: data.scenario_name || null,
          resource_names: data.resource_names || []
        });
      } else {
        setGanttError(data.error || 'Could not load events from database');
        setAllResourcesSchedule({ tasks: [], scenario_name: null, resource_names: [] });
      }
    } catch (error) {
      console.error('Failed to load all resource schedules:', error);
      setGanttError('Could not reach the server. Is the backend running?');
      setAllResourcesSchedule({ tasks: [], scenario_name: null, resource_names: [] });
    } finally {
      setGanttLoading(false);
    }
  };

  // Handle login
  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authUsername, password: authPassword })
      });
      const data = await response.json();
      if (response.ok) {
        localStorage.setItem('taskSchedulerToken', data.token);
        localStorage.setItem('taskSchedulerUsername', data.username);
        setToken(data.token);
        setUsername(data.username);
        setIsLoggedIn(true);
        setAuthUsername('');
        setAuthPassword('');
        loadCurrentSchedule(data.token);
        loadLocations(data.token);
        loadCapabilities(data.token);
      } else {
        setAuthError(data.error || 'Login failed');
      }
    } catch (error) {
      console.error('Login error:', error);
      setAuthError('Could not connect to server');
    } finally {
      setAuthLoading(false);
    }
  };

  // Handle signup
  const handleSignup = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: authUsername, password: authPassword })
      });
      const data = await response.json();
      if (response.ok) {
        localStorage.setItem('taskSchedulerToken', data.token);
        localStorage.setItem('taskSchedulerUsername', data.username);
        setToken(data.token);
        setUsername(data.username);
        setIsLoggedIn(true);
        setAuthUsername('');
        setAuthPassword('');
        loadCurrentSchedule(data.token);
        loadLocations(data.token);
        loadCapabilities(data.token);
      } else {
        setAuthError(data.error || 'Registration failed');
      }
    } catch (error) {
      console.error('Signup error:', error);
      setAuthError('Could not connect to server');
    } finally {
      setAuthLoading(false);
    }
  };

  // Handle logout
  const handleLogout = () => {
    if (window.confirm('Are you sure you want to log out?')) {
      localStorage.removeItem('taskSchedulerToken');
      localStorage.removeItem('taskSchedulerUsername');
      setToken(null);
      setUsername(null);
      setIsLoggedIn(false);
      setActiveTab('add');
      setShowSchedules(false);
      setAssignmentRows([]);
      setSelectedCapabilities([]);
    }
  };

  // Tab state
  const [activeTab, setActiveTab] = useState('add');

  // Form state
  const [formData, setFormData] = useState({
    taskName: '',
    taskType: '',
    duration: '',
    earliestStartTime: '',
    latestDueDate: '',
    location: '',
  });
  const [locationOptions, setLocationOptions] = useState([]);
  const [availableCapabilities, setAvailableCapabilities] = useState([]);
  const [selectedCapabilities, setSelectedCapabilities] = useState([]);

  // Assignment result state
  const [showSchedules, setShowSchedules] = useState(false);
  const [assignmentRows, setAssignmentRows] = useState([]);

  // Current schedule (View tab)
  const [currentSchedule, setCurrentSchedule] = useState({
    id: 1,
    name: 'Current Schedule',
    tasks: []
  });

  // Gantt state
  const [allResourcesSchedule, setAllResourcesSchedule] = useState({ tasks: [], scenario_name: null, resource_names: [] });
  const [ganttLoading, setGanttLoading] = useState(false);
  const [ganttError, setGanttError] = useState(null);
  const [ganttSelectedDate, setGanttSelectedDate] = useState(null);

  useEffect(() => {
    if (activeTab === 'gantt' && token) {
      loadAllResourceSchedules(token);
    }
  }, [activeTab, token]);

  const ganttDates = React.useMemo(() => {
    const tasks = allResourcesSchedule.tasks || [];
    const dateCounts = {};
    tasks.forEach(t => {
      if (t.start_lb) {
        const d = new Date(t.start_lb).toISOString().slice(0, 10);
        dateCounts[d] = (dateCounts[d] || 0) + 1;
      }
    });
    return Object.keys(dateCounts).sort();
  }, [allResourcesSchedule.tasks]);

  useEffect(() => {
    if (ganttDates.length > 0 && (ganttSelectedDate === null || !ganttDates.includes(ganttSelectedDate))) {
      setGanttSelectedDate(ganttDates[0]);
    }
  }, [ganttDates, ganttSelectedDate]);

  const ganttTasksForDay = React.useMemo(() => {
    const tasks = allResourcesSchedule.tasks || [];
    if (!ganttSelectedDate) return [];
    return tasks.filter(t => {
      if (!t.start_lb) return false;
      return new Date(t.start_lb).toISOString().slice(0, 10) === ganttSelectedDate;
    });
  }, [allResourcesSchedule.tasks, ganttSelectedDate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    console.log('Form submitted by:', username);
    console.log('Form data:', formData);
    try {
      const response = await fetch(`${API_URL}/api/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token,
          taskData: formData,
          selectedCapabilities: selectedCapabilities
        })
      });
      if (response.ok) {
        const data = await response.json();
        console.log('[FORM] API response:', data);
        console.log('[FORM] assignments:', data.assignments);
        setAssignmentRows(data.assignments || []);
        setShowSchedules(true);
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to add task');
      }
    } catch (error) {
      console.error('Add task error:', error);
      alert('Could not connect to server');
    }
  };

  const handleBack = () => {
    setShowSchedules(false);
    setAssignmentRows([]);
    setSelectedCapabilities([]);
  };

  const handleAssignmentDecision = (accepted) => {
    if (accepted) {
      console.log('[ASSIGNMENT] User accepted generated assignment');
    } else {
      console.log('[ASSIGNMENT] User rejected generated assignment');
    }
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (tab === 'add') {
      setShowSchedules(false);
      setAssignmentRows([]);
      setSelectedCapabilities([]);
    }
  };

  // ── Login / signup screen ─────────────────────────────────────────────────
  if (!isLoggedIn) {
    return (
      <div className="app">
        <div className="login-container">
          <div className="login-card">
            <h1>Task Scheduler</h1>
            <p className="login-subtitle">
              {showSignup ? 'Create your account' : 'Log in to your account'}
            </p>
            <form onSubmit={showSignup ? handleSignup : handleLogin} className="login-form">
              <div className="form-group">
                <label htmlFor="username">Username</label>
                <input
                  type="text"
                  id="username"
                  value={authUsername}
                  onChange={(e) => setAuthUsername(e.target.value)}
                  placeholder="Enter username"
                  required
                  autoFocus
                  minLength="3"
                />
                {showSignup && <small className="input-hint">At least 3 characters</small>}
              </div>
              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  type="password"
                  id="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                  minLength="6"
                />
                {showSignup && <small className="input-hint">At least 6 characters</small>}
              </div>
              {authError && <div className="error-message">{authError}</div>}
              <button type="submit" className="submit-button" disabled={authLoading}>
                {authLoading ? 'Please wait...' : (showSignup ? 'Create Account' : 'Log In')}
              </button>
            </form>
            <div className="auth-switch">
              {showSignup ? (
                <p>
                  Already have an account?{' '}
                  <button className="link-button" onClick={() => { setShowSignup(false); setAuthError(''); }}>
                    Log In
                  </button>
                </p>
              ) : (
                <p>
                  Don't have an account?{' '}
                  <button className="link-button" onClick={() => { setShowSignup(true); setAuthError(''); }}>
                    Sign Up
                  </button>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main application ──────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* Header */}
      <div className="header-container">
        <div className="user-info">
          <span className="user-icon">👤</span>
          <span className="username-display">{username}</span>
        </div>
        <div className="tab-navigation">
          <button className={`tab-button ${activeTab === 'add'   ? 'active' : ''}`} onClick={() => handleTabChange('add')}>Add a Task</button>
          <button className={`tab-button ${activeTab === 'view'  ? 'active' : ''}`} onClick={() => handleTabChange('view')}>View Schedule</button>
          <button className={`tab-button ${activeTab === 'gantt' ? 'active' : ''}`} onClick={() => handleTabChange('gantt')}>Gantt Chart</button>
        </div>
        <button className="logout-button" onClick={handleLogout}>Log Out</button>
      </div>

      {/* ── ADD TASK TAB ──────────────────────────────────────────────── */}
      {activeTab === 'add' ? (
        !showSchedules ? (
          // Form view — unchanged
          <div className="container">
            <h1>Add New Task</h1>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="taskName">Task Name</label>
                <input type="text" id="taskName" name="taskName" value={formData.taskName} onChange={handleChange} placeholder="Enter task name" required />
              </div>
              <div className="form-group">
                <label htmlFor="taskType">Task Type</label>
                <select id="taskType" name="taskType" value={formData.taskType} onChange={handleChange} required>
                  <option value="" disabled>Select a task type</option>
                  <option value="medical_appointment">medical_appointment</option>
                  <option value="medication_pickup">medication_pickup</option>
                  <option value="food_shopping">food_shopping</option>
                  <option value="cleaning">cleaning</option>
                  <option value="work">work</option>
                  <option value="social">social</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="duration">Duration (minutes)</label>
                <input type="number" id="duration" name="duration" value={formData.duration} onChange={handleChange} min="1" placeholder="e.g., 60" required />
              </div>
              <div className="form-group">
                <label htmlFor="earliestStartTime">Earliest Start Time</label>
                <input type="datetime-local" id="earliestStartTime" name="earliestStartTime" value={formData.earliestStartTime} onChange={handleChange} required />
              </div>
              <div className="form-group">
                <label htmlFor="latestDueDate">Latest Due Date</label>
                <input type="datetime-local" id="latestDueDate" name="latestDueDate" value={formData.latestDueDate} onChange={handleChange} required />
              </div>
              <div className="form-group">
                <label htmlFor="location">Location</label>
                <select id="location" name="location" value={formData.location} onChange={handleChange} required>
                  <option value="" disabled>Select a location</option>
                  {locationOptions.map((loc) => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="capabilities">Required Capabilities</label>
                <select
                  id="capabilities"
                  multiple
                  size={Math.min(availableCapabilities.length, 6)}
                  value={selectedCapabilities}
                  onChange={(e) => setSelectedCapabilities(Array.from(e.target.selectedOptions, o => o.value))}
                  style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: '4px', fontFamily: 'inherit' }}
                >
                  {availableCapabilities.length === 0 ? (
                    <option value="" disabled>No capabilities available</option>
                  ) : (
                    availableCapabilities.map((cap) => (
                      <option key={cap} value={cap}>{cap}</option>
                    ))
                  )}
                </select>
                <small style={{ color: '#666', marginTop: '4px', display: 'block' }}>Hold Ctrl/Cmd to select multiple</small>
              </div>
              <button type="submit" className="submit-button">Add Task</button>
            </form>
          </div>
        ) : (
          // ── ASSIGNMENTS OUTPUT VIEW ── replaced raw JSON with AssignmentCard
          <div className="schedules-container">
            <button className="back-button" onClick={handleBack}>← Back to Form</button>
            <h1 className="schedules-title">Task Assignment</h1>
            <p className="task-info">
              Here's how the scheduler has assigned this task.
            </p>
            <div className="current-schedule-card">
              <AssignmentCard
                assignmentRows={assignmentRows}
                onDecision={handleAssignmentDecision}
              />
            </div>
          </div>
        )

      ) : activeTab === 'gantt' ? (
        // ── GANTT TAB — unchanged ──────────────────────────────────────
        <div className="view-schedule-container">
          <div className="view-schedule-content">
            <h1>Gantt Chart</h1>
            <p className="schedule-subtitle">One day at a time — events from the database</p>
            {allResourcesSchedule.scenario_name && (
              <p className="gantt-scenario-hint">Scenario: {allResourcesSchedule.scenario_name}</p>
            )}
            <div className="current-schedule-card">
              {ganttLoading ? (
                <div className="empty-schedule"><p>Loading events from database…</p></div>
              ) : ganttError ? (
                <div className="empty-schedule gantt-error">
                  <p><strong>Could not load events</strong></p>
                  <p>{ganttError}</p>
                  <p>Check that the backend is running and MongoDB is connected.</p>
                </div>
              ) : allResourcesSchedule.tasks && allResourcesSchedule.tasks.length > 0 ? (
                <>
                  <div className="gantt-day-nav">
                    <span className="gantt-resource-count">
                      {allResourcesSchedule.resource_names.length} people, {allResourcesSchedule.tasks.length} events in DB
                    </span>
                    {ganttDates.length > 1 && (
                      <div className="gantt-day-buttons">
                        <button
                          type="button"
                          className="gantt-day-btn"
                          onClick={() => {
                            const i = ganttDates.indexOf(ganttSelectedDate);
                            if (i > 0) setGanttSelectedDate(ganttDates[i - 1]);
                          }}
                          disabled={ganttDates.indexOf(ganttSelectedDate) <= 0}
                        >
                          ← Previous day
                        </button>
                        <span className="gantt-day-label">
                          {ganttSelectedDate
                            ? new Date(ganttSelectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
                            : ''}
                        </span>
                        <button
                          type="button"
                          className="gantt-day-btn"
                          onClick={() => {
                            const i = ganttDates.indexOf(ganttSelectedDate);
                            if (i >= 0 && i < ganttDates.length - 1) setGanttSelectedDate(ganttDates[i + 1]);
                          }}
                          disabled={ganttDates.indexOf(ganttSelectedDate) >= ganttDates.length - 1}
                        >
                          Next day →
                        </button>
                      </div>
                    )}
                  </div>
                  {ganttTasksForDay.length > 0 ? (
                    <GanttChart
                      tasks={ganttTasksForDay}
                      dateLabel={ganttSelectedDate
                        ? new Date(ganttSelectedDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                        : null}
                      resourceOrder={allResourcesSchedule.resource_names}
                    />
                  ) : (
                    <div className="empty-schedule">
                      <p>No events on this day ({ganttSelectedDate}). Use Prev/Next to switch day.</p>
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-schedule">
                  <p><strong>No events in the database</strong></p>
                  <p>There are no documents in <code>resource_schedules</code> with tasks, or the collection is empty.</p>
                  <p>Run your scheduler (e.g. <code>run_initial_schedule.py</code>) to populate the database.</p>
                </div>
              )}
            </div>
          </div>
        </div>

      ) : (
        // ── VIEW SCHEDULE TAB — unchanged ─────────────────────────────
        <div className="view-schedule-container">
          <div className="view-schedule-content">
            <h1>My Schedule</h1>
            <p className="schedule-subtitle">Welcome, {username}</p>
            <div className="current-schedule-card">
              {currentSchedule.tasks && currentSchedule.tasks.length > 0 ? (
                <DayByDaySchedule tasks={currentSchedule.tasks} />
              ) : (
                <div className="empty-schedule">
                  <p>No schedule available yet.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
