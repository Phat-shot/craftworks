'use strict';
// ═══════════════════════════════════════════════════════════
//  SCHNITZELJAGD ("Hunt") — minimal server-side engine for the scavenger-
//  hunt game mode. Foundation only (see this session's plan): a state
//  machine over POI arrival/task-completion/timeout, NOT a continuous
//  GPS/compass tick loop like arops.js — there's no shooting, no cone
//  math, just "did the player/team reach the next POI(s), and did they
//  complete whatever it needs before any deadline passed". No DB wiring
//  in this module — it's pure and directly unit-testable, same spirit as
//  arops.js's own action functions. Socket wiring lives in
//  server/src/socket/hunt.js (currently sandbox-only, in-memory runs).
//
//  Terminology mirrors the DB schema (server/src/db/schema.sql):
//    scenario  — the reusable template (POIs + routes + config)
//    run       — one concrete play-through of a scenario
//    progress  — one track within a run: the whole group ('shared'),
//                one team letter, or one player, per run.progressMode
//    group     — POIs sharing the same order_index are worked in any
//                order/simultaneously ("parallel tasks"); a track only
//                advances past a group once every POI in it is done. A
//                fully sequential scenario is simply every group being
//                size 1 — the original, only behavior before this existed.
// ═══════════════════════════════════════════════════════════
const shared = require('@craftworks/arops-shared');

function now() { return Date.now(); }

/**
 * Builds an in-memory run from already-loaded DB rows (scenario, its POIs
 * sorted by order_index, its routes, and the initial roster) — no DB
 * access happens inside this module at all, same "engine is pure, the
 * socket layer does the I/O" split arops.js follows.
 */
function createHuntRun({ runId, scenario, pois, routes, players, progressMode }) {
  if (!pois.length) throw new Error('scenario_has_no_pois');
  const sortedPois = [...pois].sort((a, b) => a.order_index - b.order_index);
  // Group consecutive (already order_index-sorted) POIs sharing the same
  // order_index into one "parallel group" — see module header.
  const groups = [];
  for (const poi of sortedPois) {
    const last = groups[groups.length - 1];
    if (last && last.orderIndex === poi.order_index) last.pois.push(poi);
    else groups.push({ orderIndex: poi.order_index, pois: [poi] });
  }
  const routeByLeg = new Map(routes.map(r => [`${r.from_poi_id}->${r.to_poi_id}`, r]));

  const run = {
    runId, scenarioId: scenario.id,
    progressMode: progressMode || scenario.config?.progressMode || 'shared',
    groups,
    routeByLeg,
    progress: {},
    events: [], _eventSeq: 0,
    startedAt: now(),
    endedAt: null,
  };

  const keys = progressKeysFor(run, players);
  for (const key of keys) startProgressTrack(run, key);
  return run;
}

/** Which progress_key(s) a fresh roster starts with, per progressMode. */
function progressKeysFor(run, players) {
  if (run.progressMode === 'shared') return ['shared'];
  if (run.progressMode === 'teams') {
    return [...new Set(players.map(p => p.team).filter(Boolean))];
  }
  return players.map(p => p.userId); // 'individual'
}

function startProgressTrack(run, key, atGroupIdx = 0) {
  const track = {
    key, groupIdx: atGroupIdx,
    poiState: {},         // poiId -> { arrivedAt, taskDeadlineAt } — only the current group's POIs
    completedPoiIds: [],  // completed within the CURRENT group, reset on group advance
    state: {},            // misc scratch: the entering leg's route, accumulated penaltyMs
    startedAt: now(), completedAt: null,
    legDeadlineAt: null,
    routeDeviation: false,
  };
  run.progress[key] = track;
  armGroupTaskDeadlines(run, track); // the starting group's own task timers, if any
  return track;
}

function pushEvent(run, type, data) {
  run.events.push({ seq: ++run._eventSeq, ts: now(), type, ...data });
}

function currentGroup(run, track) { return run.groups[track.groupIdx] || null; }
/** All POIs currently workable by this track — usually 1, >1 inside a parallel group. */
function currentPois(run, track) { return currentGroup(run, track)?.pois || []; }

function armGroupTaskDeadlines(run, track) {
  for (const poi of currentPois(run, track)) {
    track.poiState[poi.id] = {
      arrivedAt: null,
      taskDeadlineAt: poi.task_time_limit_ms ? now() + poi.task_time_limit_ms : null,
    };
  }
}

function armLegDeadline(run, track, fromPoi, toPoi) {
  const route = run.routeByLeg.get(`${fromPoi.id}->${toPoi.id}`);
  track.legDeadlineAt = route?.travel_time_limit_ms ? now() + route.travel_time_limit_ms : null;
  return route;
}

/**
 * Geofence check: is `sample` (a telemetry-style {lat,lon}) within any of
 * the CURRENT group's not-yet-completed POI radii for this progress track?
 * Reuses the shared haversine math (packages/arops-shared) rather than
 * reimplementing distance — same source of truth arops.js's own zone
 * checks use. Does not itself complete a puzzle/target POI's task (see
 * submitPuzzleAnswer/confirmTargetDestroyed) — just answers "are they
 * there", except for 'base' POIs, which need nothing beyond arrival.
 * Returns true if arrived at (at least) one of them.
 */
function checkArrival(run, key, sample) {
  const track = run.progress[key];
  if (!track || track.completedAt) return false;
  let anyArrived = false;
  for (const poi of currentPois(run, track)) {
    if (track.completedPoiIds.includes(poi.id)) continue;
    const ps = track.poiState[poi.id] || (track.poiState[poi.id] = { arrivedAt: null, taskDeadlineAt: null });
    const arrived = shared.haversineMeters(sample, poi) <= poi.radius_m;
    if (!arrived) continue;
    anyArrived = true;
    if (!ps.arrivedAt) {
      ps.arrivedAt = now();
      pushEvent(run, 'poi_arrived', { key, poiId: poi.id });
      // Arrival-only types — reaching them IS the objective, no separate
      // task to complete: 'base' (finish/checkpoint), and the 2 halves of
      // a "carry from A to B" action (carry_from = pick up at A, carry_to
      // = arrive at B with it — modeled as a plain sequential pair of
      // arrival POIs, same "reaching it is the objective" idea as walking
      // a dropped flag onto a base in CTF, no separate carry state needed
      // since the engine already enforces A must be completed before B
      // becomes current).
      if (AUTO_COMPLETE_TYPES.has(poi.poi_type)) completePoiForTrack(run, track, poi);
    }
  }
  return anyArrived;
}

/**
 * Checks a submitted answer against a puzzle POI's puzzle_config — 3 types,
 * the web editor's puzzle sub-editor (HuntEditor.jsx) is the only writer of
 * this shape:
 *  'text'   (default, backward compatible with the original string-only
 *            shape) — case-insensitive string equality.
 *  'choice' — answer is the selected option's index, compared to
 *             puzzle_config.correctIndex.
 *  'number' — answer compared to puzzle_config.answer within an optional
 *             puzzle_config.tolerance (default 0, exact match).
 */
function checkPuzzleAnswer(poi, answer) {
  const cfg = poi.puzzle_config || {};
  if (cfg.type === 'choice') {
    const idx = typeof answer === 'number' ? answer : parseInt(answer, 10);
    return Number.isFinite(idx) && idx === cfg.correctIndex;
  }
  if (cfg.type === 'number') {
    const n = typeof answer === 'number' ? answer : parseFloat(answer);
    if (!Number.isFinite(n) || typeof cfg.answer !== 'number') return false;
    const tolerance = Number.isFinite(cfg.tolerance) ? cfg.tolerance : 0;
    return Math.abs(n - cfg.answer) <= tolerance;
  }
  const expected = cfg.answer;
  return typeof expected === 'string' && typeof answer === 'string'
    ? expected.trim().toLowerCase() === answer.trim().toLowerCase()
    : expected === answer;
}

/**
 * Completes a 'puzzle' POI's task — checks `answer` against the POI's
 * configured answer (see checkPuzzleAnswer). `poiId` picks which of the
 * current group's POIs this answer is for (only ambiguous inside a
 * parallel group with more than one puzzle active at once).
 */
function submitPuzzleAnswer(run, key, poiId, answer) {
  const track = run.progress[key];
  if (!track || track.completedAt) return { ok: false, err: 'no_active_progress' };
  const poi = currentPois(run, track).find(p => p.id === poiId);
  if (!poi || poi.poi_type !== 'puzzle') return { ok: false, err: 'not_a_puzzle' };
  if (track.completedPoiIds.includes(poi.id)) return { ok: false, err: 'already_completed' };
  if (!track.poiState[poi.id]?.arrivedAt) return { ok: false, err: 'not_at_poi' };
  const correct = checkPuzzleAnswer(poi, answer);
  if (!correct) {
    pushEvent(run, 'puzzle_wrong', { key, poiId: poi.id });
    return { ok: true, correct: false };
  }
  completePoiForTrack(run, track, poi);
  return { ok: true, correct: true };
}

// POI types where reaching the radius alone completes the task (see
// checkArrival above) vs. types needing an explicit follow-up action
// (submitPuzzleAnswer for 'puzzle', confirmTask below for 'target'/
// 'capture' — kept as 2 separate type strings for the editor's action
// picker ("Zerstören" vs "Capture") even though they're mechanically
// identical: arrive, then explicitly confirm).
const AUTO_COMPLETE_TYPES = new Set(['base', 'carry_from', 'carry_to']);
const CONFIRM_TYPES = new Set(['target', 'capture']);

/** Completes a 'target'/'capture' POI's task — an explicit confirmation after arrival. */
function confirmTask(run, key, poiId) {
  const track = run.progress[key];
  if (!track || track.completedAt) return { ok: false, err: 'no_active_progress' };
  const poi = currentPois(run, track).find(p => p.id === poiId);
  if (!poi || !CONFIRM_TYPES.has(poi.poi_type)) return { ok: false, err: 'not_confirmable' };
  if (track.completedPoiIds.includes(poi.id)) return { ok: false, err: 'already_completed' };
  if (!track.poiState[poi.id]?.arrivedAt) return { ok: false, err: 'not_at_poi' };
  completePoiForTrack(run, track, poi);
  return { ok: true };
}
// Back-compat alias — 'target' was the only confirm-type before 'capture'
// existed, keep the old name working for any existing call site.
const confirmTargetDestroyed = confirmTask;

/**
 * Marks one POI done for this track. Once every POI in the current group
 * is done, the whole group completes and the track advances (see
 * advanceGroup) — until then, this just records that one POI and leaves
 * the rest of the group exactly as it was (the parallel-tasks case).
 */
function completePoiForTrack(run, track, poi) {
  pushEvent(run, 'poi_completed', { key: track.key, poiId: poi.id });
  track.completedPoiIds.push(poi.id);
  delete track.poiState[poi.id];
  const group = currentGroup(run, track);
  if (!group || !group.pois.every(p => track.completedPoiIds.includes(p.id))) return;
  advanceGroup(run, track, group);
}

/** Advances a track past its now-fully-completed group to the next one. */
function advanceGroup(run, track, finishedGroup) {
  track.completedPoiIds = [];
  const nextGroup = run.groups[track.groupIdx + 1];
  if (!nextGroup) {
    track.completedAt = now();
    track.legDeadlineAt = null;
    pushEvent(run, 'progress_finished', { key: track.key });
    if (Object.values(run.progress).every(t => t.completedAt)) {
      run.endedAt = now();
      pushEvent(run, 'run_ended', {});
    }
    return;
  }
  track.groupIdx += 1;
  track.routeDeviation = false;
  track.state.route = null;
  track.legDeadlineAt = null;
  // Route/leg-deadline enforcement only has a clean single-path meaning
  // between two SEQUENTIAL (size-1) groups — a fan-out/fan-in parallel
  // group has no single "the path" between it and the next group, so legs
  // simply aren't armed/enforced around one; this is a scope decision, not
  // a schema limitation (hunt_routes stays POI-to-POI either way).
  if (finishedGroup.pois.length === 1 && nextGroup.pois.length === 1) {
    const route = armLegDeadline(run, track, finishedGroup.pois[0], nextGroup.pois[0]);
    track.state.route = route || null;
  }
  armGroupTaskDeadlines(run, track);
}

/**
 * Strict-route deviation check — point-to-polyline distance in meters,
 * flat-approximation (interpolate along each segment in lat/lon space,
 * haversine to the interpolated point) — adequate at POI-to-POI leg
 * scale, not survey-grade. Only meaningful while route.enforcement ===
 * 'strict' and route.route_type === 'defined'; 'guidance' routes, freeform
 * legs, and legs entering/leaving a parallel group never call this (see
 * tickHunt / advanceGroup above).
 */
function distanceToPolylineM(point, pathPoints) {
  if (!pathPoints || pathPoints.length < 2) return 0;
  let best = Infinity;
  for (let i = 0; i < pathPoints.length - 1; i++) {
    const a = pathPoints[i], b = pathPoints[i + 1];
    const dx = b.lat - a.lat, dy = b.lon - a.lon;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? ((point.lat - a.lat) * dx + (point.lon - a.lon) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const proj = { lat: a.lat + t * dx, lon: a.lon + t * dy };
    best = Math.min(best, shared.haversineMeters(point, proj));
  }
  return best;
}

const STRICT_ROUTE_TOLERANCE_M = 25;

/**
 * Per-tick housekeeping: strict-route deviation flagging + task/leg
 * timeout dispatch. Call at whatever cadence the socket layer polls
 * telemetry at — deliberately NOT tied to a fixed tick rate here, this
 * module has no timers of its own (mirrors arops.js's tickArops being
 * externally driven by worker.js, not self-scheduling).
 */
function tickHunt(run, samplesByKey = {}) {
  if (run.endedAt) return;
  const t = now();
  for (const track of Object.values(run.progress)) {
    if (track.completedAt) continue;
    const sample = samplesByKey[track.key];
    if (sample && track.state.route?.route_type === 'defined'
        && track.state.route?.enforcement === 'strict' && track.state.route?.path_geojson) {
      const dist = distanceToPolylineM(sample, track.state.route.path_geojson);
      const deviated = dist > STRICT_ROUTE_TOLERANCE_M;
      if (deviated && !track.routeDeviation) pushEvent(run, 'route_deviation', { key: track.key });
      track.routeDeviation = deviated;
    }
    // Per-POI task deadlines within the current group — iterates a
    // snapshot of the group taken before this loop; if a timeout
    // cascades the track into a NEW group mid-loop, any leftover old-group
    // POIs simply no-op (their poiState entry is already gone) and the new
    // group's own deadlines get picked up on the next tick, never this one.
    for (const poi of currentPois(run, track)) {
      if (track.completedAt) break;
      if (track.completedPoiIds.includes(poi.id)) continue;
      const ps = track.poiState[poi.id];
      if (ps?.taskDeadlineAt && t >= ps.taskDeadlineAt) {
        dispatchTimeout(run, track, poi, poi.timeout_action, 'task');
      }
    }
    if (track.completedAt) continue;
    if (track.legDeadlineAt && t >= track.legDeadlineAt) {
      dispatchTimeout(run, track, null, track.state.route?.timeout_action, 'leg');
      track.legDeadlineAt = null;
    }
  }
}

/**
 * JSONB-configured timeout action — {type:'skip'|'fail'|'time_penalty',
 * penaltyMs}. `poi` is the specific POI that timed out for a 'task'
 * timeout (always set); null for a 'leg' timeout, whose 'skip' instead
 * force-completes every still-pending POI in the current group so the
 * track can move on, same "leave the leg without ever finishing the task"
 * semantics a single-POI group always had.
 */
function dispatchTimeout(run, track, poi, action, kind) {
  const type = action?.type || 'skip';
  pushEvent(run, 'timeout', { key: track.key, kind, poiId: poi?.id ?? null, action: type });
  if (type === 'skip') {
    if (poi) {
      completePoiForTrack(run, track, poi);
    } else {
      const group = currentGroup(run, track);
      for (const p of (group?.pois || [])) {
        if (track.completedAt) break;
        if (!track.completedPoiIds.includes(p.id)) completePoiForTrack(run, track, p);
      }
    }
  } else if (type === 'fail') {
    track.completedAt = now();
    track.legDeadlineAt = null;
    pushEvent(run, 'progress_failed', { key: track.key });
  } else if (type === 'time_penalty') {
    track.state.penaltyMs = (track.state.penaltyMs || 0) + (action.penaltyMs || 0);
  }
}

/**
 * Late-join handling — a player joining after the run has already started:
 *  'shared'   — hangs directly off the existing group/team track (no new
 *               row, same key everyone else on that track already uses).
 *  'clone'    — copies another player's current progress into a NEW track
 *               keyed to the joiner, same group/POI state, independent
 *               from then on.
 *  'fresh'    — starts a brand-new track at group 0.
 */
function joinHuntRun(run, userId, mode, opts = {}) {
  if (mode === 'shared') {
    const key = run.progressMode === 'teams' ? opts.team : 'shared';
    if (!key || !run.progress[key]) return { ok: false, err: 'no_such_progress' };
    return { ok: true, key };
  }
  if (mode === 'clone') {
    const source = run.progress[opts.cloneFromKey];
    if (!source) return { ok: false, err: 'no_such_progress' };
    if (run.progress[userId]) return { ok: false, err: 'already_joined' };
    const track = startProgressTrack(run, userId, source.groupIdx);
    track.poiState = JSON.parse(JSON.stringify(source.poiState));
    track.completedPoiIds = [...source.completedPoiIds];
    track.state = { ...source.state };
    track.legDeadlineAt = source.legDeadlineAt;
    pushEvent(run, 'progress_cloned', { key: userId, fromKey: opts.cloneFromKey });
    return { ok: true, key: userId };
  }
  if (mode === 'fresh') {
    if (run.progress[userId]) return { ok: false, err: 'already_joined' };
    startProgressTrack(run, userId);
    pushEvent(run, 'progress_started', { key: userId });
    return { ok: true, key: userId };
  }
  return { ok: false, err: 'unknown_join_mode' };
}

module.exports = {
  createHuntRun, checkArrival, submitPuzzleAnswer, confirmTask, confirmTargetDestroyed,
  tickHunt, joinHuntRun, distanceToPolylineM,
  // Exported for the live (DB-backed, multi-socket) socket layer to
  // bootstrap a 'teams' track lazily the first time either side actually
  // gets a player — joinHuntRun's 'shared' mode (the only late-join path
  // that targets a team key) requires the team's track to already exist,
  // which doesn't hold for a real run built up one joiner at a time.
  startProgressTrack,
};
