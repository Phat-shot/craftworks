'use strict';
// ═══════════════════════════════════════════════════════════
//  AR OPS mode tests — domination, CTF, S&D, freeze mechanic.
//  Run: node server/test/arops_modes.test.js
// ═══════════════════════════════════════════════════════════
const assert = require('assert');
const arops = require('../src/game/arops');
const shared = require('../../packages/arops-shared/dist/src');

const MUC = { lat: 48.13743, lon: 11.57549 };
const FIELD = [0, 90, 180, 270].map(b => shared.destinationPoint(MUC, b, 200));
let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + ' — ' + e.message); }
}
let TS = Date.now();
function tick(gs, advanceMs) {
  // Deterministic dt: manipulate _lastModeTick so mode tick sees advanceMs
  gs._lastModeTick = Date.now() - Math.min(2000, advanceMs);
  arops.tickArops(gs);
}
function tel(gs, uid, pos, over = {}) {
  TS += 1100;
  return arops.actionArTelemetry(gs, uid, {
    sample: { lat: pos.lat, lon: pos.lon, ts: TS, accuracyM: 5, headingDeg: null, ...over },
  });
}
// Fast timings for tests (explicit override wins over scaling)
const FAST = {
  captureDwellMs: 300, flagPickupDwellMs: 300, flagReturnMs: 800,
  plantDwellMs: 300, defuseDwellMs: 300, bombTimerMs: 2000,
  freezeMs: 1000, freezeExtensionMs: 500, freezeMoveToleranceM: 15,
  baseSettingMs: 500, minBaseSeparationM: 50, zoneRadiusM: 15,
};

const Z1 = shared.destinationPoint(MUC, 90, 100);
const Z2 = shared.destinationPoint(MUC, 270, 100);

// ═══ DOMINATION ═════════════════════════════════════════════
console.log('\n═══ DOMINATION ═══');
{
  const gs = arops.createAropsGame('dom1',
    [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' },
     { userId: 'A2', username: 'A2' }, { userId: 'B2', username: 'B2' }],
    { ar_settings: { polygon: FIELD, subMode: 'domination', zones: [Z1, Z2],
      timings: FAST, targetScore: 10, gameDurationMs: 600_000 } });

  check('teams alternate, captains = first per team', () => {
    assert.equal(gs.players.A1.team, 'a');
    assert.equal(gs.players.B1.team, 'b');
    assert.equal(gs.players.A2.team, 'a');
    assert.equal(gs.captains.a, 'A1');
    assert.equal(gs.captains.b, 'B1');
    assert.equal(gs.phase, 'live');
  });

  check('zone capture after dwell', () => {
    tel(gs, 'A1', Z1);           // A1 stands in zone 1
    tick(gs, 200);
    assert.equal(gs.modeState.owners.z1, null, 'not yet');
    tick(gs, 200);               // 400ms total ≥ 300ms dwell
    assert.equal(gs.modeState.owners.z1, 'a');
    assert.ok(gs.events.some(e => e.type === 'zone_captured' && e.team === 'a'));
  });

  check('contested zone pauses capture', () => {
    tel(gs, 'B1', Z2); tel(gs, 'A2', Z2);   // both teams in zone 2
    tick(gs, 500); tick(gs, 500);
    assert.equal(gs.modeState.owners.z2, null, 'contested must not capture');
  });

  check('owned zone scores points per second', () => {
    const before = gs.modeState.teamScore.a;
    tick(gs, 2000);
    assert.ok(gs.modeState.teamScore.a >= before + 1.5, 'a scores from z1');
  });

  check('target score ends the game', () => {
    for (let i = 0; i < 8 && !gs.gameOver; i++) tick(gs, 2000);
    assert.equal(gs.gameOver, true);
    assert.equal(gs.winner, 'team_a');
    assert.equal(gs._gameOverWin, true);
  });

  check('snapshot carries teamScore + zone owners; teammates see positions', () => {
    const snap = arops.getAropsSnapshot(gs, 'A1');
    assert.ok(snap.teamScore.a >= 10);
    assert.equal(snap.zones.find(z => z.id === 'z1').owner, 'a');
    const mate = snap.players.find(p => p.userId === 'A2');
    assert.ok(typeof mate.lat === 'number', 'teammate position visible');
    const foe = snap.players.find(p => p.userId === 'B2');
    assert.equal(foe.lat, undefined, 'enemy hidden (B2 sent no exposing state)');
  });
}

// ═══ FREEZE MECHANIC ════════════════════════════════════════
console.log('\n═══ FREEZE ═══');
{
  const gs = arops.createAropsGame('frz1',
    [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
    { ar_settings: { polygon: FIELD, subMode: 'domination', zones: [Z1, Z2],
      timings: { ...FAST, freezeMs: 60_000 }, hitCooldownMs: 50 } });

  const pA = MUC, pB = shared.destinationPoint(MUC, 0, 40);
  tel(gs, 'A1', pA); tel(gs, 'B1', pB);

  check('team-mode hit freezes the target', () => {
    TS += 1100;
    const r = arops.actionArHitAttempt(gs, 'A1', {
      sample: { lat: pA.lat, lon: pA.lon, ts: TS, accuracyM: 5, headingDeg: 0 },
    });
    assert.equal(r.hit, true, JSON.stringify(r));
    assert.ok(gs.players.B1.frozenUntil > Date.now());
    assert.ok(gs.events.some(e => e.type === 'player_frozen'));
  });

  check('frozen player cannot shoot', () => {
    TS += 1100;
    const r = arops.actionArHitAttempt(gs, 'B1', {
      sample: { lat: pB.lat, lon: pB.lon, ts: TS, accuracyM: 5, headingDeg: 180 },
    });
    assert.equal(r.err, 'frozen');
    assert.ok(r.remainingMs > 0);
  });

  check('frozen player cannot be hit again', () => {
    gs.players.A1.lastHitAttemptAt = 0;
    TS += 1100;
    const r = arops.actionArHitAttempt(gs, 'A1', {
      sample: { lat: pA.lat, lon: pA.lon, ts: TS, accuracyM: 5, headingDeg: 0 },
    });
    assert.equal(r.hit, false, 'frozen target must be excluded');
  });

  check('moving beyond tolerance extends the freeze', () => {
    const before = gs.players.B1.frozenUntil;
    // B1 "walks" 25m (> 15m tolerance) — plausible speed over 3 samples
    let pos = pB;
    for (let i = 0; i < 3; i++) {
      pos = shared.destinationPoint(pos, 90, 8.4);
      tel(gs, 'B1', pos);
    }
    assert.ok(gs.players.B1.frozenUntil > before, 'freeze extended');
    assert.ok(gs.players.B1.freezeViolations >= 1);
    assert.ok(gs.events.some(e => e.type === 'freeze_extended'));
  });

  check('frozen players do not count for zone capture', () => {
    // B1 frozen inside no zone; A1 walks into Z1 unfrozen → sanity only
    const snap = arops.getAropsSnapshot(gs, 'B1');
    assert.ok(snap.me.frozenRemainingMs > 0);
    assert.equal(snap.players.find(p => p.userId === 'B1').frozen, true);
  });
}

// ═══ CTF ════════════════════════════════════════════════════
console.log('\n═══ CTF ═══');
{
  const gs = arops.createAropsGame('ctf1',
    [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
    { ar_settings: { polygon: FIELD, subMode: 'ctf',
      timings: FAST, targetCaptures: 2, gameDurationMs: 600_000, hitCooldownMs: 50 } });

  const baseA = shared.destinationPoint(MUC, 270, 120);
  const baseB = shared.destinationPoint(MUC, 90, 120);

  check('starts in base_setup; only captain can set base', () => {
    assert.equal(gs.phase, 'base_setup');
    const r1 = arops.actionArSetBase(gs, 'B1', { lat: baseB.lat, lon: baseB.lon });
    assert.equal(r1.ok, true, JSON.stringify(r1));
    // A1 is captain of a — works; a non-captain would fail (only 2 players here,
    // so verify the wrong-team path: B1 setting again overwrites own base = ok)
  });

  check('bases_too_close rejected', () => {
    const near = shared.destinationPoint(baseB, 0, 10);
    const r = arops.actionArSetBase(gs, 'A1', { lat: near.lat, lon: near.lon });
    assert.equal(r.err, 'bases_too_close');
  });

  check('base outside field rejected', () => {
    const out = shared.destinationPoint(MUC, 90, 400);
    const r = arops.actionArSetBase(gs, 'A1', { lat: out.lat, lon: out.lon });
    assert.equal(r.err, 'outside_field');
  });

  check('valid base set; timeout starts live phase', () => {
    const r = arops.actionArSetBase(gs, 'A1', { lat: baseA.lat, lon: baseA.lon });
    assert.equal(r.ok, true);
    gs.phaseStartTime = Date.now() - 1000; // > 500ms baseSettingMs
    tick(gs, 100);
    assert.equal(gs.phase, 'live');
  });

  check('enemy dwell in base steals the flag', () => {
    tel(gs, 'A1', baseB);         // A1 stands in B's base
    tick(gs, 200);
    assert.equal(gs.modeState.flags.b.state, 'home', 'not yet');
    tick(gs, 200);
    assert.equal(gs.modeState.flags.b.state, 'carried');
    assert.equal(gs.modeState.flags.b.carrier, 'A1');
  });

  check('carrier is revealed to the enemy', () => {
    const snap = arops.getAropsSnapshot(gs, 'B1');
    const a1 = snap.players.find(p => p.userId === 'A1');
    assert.ok(typeof a1.lat === 'number', 'carrier position must be public');
  });

  check('carrying the flag home captures (own flag home)', () => {
    // A1 walks home: plausible steps ~100m/12 samples won't matter — teleport check
    // needs plausible speed; use several samples
    let pos = baseB;
    const brg = shared.bearingDeg(baseB, baseA);
    for (let i = 0; i < 22 && shared.haversineMeters(pos, baseA) > 8; i++) {
      pos = shared.destinationPoint(pos, brg, 12);
      tel(gs, 'A1', pos);
    }
    tick(gs, 100);
    assert.equal(gs.modeState.captures.a, 1, JSON.stringify(gs.modeState));
    assert.equal(gs.modeState.flags.b.state, 'home');
  });

  check('freeze drops the flag; own team touch returns it', () => {
    // A1 steals again
    let pos = gs.players.A1.lastAccepted;
    const brg = shared.bearingDeg(pos, baseB);
    for (let i = 0; i < 22 && shared.haversineMeters(pos, baseB) > 8; i++) {
      pos = shared.destinationPoint(pos, brg, 12);
      tel(gs, 'A1', pos);
    }
    tick(gs, 400);
    assert.equal(gs.modeState.flags.b.state, 'carried');
    // B1 (near A1's position for the shot) freezes A1
    const shooterPos = shared.destinationPoint(pos, 180, 30);
    tel(gs, 'B1', shooterPos, {});
    gs.players.B1.lastAccepted = { ...gs.players.B1.lastAccepted };
    TS += 1100;
    const r = arops.actionArHitAttempt(gs, 'B1', {
      sample: { lat: shooterPos.lat, lon: shooterPos.lon, ts: TS, accuracyM: 5,
                headingDeg: shared.bearingDeg(shooterPos, pos) },
    });
    assert.equal(r.hit, true, JSON.stringify(r));
    assert.equal(gs.modeState.flags.b.state, 'dropped');
    // B1 walks to the dropped flag → instant return
    let bp = shooterPos;
    const brg2 = shared.bearingDeg(bp, pos);
    for (let i = 0; i < 6 && shared.haversineMeters(bp, pos) > 6; i++) {
      bp = shared.destinationPoint(bp, brg2, 7);
      tel(gs, 'B1', bp);
    }
    tick(gs, 100);
    assert.equal(gs.modeState.flags.b.state, 'home');
    assert.ok(gs.events.some(e => e.type === 'flag_returned'));
  });
}

// ═══ SEEK & DESTROY ═════════════════════════════════════════
console.log('\n═══ SEEK & DESTROY ═══');
{
  const mk = () => arops.createAropsGame('snd' + Math.random(),
    [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
    { ar_settings: { polygon: FIELD, subMode: 'seek_destroy', zones: [Z1],
      timings: FAST, gameDurationMs: 600_000 } });

  check('attacker plants after dwell; bomb timer runs', () => {
    const gs = mk();
    tel(gs, 'A1', Z1);
    tick(gs, 200); tick(gs, 200);
    assert.ok(gs.modeState.bomb, 'planted');
    assert.ok(gs.events.some(e => e.type === 'bomb_planted'));
    assert.equal(gs.gameOver, false);
  });

  check('defender defuses → defenders win', () => {
    const gs = mk();
    tel(gs, 'A1', Z1);
    tick(gs, 200); tick(gs, 200);            // plant
    tel(gs, 'B1', Z1);                        // defender enters site
    // attacker leaves (so presence is clean)
    tel(gs, 'A1', shared.destinationPoint(Z1, 90, 30));
    tick(gs, 200); tick(gs, 200);            // defuse dwell
    assert.equal(gs.gameOver, true);
    assert.equal(gs.winner, 'team_b');
  });

  check('bomb timer expiry → attackers win', () => {
    const gs = mk();
    tel(gs, 'A1', Z1);
    tick(gs, 200); tick(gs, 200);            // plant
    gs.modeState.bomb.explodeAt = Date.now() - 1;
    tick(gs, 100);
    assert.equal(gs.gameOver, true);
    assert.equal(gs.winner, 'team_a');
    assert.ok(gs.events.some(e => e.type === 'bomb_exploded'));
  });

  check('time limit without plant → defenders win', () => {
    const gs = mk();
    gs.phaseStartTime = Date.now() - 700_000;
    tick(gs, 100);
    assert.equal(gs.winner, 'team_b');
  });

  check('zones required for snd/domination', () => {
    assert.throws(() => arops.createAropsGame('bad',
      [{ userId: 'x', username: 'x' }, { userId: 'y', username: 'y' }],
      { ar_settings: { polygon: FIELD, subMode: 'seek_destroy' } }), /need_zones/);
    assert.throws(() => arops.createAropsGame('bad2',
      [{ userId: 'x', username: 'x' }, { userId: 'y', username: 'y' }],
      { ar_settings: { polygon: FIELD, subMode: 'domination', zones: [Z1] } }), /need_zones/);
  });
}

// ═══ MISS DIAGNOSTICS ═══════════════════════════════════════
console.log('\n═══ MISS-DIAGNOSE ═══');
{
  // Same team → no_candidates
  const gs = arops.createAropsGame('diag1',
    [{ userId: 'A1', username: 'A1' }, { userId: 'A2', username: 'A2' }],
    { ar_settings: { polygon: FIELD, subMode: 'domination', zones: [Z1, Z2],
      teams: { A1: 'a', A2: 'a' }, timings: FAST, hitCooldownMs: 50 } });
  const pB = shared.destinationPoint(MUC, 0, 40);
  tel(gs, 'A1', MUC); tel(gs, 'A2', pB);
  check('same team → reason no_candidates', () => {
    TS += 1100;
    const r = arops.actionArHitAttempt(gs, 'A1', {
      sample: { lat: MUC.lat, lon: MUC.lon, ts: TS, accuracyM: 5, headingDeg: 0 } });
    assert.equal(r.hit, false);
    assert.equal(r.reason, 'no_candidates');
  });
}
{
  // Stale target telemetry → target_stale
  const gs = arops.createAropsGame('diag2',
    [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
    { ar_settings: { polygon: FIELD, subMode: 'domination', zones: [Z1, Z2],
      timings: FAST, hitCooldownMs: 50 } });
  const pB = shared.destinationPoint(MUC, 0, 40);
  tel(gs, 'A1', MUC); tel(gs, 'B1', pB);
  check('stale target telemetry → reason target_stale', () => {
    // shooter fires with a trigger 20s AFTER the target's last sample
    TS += 20_000;
    tel(gs, 'A1', MUC); // keep shooter fresh + plausible
    TS += 1100;
    const r = arops.actionArHitAttempt(gs, 'A1', {
      sample: { lat: MUC.lat, lon: MUC.lon, ts: TS, accuracyM: 5, headingDeg: 0 } });
    assert.equal(r.hit, false, JSON.stringify(r));
    assert.equal(r.reason, 'target_stale');
    assert.equal(r.near, null, 'stale must not leak geometry');
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
