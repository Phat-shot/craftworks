'use strict';
// ═══════════════════════════════════════════════════════════
//  AR OPS — "Comic map": procedurally generated toy-town overlay
//  (buildings/roads/paths/forest/water/grass) for the host-drawn field.
//  Fully local, deterministic, no network, no DB. Replaces the previous
//  OpenStreetMap Overpass-based fetch+cache, which could get permanently
//  stuck serving a stale, sparse dataset for any field drawn inside an
//  old, much larger field's cached bounding box (that older fetch got
//  capped at a fixed feature count and cached under an expanded bbox
//  that any smaller later field would keep matching forever). Pure
//  geometry only, no socket/DB deps, so this stays trivially unit-testable.
// ═══════════════════════════════════════════════════════════
const { toLocalXY, destinationPoint, polygonAreaM2 } = require('@craftworks/arops-shared');

const round6 = v => Math.round(v * 1e6) / 1e6;

/** FNV-1a 32-bit hash over the polygon's own coordinates (fixed-precision
 *  formatting avoids float-representation nondeterminism) — the default
 *  seed source, so a redrawn/re-requested identical field always gets the
 *  same layout. `generateComicMapFeatures`'s `opts.seed` can override this
 *  later (e.g. a future "regenerate with a fresh layout" action) without
 *  any change to this function. */
function polygonSeed(polygon) {
  let h = 0x811c9dc5; // FNV-1a basis
  for (const p of polygon) {
    const s = `${p.lat.toFixed(7)},${p.lon.toFixed(7)};`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

/** Small local PRNG (mulberry32) — duplicated rather than importing (see
 *  packages/arops-shared/src/simScript.ts's own copy of the same ~8-line,
 *  well-known algorithm); not worth a shared-package export + rebuild step
 *  for something this stable and self-contained. */
function mulberry32(seed) {
  let s = seed | 0;
  return function next() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function centroid(polygon) {
  let lat = 0, lon = 0;
  for (const p of polygon) { lat += p.lat; lon += p.lon; }
  return { lat: lat / polygon.length, lon: lon / polygon.length };
}

/** Ray-casting point-in-polygon directly on local XY meters (no per-call
 *  LatLon re-projection) — used in the hot inner loops below (grid-line
 *  clipping, blob-center rejection sampling), which can run thousands of
 *  times for a large field. Same ray-cast core as arops-shared's
 *  pointInPolygon, minus its boundary-epsilon special case (irrelevant
 *  here — generated sample points are never exactly on an edge). */
function pointInPolygonXY(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const vi = poly[i], vj = poly[j];
    const intersects = (vi.y > pt.y) !== (vj.y > pt.y) &&
      pt.x < ((vj.x - vi.x) * (pt.y - vi.y)) / (vj.y - vi.y) + vi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function localBoundingBox(localPolygon) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of localPolygon) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

/** Local XY meters (relative to `origin`) -> {lat, lon}, via bearing+distance
 *  (arops-shared's destinationPoint). Mixes a forward equirectangular
 *  projection (toLocalXY) with a spherical inverse — both are documented in
 *  arops-shared as accurate to <0.1% at playfield scale, plenty for a
 *  decorative layer, and it means no new geometry math needs to be written. */
function toLatLon(origin, xy) {
  const distanceM = Math.hypot(xy.x, xy.y);
  if (distanceM < 1e-9) return { lat: round6(origin.lat), lon: round6(origin.lon) };
  const bearingDeg = (Math.atan2(xy.x, xy.y) * 180 / Math.PI + 360) % 360; // x=east,y=north matches destinationPoint's 0=N,90=E
  const ll = destinationPoint(origin, bearingDeg, distanceM);
  return { lat: round6(ll.lat), lon: round6(ll.lon) };
}

// ── Street grid ──────────────────────────────────────────────

/** Longest polygon edge's bearing, folded into [0,90) — used to bias the
 *  grid rotation so a thin/elongated field doesn't get an unlucky
 *  near-perpendicular grid that would clip almost every line away. */
function dominantEdgeBearingMod90(localPolygon) {
  let bestLen = -1, bestAngleDeg = 0;
  for (let i = 0; i < localPolygon.length; i++) {
    const a = localPolygon[i], b = localPolygon[(i + 1) % localPolygon.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len > bestLen) { bestLen = len; bestAngleDeg = Math.atan2(dy, dx) * 180 / Math.PI; }
  }
  return ((bestAngleDeg % 90) + 90) % 90;
}

/** A rotated (u,v) frame covering the polygon's local bbox — `u`/`v` are the
 *  grid's own axes (not necessarily north/east), used for both block and
 *  road-line generation so they share exactly one grid definition. */
function buildGridFrame(bbox, rotationDeg) {
  const rot = rotationDeg * Math.PI / 180;
  const ux = Math.cos(rot), uy = Math.sin(rot), vx = -uy, vy = ux;
  const corners = [
    { x: bbox.minX, y: bbox.minY }, { x: bbox.maxX, y: bbox.minY },
    { x: bbox.minX, y: bbox.maxY }, { x: bbox.maxX, y: bbox.maxY },
  ];
  const uVals = corners.map(c => c.x * ux + c.y * uy);
  const vVals = corners.map(c => c.x * vx + c.y * vy);
  return {
    ux, uy, vx, vy,
    uMin: Math.min(...uVals), uMax: Math.max(...uVals),
    vMin: Math.min(...vVals), vMax: Math.max(...vVals),
  };
}
const uvToXY = (u, v, f) => ({ x: u * f.ux + v * f.vx, y: u * f.uy + v * f.vy });

/** Grid cells ("city blocks") whose center falls inside the field —
 *  buildings get placed one block at a time. */
function buildBlocks(frame, blockSizeM, localPolygon) {
  const uStart = Math.floor(frame.uMin / blockSizeM) * blockSizeM;
  const vStart = Math.floor(frame.vMin / blockSizeM) * blockSizeM;
  const blocks = [];
  for (let u = uStart; u < frame.uMax; u += blockSizeM) {
    for (let v = vStart; v < frame.vMax; v += blockSizeM) {
      const c = uvToXY(u + blockSizeM / 2, v + blockSizeM / 2, frame);
      if (pointInPolygonXY(c, localPolygon)) blocks.push({ u0: u, v0: v, u1: u + blockSizeM, v1: v + blockSizeM });
    }
  }
  return blocks;
}

/** Walks a single grid line (fixed `off` along the perpendicular axis) in
 *  small steps, keeping only the run(s) that fall inside the polygon —
 *  deliberately simple fine-step sampling rather than full polygon-clip
 *  geometry, since a decorative comic map doesn't need pixel-perfect edges. */
function clipLineToPolygon(off, ax, ay, bx, by, tMin, tMax, step, localPolygon, out, kind) {
  let runStart = null, prevPt = null;
  for (let t = tMin; t <= tMax + step; t += step) {
    const pt = { x: off * ax + t * bx, y: off * ay + t * by };
    const inside = pointInPolygonXY(pt, localPolygon);
    if (inside && runStart === null) runStart = pt;
    if (!inside && runStart !== null) { out.push({ a: runStart, b: prevPt, kind }); runStart = null; }
    prevPt = pt;
  }
  if (runStart !== null && prevPt !== null) out.push({ a: runStart, b: prevPt, kind });
}

/** Grid lines = block boundaries, clipped to the polygon. Every 3rd line
 *  renders as a wider 'road', the rest as 'path' — cheap visual hierarchy. */
function buildRoads(frame, blockSizeM, localPolygon) {
  const segments = [];
  const step = Math.max(2, blockSizeM / 12);
  const MIN_ROAD_LEN_M = 5;
  let k = 0;
  for (let u = Math.floor(frame.uMin / blockSizeM) * blockSizeM; u <= frame.uMax; u += blockSizeM, k++) {
    clipLineToPolygon(u, frame.ux, frame.uy, frame.vx, frame.vy, frame.vMin, frame.vMax, step, localPolygon, segments, k % 3 === 0 ? 'road' : 'path');
  }
  k = 0;
  for (let v = Math.floor(frame.vMin / blockSizeM) * blockSizeM; v <= frame.vMax; v += blockSizeM, k++) {
    clipLineToPolygon(v, frame.vx, frame.vy, frame.ux, frame.uy, frame.uMin, frame.uMax, step, localPolygon, segments, k % 3 === 0 ? 'road' : 'path');
  }
  return segments.filter(s => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) >= MIN_ROAD_LEN_M);
}

// ── Buildings ────────────────────────────────────────────────

/** 1-3 grid-aligned rectangular footprints per block, inset from its edges.
 *  A building is dropped entirely (not shrunk/clipped) if any corner falls
 *  outside the polygon — corner/edge blocks just end up with fewer buildings. */
function placeBuildings(block, frame, blockSizeM, rand, localPolygon) {
  const out = [];
  const n = 1 + Math.floor(rand() * 3);
  const margin = blockSizeM * 0.15;
  for (let i = 0; i < n; i++) {
    const w = 6 + rand() * Math.max(0, blockSizeM * 0.4 - 6);
    const h = 6 + rand() * Math.max(0, blockSizeM * 0.4 - 6);
    const availU = Math.max(0, (block.u1 - block.u0) - 2 * margin - w);
    const availV = Math.max(0, (block.v1 - block.v0) - 2 * margin - h);
    const u0 = block.u0 + margin + rand() * availU;
    const v0 = block.v0 + margin + rand() * availV;
    const corners = [[u0, v0], [u0 + w, v0], [u0 + w, v0 + h], [u0, v0 + h]].map(([u, v]) => uvToXY(u, v, frame));
    if (corners.every(c => pointInPolygonXY(c, localPolygon))) out.push(corners);
  }
  return out;
}

// ── Vegetation / water blobs ─────────────────────────────────

function pickBlobType(r) { return r < 0.45 ? 'grass' : r < 0.80 ? 'forest' : 'water'; }

function sampleInsidePoint(bbox, localPolygon, rand, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const x = bbox.minX + rand() * (bbox.maxX - bbox.minX);
    const y = bbox.minY + rand() * (bbox.maxY - bbox.minY);
    if (pointInPolygonXY({ x, y }, localPolygon)) return { x, y };
  }
  return null;
}

/** A wobbly closed ring around `center` — per-vertex radius jitter instead
 *  of a perfect circle, for a hand-drawn "comic" look. */
function generateBlobRing(center, baseRadiusM, rand) {
  const vertexCount = 8 + Math.floor(rand() * 4);
  const points = [];
  for (let i = 0; i < vertexCount; i++) {
    const angle = (i / vertexCount) * 2 * Math.PI;
    const r = baseRadiusM * (0.6 + rand() * 0.8);
    points.push({ x: center.x + r * Math.cos(angle), y: center.y + r * Math.sin(angle) });
  }
  points.push(points[0]); // close the ring
  return points;
}

// ── Assembly ─────────────────────────────────────────────────

// Targets a roughly CONSTANT total block count for any field size — block
// size grows with the field instead of block count growing unboundedly.
// This is what structurally bounds feature count for huge fields without
// truncating anything after the fact (the old Overpass path's bug class).
const TARGET_BLOCK_COUNT = 400;
const BLOCK_SIZE_MIN_M = 22;
const TARGET_AREA_PER_PATCH = 900; // ~30x30m per vegetation/water patch
const MAX_PATCHES = 60;

/** Pure, synchronous, deterministic: same polygon (+ same/omitted seed) ->
 *  same generated map. No network, no DB — this is the whole point of the
 *  rewrite (see file header). `polygon` is assumed already valid/simple
 *  (>=3 points, >=400m^2) — the socket layer validates this before ever
 *  calling in here; the only defensive guard kept is the trivial
 *  fewer-than-3-points early-out, in case a test or future caller invokes
 *  this directly. `opts.seed`, if given, overrides the polygon-derived
 *  default (a future "regenerate with a fresh layout" action would just
 *  pass a random/time-based seed here). */
function generateComicMapFeatures(polygon, opts = {}) {
  if (!Array.isArray(polygon) || polygon.length < 3) return [];

  const origin = centroid(polygon);
  const localPolygon = polygon.map(p => toLocalXY(p, origin));
  const bbox = localBoundingBox(localPolygon);
  const areaM2 = polygonAreaM2(polygon);
  const extentM = Math.max(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);

  const seed = Number.isFinite(opts.seed) ? (opts.seed >>> 0) : polygonSeed(polygon);
  // Independent sub-streams per phase so adding/tweaking one phase's logic
  // doesn't reshuffle another phase's random-call sequence.
  const gridRand = mulberry32(seed ^ 0x9e3779b9);
  const buildingRand = mulberry32(seed ^ 0x243f6a88);
  const vegRand = mulberry32(seed ^ 0xb7e15162);

  const blockSizeM = Math.max(BLOCK_SIZE_MIN_M, extentM / Math.sqrt(TARGET_BLOCK_COUNT));
  const rotationDeg = dominantEdgeBearingMod90(localPolygon) + (gridRand() * 20 - 10);
  const frame = buildGridFrame(bbox, rotationDeg);

  const blocks = buildBlocks(frame, blockSizeM, localPolygon);
  const roads = buildRoads(frame, blockSizeM, localPolygon);

  const buildings = [];
  for (const block of blocks) buildings.push(...placeBuildings(block, frame, blockSizeM, buildingRand, localPolygon));
  // Guaranteed non-empty: a pathological tiny/thin field where every block/
  // corner check fails still gets exactly one building at the centroid.
  if (buildings.length === 0) {
    const size = Math.min(8, Math.sqrt(areaM2) * 0.3);
    const half = size / 2;
    buildings.push([{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }]);
  }

  const patchCount = Math.max(1, Math.min(MAX_PATCHES, Math.round(areaM2 / TARGET_AREA_PER_PATCH)));
  const blobRadiusM = Math.max(6, Math.min(45, Math.sqrt(areaM2) * 0.03));
  const blobs = [];
  for (let i = 0; i < patchCount; i++) {
    const center = sampleInsidePoint(bbox, localPolygon, vegRand);
    if (!center) continue;
    blobs.push({ type: pickBlobType(vegRand()), ring: generateBlobRing(center, blobRadiusM, vegRand) });
  }

  const features = [];
  for (const seg of roads) features.push({ type: seg.kind, points: [seg.a, seg.b].map(pt => toLatLon(origin, pt)) });
  for (const corners of buildings) features.push({ type: 'building', points: corners.map(pt => toLatLon(origin, pt)) });
  for (const blob of blobs) features.push({ type: blob.type, points: blob.ring.map(pt => toLatLon(origin, pt)) });
  return features;
}

module.exports = {
  polygonSeed,
  generateComicMapFeatures,
};
