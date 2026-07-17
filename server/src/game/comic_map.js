'use strict';
// ═══════════════════════════════════════════════════════════
//  AR OPS — "Comic map": real building/path/vegetation footprints
//  for the host-drawn field, fetched once from OpenStreetMap's free
//  Overpass API and cached in ar_settings. Nice-to-have visual
//  feature, never a gameplay dependency — network failures must
//  never break the lobby flow. Pure/network helpers only, no
//  socket/DB/auth deps, so this stays trivially unit-testable.
// ═══════════════════════════════════════════════════════════
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const COMIC_MAP_COOLDOWN_MS = 20_000;   // shared public infra — no spam-clicking
const COMIC_MAP_MAX_FEATURES = 500;      // payload guard for dense urban areas

function comicFeatureType(tags) {
  if (!tags) return null;
  if (tags.building) return 'building';
  if (tags.natural === 'water') return 'water';
  if (tags.natural === 'wood' || tags.landuse === 'forest') return 'forest';
  if (tags.landuse === 'grass' || tags.leisure === 'park') return 'grass';
  if (tags.highway) {
    return ['footway', 'path', 'track', 'pedestrian', 'steps'].includes(tags.highway) ? 'path' : 'road';
  }
  return null;
}

/** Pure: raw Overpass `elements` -> slim {type, points}[] for clients (no OSM tags). */
function reduceOverpassElements(elements) {
  const out = [];
  for (const el of elements || []) {
    if (out.length >= COMIC_MAP_MAX_FEATURES) break;
    const type = comicFeatureType(el?.tags);
    if (!type || !Array.isArray(el.geometry)) continue;
    const points = el.geometry
      .filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .map(p => ({ lat: Math.round(p.lat * 1e6) / 1e6, lon: Math.round(p.lon * 1e6) / 1e6 }));
    if (points.length < 2) continue;
    out.push({ type, points });
  }
  return out;
}

/** Bounding box (with small padding) covering all polygon points. */
function polygonBbox(polygon, paddingDeg = 0.0005) {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of polygon) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  return { south: minLat - paddingDeg, west: minLon - paddingDeg, north: maxLat + paddingDeg, east: maxLon + paddingDeg };
}

/** Fetch buildings/paths/vegetation for the field's bounding box from OSM Overpass.
 *  The public instance blocks/throttles requests without a descriptive
 *  User-Agent and a permissive Accept header (verified live during planning). */
async function fetchComicMapFeatures(polygon) {
  const { south, west, north, east } = polygonBbox(polygon);
  const bbox = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:15];(` +
    `way["building"](${bbox});` +
    `way["highway"](${bbox});` +
    `way["natural"="wood"](${bbox});` +
    `way["natural"="water"](${bbox});` +
    `way["landuse"="forest"](${bbox});` +
    `way["landuse"="grass"](${bbox});` +
    `way["leisure"="park"](${bbox});` +
    `);out geom;`;
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': '*/*',
      'User-Agent': 'craftworks-ar-ops/1.0',
    },
    body: 'data=' + encodeURIComponent(query),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`overpass_http_${res.status}`);
  const data = await res.json();
  return reduceOverpassElements(data.elements);
}

module.exports = {
  COMIC_MAP_COOLDOWN_MS,
  comicFeatureType, reduceOverpassElements, polygonBbox, fetchComicMapFeatures,
};
