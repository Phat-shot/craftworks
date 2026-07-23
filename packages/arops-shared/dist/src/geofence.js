"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sortPolygonPoints = exports.isMovementPlausible = exports.speedBetweenMps = exports.geofenceStatus = exports.validatePolygon = void 0;
// ═══════════════════════════════════════════════════════════
//  AR OPS — geofence + area validation + movement plausibility
// ═══════════════════════════════════════════════════════════
const geo_1 = require("./geo");
const types_1 = require("./types");
/**
 * Validate a host-drawn playfield polygon.
 * Returns all violations at once (better host UX than failing one by one).
 */
function validatePolygon(polygon, opts = types_1.DEFAULT_POLYGON_OPTIONS) {
    const errors = [];
    if (polygon.length < opts.minPoints) {
        errors.push('too_few_points');
        return { ok: false, errors, areaM2: 0 };
    }
    if ((0, geo_1.isSelfIntersecting)(polygon)) {
        errors.push('self_intersecting');
    }
    const areaM2 = (0, geo_1.polygonAreaM2)(polygon);
    if (areaM2 < opts.minAreaM2)
        errors.push('area_too_small');
    if (areaM2 > opts.maxAreaM2)
        errors.push('area_too_large');
    return { ok: errors.length === 0, errors, areaM2 };
}
exports.validatePolygon = validatePolygon;
/**
 * Player position vs. playfield.
 * `warnDistanceM`: within this distance of the edge (while inside) → 'warning'.
 */
function geofenceStatus(point, polygon, warnDistanceM = 10) {
    const inside = (0, geo_1.pointInPolygon)(point, polygon);
    const edgeDist = (0, geo_1.distanceToPolygonEdgeM)(point, polygon);
    if (!inside) {
        return { state: 'outside', signedDistanceM: -edgeDist };
    }
    return {
        state: edgeDist <= warnDistanceM ? 'warning' : 'inside',
        signedDistanceM: edgeDist,
    };
}
exports.geofenceStatus = geofenceStatus;
/** Speed between two telemetry samples in m/s (Infinity if timestamps equal). */
function speedBetweenMps(a, b) {
    const dtMs = Math.abs(b.ts - a.ts);
    if (dtMs === 0)
        return Infinity;
    return (0, geo_1.haversineMeters)(a, b) / (dtMs / 1000);
}
exports.speedBetweenMps = speedBetweenMps;
/**
 * Movement plausibility between two consecutive samples.
 * Short gaps are always accepted (GPS jitter dominates there);
 * for longer gaps the implied speed must stay below maxSpeedMps.
 * Building block for server-side spoof detection.
 */
function isMovementPlausible(prev, next, cfg = types_1.DEFAULT_PLAUSIBILITY) {
    const dtMs = Math.abs(next.ts - prev.ts);
    if (dtMs < cfg.minGapMs)
        return true;
    return speedBetweenMps(prev, next) <= cfg.maxSpeedMps;
}
exports.isMovementPlausible = isMovementPlausible;
/**
 * Sort polygon points by angle around their centroid.
 * Repairs self-intersecting polygons caused by arbitrary tap order —
 * correct for convex and star-shaped fields (the typical park/lot case).
 */
function sortPolygonPoints(points) {
    if (points.length < 3)
        return [...points];
    const cLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
    const cLon = points.reduce((s, p) => s + p.lon, 0) / points.length;
    return [...points].sort((a, b) => Math.atan2(a.lat - cLat, a.lon - cLon) - Math.atan2(b.lat - cLat, b.lon - cLon));
}
exports.sortPolygonPoints = sortPolygonPoints;
