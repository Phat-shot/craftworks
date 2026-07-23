'use strict';
// ═══════════════════════════════════════════════════════════
//  SCHNITZELJAGD ("Hunt") — minimal server-side engine for the scavenger-
//  hunt game mode. Foundation only (see this session's plan): a state
//  machine over POI arrival/task-completion/timeout, NOT a continuous
//  GPS/compass tick loop like arops.js — there's no shooting, no cone
//  math, just "did the player/team reach the next POI, and did they
//  complete whatever it needs before any deadline passed". No socket/
//  worker wiring yet — this module is pure and directly unit-testable,
//  same spirit as arops.js's own action functions.
//
//  Terminology mirrors the DB schema (server/src/db/schema.sql):
//    scenario  — the reusable template (POIs + routes + config)
//    run       — one concrete play-through of a scenario
//    progress  — one track within a run: the whole group ('shared'),
//                one team letter, or one player, per run.progressMode
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
  const routeByLeg = new Map(routes.map(r => [`${r.from_poi_id}->${r.to_poi_id}`, r]));

  const run = {
    runId, scenarioId: scenario.id,
    progressMode: progressMode || scenario.config?.progressMode || 'shared',
    pois: sortedPois,
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

function startProgressTrack(run, key, atPoiIndex = 0) {
  const track = {
    key, currentPoiIndex: atPoiIndex,
    state: {},
    startedAt: now(), completedAt: null,
    taskDeadlineAt: null, legDeadlineAt: null,
    routeDeviation: false,
  };
  run.progress[key] = track;
  armTaskDeadline(run, track); // the starting POI's own task timer, if any
  return track;
}

function pushEvent(run, type, data) {
  run.events.push({ seq: ++run._eventSeq, ts: now(), type, ...data });
}

function currentPoi(run, track) { return run.pois[track.currentPoiIndex] || null; }

function armTaskDeadline(run, track) {
  const poi = currentPoi(run, track);
  track.taskDeadlineAt = poi?.task_time_limit_ms ? now() + poi.task_time_limit_ms : null;
}

function armLegDeadline(run, track, fromPoi, toPoi) {
  const route = run.routeByLeg.get(`${fromPoi.id}->${toPoi.id}`);
  track.legDeadlineAt = route?.travel_time_limit_ms ? now() + route.travel_time_limit_ms : null;
  return route;
}

/**
 * Geofence check: is `sample` (a telemetry-style {lat,lon}) within the
 * CURRENT poi's radius for this progress track? Reuses the shared
 * haversine math (packages/arops-shared) rather than reimplementing
 * distance — same source of truth arops.js's own zone checks use.
 * Does not itself advance progress (a puzzle/target POI still needs its
 * own task completed, see advanceProgress) — just answers "are they there".
 */
function checkArrival(run, key, sample) {
  const track = run.progress[key];
  if (!track || track.completedAt) return false;
  const poi = currentPoi(run, track);
  if (!poi) return false;
  const arrived = shared.haversineMeters(sample, poi) <= poi.radius_m;
  if (arrived && !track.state.arrivedAt) {
    track.state.arrivedAt = now();
    pushEvent(run, 'poi_arrived', { key, poiId: poi.id });
    // 'base' POIs need nothing beyond arrival itself (see this module's
    // header doc / the plan's "Flag-Carry" framing) — reaching it IS the
    // objective, same as walking a dropped flag onto a base in CTF.
    if (poi.poi_type === 'base') completePoi(run, track);
  }
  return arrived;
}

/**
 * Completes a 'puzzle' POI's task — checks `answer` against the POI's
 * configured answer (string/number equality, case-insensitive for
 * strings — good enough for the foundation; a richer puzzle_config shape
 * is a web-editor-milestone concern, not an engine one).
 */
function submitPuzzleAnswer(run, key, answer) {
  const track = run.progress[key];
  if (!track || track.completedAt) return { ok: false, err: 'no_active_progress' };
  const poi = currentPoi(run, track);
  if (!poi || poi.poi_type !== 'puzzle') return { ok: false, err: 'not_a_puzzle' };
  if (!track.state.arrivedAt) return { ok: false, err: 'not_at_poi' };
  const expected = poi.puzzle_config?.answer;
  const correct = typeof expected === 'string' && typeof answer === 'string'
    ? expected.trim().toLowerCase() === answer.trim().toLowerCase()
    : expected === answer;
  if (!correct) {
    pushEvent(run, 'puzzle_wrong', { key, poiId: poi.id });
    return { ok: true, correct: false };
  }
  completePoi(run, track);
  return { ok: true, correct: true };
}

/** Completes a 'target' POI's task — an explicit "destroyed" confirmation. */
function confirmTargetDestroyed(run, key) {
  const track = run.progress[key];
  if (!track || track.completedAt) return { ok: false, err: 'no_active_progress' };
  const poi = currentPoi(run, track);
  if (!poi || poi.poi_type !== 'target') return { ok: false, err: 'not_a_target' };
  if (!track.state.arrivedAt) return { ok: false, err: 'not_at_poi' };
  completePoi(run, track);
  return { ok: true };
}

/** Advances a track past its current (now-completed) POI to the next leg. */
function completePoi(run, track) {
  const poi = currentPoi(run, track);
  pushEvent(run, 'poi_completed', { key: track.key, poiId: poi.id });
  track.state = {};
  track.taskDeadlineAt = null;
  const next = run.pois[track.currentPoiIndex + 1];
  if (!next) {
    track.completedAt = now();
    track.legDeadlineAt = null;
    pushEvent(run, 'progress_finished', { key: track.key });
    if (Object.values(run.progress).every(t => t.completedAt)) {
      run.endedAt = now();
      pushEvent(run, 'run_ended', {});
    }
    return;
  }
  track.currentPoiIndex += 1;
  const route = armLegDeadline(run, track, poi, next);
  track.routeDeviation = false;
  track.state.route = route || null;
}

/**
 * Strict-route deviation check — point-to-polyline distance in meters,
 * flat-approximation (interpolate along each segment in lat/lon space,
 * haversine to the interpolated point) — adequate at POI-to-POI leg
 * scale, not survey-grade. Only meaningful while route.enforcement ===
 * 'strict' and route.route_type === 'defined'; 'guidance' routes and
 * freeform legs never call this (see tickHunt).
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
 * timeout dispatch. Call at whatever cadence the (future) socket layer
 * polls telemetry at — deliberately NOT tied to a fixed tick rate here,
 * this module has no timers of its own (mirrors arops.js's tickArops
 * being externally driven by worker.js, not self-scheduling).
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
    if (track.taskDeadlineAt && t >= track.taskDeadlineAt) {
      dispatchTimeout(run, track, currentPoi(run, track)?.timeout_action, 'task');
      if (track.completedAt) continue;
      track.taskDeadlineAt = null;
    }
    if (track.legDeadlineAt && t >= track.legDeadlineAt) {
      dispatchTimeout(run, track, track.state.route?.timeout_action, 'leg');
      track.legDeadlineAt = null;
    }
  }
}

/** JSONB-configured timeout action — {type:'skip'|'fail'|'time_penalty', penaltyMs}. */
function dispatchTimeout(run, track, action, kind) {
  const type = action?.type || 'skip';
  pushEvent(run, 'timeout', { key: track.key, kind, action: type });
  if (type === 'skip') {
    completePoi(run, track);
  } else if (type === 'fail') {
    track.completedAt = now();
    track.taskDeadlineAt = null;
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
 *               keyed to the joiner, same POI/state, independent from then on.
 *  'fresh'    — starts a brand-new track at POI 1.
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
    const track = startProgressTrack(run, userId, source.currentPoiIndex);
    track.state = { ...source.state };
    track.taskDeadlineAt = source.taskDeadlineAt;
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
  createHuntRun, checkArrival, submitPuzzleAnswer, confirmTargetDestroyed,
  tickHunt, joinHuntRun, distanceToPolylineM,
};
