'use strict';
// ═══════════════════════════════════════════════════════════
//  SCHNITZELJAGD SANDBOX socket-wiring test — exercises
//  server/src/socket/hunt.js's registerHuntSandboxHandlers against a fake
//  socket (no real socket.io connection needed), driving the real hunt.js
//  engine underneath through a full walk-through of the built-in sandbox
//  scenario (sequential leg, parallel POI group, finishing base) plus
//  progressMode variants.
//  Run: node server/test/hunt_sandbox_socket.test.js
// ═══════════════════════════════════════════════════════════
const assert = require('assert');
const { registerHuntSandboxHandlers } = require('../src/socket/hunt');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + ' — ' + e.message); }
}

function makeFakeSocket() {
  const handlers = {};
  const emitted = [];
  return {
    id: 'sock_1',
    user: { id: 'tester_1' },
    on(event, fn) { handlers[event] = fn; },
    emit(event, data) { emitted.push({ event, data }); },
    _handlers: handlers,
    _last(event) { return [...emitted].reverse().find(e => e.event === event)?.data; },
  };
}

const MUC = { lat: 48.13743, lon: 11.57549 };

console.log('\n═══ SANDBOX START ═══');
{
  check('start emits an initial state with me + N bot tracks and all 5 POIs', () => {
    const socket = makeFakeSocket();
    registerHuntSandboxHandlers({}, socket);
    socket._handlers['hunt:sandbox_start']({ lat: MUC.lat, lon: MUC.lon, progressMode: 'individual', botCount: 1 });
    const state = socket._last('hunt:sandbox_state');
    assert.ok(state, 'got an initial state');
    assert.equal(state.tracks.length, 2, 'me + 1 bot');
    assert.equal(state.allPois.length, 5);
    socket._handlers['hunt:sandbox_stop']();
  });
}

console.log('\n═══ FULL WALK-THROUGH ═══');
{
  check('real telemetry walks through the sequential leg, the parallel group (either order), and finishes at the base', () => {
    const socket = makeFakeSocket();
    registerHuntSandboxHandlers({}, socket);
    socket._handlers['hunt:sandbox_start']({ lat: MUC.lat, lon: MUC.lon, progressMode: 'individual', botCount: 0 });
    let state = socket._last('hunt:sandbox_state');
    const poiA = state.tracks[0].currentPois[0];
    assert.equal(poiA.type, 'puzzle');

    socket._handlers['hunt:sandbox_telemetry']({ lat: poiA.lat, lon: poiA.lon });
    socket._handlers['hunt:sandbox_puzzle_answer']({ poiId: poiA.id, answer: 'SANDBOX' });
    assert.equal(socket._last('hunt:sandbox_action_result').correct, true, 'case-insensitive match');

    state = socket._last('hunt:sandbox_state');
    assert.equal(state.tracks[0].groupIdx, 1, 'advanced to poi_b');
    const poiB = state.tracks[0].currentPois[0];
    assert.equal(poiB.id, 'poi_b');

    socket._handlers['hunt:sandbox_telemetry']({ lat: poiB.lat, lon: poiB.lon });
    socket._handlers['hunt:sandbox_confirm_target']({ poiId: poiB.id });
    state = socket._last('hunt:sandbox_state');
    assert.equal(state.tracks[0].groupIdx, 2, 'advanced to the parallel group');
    assert.equal(state.tracks[0].currentPois.length, 2, 'both parallel POIs are current at once');

    // Complete them in reverse order (target D before puzzle C).
    const poiD = state.tracks[0].currentPois.find(p => p.type === 'target');
    const poiC = state.tracks[0].currentPois.find(p => p.type === 'puzzle');
    socket._handlers['hunt:sandbox_telemetry']({ lat: poiD.lat, lon: poiD.lon });
    socket._handlers['hunt:sandbox_confirm_target']({ poiId: poiD.id });
    state = socket._last('hunt:sandbox_state');
    assert.equal(state.tracks[0].groupIdx, 2, 'still group 2 — poi_c pending');

    socket._handlers['hunt:sandbox_telemetry']({ lat: poiC.lat, lon: poiC.lon });
    socket._handlers['hunt:sandbox_puzzle_answer']({ poiId: poiC.id, answer: 'sandbox' });
    state = socket._last('hunt:sandbox_state');
    assert.equal(state.tracks[0].groupIdx, 3, 'both parallel POIs done — advanced to the base');

    const poiE = state.tracks[0].currentPois[0];
    assert.equal(poiE.type, 'base');
    socket._handlers['hunt:sandbox_telemetry']({ lat: poiE.lat, lon: poiE.lon });
    state = socket._last('hunt:sandbox_state');
    assert.ok(state.tracks[0].completedAt, 'base completes on arrival alone — whole run finished');
    socket._handlers['hunt:sandbox_stop']();
  });
}

console.log('\n═══ PROGRESS MODES ═══');
{
  check('teams mode: both bots collapse onto the single opposing-team track', () => {
    const socket = makeFakeSocket();
    registerHuntSandboxHandlers({}, socket);
    socket._handlers['hunt:sandbox_start']({ lat: MUC.lat, lon: MUC.lon, progressMode: 'teams', botCount: 2 });
    const state = socket._last('hunt:sandbox_state');
    assert.equal(state.tracks.length, 2, 'team a (me) + team b (both bots collapse to 1 track)');
    socket._handlers['hunt:sandbox_stop']();
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
