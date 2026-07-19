'use strict';
// ═══════════════════════════════════════════════════════════
//  AR OPS player classes — Scout/Sniper/Bomber (additive to role/team).
//  Run: node server/test/arops_classes.test.js
// ═══════════════════════════════════════════════════════════
const assert = require('assert');
const arops = require('../src/game/arops');
const shared = require('@craftworks/arops-shared');

// Same wrapper as arops_lifecycle.test.js / arops_modes.test.js — forces
// autoScale off so tests reason about known DEFAULTS/DEFAULT_HIT_CONFIG
// values with tiny explicit ms timings.
function createGame(sessionId, players, workshopConfig) {
  const wc = { ...workshopConfig, ar_settings: { autoScale: false, ...(workshopConfig.ar_settings || {}) } };
  return arops.createAropsGame(sessionId, players, wc);
}

const MUC = { lat: 48.13743, lon: 11.57549 };
const FIELD = [0, 90, 180, 270].map(b => shared.destinationPoint(MUC, b, 200));
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
function tel(gs, uid, pos, over = {}) {
  TS += 1100;
  return arops.actionArTelemetry(gs, uid, {
    sample: { lat: pos.lat, lon: pos.lon, ts: TS, accuracyM: 5, headingDeg: null, ...over },
  });
}
function shootAt(gs, uid, targetId, over = {}) {
  TS += 1100;
  return arops.actionArHitAttempt(gs, uid, {
    targetId,
    sample: { lat: MUC.lat, lon: MUC.lon, ts: TS, accuracyM: 5, headingDeg: 0, ...over },
  });
}
const FAST = {
  captureDwellMs: 300, flagPickupDwellMs: 300, flagReturnMs: 800,
  plantDwellMs: 300, defuseDwellMs: 300, bombTimerMs: 2000,
  freezeMs: 1000, freezeExtensionMs: 500, freezeMoveToleranceM: 15,
  baseSettingMs: 500, minBaseSeparationM: 50, zoneRadiusM: 15,
  revealTrapRadiusM: 20,
};
const Z1 = shared.destinationPoint(MUC, 90, 100);
const Z2 = shared.destinationPoint(MUC, 270, 100);

// ═══ SCOUT: wide cone ═══════════════════════════════════════
console.log('\n═══ Scout: wide cone ═══');
{
  const gs = createGame('scout1',
    [{ userId: 'S', username: 'S' }, { userId: 'H1', username: 'H1' }],
    { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek', classes: { S: 'scout' },
      roles: { S: 'seeker', H1: 'hider' }, hidingDurationMs: 0, gameDurationMs: 600_000, hitCooldownMs: 50 } });

  tick(gs, 10);
  const posH1 = shared.destinationPoint(MUC, 35, 30); // 35° off, 30m away
  tel(gs, 'S', MUC);
  tel(gs, 'H1', posH1);

  check('35° off-angle at 30m misses the default cone (baseline, no class)', () => {
    const gsBaseline = createGame('scout1b',
      [{ userId: 'S', username: 'S' }, { userId: 'H1', username: 'H1' }],
      { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek',
        roles: { S: 'seeker', H1: 'hider' }, hidingDurationMs: 0, gameDurationMs: 600_000, hitCooldownMs: 50 } });
    tick(gsBaseline, 10);
    tel(gsBaseline, 'S', MUC);
    tel(gsBaseline, 'H1', posH1);
    const r = shootAt(gsBaseline, 'S', undefined);
    assert.equal(r.hit, false, JSON.stringify(r));
  });

  check('same 35° off-angle at 30m hits for a Scout (widened cone)', () => {
    const r = shootAt(gs, 'S', undefined);
    assert.equal(r.hit, true, JSON.stringify(r));
  });
}

// ═══ SNIPER: 2x range, 2m lateral tolerance ═════════════════
console.log('\n═══ Sniper: range + lateral tolerance ═══');
{
  const gs = createGame('sniper1',
    [{ userId: 'S', username: 'S' }, { userId: 'H1', username: 'H1' }],
    { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek', classes: { S: 'sniper' },
      roles: { S: 'seeker', H1: 'hider' }, hidingDurationMs: 0, gameDurationMs: 600_000, hitCooldownMs: 50 } });

  check('hits beyond the default 75m range, within the doubled 150m Sniper range', () => {
    tick(gs, 10);
    const far = shared.destinationPoint(MUC, 0, 120); // beyond DEFAULT_HIT_CONFIG.maxRangeM (75), within 150
    tel(gs, 'S', MUC);
    tel(gs, 'H1', far);
    const r = shootAt(gs, 'S', undefined);
    assert.equal(r.hit, true, JSON.stringify(r));
  });

  check('misses beyond the doubled 150m range', () => {
    const gs2 = createGame('sniper2',
      [{ userId: 'S', username: 'S' }, { userId: 'H1', username: 'H1' }],
      { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek', classes: { S: 'sniper' },
        roles: { S: 'seeker', H1: 'hider' }, hidingDurationMs: 0, gameDurationMs: 600_000, hitCooldownMs: 50 } });
    tick(gs2, 10);
    const tooFar = shared.destinationPoint(MUC, 0, 400);
    tel(gs2, 'S', MUC);
    tel(gs2, 'H1', tooFar);
    const r = shootAt(gs2, 'S', undefined);
    assert.equal(r.hit, false, JSON.stringify(r));
  });
}

// ═══ BOMBER: 1/4 range, omnidirectional ═════════════════════
console.log('\n═══ Bomber: range + omnidirectional ═══');
{
  const gs = createGame('bomber1',
    [{ userId: 'S', username: 'S' }, { userId: 'H1', username: 'H1' }],
    { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek', classes: { S: 'bomber' },
      roles: { S: 'seeker', H1: 'hider' }, hidingDurationMs: 0, gameDurationMs: 600_000, hitCooldownMs: 50 } });

  check('hits a target directly BEHIND the shooter, within the quartered range', () => {
    tick(gs, 10);
    const behind = shared.destinationPoint(MUC, 180, 15); // south, shooter faces north (heading 0)
    tel(gs, 'S', MUC);
    tel(gs, 'H1', behind);
    const r = shootAt(gs, 'S', undefined);
    assert.equal(r.hit, true, JSON.stringify(r));
  });

  check('misses beyond the quartered range (default 75m / 4 ≈ 18.75m)', () => {
    const gs2 = createGame('bomber2',
      [{ userId: 'S', username: 'S' }, { userId: 'H1', username: 'H1' }],
      { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek', classes: { S: 'bomber' },
        roles: { S: 'seeker', H1: 'hider' }, hidingDurationMs: 0, gameDurationMs: 600_000, hitCooldownMs: 50 } });
    tick(gs2, 10);
    const tooFar = shared.destinationPoint(MUC, 90, 40); // well beyond ~18.75m
    tel(gs2, 'S', MUC);
    tel(gs2, 'H1', tooFar);
    const r = shootAt(gs2, 'S', undefined);
    assert.equal(r.hit, false, JSON.stringify(r));
  });
}

// ═══ CROSS-MODE PERK ACCESS (Sniper→fake_marker, Bomber→cloak) ══
console.log('\n═══ Cross-mode class perk access ═══');
{
  const gs = createGame('perks1',
    [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' },
     { userId: 'A2', username: 'A2' }, { userId: 'B2', username: 'B2' }],
    { ar_settings: { polygon: FIELD, subMode: 'domination', zones: [Z1, Z2],
      timings: FAST, targetScore: 10, gameDurationMs: 600_000,
      classes: { A1: 'sniper', B1: 'bomber' } } });
  tick(gs, 10);
  tel(gs, 'A1', MUC);

  check('Sniper can use fake_marker outside hide_and_seek (domination)', () => {
    const r = arops.actionArUsePerk(gs, 'A1', { perk: 'fake_marker' });
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  check('Bomber can use cloak outside hide_and_seek (domination)', () => {
    const r = arops.actionArUsePerk(gs, 'B1', { perk: 'cloak' });
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  check('a plain team_member (no class) still cannot use fake_marker/cloak in domination', () => {
    const r1 = arops.actionArUsePerk(gs, 'A2', { perk: 'fake_marker' });
    assert.equal(r1.ok, false);
    assert.equal(r1.err, 'wrong_mode');
    const r2 = arops.actionArUsePerk(gs, 'B2', { perk: 'cloak' });
    assert.equal(r2.ok, false);
    assert.equal(r2.err, 'wrong_mode');
  });

  check('drone stays hider-only/hide_and_seek-only — no class reuses it', () => {
    const r = arops.actionArUsePerk(gs, 'A1', { perk: 'drone' });
    assert.equal(r.ok, false);
    assert.equal(r.err, 'wrong_mode');
  });
}

console.log('\n═══ Hider role access to fake_marker/cloak in hide_and_seek is unchanged ═══');
{
  const gs = createGame('perks2',
    [{ userId: 'S', username: 'S' }, { userId: 'H1', username: 'H1' }],
    { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek',
      roles: { S: 'seeker', H1: 'hider' }, hidingDurationMs: 0, gameDurationMs: 600_000 } });
  tick(gs, 10);
  tel(gs, 'H1', MUC);

  check('Hider (no class) can still use fake_marker/cloak in hide_and_seek', () => {
    const r1 = arops.actionArUsePerk(gs, 'H1', { perk: 'fake_marker' });
    assert.equal(r1.ok, true, JSON.stringify(r1));
    const r2 = arops.actionArUsePerk(gs, 'H1', { perk: 'cloak' });
    assert.equal(r2.ok, true, JSON.stringify(r2));
  });

  check('Seeker still cannot use fake_marker/cloak (wrong role, no class override)', () => {
    const r = arops.actionArUsePerk(gs, 'S', { perk: 'fake_marker' });
    assert.equal(r.ok, false);
    assert.equal(r.err, 'perk_wrong_role');
  });
}

// ═══ REVEAL-TRAP (Scout) ═════════════════════════════════════
console.log('\n═══ Reveal-Trap lifecycle ═══');
{
  const gs = createGame('trap1',
    [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
    { ar_settings: { polygon: FIELD, subMode: 'domination', zones: [Z1, Z2],
      timings: FAST, targetScore: 10, gameDurationMs: 600_000,
      classes: { A1: 'scout' }, revealTrapCooldownMs: 500, revealTrapDurationMs: 5000, revealTrapRevealMs: 3000 } });
  tick(gs, 10);
  tel(gs, 'A1', MUC);

  check('non-Scout cannot place a reveal trap', () => {
    const r = arops.actionArUsePerk(gs, 'B1', { perk: 'reveal_trap' });
    assert.equal(r.ok, false);
    assert.equal(r.err, 'perk_wrong_role');
  });

  check('Scout places a trap successfully', () => {
    const r = arops.actionArUsePerk(gs, 'A1', { perk: 'reveal_trap' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(gs.players.A1.trap, 'trap should be armed');
  });

  check('placing again immediately is rejected by cooldown', () => {
    const r = arops.actionArUsePerk(gs, 'A1', { perk: 'reveal_trap' });
    assert.equal(r.ok, false);
    assert.equal(r.err, 'cooldown');
  });

  check('opponent entering the trap radius triggers it and reveals to the owner only', () => {
    tel(gs, 'B1', shared.destinationPoint(MUC, 0, 10)); // well within revealTrapRadiusM (20)
    tick(gs, 10);
    const snapOwner = arops.getAropsSnapshot(gs, 'A1');
    assert.ok(snapOwner.me.trapAlert, 'owner should see the trap alert');
    assert.equal(gs.players.A1.trap, null, 'trap should be consumed after triggering');

    const snapOther = arops.getAropsSnapshot(gs, 'B1');
    assert.equal(snapOther.me.trapAlert, null, 'the triggering player must not see the owner\'s trap alert');
  });
}

// ═══ REGRESSION: classless players behave exactly as before ═
console.log('\n═══ Regression: no ar_settings.classes → unchanged behavior ═══');
{
  const gs = createGame('regress1',
    [{ userId: 'S', username: 'S' }, { userId: 'H1', username: 'H1' }],
    { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek',
      roles: { S: 'seeker', H1: 'hider' }, hidingDurationMs: 0, gameDurationMs: 600_000, hitCooldownMs: 50 } });
  tick(gs, 10);

  check('players have class: null when no ar_settings.classes is given', () => {
    assert.equal(gs.players.S.class, null);
    assert.equal(gs.players.H1.class, null);
  });

  check('a classless seeker hits exactly like the pre-class baseline (dead-center at 50m)', () => {
    const posH1 = shared.destinationPoint(MUC, 0, 50);
    tel(gs, 'S', MUC);
    tel(gs, 'H1', posH1);
    const r = shootAt(gs, 'S', undefined);
    assert.equal(r.hit, true, JSON.stringify(r));
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
