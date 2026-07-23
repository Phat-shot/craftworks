'use strict';
// ═══════════════════════════════════════════════════════════
//  SCHNITZELJAGD LIVE socket-wiring test — exercises
//  server/src/socket/hunt.js's hunt:join_by_code/live_* handlers against a
//  fake socket AND a fake DB (no real Postgres needed): a tiny in-memory
//  table store that recognizes the specific queries this module issues.
//  Validates the actual SQL text/params shape (table/column names) as well
//  as the join/team-assignment/persistence logic, since this is the
//  newest, least-covered code path (multi-socket room broadcast, DB-backed
//  runs) — hunt_lifecycle.test.js and hunt_sandbox_socket.test.js already
//  cover the pure engine and the sandbox path.
//  Run: node server/test/hunt_live_socket.test.js
// ═══════════════════════════════════════════════════════════
const assert = require('assert');
const { registerHuntSandboxHandlers } = require('../src/socket/hunt');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + ' — ' + e.message); }
}
async function acheck(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + ' — ' + (e.stack || e.message)); }
}

const MUC = { lat: 48.13743, lon: 11.57549 };
let uidSeq = 0;
const uuid = () => 'id_' + (++uidSeq);

// ── Fake DB: an in-memory store recognizing this module's exact queries ──
function makeFakeDb() {
  const sessions = new Map();   // code -> {id, scenario_id, max_users, expires_at}
  const scenarios = new Map();  // id -> {id, config}
  const pois = new Map();       // scenario_id -> [poi rows]
  const routes = new Map();     // scenario_id -> [route rows]
  const runs = new Map();       // id -> {id, session_id, progress_mode, ended_at}
  const progress = [];          // [{id, run_id, progress_key, current_poi_id, state, completed_at}]

  function seedScenario({ code, config, poiList, routeList, maxUsers = null }) {
    const scenarioId = uuid();
    scenarios.set(scenarioId, { id: scenarioId, config });
    pois.set(scenarioId, poiList);
    routes.set(scenarioId, routeList || []);
    const sessionId = uuid();
    sessions.set(code, { id: sessionId, scenario_id: scenarioId, max_users: maxUsers,
      expires_at: new Date(Date.now() + 86400000) });
    return { scenarioId, sessionId };
  }

  async function query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT hs.id AS session_id')) {
      const code = params[0];
      const sess = sessions.get(code);
      if (!sess) return { rows: [] };
      return { rows: [{ session_id: sess.id, max_users: sess.max_users, expires_at: sess.expires_at,
        scenario_id: sess.scenario_id, config: scenarios.get(sess.scenario_id).config }] };
    }
    if (s.startsWith('SELECT * FROM hunt_pois')) {
      return { rows: pois.get(params[0]) || [] };
    }
    if (s.startsWith('SELECT * FROM hunt_routes')) {
      return { rows: routes.get(params[0]) || [] };
    }
    if (s.startsWith('SELECT * FROM hunt_runs WHERE session_id')) {
      const live = [...runs.values()].filter(r => r.session_id === params[0] && !r.ended_at);
      return { rows: live.slice(0, 1) };
    }
    if (s.startsWith('INSERT INTO hunt_runs')) {
      const row = { id: uuid(), session_id: params[0], progress_mode: params[1], ended_at: null };
      runs.set(row.id, row);
      return { rows: [row] };
    }
    if (s.startsWith('UPDATE hunt_runs SET ended_at')) {
      const run = runs.get(params[0]);
      if (run) run.ended_at = new Date();
      return { rows: [] };
    }
    if (s.startsWith('SELECT id FROM hunt_progress')) {
      const row = progress.find(p => p.run_id === params[0] && p.progress_key === params[1]);
      return { rows: row ? [{ id: row.id }] : [] };
    }
    if (s.startsWith('UPDATE hunt_progress SET')) {
      const row = progress.find(p => p.id === params[3]);
      if (row) Object.assign(row, { current_poi_id: params[0], state: params[1], completed_at: params[2] });
      return { rows: [] };
    }
    if (s.startsWith('INSERT INTO hunt_progress')) {
      progress.push({ id: uuid(), run_id: params[0], progress_key: params[1],
        current_poi_id: params[2], state: params[3], completed_at: params[4] });
      return { rows: [] };
    }
    throw new Error('fake db: unrecognized query: ' + s.slice(0, 60));
  }

  return { query, seedScenario, _progress: progress, _runs: runs };
}

function makeFakeSocket(userId) {
  const handlers = {};
  const emitted = [];
  const rooms = new Set();
  return {
    id: 'sock_' + userId,
    user: { id: userId },
    on(event, fn) { (handlers[event] ??= []).push(fn); },
    emit(event, data) { emitted.push({ event, data }); },
    join(room) { rooms.add(room); },
    leave(room) { rooms.delete(room); },
    _fire(event, data) { for (const fn of handlers[event] || []) fn(data); },
    _last(event) { return [...emitted].reverse().find(e => e.event === event)?.data; },
    _all(event) { return emitted.filter(e => e.event === event).map(e => e.data); },
  };
}

const at = (bearingDeg, distanceM) => {
  const R = 6371008.8, brg = bearingDeg * Math.PI / 180, d = distanceM / R;
  const lat1 = MUC.lat * Math.PI / 180, lon1 = MUC.lon * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
  const lon2 = lon1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI };
};
function twoPoiScenario() {
  const p0 = { id: 'p0', order_index: 0, name: 'Start', ...at(0, 0), radius_m: 15,
    poi_type: 'puzzle', puzzle_config: { answer: 'live' }, task_time_limit_ms: null, timeout_action: {} };
  const p1 = { id: 'p1', order_index: 1, name: 'Ende', ...at(0, 50), radius_m: 15,
    poi_type: 'base', puzzle_config: {}, task_time_limit_ms: null, timeout_action: {} };
  return [p0, p1];
}

(async () => {
  console.log('\n═══ JOIN BY CODE ═══');
  await acheck('join_by_code creates a run and returns my key + state with the real POIs', async () => {
    const db = makeFakeDb();
    db.seedScenario({ code: 'ABC12345', config: { progressMode: 'individual' }, poiList: twoPoiScenario() });
    const socket = makeFakeSocket('u1');
    registerHuntSandboxHandlers({}, socket, db);
    socket._fire('hunt:join_by_code', { code: 'abc12345' }); // lowercase — must uppercase-normalize
    await new Promise(r => setTimeout(r, 20)); // let the async handler settle
    const joined = socket._last('hunt:live_joined');
    assert.ok(joined, 'got hunt:live_joined');
    assert.equal(joined.key, 'u1');
    const state = socket._last('hunt:live_state');
    assert.equal(state.allPois.length, 2);
    assert.equal(state.tracks.length, 1);
    assert.equal(state.tracks[0].isMe, true);
  });

  await acheck('unknown code -> hunt:live_error not_found', async () => {
    const db = makeFakeDb();
    const socket = makeFakeSocket('u1');
    registerHuntSandboxHandlers({}, socket, db);
    socket._fire('hunt:join_by_code', { code: 'NOPE0000' });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(socket._last('hunt:live_error')?.err, 'not_found');
  });

  console.log('\n═══ TWO REAL PLAYERS SHARE ONE RUN ═══');
  await acheck('two sockets joining the same code land in the same run (individual mode: 2 tracks)', async () => {
    const db = makeFakeDb();
    db.seedScenario({ code: 'SHARE001', config: { progressMode: 'individual' }, poiList: twoPoiScenario() });
    const s1 = makeFakeSocket('u1'), s2 = makeFakeSocket('u2');
    registerHuntSandboxHandlers({}, s1, db);
    registerHuntSandboxHandlers({}, s2, db);
    s1._fire('hunt:join_by_code', { code: 'SHARE001' });
    await new Promise(r => setTimeout(r, 10));
    s2._fire('hunt:join_by_code', { code: 'SHARE001' });
    await new Promise(r => setTimeout(r, 10));
    const runId1 = s1._last('hunt:live_joined').runId;
    const runId2 = s2._last('hunt:live_joined').runId;
    assert.equal(runId1, runId2, 'both joined the exact same in-memory run');
    const state2 = s2._last('hunt:live_state');
    assert.equal(state2.tracks.length, 2, 'individual mode: 2 independent tracks');
  });

  await acheck('teams mode: 2 players alternate onto team a / team b tracks', async () => {
    const db = makeFakeDb();
    db.seedScenario({ code: 'TEAMS001', config: { progressMode: 'teams' }, poiList: twoPoiScenario() });
    const s1 = makeFakeSocket('u1'), s2 = makeFakeSocket('u2');
    registerHuntSandboxHandlers({}, s1, db);
    registerHuntSandboxHandlers({}, s2, db);
    s1._fire('hunt:join_by_code', { code: 'TEAMS001' });
    await new Promise(r => setTimeout(r, 10));
    s2._fire('hunt:join_by_code', { code: 'TEAMS001' });
    await new Promise(r => setTimeout(r, 10));
    assert.equal(s1._last('hunt:live_joined').key, 'a');
    assert.equal(s2._last('hunt:live_joined').key, 'b');
  });

  await acheck('shared mode: 2 players hang off the exact same "shared" track', async () => {
    const db = makeFakeDb();
    db.seedScenario({ code: 'SHRD0001', config: { progressMode: 'shared' }, poiList: twoPoiScenario() });
    const s1 = makeFakeSocket('u1'), s2 = makeFakeSocket('u2');
    registerHuntSandboxHandlers({}, s1, db);
    registerHuntSandboxHandlers({}, s2, db);
    s1._fire('hunt:join_by_code', { code: 'SHRD0001' });
    await new Promise(r => setTimeout(r, 10));
    s2._fire('hunt:join_by_code', { code: 'SHRD0001' });
    await new Promise(r => setTimeout(r, 10));
    assert.equal(s1._last('hunt:live_joined').key, 'shared');
    assert.equal(s2._last('hunt:live_joined').key, 'shared');
    const state = s2._last('hunt:live_state');
    assert.equal(state.tracks.length, 1, 'exactly one shared track for both players');
  });

  console.log('\n═══ TELEMETRY / ACTIONS / PERSISTENCE ═══');
  await acheck('telemetry + puzzle answer advance the run and persist progress to the fake DB', async () => {
    const db = makeFakeDb();
    const { sessionId } = db.seedScenario({ code: 'PLAY0001', config: { progressMode: 'individual' }, poiList: twoPoiScenario() });
    const socket = makeFakeSocket('u1');
    registerHuntSandboxHandlers({}, socket, db);
    socket._fire('hunt:join_by_code', { code: 'PLAY0001' });
    await new Promise(r => setTimeout(r, 10));
    const runId = socket._last('hunt:live_joined').runId;

    socket._fire('hunt:live_telemetry', { runId, lat: MUC.lat, lon: MUC.lon });
    await new Promise(r => setTimeout(r, 10));
    socket._fire('hunt:live_puzzle_answer', { runId, poiId: 'p0', answer: 'LIVE' });
    await new Promise(r => setTimeout(r, 10));
    assert.equal(socket._last('hunt:live_action_result').correct, true);
    let state = socket._last('hunt:live_state');
    assert.equal(state.tracks[0].groupIdx, 1, 'advanced past the puzzle');

    const p1 = at(0, 50);
    socket._fire('hunt:live_telemetry', { runId, lat: p1.lat, lon: p1.lon });
    await new Promise(r => setTimeout(r, 10));
    state = socket._last('hunt:live_state');
    assert.ok(state.tracks[0].completedAt, 'base completed on arrival — run finished');
    assert.ok(state.endedAt, 'run ended');

    assert.ok(db._progress.some(p => p.run_id === runId && p.progress_key === 'u1' && p.completed_at),
      'progress was persisted to the fake DB with a completed_at timestamp');
    assert.ok(db._runs.get(runId).ended_at, 'hunt_runs row marked ended');
  });

  await acheck('session_full: individual mode rejects a genuinely new joiner past max_users', async () => {
    const db = makeFakeDb();
    db.seedScenario({ code: 'FULL0001', config: { progressMode: 'individual' }, poiList: twoPoiScenario(), maxUsers: 1 });
    const s1 = makeFakeSocket('u1'), s2 = makeFakeSocket('u2');
    registerHuntSandboxHandlers({}, s1, db);
    registerHuntSandboxHandlers({}, s2, db);
    s1._fire('hunt:join_by_code', { code: 'FULL0001' });
    await new Promise(r => setTimeout(r, 10));
    s2._fire('hunt:join_by_code', { code: 'FULL0001' });
    await new Promise(r => setTimeout(r, 10));
    assert.equal(s2._last('hunt:live_error')?.err, 'session_full');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
