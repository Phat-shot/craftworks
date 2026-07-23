'use strict';
// ═══════════════════════════════════════════════════════════
//  SCHNITZELJAGD SANDBOX — socket wiring for testing the hunt.js engine
//  end-to-end. Deliberately NOT the real play flow (no hunt_scenarios/
//  hunt_sessions/hunt_runs DB rows, no scan-code join, no web editor —
//  none of that exists yet, see server/src/db/schema.sql's Schnitzeljagd
//  block and hunt.js's own header). This is the Hunt equivalent of AR
//  Ops's Match-Simulation (apps/arops-mobile/src/screens/MatchSimScreen.tsx):
//  a developer/tester tool that exercises the real, unmodified engine
//  (server/src/game/hunt.js) against a fixed built-in scenario, anchored to
//  wherever the tester currently is so no field-drawing step is needed.
//
//  Runs live entirely in memory, one per socket, in `sandboxes` below — no
//  worker thread (unlike arops.js/game_manager.js): hunt.js has no
//  continuous 20Hz physics to run, just deadline checks, so a single
//  interval per run tied to the connection's own event loop is enough.
//  Optional bot tracks auto-play on a randomized timer (see tickBot) so a
//  lone tester can still see what 'teams'/'individual' multi-track status
//  looks like without needing several real people walking around at once.
// ═══════════════════════════════════════════════════════════
const hunt = require('../game/hunt');
const shared = require('@craftworks/arops-shared');

const TICK_MS = 2000;
const BOT_MIN_DELAY_MS = 3000;
const BOT_MAX_DELAY_MS = 7000;

/** sandboxes: socket.id -> { run, key, timer, bots: [{key, nextActionAt}] } */
const sandboxes = new Map();

// Fixed scenario, anchored to the tester's own position at start time — see
// module header. 5 POIs: a plain sequential leg (A -> B, demonstrates a
// timed leg + strict-route enforcement), then a parallel group (C + D, done
// in any order — demonstrates "parallel tasks"), then the finishing base
// (E). Distances/bearings are arbitrary but keep every POI comfortably
// inside typical GPS accuracy of each other (30-60m legs).
function buildScenario(origin) {
  const at = (bearingDeg, distanceM) => shared.destinationPoint(origin, bearingDeg, distanceM);
  const a = { id: 'poi_a', order_index: 0, name: 'Rätsel A', ...at(0, 40), radius_m: 15,
    poi_type: 'puzzle', puzzle_config: { answer: 'sandbox' }, task_time_limit_ms: null, timeout_action: {} };
  const b = { id: 'poi_b', order_index: 1, name: 'Ziel B', ...at(0, 80), radius_m: 15,
    poi_type: 'target', puzzle_config: {}, task_time_limit_ms: null, timeout_action: {} };
  // Parallel group — either order, both need to be done before advancing.
  const c = { id: 'poi_c', order_index: 2, name: 'Rätsel C (parallel)', ...at(-35, 130), radius_m: 15,
    poi_type: 'puzzle', puzzle_config: { answer: 'sandbox' }, task_time_limit_ms: null, timeout_action: {} };
  const d = { id: 'poi_d', order_index: 2, name: 'Ziel D (parallel)', ...at(35, 130), radius_m: 15,
    poi_type: 'target', puzzle_config: {},
    // Demonstrates a per-task timeout that only affects THIS one POI, not
    // its parallel sibling C — see hunt_lifecycle.test.js's matching test.
    task_time_limit_ms: 90_000, timeout_action: { type: 'skip' } };
  const e = { id: 'poi_e', order_index: 3, name: 'Basis E (Ziel)', ...at(0, 175), radius_m: 15,
    poi_type: 'base', puzzle_config: {}, task_time_limit_ms: null, timeout_action: {} };
  const pois = [a, b, c, d, e];
  const routes = [
    // A -> B: the only size1->size1 boundary in this layout, so the only
    // leg that actually gets armed (see hunt.js's advanceGroup) — strict
    // route enforcement demonstrated here too.
    { from_poi_id: 'poi_a', to_poi_id: 'poi_b', route_type: 'defined', enforcement: 'strict',
      travel_time_limit_ms: 180_000, timeout_action: { type: 'skip' },
      path_geojson: [{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }] },
  ];
  return { pois, routes };
}

function snapshotRun(sb) {
  const { run, key } = sb;
  const poiById = new Map(run.groups.flatMap(g => g.pois).map(p => [p.id, p]));
  const tracks = Object.values(run.progress).map(t => {
    const group = run.groups[t.groupIdx] || null;
    return {
      key: t.key,
      isMe: t.key === key,
      isBot: sb.bots.some(b => b.key === t.key),
      completedAt: t.completedAt,
      groupIdx: t.groupIdx,
      groupCount: run.groups.length,
      routeDeviation: t.routeDeviation,
      legDeadlineAt: t.legDeadlineAt,
      currentPois: (group?.pois || []).map(p => ({
        id: p.id, name: p.name, lat: p.lat, lon: p.lon, radiusM: p.radius_m, type: p.poi_type,
        completed: t.completedPoiIds.includes(p.id),
        arrivedAt: t.poiState[p.id]?.arrivedAt ?? null,
        taskDeadlineAt: t.poiState[p.id]?.taskDeadlineAt ?? null,
      })),
    };
  });
  return {
    runId: run.runId,
    progressMode: run.progressMode,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    serverTime: Date.now(),
    allPois: [...poiById.values()].map(p => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, orderIndex: p.order_index, type: p.poi_type })),
    tracks,
    // Only new events since the client's last-seen seq would need extra
    // bookkeeping per-socket; the sandbox is low-frequency/single-user
    // enough to just ship the last 30 each time instead.
    events: run.events.slice(-30),
  };
}

function emitState(socket, sb) {
  socket.emit('hunt:sandbox_state', snapshotRun(sb));
}

/** Bots auto-play: on a random cadence, complete one pending POI in their current group. */
function tickBots(sb) {
  const { run } = sb;
  const t = Date.now();
  for (const bot of sb.bots) {
    const track = run.progress[bot.key];
    if (!track || track.completedAt) continue;
    if (t < bot.nextActionAt) continue;
    const group = run.groups[track.groupIdx];
    const poi = (group?.pois || []).find(p => !track.completedPoiIds.includes(p.id));
    if (!poi) continue;
    hunt.checkArrival(run, bot.key, { lat: poi.lat, lon: poi.lon });
    if (poi.poi_type === 'puzzle') hunt.submitPuzzleAnswer(run, bot.key, poi.id, poi.puzzle_config?.answer ?? '');
    else if (poi.poi_type === 'target') hunt.confirmTargetDestroyed(run, bot.key, poi.id);
    // 'base' already completed itself on arrival, inside checkArrival above.
    bot.nextActionAt = t + BOT_MIN_DELAY_MS + Math.random() * (BOT_MAX_DELAY_MS - BOT_MIN_DELAY_MS);
  }
}

function stopSandbox(socket) {
  const sb = sandboxes.get(socket.id);
  if (!sb) return;
  clearInterval(sb.timer);
  sandboxes.delete(socket.id);
}

function registerHuntSandboxHandlers(io, socket) {
  socket.on('hunt:sandbox_start', ({ lat, lon, progressMode, botCount }) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return socket.emit('error', { code: 'hunt_bad_origin' });
    }
    stopSandbox(socket); // restart cleanly if one was already running
    const mode = ['shared', 'teams', 'individual'].includes(progressMode) ? progressMode : 'individual';
    const bots = Math.max(0, Math.min(2, Number.isFinite(botCount) ? Math.round(botCount) : 0));
    const key = socket.user.id;
    const players = [{ userId: key, team: 'a' }];
    const botKeys = [];
    for (let i = 0; i < bots; i++) {
      const botId = `bot_${i + 1}`;
      botKeys.push(botId);
      players.push({ userId: botId, team: mode === 'teams' ? 'b' : undefined });
    }
    const { pois, routes } = buildScenario({ lat, lon });
    const run = hunt.createHuntRun({
      runId: 'sandbox_' + socket.id, scenario: { id: 'sandbox', config: { progressMode: mode } },
      pois, routes, players, progressMode: mode,
    });
    const myKey = mode === 'shared' ? 'shared' : mode === 'teams' ? 'a' : key;
    const sb = {
      run, key: myKey,
      bots: botKeys.map(botId => ({
        key: mode === 'shared' ? 'shared' : mode === 'teams' ? 'b' : botId,
        nextActionAt: Date.now() + BOT_MIN_DELAY_MS,
      })).filter((b, i, arr) => arr.findIndex(x => x.key === b.key) === i), // 'shared'/'teams' collapse to 1 logical bot track
      timer: null,
    };
    sb.timer = setInterval(() => {
      tickBots(sb);
      hunt.tickHunt(sb.run);
      emitState(socket, sb);
      if (sb.run.endedAt) stopSandbox(socket);
    }, TICK_MS);
    sandboxes.set(socket.id, sb);
    emitState(socket, sb);
  });

  socket.on('hunt:sandbox_telemetry', ({ lat, lon }) => {
    const sb = sandboxes.get(socket.id);
    if (!sb || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const sample = { lat, lon };
    hunt.checkArrival(sb.run, sb.key, sample);
    hunt.tickHunt(sb.run, { [sb.key]: sample });
    emitState(socket, sb);
    if (sb.run.endedAt) stopSandbox(socket);
  });

  socket.on('hunt:sandbox_puzzle_answer', ({ poiId, answer }) => {
    const sb = sandboxes.get(socket.id);
    if (!sb) return;
    const r = hunt.submitPuzzleAnswer(sb.run, sb.key, poiId, answer);
    socket.emit('hunt:sandbox_action_result', r);
    emitState(socket, sb);
  });

  socket.on('hunt:sandbox_confirm_target', ({ poiId }) => {
    const sb = sandboxes.get(socket.id);
    if (!sb) return;
    const r = hunt.confirmTargetDestroyed(sb.run, sb.key, poiId);
    socket.emit('hunt:sandbox_action_result', r);
    emitState(socket, sb);
  });

  socket.on('hunt:sandbox_stop', () => stopSandbox(socket));
  socket.on('disconnect', () => stopSandbox(socket));
}

module.exports = { registerHuntSandboxHandlers };
