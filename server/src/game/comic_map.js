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

/** Fetch buildings/paths/vegetation for an explicit bounding box from OSM
 *  Overpass. The public instance blocks/throttles requests without a
 *  descriptive User-Agent and a permissive Accept header (verified live
 *  during planning). */
async function fetchComicMapFeaturesForBbox({ south, west, north, east }) {
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
  let res;
  try {
    res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': '*/*',
        'User-Agent': 'craftworks-ar-ops/1.0',
      },
      body: 'data=' + encodeURIComponent(query),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    // Distinguish "Overpass took too long" from "couldn't reach Overpass at all"
    // — both look identical to the generic catch-all otherwise, and the actual
    // reason only ever showed up in server logs, never to the host in the lobby.
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new Error('overpass_timeout');
    throw new Error('overpass_network_error');
  }
  // The public instance is shared, free infra with a small (2 concurrent
  // requests) rate limit — 429/504 under load is expected, not exceptional.
  if (res.status === 429 || res.status === 504) throw new Error('overpass_rate_limited');
  if (!res.ok) throw new Error(`overpass_http_${res.status}`);
  const data = await res.json();
  return reduceOverpassElements(data.elements);
}

// ═══════════════════════════════════════════════════════════
//  SERVER-SIDE AREA CACHE (comic_map_cache table, see schema.sql)
//
//  Every lobby drawn in roughly the same physical spot (same park/field,
//  reused across matches) previously re-queried Overpass from scratch —
//  wasteful against a shared, rate-limited free public instance. Now: fetch
//  and store a bbox noticeably LARGER than the immediate field, so nearby
//  future lobbies are served entirely from the cache; only fetch fresh from
//  Overpass when no cached region fully covers what's needed.
// ═══════════════════════════════════════════════════════════

/** True if cached bbox `a` fully covers requested bbox `b`. */
function bboxContains(a, b) {
  return a.south <= b.south && a.west <= b.west && a.north >= b.north && a.east >= b.east;
}

/** Cached regions can be much larger than the current field — trim the
 *  response back down to just what's actually needed (any point of a
 *  feature inside the requested bbox keeps the whole feature). */
function filterFeaturesToBbox(features, bbox) {
  return features.filter(f => f.points.some(p =>
    p.lat >= bbox.south && p.lat <= bbox.north && p.lon >= bbox.west && p.lon <= bbox.east));
}

// Cache-fetch bbox = the field's own bbox, padded by a multiple of its own
// size — proportional so a tiny field doesn't cache a needlessly huge area
// and vice versa — but hard-capped so a huge field's query can't balloon
// into an enormous, slow (or truncated, see COMIC_MAP_MAX_FEATURES) Overpass
// request regardless.
const CACHE_EXPAND_FACTOR = 2;
const CACHE_MAX_PAD_DEG = 0.01; // ~1.1km at the equator

/** The (larger) bbox actually fetched from Overpass and stored in the cache
 *  for a given field polygon — exported for tests, not just internal use. */
function expandedCacheBbox(polygon) {
  const tight = polygonBbox(polygon);
  const latSpan = tight.north - tight.south;
  const lonSpan = tight.east - tight.west;
  const padLat = Math.min(latSpan * CACHE_EXPAND_FACTOR, CACHE_MAX_PAD_DEG);
  const padLon = Math.min(lonSpan * CACHE_EXPAND_FACTOR, CACHE_MAX_PAD_DEG);
  return {
    south: tight.south - padLat, west: tight.west - padLon,
    north: tight.north + padLat, east: tight.east + padLon,
  };
}

/** Main entry point for lobby:generate_comic_map — cache-aware in front of
 *  fetchComicMapFeaturesForBbox. `db` is passed in rather than required at
 *  module scope, keeping this file's own dependencies as they were (pure/
 *  network helpers, no implicit DB coupling — see file header). */
async function getCachedOrFetchComicMapFeatures(db, polygon) {
  const needed = polygonBbox(polygon);
  const { rows } = await db.query(
    `SELECT features FROM comic_map_cache
     WHERE south <= $1 AND west <= $2 AND north >= $3 AND east >= $4
     ORDER BY fetched_at DESC LIMIT 1`,
    [needed.south, needed.west, needed.north, needed.east]
  );
  if (rows[0]) {
    return filterFeaturesToBbox(rows[0].features, needed);
  }
  const cacheBbox = expandedCacheBbox(polygon);
  const features = await fetchComicMapFeaturesForBbox(cacheBbox);
  await db.query(
    `INSERT INTO comic_map_cache (south, west, north, east, features) VALUES ($1,$2,$3,$4,$5)`,
    [cacheBbox.south, cacheBbox.west, cacheBbox.north, cacheBbox.east, JSON.stringify(features)]
  ).catch(e => console.error('comic_map_cache insert failed:', e.message)); // cache write is best-effort, never blocks returning the map
  return filterFeaturesToBbox(features, needed);
}

module.exports = {
  COMIC_MAP_COOLDOWN_MS,
  comicFeatureType, reduceOverpassElements, polygonBbox, fetchComicMapFeaturesForBbox,
  bboxContains, filterFeaturesToBbox, expandedCacheBbox, getCachedOrFetchComicMapFeatures,
};
