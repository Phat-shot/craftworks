import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRandomZones } from '../src/timings';
import { destinationPoint, pointInPolygon, haversineMeters } from '../src/geo';
import { LatLon } from '../src/types';

const MUC: LatLon = { lat: 48.13743, lon: 11.57549 };
// 400x400m square field around MUC.
const FIELD = [0, 90, 180, 270].map(b => destinationPoint(MUC, b, 200));

test('generateRandomZones: all generated points are inside the polygon', () => {
  const zones = generateRandomZones(FIELD, 5, 20, 15);
  assert.ok(zones.length > 0, 'expected at least one zone to be placed');
  for (const z of zones) {
    assert.ok(pointInPolygon({ lat: z.lat, lon: z.lon }, FIELD), `zone ${z.id} should be inside the field`);
  }
});

test('generateRandomZones: every zone carries the requested radius and a unique id', () => {
  const zones = generateRandomZones(FIELD, 4, 15, 22);
  const ids = new Set(zones.map(z => z.id));
  assert.equal(ids.size, zones.length, 'zone ids must be unique');
  for (const z of zones) assert.equal(z.radiusM, 22);
});

test('generateRandomZones: pairwise separation is always respected', () => {
  const zones = generateRandomZones(FIELD, 6, 30, 10);
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const d = haversineMeters(zones[i]!, zones[j]!);
      assert.ok(d >= 30, `zones ${zones[i]!.id}/${zones[j]!.id} are ${d}m apart, expected >= 30m`);
    }
  }
});

test('generateRandomZones: asking for more zones than the field can fit yields a partial result, not an error', () => {
  // Absurdly large separation relative to field size — most attempts will fail.
  const zones = generateRandomZones(FIELD, 20, 350, 15);
  assert.ok(zones.length < 20, 'should not be able to fit 20 zones at 350m separation in a 400x400m field');
});

test('generateRandomZones: count=0 or invalid polygon yields an empty array, no throw', () => {
  assert.deepEqual(generateRandomZones(FIELD, 0, 20, 15), []);
  assert.deepEqual(generateRandomZones([], 3, 20, 15), []);
  assert.deepEqual(generateRandomZones([MUC, MUC], 3, 20, 15), []); // < 3 points, not a real polygon
});

test('generateRandomZones: deterministic-ish sanity — repeated calls stay within field bounds', () => {
  for (let i = 0; i < 10; i++) {
    const zones = generateRandomZones(FIELD, 3, 25, 15);
    for (const z of zones) {
      assert.ok(pointInPolygon({ lat: z.lat, lon: z.lon }, FIELD));
    }
  }
});
