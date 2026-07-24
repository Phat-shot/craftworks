'use strict';
// ═══════════════════════════════════════════════════════════
//  SCHNITZELJAGD socket wiring — two independent flows sharing the same
//  underlying engine (server/src/game/hunt.js) and snapshot shape:
//
//   1) SANDBOX (hunt:sandbox_*) — a fixed, built-in scenario, in-memory
//      only (no DB writes at all), one run per socket. The Hunt equivalent
//      of AR Ops's Match-Simulation: a developer/tester tool, see
//      buildSandboxScenario below.
//
//   2) LIVE (hunt:live_*) — a REAL, host-built scenario (server/src/routes/
//      hunt.js's CRUD API) joined via its hunt_sessions scan code. One run
//      PER SESSION CODE (not per socket) — every socket that joins the
//      same code lands in the same run, in a Socket.IO room, and DB
//      persistence (hunt_runs/hunt_progress) is best-effort: written on
//      state-changing events, never blocks gameplay if it fails.
//
//  Neither path uses a worker thread (unlike arops.js/game_manager.js):
//  hunt.js has no continuous 20Hz physics, just deadline checks, so a
//  plain setInterval per run is enough.
// ═══════════════════════════════════════════════════════════
const hunt = require('../game/hunt');
const shared = require('@craftworks/arops-shared');

const TICK_MS = 2000;

// ── Shared snapshot shape — both sandbox and live runs serialize the same
// way so the client (mobile HuntSandboxScreen / a future live play screen)
// can use one rendering path for either. `key` is the CALLING socket's own
// progress-track key; `isBotKeys` marks sandbox-only simulated players. ──
function snapshotRun(run, key, isBotKeys = new Set()) {
  const poiById = new Map(run.groups.flatMap(g => g.pois).map(p => [p.id, p]));
  const tracks = Object.values(run.progress).map(t => {
    const group = run.groups[t.groupIdx] || null;
    return {
      key: t.key,
      isMe: t.key === key,
      isBot: isBotKeys.has(t.key),
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
    // per-socket bookkeeping; both flows are low-frequency enough to just
    // ship the last 30 each time instead.
    events: run.events.slice(-30),
  };
}

// ═══════════════════════════════════════════════════════════
//  1) SANDBOX
// ═══════════════════════════════════════════════════════════
const BOT_MIN_DELAY_MS = 3000;
const BOT_MAX_DELAY_MS = 7000;

/** sandboxes: socket.id -> { run, key, timer, bots: [{key, nextActionAt}] } */
const sandboxes = new Map();

// Fixed scenario, anchored to the tester's own position at start time. 5
// POIs: a plain sequential leg (A -> B, demonstrates a timed leg + strict-
// route enforcement), then a parallel group (C + D, done in any order —
// demonstrates "parallel tasks"), then the finishing base (E). Distances/
// bearings are arbitrary but keep every POI comfortably inside typical GPS
// accuracy of each other (30-60m legs).
function buildSandboxScenario(origin) {
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

function emitSandboxState(socket, sb) {
  socket.emit('hunt:sandbox_state', snapshotRun(sb.run, sb.key, new Set(sb.bots.map(b => b.key))));
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
    else if (poi.poi_type === 'target' || poi.poi_type === 'capture') hunt.confirmTask(run, bot.key, poi.id);
    // 'base'/'carry_from'/'carry_to' already completed on arrival, above.
    bot.nextActionAt = t + BOT_MIN_DELAY_MS + Math.random() * (BOT_MAX_DELAY_MS - BOT_MIN_DELAY_MS);
  }
}

function stopSandbox(socket) {
  const sb = sandboxes.get(socket.id);
  if (!sb) return;
  clearInterval(sb.timer);
  sandboxes.delete(socket.id);
}

function registerSandboxHandlers(io, socket) {
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
    const { pois, routes } = buildSandboxScenario({ lat, lon });
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
      emitSandboxState(socket, sb);
      if (sb.run.endedAt) stopSandbox(socket);
    }, TICK_MS);
    sandboxes.set(socket.id, sb);
    emitSandboxState(socket, sb);
  });

  socket.on('hunt:sandbox_telemetry', ({ lat, lon }) => {
    const sb = sandboxes.get(socket.id);
    if (!sb || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const sample = { lat, lon };
    hunt.checkArrival(sb.run, sb.key, sample);
    hunt.tickHunt(sb.run, { [sb.key]: sample });
    emitSandboxState(socket, sb);
    if (sb.run.endedAt) stopSandbox(socket);
  });

  socket.on('hunt:sandbox_puzzle_answer', ({ poiId, answer }) => {
    const sb = sandboxes.get(socket.id);
    if (!sb) return;
    const r = hunt.submitPuzzleAnswer(sb.run, sb.key, poiId, answer);
    socket.emit('hunt:sandbox_action_result', r);
    emitSandboxState(socket, sb);
  });

  socket.on('hunt:sandbox_confirm_target', ({ poiId }) => {
    const sb = sandboxes.get(socket.id);
    if (!sb) return;
    const r = hunt.confirmTask(sb.run, sb.key, poiId);
    socket.emit('hunt:sandbox_action_result', r);
    emitSandboxState(socket, sb);
  });

  socket.on('hunt:sandbox_stop', () => stopSandbox(socket));
}

// ═══════════════════════════════════════════════════════════
//  2) LIVE (real, DB-backed scenarios, joined by hunt_sessions code)
// ═══════════════════════════════════════════════════════════
// liveRuns: dbRunId (string) -> { run, dbRunId, sessionId, timer,
//   sockets: Map<socketId, {socket, key}>, nextTeam: 'a'|'b' }
const liveRuns = new Map();
const roomName = dbRunId => `hunt_run:${dbRunId}`;

async function loadSessionForCode(db, code) {
  const { rows } = await db.query(`
    SELECT hs.id AS session_id, hs.max_users, hs.expires_at, sc.id AS scenario_id, sc.config
    FROM hunt_sessions hs JOIN hunt_scenarios sc ON sc.id = hs.scenario_id
    WHERE hs.code = $1
  `, [String(code || '').toUpperCase()]);
  const row = rows[0];
  if (!row) return { err: 'not_found' };
  if (new Date(row.expires_at) < new Date()) return { err: 'expired' };
  return { row };
}

async function loadScenarioRows(db, scenarioId) {
  const { rows: pois } = await db.query(
    'SELECT * FROM hunt_pois WHERE scenario_id=$1 ORDER BY order_index ASC, created_at ASC', [scenarioId]);
  const { rows: routes } = await db.query('SELECT * FROM hunt_routes WHERE scenario_id=$1', [scenarioId]);
  return { pois, routes };
}

/** Finds a still-live run for this session (rejoinable), or starts a new hunt_runs DB row. */
async function getOrCreateDbRun(db, sessionId) {
  const { rows: existing } = await db.query(
    'SELECT * FROM hunt_runs WHERE session_id=$1 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1', [sessionId]);
  if (existing[0]) return existing[0];
  const { rows } = await db.query(
    'INSERT INTO hunt_runs (session_id, progress_mode) VALUES ($1,$2) RETURNING *',
    [sessionId, 'individual'] // progress_mode column is informational here — the in-memory run.progressMode (from scenario.config) is authoritative
  );
  return rows[0];
}

// Best-effort persistence — a DB hiccup here must never break live
// gameplay (the in-memory run keeps going regardless), so every call site
// wraps this in a bare .catch(). current_poi_id is necessarily lossy for a
// parallel group (only the first current POI is recorded there); the full
// picture (groupIdx, completedPoiIds, all current POIs' arrival state)
// goes in `state` JSONB instead.
//
// Manual select-then-insert/update rather than INSERT ... ON CONFLICT:
// hunt_progress has no unique constraint on (run_id, progress_key) in the
// schema, and this repo's auto-migrate (server/src/index.js) only re-runs
// specific regex-matched statement shapes against an already-initialized
// DB (CREATE TABLE/INDEX IF NOT EXISTS, ALTER TABLE...ADD COLUMN IF NOT
// EXISTS) — adding the constraint there wouldn't actually reach a DB that
// was first migrated before this feature existed, which is every real
// deployment right now. Two round-trips instead of one upsert avoids
// depending on a constraint that can't reliably get there.
async function persistProgress(db, dbRunId, track) {
  const currentPoiId = track.poiState ? Object.keys(track.poiState)[0] ?? null : null;
  const state = { groupIdx: track.groupIdx, completedPoiIds: track.completedPoiIds, poiState: track.poiState };
  const completedAt = track.completedAt ? new Date(track.completedAt) : null;
  const { rows } = await db.query(
    'SELECT id FROM hunt_progress WHERE run_id=$1 AND progress_key=$2', [dbRunId, track.key]);
  if (rows[0]) {
    await db.query('UPDATE hunt_progress SET current_poi_id=$1, state=$2, completed_at=$3 WHERE id=$4',
      [currentPoiId, JSON.stringify(state), completedAt, rows[0].id]);
  } else {
    await db.query(
      'INSERT INTO hunt_progress (run_id, progress_key, current_poi_id, state, completed_at) VALUES ($1,$2,$3,$4,$5)',
      [dbRunId, track.key, currentPoiId, JSON.stringify(state), completedAt]);
  }
}

function emitLiveState(io, lr) {
  for (const { socket, key } of lr.sockets.values()) {
    socket.emit('hunt:live_state', snapshotRun(lr.run, key));
  }
}

function stopLiveRunTimer(lr) {
  if (lr.timer) clearInterval(lr.timer);
  lr.timer = null;
}

function registerLiveHandlers(io, socket, db) {
  socket.on('hunt:join_by_code', async ({ code }) => {
    try {
      const { row, err } = await loadSessionForCode(db, code);
      if (err) return socket.emit('hunt:live_error', { err });

      let lr = [...liveRuns.values()].find(r => r.sessionId === row.session_id);
      if (!lr) {
        const dbRun = await getOrCreateDbRun(db, row.session_id);
        const { pois, routes } = await loadScenarioRows(db, row.scenario_id);
        if (!pois.length) return socket.emit('hunt:live_error', { err: 'scenario_empty' });
        const progressMode = ['shared', 'teams', 'individual'].includes(row.config?.progressMode)
          ? row.config.progressMode : 'individual';
        const run = hunt.createHuntRun({
          runId: dbRun.id, scenario: { id: row.scenario_id, config: { progressMode } },
          pois, routes, players: [], progressMode,
        });
        lr = { run, dbRunId: dbRun.id, sessionId: row.session_id, maxUsers: row.max_users,
          timer: null, sockets: new Map(), nextTeam: 'a' };
        liveRuns.set(dbRun.id, lr);
      }

      const userId = socket.user.id;
      let key;
      if (lr.run.progressMode === 'shared') {
        key = 'shared';
        if (!lr.run.progress[key]) hunt.startProgressTrack(lr.run, key);
      } else if (lr.run.progressMode === 'teams') {
        // Reconnecting player -> same team track; new player -> alternate a/b.
        const already = Object.keys(lr.run.progress).find(k =>
          [...lr.sockets.values()].some(s => s.key === k && s.userId === userId));
        key = already || lr.nextTeam;
        if (!lr.run.progress[key]) {
          hunt.startProgressTrack(lr.run, key);
          lr.nextTeam = lr.nextTeam === 'a' ? 'b' : 'a';
        }
      } else {
        // 'individual': resume an existing track for this exact user, else
        // a fresh one — but gate on maxUsers for genuinely NEW joiners only.
        if (lr.run.progress[userId]) {
          key = userId;
        } else {
          const distinctPlayers = Object.keys(lr.run.progress).length;
          if (Number.isFinite(lr.maxUsers) && distinctPlayers >= lr.maxUsers) {
            return socket.emit('hunt:live_error', { err: 'session_full' });
          }
          hunt.startProgressTrack(lr.run, userId);
          key = userId;
        }
      }

      socket.join(roomName(lr.dbRunId));
      lr.sockets.set(socket.id, { socket, key, userId });
      if (!lr.timer) {
        lr.timer = setInterval(async () => {
          hunt.tickHunt(lr.run);
          emitLiveState(io, lr);
          if (lr.run.endedAt) {
            stopLiveRunTimer(lr);
            db.query('UPDATE hunt_runs SET ended_at=NOW() WHERE id=$1', [lr.dbRunId]).catch(() => {});
          }
        }, TICK_MS);
      }
      persistProgress(db, lr.dbRunId, lr.run.progress[key]).catch(() => {});
      socket.emit('hunt:live_joined', { runId: lr.dbRunId, key });
      emitLiveState(io, lr);
    } catch (e) {
      socket.emit('hunt:live_error', { err: 'server_error' });
    }
  });

  const withLiveRun = (fn) => async (payload = {}) => {
    const lr = liveRuns.get(payload.runId);
    const entry = lr?.sockets.get(socket.id);
    if (!lr || !entry) return;
    await fn(lr, entry.key, payload);
    persistProgress(db, lr.dbRunId, lr.run.progress[entry.key]).catch(() => {});
    emitLiveState(io, lr);
    if (lr.run.endedAt) {
      stopLiveRunTimer(lr);
      db.query('UPDATE hunt_runs SET ended_at=NOW() WHERE id=$1', [lr.dbRunId]).catch(() => {});
    }
  };

  socket.on('hunt:live_telemetry', withLiveRun((lr, key, { lat, lon }) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const sample = { lat, lon };
    hunt.checkArrival(lr.run, key, sample);
    hunt.tickHunt(lr.run, { [key]: sample });
  }));

  socket.on('hunt:live_puzzle_answer', withLiveRun((lr, key, { poiId, answer }) => {
    const r = hunt.submitPuzzleAnswer(lr.run, key, poiId, answer);
    socket.emit('hunt:live_action_result', r);
  }));

  socket.on('hunt:live_confirm_task', withLiveRun((lr, key, { poiId }) => {
    const r = hunt.confirmTask(lr.run, key, poiId);
    socket.emit('hunt:live_action_result', r);
  }));

  socket.on('hunt:live_leave', ({ runId }) => leaveLiveRun(socket, runId));
}

function leaveLiveRun(socket, dbRunId) {
  const lr = liveRuns.get(dbRunId);
  if (!lr) return;
  lr.sockets.delete(socket.id);
  socket.leave(roomName(dbRunId));
  // The run itself (and its tick timer) keeps going even with nobody
  // connected — a real multi-player session, unlike the sandbox, must
  // survive a temporary disconnect so progress isn't lost. Only fully
  // clean up the in-memory entry once it has actually ended.
  if (lr.run.endedAt) { stopLiveRunTimer(lr); liveRuns.delete(dbRunId); }
}

function registerHuntSandboxHandlers(io, socket, db) {
  registerSandboxHandlers(io, socket);
  registerLiveHandlers(io, socket, db);
  socket.on('disconnect', () => {
    stopSandbox(socket);
    for (const dbRunId of liveRuns.keys()) leaveLiveRun(socket, dbRunId);
  });
}

module.exports = { registerHuntSandboxHandlers, loadScenarioRows };
