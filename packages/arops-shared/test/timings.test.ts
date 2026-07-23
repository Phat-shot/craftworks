import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scaleTimings, isInZone, scaleDroneRangeM, scaleCoreConfig } from '../src/timings';
import { destinationPoint } from '../src/geo';

const MUC = { lat: 48.13743, lon: 11.57549 };
const REF_AREA_M2 = 224 * 224; // a "medium" reference field, L≈224m

test('timings: small field (L=20, platform minimum) matches spec anchors', () => {
  const t = scaleTimings(400); // 20×20m
  assert.equal(t.zoneRadiusM, 10);
  assert.equal(t.freezeMs, 3_000);
  assert.equal(t.captureDwellMs, 3_000);
  assert.equal(t.freezeMoveToleranceM, 15);
  assert.equal(t.baseSettingMs, 60_000);
  assert.equal(t.warmupMs, 60_000);
});

test('timings: medium field (L=100) matches spec anchors', () => {
  const t = scaleTimings(10_000); // 100×100m
  assert.equal(t.freezeMs, 10_000);
  assert.equal(t.baseSettingMs, 120_000);
  assert.equal(t.warmupMs, 60_000); // fixed, never scales
});

test('timings: large field (L=1000) matches spec anchors', () => {
  const t = scaleTimings(1_000_000); // 1000×1000m
  assert.equal(t.freezeMs, 30_000);
  assert.equal(t.baseSettingMs, 300_000);
  assert.equal(t.warmupMs, 60_000); // fixed, never scales
});

test('timings: warmupMs is fixed regardless of field size', () => {
  assert.equal(scaleTimings(400).warmupMs, 60_000);
  assert.equal(scaleTimings(40_000).warmupMs, 60_000);
  assert.equal(scaleTimings(1_000_000_000).warmupMs, 60_000);
});

test('timings: monotonic with field size', () => {
  const a = scaleTimings(40_000);    // 200m
  const b = scaleTimings(1_000_000); // 1km
  assert.ok(b.freezeMs >= a.freezeMs);
  assert.ok(b.zoneRadiusM >= a.zoneRadiusM);
  assert.ok(b.baseSettingMs >= a.baseSettingMs);
  assert.ok(b.bombTimerMs >= a.bombTimerMs);
  assert.ok(b.minBaseSeparationM >= a.minBaseSeparationM);
});

test('timings: huge field hits upper clamps', () => {
  const t = scaleTimings(3_000_000); // L≈1,732 — beyond the L=1000 "large" anchor
  assert.equal(t.freezeMs, 30_000);
  assert.equal(t.baseSettingMs, 300_000);
  assert.equal(t.zoneRadiusM, 40);
});

test('scaleDroneRangeM: small field hits lower clamp', () => {
  assert.equal(scaleDroneRangeM(400), 15); // L=20, well under the small boundary
});

test('scaleDroneRangeM: monotonic with field size', () => {
  const a = scaleDroneRangeM(40_000);    // L=200 → 100
  const b = scaleDroneRangeM(1_000_000); // L=1000 → 200 (clamped)
  assert.ok(b >= a);
  assert.equal(a, 100);
});

test('scaleDroneRangeM: huge field hits upper clamp', () => {
  assert.equal(scaleDroneRangeM(3_000_000), 200);
});

test('scaleCoreConfig: small field (L=20, platform minimum) matches spec anchors', () => {
  const c = scaleCoreConfig(400); // 20×20m
  assert.equal(c.gameDurationMs, 5 * 60_000);
  assert.equal(c.hitRangeM, 5);
  assert.equal(c.radarCooldownMs, 60_000);
  assert.equal(c.droneCooldownMs, 60_000 / 3);
  assert.equal(c.perkDurationMs, 5_000);
});

test('scaleCoreConfig: medium field (L=100) matches spec anchors', () => {
  const c = scaleCoreConfig(10_000); // 100×100m
  assert.equal(c.gameDurationMs, 15 * 60_000);
  assert.equal(c.hitRangeM, 20);
  assert.equal(c.radarCooldownMs, 5 * 60_000);
  assert.equal(c.perkDurationMs, 15_000);
});

test('scaleCoreConfig: large field (L=1000) matches spec anchors', () => {
  const c = scaleCoreConfig(1_000_000); // 1000×1000m
  assert.equal(c.gameDurationMs, 60 * 60_000);
  assert.equal(c.hitRangeM, 100);
  assert.equal(c.radarCooldownMs, 15 * 60_000);
  assert.equal(c.perkDurationMs, 30_000);
});

test('scaleCoreConfig: beyond the large anchor stays at the ceiling (auto never exceeds it, unlike a manual override)', () => {
  const c = scaleCoreConfig(1_000_000_000); // L≈31,623
  assert.equal(c.gameDurationMs, 60 * 60_000);
  assert.equal(c.hitRangeM, 100);
  assert.equal(c.radarCooldownMs, 15 * 60_000);
  assert.equal(c.perkDurationMs, 30_000);
});

test('scaleCoreConfig: monotonic hiding/game duration + range with field size', () => {
  const a = scaleCoreConfig(40_000);     // L=200
  const b = scaleCoreConfig(4_000_000);  // L=2000
  assert.ok(b.hidingDurationMs >= a.hidingDurationMs);
  assert.ok(b.gameDurationMs >= a.gameDurationMs);
  assert.ok(b.hitRangeM >= a.hitRangeM);
});

test('scaleCoreConfig: every other perk cooldown is always exactly 1/3 of radar\'s', () => {
  for (const area of [400, 2_000, REF_AREA_M2, 1_000_000, 1_000_000_000]) {
    const c = scaleCoreConfig(area);
    assert.equal(c.droneCooldownMs, c.radarCooldownMs / 3);
    assert.equal(c.cloakCooldownMs, c.radarCooldownMs / 3);
    assert.equal(c.fakeMarkerCooldownMs, c.radarCooldownMs / 3);
    assert.equal(c.aufscheuchenCooldownMs, c.radarCooldownMs / 3);
    assert.equal(c.revealTrapCooldownMs, c.radarCooldownMs / 3);
  }
});

test('scaleCoreConfig: a short match never gets a cooldown longer than the match itself', () => {
  const tiny = scaleCoreConfig(400); // smallest field: gameDurationMs=300_000
  assert.ok(tiny.radarCooldownMs < tiny.gameDurationMs);
  assert.ok(tiny.droneCooldownMs < tiny.gameDurationMs);
  assert.ok(tiny.revealTrapCooldownMs < tiny.gameDurationMs);
});

test('scaleCoreConfig: hitHalfWidthM matches the "Normal" manual preset', () => {
  const ref = scaleCoreConfig(REF_AREA_M2);
  assert.ok(Math.abs(ref.hitHalfWidthM - 1) < 0.05);
});

test('scaleCoreConfig: hitHalfWidthM stays fixed regardless of field size (unlike hitRangeM)', () => {
  const tiny = scaleCoreConfig(2_000);
  const huge = scaleCoreConfig(1_000_000_000);
  assert.equal(tiny.hitHalfWidthM, 1);
  assert.equal(huge.hitHalfWidthM, 1);
});

test('scaleCoreConfig: hitRangeM stays within the 5-100m Scout range regardless of field size', () => {
  const tiny = scaleCoreConfig(400);
  const huge = scaleCoreConfig(1_000_000_000);
  assert.ok(tiny.hitRangeM >= 5);
  assert.ok(huge.hitRangeM <= 100);
});

test('zone: inside / outside', () => {
  const z = { id: 'z1', lat: MUC.lat, lon: MUC.lon, radiusM: 20 };
  assert.equal(isInZone(MUC, z), true);
  assert.equal(isInZone(destinationPoint(MUC, 0, 15), z), true);
  assert.equal(isInZone(destinationPoint(MUC, 0, 25), z), false);
});
