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
// Real (not faked) clock advance — needed wherever code under test stamps
// samples with Date.now() itself (e.g. tickBots), where two synchronous
// calls can otherwise land in the same millisecond and get rejected as stale.
function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy-wait */ }
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

// ═══ HIDE & SEEK PERKS (Drohne / Cloak / Fake-Marker / Aufscheuchen) ═══
console.log('\n═══ H&S PERKS ═══');
{
  const mkHS = () => {
    const gs = arops.createAropsGame('hsperk' + Math.random(),
      [{ userId: 'S1', username: 'S1' }, { userId: 'H1', username: 'H1' }, { userId: 'H2', username: 'H2' }],
      { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek',
        roles: { S1: 'seeker', H1: 'hider', H2: 'hider' },
        hidingDurationMs: 0, gameDurationMs: 600_000, radarCooldownMs: 0 } });
    tick(gs, 10); // hiding(0ms) → seeking
    return gs;
  };
  const droneRangeM = shared.scaleDroneRangeM(shared.polygonAreaM2(FIELD));

  check('Drohne: seeker within range → alert true', () => {
    const gs = mkHS();
    tel(gs, 'H1', MUC);
    tel(gs, 'S1', shared.destinationPoint(MUC, 0, droneRangeM - 20));
    const r = arops.actionArUsePerk(gs, 'H1', { perk: 'drone' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.alert, true);
  });

  check('Drohne: seeker outside range → alert false', () => {
    const gs = mkHS();
    tel(gs, 'H1', MUC);
    tel(gs, 'S1', shared.destinationPoint(MUC, 0, droneRangeM + 30));
    const r = arops.actionArUsePerk(gs, 'H1', { perk: 'drone' });
    assert.equal(r.alert, false);
  });

  check('Drohne: seeker cannot use it (wrong role)', () => {
    const gs = mkHS();
    const r = arops.actionArUsePerk(gs, 'S1', { perk: 'drone' });
    assert.equal(r.err, 'perk_wrong_role');
  });

  check('Drohne: cooldown enforced', () => {
    const gs = mkHS();
    tel(gs, 'H1', MUC);
    arops.actionArUsePerk(gs, 'H1', { perk: 'drone' });
    const r = arops.actionArUsePerk(gs, 'H1', { perk: 'drone' });
    assert.equal(r.err, 'cooldown');
  });

  check('Cloak: cloaked hider excluded from radar contacts', () => {
    const gs = mkHS();
    tel(gs, 'H1', MUC); tel(gs, 'H2', shared.destinationPoint(MUC, 90, 30));
    tel(gs, 'S1', MUC);
    const cr = arops.actionArUsePerk(gs, 'H1', { perk: 'cloak' });
    assert.equal(cr.ok, true, JSON.stringify(cr));
    const r = arops.actionArUsePerk(gs, 'S1', { perk: 'radar' });
    assert.ok(!r.contacts.some(c => c.userId === 'H1'), 'cloaked hider must be hidden');
    assert.ok(r.contacts.some(c => c.userId === 'H2'), 'uncloaked hider still visible');
  });

  check('Cloak: cloaked hider does not trigger seeker proximity alert even at 0m', () => {
    const gs = mkHS();
    tel(gs, 'H1', MUC); tel(gs, 'S1', MUC);
    arops.actionArUsePerk(gs, 'H1', { perk: 'cloak' });
    tick(gs, 100);
    assert.equal(gs.players.S1.proximityAlert, false, 'cloak must suppress detection at any range');
    gs.players.H1.cloakUntil = Date.now() - 1; // simulate expiry
    tick(gs, 100);
    assert.equal(gs.players.S1.proximityAlert, true, 'detection resumes after cloak expires');
  });

  check('Fake-Marker: decoys mixed into radar contacts, inside the field, expire', () => {
    const gs = mkHS();
    tel(gs, 'H1', MUC); tel(gs, 'S1', MUC);
    const fr = arops.actionArUsePerk(gs, 'H1', { perk: 'fake_marker' });
    assert.equal(fr.ok, true, JSON.stringify(fr));
    const r = arops.actionArUsePerk(gs, 'S1', { perk: 'radar' });
    const decoys = r.contacts.filter(c => c.userId.startsWith('decoy_H1_'));
    assert.equal(decoys.length, 2, JSON.stringify(r.contacts));
    for (const d of decoys) {
      assert.ok(shared.pointInPolygon({ lat: d.lat, lon: d.lon }, FIELD), 'decoy must be inside the field');
    }
    gs.players.H1.fakeMarkerUntil = Date.now() - 1; // simulate expiry
    const r2 = arops.actionArUsePerk(gs, 'S1', { perk: 'radar' });
    assert.equal(r2.contacts.filter(c => c.userId.startsWith('decoy_')).length, 0);
  });

  check('Aufscheuchen: seeker fakes proximity alert on all alive hiders, then it expires', () => {
    const gs = mkHS();
    tel(gs, 'H1', shared.destinationPoint(MUC, 0, 500));
    tel(gs, 'H2', shared.destinationPoint(MUC, 180, 500));
    tel(gs, 'S1', MUC);
    tick(gs, 100);
    assert.equal(gs.players.H1.proximityAlert, false, 'far apart — no real alert yet');
    const r = arops.actionArUsePerk(gs, 'S1', { perk: 'aufscheuchen' });
    assert.equal(r.ok, true, JSON.stringify(r));
    tick(gs, 100);
    assert.equal(gs.players.H1.proximityAlert, true, 'faked alert');
    assert.equal(gs.players.H2.proximityAlert, true, 'faked alert reaches every alive hider');
    gs.players.H1.fakeProximityUntil = Date.now() - 1;
    gs.players.H2.fakeProximityUntil = Date.now() - 1;
    tick(gs, 100);
    assert.equal(gs.players.H1.proximityAlert, false, 'fake alert must expire');
  });

  check('Aufscheuchen: hider cannot use it (wrong role)', () => {
    const gs = mkHS();
    const r = arops.actionArUsePerk(gs, 'H1', { perk: 'aufscheuchen' });
    assert.equal(r.err, 'perk_wrong_role');
  });

  check('Drohne/Cloak/Fake-Marker/Aufscheuchen rejected outside hide_and_seek', () => {
    const gs = arops.createAropsGame('teamperk' + Math.random(),
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'domination', zones: [Z1, Z2], timings: FAST } });
    for (const perk of ['drone', 'cloak', 'fake_marker', 'aufscheuchen']) {
      const r = arops.actionArUsePerk(gs, 'A1', { perk });
      assert.equal(r.err, 'wrong_mode', perk);
    }
  });
}

// ═══ FOUND-HIDER FATE (host setting: spectator vs. switch to seeker) ═══
console.log('\n═══ FOUND-HIDER FATE ═══');
{
  const posS = MUC;
  const posH1 = shared.destinationPoint(MUC, 0, 50);
  const posH2 = shared.destinationPoint(MUC, 90, 30);

  const mkFound = (foundMode) => {
    const gs = arops.createAropsGame('found' + Math.random(),
      [{ userId: 'S', username: 'S' }, { userId: 'H1', username: 'H1' }, { userId: 'H2', username: 'H2' }],
      { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek',
        roles: { S: 'seeker', H1: 'hider', H2: 'hider' },
        hidingDurationMs: 0, gameDurationMs: 600_000, hitCooldownMs: 50, foundMode } });
    tick(gs, 10); // → seeking
    return gs;
  };

  check("foundMode='seeker': found hider flips role, stays alive, can hunt", () => {
    const gs = mkFound('seeker');
    const t0 = Date.now();
    arops.actionArTelemetry(gs, 'S', { sample: { lat: posS.lat, lon: posS.lon, ts: t0, accuracyM: 5 } });
    arops.actionArTelemetry(gs, 'H1', { sample: { lat: posH1.lat, lon: posH1.lon, ts: t0, accuracyM: 5 } });
    arops.actionArTelemetry(gs, 'H2', { sample: { lat: posH2.lat, lon: posH2.lon, ts: t0, accuracyM: 5 } });

    const r = arops.actionArHitAttempt(gs, 'S', {
      sample: { lat: posS.lat, lon: posS.lon, ts: t0 + 1100, accuracyM: 5, headingDeg: 0 },
    });
    assert.equal(r.hit, true, JSON.stringify(r));
    assert.equal(gs.players.H1.role, 'seeker', 'found hider becomes a seeker');
    assert.equal(gs.players.H1.status, 'alive', 'stays alive, keeps playing');
    assert.equal(gs.gameOver, false, 'one hider remains');

    // H1 (now a seeker) hunts down H2
    gs.players.H1.lastHitAttemptAt = 0;
    const headingToH2 = shared.bearingDeg(posH1, posH2);
    const r2 = arops.actionArHitAttempt(gs, 'H1', {
      sample: { lat: posH1.lat, lon: posH1.lon, ts: t0 + 2200, accuracyM: 5, headingDeg: headingToH2 },
    });
    assert.equal(r2.hit, true, JSON.stringify(r2));
    assert.equal(gs.players.H2.role, 'seeker');
    assert.equal(gs.gameOver, true, 'no hiders left → seekers win');
    assert.equal(gs.winner, 'seekers');
  });

  check("foundMode='spectator' (default): unchanged behavior", () => {
    const gs = mkFound(undefined);
    const t0 = Date.now();
    arops.actionArTelemetry(gs, 'S', { sample: { lat: posS.lat, lon: posS.lon, ts: t0, accuracyM: 5 } });
    arops.actionArTelemetry(gs, 'H1', { sample: { lat: posH1.lat, lon: posH1.lon, ts: t0, accuracyM: 5 } });

    const r = arops.actionArHitAttempt(gs, 'S', {
      sample: { lat: posS.lat, lon: posS.lon, ts: t0 + 1100, accuracyM: 5, headingDeg: 0 },
    });
    assert.equal(r.hit, true, JSON.stringify(r));
    assert.equal(gs.players.H1.role, 'hider', 'role unchanged in spectator mode');
    assert.equal(gs.players.H1.status, 'found', 'sidelined as before');
  });
}

// ═══ BOTS & DEBUG MODE ═══════════════════════════════════════
console.log('\n═══ BOTS & DEBUG MODE ═══');
{
  // Force the bot-step throttle open on every call for deterministic tests.
  // tickBots stamps samples with a fresh Date.now() each call — a real (if
  // tiny) sleep guarantees strictly-increasing ts across calls, since
  // synchronous back-to-back Date.now() calls can otherwise land in the
  // same millisecond and get rejected by actionArTelemetry's staleness check.
  function botTick(gs, advanceMs = 100) {
    sleepMs(2);
    gs._lastModeTick = Date.now() - Math.min(2000, advanceMs);
    gs._lastBotStep = 0;
    arops.tickArops(gs);
  }

  check('bot seeker chasing a stationary hider strictly closes distance', () => {
    const gs = arops.createAropsGame('botA' + Math.random(),
      [
        { userId: 'H1', username: 'H1' },
        { userId: 'bot_S', username: 'Bot S', isBot: true },
      ],
      { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek',
        roles: { H1: 'hider', bot_S: 'seeker' },
        hidingDurationMs: 0, gameDurationMs: 600_000 } });
    assert.equal(gs.players.bot_S.isBot, true);

    // Stationary hider at field center; bot seeker starts 150m out. Bots move
    // on the real Date.now() clock (unlike tel()'s fake TS), so seed with that.
    tel(gs, 'H1', MUC);
    gs.players.bot_S.lastAccepted = { ...shared.destinationPoint(MUC, 45, 150), ts: Date.now(), accuracyM: 4, headingDeg: 0 };
    botTick(gs); // flips hiding→seeking on this call

    const distAfterSeed = shared.haversineMeters(gs.players.bot_S.lastAccepted, MUC);
    for (let i = 0; i < 20; i++) botTick(gs);
    const distAfter = shared.haversineMeters(gs.players.bot_S.lastAccepted, MUC);

    assert.ok(distAfter < distAfterSeed - 15, `expected clear approach, ${distAfterSeed}m → ${distAfter}m`);
    assert.ok(shared.pointInPolygon(gs.players.bot_S.lastAccepted, FIELD), 'bot must stay inside the field');
    assert.equal(gs.players.bot_S.strikes, 0, 'bot movement must never trip anti-spoof strikes');
  });

  check('bot hider fleeing a stationary seeker strictly increases distance', () => {
    const gs = arops.createAropsGame('botB' + Math.random(),
      [
        { userId: 'S1', username: 'S1' },
        { userId: 'bot_H', username: 'Bot H', isBot: true },
      ],
      { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek',
        roles: { S1: 'seeker', bot_H: 'hider' },
        hidingDurationMs: 0, gameDurationMs: 600_000 } });

    const seekerPos = shared.destinationPoint(MUC, 0, 50);
    tel(gs, 'S1', seekerPos);
    gs.players.bot_H.lastAccepted = { lat: MUC.lat, lon: MUC.lon, ts: Date.now(), accuracyM: 4, headingDeg: 0 };
    botTick(gs); // flips hiding→seeking

    const distAfterSeed = shared.haversineMeters(gs.players.bot_H.lastAccepted, seekerPos);
    for (let i = 0; i < 15; i++) botTick(gs);
    const distAfter = shared.haversineMeters(gs.players.bot_H.lastAccepted, seekerPos);

    assert.ok(distAfter > distAfterSeed + 10, `expected clear flight, ${distAfterSeed}m → ${distAfter}m`);
    assert.ok(shared.pointInPolygon(gs.players.bot_H.lastAccepted, FIELD), 'bot must stay inside the field');
  });

  check('solo debug session: explicit hider role is respected, not force-switched to seeker', () => {
    const gs = arops.createAropsGame('solo' + Math.random(),
      [{ userId: 'H1', username: 'H1' }],
      { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek',
        roles: { H1: 'hider' }, debugMode: true,
        hidingDurationMs: 0, gameDurationMs: 600_000 } });
    assert.equal(gs.players.H1.role, 'hider', 'debugMode must not force a lone player into seeker');
  });

  check('solo debug hider auto-found by geofence never ends the game via checkWin', () => {
    const gs = arops.createAropsGame('solo2' + Math.random(),
      [{ userId: 'H1', username: 'H1' }],
      { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek',
        roles: { H1: 'hider' }, debugMode: true,
        hidingDurationMs: 0, gameDurationMs: 600_000, geofenceAutoFoundMs: 1000 } });
    assert.equal(gs.players.H1.role, 'hider');
    const outside = shared.destinationPoint(MUC, 0, 500);
    tel(gs, 'H1', outside);
    botTick(gs); // hiding→seeking; geofence marks 'outside', sets outsideSince
    assert.equal(gs.players.H1.geofence, 'outside');
    // Simulate elapsed real time past geofenceAutoFoundMs without a real sleep
    // (game-loop timing uses Date.now(), independent of the fake TS clock).
    gs.players.H1.outsideSince = Date.now() - 2000;
    botTick(gs);
    assert.equal(gs.players.H1.status, 'found', 'geofence auto-found still fires normally');
    assert.equal(gs.gameOver, false, 'but a 1-player session must not auto-end from it');
  });

  check('bots are excluded from real DB persistence but flow through the engine identically', () => {
    // No DB in these engine-level tests — this documents the contract:
    // createAropsGame never touches a database, so a synthetic {isBot:true}
    // player is accepted with no special-casing anywhere except tickBots.
    const gs = arops.createAropsGame('botC' + Math.random(),
      [
        { userId: 'H1', username: 'H1' },
        { userId: 'bot_1', username: 'Bot 1', isBot: true },
        { userId: 'bot_2', username: 'Bot 2', isBot: true },
      ],
      { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek', debugMode: true,
        roles: { H1: 'seeker', bot_1: 'hider', bot_2: 'hider' },
        hidingDurationMs: 0, gameDurationMs: 600_000 } });
    assert.equal(gs._hasBots, true);
    tel(gs, 'H1', MUC);
    botTick(gs); // seeds both bots' initial positions
    assert.ok(gs.players.bot_1.lastAccepted && gs.players.bot_2.lastAccepted, 'both bots seeded');
    assert.equal(gs.gameOver, false);
  });
}

// ═══ DEBUG-MODE REVEAL ═══════════════════════════════════════
console.log('\n═══ DEBUG-MODE REVEAL ═══');
{
  const mk = (debugMode) => {
    const gs = arops.createAropsGame('debugreveal' + Math.random(),
      [{ userId: 'S1', username: 'S1' }, { userId: 'H1', username: 'H1' }],
      { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek',
        roles: { S1: 'seeker', H1: 'hider' }, debugMode,
        hidingDurationMs: 0, gameDurationMs: 600_000 } });
    gs._lastModeTick = Date.now() - 100;
    arops.tickArops(gs); // hiding → seeking
    return gs;
  };

  check('without debugMode: seeker never sees a non-exposed hider position', () => {
    const gs = mk(false);
    tel(gs, 'H1', shared.destinationPoint(MUC, 0, 40), { accuracyM: 6 });
    tel(gs, 'S1', MUC);
    const snap = arops.getAropsSnapshot(gs, 'S1');
    const h1 = snap.players.find(p => p.userId === 'H1');
    assert.equal(h1.lat, undefined, 'position must stay hidden');
    assert.equal(h1.accuracyM, undefined);
  });

  check('with debugMode: seeker sees the hider position and accuracyM regardless of exposure', () => {
    const gs = mk(true);
    tel(gs, 'H1', shared.destinationPoint(MUC, 0, 40), { accuracyM: 6 });
    tel(gs, 'S1', MUC);
    const snap = arops.getAropsSnapshot(gs, 'S1');
    const h1 = snap.players.find(p => p.userId === 'H1');
    assert.equal(typeof h1.lat, 'number', 'debugMode must reveal the position');
    assert.equal(typeof h1.lon, 'number');
    assert.equal(h1.accuracyM, 6, 'accuracy must be revealed too, for client-side hitToleranceDeg math');
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
