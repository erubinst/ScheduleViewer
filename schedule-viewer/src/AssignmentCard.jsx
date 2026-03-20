import React from 'react';
import './AssignmentCard.css';

// ─── Parser ────────────────────────────────────────────────────────────────
// Converts raw add_task rows (which contain Python repr strings) into plain objects.

function fmtTime(isoString) {
  if (!isoString) return null;
  try {
    return new Date(isoString).toLocaleString([], {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return null; }
}

function parseAssignments(rows) {
  if (!rows || rows.length === 0) return null;

  const capAssignments = [];
  const transportAssignments = [];
  let totalRideTime = null;
  let totalTravel   = null;

  for (const row of rows) {
    if (row.total_ride_time != null) totalRideTime = row.total_ride_time;
    if (row.total_travel    != null) totalTravel   = row.total_travel;

    // ── Capability assignments ────────────────────────────────────────
    // Use enriched array (with timing/location) if the backend provided it,
    // otherwise fall back to parsing the raw repr strings.
    const enriched = row.capability_assignment_enriched || [];
    const raws     = row.capability_assignment || [];

    if (enriched.length > 0) {
      for (const e of enriched) {
        const raw      = e.raw || '';
        const resource = raw.match(/<Resource (\w+)/)?.[1] || '?';
        const cap      = raw.match(/'([^']+)'\)$/)?.[1]    || '?';
        capAssignments.push({
          resource,
          capability:   cap,
          followsTask:  e.prior_task_name,
          endLb:      e.prior_task_end_lb,
          location:     e.prior_task_location,
        });
      }
    } else {
      for (const raw of raws) {
        const resource = raw.match(/<Resource (\w+)/)?.[1] || '?';
        const task     = raw.match(/<Task (\S+) /)?.[1]    || '?';
        const cap      = raw.match(/'([^']+)'\)$/)?.[1]    || '?';
        capAssignments.push({ resource, capability: cap, followsTask: task, endLb: null, location: null });
      }
    }

    // ── Transport assignments ─────────────────────────────────────────
    // prior_task_* fields are attached by the backend enrichment step.
    // driven_resource is the string name of the passenger.
    for (const t of (row.transport_assignment || [])) {
      const driver   = t.before_resource?.match(/<Resource (\w+)/)?.[1]              || null;
      const dropTask = t.before_dropoff_task?.match(/<Task dropoff_at_(\S+?)_/)?.[1] || null;
      transportAssignments.push({
        driver,
        passenger:  t.driven_resource    || null,
        pickupAt:   t.prior_task_name     || null,
        endLb:    t.prior_task_end_lb || null,
        location:   t.prior_task_location || null,
        dropsOffAt: dropTask,
      });
    }
  }

  return { capAssignments, transportAssignments, totalRideTime, totalTravel };
}

// ─── Small reusable pieces ────────────────────────────────────────────────────

// Deterministic color palette — same resource name always gets the same color.
// Each entry is [background, textColor].
const RESOURCE_PALETTE = [
  ['#EEEDFE', '#3C3489'], // purple
  ['#E1F5EE', '#085041'], // teal
  ['#FAEEDA', '#633806'], // amber
  ['#FAECE7', '#993C1D'], // coral
  ['#FBEAF0', '#72243E'], // pink
  ['#EAF3DE', '#27500A'], // green
  ['#E6F1FB', '#0C447C'], // blue
];

function resourceColor(name) {
  if (!name) return RESOURCE_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return RESOURCE_PALETTE[hash % RESOURCE_PALETTE.length];
}

function Pill({ children, variant = 'default', resourceName = null }) {
  let bg, color;
  if (variant === 'resource' && resourceName) {
    [bg, color] = resourceColor(resourceName);
  } else {
    const variants = {
      cap:     { background: '#E1F5EE', color: '#085041' },
      default: { background: '#F1EFE8', color: '#444441' },
    };
    const v = variants[variant] || variants.default;
    bg = v.background; color = v.color;
  }
  return (
    <span
      className="assignment-pill"
      style={{ background: bg, color }}
    >
      {children}
    </span>
  );
}

function TaskCode({ children }) {
  return (
    <code className="assignment-task-code">
      {children}
    </code>
  );
}
const Muted = ({ children }) => <span className="assignment-muted">{children}</span>;

// ─── Main export ──────────────────────────────────────────────────────────────

export default function AssignmentCard({ assignmentRows, onDecision }) {
  if (!assignmentRows || assignmentRows.length === 0) {
    return (
      <div className="assignment-empty-state">
        No assignments were returned for this task.
      </div>
    );
  }

  const result = parseAssignments(assignmentRows);
  if (!result) return null;

  const { capAssignments, transportAssignments, totalRideTime, totalTravel } = result;

  return (
    <div className="assignment-card-root">

      {/* ── Who handles what ─────────────────────────────────────────── */}
      <div className="assignment-section">
        <div className="assignment-section-label">Assignments</div>
        {capAssignments.length === 0
          ? <Muted>No capability assignments.</Muted>
          : capAssignments.map((a, i) => (
            <div
              key={i}
              className={`assignment-item ${i < capAssignments.length - 1 ? 'assignment-item-spaced' : ''}`}
            >
              <div className="assignment-row">
                <Pill variant="resource" resourceName={a.resource}>{a.resource}</Pill>
                <span>handles</span>
                <Pill variant="cap">{a.capability}</Pill>
                <Muted>· scheduled after</Muted>
                <TaskCode>{a.followsTask}</TaskCode>
              </div>
              {(a.endLb || a.location) && (
                <div className="assignment-subline">
                  {a.endLb && <span>Prior task ends around {fmtTime(a.endLb)}</span>}
                  {a.location && <span>Location: {a.location}</span>}
                </div>
              )}
            </div>
          ))
        }
      </div>

      {/* ── Transport — only rendered if the scheduler assigned a ride ── */}
      {transportAssignments.length > 0 && (
        <div className="assignment-section">
          <div className="assignment-section-label">Transport</div>
          {transportAssignments.map((t, i) => (
            <div
              key={i}
              className={`assignment-item ${i < transportAssignments.length - 1 ? 'assignment-item-spaced' : ''}`}
            >
              <div className="assignment-row">
                <Pill variant="resource" resourceName={t.driver}>{t.driver}</Pill>
                <span>picks up</span>
                {t.passenger && <Pill variant="resource" resourceName={t.passenger}>{t.passenger}</Pill>}
                {t.pickupAt && <><Muted>after</Muted><TaskCode>{t.pickupAt}</TaskCode></>}
                {t.dropsOffAt && (
                  <>
                    <Muted>→ drops off at</Muted>
                    <strong>{t.dropsOffAt}</strong>
                  </>
                )}
              </div>
              {(t.endLb || t.location) && (
                <div className="assignment-subline">
                  {t.endLb && <span>Pickup after task ending around {fmtTime(t.endLb)}</span>}
                  {t.location && <span>Location: {t.location}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Stats ────────────────────────────────────────────────────── */}
      {(totalRideTime != null || totalTravel != null) && (
        <div className="assignment-section assignment-stats-section">
          <div className="assignment-stats-grid">
            {totalRideTime != null && (
              <div className="assignment-stat">
                <span className="assignment-stat-label">Ride time</span>
                <span className="assignment-stat-value">
                  {totalRideTime}
                  <span className="assignment-stat-unit">min</span>
                </span>
              </div>
            )}
            {totalTravel != null && (
              <div className="assignment-stat">
                <span className="assignment-stat-label">Total travel</span>
                <span className="assignment-stat-value">
                  {totalTravel}
                  <span className="assignment-stat-unit">min</span>
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="assignment-section assignment-decision-section">
        <div className="assignment-decision-buttons">
          <button
            type="button"
            onClick={() => onDecision && onDecision(true)}
            className="assignment-accept-btn"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => onDecision && onDecision(false)}
            className="assignment-reject-btn"
          >
            Reject
          </button>
        </div>
      </div>

    </div>
  );
}