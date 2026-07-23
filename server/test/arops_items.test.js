'use strict';
// ═══════════════════════════════════════════════════════════
//  AR OPS item system — a final kill drops the eliminated player's class
//  perk as a one-time pickup; any nearby player without an item already
//  held picks it up on presence; using it applies the perk effect without
//  touching the player's own perk cooldowns.
//  Run: node server/test/arops_items.test.js
// ═══════════════════════════════════════════════════════════
const assert = require('assert');
const arops = require('../src/game/arops');
const shared = require('@craftworks/arops-shared');

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
const FAST = { freezeMs: 1000, baseSettingMs: 500, warmupMs: 500 };

// Deathmatch defaults onHit to 'respawn' already (its identity, see
// arops.js's defaultOnHit) — reaches 'live' the same way arops_modes.test.js's
// own setupDeathmatch helper does (captain-only base_setup, generic to any
// team-capable mode).
// `withB2`: adds a 3rd, uninvolved player to team b — needed by the pickup
// tests below, since a bare 1v1 ends the match (Deathmatch's own checkWin)
// the instant B1 is eliminated, and tickArops (where pickup lives) bails
// out immediately once gs.gameOver is true — a real match with more than
// 2 players obviously wouldn't hit that, this is purely a test-fixture
// artifact of the smallest possible drop-test roster.
function setupDeathmatch(sessionId, over = {}, withB2 = false) {
  const players = [{ userId: 'A1', username: 'A1' }, { userId: 'B1', username: 'B1' }];
  if (withB2) players.push({ userId: 'B2', username: 'B2' });
  const gs = createGame(sessionId, players,
    { ar_settings: { polygon: FIELD, subMode: 'deathmatch', gameDurationMs: 600_000,
      timings: FAST, livesPerPlayer: 1, hitCooldownMs: 0,
      ...(withB2 ? { teams: { B2: 'b' } } : {}), ...over } });
  const baseA = shared.destinationPoint(MUC, 270, 100);
  const baseB = shared.destinationPoint(MUC, 90, 100);
  arops.actionArSetBase(gs, 'A1', { lat: baseA.lat, lon: baseA.lon });
  arops.actionArSetBase(gs, 'B1', { lat: baseB.lat, lon: baseB.lon });
  tel(gs, 'A1', baseA);
  tel(gs, 'B1', baseB);
  if (withB2) tel(gs, 'B2', shared.destinationPoint(baseB, 45, 20));
  gs.phaseStartTime = Date.now() - 1000;
  tick(gs, 100);
  assert.equal(gs.phase, 'live', 'setup helper reached live phase');
  return { gs, baseA, baseB };
}
// Bases spawn ~200m apart (out of the default ~75m hit range) — walk both
// players toward the field center first, same convention
// arops_modes.test.js's own respawn-variant tests use, then shoot.
function converge(gs, baseA, baseB) {
  let posA = baseA, posB = baseB;
  const brgA = shared.bearingDeg(baseA, MUC), brgB = shared.bearingDeg(baseB, MUC);
  for (let i = 0; i < 12; i++) { posA = shared.destinationPoint(posA, brgA, 9); tel(gs, 'A1', posA); }
  for (let i = 0; i < 12; i++) { posB = shared.destinationPoint(posB, brgB, 9); tel(gs, 'B1', posB); }
  return { posA, posB };
}
function shootAt(gs, uid, targetId, pos, headingDeg) {
  TS += 1100;
  return arops.actionArHitAttempt(gs, uid, {
    targetId,
    sample: { lat: pos.lat, lon: pos.lon, ts: TS, accuracyM: 5, headingDeg },
  });
}

console.log('\n═══ ITEM DROP ═══');
{
  check('final kill drops the eliminated player\'s class perk at their last position', () => {
    const { gs, baseA, baseB } = setupDeathmatch('item_drop', { classes: { B1: 'bomber' } });
    const { posA, posB } = converge(gs, baseA, baseB);
    const r = shootAt(gs, 'A1', 'B1', posA, shared.bearingDeg(posA, posB));
    assert.equal(r.hit, true, JSON.stringify(r));
    assert.equal(gs.players.B1.status, 'found');
    assert.equal(gs.items.length, 1);
    assert.equal(gs.items[0].perkId, 'cloak', 'bomber drops cloak');
    assert.ok(shared.haversineMeters(gs.items[0], posB) < 1, 'dropped at the victim\'s own last position');
  });

  check('classless elimination still drops (default class is scout -> reveal_trap)', () => {
    const { gs, baseA, baseB } = setupDeathmatch('item_drop_default');
    const { posA, posB } = converge(gs, baseA, baseB);
    shootAt(gs, 'A1', 'B1', posA, shared.bearingDeg(posA, posB));
    assert.equal(gs.items[0].perkId, 'reveal_trap');
  });

  check('freeze variant (no permanent elimination) never drops an item', () => {
    const { gs, baseA, baseB } = setupDeathmatch('item_no_drop_freeze', { onHit: 'freeze' });
    const { posA, posB } = converge(gs, baseA, baseB);
    shootAt(gs, 'A1', 'B1', posA, shared.bearingDeg(posA, posB));
    assert.equal(gs.players.B1.status, 'alive', 'frozen, not eliminated');
    assert.equal(gs.items.length, 0);
  });
}

console.log('\n═══ PICKUP ═══');
{
  check('a nearby alive player without a held item picks it up on the next tick', () => {
    const { gs, baseA, baseB } = setupDeathmatch('item_pickup', { classes: { B1: 'sniper' } }, true);
    const { posA, posB } = converge(gs, baseA, baseB);
    shootAt(gs, 'A1', 'B1', posA, shared.bearingDeg(posA, posB));
    assert.equal(gs.items[0].perkId, 'fake_marker');
    tel(gs, 'A1', posB); // walk over to the drop
    tick(gs, 200);
    assert.equal(gs.players.A1.heldItem?.perkId, 'fake_marker');
    assert.equal(gs.items.length, 0, 'removed from the ground once picked up');
  });

  check('a player already holding an item does not pick up a second one', () => {
    // B1 deliberately left far away at its own base (well outside pickup
    // range) — this test is only about A1's own full slot, not about who
    // else might otherwise grab it.
    const { gs, baseA } = setupDeathmatch('item_pickup_full', { livesPerPlayer: 3 });
    gs.players.A1.heldItem = { perkId: 'cloak', pickedUpAt: Date.now() };
    gs.items.push({ id: 'item_test', perkId: 'reveal_trap', lat: baseA.lat, lon: baseA.lon, droppedAt: Date.now() });
    tel(gs, 'A1', baseA);
    tick(gs, 200);
    assert.equal(gs.players.A1.heldItem.perkId, 'cloak', 'still holding the original item');
    assert.equal(gs.items.length, 1, 'ground item untouched — A1 has no free slot');
  });
}

console.log('\n═══ USE ═══');
{
  check('using a held item applies the perk effect without touching the player\'s own perk cooldown', () => {
    const { gs } = setupDeathmatch('item_use', { cloakDurationMs: 5000 });
    gs.players.A1.heldItem = { perkId: 'cloak', pickedUpAt: Date.now() };
    assert.equal(gs.players.A1.perks.cloakLastUsed, 0);
    const r = arops.actionArUseItem(gs, 'A1');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(gs.players.A1.cloakUntil > Date.now(), 'cloak effect applied');
    assert.equal(gs.players.A1.perks.cloakLastUsed, 0, 'own cloak cooldown untouched by the item');
    assert.equal(gs.players.A1.heldItem, null, 'item consumed, one-shot');
  });

  check('using with no held item is rejected', () => {
    const { gs } = setupDeathmatch('item_use_none');
    const r = arops.actionArUseItem(gs, 'A1');
    assert.equal(r.ok, false);
    assert.equal(r.err, 'no_item');
  });
}

console.log('\n═══ VOLUNTARY DROP ═══');
{
  check('dropping places the item on the map, behind the player\'s heading, and clears the held slot', () => {
    const { gs, baseA } = setupDeathmatch('item_drop');
    gs.players.A1.heldItem = { perkId: 'cloak', pickedUpAt: Date.now() };
    tel(gs, 'A1', baseA, { headingDeg: 0 }); // facing due north -> drop lands south
    const before = gs.items.length;
    const r = arops.actionArDropItem(gs, 'A1');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(gs.players.A1.heldItem, null, 'slot cleared');
    assert.equal(gs.items.length, before + 1);
    const dropped = gs.items[gs.items.length - 1];
    assert.equal(dropped.perkId, 'cloak');
    const dist = shared.haversineMeters(gs.players.A1.lastAccepted, dropped);
    assert.ok(dist >= 19 && dist <= 21, `expected ~20m away, got ${dist}`);
    const brg = shared.bearingDeg(gs.players.A1.lastAccepted, dropped);
    assert.ok(brg > 170 && brg < 190, `expected dropped roughly south (180°) of a north-facing player, got ${brg}`);
  });

  check('the drop distance exceeds the pickup radius — the dropper does not immediately re-collect their own item', () => {
    const { gs, baseA } = setupDeathmatch('item_drop_no_repickup');
    gs.players.A1.heldItem = { perkId: 'fake_marker', pickedUpAt: Date.now() };
    tel(gs, 'A1', baseA, { headingDeg: 90 });
    arops.actionArDropItem(gs, 'A1');
    assert.equal(gs.players.A1.heldItem, null);
    tick(gs, 200); // tickArops's own pickup loop runs here
    assert.equal(gs.players.A1.heldItem, null, 'still empty-handed — dropped item was out of pickup range');
    assert.equal(gs.items.length, 1, 'item still sitting on the map, unpicked');
  });

  check('without a compass fix (headingDeg null), drop still lands a safe distance away', () => {
    const { gs, baseA } = setupDeathmatch('item_drop_no_heading');
    gs.players.A1.heldItem = { perkId: 'reveal_trap', pickedUpAt: Date.now() };
    tel(gs, 'A1', baseA); // default tel() heading is null
    const r = arops.actionArDropItem(gs, 'A1');
    assert.equal(r.ok, true);
    const dropped = gs.items[gs.items.length - 1];
    const dist = shared.haversineMeters(gs.players.A1.lastAccepted, dropped);
    assert.ok(dist >= 19 && dist <= 21, `expected ~20m away regardless of bearing, got ${dist}`);
  });

  check('dropping with no held item is rejected', () => {
    const { gs } = setupDeathmatch('item_drop_none');
    const r = arops.actionArDropItem(gs, 'A1');
    assert.equal(r.ok, false);
    assert.equal(r.err, 'no_item');
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
