import React, { useState, useEffect } from 'react';
import './App.css';
import GanttChart from './GanttChart';
import DayByDaySchedule from './DayByDaySchedule';

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
      // Verify token is still valid
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
        
        // Load user's schedule
        loadCurrentSchedule(tokenToVerify);
      } else {
        // Token expired or invalid
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

  // Handle login
  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    
    try {
      const response = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: authUsername,
          password: authPassword
        })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        // Login successful
        localStorage.setItem('taskSchedulerToken', data.token);
        localStorage.setItem('taskSchedulerUsername', data.username);
        setToken(data.token);
        setUsername(data.username);
        setIsLoggedIn(true);
        setAuthUsername('');
        setAuthPassword('');
        
        // Load user's schedule
        loadCurrentSchedule(data.token);
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
        body: JSON.stringify({
          username: authUsername,
          password: authPassword
        })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        // Signup successful, automatically log in
        localStorage.setItem('taskSchedulerToken', data.token);
        localStorage.setItem('taskSchedulerUsername', data.username);
        setToken(data.token);
        setUsername(data.username);
        setIsLoggedIn(true);
        setAuthUsername('');
        setAuthPassword('');
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
      setSelectedSchedule(null);
    }
  };

  // Tab state: 'add' or 'view'
  const [activeTab, setActiveTab] = useState('add');
  
  // State for form data
  const [formData, setFormData] = useState({
    taskName: '',
    taskType: 'meeting',
    duration: '60',
    earliestStartTime: '',
    latestDueDate: '',
    location: 'conference-room-a',
  });

  // State for showing schedules in Add Task flow
  const [showSchedules, setShowSchedules] = useState(false);
  const [scheduleOptions, setScheduleOptions] = useState([]);
  const [selectedSchedule, setSelectedSchedule] = useState(null);

  // State for current/saved schedule in View Schedule tab
  const [currentSchedule, setCurrentSchedule] = useState({
    id: 1,
    name: 'Current Schedule',
    tasks: []
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value
    });
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
          taskData: formData
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        setScheduleOptions(data.schedules);
        setShowSchedules(true);
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to create schedule');
      }
    } catch (error) {
      console.error('Schedule creation error:', error);
      alert('Could not connect to server');
    }
  };

  const handleBack = () => {
    setShowSchedules(false);
    setSelectedSchedule(null);
  };

  const handleSelectSchedule = async (index) => {
    setSelectedSchedule(index);
    const selected = scheduleOptions[index];
    setCurrentSchedule(selected);
    console.log('User', username, 'selected schedule:', selected);
    
    // Save to backend
    try {
      const response = await fetch(`${API_URL}/api/save-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token,
          schedule: selected
        })
      });
      
      if (response.ok) {
        console.log('Schedule saved successfully');
      }
    } catch (error) {
      console.error('Failed to save schedule:', error);
    }
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (tab === 'add') {
      setShowSchedules(false);
      setSelectedSchedule(null);
    }
  };

  // If not logged in, show login/signup screen
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
                {showSignup && (
                  <small className="input-hint">At least 3 characters</small>
                )}
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
                {showSignup && (
                  <small className="input-hint">At least 6 characters</small>
                )}
              </div>
              
              {authError && (
                <div className="error-message">
                  {authError}
                </div>
              )}
              
              <button type="submit" className="submit-button" disabled={authLoading}>
                {authLoading ? 'Please wait...' : (showSignup ? 'Create Account' : 'Log In')}
              </button>
            </form>
            
            <div className="auth-switch">
              {showSignup ? (
                <p>
                  Already have an account?{' '}
                  <button 
                    className="link-button" 
                    onClick={() => {
                      setShowSignup(false);
                      setAuthError('');
                    }}
                  >
                    Log In
                  </button>
                </p>
              ) : (
                <p>
                  Don't have an account?{' '}
                  <button 
                    className="link-button" 
                    onClick={() => {
                      setShowSignup(true);
                      setAuthError('');
                    }}
                  >
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

  // Main application (user is logged in)
  return (
    <div className="app">
      {/* Combined Header: User Info + Tabs + Logout */}
      <div className="header-container">
        <div className="user-info">
          <span className="user-icon">👤</span>
          <span className="username-display">{username}</span>
        </div>

        <div className="tab-navigation">
          <button 
            className={`tab-button ${activeTab === 'add' ? 'active' : ''}`}
            onClick={() => handleTabChange('add')}
          >
            Add a Task
          </button>
          <button 
            className={`tab-button ${activeTab === 'view' ? 'active' : ''}`}
            onClick={() => handleTabChange('view')}
          >
            View Schedule
          </button>
        </div>

        <button className="logout-button" onClick={handleLogout}>
          Log Out
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'add' ? (
        // ADD TASK TAB
        !showSchedules ? (
          // FORM VIEW
          <div className="container">
            <h1>Add New Task</h1>
            
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="taskName">Task Name</label>
                <input
                  type="text"
                  id="taskName"
                  name="taskName"
                  value={formData.taskName}
                  onChange={handleChange}
                  placeholder="Enter task name"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="taskType">Task Type</label>
                <select
                  id="taskType"
                  name="taskType"
                  value={formData.taskType}
                  onChange={handleChange}
                  required
                >
                  <option value="meeting">Meeting</option>
                  <option value="review">Review</option>
                  <option value="development">Development</option>
                  <option value="planning">Planning</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="duration">Duration (minutes)</label>
                <input
                  type="number"
                  id="duration"
                  name="duration"
                  value={formData.duration}
                  onChange={handleChange}
                  min="15"
                  step="15"
                  placeholder="e.g., 60"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="earliestStartTime">Earliest Start Time</label>
                <input
                  type="datetime-local"
                  id="earliestStartTime"
                  name="earliestStartTime"
                  value={formData.earliestStartTime}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="latestDueDate">Latest Due Date</label>
                <input
                  type="datetime-local"
                  id="latestDueDate"
                  name="latestDueDate"
                  value={formData.latestDueDate}
                  onChange={handleChange}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="location">Location</label>
                <select
                  id="location"
                  name="location"
                  value={formData.location}
                  onChange={handleChange}
                  required
                >
                  <option value="conference-room-a">Conference Room A</option>
                  <option value="conference-room-b">Conference Room B</option>
                  <option value="meeting-room-1">Meeting Room 1</option>
                  <option value="meeting-room-2">Meeting Room 2</option>
                  <option value="virtual">Virtual (Online)</option>
                  <option value="office-main">Main Office</option>
                  <option value="office-branch">Branch Office</option>
                </select>
              </div>

              <button type="submit" className="submit-button">
                Create Schedule Options
              </button>
            </form>
          </div>
        ) : (
          // SCHEDULE OPTIONS VIEW
          <div className="schedules-container">
            <button className="back-button" onClick={handleBack}>
              ← Back to Form
            </button>

            <h1 className="schedules-title">Choose Your Preferred Schedule</h1>
            <p className="task-info">
              Task: {formData.taskName} ({formData.duration} minutes) at {formData.location.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </p>

            <div className="schedule-options">
              {scheduleOptions.map((schedule, index) => (
                <div 
                  key={schedule.id}
                  className={`schedule-card ${selectedSchedule === index ? 'selected' : ''}`}
                >
                  <div className="schedule-header">
                    <h2>{schedule.name}</h2>
                    {selectedSchedule === index && (
                      <span className="selected-badge">✓ Selected</span>
                    )}
                  </div>

                  <GanttChart tasks={schedule.tasks} />

                  <button
                    className={`select-button ${selectedSchedule === index ? 'selected' : ''}`}
                    onClick={() => handleSelectSchedule(index)}
                  >
                    {selectedSchedule === index ? 'Selected Schedule' : 'Select This Schedule'}
                  </button>
                </div>
              ))}
            </div>

            {selectedSchedule !== null && (
              <div className="confirmation-message">
                <div className="confirmation-content">
                  <span className="check-icon">✓</span>
                  <h3>Schedule Option {selectedSchedule + 1} Selected!</h3>
                  <p>Your task has been added to the calendar.</p>
                </div>
              </div>
            )}
          </div>
        )
      ) : (
        // VIEW SCHEDULE TAB
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
