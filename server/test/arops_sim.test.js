'use strict';
// ═══════════════════════════════════════════════════════════
//  Match-Simulation engine — proves the fixed, shared scenario definitions
//  (packages/arops-shared/src/simScript.ts — ~50 short, seeded-random
//  1-10s conditions) actually produce their declared expected outcomes
//  when driven through the REAL server pipeline (createAropsGame/
//  tickArops/tickSimBots/actionArHitAttempt), the same way the on-device
//  Match-Simulation screen will drive them for real. This is the
//  regression anchor for the simulation ENGINE itself — it can't exercise
//  the actual mobile client, but it proves the scripted routes/shots/
//  checkpoints geometrically and temporally do what the client will
//  assume they do when it compares its own predictions against the
//  server's real outcome.
//  Run: node server/test/arops_sim.test.js
// ═══════════════════════════════════════════════════════════
const assert = require('assert');
const arops = require('../src/game/arops');
const shared = require('@craftworks/arops-shared');

const MUC = { lat: 48.13743, lon: 11.57549 };
const realDateNow = Date.now.bind(Date);
let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + ' — ' + e.message); }
}

// Mirrors the real lobby:start flow: build the polygon from the scenario's
// squareFieldCorners anchored at an arbitrary real-world origin, and
// pre-append the scenario's bots to the player list exactly like game.js's
// lobby:start handler does for a simulation lobby (see server/src/socket/
// game.js) — createAropsGame's own applySimOverrides then takes it from
// there, identical to production. The instant warmup/base_setup skip (see
// arops.js, right after mode.initState) happens INSIDE this call, using
// the real (unpatched) clock — exactly like production, where a scenario's
// own short lifetime never has to pay for a real match's prep phase.
function createSimGame(sessionId, scenario) {
  const polygon = shared.squareFieldCorners(scenario.fieldSideM)
    .map(w => shared.destinationPoint(MUC, w.bearingDeg, w.distanceM));
  const players = [
    { userId: 'TESTER', username: 'Tester' },
    ...scenario.bots.map(b => ({ userId: b.id, username: b.username, isBot: true })),
  ];
  const gs = arops.createAropsGame(sessionId, players, {
    ar_settings: { polygon, simulation: true, simSnippetKey: scenario.key, debugMode: true },
  });
  arops.actionArTelemetry(gs, 'TESTER', {
    sample: { lat: MUC.lat, lon: MUC.lon, ts: Date.now(), accuracyM: 3, headingDeg: scenario.testerHeadingDeg },
  });
  return gs;
}

// Drives a scenario's whole (short) timeline in fixed 1200ms simulated
// steps (matches tickSimBots' own SIM_BOT_STEP_MS). arops.js's internal
// now() is a plain Date.now() — freeze/capture-dwell expiry and hit
// cooldowns compare against it directly, and this whole loop otherwise
// finishes in a handful of real milliseconds, so without faking the clock
// those wouldn't appear to elapse. Globally patching Date.now for the
// duration of one scenario's drive — restored in a finally — maps each
// simulated instant onto a real one 1:1.
function driveScenario(gs, scenario) {
  const STEP = 1200;
  const done = new Set();
  let elapsed = 0;
  const realStart = realDateNow();
  Date.now = () => realStart + elapsed;
  try {
    while (elapsed < scenario.durationMs) {
      elapsed += STEP;
      arops.actionArTelemetry(gs, 'TESTER', {
        sample: { lat: MUC.lat, lon: MUC.lon, ts: Date.now(), accuracyM: 3, headingDeg: scenario.testerHeadingDeg },
      });
      arops.tickArops(gs);

      for (let i = 0; i < scenario.shoots.length; i++) {
        const beat = scenario.shoots[i];
        if (beat.shooterId !== 'tester' || done.has(i) || elapsed < beat.tMs) continue;
        done.add(i);
        const target = gs.players[beat.targetId];
        assert.ok(target?.lastAccepted, `${scenario.key}: target ${beat.targetId} has no telemetry yet at t=${elapsed}`);
        const r = arops.actionArHitAttempt(gs, 'TESTER', {
          sample: { lat: MUC.lat, lon: MUC.lon, ts: Date.now(), accuracyM: 3, headingDeg: scenario.testerHeadingDeg },
          targetId: beat.targetId,
        });
        check(`${scenario.key}: shoot @${beat.tMs}ms expects hit=${beat.expectedHit}`, () => {
          assert.equal(r.ok, true, `action rejected: ${r.err}`);
          assert.equal(r.hit, beat.expectedHit, `got hit=${r.hit} reason=${r.reason} (expected reason: ${beat.expectedReason || 'n/a'})`);
        });
      }
      if (gs.gameOver) break;
    }
  } finally {
    Date.now = realDateNow;
  }
}

function checkBotShotResults(gs, scenario) {
  for (let i = 0; i < scenario.shoots.length; i++) {
    const beat = scenario.shoots[i];
    if (beat.shooterId === 'tester') continue;
    check(`${scenario.key}: bot shoot (${beat.shooterId}->${beat.targetId}) expects hit=${beat.expectedHit}`, () => {
      const targetId = beat.targetId === 'tester' ? 'TESTER' : beat.targetId;
      const gotHit = gs.events.some(e =>
        ['player_downed', 'player_frozen', 'player_eliminated'].includes(e.type)
        && e.userId === targetId && e.byUserId === beat.shooterId);
      assert.equal(gotHit, beat.expectedHit);
    });
  }
}

function checkCheckpoints(gs, scenario) {
  for (const cp of scenario.checkpoints) {
    check(`${scenario.key}: checkpoint ${cp.check}#${cp.targetIndex} expects ${cp.expected}`, () => {
      if (cp.check === 'zoneOwner') {
        const zoneId = 'z' + (cp.targetIndex + 1);
        assert.equal(gs.modeState.owners[zoneId], cp.expected);
      } else if (cp.check === 'gameOver') {
        // 'player_tester' — runtime-resolved sentinel (the tester's real
        // userId is this harness's own fixed 'TESTER', see createSimGame;
        // a real device run substitutes its own logged-in user's id).
        const expected = cp.expected === 'player_tester' ? 'player_TESTER' : cp.expected;
        assert.equal(gs.gameOver, true, `expected the match to have ended by t=${cp.tMs}`);
        assert.equal(gs.winner, expected);
      } else {
        throw new Error('unknown checkpoint kind: ' + cp.check);
      }
    });
  }
}

check('instant live phase: a simulation session never sits in warmup/base_setup', () => {
  const scenario = shared.SIM_SCENARIOS[0];
  const gs = createSimGame('sim-phase-check', scenario);
  assert.equal(gs.phase, 'live');
});

for (const scenario of shared.SIM_SCENARIOS) {
  const gs = createSimGame('sim-' + scenario.key, scenario);
  driveScenario(gs, scenario);
  checkBotShotResults(gs, scenario);
  checkCheckpoints(gs, scenario);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
