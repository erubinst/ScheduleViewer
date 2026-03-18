import React from 'react';

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
          endLb:      e.prior_task_start_lb,
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
        endLb:    t.prior_task_start_lb || null,
        location:   t.prior_task_location || null,
        dropsOffAt: dropTask,
      });
    }
  }

  return { capAssignments, transportAssignments, totalRideTime, totalTravel };
}

// ─── Small reusable pieces ────────────────────────────────────────────────────

const humanTask = (id) => id || '';

function Pill({ children, variant = 'default' }) {
  const variants = {
    resource:  { background: '#EEEDFE', color: '#3C3489' },
    cap:       { background: '#E1F5EE', color: '#085041' },
    transport: { background: '#FAEEDA', color: '#633806' },
    default:   { background: '#F1EFE8', color: '#444441' },
  };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 99,
      fontSize: 12,
      fontWeight: 500,
      whiteSpace: 'nowrap',
      flexShrink: 0,
      ...variants[variant],
    }}>
      {children}
    </span>
  );
}

function TaskCode({ children }) {
  return (
    <code style={{
      fontSize: 12,
      background: 'rgba(0,0,0,0.06)',
      padding: '1px 6px',
      borderRadius: 4,
      fontFamily: 'monospace',
    }}>
      {children}
    </code>
  );
}

function Card({ children, style }) {
  return (
    <div style={{
      background: 'var(--color-background-secondary, #f8f8f7)',
      border: '1px solid rgba(0,0,0,0.07)',
      borderRadius: 12,
      padding: '18px 22px',
      marginBottom: 12,
      ...style,
    }}>
      {children}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: '#888780',
      marginBottom: 12,
    }}>
      {children}
    </div>
  );
}

function Row({ children }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 6,
      marginBottom: 8,
      fontSize: 14,
      lineHeight: 1.6,
      color: '#2c2c2a',
    }}>
      {children}
    </div>
  );
}

const Muted = ({ children }) => (
  <span style={{ color: '#888780' }}>{children}</span>
);

// ─── Main export ──────────────────────────────────────────────────────────────

export default function AssignmentCard({ assignmentRows }) {
  if (!assignmentRows || assignmentRows.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', color: '#888780', fontSize: 14 }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
        No assignments were returned for this task.
      </div>
    );
  }

  const result = parseAssignments(assignmentRows);
  if (!result) return null;

  const { capAssignments, transportAssignments, totalRideTime, totalTravel } = result;

  return (
    <div>

      {/* ── Who handles what ─────────────────────────────────────────── */}
      <Card>
        <SectionLabel>Assignments</SectionLabel>
        {capAssignments.length === 0
          ? <Muted>No capability assignments.</Muted>
          : capAssignments.map((a, i) => (
            <div key={i} style={{ marginBottom: i < capAssignments.length - 1 ? 14 : 0 }}>
              <Row>
                <Pill variant="resource">{a.resource}</Pill>
                <span>handles</span>
                <Pill variant="cap">{a.capability}</Pill>
                <Muted>· scheduled after</Muted>
                <TaskCode>{a.followsTask}</TaskCode>
              </Row>
              {(a.endLb || a.location) && (
                <div style={{ marginLeft: 4, marginTop: 2, display: 'flex', gap: 16, fontSize: 12, color: '#5F5E5A' }}>
                  {a.endLb  && <span>🕐 Prior task ends around {fmtTime(a.endLb)}</span>}
                  {a.location && <span>📍 {a.location}</span>}
                </div>
              )}
            </div>
          ))
        }
      </Card>

      {/* ── Transport — only rendered if the scheduler assigned a ride ── */}
      {transportAssignments.length > 0 && (
        <Card>
          <SectionLabel>Transport</SectionLabel>
          {transportAssignments.map((t, i) => (
            <div key={i} style={{ marginBottom: i < transportAssignments.length - 1 ? 14 : 0 }}>
              <Row>
                <Pill variant="transport">{t.driver}</Pill>
                <span>picks up</span>
                {t.passenger && <Pill variant="resource">{t.passenger}</Pill>}
                {t.pickupAt && <><Muted>after</Muted><TaskCode>{t.pickupAt}</TaskCode></>}
                {t.dropsOffAt && (
                  <>
                    <Muted>→ drops off at</Muted>
                    <strong>{t.dropsOffAt}</strong>
                  </>
                )}
              </Row>
              {(t.endLb || t.location) && (
                <div style={{ marginLeft: 4, marginTop: 2, display: 'flex', gap: 16, fontSize: 12, color: '#5F5E5A' }}>
                  {t.endLb  && <span>🕐 Pickup after task ending around {fmtTime(t.endLb)}</span>}
                  {t.location && <span>📍 {t.location}</span>}
                </div>
              )}
            </div>
          ))}
        </Card>
      )}

      {/* ── Stats ────────────────────────────────────────────────────── */}
      {(totalRideTime != null || totalTravel != null) && (
        <Card style={{ padding: '16px 22px' }}>
          <div style={{ display: 'flex', gap: 40 }}>
            {totalRideTime != null && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888780' }}>
                  Ride time
                </span>
                <span style={{ fontSize: 22, fontWeight: 600, color: '#2c2c2a', lineHeight: 1 }}>
                  {totalRideTime}
                  <span style={{ fontSize: 12, fontWeight: 400, color: '#888780', marginLeft: 3 }}>min</span>
                </span>
              </div>
            )}
            {totalTravel != null && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888780' }}>
                  Total travel
                </span>
                <span style={{ fontSize: 22, fontWeight: 600, color: '#2c2c2a', lineHeight: 1 }}>
                  {totalTravel}
                  <span style={{ fontSize: 12, fontWeight: 400, color: '#888780', marginLeft: 3 }}>min</span>
                </span>
              </div>
            )}
          </div>
        </Card>
      )}

    </div>
  );
}