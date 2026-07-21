'use strict';
// ═══════════════════════════════════════════════════════════
//  AR OPS lifecycle test — full simulated Hide & Seek match.
//  Run: node server/test/arops_lifecycle.test.js
// ═══════════════════════════════════════════════════════════
const assert = require('assert');
const arops = require('../src/game/arops');
const shared = require('@craftworks/arops-shared');

// These tests predate "Auto" mode (field-size-derived timings/hitConfig,
// ON by default) and are deliberately about the STABLE, known DEFAULTS/
// DEFAULT_HIT_CONFIG values with tiny explicit ms-timings for fast test
// execution — scaleCoreConfig() has its own dedicated tests in
// packages/arops-shared. Force autoScale off here unless a test opts in.
function createGame(sessionId, players, workshopConfig) {
  const wc = { ...workshopConfig, ar_settings: { autoScale: false, ...(workshopConfig.ar_settings || {}) } };
  return arops.createAropsGame(sessionId, players, wc);
}

const MUC = { lat: 48.13743, lon: 11.57549 };
let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + ' — ' + e.message); }
}

// Playfield: 400×400m square around Marienplatz
const FIELD = [0, 90, 180, 270].map(b => shared.destinationPoint(MUC, b, 200));

function sampleAt(pos, over = {}) {
  return { lat: pos.lat, lon: pos.lon, ts: Date.now(), accuracyM: 6, headingDeg: null, ...over };
}

// ── Setup ───────────────────────────────────────────────────
console.log('\n── Session creation ──');

check('invalid polygon rejected', () => {
  assert.throws(() => createGame('bad', [{ userId: 'a', username: 'A' }], {
    ar_settings: { polygon: [MUC] },
  }), /invalid_polygon/);
});

const gs = createGame('s1',
  [
    { userId: 'S', username: 'Seeker' },
    { userId: 'H1', username: 'HiderOne' },
    { userId: 'H2', username: 'HiderTwo' },
  ],
  {
    ar_settings: {
      polygon: FIELD,
      roles: { S: 'seeker', H1: 'hider', H2: 'hider' },
      hidingDurationMs: 1000,
      gameDurationMs: 60_000,
      hitCooldownMs: 100,
      radarCooldownMs: 2000,
      geofenceGraceMs: 500,
      geofenceAutoFoundMs: 60_000,
    },
  }
);

check('session starts in hiding phase', () => {
  assert.equal(gs.phase, 'hiding');
  assert.equal(gs.players.S.role, 'seeker');
  assert.equal(gs.players.H1.role, 'hider');
});

// ── Telemetry ingest ────────────────────────────────────────
console.log('\n── Telemetry ──');

// Positions: seeker center, H1 50m north, H2 120m east
const posS = MUC;
const posH1 = shared.destinationPoint(MUC, 0, 50);
const posH2 = shared.destinationPoint(MUC, 90, 120);

check('valid telemetry accepted with geofence status', () => {
  const r = arops.actionArTelemetry(gs, 'S', { sample: sampleAt(posS) });
  assert.equal(r.ok, true);
  assert.equal(r.geofence, 'inside');
  arops.actionArTelemetry(gs, 'H1', { sample: sampleAt(posH1) });
  arops.actionArTelemetry(gs, 'H2', { sample: sampleAt(posH2) });
});

check('malformed sample rejected', () => {
  const r = arops.actionArTelemetry(gs, 'S', { sample: { lat: 999, lon: 0, ts: 1, accuracyM: 5 } });
  assert.equal(r.ok, false);
  assert.equal(r.err, 'bad_sample');
});

check('out-of-order sample rejected', () => {
  const r = arops.actionArTelemetry(gs, 'S', { sample: sampleAt(posS, { ts: Date.now() - 60_000 }) });
  assert.equal(r.err, 'stale_sample');
});

check('teleport rejected as implausible + strike', () => {
  const far = shared.destinationPoint(MUC, 0, 5000);
  const r = arops.actionArTelemetry(gs, 'S', {
    sample: sampleAt(far, { ts: Date.now() + 2000 }),
  });
  assert.equal(r.err, 'implausible');
  assert.equal(gs.players.S.strikes, 1);
});

// ── Phase gating ────────────────────────────────────────────
console.log('\n── Phase gating ──');

check('hit attempt during hiding phase rejected', () => {
  const r = arops.actionArHitAttempt(gs, 'S', {
    sample: sampleAt(posS, { headingDeg: 0, ts: Date.now() + 2100 }),
  });
  assert.equal(r.err, 'wrong_phase');
});

check('radar during hiding phase rejected', () => {
  const r = arops.actionArUsePerk(gs, 'S', { perk: 'radar' });
  assert.equal(r.err, 'wrong_phase');
});

// Advance to seeking
gs.phaseStartTime = Date.now() - 2000; // hiding started 2s ago > 1s duration
arops.tickArops(gs);

check('transitions to seeking after head start', () => {
  assert.equal(gs.phase, 'seeking');
  assert.ok(gs.events.some(e => e.type === 'phase_change'));
});

// ── Perks ───────────────────────────────────────────────────
console.log('\n── Perks ──');

check('radar reveals both hiders', () => {
  const r = arops.actionArUsePerk(gs, 'S', { perk: 'radar' });
  assert.equal(r.ok, true);
  assert.equal(r.contacts.length, 2);
  const ids = r.contacts.map(c => c.userId).sort();
  assert.deepEqual(ids, ['H1', 'H2']);
});

check('radar on cooldown after use', () => {
  const r = arops.actionArUsePerk(gs, 'S', { perk: 'radar' });
  assert.equal(r.err, 'cooldown');
  assert.ok(r.remainingMs > 0);
});

check('proximity warner triggers within range', () => {
  // H1 is 50m from seeker (range 40m) → no alert yet
  arops.tickArops(gs);
  assert.equal(gs.players.H1.proximityAlert, false);
  // Seeker moves to 30m from H1
  const near = shared.destinationPoint(posH1, 180, 30);
  arops.actionArTelemetry(gs, 'S', { sample: sampleAt(near, { ts: Date.now() + 5000 }) });
  arops.tickArops(gs);
  assert.equal(gs.players.H1.proximityAlert, true, 'H1 should be warned');
  assert.equal(gs.players.H2.proximityAlert, false, 'H2 is 100m+ away');
});

// ── Hits ────────────────────────────────────────────────────
console.log('\n── Hit validation ──');

// Reset seeker to center for clean geometry
const tBase = Date.now() + 10_000;
arops.actionArTelemetry(gs, 'S', { sample: sampleAt(posS, { ts: tBase }) });
arops.actionArTelemetry(gs, 'H1', { sample: sampleAt(posH1, { ts: tBase }) });
arops.actionArTelemetry(gs, 'H2', { sample: sampleAt(posH2, { ts: tBase }) });

check('hider cannot shoot in H&S', () => {
  const r = arops.actionArHitAttempt(gs, 'H1', {
    sample: sampleAt(posH1, { headingDeg: 180, ts: tBase + 100 }),
  });
  assert.equal(r.err, 'role_cannot_shoot');
});

check('aiming east misses hider standing north — no near-miss leak at 90°', () => {
  const r = arops.actionArHitAttempt(gs, 'S', {
    sample: sampleAt(posS, { headingDeg: 90, ts: tBase + 200 }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.hit, false);
  assert.equal(r.near, null, '90° off must NOT return near-miss info');
  assert.equal(gs.players.H1.status, 'alive');
});

check('slightly-off aim returns near-miss diagnostics (no direction)', () => {
  gs.players.S.lastHitAttemptAt = 0;
  // Every player defaults to Scout now (see createAropsGame) — its cone is
  // 3x the base half-angle, capped at maxToleranceDeg (here 45°, see
  // effectiveHitInfo): 15*3=45 already AT the cap, so unlike the old
  // classless default this is a FLAT 45° regardless of distance/GPS
  // accuracy (45 + any gpsAngle is still capped at 45). 60° off is
  // comfortably outside that cone (a real miss) but still within 2x
  // (90°) for the near-miss diagnostic to fire.
  const r = arops.actionArHitAttempt(gs, 'S', {
    sample: sampleAt(posS, { headingDeg: 60, ts: tBase + 250 }),
  });
  assert.equal(r.hit, false);
  assert.ok(r.near, 'expected near-miss info: ' + JSON.stringify(r));
  assert.ok(r.near.deltaDeg >= 56 && r.near.deltaDeg <= 64, 'delta ~60, got ' + r.near.deltaDeg);
  assert.ok(r.near.toleranceDeg >= 40, 'tolerance ~45 (Scout cap), got ' + r.near.toleranceDeg);
  assert.equal(r.near.bearing, undefined, 'direction must never leak');
});

check('hit cooldown enforced', () => {
  const r = arops.actionArHitAttempt(gs, 'S', {
    sample: sampleAt(posS, { headingDeg: 0, ts: tBase + 210 }),
  });
  assert.equal(r.err, 'cooldown');
});

check('aiming north hits H1 at 50m', () => {
  gs.players.S.lastHitAttemptAt = 0; // clear cooldown for test
  const r = arops.actionArHitAttempt(gs, 'S', {
    sample: sampleAt(posS, { headingDeg: 0, ts: tBase + 300 }),
  });
  assert.equal(r.hit, true, JSON.stringify(r));
  assert.equal(r.targetId, 'H1');
  assert.ok(r.confidence > 0.5);
  assert.equal(gs.players.H1.status, 'found');
  assert.equal(gs.players.H1.foundBy, 'S');
  assert.equal(gs.players.S.score, 10);
  assert.ok(gs.events.some(e => e.type === 'player_found' && e.userId === 'H1'));
});

check('found hider is no longer a hit candidate', () => {
  gs.players.S.lastHitAttemptAt = 0;
  const r = arops.actionArHitAttempt(gs, 'S', {
    sample: sampleAt(posS, { headingDeg: 0, ts: tBase + 400 }),
  });
  assert.equal(r.hit, false); // H1 found, H2 is east — aiming north hits nothing
});

check('game not over while H2 hides', () => {
  assert.equal(gs.gameOver, false);
});

// ── Snapshot privacy ────────────────────────────────────────
console.log('\n── Snapshot privacy ──');

check('seeker snapshot does NOT contain H2 position', () => {
  const snap = arops.getAropsSnapshot(gs, 'S');
  const h2 = snap.players.find(p => p.userId === 'H2');
  assert.equal(h2.lat, undefined, 'H2 lat must not leak');
  assert.equal(h2.lon, undefined);
  assert.equal(snap.hidersRemaining, 1);
});

check('own position included in own snapshot', () => {
  const snap = arops.getAropsSnapshot(gs, 'H2');
  const meEntry = snap.players.find(p => p.userId === 'H2');
  assert.ok(typeof meEntry.lat === 'number');
  assert.equal(snap.me.role, 'hider');
});

check('hider snapshot shows proximityAlert but no seeker position', () => {
  const snap = arops.getAropsSnapshot(gs, 'H2');
  const s = snap.players.find(p => p.userId === 'S');
  assert.equal(s.lat, undefined, 'seeker position must not leak to hider');
  assert.equal(typeof snap.me.proximityAlert, 'boolean');
});

// ── Geofence penalty → exposure → endgame ───────────────────
console.log('\n── Geofence penalties ──');

check('H2 leaving the field goes outside', () => {
  const outPos = shared.destinationPoint(MUC, 90, 300); // 100m past east edge
  // 180m from previous position → needs ~25s at plausible speed (7.2 m/s)
  const r = arops.actionArTelemetry(gs, 'H2', {
    sample: sampleAt(outPos, { ts: tBase + 25_000 }),
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.geofence, 'outside');
  assert.ok(gs.players.H2.outsideSince !== null);
});

check('after grace period H2 becomes exposed', () => {
  gs.players.H2.outsideSince = Date.now() - 1000; // > 500ms grace
  arops.tickArops(gs);
  assert.equal(gs.players.H2.exposed, true);
  assert.ok(gs.events.some(e => e.type === 'player_exposed' && e.userId === 'H2'));
});

check('exposed H2 position now visible in seeker snapshot', () => {
  const snap = arops.getAropsSnapshot(gs, 'S');
  const h2 = snap.players.find(p => p.userId === 'H2');
  assert.ok(typeof h2.lat === 'number', 'exposed position should be revealed');
  assert.equal(h2.exposed, true);
});

check('re-entering the field clears exposure', () => {
  const backIn = shared.destinationPoint(MUC, 90, 150);
  arops.actionArTelemetry(gs, 'H2', { sample: sampleAt(backIn, { ts: tBase + 60_000 }) });
  assert.equal(gs.players.H2.exposed, false);
  const snap = arops.getAropsSnapshot(gs, 'S');
  const h2 = snap.players.find(p => p.userId === 'H2');
  assert.equal(h2.lat, undefined, 'position hidden again after re-entry');
});

// ── Endgame ─────────────────────────────────────────────────
console.log('\n── Endgame ──');

check('finding the last hider ends the game — seekers win', () => {
  // Seeker moves near H2 and aims at it
  const h2pos = gs.players.H2.lastAccepted;
  const standoff = shared.destinationPoint(h2pos, 180, 40);
  const tEnd = tBase + 61_000;
  arops.actionArTelemetry(gs, 'S', { sample: sampleAt(standoff, { ts: tEnd }) });
  gs.players.S.lastHitAttemptAt = 0;
  const brg = shared.bearingDeg(standoff, h2pos);
  const r = arops.actionArHitAttempt(gs, 'S', {
    sample: sampleAt(standoff, { headingDeg: brg, ts: tEnd + 100 }),
  });
  assert.equal(r.hit, true, JSON.stringify(r));
  assert.equal(gs.gameOver, true);
  assert.equal(gs.winner, 'seekers');
  assert.equal(gs._gameOverWin, true);
});

check('post-game actions rejected', () => {
  const r = arops.actionArTelemetry(gs, 'S', { sample: sampleAt(posS, { ts: Date.now() + 999_000 }) });
  assert.equal(r.err, 'game_over');
});

// ── Timeout path: hiders win ────────────────────────────────
console.log('\n── Timeout → hiders win ──');

const gs2 = createGame('s2',
  [{ userId: 'S', username: 'S' }, { userId: 'H', username: 'H' }],
  { ar_settings: { polygon: FIELD, roles: { S: 'seeker', H: 'hider' }, hidingDurationMs: 100, gameDurationMs: 500 } }
);
gs2.phaseStartTime = Date.now() - 200;
arops.tickArops(gs2); // → seeking

check('time limit reached → surviving hiders win with bonus', () => {
  assert.equal(gs2.phase, 'seeking');
  gs2.phaseStartTime = Date.now() - 1000; // seeking longer than 500ms limit
  arops.tickArops(gs2);
  assert.equal(gs2.gameOver, true);
  assert.equal(gs2.winner, 'hiders');
  assert.equal(gs2.players.H.score, 20);
  assert.equal(gs2._gameOverWin, false);
});

// ── Summary ─────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
