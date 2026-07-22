'use strict';
// ═══════════════════════════════════════════════════════════
//  Live hit/hitbox verification — cross-checks the REAL server pipeline
//  (actionArHitAttempt, telemetry buffering, snapshot exposure) against
//  the shared geometry library's own ground-truth validator (validateHit/
//  validateHitLateral/validateHitOmni), instead of only exercising the
//  math in isolation the way packages/arops-shared/test/hit*.test.ts do.
//  Reported: a shot that should geometrically have hit (by the exact same
//  shared math) sometimes didn't register during a real debug session —
//  this suite exists to catch precisely that class of drift between "the
//  formula says hit" and "the live pipeline actually returns hit", across
//  hundreds of randomized shots per hitbox shape rather than a few
//  hand-picked examples (which can miss edge cases near the tolerance/
//  range boundary).
//  Run: node server/test/arops_hitbox_live.test.js
// ═══════════════════════════════════════════════════════════
const assert = require('assert');
const arops = require('../src/game/arops');
const shared = require('@craftworks/arops-shared');

// Same wrapper as the other arops test files — forces autoScale off so
// gs.hitConfig is the known, stable DEFAULT_HIT_CONFIG.
function createGame(sessionId, players, workshopConfig) {
  const wc = { ...workshopConfig, ar_settings: { autoScale: false, ...(workshopConfig.ar_settings || {}) } };
  return arops.createAropsGame(sessionId, players, wc);
}

const MUC = { lat: 48.13743, lon: 11.57549 };
const FIELD = [0, 90, 180, 270].map(b => shared.destinationPoint(MUC, b, 300));
let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + ' — ' + e.message); }
}
let TS = Date.now();
function tick(gs, advanceMs) {
  gs._lastModeTick = Date.now() - Math.min(2000, advanceMs);
  arops.tickArops(gs);
}
function skipWarmup(gs) {
  gs.phaseStartTime = Date.now() - (gs.timings.baseSettingMs + 100);
  tick(gs, 100);
}
function tel(gs, uid, pos, over = {}) {
  TS += 1100;
  return arops.actionArTelemetry(gs, uid, {
    sample: { lat: pos.lat, lon: pos.lon, ts: TS, accuracyM: 5, headingDeg: null, ...over },
  });
}
const FAST = {
  freezeMs: 1000, freezeExtensionMs: 500, freezeMoveToleranceM: 15,
  baseSettingMs: 500, hitCooldownMs: 0,
};

// Deathmatch + onHit:'freeze' reaches a shootable phase ('live') with NO
// base-placement step at all (MODES.deathmatch's initialPhase — see
// arops.js), and both players are opponents by default team alternation
// (A1='a', B1='b') — least boilerplate to get two REAL players into a
// state where actionArHitAttempt is actually callable. debugMode exposes
// positions in snapshots unconditionally, needed for the snapshot cross-
// check below.
function setupLive(sessionId, over = {}) {
  const gs = createGame(sessionId,
    [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
    { ar_settings: { polygon: FIELD, subMode: 'deathmatch', onHit: 'freeze',
      timings: FAST, gameDurationMs: 600_000, debugMode: true, ...over } });
  skipWarmup(gs);
  return gs;
}

// Drives N random shots through the REAL server pipeline and cross-checks
// every single verdict against an independently-computed ground truth.
// `genCase()` produces a fresh random {shooterPos, targetPos, headingDeg,
// accuracyM, meta} each call; `computeExpected(shooterSample, targetLast
// Accepted)` returns the shared-library ground-truth HitVerdict for it.
//
// Random world-position teleports between iterations are themselves
// subject to the SAME anti-spoof "implausible movement" check every real
// telemetry sample goes through (packages/arops-shared/src/geofence.ts) —
// a large random jump can legitimately get REJECTED, which would silently
// leave the target's position stale and make a naively-precomputed
// "expected" verdict wrong through no fault of the server at all. Ground
// truth is therefore always built from gs.players.*.lastAccepted (the
// ACTUAL accepted state) after confirming both telemetry submissions were
// accepted (`.ok`), not from the freshly-generated random position —
// iterations whose telemetry got rejected are simply retried, they're not
// a case this suite is trying to exercise in the first place.
function fuzzShots(gs, N, genCase, computeExpected) {
  let mismatches = 0, skipped = 0, i = 0, attempts = 0;
  const details = [];
  while (i < N && attempts < N * 10) {
    attempts++;
    const c = genCase();
    const rA = tel(gs, 'A1', c.shooterPos, { accuracyM: c.accuracyM });
    const rB = tel(gs, 'B1', c.targetPos, { accuracyM: c.accuracyM });
    if (!rA.ok || !rB.ok) { skipped++; continue; }
    // Bypass cooldown/freeze/strikes between iterations — this sweep tests
    // the geometry pipeline specifically, not cooldown/freeze/anti-spoof
    // timing (each already has its own dedicated coverage in
    // arops_modes.test.js).
    gs.players.A1.lastHitAttemptAt = 0;
    gs.players.A1.strikes = 0;
    gs.players.B1.frozenUntil = 0;
    TS += 1100;

    const shooterSample = {
      lat: gs.players.A1.lastAccepted.lat, lon: gs.players.A1.lastAccepted.lon,
      ts: TS, accuracyM: c.accuracyM, headingDeg: c.headingDeg,
    };
    const expected = computeExpected(shooterSample, gs.players.B1.lastAccepted);
    const r = arops.actionArHitAttempt(gs, 'A1', { sample: shooterSample });
    i++;
    if (r.hit !== expected.hit) {
      mismatches++;
      if (details.length < 5) {
        details.push({ i, expectedHit: expected.hit, actualHit: r.hit, expectedReason: expected.reason, actualReason: r.reason, ...c.meta });
      }
    }
  }
  if (attempts >= N * 10) throw new Error(`too many telemetry rejections while generating cases (${skipped} skipped of ${attempts} attempts) — genCase() draws are too aggressive for the anti-spoof speed limit`);
  return { mismatches, details, skipped };
}

console.log('\n═══ LIVE HIT/HITBOX VERIFICATION ═══');

// ─── Scripted: one clean hit, one clean miss — cross-checked against both
// the shared validator (ground truth) AND the snapshot a real client would
// actually render its aim overlay against. ──────────────────────────────
{
  const gs = setupLive('scripted_hit');
  const shooterPos = MUC;
  const targetPos = shared.destinationPoint(MUC, 0, 30); // due north, 30m
  tel(gs, 'A1', shooterPos);
  tel(gs, 'B1', targetPos);

  check('aiming exactly at a target within range and cone → hit, matches shared.validateHit ground truth', () => {
    TS += 1100;
    const headingDeg = 0; // due north, exactly at the target's bearing
    const shooterSample = { lat: shooterPos.lat, lon: shooterPos.lon, ts: TS, accuracyM: 5, headingDeg };
    const expected = shared.validateHit({
      shooterId: 'A1', targetId: 'B1',
      shooter: shooterSample,
      target: { lat: targetPos.lat, lon: targetPos.lon, ts: gs.players.B1.lastAccepted.ts, accuracyM: 5 },
    }, gs.hitConfig);
    assert.equal(expected.hit, true, 'test setup sanity: ground truth itself must be a hit');

    const r = arops.actionArHitAttempt(gs, 'A1', { sample: shooterSample });
    assert.equal(r.hit, expected.hit, `server disagreed with shared.validateHit ground truth: ${JSON.stringify(r)}`);
    assert.equal(r.targetId, 'B1');

    // What a real client would actually SEE (debugMode exposes B1's
    // position in A1's own snapshot) must be exactly the position the hit
    // was just validated against — a client-vs-server position mismatch
    // here is exactly the kind of bug that reads as "aimed right at them,
    // should have hit, didn't".
    const snap = arops.getAropsSnapshot(gs, 'A1');
    const seenB1 = snap.players.find(p => p.userId === 'B1');
    assert.equal(seenB1.lat, targetPos.lat, 'snapshot position must match what was actually validated against');
    assert.equal(seenB1.lon, targetPos.lon);
  });
}

{
  const gs = setupLive('scripted_miss');
  const shooterPos = MUC;
  const targetPos = shared.destinationPoint(MUC, 90, 30); // due EAST, 30m
  tel(gs, 'A1', shooterPos);
  tel(gs, 'B1', targetPos);

  check('aiming 90° away from a target → miss, matches shared.validateHit ground truth', () => {
    TS += 1100;
    const headingDeg = 0; // due north — target is actually due east
    const shooterSample = { lat: shooterPos.lat, lon: shooterPos.lon, ts: TS, accuracyM: 5, headingDeg };
    const expected = shared.validateHit({
      shooterId: 'A1', targetId: 'B1',
      shooter: shooterSample,
      target: { lat: targetPos.lat, lon: targetPos.lon, ts: gs.players.B1.lastAccepted.ts, accuracyM: 5 },
    }, gs.hitConfig);
    assert.equal(expected.hit, false, 'test setup sanity: ground truth itself must be a miss');

    const r = arops.actionArHitAttempt(gs, 'A1', { sample: shooterSample });
    assert.equal(r.hit, false, `server disagreed with shared.validateHit ground truth (expected miss): ${JSON.stringify(r)}`);
  });
}

// ─── Randomized fuzz sweep (default Scout/cone shape): every one of N
// random shooter/target/heading/accuracy combinations must agree between
// the live server pipeline and the shared ground-truth validator. Both
// shooter and target stay within a tight radius of MUC across iterations
// (not teleporting across the whole field) specifically so consecutive
// random draws for the SAME player stay under the anti-spoof plausible-
// speed limit almost always — fuzzShots()'s retry-on-rejection handles the
// rare remaining case, but keeping the draw radius tight keeps the retry
// rate low instead of dominating the run. ────────────────────────────────
{
  const gs = setupLive('fuzz_cone');
  const N = 300;
  // Scout (the default class, see effectiveHitInfo in arops.js) gets a
  // WIDENED "shotgun" cone — 3x the baseline half-angle, capped at
  // maxToleranceDeg — not the raw gs.hitConfig.baseConeHalfAngleDeg. Ground
  // truth must use the exact same widened cone the live server actually
  // validates Scout shots against, or every shot in the (very real) gap
  // between the two cone widths reads as a false "the server missed a shot
  // that should have hit" — first caught by this very sweep before the fix.
  const wideConeHalfAngleDeg = Math.min(gs.hitConfig.maxToleranceDeg, gs.hitConfig.baseConeHalfAngleDeg * 3);
  check(`fuzz sweep (Scout/cone, default class): server verdict matches shared.validateHit on all ${N} random shots`, () => {
    const { mismatches, details } = fuzzShots(gs, N, () => {
      const shooterPos = shared.destinationPoint(MUC, Math.random() * 360, Math.random() * 5);
      const distanceM = Math.random() * gs.hitConfig.maxRangeM * 1.3; // spans clean in-range hits AND clean out-of-range misses
      const trueBearing = Math.random() * 360;
      const targetPos = shared.destinationPoint(shooterPos, trueBearing, distanceM);
      // Offset spans well past the WIDENED cone's own tolerance in both
      // directions so both hits and misses occur often, not just one or
      // the other.
      const aimOffsetDeg = (Math.random() - 0.5) * 2.2 * wideConeHalfAngleDeg;
      const headingDeg = ((trueBearing + aimOffsetDeg) % 360 + 360) % 360;
      const accuracyM = 3 + Math.random() * 12;
      return { shooterPos, targetPos, headingDeg, accuracyM, meta: { distanceM, aimOffsetDeg, accuracyM } };
    }, (shooterSample, targetLastAccepted) => shared.validateHit({
      shooterId: 'A1', targetId: 'B1',
      shooter: shooterSample,
      target: targetLastAccepted,
    }, { ...gs.hitConfig, baseConeHalfAngleDeg: wideConeHalfAngleDeg }));
    assert.equal(mismatches, 0, `${mismatches}/${N} mismatches — first few: ${JSON.stringify(details)}`);
  });
}

// ─── Sniper (lateral hit shape) — a bug isolated to this class-specific
// code path wouldn't show up in the cone-only sweep above at all. ───────
{
  const gs = setupLive('fuzz_sniper', { classes: { A1: 'sniper' } });
  const N = 150;
  check(`fuzz sweep (Sniper/lateral): server verdict matches shared.validateHitLateral on all ${N} random shots`, () => {
    const hitRangeM = gs.hitConfig.maxRangeM * 2; // effectiveHitInfo's sniper multiplier, see arops.js
    const lateralToleranceM = Math.tan(gs.hitConfig.baseConeHalfAngleDeg * Math.PI / 180) * 10;
    const { mismatches, details } = fuzzShots(gs, N, () => {
      const shooterPos = MUC;
      const distanceM = Math.random() * hitRangeM * 1.15;
      const trueBearing = Math.random() * 360;
      const targetPos = shared.destinationPoint(shooterPos, trueBearing, distanceM);
      // Lateral tolerance is a handful of meters, not a wide angle — keep
      // offsets tighter so both hits and misses actually occur often.
      const aimOffsetDeg = (Math.random() - 0.5) * 20;
      const headingDeg = ((trueBearing + aimOffsetDeg) % 360 + 360) % 360;
      return { shooterPos, targetPos, headingDeg, accuracyM: 5, meta: { distanceM, aimOffsetDeg } };
    }, (shooterSample, targetLastAccepted) => shared.validateHitLateral({
      shooterId: 'A1', targetId: 'B1',
      shooter: shooterSample,
      target: targetLastAccepted,
    }, { ...gs.hitConfig, maxRangeM: hitRangeM }, lateralToleranceM));
    assert.equal(mismatches, 0, `${mismatches}/${N} mismatches — first few: ${JSON.stringify(details)}`);
  });
}

// ─── Bomber (omni hit shape, no heading needed at all) — verifies that
// path specifically, including that a null headingDeg never blocks it
// (unlike the cone/lateral shapes, which require one). ──────────────────
{
  const gs = setupLive('fuzz_bomber', { classes: { A1: 'bomber' } });
  const N = 150;
  check(`fuzz sweep (Bomber/omni, no heading): server verdict matches shared.validateHitOmni on all ${N} random shots`, () => {
    const hitRangeM = gs.hitConfig.maxRangeM * 0.25; // effectiveHitInfo's bomber multiplier
    const { mismatches, details } = fuzzShots(gs, N, () => {
      const shooterPos = MUC;
      const distanceM = Math.random() * hitRangeM * 1.5; // spans past its own (short) range too
      const targetPos = shared.destinationPoint(shooterPos, Math.random() * 360, distanceM);
      return { shooterPos, targetPos, headingDeg: null, accuracyM: 5, meta: { distanceM } };
    }, (shooterSample, targetLastAccepted) => shared.validateHitOmni({
      shooterId: 'A1', targetId: 'B1',
      shooter: shooterSample,
      target: targetLastAccepted,
    }, { ...gs.hitConfig, maxRangeM: hitRangeM }));
    assert.equal(mismatches, 0, `${mismatches}/${N} mismatches — first few: ${JSON.stringify(details)}`);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
