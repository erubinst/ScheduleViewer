/**
 * Task relationship helpers for transport / pickup / dropoff in the schedule UI.
 * Uses task_name | taskName | order and resource | resource_name.
 */

function taskNameRaw(task) {
  return String(task?.task_name ?? task?.taskName ?? task?.order ?? '');
}

function resourceRaw(task) {
  return String(task?.resource ?? task?.resource_name ?? '');
}

export function isPickupTask(task) {
  return taskNameRaw(task).toLowerCase().startsWith('pickup_from');
}

export function isDropoffTask(task) {
  return taskNameRaw(task).toLowerCase().startsWith('dropoff_at');
}

export function isTravelTask(task) {
  return task?.capability === 'travel';
}

export function isTransportTask(task) {
  return task?.capability === 'transport';
}

export function isPresenceTask(task) {
  const c = task?.capability;
  return typeof c === 'string' && c.includes('presence');
}

/** travel from capability or task_name */
function isTravelCapabilityTask(task) {
  const c = String(task?.capability ?? '').toLowerCase();
  if (c === 'travel' || c.includes('travel')) return true;
  const n = taskNameRaw(task).toLowerCase();
  return n.includes('travel') || n.includes('driving');
}

/** transport from capability (handles variants) */
function isTransportCapabilityTask(task) {
  const c = String(task?.capability ?? '').toLowerCase();
  return c === 'transport' || c.includes('transport');
}

/**
 * FIX: Only extract the transported person from pickup/dropoff/transport tasks,
 * not from presence or travel tasks, where the last segment is not a person name.
 */
export function getTransportedPerson(task) {
  const name = taskNameRaw(task);
  if (!name) return null;
  // Only extract from tasks that actually encode a person in their name
  const lower = name.toLowerCase();
  if (
    !lower.includes('pickup_from') &&
    !lower.includes('dropoff_at') &&
    !isTransportCapabilityTask(task)
  ) {
    return null;
  }
  const parts = name.split('_');
  return parts[parts.length - 1] || null;
}

export function isSelfTransport(task) {
  if (!isTransportCapabilityTask(task) && !isPickupTask(task) && !isDropoffTask(task)) return false;
  const transported = getTransportedPerson(task);
  if (!transported) return false;
  return transported.toLowerCase() === resourceRaw(task).toLowerCase();
}

export function isSomeonePickingMeUp(task, currentUser) {
  const transported = getTransportedPerson(task);
  const user = String(currentUser ?? '').toLowerCase();
  if (!transported || !user) return false;
  return (
    transported.toLowerCase() === user &&
    resourceRaw(task).toLowerCase() !== user &&
    resourceRaw(task).length > 0
  );
}

export function getDropoffEvent(task) {
  const name = taskNameRaw(task);
  if (!name) return null;
  // FIX: capture everything after dropoff_at_ up to the last underscore-separated person token
  // e.g. dropoff_at_dvintagevisit_denim → dvintagevisit
  const match = name.match(/dropoff_at_(.+)_[^_]+$/i);
  if (match) return match[1];
  // fallback: old greedy
  const m2 = name.match(/dropoff_at_(.*?)_/);
  return m2 ? m2[1] : null;
}

export function getPickupOrigin(task) {
  const name = taskNameRaw(task);
  if (!name) return null;
  // FIX: same — capture everything up to last underscore-separated person token
  // e.g. pickup_from_denim_downtime_5520_denim → denim_downtime_5520
  const match = name.match(/pickup_from_(.+)_[^_]+$/i);
  if (match) return match[1];
  const m2 = name.match(/pickup_from_(.*?)_/);
  return m2 ? m2[1] : null;
}

/** Driver on a transport-capability row OR resource on pickup/dropoff leg */
function isDriverOrTransportLeg(task, currentUser) {
  const user = String(currentUser ?? '').toLowerCase();
  if (!user || resourceRaw(task).toLowerCase() !== user) return false;
  if (isTransportCapabilityTask(task)) return true;
  if (isPickupTask(task) || isDropoffTask(task)) return true;
  return false;
}

export function isDriver(task, currentUser) {
  return isDriverOrTransportLeg(task, currentUser);
}

export function isPassenger(task, currentUser) {
  return isPresenceTask(task) && resourceRaw(task).toLowerCase() === String(currentUser ?? '').toLowerCase();
}

export function getTaskRole(task, currentUser) {
  if (isTravelCapabilityTask(task)) return 'travel';
  if (isSelfTransport(task)) return 'self-travel';
  if (isDriverOrTransportLeg(task, currentUser)) return 'driver';
  if (isPassenger(task, currentUser)) return 'passenger';
  return 'unknown';
}

export function getReadableTaskRelationship(task, currentUser) {
  const userLc = String(currentUser ?? '').toLowerCase();
  const resLc = resourceRaw(task).toLowerCase();

  if (isPresenceTask(task)) {
    if (resLc === userLc) return 'Your scheduled activity';
    return 'Task relationship unknown';
  }

  const transported = getTransportedPerson(task);
  if (!transported && isTravelCapabilityTask(task)) return 'Travel task';
  if (!transported) return 'Travel task';
  if (isSelfTransport(task)) return 'You are traveling yourself';
  if (isDriverOrTransportLeg(task, currentUser)) return `You are driving ${transported}`;
  if (isSomeonePickingMeUp(task, currentUser)) return `${resourceRaw(task)} is transporting you`;
  if (isPassenger(task, currentUser)) return 'You are attending this event';
  if (userLc && resLc === userLc) return 'Your scheduled activity';
  return 'Task relationship unknown';
}

// ─── Detail popup helpers ────────────────────────────────────────────────────

/**
 * FIX: Lower minimum length so shorter event IDs (e.g. "gparty" → "party") also normalize.
 * Strips a single g/d resource-perspective prefix from visit-style ids.
 */
function normalizeVisitEventToken(slug) {
  if (!slug) return '';
  const s = String(slug).toLowerCase().trim();
  // Must be all alpha and at least 4 chars total to bother stripping
  if (s.length < 4 || !/^[a-z]+$/.test(s)) return s;
  const first = s[0];
  if ((first === 'g' || first === 'd') && s.length >= 4) {
    const rest = s.slice(1);
    if (rest.length >= 3) return rest;
  }
  return s;
}

function addSlugToken(set, token) {
  const t = String(token || '').toLowerCase().trim();
  if (t.length < 2) return;
  set.add(t);
  const c = normalizeVisitEventToken(t);
  if (c && c !== t && c.length >= 3) set.add(c);
}

function buildEventSlugSet(detailTask) {
  const set = new Set();
  const raw = taskNameRaw(detailTask).toLowerCase();
  if (raw) {
    addSlugToken(set, raw);
    raw.split('_').forEach((part) => addSlugToken(set, part));
  }
  // Also add the normalized form of the whole task name
  const normalized = normalizeVisitEventToken(raw);
  if (normalized && normalized !== raw) addSlugToken(set, normalized);

  const drop = getDropoffEvent(detailTask);
  if (drop) {
    addSlugToken(set, drop);
    drop.toLowerCase().split('_').forEach((p) => addSlugToken(set, p));
  }
  const origin = getPickupOrigin(detailTask);
  if (origin) {
    addSlugToken(set, origin);
    origin.toLowerCase().split('_').forEach((p) => addSlugToken(set, p));
  }
  return set;
}

function slugOverlaps(slugs, text) {
  const n = String(text || '').toLowerCase();
  if (!n) return false;
  const nCanon = normalizeVisitEventToken(n);
  for (const s of slugs) {
    if (!s || s.length < 2) continue;
    if (n === s || (n.length >= 3 && s.length >= 3 && (n.includes(s) || s.includes(n)))) return true;
    const sCanon = normalizeVisitEventToken(s);
    if (nCanon.length >= 3 && sCanon.length >= 3) {
      if (nCanon === sCanon || nCanon.includes(sCanon) || sCanon.includes(nCanon)) return true;
    }
  }
  return false;
}

/** Text after last `_to_` in a travel / composite task name */
function extractSegmentAfterTo(name) {
  const lower = String(name || '').toLowerCase();
  const key = '_to_';
  const idx = lower.lastIndexOf(key);
  if (idx < 0) return null;
  return String(name).slice(idx + key.length);
}

/**
 * From tail after `_to_`, get event-ish token.
 * e.g. "dropoff_at_dvintagevisit_denim" → "dvintagevisit"
 */
function eventTokenFromTravelTail(tail) {
  if (!tail) return null;
  const t = tail.toLowerCase();
  if (t.startsWith('dropoff_at_')) {
    // FIX: strip the trailing person token — same as getDropoffEvent
    const m = tail.match(/dropoff_at_(.+)_[^_]+$/i) || tail.match(/dropoff_at_(.+)$/i);
    if (m) return m[1];
  }
  const parts = tail.split('_');
  if (parts.length >= 2 && /^[a-z]{2,20}$/i.test(parts[parts.length - 1])) {
    return parts.slice(0, -1).join('_');
  }
  return tail;
}

function slugMatchesFullTaskName(slugs, task) {
  const raw = taskNameRaw(task);
  const lower = raw.toLowerCase();
  if (slugOverlaps(slugs, lower)) return true;
  for (const part of lower.split('_')) {
    if (part.length >= 3 && slugOverlaps(slugs, part)) return true;
  }
  const tail = extractSegmentAfterTo(raw);
  if (tail) {
    const ev = eventTokenFromTravelTail(tail);
    if (ev && slugOverlaps(slugs, ev)) return true;
    if (slugOverlaps(slugs, tail)) return true;
  }
  return false;
}

function timeOverlapsBufferedWindow(task, dStartMs, dEndMs, padMs) {
  const ts = new Date(task.start_lb).getTime();
  const te = new Date(task.end_lb).getTime();
  return ts <= dEndMs + padMs && te >= dStartMs - padMs;
}

function tasksAreSameEventRow(a, b) {
  if (a === b) return true;
  return taskNameRaw(a) === taskNameRaw(b) && String(a.start_lb) === String(b.start_lb);
}

/** Human-readable place / event name for “driving to …” */
function formatDestinationLabel(str) {
  if (!str) return null;
  return String(str).replace(/_/g, ' ').trim();
}

function normEventKey(s) {
  return normalizeVisitEventToken(String(s || '').toLowerCase());
}

/**
 * Find a real-world location for an event encoded in travel/dropoff names
 * (e.g. dvintagevisit → row `gvintagevisit` with location "Vintage").
 */
function resolveEventLocationFromSchedule(eventSlug, associatedTasks, allTasksForDay) {
  if (!eventSlug) return null;
  const target = normEventKey(String(eventSlug).toLowerCase());
  if (!target) return null;

  const pool = [];
  const add = (t) => {
    if (t && !pool.includes(t)) pool.push(t);
  };
  (associatedTasks || []).forEach(add);
  (allTasksForDay || []).forEach(add);

  for (const t of pool) {
    const loc = t.location != null && String(t.location).trim();
    if (!loc) continue;

    if (isDropoffTask(t)) {
      const ev = getDropoffEvent(t);
      if (ev && normEventKey(ev) === target) {
        return String(t.location).trim();
      }
    }

    if (isPresenceTask(t)) {
      const raw = taskNameRaw(t).toLowerCase();
      const first = raw.split('_')[0];
      if (normEventKey(raw) === target || normEventKey(first) === target) {
        return String(t.location).trim();
      }
    }
  }
  return null;
}

/** Where this travel row is headed: prefer visit/dropoff location from schedule, then travel.location, then slug text. */
function drivingDestinationFromTravelTask(task, associatedTasks, allTasksForDay) {
  if (!task) return null;
  const raw = taskNameRaw(task);
  const tail = extractSegmentAfterTo(raw);
  let eventKey = null;
  if (tail) {
    eventKey = eventTokenFromTravelTail(tail);
    if (!eventKey && tail.toLowerCase().startsWith('dropoff_at_')) {
      eventKey = getDropoffEvent({ task_name: tail });
    }
    if (!eventKey) {
      const parts = tail.split('_');
      eventKey = parts[0] || tail;
    }
  }

  if (eventKey) {
    const fromSchedule = resolveEventLocationFromSchedule(
      eventKey,
      associatedTasks,
      allTasksForDay
    );
    if (fromSchedule) return fromSchedule;
  }

  if (task.location != null && String(task.location).trim()) {
    return String(task.location).trim();
  }

  if (tail) {
    const ev = eventTokenFromTravelTail(tail);
    const label = ev || tail;
    const pretty = formatDestinationLabel(label);
    if (pretty) return pretty;
  }
  return null;
}

function dropoffLegMatchesDetailEvent(task, slugs, dStartMs, dEndMs) {
  if (!isDropoffTask(task)) return false;
  const ev = getDropoffEvent(task);
  if (ev && slugOverlaps(slugs, ev)) {
    return timeOverlapsBufferedWindow(task, dStartMs, dEndMs, 6 * 60 * 60 * 1000);
  }
  if (slugMatchesFullTaskName(slugs, task)) {
    return timeOverlapsBufferedWindow(task, dStartMs, dEndMs, 2 * 60 * 60 * 1000);
  }
  return false;
}

/**
 * FIX: Pickup tasks link to an event via the dropoff that follows them (via travel leg),
 * not by matching their *origin* to the event slug. So we match by time proximity:
 * the pickup ending within a reasonable window before the event start is the signal.
 * We also keep the slug fallback for names that do encode the destination.
 */
function pickupLegMatchesDetailEvent(task, slugs, dStartMs, dEndMs) {
  if (!isPickupTask(task)) return false;

  // Does the pickup name somehow reference the destination event? (less common)
  if (slugMatchesFullTaskName(slugs, task)) {
    return timeOverlapsBufferedWindow(task, dStartMs, dEndMs, 3 * 60 * 60 * 1000);
  }

  // Main case: pickup ends within 3h before event starts (it's delivering someone TO this event)
  const te = new Date(task.end_lb).getTime();
  if (te >= dStartMs - 3 * 60 * 60 * 1000 && te <= dStartMs + 60 * 60 * 1000) {
    return true;
  }

  return false;
}

function travelLegMatchesDetailEvent(task, slugs, dStartMs, dEndMs) {
  if (!isTravelCapabilityTask(task)) return false;
  const raw = taskNameRaw(task);

  // Only match travel legs whose encoded destination slug matches the clicked event.
  // The destination is always encoded after the last `_to_` segment.
  // We do NOT fall back to a loose time-window here — that would pull in travel
  // for adjacent events that happen to be near the same time window.
  const tail = extractSegmentAfterTo(raw);
  if (tail) {
    const ev = eventTokenFromTravelTail(tail);
    if (ev && slugOverlaps(slugs, ev)) return true;
    if (slugOverlaps(slugs, tail)) return true;
  }

  // Secondary: the full task name itself contains the event slug
  // (handles travel tasks named differently, e.g. "travel_gvintagevisit")
  if (slugMatchesFullTaskName(slugs, task)) return true;

  return false;
}

function transportLegMatchesDetailEvent(task, slugs, dStartMs, dEndMs) {
  if (!isTransportCapabilityTask(task)) return false;
  if (isPickupTask(task) || isDropoffTask(task)) return false;
  if (slugMatchesFullTaskName(slugs, task)) {
    return timeOverlapsBufferedWindow(task, dStartMs, dEndMs, 3 * 60 * 60 * 1000);
  }
  return timeOverlapsBufferedWindow(task, dStartMs, dEndMs, 50 * 60 * 1000);
}

function taskAssociatedWithDetailEvent(t, detailTask, slugs) {
  if (tasksAreSameEventRow(t, detailTask)) return true;
  const dStartMs = new Date(detailTask.start_lb).getTime();
  const dEndMs = new Date(detailTask.end_lb).getTime();
  if (dropoffLegMatchesDetailEvent(t, slugs, dStartMs, dEndMs)) return true;
  if (pickupLegMatchesDetailEvent(t, slugs, dStartMs, dEndMs)) return true;
  if (travelLegMatchesDetailEvent(t, slugs, dStartMs, dEndMs)) return true;
  if (transportLegMatchesDetailEvent(t, slugs, dStartMs, dEndMs)) return true;
  return false;
}

function userInvolvedInLeg(task, user) {
  if (!user) return true;
  const u = String(user).toLowerCase();
  const transported = getTransportedPerson(task);
  return resourceRaw(task).toLowerCase() === u || (transported && transported.toLowerCase() === u);
}

/**
 * Build modal transport lines scoped to the anchor task + logged-in user.
 *
 * @param {object} detailTask - anchor row (presence event or travel leg in a cluster)
 * @param {string|null|undefined} currentUser
 * @param {object[]} allTasksForDay - same-calendar-day tasks used when `scopeTasks` is omitted
 * @param {(iso: string) => string} formatTime
 * @param {object[]|null|undefined} scopeTasks - when set (e.g. `travelGroup.tasks`), only these
 *   rows are analyzed so another trip’s pickup/dropoff times are not mixed in.
 */
export function buildDetailPopupTransportInfo(detailTask, currentUser, allTasksForDay, formatTime, scopeTasks) {
  const fmt = (iso) => (iso ? formatTime(iso) : '—');
  const user = String(currentUser ?? '').toLowerCase();

  if (!user) {
    console.warn(
      '[buildDetailPopupTransportInfo] currentUser is empty/null — transport info will be blank. ' +
      'Make sure the logged-in resource name is passed as currentUser.'
    );
  }

  const buckets = {
    pickingUp: [],
    pickedUpBy: [],
    droppedOffBy: [],
    droppingOff: [],
  };

  const pushUnique = (key, line) => {
    if (!line) return;
    if (!buckets[key].includes(line)) buckets[key].push(line);
  };

  // For pickingUp / droppingOff, deduplicate by person name regardless of time.
  // This prevents the same person appearing twice when both a transport capability
  // leg and a pickup leg fire for the same real-world trip.
  const personAlreadyInBucket = (key, personName) => {
    const p = personName.toLowerCase();
    return buckets[key].some((line) => line.toLowerCase().startsWith(p + ' '));
  };

  const slugs = buildEventSlugSet(detailTask);

  const associatedTasks =
    Array.isArray(scopeTasks) && scopeTasks.length > 0
      ? [...scopeTasks]
      : (allTasksForDay || []).filter((t) => taskAssociatedWithDetailEvent(t, detailTask, slugs));

  // Earliest travel start for this user among associated tasks (scoped cluster = correct window).
  let drivingStartMs = null;
  let drivingStartTime = null;
  let drivingDestination = null;

  const noteDrivingTravel = (task) => {
    if (!isTravelCapabilityTask(task) || resourceRaw(task).toLowerCase() !== user) return;
    const ts = new Date(task.start_lb).getTime();
    if (drivingStartMs == null || ts < drivingStartMs) {
      drivingStartMs = ts;
      drivingStartTime = fmt(task.start_lb);
      drivingDestination = drivingDestinationFromTravelTask(task, associatedTasks, allTasksForDay);
    }
  };

  // Sanity-check that a "person" name extracted from a task name is actually
  // a person and not a presence task id leaking through (e.g. "gvintagevisit").
  // Real person tokens are short, all-alpha, no visit/event keywords.
  const looksLikePerson = (token) => {
    if (!token || token.length < 2 || token.length > 30) return false;
    // Reject if it matches a known event-id pattern (g/d prefix + long alpha string)
    const t = token.toLowerCase();
    if (/^[gd][a-z]{5,}/.test(t)) return false;
    // Reject if it contains digits (downtime ids like "5520")
    if (/\d/.test(t)) return false;
    return true;
  };

  const consider = (task) => {
    if (!task) return;
    if (!tasksAreSameEventRow(task, detailTask) && !userInvolvedInLeg(task, user)) return;

    // Travel leg — earliest start among scoped tasks sets DRIVING time
    if (isTravelCapabilityTask(task) && resourceRaw(task).toLowerCase() === user) {
      noteDrivingTravel(task);
    }

    // Transport capability leg — user is driving someone to this event
    if (isDriverOrTransportLeg(task, currentUser) && isTransportCapabilityTask(task)) {
      const who = getTransportedPerson(task);
      if (
        who &&
        looksLikePerson(who) &&
        who.toLowerCase() !== user &&
        !personAlreadyInBucket('pickingUp', who)
      ) {
        pushUnique('pickingUp', `${who} at ${fmt(task.start_lb)}`);
      }
    }

    // Pickup leg — only count it if this pickup is for THIS event
    if (isPickupTask(task)) {
      const who = getTransportedPerson(task);
      const res = resourceRaw(task).toLowerCase();

      if (res === user) {
        if (
          who &&
          looksLikePerson(who) &&
          who.toLowerCase() !== user &&
          !personAlreadyInBucket('pickingUp', who)
        ) {
          pushUnique('pickingUp', `${who} at ${fmt(task.start_lb)}`);
        }
      }
      if (who && who.toLowerCase() === user && res && res !== user) {
        pushUnique('pickedUpBy', `${resourceRaw(task)} at ${fmt(task.start_lb)}`);
      }
    }

    // Dropoff leg — only count if this dropoff is for THIS event
    if (isDropoffTask(task)) {
      const dest = getDropoffEvent(task);
      const who = getTransportedPerson(task);
      const res = resourceRaw(task).toLowerCase();

      if (
        res === user &&
        who &&
        looksLikePerson(who) &&
        who.toLowerCase() !== user &&
        !personAlreadyInBucket('droppingOff', who)
      ) {
        pushUnique('droppingOff', `${who}${dest ? ` → ${dest}` : ''} at ${fmt(task.start_lb)}`);
      }
      if (who && who.toLowerCase() === user && res && res !== user) {
        pushUnique('droppedOffBy', `${resourceRaw(task)} at ${fmt(task.start_lb)}`);
      }
    }
  };

  for (const t of associatedTasks) consider(t);

  const na = ['N/A'];
  const join = (arr) => (arr.length ? arr : na);

  const isBeingPickedUp = buckets.pickedUpBy.length > 0;
  const isBeingDroppedOff = buckets.droppedOffBy.length > 0;
  const isPassenger = isBeingPickedUp || isBeingDroppedOff;
  // User is driving if they have a travel leg OR are picking/dropping someone else
  const isDriving =
    drivingStartMs != null || buckets.pickingUp.length > 0 || buckets.droppingOff.length > 0;

  let drivingDisplay = drivingStartTime;
  if (isDriving && drivingDisplay == null) {
    const legs = associatedTasks.filter(
      (t) =>
        resourceRaw(t).toLowerCase() === user &&
        (isPickupTask(t) ||
          isDropoffTask(t) ||
          (isTransportCapabilityTask(t) && !isTravelCapabilityTask(t)))
    );
    legs.sort((a, b) => new Date(a.start_lb) - new Date(b.start_lb));
    if (legs[0]) drivingDisplay = fmt(legs[0].start_lb);
  }

  // If no `_to_` destination yet (e.g. driving time came from pickup only), infer from dropoff row
  if (isDriving && !drivingDestination) {
    const travelLegs = associatedTasks.filter(
      (t) => isTravelCapabilityTask(t) && resourceRaw(t).toLowerCase() === user
    );
    travelLegs.sort((a, b) => new Date(a.start_lb) - new Date(b.start_lb));
    if (travelLegs[0]) {
      drivingDestination = drivingDestinationFromTravelTask(
        travelLegs[0],
        associatedTasks,
        allTasksForDay
      );
    }
  }
  if (isDriving && !drivingDestination) {
    const dropoffs = associatedTasks
      .filter((t) => isDropoffTask(t) && resourceRaw(t).toLowerCase() === user)
      .sort((a, b) => new Date(a.start_lb) - new Date(b.start_lb));
    const d0 = dropoffs[0];
    if (d0) {
      const ev = getDropoffEvent(d0);
      drivingDestination =
        (ev && resolveEventLocationFromSchedule(ev, associatedTasks, allTasksForDay)) ||
        (d0.location && String(d0.location).trim()) ||
        (ev && formatDestinationLabel(ev)) ||
        null;
    }
  }

  const drivingLine =
    isDriving && (drivingDisplay != null || drivingDestination)
      ? `${drivingDisplay ?? 'Yes'}${drivingDestination ? ` → ${drivingDestination}` : ''}`
      : isDriving
        ? (drivingDisplay ?? 'Yes')
        : 'N/A';

  return {
    drivingLines: [drivingLine],
    pickingUpLines: isPassenger ? na : join(buckets.pickingUp),
    droppingOffLines: isPassenger ? na : join(buckets.droppingOff),
    pickedUpByLines: isDriving ? na : join(buckets.pickedUpBy),
    droppedOffByLines: isDriving ? na : join(buckets.droppedOffBy),
    // summaryLine: getReadableTaskRelationship(detailTask, user),
  };
}