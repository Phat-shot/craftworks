import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineMeters, bearingDeg, angleDeltaDeg, destinationPoint,
  pointInPolygon, polygonAreaM2, distanceToPolygonEdgeM,
  isSelfIntersecting, EARTH_RADIUS_M,
} from '../src/geo';
import { LatLon } from '../src/types';

// Reference location: Munich Marienplatz
const MUC: LatLon = { lat: 48.13743, lon: 11.57549 };

function approx(actual: number, expected: number, tolerance: number, msg?: string) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    msg ?? `expected ${actual} ≈ ${expected} (±${tolerance})`
  );
}

// ── haversine ───────────────────────────────────────────────

test('haversine: zero distance', () => {
  assert.equal(haversineMeters(MUC, MUC), 0);
});

test('haversine: 1° latitude ≈ 111.19 km (sphere)', () => {
  const a: LatLon = { lat: 0, lon: 0 };
  const b: LatLon = { lat: 1, lon: 0 };
  const expected = (Math.PI * EARTH_RADIUS_M) / 180; // exact on sphere
  approx(haversineMeters(a, b), expected, 1);
});

test('haversine: 1° longitude at 60°N is half of equator value', () => {
  const eq = haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
  const n60 = haversineMeters({ lat: 60, lon: 0 }, { lat: 60, lon: 1 });
  approx(n60, eq / 2, eq * 0.005); // cos(60°) = 0.5
});

test('haversine: symmetric', () => {
  const b: LatLon = { lat: 48.2, lon: 11.6 };
  approx(haversineMeters(MUC, b), haversineMeters(b, MUC), 1e-9);
});

// ── bearing ─────────────────────────────────────────────────

test('bearing: due north = 0°', () => {
  approx(bearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 0, 1e-9);
});

test('bearing: due east = 90° (at equator)', () => {
  approx(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }), 90, 1e-9);
});

test('bearing: due south = 180°', () => {
  approx(bearingDeg({ lat: 1, lon: 0 }, { lat: 0, lon: 0 }), 180, 1e-9);
});

test('bearing: due west = 270°', () => {
  approx(bearingDeg({ lat: 0, lon: 1 }, { lat: 0, lon: 0 }), 270, 1e-9);
});

// ── angleDelta ──────────────────────────────────────────────

test('angleDelta: basic and wraparound', () => {
  assert.equal(angleDeltaDeg(10, 20), 10);
  assert.equal(angleDeltaDeg(350, 10), 20);   // wraps through 0
  assert.equal(angleDeltaDeg(0, 180), 180);
  assert.equal(angleDeltaDeg(90, 270), 180);
  assert.equal(angleDeltaDeg(45, 45), 0);
  assert.equal(angleDeltaDeg(359, 1), 2);
});

// ── destinationPoint (roundtrip properties) ─────────────────

test('destination: roundtrip distance and bearing', () => {
  for (const brg of [0, 45, 137, 233, 359]) {
    const dest = destinationPoint(MUC, brg, 500);
    approx(haversineMeters(MUC, dest), 500, 0.01, `distance for bearing ${brg}`);
    // Compare angles wraparound-aware (359.9999° ≡ 0°)
    approx(angleDeltaDeg(bearingDeg(MUC, dest), brg), 0, 0.01, `bearing for ${brg}`);
  }
});

// ── polygon: 100m square around MUC ─────────────────────────

function squareAround(center: LatLon, halfSideM: number): LatLon[] {
  // Build via destination points: NE, SE, SW, NW corners
  const n = destinationPoint(center, 0, halfSideM);
  const s = destinationPoint(center, 180, halfSideM);
  const ne = destinationPoint(n, 90, halfSideM);
  const nw = destinationPoint(n, 270, halfSideM);
  const se = destinationPoint(s, 90, halfSideM);
  const sw = destinationPoint(s, 270, halfSideM);
  return [ne, se, sw, nw];
}

test('pointInPolygon: center inside, far point outside', () => {
  const sq = squareAround(MUC, 50); // 100×100 m
  assert.equal(pointInPolygon(MUC, sq), true);
  const far = destinationPoint(MUC, 90, 500);
  assert.equal(pointInPolygon(far, sq), false);
});

test('pointInPolygon: just inside / just outside the edge', () => {
  const sq = squareAround(MUC, 50);
  const nearInside = destinationPoint(MUC, 0, 48);   // 2m inside north edge
  const nearOutside = destinationPoint(MUC, 0, 52);  // 2m outside
  assert.equal(pointInPolygon(nearInside, sq), true);
  assert.equal(pointInPolygon(nearOutside, sq), false);
});

test('polygonArea: 100×100m square ≈ 10,000 m²', () => {
  const sq = squareAround(MUC, 50);
  approx(polygonAreaM2(sq), 10_000, 30); // <0.3% projection error
});

test('polygonArea: vertex order independent', () => {
  const sq = squareAround(MUC, 50);
  const rev = [...sq].reverse();
  approx(polygonAreaM2(sq), polygonAreaM2(rev), 1e-6);
});

test('distanceToPolygonEdge: center of 100m square = 50m', () => {
  const sq = squareAround(MUC, 50);
  approx(distanceToPolygonEdgeM(MUC, sq), 50, 0.5);
});

test('distanceToPolygonEdge: outside point', () => {
  const sq = squareAround(MUC, 50);
  const out = destinationPoint(MUC, 0, 80); // 30m past north edge
  approx(distanceToPolygonEdgeM(out, sq), 30, 0.5);
});

// ── self-intersection ───────────────────────────────────────

test('selfIntersecting: square is fine, bowtie is not', () => {
  const sq = squareAround(MUC, 50);
  assert.equal(isSelfIntersecting(sq), false);

  // Bowtie: swap two vertices so edges cross
  const bowtie = [sq[0]!, sq[1]!, sq[3]!, sq[2]!];
  assert.equal(isSelfIntersecting(bowtie), true);
});

test('selfIntersecting: triangle can never self-intersect', () => {
  const tri = [
    MUC,
    destinationPoint(MUC, 90, 100),
    destinationPoint(MUC, 0, 100),
  ];
  assert.equal(isSelfIntersecting(tri), false);
});
