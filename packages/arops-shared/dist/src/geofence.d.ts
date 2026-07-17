import { LatLon, TelemetrySample, GeofenceStatus, PolygonValidationOptions, PolygonValidationResult, PlausibilityConfig } from './types';
/**
 * Validate a host-drawn playfield polygon.
 * Returns all violations at once (better host UX than failing one by one).
 */
export declare function validatePolygon(polygon: LatLon[], opts?: PolygonValidationOptions): PolygonValidationResult;
/**
 * Player position vs. playfield.
 * `warnDistanceM`: within this distance of the edge (while inside) → 'warning'.
 */
export declare function geofenceStatus(point: LatLon, polygon: LatLon[], warnDistanceM?: number): GeofenceStatus;
/** Speed between two telemetry samples in m/s (Infinity if timestamps equal). */
export declare function speedBetweenMps(a: TelemetrySample, b: TelemetrySample): number;
/**
 * Movement plausibility between two consecutive samples.
 * Short gaps are always accepted (GPS jitter dominates there);
 * for longer gaps the implied speed must stay below maxSpeedMps.
 * Building block for server-side spoof detection.
 */
export declare function isMovementPlausible(prev: TelemetrySample, next: TelemetrySample, cfg?: PlausibilityConfig): boolean;
/**
 * Sort polygon points by angle around their centroid.
 * Repairs self-intersecting polygons caused by arbitrary tap order —
 * correct for convex and star-shaped fields (the typical park/lot case).
 */
export declare function sortPolygonPoints(points: LatLon[]): LatLon[];
