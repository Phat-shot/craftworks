'use strict';
// ═══════════════════════════════════════════════════════════
//  Match-Simulation engine — proves the fixed, shared snippet definitions
//  (packages/arops-shared/src/simScript.ts) actually produce their declared
//  expected outcomes when driven through the REAL server pipeline
//  (createAropsGame/tickArops/tickSimBots/actionArHitAttempt), the same way
//  the on-device Match-Simulation screen will drive them for real. This is
//  the regression anchor for the simulation ENGINE itself — it can't
//  exercise the actual mobile client, but it proves the scripted
//  routes/shots/checkpoints geometrically and temporally do what the client
//  will assume they do when it compares its own predictions against the
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

// Mirrors the real lobby:start flow: build the polygon from the snippet's
// squareFieldCorners anchored at an arbitrary real-world origin, and
// pre-append the snippet's bots to the player list exactly like game.js's
// lobby:start handler does for a simulation lobby (see server/src/socket/
// game.js) — createAropsGame's own applySimOverrides then takes it from
// there, identical to production.
function createSimGame(sessionId, snippet) {
  const polygon = shared.squareFieldCorners(snippet.fieldSideM)
    .map(w => shared.destinationPoint(MUC, w.bearingDeg, w.distanceM));
  const players = [
    { userId: 'TESTER', username: 'Tester' },
    ...snippet.bots.map(b => ({ userId: b.id, username: b.username, isBot: true })),
  ];
  const gs = arops.createAropsGame(sessionId, players, {
    ar_settings: { polygon, simulation: true, simSnippetKey: snippet.key, debugMode: true },
  });
  // Mirrors what the real Match-Simulation screen submits for itself (see
  // useTelemetry's ar_telemetry action) — without this, a bot-fired shot
  // at 'tester' (bot_returns_fire) can never find a target position, since
  // only bots get telemetry from tickSimBots.
  arops.actionArTelemetry(gs, 'TESTER', {
    sample: { lat: MUC.lat, lon: MUC.lon, ts: Date.now(), accuracyM: 3, headingDeg: snippet.testerHeadingDeg },
  });
  return gs;
}

// Drives the whole snippet timeline in fixed 1200ms simulated steps
// (matches tickSimBots' own SIM_BOT_STEP_MS exactly, so bots move at their
// real intended 1.3 m/s pace in simulated time).
//
// arops.js's internal now() is a plain Date.now() — phase transitions
// (warmup/base_setup's baseSettingMs wait), freeze expiry, and hit
// cooldowns all compare against it directly. This whole loop finishes in a
// handful of real milliseconds, so without faking the clock those checks
// would never appear to elapse (a snippet needing ~60 real SECONDS to play
// out for real would need the same wait here). Globally patching Date.now
// for the duration of one snippet's drive — restored in a finally — maps
// each simulated instant onto a real one 1:1, so every one of those
// real-time comparisons inside arops.js is automatically consistent with
// the snippet's own timeline, without needing to individually re-derive
// and backdate each dependent field by hand.
function driveSim(gs, snippet) {
  const STEP = 1200;
  const done = new Set();
  let elapsed = 0;
  const realStart = realDateNow();
  Date.now = () => realStart + elapsed;
  try {
    while (elapsed < snippet.durationMs) {
      elapsed += STEP;
      // Mirrors the real ~1 Hz useTelemetry loop the Match-Simulation
      // screen keeps running for itself even while stationary — without
      // fresh resubmission, the tester's one construction-time sample goes
      // stale (time_skew) within a few seconds of simulated time, which
      // would reject every hit attempt aimed at the tester regardless of
      // geometry (see bot_returns_fire, the only snippet where the tester
      // is ever a target rather than a shooter).
      arops.actionArTelemetry(gs, 'TESTER', {
        sample: { lat: MUC.lat, lon: MUC.lon, ts: Date.now(), accuracyM: 3, headingDeg: snippet.testerHeadingDeg },
      });
      arops.tickArops(gs);

      for (let i = 0; i < snippet.shoots.length; i++) {
        const beat = snippet.shoots[i];
        if (beat.shooterId !== 'tester' || done.has(i) || elapsed < beat.tMs) continue;
        done.add(i);
        const target = gs.players[beat.targetId];
        assert.ok(target?.lastAccepted, `${snippet.key}: target ${beat.targetId} has no telemetry yet at t=${elapsed}`);
        const headingDeg = snippet.testerHeadingDeg;
        const r = arops.actionArHitAttempt(gs, 'TESTER', {
          sample: { lat: MUC.lat, lon: MUC.lon, ts: Date.now(), accuracyM: 3, headingDeg },
          targetId: beat.targetId,
        });
        check(`${snippet.key}: shoot#${i} at t=${beat.tMs} expects hit=${beat.expectedHit}`, () => {
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

function checkBotShotResults(gs, snippet) {
  for (let i = 0; i < snippet.shoots.length; i++) {
    const beat = snippet.shoots[i];
    if (beat.shooterId === 'tester') continue;
    check(`${snippet.key}: bot shoot#${i} (${beat.shooterId}->${beat.targetId}) expects hit=${beat.expectedHit}`, () => {
      const targetId = beat.targetId === 'tester' ? 'TESTER' : beat.targetId;
      const gotHit = gs.events.some(e =>
        ['player_downed', 'player_frozen', 'player_eliminated'].includes(e.type)
        && e.userId === targetId && e.byUserId === beat.shooterId);
      assert.equal(gotHit, beat.expectedHit);
    });
  }
}

function checkCheckpoints(gs, snippet) {
  for (const cp of snippet.checkpoints) {
    check(`${snippet.key}: checkpoint ${cp.check}#${cp.targetIndex} at t=${cp.tMs} expects ${cp.expected}`, () => {
      if (cp.check === 'zoneOwner') {
        const zoneId = 'z' + (cp.targetIndex + 1);
        assert.equal(gs.modeState.owners[zoneId], cp.expected);
      } else if (cp.check === 'flagCaptured') {
        assert.ok((gs.modeState.captures?.[cp.expected] || 0) >= 1, `captures[${cp.expected}] never incremented`);
      } else if (cp.check === 'bombDefused') {
        const defused = gs.events.some(e => e.type === 'target_defused');
        assert.equal(defused, cp.expected === 'true');
      } else if (cp.check === 'bombArmed') {
        const armed = gs.events.some(e => e.type === 'target_armed');
        assert.equal(armed, cp.expected === 'true');
      } else {
        throw new Error('unknown checkpoint kind: ' + cp.check);
      }
    });
  }
}

for (const snippet of shared.SIM_SNIPPETS) {
  const gs = createSimGame('sim-' + snippet.key, snippet);
  driveSim(gs, snippet);
  checkBotShotResults(gs, snippet);
  checkCheckpoints(gs, snippet);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
