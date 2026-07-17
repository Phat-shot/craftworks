export interface ModeTimings {
    /** Radius of bases / capture zones / bomb sites. */
    zoneRadiusM: number;
    /** Freeze after being hit (team modes). */
    freezeMs: number;
    /** Moving further than this from the freeze anchor extends the freeze. */
    freezeMoveToleranceM: number;
    /** Extension applied per movement violation. */
    freezeExtensionMs: number;
    /** CTF phase 1: time to place the team base. */
    baseSettingMs: number;
    /** CTF: dwell time in enemy base / at dropped flag to pick it up. */
    flagPickupDwellMs: number;
    /** CTF: dropped flag auto-returns after this. */
    flagReturnMs: number;
    /** CTF: minimum distance between the two bases. */
    minBaseSeparationM: number;
    /** Domination: dwell to capture a zone. */
    captureDwellMs: number;
    /** S&D: dwell to plant. */
    plantDwellMs: number;
    /** S&D: dwell to defuse. */
    defuseDwellMs: number;
    /** S&D: time from plant to detonation. */
    bombTimerMs: number;
}
/** Compute all mode timings from the playfield area. */
export declare function scaleTimings(areaM2: number): ModeTimings;
import { LatLon } from './types';
export interface Zone {
    id: string;
    lat: number;
    lon: number;
    radiusM: number;
}
export declare function isInZone(p: LatLon, z: Zone): boolean;
/** Negative = inside (meters past the rim), positive = outside. */
export declare function distanceToZoneM(p: LatLon, z: Zone): number;
export type ZoneValidationError = 'outside_field' | 'zones_too_close' | 'too_many_zones';
export interface ZoneValidationResult {
    ok: boolean;
    errors: ZoneValidationError[];
}
/**
 * Validate host-placed zones: all inside the field, pairwise separation
 * ≥ 1.5x combined radii (no overlapping trivial multi-caps).
 */
export declare function validateZones(zones: Zone[], polygon: LatLon[], maxZones?: number): ZoneValidationResult;
