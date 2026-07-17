import { LatLon } from './types';
export declare const EARTH_RADIUS_M = 6371008.8;
/** Great-circle distance in meters (haversine). */
export declare function haversineMeters(a: LatLon, b: LatLon): number;
/** Initial bearing from `from` to `to`, degrees 0–360 (0 = true north, 90 = east). */
export declare function bearingDeg(from: LatLon, to: LatLon): number;
/** Smallest absolute difference between two angles in degrees (0–180). */
export declare function angleDeltaDeg(a: number, b: number): number;
/** Destination point given start, initial bearing (deg) and distance (m). */
export declare function destinationPoint(origin: LatLon, bearing: number, distanceM: number): LatLon;
export interface XY {
    x: number;
    y: number;
}
/** Project a point to a local ENU-style plane centered on `origin` (meters). */
export declare function toLocalXY(p: LatLon, origin: LatLon): XY;
/** Ray-casting point-in-polygon on the local plane. Boundary counts as inside. */
export declare function pointInPolygon(point: LatLon, polygon: LatLon[]): boolean;
/** Polygon area in m² (shoelace on the local plane). Vertex order does not matter. */
export declare function polygonAreaM2(polygon: LatLon[]): number;
/** Distance from point to segment on the local plane (meters). */
export declare function pointSegmentDistance(p: XY, a: XY, b: XY): number;
/** Minimum distance from a point to the polygon boundary in meters (always ≥ 0). */
export declare function distanceToPolygonEdgeM(point: LatLon, polygon: LatLon[]): number;
/** True if segments p1q1 and p2q2 intersect (including touching). */
export declare function segmentsIntersect(p1: XY, q1: XY, p2: XY, q2: XY): boolean;
/** True if the polygon outline crosses itself (non-adjacent edges intersect). */
export declare function isSelfIntersecting(polygon: LatLon[]): boolean;
