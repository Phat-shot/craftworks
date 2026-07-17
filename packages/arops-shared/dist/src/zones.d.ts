import { LatLon } from './types';
export interface Zone {
    id: string;
    lat: number;
    lon: number;
    radiusM: number;
}
export declare function isInZone(point: LatLon, zone: Zone): boolean;
/** Negative = inside (meters past the rim), positive = outside. */
export declare function distanceToZoneM(point: LatLon, zone: Zone): number;
export interface FieldMetrics {
    /** Longest distance between any two polygon vertices (meters). */
    diagonalM: number;
}
export declare function fieldMetrics(polygon: LatLon[]): FieldMetrics;
/** Reference field: 300 m diagonal (≈ city park). */
export declare const REFERENCE_DIAGONAL_M = 300;
/**
 * Timing scale factor for a field. Never shrinks timings below the
 * reference values (floor 1), caps at 3x for huge fields.
 */
export declare function timingScale(diagonalM: number): number;
/** Scale a base duration, rounded UP to whole seconds ("eher länger"). */
export declare function scaledMs(baseMs: number, scale: number): number;
export type ZoneValidationError = 'outside_field' | 'zones_too_close' | 'too_many_zones';
export interface ZoneValidationResult {
    ok: boolean;
    errors: ZoneValidationError[];
}
/**
 * Validate host-placed zones: all inside the field, pairwise separation
 * of at least 3x radius (so zones do not overlap into trivial multi-caps).
 */
export declare function validateZones(zones: Zone[], polygon: LatLon[], maxZones?: number): ZoneValidationResult;
