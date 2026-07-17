"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EARTH_RADIUS_M = void 0;
exports.haversineMeters = haversineMeters;
exports.bearingDeg = bearingDeg;
exports.angleDeltaDeg = angleDeltaDeg;
exports.destinationPoint = destinationPoint;
exports.toLocalXY = toLocalXY;
exports.pointInPolygon = pointInPolygon;
exports.polygonAreaM2 = polygonAreaM2;
exports.pointSegmentDistance = pointSegmentDistance;
exports.distanceToPolygonEdgeM = distanceToPolygonEdgeM;
exports.segmentsIntersect = segmentsIntersect;
exports.isSelfIntersecting = isSelfIntersecting;
exports.EARTH_RADIUS_M = 6371008.8;
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
/** Great-circle distance in meters (haversine). */
function haversineMeters(a, b) {
    const phi1 = a.lat * DEG2RAD;
    const phi2 = b.lat * DEG2RAD;
    const dPhi = (b.lat - a.lat) * DEG2RAD;
    const dLam = (b.lon - a.lon) * DEG2RAD;
    const s = Math.sin(dPhi / 2) ** 2 +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
    return 2 * exports.EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}
/** Initial bearing from `from` to `to`, degrees 0–360 (0 = true north, 90 = east). */
function bearingDeg(from, to) {
    const phi1 = from.lat * DEG2RAD;
    const phi2 = to.lat * DEG2RAD;
    const dLam = (to.lon - from.lon) * DEG2RAD;
    const y = Math.sin(dLam) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) -
        Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLam);
    return (Math.atan2(y, x) * RAD2DEG + 360) % 360;
}
/** Smallest absolute difference between two angles in degrees (0–180). */
function angleDeltaDeg(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
}
/** Destination point given start, initial bearing (deg) and distance (m). */
function destinationPoint(origin, bearing, distanceM) {
    const delta = distanceM / exports.EARTH_RADIUS_M;
    const theta = bearing * DEG2RAD;
    const phi1 = origin.lat * DEG2RAD;
    const lam1 = origin.lon * DEG2RAD;
    const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) +
        Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
    const lam2 = lam1 +
        Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
    return {
        lat: phi2 * RAD2DEG,
        lon: ((lam2 * RAD2DEG + 540) % 360) - 180,
    };
}
/** Project a point to a local ENU-style plane centered on `origin` (meters). */
function toLocalXY(p, origin) {
    return {
        x: (p.lon - origin.lon) * DEG2RAD * exports.EARTH_RADIUS_M * Math.cos(origin.lat * DEG2RAD),
        y: (p.lat - origin.lat) * DEG2RAD * exports.EARTH_RADIUS_M,
    };
}
/** Ray-casting point-in-polygon on the local plane. Boundary counts as inside. */
function pointInPolygon(point, polygon) {
    if (polygon.length < 3)
        return false;
    const origin = polygon[0];
    const pt = toLocalXY(point, origin);
    const poly = polygon.map(v => toLocalXY(v, origin));
    // Boundary check first (within epsilon of an edge = inside)
    const EPS = 1e-9;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        if (pointSegmentDistance(pt, a, b) < EPS)
            return true;
    }
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const vi = poly[i];
        const vj = poly[j];
        const intersects = (vi.y > pt.y) !== (vj.y > pt.y) &&
            pt.x < ((vj.x - vi.x) * (pt.y - vi.y)) / (vj.y - vi.y) + vi.x;
        if (intersects)
            inside = !inside;
    }
    return inside;
}
/** Polygon area in m² (shoelace on the local plane). Vertex order does not matter. */
function polygonAreaM2(polygon) {
    if (polygon.length < 3)
        return 0;
    const origin = polygon[0];
    const poly = polygon.map(v => toLocalXY(v, origin));
    let sum = 0;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
}
/** Distance from point to segment on the local plane (meters). */
function pointSegmentDistance(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const len2 = abx * abx + aby * aby;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / len2));
    const cx = a.x + t * abx;
    const cy = a.y + t * aby;
    return Math.hypot(p.x - cx, p.y - cy);
}
/** Minimum distance from a point to the polygon boundary in meters (always ≥ 0). */
function distanceToPolygonEdgeM(point, polygon) {
    if (polygon.length < 2)
        return Infinity;
    const origin = polygon[0];
    const pt = toLocalXY(point, origin);
    const poly = polygon.map(v => toLocalXY(v, origin));
    let min = Infinity;
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        min = Math.min(min, pointSegmentDistance(pt, a, b));
    }
    return min;
}
// ── Segment intersection (for self-intersection validation) ──
function orientation(p, q, r) {
    const v = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
    if (Math.abs(v) < 1e-12)
        return 0;
    return v > 0 ? 1 : 2;
}
function onSegment(p, q, r) {
    return (q.x <= Math.max(p.x, r.x) + 1e-12 &&
        q.x >= Math.min(p.x, r.x) - 1e-12 &&
        q.y <= Math.max(p.y, r.y) + 1e-12 &&
        q.y >= Math.min(p.y, r.y) - 1e-12);
}
/** True if segments p1q1 and p2q2 intersect (including touching). */
function segmentsIntersect(p1, q1, p2, q2) {
    const o1 = orientation(p1, q1, p2);
    const o2 = orientation(p1, q1, q2);
    const o3 = orientation(p2, q2, p1);
    const o4 = orientation(p2, q2, q1);
    if (o1 !== o2 && o3 !== o4)
        return true;
    if (o1 === 0 && onSegment(p1, p2, q1))
        return true;
    if (o2 === 0 && onSegment(p1, q2, q1))
        return true;
    if (o3 === 0 && onSegment(p2, p1, q2))
        return true;
    if (o4 === 0 && onSegment(p2, q1, q2))
        return true;
    return false;
}
/** True if the polygon outline crosses itself (non-adjacent edges intersect). */
function isSelfIntersecting(polygon) {
    const n = polygon.length;
    if (n < 4)
        return false; // triangle cannot self-intersect
    const origin = polygon[0];
    const poly = polygon.map(v => toLocalXY(v, origin));
    for (let i = 0; i < n; i++) {
        const a1 = poly[i];
        const a2 = poly[(i + 1) % n];
        for (let j = i + 1; j < n; j++) {
            // Skip adjacent edges (they legitimately share a vertex)
            if (j === i || (j + 1) % n === i || (i + 1) % n === j)
                continue;
            const b1 = poly[j];
            const b2 = poly[(j + 1) % n];
            if (segmentsIntersect(a1, a2, b1, b2))
                return true;
        }
    }
    return false;
}
