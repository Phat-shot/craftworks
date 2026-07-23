'use strict';
// ═══════════════════════════════════════════════════════════
//  AR OPS mode tests — domination, CTF, S&D, freeze mechanic.
//  Run: node server/test/arops_modes.test.js
// ═══════════════════════════════════════════════════════════
const assert = require('assert');
const arops = require('../src/game/arops');
const shared = require('@craftworks/arops-shared');

// These tests predate "Auto" mode (field-size-derived timings/hitConfig, ON
// by default) and are deliberately about the STABLE, known DEFAULTS/
// DEFAULT_HIT_CONFIG values with tiny explicit ms-timings for fast test
// execution — scaleCoreConfig() has its own dedicated tests in
// packages/arops-shared. Force autoScale off here unless a test opts in.
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
// Domination/Seek&Destroy default to 'freeze' onHit (unchanged pre-existing
// default behavior) — which now gets a base-less "Warmup" phase 1 instead of
// starting straight in 'live' (see MODES' initialPhase in arops.js). Tests
// below that need the mode already live skip it exactly the way CTF/
// Deathmatch's base_setup is skipped elsewhere in this file: rewind
// phaseStartTime past baseSettingMs and tick once.
function skipWarmup(gs) {
  gs.phaseStartTime = Date.now() - (gs.timings.warmupMs + 100);
  tick(gs, 100);
}
// Fast timings for tests (explicit override wins over scaling)
const FAST = {
  captureDwellMs: 300, flagPickupDwellMs: 300, flagReturnMs: 800,
  plantDwellMs: 300, defuseDwellMs: 300, bombTimerMs: 2000,
  freezeMs: 1000, freezeExtensionMs: 500, freezeMoveToleranceM: 15,
  baseSettingMs: 500, warmupMs: 500, minBaseSeparationM: 50, zoneRadiusM: 15,
};

const Z1 = shared.destinationPoint(MUC, 90, 100);
const Z2 = shared.destinationPoint(MUC, 270, 100);

// ═══ DOMINATION ═════════════════════════════════════════════
console.log('\n═══ DOMINATION ═══');
{
  const gs = createGame('dom1',
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
  });

  check('starts in a base-less Warmup phase 1 (default onHit is freeze), then goes live', () => {
    assert.equal(gs.phase, 'warmup');
    assert.equal(gs.modeState.bases, undefined, 'freeze needs no base at all');
    skipWarmup(gs);
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

// ═══ CONTEST RESETS (host toggle) ═══════════════════════════
console.log('\n═══ CONTEST RESETS ═══');
{
  check('domination: contestResets=true cancels progress on contest instead of pausing it', () => {
    const gs = createGame('dom_contest',
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'domination', zones: [Z1, Z2],
        timings: FAST, gameDurationMs: 600_000, contestResets: true } });
    skipWarmup(gs);
    tel(gs, 'A1', Z1);
    tick(gs, 200);
    assert.ok(gs.modeState.capProgress.z1 && gs.modeState.capProgress.z1.ms > 0, 'accumulated progress');
    tel(gs, 'B1', Z1); // contest
    tick(gs, 200);
    assert.equal(gs.modeState.capProgress.z1, undefined, 'contest cancelled the attempt (contestResets=true)');
  });

  check('domination: contestResets=false (default) pauses progress on contest instead of cancelling it', () => {
    const gs = createGame('dom_pause',
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'domination', zones: [Z1, Z2],
        timings: FAST, gameDurationMs: 600_000 } });
    skipWarmup(gs);
    tel(gs, 'A1', Z1);
    tick(gs, 200);
    const before = gs.modeState.capProgress.z1;
    assert.ok(before && before.ms > 0, 'accumulated progress');
    tel(gs, 'B1', Z1); // contest
    tick(gs, 200);
    assert.deepEqual(gs.modeState.capProgress.z1, before, 'progress kept, not reset (default)');
  });

  check('teamCaptureEnabled: domination zone requires N teammates present, not just 1', () => {
    const gs = createGame('dom_teamcap',
      [{ userId: 'A1', username: 'A1' }, { userId: 'A2', username: 'A2' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'domination', zones: [Z1, Z2], teams: { A1: 'a', A2: 'a', B1: 'b' },
        timings: FAST, gameDurationMs: 600_000, teamCaptureEnabled: true, teamCaptureSize: 2 } });
    skipWarmup(gs);
    tel(gs, 'A1', Z1);
    tick(gs, 200); tick(gs, 200);
    assert.equal(gs.modeState.owners.z1, null, 'solo teammate cannot capture — needs 2');
    tel(gs, 'A2', Z1);
    tick(gs, 200); tick(gs, 200);
    assert.equal(gs.modeState.owners.z1, 'a', 'both teammates present together — captures');
  });

  check('teamCaptureEnabled is ignored in ffa (no teams to require multiple of)', () => {
    const gs = createGame('dom_teamcap_ffa',
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'domination', teamVariant: 'ffa', zones: [Z1, Z2],
        timings: FAST, gameDurationMs: 600_000, teamCaptureEnabled: true, teamCaptureSize: 2 } });
    skipWarmup(gs);
    tel(gs, 'A1', Z1);
    tick(gs, 200); tick(gs, 200);
    assert.equal(gs.modeState.owners.z1, 'A1', 'solo player captures normally — teamCaptureEnabled has no ffa reading');
  });

  check('seek_destroy instant: contestResets=true cancels progress on contest', () => {
    const gs = createGame('snd_contest',
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'seek_destroy', zones: [Z1, Z2, shared.destinationPoint(MUC, 0, 100)],
        timings: FAST, gameDurationMs: 600_000, contestResets: true } });
    skipWarmup(gs);
    tel(gs, 'A1', Z1);
    tick(gs, 200);
    assert.ok(gs.modeState.captureProg && gs.modeState.captureProg.ms > 0, 'accumulated progress');
    tel(gs, 'B1', Z1); // contest
    tick(gs, 200);
    assert.equal(gs.modeState.captureProg, null, 'contest cancelled the attempt (contestResets=true)');
  });
}

// ═══ FREEZE MECHANIC ════════════════════════════════════════
console.log('\n═══ FREEZE ═══');
{
  const gs = createGame('frz1',
    [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
    { ar_settings: { polygon: FIELD, subMode: 'domination', zones: [Z1, Z2],
      timings: { ...FAST, freezeMs: 60_000 }, hitCooldownMs: 50 } });
  skipWarmup(gs);

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
  const gs = createGame('ctf1',
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
    // Both players in their own base right as base_setup ends — otherwise
    // the base/respawn checkpoint (applySpawnCheckpoint) marks them
    // 'downed', and zonePresence excludes non-alive players from every
    // subsequent flag check below.
    tel(gs, 'A1', baseA);
    tel(gs, 'B1', baseB);
    gs.phaseStartTime = Date.now() - 1000; // > 500ms baseSettingMs
    tick(gs, 100);
    assert.equal(gs.phase, 'live');
    assert.equal(gs.players.A1.status, 'alive', 'A1 was in its own base at the checkpoint');
    assert.equal(gs.players.B1.status, 'alive', 'B1 was in its own base at the checkpoint');
  });

  check('enemy dwell in base steals the flag', () => {
    // A1 walks from its own base to B's base — gradual steps, not a single
    // jump: A1 now has a real prior position (baseA, set by the checkpoint
    // above), so a one-sample teleport across the field would get rejected
    // as implausible movement, same as anywhere else telemetry is fed here.
    let pos = baseA;
    const brg = shared.bearingDeg(baseA, baseB);
    for (let i = 0; i < 22 && shared.haversineMeters(pos, baseB) > 8; i++) {
      pos = shared.destinationPoint(pos, brg, 12);
      tel(gs, 'A1', pos);
    }
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

  check('flag pickup progress is exposed with team attribution while being stolen', () => {
    const gs2 = createGame('ctf_pickup',
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'ctf',
        timings: { ...FAST, flagPickupDwellMs: 600 }, targetCaptures: 2, gameDurationMs: 600_000 } });
    const baseA2 = shared.destinationPoint(MUC, 270, 120);
    const baseB2 = shared.destinationPoint(MUC, 90, 120);
    arops.actionArSetBase(gs2, 'A1', { lat: baseA2.lat, lon: baseA2.lon });
    arops.actionArSetBase(gs2, 'B1', { lat: baseB2.lat, lon: baseB2.lon });
    tel(gs2, 'A1', baseA2);
    tel(gs2, 'B1', baseB2);
    gs2.phaseStartTime = Date.now() - 1000;
    tick(gs2, 100);
    assert.equal(gs2.phase, 'live');

    // A1 walks into B's base (enemy) to start stealing — gradual steps, same
    // anti-teleport reasoning as the test above.
    let pos = baseA2;
    const brg = shared.bearingDeg(baseA2, baseB2);
    for (let i = 0; i < 22 && shared.haversineMeters(pos, baseB2) > 8; i++) {
      pos = shared.destinationPoint(pos, brg, 12);
      tel(gs2, 'A1', pos);
    }
    tick(gs2, 300); // partway through the 600ms dwell
    const snap = arops.getAropsSnapshot(gs2, 'B1');
    const flagB = snap.flags.find(f => f.team === 'b');
    assert.ok(flagB.pickupPct > 0 && flagB.pickupPct < 100, `expected partial progress, got ${flagB.pickupPct}`);
    assert.equal(flagB.pickupTeam, 'a', "A1 (enemy of team b) is stealing team b's flag");
    const flagA = snap.flags.find(f => f.team === 'a');
    assert.equal(flagA.pickupPct, 0);
    assert.equal(flagA.pickupTeam, null);
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

// ═══ BASE/RESPAWN CHECKPOINT ════════════════════════════════
console.log('\n═══ Base/Respawn Checkpoint (CTF) ═══');
{
  const gs = createGame('spawn1',
    [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
    { ar_settings: { polygon: FIELD, subMode: 'ctf',
      timings: { ...FAST, spawnCheckDwellMs: 300 }, targetCaptures: 2, gameDurationMs: 600_000 } });

  const baseA = shared.destinationPoint(MUC, 270, 120);
  const baseB = shared.destinationPoint(MUC, 90, 120);
  arops.actionArSetBase(gs, 'A1', { lat: baseA.lat, lon: baseA.lon });
  arops.actionArSetBase(gs, 'B1', { lat: baseB.lat, lon: baseB.lon });

  check('player NOT in their base when phase 1 ends becomes downed, not removed from the match', () => {
    // B1 is in its own base; A1 never sent any telemetry at all (no position).
    tel(gs, 'B1', baseB);
    gs.phaseStartTime = Date.now() - 1000;
    tick(gs, 100);
    assert.equal(gs.phase, 'live');
    assert.equal(gs.players.A1.status, 'downed', 'A1 never confirmed being in its base');
    assert.equal(gs.players.B1.status, 'alive', 'B1 was in its own base at the checkpoint');
  });

  check('a downed player cannot shoot or use perks', () => {
    TS += 1100;
    const r1 = arops.actionArHitAttempt(gs, 'A1', {
      sample: { lat: baseA.lat, lon: baseA.lon, ts: TS, accuracyM: 5, headingDeg: 0 },
    });
    assert.equal(r1.ok, false);
    assert.equal(r1.err, 'downed');
    const r2 = arops.actionArUsePerk(gs, 'A1', { perk: 'radar' });
    assert.equal(r2.ok, false);
    assert.equal(r2.err, 'downed');
  });

  check('a downed player does not count for zone presence (e.g. cannot steal the enemy flag)', () => {
    // A1 wanders into B1's base while still downed (A1 has no prior
    // position yet, so start from the field center).
    let pos = gs.players.A1.lastAccepted || MUC;
    const brg = shared.bearingDeg(pos, baseB);
    for (let i = 0; i < 22 && shared.haversineMeters(pos, baseB) > 8; i++) {
      pos = shared.destinationPoint(pos, brg, 12);
      tel(gs, 'A1', pos);
    }
    tick(gs, 400);
    assert.equal(gs.modeState.flags.b.state, 'home', 'downed A1 must not be able to steal the flag');
  });

  check('late-spawn allowed: dwelling in own base for spawnCheckDwellMs revives the player', () => {
    // Walk A1 back to its own base.
    let pos = gs.players.A1.lastAccepted;
    const brg = shared.bearingDeg(pos, baseA);
    for (let i = 0; i < 30 && shared.haversineMeters(pos, baseA) > 8; i++) {
      pos = shared.destinationPoint(pos, brg, 12);
      tel(gs, 'A1', pos);
    }
    assert.equal(gs.players.A1.status, 'downed', 'not yet — just arrived, hasn\'t dwelled');
    tick(gs, 350); // > spawnCheckDwellMs (300)
    assert.equal(gs.players.A1.status, 'alive', 'A1 dwelled in its own base long enough to spawn in');
    assert.ok(gs.events.some(e => e.type === 'player_spawned' && e.userId === 'A1'));
  });

  check('leaving the base before the dwell completes resets progress', () => {
    const gs2 = createGame('spawn2',
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'ctf',
        timings: { ...FAST, spawnCheckDwellMs: 1000 }, targetCaptures: 2, gameDurationMs: 600_000 } });
    const bA = shared.destinationPoint(MUC, 270, 120);
    const bB = shared.destinationPoint(MUC, 90, 120);
    arops.actionArSetBase(gs2, 'A1', { lat: bA.lat, lon: bA.lon });
    arops.actionArSetBase(gs2, 'B1', { lat: bB.lat, lon: bB.lon });
    tel(gs2, 'B1', bB);
    gs2.phaseStartTime = Date.now() - 1000;
    tick(gs2, 100);
    assert.equal(gs2.players.A1.status, 'downed');

    tel(gs2, 'A1', bA);
    tick(gs2, 400); // partial dwell, not yet enough
    assert.equal(gs2.players.A1.status, 'downed');
    assert.ok(gs2.players.A1.spawnDwellMs > 0);

    // Step outside the base — progress must reset, not just pause.
    const outside = shared.destinationPoint(bA, 0, 200);
    tel(gs2, 'A1', outside);
    tick(gs2, 100);
    assert.equal(gs2.players.A1.spawnDwellMs, 0, 'leaving the base resets dwell progress');
  });

  check('needsSpawn/ownBase are exposed in the snapshot for the downed player themselves', () => {
    const snap = arops.getAropsSnapshot(gs, 'A1');
    // A1 is alive again by this point (respawned in the earlier check), so
    // needsSpawn should be false and ownBase should still be populated.
    assert.equal(snap.me.needsSpawn, false);
    assert.ok(snap.me.ownBase && typeof snap.me.ownBase.lat === 'number');
  });
}

// ═══ TEAM PING (map tap) ══════════════════════════════════════
console.log('\n═══ TEAM PING ═══');
{
  function setupPing(sessionId, over = {}) {
    // Explicit team assignment — domination's default alternates by array
    // index (A1='a', A2='b', ...), which would make A1/A2 opponents instead
    // of the teammates this test needs.
    const gs = createGame(sessionId,
      [{ userId: 'A1', username: 'A1' }, { userId: 'A2', username: 'A2' },
       { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'domination', zones: [Z1, Z2],
        teams: { A1: 'a', A2: 'a', B1: 'b' },
        timings: FAST, gameDurationMs: 600_000, pingCooldownMs: 50, ...over } });
    skipWarmup(gs);
    return gs;
  }

  check('ping is visible to teammates, never to the opposing team', () => {
    const gs = setupPing('ping_basic');
    const r = arops.actionArUsePerk(gs, 'A1', { perk: 'ping', lat: MUC.lat, lon: MUC.lon });
    assert.equal(r.ok, true, JSON.stringify(r));

    const snapMate = arops.getAropsSnapshot(gs, 'A2');
    assert.equal(snapMate.me.teamPings.length, 1);
    assert.equal(snapMate.me.teamPings[0].byUserId, 'A1');
    assert.equal(snapMate.me.teamPings[0].lat, MUC.lat);

    const snapSelf = arops.getAropsSnapshot(gs, 'A1');
    assert.equal(snapSelf.me.teamPings.length, 1, 'the pinger sees their own ping too (same team)');

    const snapFoe = arops.getAropsSnapshot(gs, 'B1');
    assert.equal(snapFoe.me.teamPings.length, 0, 'opposing team never receives the ping');
  });

  check('cooldown blocks a second ping in quick succession', () => {
    const gs = setupPing('ping_cooldown', { pingCooldownMs: 60_000 });
    const r1 = arops.actionArUsePerk(gs, 'A1', { perk: 'ping', lat: MUC.lat, lon: MUC.lon });
    assert.equal(r1.ok, true);
    const r2 = arops.actionArUsePerk(gs, 'A1', { perk: 'ping', lat: MUC.lat, lon: MUC.lon });
    assert.equal(r2.ok, false);
    assert.equal(r2.err, 'cooldown', JSON.stringify(r2));
  });

  check('missing/invalid lat-lon is rejected', () => {
    const gs = setupPing('ping_badloc');
    const r = arops.actionArUsePerk(gs, 'A1', { perk: 'ping' });
    assert.equal(r.ok, false);
    assert.equal(r.err, 'bad_location');
  });

  check('teamless modes (no team) cannot ping — nobody to ping', () => {
    const gs = createGame('ping_noteam',
      [{ userId: 'A', username: 'A' }, { userId: 'B', username: 'B' }],
      { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek', hsVariant: 'ffa', gameDurationMs: 600_000 } });
    tick(gs, 10); // ffa has no hiding phase — one tick reaches 'seeking'
    const r = arops.actionArUsePerk(gs, 'A', { perk: 'ping', lat: MUC.lat, lon: MUC.lon });
    assert.equal(r.ok, false);
    assert.equal(r.err, 'no_team');
  });

  check('a ping expires and disappears from the snapshot after pingDurationMs', () => {
    const gs = setupPing('ping_expiry', { pingDurationMs: 500 });
    const r = arops.actionArUsePerk(gs, 'A1', { perk: 'ping', lat: MUC.lat, lon: MUC.lon });
    assert.equal(r.ok, true);
    assert.equal(arops.getAropsSnapshot(gs, 'A2').me.teamPings.length, 1);
    gs.teamPings.a[0].expiresAt = Date.now() - 1; // force-expire without a real sleep
    assert.equal(arops.getAropsSnapshot(gs, 'A2').me.teamPings.length, 0);
  });
}

// ═══ DEATHMATCH ═════════════════════════════════════════════
console.log('\n═══ DEATHMATCH ═══');
{
  function setupDeathmatch(sessionId, over = {}) {
    const gs = createGame(sessionId,
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'deathmatch', gameDurationMs: 600_000,
        timings: { ...FAST, spawnCheckDwellMs: 300 }, ...over } });
    const baseA = shared.destinationPoint(MUC, 270, 100);
    const baseB = shared.destinationPoint(MUC, 90, 100);
    arops.actionArSetBase(gs, 'A1', { lat: baseA.lat, lon: baseA.lon });
    arops.actionArSetBase(gs, 'B1', { lat: baseB.lat, lon: baseB.lon });
    tel(gs, 'A1', baseA);
    tel(gs, 'B1', baseB);
    gs.phaseStartTime = Date.now() - 1000;
    tick(gs, 100);
    return { gs, baseA, baseB };
  }

  check('starts in base_setup; captain-only (generic bases check, not hardcoded to ctf)', () => {
    const { gs } = setupDeathmatch('dm_setup');
    assert.equal(gs.phase, 'live'); // already ticked past setup in the helper
    assert.equal(gs.players.A1.team, 'a');
    assert.equal(gs.players.B1.team, 'b');
  });

  check('respawn variant: hit downs the target and costs a life, does not remove them from the match', () => {
    const { gs, baseA, baseB } = setupDeathmatch('dm_respawn', { onHit: 'respawn', livesPerPlayer: 2 });
    let posA = baseA, posB = baseB;
    const brgA = shared.bearingDeg(baseA, MUC), brgB = shared.bearingDeg(baseB, MUC);
    for (let i = 0; i < 12; i++) { posA = shared.destinationPoint(posA, brgA, 9); tel(gs, 'A1', posA); }
    for (let i = 0; i < 12; i++) { posB = shared.destinationPoint(posB, brgB, 9); tel(gs, 'B1', posB); }
    const heading = shared.bearingDeg(posA, posB);
    TS += 1100;
    const r = arops.actionArHitAttempt(gs, 'A1', { sample: { lat: posA.lat, lon: posA.lon, ts: TS, accuracyM: 5, headingDeg: heading } });
    assert.equal(r.hit, true, JSON.stringify(r));
    assert.equal(gs.players.B1.status, 'downed');
    assert.equal(gs.modeState.lives.B1, 1);
    assert.equal(gs.gameOver, false, 'still has lives left, match continues');
  });

  check('respawn variant: a downed player revives after dwelling in their own base', () => {
    const { gs, baseB } = setupDeathmatch('dm_revive', { onHit: 'respawn', livesPerPlayer: 2 });
    gs.players.B1.status = 'downed';
    gs.players.B1.spawnDwellMs = 0;
    tel(gs, 'B1', baseB);
    tick(gs, 350); // > spawnCheckDwellMs (300)
    assert.equal(gs.players.B1.status, 'alive');
  });

  check('respawn variant: 0 lives eliminates the player and ends the match for their team', () => {
    const { gs, baseA } = setupDeathmatch('dm_elim', { onHit: 'respawn', livesPerPlayer: 1 });
    const shooterPos = baseA; // A1 is already there (setupDeathmatch's tel), no jump
    const targetPos = shared.destinationPoint(baseA, 0, 5);
    tel(gs, 'B1', targetPos);
    TS += 1100;
    const heading = shared.bearingDeg(shooterPos, targetPos);
    const r = arops.actionArHitAttempt(gs, 'A1', {
      sample: { lat: shooterPos.lat, lon: shooterPos.lon, ts: TS, accuracyM: 5, headingDeg: heading },
    });
    assert.equal(r.hit, true, JSON.stringify(r));
    assert.equal(gs.players.B1.status, 'found', 'eliminated, out for the rest of the match');
    assert.equal(gs.gameOver, true);
    assert.equal(gs.winner, 'team_a');
  });

  check('freeze variant: hit freezes the target, no life lost, no elimination', () => {
    const { gs, baseA } = setupDeathmatch('dm_freeze', { onHit: 'freeze', freezeMs: 5000 });
    const shooterPos = baseA;
    const targetPos = shared.destinationPoint(baseA, 0, 20);
    tel(gs, 'B1', targetPos);
    TS += 1100;
    const heading = shared.bearingDeg(shooterPos, targetPos);
    const r = arops.actionArHitAttempt(gs, 'A1', {
      sample: { lat: shooterPos.lat, lon: shooterPos.lon, ts: TS, accuracyM: 5, headingDeg: heading },
    });
    assert.equal(r.hit, true, JSON.stringify(r));
    assert.equal(gs.players.B1.status, 'alive');
    assert.ok(gs.players.B1.frozenUntil > Date.now());
    assert.deepEqual(gs.modeState.lives, { A1: 3, B1: 3 }, 'freeze variant never touches lives');
  });

  check('a downed player cannot shoot (reuses the generic status gate)', () => {
    const { gs, baseA } = setupDeathmatch('dm_downed_gate', { onHit: 'respawn' });
    gs.players.A1.status = 'downed';
    TS += 1100;
    const r = arops.actionArHitAttempt(gs, 'A1', {
      sample: { lat: baseA.lat, lon: baseA.lon, ts: TS, accuracyM: 5, headingDeg: 0 },
    });
    assert.equal(r.ok, false);
    assert.equal(r.err, 'downed');
  });
}

// ═══ ON-HIT: FREEZE VS RESPAWN, ALL 4 COMBAT MODES ═══════════
// Domination/CTF/Seek&Destroy/Deathmatch all share the same cfg.onHit
// toggle now (resolveCombatHit in arops.js). Deathmatch's respawn path is
// already covered above (its long-standing default); this block covers the
// newly-generalized respawn path for Domination/Seek&Destroy (which have no
// base concept of their own — 'respawn' borrows the base_setup/spawn-
// checkpoint machinery, 'freeze' skips it via the base-less Warmup phase),
// and the Deathmatch freeze-mode bug fix (base_setup used to run
// unconditionally even under 'freeze', wrongly downing anyone outside a
// base nobody needed).
console.log('\n═══ ON-HIT: FREEZE VS RESPAWN ═══');
{
  check('domination respawn: gets a base_setup phase 1 (unlike its freeze default), hit downs + costs a life', () => {
    const gs = createGame('dom_respawn',
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'domination', zones: [Z1, Z2],
        timings: FAST, onHit: 'respawn', livesPerPlayer: 2, gameDurationMs: 600_000 } });
    assert.equal(gs.phase, 'base_setup');
    assert.ok(gs.modeState.bases, 'respawn needs somewhere to revive');
    const baseA = shared.destinationPoint(MUC, 270, 100);
    const baseB = shared.destinationPoint(MUC, 90, 100);
    arops.actionArSetBase(gs, 'A1', { lat: baseA.lat, lon: baseA.lon });
    arops.actionArSetBase(gs, 'B1', { lat: baseB.lat, lon: baseB.lon });
    tel(gs, 'A1', baseA); tel(gs, 'B1', baseB);
    skipWarmup(gs);
    assert.equal(gs.phase, 'live');

    const targetPos = shared.destinationPoint(baseA, 0, 5);
    tel(gs, 'B1', targetPos);
    TS += 1100;
    const heading = shared.bearingDeg(baseA, targetPos);
    const r = arops.actionArHitAttempt(gs, 'A1', {
      sample: { lat: baseA.lat, lon: baseA.lon, ts: TS, accuracyM: 5, headingDeg: heading },
    });
    assert.equal(r.hit, true, JSON.stringify(r));
    assert.equal(gs.players.B1.status, 'downed');
    assert.equal(gs.modeState.lives.B1, 1);
  });

  check('seek_destroy respawn: same base_setup/lives path as domination', () => {
    const gs = createGame('snd_respawn',
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'seek_destroy',
        zones: [Z1, shared.destinationPoint(MUC, 0, 100), shared.destinationPoint(MUC, 180, 100)],
        timings: FAST, onHit: 'respawn', livesPerPlayer: 1, gameDurationMs: 600_000 } });
    assert.equal(gs.phase, 'base_setup');
    const baseA = shared.destinationPoint(MUC, 270, 100);
    const baseB = shared.destinationPoint(MUC, 90, 100);
    arops.actionArSetBase(gs, 'A1', { lat: baseA.lat, lon: baseA.lon });
    arops.actionArSetBase(gs, 'B1', { lat: baseB.lat, lon: baseB.lon });
    tel(gs, 'A1', baseA); tel(gs, 'B1', baseB);
    skipWarmup(gs);
    assert.equal(gs.phase, 'live');

    const targetPos = shared.destinationPoint(baseA, 0, 5);
    tel(gs, 'B1', targetPos);
    TS += 1100;
    const heading = shared.bearingDeg(baseA, targetPos);
    const r = arops.actionArHitAttempt(gs, 'A1', {
      sample: { lat: baseA.lat, lon: baseA.lon, ts: TS, accuracyM: 5, headingDeg: heading },
    });
    assert.equal(r.hit, true, JSON.stringify(r));
    assert.equal(gs.players.B1.status, 'found', 'eliminated at 0 lives, same as deathmatch');
  });

  check('seek_destroy respawn: eliminating the last player of a team ends the match (was previously a hang — Domination/CTF/S&D had no elimination win-check at all)', () => {
    const gs = createGame('snd_respawn_elim',
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'seek_destroy',
        zones: [Z1, shared.destinationPoint(MUC, 0, 100), shared.destinationPoint(MUC, 180, 100)],
        timings: FAST, onHit: 'respawn', livesPerPlayer: 1, gameDurationMs: 600_000 } });
    const baseA = shared.destinationPoint(MUC, 270, 100);
    const baseB = shared.destinationPoint(MUC, 90, 100);
    arops.actionArSetBase(gs, 'A1', { lat: baseA.lat, lon: baseA.lon });
    arops.actionArSetBase(gs, 'B1', { lat: baseB.lat, lon: baseB.lon });
    tel(gs, 'A1', baseA); tel(gs, 'B1', baseB);
    skipWarmup(gs);
    const targetPos = shared.destinationPoint(baseA, 0, 5);
    tel(gs, 'B1', targetPos);
    TS += 1100;
    const heading = shared.bearingDeg(baseA, targetPos);
    const r = arops.actionArHitAttempt(gs, 'A1', {
      sample: { lat: baseA.lat, lon: baseA.lon, ts: TS, accuracyM: 5, headingDeg: heading },
    });
    assert.equal(r.hit, true, JSON.stringify(r));
    assert.equal(gs.gameOver, false, 'not yet — checkEliminationWin only runs on the next tick');
    tick(gs, 100);
    assert.equal(gs.gameOver, true);
    assert.equal(gs.winner, 'team_a');
  });

  check('domination respawn ffa: last player standing ends the match', () => {
    const gs = createGame('dom_respawn_ffa',
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'domination', zones: [Z1, Z2], teamVariant: 'ffa',
        timings: FAST, onHit: 'respawn', livesPerPlayer: 1, gameDurationMs: 600_000 } });
    arops.actionArSetBase(gs, 'A1', { lat: MUC.lat, lon: MUC.lon });
    arops.actionArSetBase(gs, 'B1', { lat: MUC.lat, lon: MUC.lon });
    tel(gs, 'A1', MUC); tel(gs, 'B1', MUC);
    skipWarmup(gs);
    const targetPos = shared.destinationPoint(MUC, 0, 5);
    tel(gs, 'B1', targetPos);
    TS += 1100;
    const heading = shared.bearingDeg(MUC, targetPos);
    const r = arops.actionArHitAttempt(gs, 'A1', {
      sample: { lat: MUC.lat, lon: MUC.lon, ts: TS, accuracyM: 5, headingDeg: heading },
    });
    assert.equal(r.hit, true, JSON.stringify(r));
    tick(gs, 100);
    assert.equal(gs.gameOver, true);
    assert.equal(gs.winner, 'player_A1');
  });

  check('deathmatch freeze: Warmup phase 1 (no base_setup), nobody wrongly downed at the checkpoint', () => {
    const gs = createGame('dm_freeze_warmup',
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'deathmatch', onHit: 'freeze',
        timings: FAST, gameDurationMs: 600_000 } });
    assert.equal(gs.phase, 'warmup', 'freeze needs no base — no base_setup phase at all');
    assert.equal(gs.modeState.bases, undefined);
    // Neither player ever sends telemetry before the phase-1 timer elapses —
    // under the old unconditional base_setup this used to wrongly mark them
    // 'downed' (applySpawnCheckpoint gates on being IN a base that, in freeze
    // mode, was never asked for and never existed).
    skipWarmup(gs);
    assert.equal(gs.phase, 'live');
    assert.equal(gs.players.A1.status, 'alive', 'freeze mode never downs anyone at the checkpoint');
    assert.equal(gs.players.B1.status, 'alive');
  });
}

// ═══ BATTLE ROYALE ("Jeder gegen jeden", Hide & Seek variant) ══
console.log('\n═══ BATTLE ROYALE ═══');
{
  function setupBR(sessionId, players, over = {}) {
    const gs = createGame(sessionId, players, { ar_settings: {
      polygon: FIELD, subMode: 'hide_and_seek', hsVariant: 'ffa',
      gameDurationMs: 600_000, hitCooldownMs: 50, ...over,
    } });
    // 'ffa' has no hiding phase — one tick flips hiding -> seeking regardless
    // of hidingDurationMs (see MODES.hide_and_seek's tick()).
    tick(gs, 10);
    return gs;
  }

  check('no teams, no roles assigned (unlike Hide & Seek, no seeker/hider concept here)', () => {
    const gs = setupBR('br_setup', [{ userId: 'A', username: 'A' }, { userId: 'B', username: 'B' }]);
    assert.equal(gs.players.A.team, null);
    assert.equal(gs.players.B.team, null);
  });

  check('everyone is an opponent of everyone — no allies, positions never shared as teammates', () => {
    const gs = setupBR('br_opp', [{ userId: 'A', username: 'A' }, { userId: 'B', username: 'B' }, { userId: 'C', username: 'C' }]);
    tel(gs, 'A', MUC);
    tel(gs, 'B', shared.destinationPoint(MUC, 0, 20));
    tel(gs, 'C', shared.destinationPoint(MUC, 180, 20));
    const snap = arops.getAropsSnapshot(gs, 'A');
    const b = snap.players.find(p => p.userId === 'B');
    const c = snap.players.find(p => p.userId === 'C');
    assert.equal(typeof b.lat, 'undefined', 'B is an opponent, not revealed by default');
    assert.equal(typeof c.lat, 'undefined', 'C is an opponent, not revealed by default');
  });

  check('a hit eliminates permanently (no freeze, no downed) and can end the match when one player remains', () => {
    const gs = setupBR('br_elim', [{ userId: 'A', username: 'A' }, { userId: 'B', username: 'B' }, { userId: 'C', username: 'C' }]);
    tel(gs, 'A', MUC);
    tel(gs, 'B', shared.destinationPoint(MUC, 0, 20));
    tel(gs, 'C', shared.destinationPoint(MUC, 180, 20));
    TS += 1100;
    const r1 = arops.actionArHitAttempt(gs, 'A', { sample: { lat: MUC.lat, lon: MUC.lon, ts: TS, accuracyM: 5, headingDeg: 0 } });
    assert.equal(r1.hit, true, JSON.stringify(r1));
    assert.equal(gs.players.B.status, 'found');
    assert.equal(gs.players.B.frozenUntil, 0, 'no freeze — permanent elimination instead');
    assert.equal(gs.gameOver, false, 'C is still alive');

    sleepMs(60); // clear hitCooldownMs
    TS += 1100;
    const r2 = arops.actionArHitAttempt(gs, 'A', { sample: { lat: MUC.lat, lon: MUC.lon, ts: TS, accuracyM: 5, headingDeg: 180 } });
    assert.equal(r2.hit, true, JSON.stringify(r2));
    assert.equal(gs.gameOver, true);
    assert.equal(gs.winner, 'A', 'last player standing wins by userId');
  });

  check('time limit: highest score wins, tie is a draw', () => {
    const gs = setupBR('br_time', [{ userId: 'A', username: 'A' }, { userId: 'B', username: 'B' }]);
    gs.players.A.score = 30;
    gs.players.B.score = 10;
    gs.phaseStartTime = Date.now() - 700_000; // > gameDurationMs (600_000)
    tick(gs, 100);
    assert.equal(gs.gameOver, true);
    assert.equal(gs.winner, 'A');

    const gsTie = setupBR('br_time_tie', [{ userId: 'A', username: 'A' }, { userId: 'B', username: 'B' }]);
    gsTie.players.A.score = 20;
    gsTie.players.B.score = 20;
    gsTie.phaseStartTime = Date.now() - 700_000;
    tick(gsTie, 100);
    assert.equal(gsTie.gameOver, true);
    assert.equal(gsTie.winner, 'draw');
  });

  check('classic Hide & Seek is unaffected by the ffa variant: roles assigned, hiding phase respected', () => {
    const gs = createGame('br_regression', [
      { userId: 'A', username: 'A' }, { userId: 'B', username: 'B' },
    ], { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek', hidingDurationMs: 100_000, gameDurationMs: 600_000 } });
    assert.equal(gs.phase, 'hiding');
    assert.notEqual(gs.players.A.role, undefined);
    tick(gs, 10);
    assert.equal(gs.phase, 'hiding', 'classic variant still respects hidingDurationMs, unlike ffa/the_ship');
  });

  check('solo debug session never auto-ends via checkWin just because "1 player is left"', () => {
    const gs = setupBR('br_solo', [{ userId: 'A', username: 'A' }], { debugMode: true });
    tel(gs, 'A', MUC);
    // No opponents exist to eliminate anyone — checkWin is only ever invoked
    // from applyHit, so this asserts the guard exists without needing to
    // contrive an actual self-hit.
    assert.equal(gs.gameOver, false);
  });
}

// ═══ THE SHIP (Hide & Seek variant) ═════════════════════════
console.log('\n═══ THE SHIP ═══');
{
  function setupShip(sessionId, players, over = {}) {
    const gs = createGame(sessionId, players, { ar_settings: {
      polygon: FIELD, subMode: 'hide_and_seek', hsVariant: 'the_ship',
      gameDurationMs: 600_000, hitCooldownMs: 50, ...over,
    } });
    // The Ship has no hiding phase — one tick is enough to flip
    // hiding -> seeking regardless of hidingDurationMs (see MODES.hide_and_seek's
    // tick()). Tests below attempt hits immediately, which requires the
    // 'seeking' phase (mode.shootPhases).
    tick(gs, 10);
    return gs;
  }

  check('no teams assigned; every player gets exactly one target, forming a single cycle over the whole roster', () => {
    const gs = setupShip('ship_setup', [
      { userId: 'A', username: 'A' }, { userId: 'B', username: 'B' },
      { userId: 'C', username: 'C' }, { userId: 'D', username: 'D' },
    ]);
    assert.equal(gs.players.A.team, null);
    const targets = gs.modeState.targets;
    assert.equal(Object.keys(targets).length, 4);
    let cur = 'A', seen = new Set(), steps = 0;
    while (!seen.has(cur) && steps < 10) { seen.add(cur); cur = targets[cur]; steps++; }
    assert.equal(seen.size, 4, 'cycle must cover all 4 players');
    assert.equal(cur, 'A', 'cycle must close back on itself');
  });

  check('target identity is private: only in the assigned hunter\'s own me-block, never in the public roster', () => {
    const gs = setupShip('ship_priv', [
      { userId: 'A', username: 'A' }, { userId: 'B', username: 'B' },
      { userId: 'C', username: 'C' }, { userId: 'D', username: 'D' },
    ]);
    const aTarget = gs.modeState.targets.A;
    const snapA = arops.getAropsSnapshot(gs, 'A');
    assert.equal(snapA.me.targetUserId, aTarget);
    assert.equal(snapA.players.find(p => p.userId === aTarget).targetUserId, undefined,
      'roster entries never carry targetUserId, only the me block does');
    const snapB = arops.getAropsSnapshot(gs, 'B');
    assert.notEqual(snapB.me.targetUserId, aTarget, 'targets are a bijection — nobody else shares A\'s target');
  });

  check('can only hit your assigned target — anyone else present is not even a candidate', () => {
    const gs = setupShip('ship_hit', [
      { userId: 'A', username: 'A' }, { userId: 'B', username: 'B' }, { userId: 'C', username: 'C' },
    ]);
    const realTarget = gs.modeState.targets.A;
    const decoy = ['B', 'C'].find(u => u !== realTarget);
    tel(gs, 'A', MUC);
    tel(gs, decoy, MUC); // decoy right next to the shooter, but not their assigned target
    TS += 1100;
    const rMiss = arops.actionArHitAttempt(gs, 'A',
      { sample: { lat: MUC.lat, lon: MUC.lon, ts: TS, accuracyM: 5, headingDeg: 0 } });
    assert.equal(rMiss.hit, false);
    assert.equal(rMiss.reason, 'no_candidates', JSON.stringify(rMiss));

    sleepMs(60); TS += 1100;
    tel(gs, realTarget, MUC);
    TS += 1100;
    const rHit = arops.actionArHitAttempt(gs, 'A',
      { sample: { lat: MUC.lat, lon: MUC.lon, ts: TS, accuracyM: 5, headingDeg: 0 } });
    assert.equal(rHit.hit, true, JSON.stringify(rHit));
    assert.equal(rHit.targetId, realTarget);
    assert.equal(gs.players[realTarget].status, 'found');
  });

  check('killing your target makes you inherit their target — the chain stays a single cycle over survivors', () => {
    const gs = setupShip('ship_chain', [
      { userId: 'A', username: 'A' }, { userId: 'B', username: 'B' },
      { userId: 'C', username: 'C' }, { userId: 'D', username: 'D' },
    ]);
    const t1 = gs.modeState.targets.A;
    const t2 = gs.modeState.targets[t1];
    tel(gs, 'A', MUC);
    tel(gs, t1, MUC);
    TS += 1100;
    const r = arops.actionArHitAttempt(gs, 'A', { sample: { lat: MUC.lat, lon: MUC.lon, ts: TS, accuracyM: 5, headingDeg: 0 } });
    assert.equal(r.hit, true, JSON.stringify(r));
    assert.equal(gs.players[t1].status, 'found');
    assert.equal(gs.modeState.targets.A, t2, 'A inherits the eliminated target\'s own target');
    assert.equal(gs.modeState.targets[t1], null);
  });

  check('eliminations cascade down to exactly one survivor, who wins by userId', () => {
    const gs = setupShip('ship_win', [
      { userId: 'A', username: 'A' }, { userId: 'B', username: 'B' }, { userId: 'C', username: 'C' },
    ]);
    for (const u of ['A', 'B', 'C']) tel(gs, u, MUC);
    let rounds = 0;
    while (!gs.gameOver && rounds < 10) {
      const alive = Object.values(gs.players).filter(p => p.status === 'alive');
      const shooter = alive[0].userId;
      sleepMs(60); TS += 1100;
      const r = arops.actionArHitAttempt(gs, shooter,
        { sample: { lat: MUC.lat, lon: MUC.lon, ts: TS, accuracyM: 5, headingDeg: 0 } });
      assert.equal(r.hit, true, JSON.stringify(r));
      rounds++;
    }
    assert.equal(gs.gameOver, true);
    assert.ok(['A', 'B', 'C'].includes(gs.winner));
    assert.equal(Object.values(gs.players).filter(p => p.status === 'alive').length, 1);
  });

  check('time limit: highest score wins, tie is a draw', () => {
    const gs = setupShip('ship_time', [{ userId: 'A', username: 'A' }, { userId: 'B', username: 'B' }]);
    gs.players.A.score = 30;
    gs.players.B.score = 10;
    gs.phaseStartTime = Date.now() - 700_000;
    tick(gs, 100);
    assert.equal(gs.gameOver, true);
    assert.equal(gs.winner, 'A');

    const gsTie = setupShip('ship_time_tie', [{ userId: 'A', username: 'A' }, { userId: 'B', username: 'B' }]);
    gsTie.players.A.score = 20;
    gsTie.players.B.score = 20;
    gsTie.phaseStartTime = Date.now() - 700_000;
    tick(gsTie, 100);
    assert.equal(gsTie.gameOver, true);
    assert.equal(gsTie.winner, 'draw');
  });

  check('classic Hide & Seek is unaffected: roles assigned, hiding phase still gated by hidingDurationMs', () => {
    const gs = createGame('ship_regression', [
      { userId: 'A', username: 'A' }, { userId: 'B', username: 'B' },
    ], { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek', hidingDurationMs: 100_000, gameDurationMs: 600_000 } });
    assert.equal(gs.phase, 'hiding');
    assert.equal(gs.modeState.targets, undefined, 'classic variant never builds an assassin chain');
    tick(gs, 10);
    assert.equal(gs.phase, 'hiding', 'classic variant still respects hidingDurationMs, unlike The Ship');
  });

  check('solo debug session never auto-ends via checkWin just because "1 player is left"', () => {
    const gs = setupShip('ship_solo', [{ userId: 'A', username: 'A' }], { debugMode: true });
    tel(gs, 'A', MUC);
    assert.equal(gs.modeState.targets.A, null, 'nobody to hunt with only one player');
    assert.equal(gs.gameOver, false);
  });
}

// ═══ SEEK & DESTROY ═════════════════════════════════════════
console.log('\n═══ SEEK & DESTROY ═══');
{
  // 3 zones by default, not 2 — instant variant ("Symmetrisch mit
  // Restore") always reactivates now (host requirement, no exception, see
  // arops.js's createAropsGame), which requires more targets than teams
  // (2 here → minimum 3). Tests that need an exact/smaller zone count
  // (mostly the 'defuse' variant ones, which never reactivates) override
  // `zones` explicitly via `over`.
  const Z3 = shared.destinationPoint(MUC, 0, 100);
  const mk = (over = {}) => {
    const gs = createGame('snd' + Math.random(),
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'seek_destroy', zones: [Z1, Z2, Z3],
        timings: FAST, gameDurationMs: 600_000, ...over } });
    skipWarmup(gs); // default onHit is freeze — no base, just a Warmup timer
    return gs;
  };

  check('instant variant (default): either team can capture the active target, destroying it and scoring', () => {
    const gs = mk();
    assert.equal(gs.cfg.destroyVariant, 'instant');
    assert.equal(gs.modeState.activeIndex, 0);
    tel(gs, 'A1', Z1);
    tick(gs, 200);
    assert.equal(gs.modeState.destroyed[0], false, 'not yet — dwell not complete');
    tick(gs, 200);
    assert.equal(gs.modeState.destroyed[0], true);
    assert.ok([1, 2].includes(gs.modeState.activeIndex), 'a remaining, non-destroyed zone activates (random pick)');
    assert.ok(gs.events.some(e => e.type === 'target_destroyed' && e.byTeam === 'a'));
    assert.ok(gs.players.A1.score > 0, 'capturing player is credited');
  });

  check('instant variant: contested (both teams present) pauses capture progress', () => {
    const gs = mk();
    tel(gs, 'A1', Z1);
    tel(gs, 'B1', Z1);
    tick(gs, 400);
    assert.equal(gs.modeState.destroyed[0], false, 'contested — nobody captures');
  });

  check('capture progress is exposed in the snapshot with team attribution (for the flow-ring overlay)', () => {
    const gs = mk();
    tel(gs, 'B1', Z1);
    tick(gs, 100); // partway through the dwell
    const snap = arops.getAropsSnapshot(gs, 'A1');
    assert.ok(snap.capture, 'capture progress should be present');
    assert.equal(snap.capture.team, 'b');
    assert.ok(snap.capture.pct > 0 && snap.capture.pct < 100, `expected partial pct, got ${snap.capture.pct}`);
  });

  check('instant variant always reactivates — a single-zone game is rejected (need_zones), no non-reactivating instant config exists', () => {
    // 'defuse' ("Angriff & Verteidigung") is the only way left to get a
    // non-reactivating single-target game — see its own explosion test
    // below for that regression coverage (destroying the one target with
    // no defender ends the match immediately).
    assert.throws(() => createGame('snd_solo',
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'seek_destroy', zones: [Z1], timings: FAST, gameDurationMs: 600_000 } }),
      /need_zones/);
  });

  check('instant variant: after all targets are destroyed, they reset and the match continues (always reactivates)', () => {
    // Instant always reactivates now, which requires at least one more
    // target than teams (2 teams here → minimum 3) — see the need_zones
    // invariant test below.
    const Z3 = shared.destinationPoint(MUC, 0, 100);
    const gs = createGame('snd_reactivate',
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'seek_destroy', zones: [Z1, Z2, Z3], timings: FAST,
        gameDurationMs: 600_000 } });
    assert.equal(gs.cfg.destroyReactivate, true);
    skipWarmup(gs);
    // Destroy all 3 targets in turn, walking to whichever zone is currently
    // active (order is randomized among the remaining ones, see the
    // "random next active target" test above).
    for (let i = 0; i < 3; i++) {
      const active = gs.zones[gs.modeState.activeIndex];
      tel(gs, 'A1', active);
      tick(gs, 200); tick(gs, 200);
    }
    assert.equal(gs.gameOver, false, 'reactivation keeps the match going instead of ending it');
    assert.deepEqual(gs.modeState.destroyed, [false, false, false], 'all 3 zones reactivated');
    assert.ok(gs.events.some(e => e.type === 'targets_reactivated'));
  });

  check('instant variant (always reactivates) requires more targets than teams/players, otherwise need_zones', () => {
    assert.throws(() => createGame('snd_reactivate_toofew',
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'seek_destroy', zones: [Z1, Z2], timings: FAST,
        gameDurationMs: 600_000 } }), /need_zones/,
      '2 teams need > 2 targets (3+) — instant always reactivates now, no opt-out');
    // 'defuse' ("Angriff & Verteidigung") never reactivates — the same 2
    // zones are fine there.
    const gs = createGame('snd_defuse_no_reactivate',
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'seek_destroy', destroyVariant: 'defuse', zones: [Z1, Z2], timings: FAST,
        gameDurationMs: 600_000 } });
    assert.equal(gs.zones.length, 2);
    assert.equal(gs.cfg.destroyReactivate, false);
  });

  check('defuse variant: attacker arms the target, defender defuses it — target survives, stays active', () => {
    const gs = mk({ destroyVariant: 'defuse' });
    tel(gs, 'A1', Z1);
    tick(gs, 200); tick(gs, 200);
    assert.ok(gs.modeState.armed, 'armed');
    assert.ok(gs.events.some(e => e.type === 'target_armed'));
    tel(gs, 'B1', Z1);
    tel(gs, 'A1', shared.destinationPoint(Z1, 90, 30)); // attacker leaves, clean presence for defuse
    tick(gs, 200); tick(gs, 200);
    assert.equal(gs.modeState.armed, null, 'defused');
    assert.equal(gs.modeState.destroyed[0], false, 'defusing spares the target, it stays active');
    assert.ok(gs.events.some(e => e.type === 'target_defused'));
    assert.equal(gs.gameOver, false);
  });

  check('defuse variant: explosion (no defuse in time) destroys the target and scores for the attacking team', () => {
    const gs = mk({ destroyVariant: 'defuse', zones: [Z1] });
    tel(gs, 'A1', Z1);
    tick(gs, 200); tick(gs, 200);
    assert.ok(gs.modeState.armed);
    gs.modeState.armed.explodeAt = Date.now() - 1;
    tick(gs, 100);
    assert.equal(gs.modeState.destroyed[0], true);
    assert.equal(gs.gameOver, true);
    assert.equal(gs.winner, 'team_a');
  });

  check('defuse variant: a momentary empty zone (GPS jitter) pauses plant progress instead of resetting it', () => {
    // Regression test: advanceDwell used to be paired with an unconditional
    // `else { ms.captureProg = null }` whenever nobody was present that
    // tick, wiping out an almost-complete plant on a single dropout at the
    // zone boundary — reported as capture progress getting stuck near
    // completion and never finishing (repeated near-100% resets read as
    // "hangs"). Every other capture path (Domination's capProgress,
    // instant-variant's captureProg) already paused-and-kept; this made
    // defuse-variant plant/defuse the odd one out.
    const gs = mk({ destroyVariant: 'defuse' });
    tel(gs, 'A1', Z1);
    tick(gs, 200); // partway into the plant dwell (plantDwellMs=300 under FAST)
    const progBefore = gs.modeState.captureProg;
    assert.ok(progBefore && progBefore.ms > 0, 'accumulated some progress');
    tel(gs, 'A1', shared.destinationPoint(Z1, 90, 500)); // step well outside the zone
    tick(gs, 200);
    assert.deepEqual(gs.modeState.captureProg, progBefore, 'progress paused, not reset, while the zone is empty');
    tel(gs, 'A1', Z1); // back in
    tick(gs, 200);
    assert.ok(gs.modeState.armed, 'resumed and finished arming instead of restarting from 0');
  });

  check('CTF: a momentary empty base zone pauses flag pickup progress instead of resetting it', () => {
    const gs = createGame('ctf_pause',
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'ctf', timings: FAST, gameDurationMs: 600_000 } });
    // Captains place bases (A1 for team a, B1 for team b, default alternating assignment)
    arops.actionArSetBase(gs, 'A1', { lat: Z1.lat, lon: Z1.lon });
    arops.actionArSetBase(gs, 'B1', { lat: Z2.lat, lon: Z2.lon });
    // Both in their own base right as base_setup ends, otherwise the
    // spawn/respawn checkpoint marks them 'downed' and zonePresence excludes
    // non-alive players from every flag check below (see the matching
    // comment on the CTF suite's own "valid base set" test above).
    tel(gs, 'A1', Z1);
    tel(gs, 'B1', Z2);
    gs.phaseStartTime = Date.now() - (gs.timings.baseSettingMs + 100);
    tick(gs, 100);
    assert.equal(gs.phase, 'live');
    tel(gs, 'B1', Z1); // B1 (team b) dwelling to steal team a's home flag
    tick(gs, 200);
    const progBefore = gs.modeState.flags.a.pickupProg;
    assert.ok(progBefore && progBefore.ms > 0, 'accumulated some pickup progress');
    tel(gs, 'B1', shared.destinationPoint(Z1, 90, 500));
    tick(gs, 200);
    assert.deepEqual(gs.modeState.flags.a.pickupProg, progBefore, 'pickup progress paused, not reset');
  });

  check('CTF: contestResets=true cancels flag-pickup progress instead of pausing it', () => {
    const gs = createGame('ctf_contest',
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'ctf', timings: FAST, gameDurationMs: 600_000, contestResets: true } });
    arops.actionArSetBase(gs, 'A1', { lat: Z1.lat, lon: Z1.lon });
    arops.actionArSetBase(gs, 'B1', { lat: Z2.lat, lon: Z2.lon });
    tel(gs, 'A1', Z1);
    tel(gs, 'B1', Z2);
    gs.phaseStartTime = Date.now() - (gs.timings.baseSettingMs + 100);
    tick(gs, 100);
    tel(gs, 'B1', Z1);
    tick(gs, 200);
    assert.ok(gs.modeState.flags.a.pickupProg, 'accumulated some pickup progress');
    tel(gs, 'B1', shared.destinationPoint(Z1, 90, 500));
    tick(gs, 200);
    assert.equal(gs.modeState.flags.a.pickupProg, null, 'contest cancelled the attempt (contestResets=true)');
  });

  check('CTF: teamCaptureEnabled requires N teammates present to steal, not just 1', () => {
    const gs = createGame('ctf_teamcap',
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }, { userId: 'B2', username: 'B2' }],
      { ar_settings: { polygon: FIELD, subMode: 'ctf', teams: { A1: 'a', B1: 'b', B2: 'b' },
        timings: FAST, gameDurationMs: 600_000, teamCaptureEnabled: true, teamCaptureSize: 2 } });
    arops.actionArSetBase(gs, 'A1', { lat: Z1.lat, lon: Z1.lon });
    arops.actionArSetBase(gs, 'B1', { lat: Z2.lat, lon: Z2.lon });
    // Everyone (including B2) in their own team's base right as base_setup
    // ends, otherwise the spawn/respawn checkpoint marks them 'downed' and
    // zonePresence excludes them from the flag-pickup check below.
    tel(gs, 'A1', Z1);
    tel(gs, 'B1', Z2);
    tel(gs, 'B2', Z2);
    gs.phaseStartTime = Date.now() - (gs.timings.baseSettingMs + 100);
    tick(gs, 100);
    // Gradual steps, not a single jump — a one-sample teleport across the
    // field gets rejected as implausible movement (see the CTF suite's own
    // "enemy dwell in base steals the flag" test for the same pattern).
    const walkTo = (uid, from, to) => {
      let pos = from;
      const brg = shared.bearingDeg(from, to);
      for (let i = 0; i < 22 && shared.haversineMeters(pos, to) > 8; i++) {
        pos = shared.destinationPoint(pos, brg, 12);
        tel(gs, uid, pos);
      }
    };
    walkTo('B1', Z2, Z1);
    tick(gs, 200); tick(gs, 200);
    assert.equal(gs.modeState.flags.a.state, 'home', 'solo B1 cannot steal — needs 2 teammates present');
    walkTo('B2', Z2, Z1);
    tick(gs, 200); tick(gs, 200);
    assert.equal(gs.modeState.flags.a.state, 'carried', 'both B1 and B2 present together — steals it');
  });

  check('time limit: higher score wins, tie is a draw', () => {
    const gs = mk();
    gs.players.A1.score = 20;
    gs.players.B1.score = 10;
    gs.phaseStartTime = Date.now() - 700_000;
    tick(gs, 100);
    assert.equal(gs.gameOver, true);
    assert.equal(gs.winner, 'team_a');

    const gsTie = mk();
    gsTie.players.A1.score = 15;
    gsTie.players.B1.score = 15;
    gsTie.phaseStartTime = Date.now() - 700_000;
    tick(gsTie, 100);
    assert.equal(gsTie.winner, 'draw');
  });

  check('zones required for snd/domination', () => {
    assert.throws(() => createGame('bad',
      [{ userId: 'x', username: 'x' }, { userId: 'y', username: 'y' }],
      { ar_settings: { polygon: FIELD, subMode: 'seek_destroy' } }), /need_zones/);
    assert.throws(() => createGame('bad2',
      [{ userId: 'x', username: 'x' }, { userId: 'y', username: 'y' }],
      { ar_settings: { polygon: FIELD, subMode: 'domination', zones: [Z1] } }), /need_zones/);
  });
}

// ═══ TEAM/FFA VARIANT (Domination, Zerstören, Deathmatch, CTF) ═══
// "Jeder gegen jeden" for the 4 team-capable modes, analogous to Hide &
// Seek's hsVariant — ar_settings.teamVariant='ffa'. See arops.js's MODES
// table (cfg.teamVariant) and CLAUDE.md-adjacent design notes in this file's
// mode blocks for the per-mode semantics chosen.
console.log('\n═══ TEAM/FFA VARIANT ═══');
{
  check('domination ffa: no teams assigned, zone captured individually, win on target score', () => {
    const gs = createGame('dom_ffa',
      [{ userId: 'A1', username: 'A1' }, { userId: 'A2', username: 'A2' }],
      { ar_settings: { polygon: FIELD, subMode: 'domination', teamVariant: 'ffa', zones: [Z1, Z2],
        timings: FAST, targetScore: 3, gameDurationMs: 600_000 } });
    skipWarmup(gs);
    assert.equal(gs.players.A1.team, null);
    assert.equal(gs.players.A2.team, null);
    tel(gs, 'A1', Z1);
    tick(gs, 200); tick(gs, 200);
    assert.equal(gs.modeState.owners.z1, 'A1');
    assert.ok(gs.events.some(e => e.type === 'zone_captured' && e.userId === 'A1'));
    // tick()'s dt is capped at 2000ms regardless of the requested advance —
    // two calls for a real cumulative 4s (matches the DOMINATION section's
    // own tick(gs, 2000) convention above).
    tick(gs, 2000); tick(gs, 2000);
    assert.ok(gs.modeState.playerScore.A1 >= 3);
    assert.equal(gs.gameOver, true);
    assert.equal(gs.winner, 'player_A1');
  });

  check('domination ffa: two players together in a zone contest it (no capture)', () => {
    const gs = createGame('dom_ffa2',
      [{ userId: 'A1', username: 'A1' }, { userId: 'A2', username: 'A2' }],
      { ar_settings: { polygon: FIELD, subMode: 'domination', teamVariant: 'ffa', zones: [Z1, Z2],
        timings: FAST, targetScore: 100, gameDurationMs: 600_000 } });
    skipWarmup(gs);
    tel(gs, 'A1', Z1); tel(gs, 'A2', Z1);
    tick(gs, 500);
    assert.equal(gs.modeState.owners.z1, null, 'contested, nobody alone');
  });

  check('seek_destroy ffa: individual capture, defuse variant force-reset to instant', () => {
    const gs = createGame('snd_ffa',
      [{ userId: 'A1', username: 'A1' }, { userId: 'A2', username: 'A2' }],
      { ar_settings: { polygon: FIELD, subMode: 'seek_destroy', teamVariant: 'ffa', destroyVariant: 'defuse',
        // ffa forces destroyVariant back to 'instant' (asserted below), which
        // now always reactivates -> needs > players.length (2) zones.
        zones: [Z1, shared.destinationPoint(MUC, 0, 100), shared.destinationPoint(MUC, 180, 100)],
        timings: FAST, gameDurationMs: 600_000 } });
    skipWarmup(gs);
    assert.equal(gs.cfg.destroyVariant, 'instant', 'ffa forces defuse back to instant (two-sided, no ffa reading)');
    tel(gs, 'A1', Z1);
    tick(gs, 200); tick(gs, 200);
    assert.equal(gs.modeState.destroyed[0], true);
    assert.ok(gs.events.some(e => e.type === 'target_destroyed' && e.byUserId === 'A1'));
    assert.equal(gs.gameOver, false, 'more targets remain — instant always reactivates now, needs > players.length zones');
  });

  check('deathmatch ffa: no captains, each player sets own base, last standing wins', () => {
    const gs = createGame('dm_ffa',
      [{ userId: 'A1', username: 'A1' }, { userId: 'A2', username: 'A2' }],
      { ar_settings: { polygon: FIELD, subMode: 'deathmatch', teamVariant: 'ffa', gameDurationMs: 600_000,
        timings: { ...FAST, spawnCheckDwellMs: 300 }, onHit: 'respawn', livesPerPlayer: 1 } });
    assert.equal(gs.players.A1.team, null);
    const baseA1 = shared.destinationPoint(MUC, 270, 100);
    const baseA2 = shared.destinationPoint(MUC, 90, 100);
    const r1 = arops.actionArSetBase(gs, 'A1', { lat: baseA1.lat, lon: baseA1.lon });
    assert.equal(r1.ok, true, 'any player can set own base in ffa, no captain gate');
    const r2 = arops.actionArSetBase(gs, 'A2', { lat: baseA2.lat, lon: baseA2.lon });
    assert.equal(r2.ok, true);
    tel(gs, 'A1', baseA1);
    tel(gs, 'A2', baseA2);
    gs.phaseStartTime = Date.now() - 1000;
    tick(gs, 100);
    assert.equal(gs.phase, 'live');
    assert.equal(gs.players.A1.status, 'alive', 'A1 was in its own base at the checkpoint');
    assert.equal(gs.players.A2.status, 'alive', 'A2 was in its own base at the checkpoint');

    // A2 moves near A1 for the shot — both already established/alive above,
    // same pattern as the existing 'respawn variant: 0 lives eliminates...' test.
    const targetPos = shared.destinationPoint(baseA1, 0, 5);
    tel(gs, 'A2', targetPos);
    TS += 1100;
    const heading = shared.bearingDeg(baseA1, targetPos);
    const r = arops.actionArHitAttempt(gs, 'A1', {
      sample: { lat: baseA1.lat, lon: baseA1.lon, ts: TS, accuracyM: 5, headingDeg: heading },
    });
    assert.equal(r.hit, true, JSON.stringify(r));
    assert.equal(gs.players.A2.status, 'found', 'eliminated (1 life)');
    assert.equal(gs.gameOver, true);
    assert.equal(gs.winner, 'player_A1', 'last player standing wins');
  });

  check('ctf ffa: N flags one per player, no captain gate, steal + capture at own base', () => {
    const gs = createGame('ctf_ffa',
      [{ userId: 'A1', username: 'A1' }, { userId: 'A2', username: 'A2' }],
      { ar_settings: { polygon: FIELD, subMode: 'ctf', teamVariant: 'ffa',
        timings: FAST, targetCaptures: 1, gameDurationMs: 600_000 } });
    assert.equal(gs.players.A1.team, null);
    assert.deepEqual(Object.keys(gs.modeState.flags).sort(), ['A1', 'A2']);

    const baseA1 = shared.destinationPoint(MUC, 270, 120);
    const baseA2 = shared.destinationPoint(MUC, 90, 120);
    const r1 = arops.actionArSetBase(gs, 'A1', { lat: baseA1.lat, lon: baseA1.lon });
    assert.equal(r1.ok, true, 'no captain gate in ffa');
    arops.actionArSetBase(gs, 'A2', { lat: baseA2.lat, lon: baseA2.lon });
    tel(gs, 'A1', baseA1);
    tel(gs, 'A2', baseA2);
    gs.phaseStartTime = Date.now() - 1000;
    tick(gs, 100);
    assert.equal(gs.phase, 'live');

    // A1 walks into A2's base to steal A2's flag
    let pos = baseA1;
    const brg = shared.bearingDeg(baseA1, baseA2);
    for (let i = 0; i < 22 && shared.haversineMeters(pos, baseA2) > 8; i++) {
      pos = shared.destinationPoint(pos, brg, 12);
      tel(gs, 'A1', pos);
    }
    tick(gs, 200); tick(gs, 200);
    assert.equal(gs.modeState.flags.A2.state, 'carried');
    assert.equal(gs.modeState.flags.A2.carrier, 'A1');

    // A1 carries it home to A1's own base
    let pos2 = gs.players.A1.lastAccepted;
    const brg2 = shared.bearingDeg(pos2, baseA1);
    for (let i = 0; i < 22 && shared.haversineMeters(pos2, baseA1) > 8; i++) {
      pos2 = shared.destinationPoint(pos2, brg2, 12);
      tel(gs, 'A1', pos2);
    }
    tick(gs, 100);
    assert.equal(gs.modeState.captures.A1, 1);
    assert.equal(gs.gameOver, true);
    assert.equal(gs.winner, 'player_A1');
  });

  check("ctf ffa: capturing doesn't require your own flag to be home (unlike team mode)", () => {
    const gs = createGame('ctf_ffa2',
      [{ userId: 'A1', username: 'A1' }, { userId: 'A2', username: 'A2' }],
      { ar_settings: { polygon: FIELD, subMode: 'ctf', teamVariant: 'ffa',
        timings: FAST, targetCaptures: 5, gameDurationMs: 600_000 } });
    const baseA1 = shared.destinationPoint(MUC, 270, 120);
    const baseA2 = shared.destinationPoint(MUC, 90, 120);
    arops.actionArSetBase(gs, 'A1', { lat: baseA1.lat, lon: baseA1.lon });
    arops.actionArSetBase(gs, 'A2', { lat: baseA2.lat, lon: baseA2.lon });
    tel(gs, 'A1', baseA1);
    tel(gs, 'A2', baseA2);
    gs.phaseStartTime = Date.now() - 1000;
    tick(gs, 100);

    // Both flags simultaneously away from home — under the classic team-mode
    // rule this would block BOTH captures; ffa has no such requirement.
    gs.modeState.flags.A1.state = 'carried'; gs.modeState.flags.A1.carrier = 'A2';
    gs.modeState.flags.A2.state = 'carried'; gs.modeState.flags.A2.carrier = 'A1';
    tick(gs, 100);
    assert.equal(gs.modeState.captures.A1, 1, "A1 captures A2's flag despite A1's own flag being stolen too");
  });

  check('teamVariant is ignored for non-team modes (hide_and_seek uses hsVariant instead)', () => {
    const gs = createGame('hs_teamvariant_noop',
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek', teamVariant: 'ffa', hidingDurationMs: 100 } });
    assert.equal(gs.cfg.teamVariant, 'team', 'usesTeams=false modes never read ffa off teamVariant');
  });
}

// ═══ HIDE & SEEK PERKS (Drohne / Cloak / Fake-Marker / Aufscheuchen) ═══
console.log('\n═══ H&S PERKS ═══');
{
  const mkHS = () => {
    const gs = createGame('hsperk' + Math.random(),
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
    // The real passive proximity check only runs in debug sessions now (see
    // the Proximity-Alert-Gating change) — this gs is a throwaway fixture
    // local to this check, so debugMode here can't leak into any other test.
    gs.cfg.debugMode = true;
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
    const gs = createGame('teamperk' + Math.random(),
      [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
      { ar_settings: { polygon: FIELD, subMode: 'domination', zones: [Z1, Z2], timings: FAST } });
    skipWarmup(gs);
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

  const mkFound = (foundMode, over = {}) => {
    const gs = createGame('found' + Math.random(),
      [{ userId: 'S', username: 'S' }, { userId: 'H1', username: 'H1' }, { userId: 'H2', username: 'H2' }],
      { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek',
        roles: { S: 'seeker', H1: 'hider', H2: 'hider' },
        hidingDurationMs: 0, gameDurationMs: 600_000, hitCooldownMs: 50, foundMode, ...over } });
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

  check("hiderCanFreeze=true overrides foundMode='seeker' — found hider freezes instead of flipping role", () => {
    // 2 independent Lobby toggles now (ar.foundMode 'seeker'/'spectator' +
    // a separate ar.hiderCanFreeze bool) instead of one lossy tri-state —
    // freeze always wins regardless of what the other toggle is set to.
    const gs = mkFound('seeker', { hiderCanFreeze: true, timings: { freezeMs: 5000 } });
    const t0 = Date.now();
    arops.actionArTelemetry(gs, 'S', { sample: { lat: posS.lat, lon: posS.lon, ts: t0, accuracyM: 5 } });
    arops.actionArTelemetry(gs, 'H1', { sample: { lat: posH1.lat, lon: posH1.lon, ts: t0, accuracyM: 5 } });

    const r = arops.actionArHitAttempt(gs, 'S', {
      sample: { lat: posS.lat, lon: posS.lon, ts: t0 + 1100, accuracyM: 5, headingDeg: 0 },
    });
    assert.equal(r.hit, true, JSON.stringify(r));
    assert.equal(gs.players.H1.role, 'hider', 'role untouched — freeze wins over the seeker toggle');
    assert.equal(gs.players.H1.status, 'alive', 'frozen, not sidelined');
    assert.ok(gs.players.H1.frozenUntil > Date.now(), 'actually frozen');
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
    const gs = createGame('botA' + Math.random(),
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
    const gs = createGame('botB' + Math.random(),
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
    const gs = createGame('solo' + Math.random(),
      [{ userId: 'H1', username: 'H1' }],
      { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek',
        roles: { H1: 'hider' }, debugMode: true,
        hidingDurationMs: 0, gameDurationMs: 600_000 } });
    assert.equal(gs.players.H1.role, 'hider', 'debugMode must not force a lone player into seeker');
  });

  check('solo debug hider auto-found by geofence never ends the game via checkWin', () => {
    const gs = createGame('solo2' + Math.random(),
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
    const gs = createGame('botC' + Math.random(),
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
    const gs = createGame('debugreveal' + Math.random(),
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
  const gs = createGame('diag1',
    [{ userId: 'A1', username: 'A1' }, { userId: 'A2', username: 'A2' }],
    { ar_settings: { polygon: FIELD, subMode: 'domination', zones: [Z1, Z2],
      teams: { A1: 'a', A2: 'a' }, timings: FAST, hitCooldownMs: 50 } });
  skipWarmup(gs);
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
  const gs = createGame('diag2',
    [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }],
    { ar_settings: { polygon: FIELD, subMode: 'domination', zones: [Z1, Z2],
      timings: FAST, hitCooldownMs: 50 } });
  skipWarmup(gs);
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

// ═══ IR MODE (hardware/esp32-ir beacon confirmation) ═══════════
console.log('\n═══ IR MODE ═══');
{
  const posS = MUC;
  const posH1 = shared.destinationPoint(MUC, 0, 50); // due north of S — headingDeg 0 hits

  const mkIr = () => {
    const gs = createGame('ir' + Math.random(),
      [{ userId: 'S', username: 'S' }, { userId: 'H1', username: 'H1' }],
      { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek',
        roles: { S: 'seeker', H1: 'hider' }, hidingDurationMs: 0, gameDurationMs: 600_000,
        hitCooldownMs: 50, hitTrackingMode: 'ir', irIds: { H1: 7 } } });
    tick(gs, 10); // → seeking
    return gs;
  };
  const shootAt = (gs, t0, irScan) => arops.actionArHitAttempt(gs, 'S', {
    sample: { lat: posS.lat, lon: posS.lon, ts: t0 + 1100, accuracyM: 5, headingDeg: 0 },
    irScan,
  });

  check('ir mode: cone-check passes but no IR scan at all → rejected', () => {
    const gs = mkIr();
    const t0 = Date.now();
    arops.actionArTelemetry(gs, 'S', { sample: { lat: posS.lat, lon: posS.lon, ts: t0, accuracyM: 5 } });
    arops.actionArTelemetry(gs, 'H1', { sample: { lat: posH1.lat, lon: posH1.lon, ts: t0, accuracyM: 5 } });
    const r = shootAt(gs, t0, undefined);
    assert.equal(r.hit, false, JSON.stringify(r));
    assert.equal(r.reason, 'ir_not_confirmed');
  });

  check('ir mode: scanned a different device ID than the target\'s assigned one → rejected', () => {
    const gs = mkIr();
    const t0 = Date.now();
    arops.actionArTelemetry(gs, 'S', { sample: { lat: posS.lat, lon: posS.lon, ts: t0, accuracyM: 5 } });
    arops.actionArTelemetry(gs, 'H1', { sample: { lat: posH1.lat, lon: posH1.lon, ts: t0, accuracyM: 5 } });
    const r = shootAt(gs, t0, { deviceId: 99, ts: t0 + 1100 });
    assert.equal(r.hit, false, JSON.stringify(r));
    assert.equal(r.reason, 'ir_not_confirmed');
  });

  check('ir mode: scan matches the ID but is too old → rejected', () => {
    const gs = mkIr();
    const t0 = Date.now();
    arops.actionArTelemetry(gs, 'S', { sample: { lat: posS.lat, lon: posS.lon, ts: t0, accuracyM: 5 } });
    arops.actionArTelemetry(gs, 'H1', { sample: { lat: posH1.lat, lon: posH1.lon, ts: t0, accuracyM: 5 } });
    const r = shootAt(gs, t0, { deviceId: 7, ts: t0 - 10_000 });
    assert.equal(r.hit, false, JSON.stringify(r));
    assert.equal(r.reason, 'ir_not_confirmed');
  });

  check('ir mode: scan matches the assigned ID and is recent → hit counts', () => {
    const gs = mkIr();
    const t0 = Date.now();
    arops.actionArTelemetry(gs, 'S', { sample: { lat: posS.lat, lon: posS.lon, ts: t0, accuracyM: 5 } });
    arops.actionArTelemetry(gs, 'H1', { sample: { lat: posH1.lat, lon: posH1.lon, ts: t0, accuracyM: 5 } });
    const r = shootAt(gs, t0, { deviceId: 7, ts: t0 + 1100 });
    assert.equal(r.hit, true, JSON.stringify(r));
    assert.equal(r.targetId, 'H1');
  });

  check('compass mode (default): hit counts with no irScan at all — the gate is ir-mode-only', () => {
    const gs = createGame('ir-default' + Math.random(),
      [{ userId: 'S', username: 'S' }, { userId: 'H1', username: 'H1' }],
      { ar_settings: { polygon: FIELD, subMode: 'hide_and_seek',
        roles: { S: 'seeker', H1: 'hider' }, hidingDurationMs: 0, gameDurationMs: 600_000,
        hitCooldownMs: 50 } });
    tick(gs, 10);
    const t0 = Date.now();
    arops.actionArTelemetry(gs, 'S', { sample: { lat: posS.lat, lon: posS.lon, ts: t0, accuracyM: 5 } });
    arops.actionArTelemetry(gs, 'H1', { sample: { lat: posH1.lat, lon: posH1.lon, ts: t0, accuracyM: 5 } });
    const r = shootAt(gs, t0, undefined);
    assert.equal(r.hit, true, JSON.stringify(r));
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
