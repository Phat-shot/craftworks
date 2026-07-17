// ═══════════════════════════════════════════════════════════
//  AR OPS — geofence + area validation + movement plausibility
// ═══════════════════════════════════════════════════════════
import {
  pointInPolygon, polygonAreaM2, distanceToPolygonEdgeM,
  isSelfIntersecting, haversineMeters,
} from './geo';
import {
  LatLon, TelemetrySample,
  GeofenceStatus, PolygonValidationOptions, PolygonValidationResult,
  PolygonValidationError, DEFAULT_POLYGON_OPTIONS,
  PlausibilityConfig, DEFAULT_PLAUSIBILITY,
} from './types';

/**
 * Validate a host-drawn playfield polygon.
 * Returns all violations at once (better host UX than failing one by one).
 */
export function validatePolygon(
  polygon: LatLon[],
  opts: PolygonValidationOptions = DEFAULT_POLYGON_OPTIONS
): PolygonValidationResult {
  const errors: PolygonValidationError[] = [];

  if (polygon.length < opts.minPoints) {
    errors.push('too_few_points');
    return { ok: false, errors, areaM2: 0 };
  }
  if (isSelfIntersecting(polygon)) {
    errors.push('self_intersecting');
  }
  const areaM2 = polygonAreaM2(polygon);
  if (areaM2 < opts.minAreaM2) errors.push('area_too_small');
  if (areaM2 > opts.maxAreaM2) errors.push('area_too_large');

  return { ok: errors.length === 0, errors, areaM2 };
}

/**
 * Player position vs. playfield.
 * `warnDistanceM`: within this distance of the edge (while inside) → 'warning'.
 */
export function geofenceStatus(
  point: LatLon,
  polygon: LatLon[],
  warnDistanceM = 10
): GeofenceStatus {
  const inside = pointInPolygon(point, polygon);
  const edgeDist = distanceToPolygonEdgeM(point, polygon);
  if (!inside) {
    return { state: 'outside', signedDistanceM: -edgeDist };
  }
  return {
    state: edgeDist <= warnDistanceM ? 'warning' : 'inside',
    signedDistanceM: edgeDist,
  };
}

/** Speed between two telemetry samples in m/s (Infinity if timestamps equal). */
export function speedBetweenMps(a: TelemetrySample, b: TelemetrySample): number {
  const dtMs = Math.abs(b.ts - a.ts);
  if (dtMs === 0) return Infinity;
  return haversineMeters(a, b) / (dtMs / 1000);
}

/**
 * Movement plausibility between two consecutive samples.
 * Short gaps are always accepted (GPS jitter dominates there);
 * for longer gaps the implied speed must stay below maxSpeedMps.
 * Building block for server-side spoof detection.
 */
export function isMovementPlausible(
  prev: TelemetrySample,
  next: TelemetrySample,
  cfg: PlausibilityConfig = DEFAULT_PLAUSIBILITY
): boolean {
  const dtMs = Math.abs(next.ts - prev.ts);
  if (dtMs < cfg.minGapMs) return true;
  return speedBetweenMps(prev, next) <= cfg.maxSpeedMps;
}

/**
 * Sort polygon points by angle around their centroid.
 * Repairs self-intersecting polygons caused by arbitrary tap order —
 * correct for convex and star-shaped fields (the typical park/lot case).
 */
export function sortPolygonPoints(points: LatLon[]): LatLon[] {
  if (points.length < 3) return [...points];
  const cLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const cLon = points.reduce((s, p) => s + p.lon, 0) / points.length;
  return [...points].sort((a, b) =>
    Math.atan2(a.lat - cLat, a.lon - cLon) - Math.atan2(b.lat - cLat, b.lon - cLon));
}
