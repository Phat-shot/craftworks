/** WGS84 coordinate. */
export interface LatLon {
    lat: number;
    lon: number;
}
/**
 * One telemetry sample from a device.
 * The app sends these at 1–4 Hz; the server keeps a short ring buffer per player.
 */
export interface TelemetrySample extends LatLon {
    /** Unix epoch ms when the sample was TAKEN on-device (not received). */
    ts: number;
    /** GPS accuracy radius in meters (68% confidence), as reported by the OS. */
    accuracyM: number;
    /** Compass heading 0-360° (true north) at sample time. Null if unavailable. */
    headingDeg: number | null;
    /** Device speed in m/s if the OS provides it. Null if unavailable. */
    speedMps?: number | null;
    /** Altitude in meters (optional; used later for multi-level areas). */
    altitudeM?: number | null;
}
/**
 * A hit attempt = the shooter pressed the camera trigger.
 * The app captures a synchronized sensor snapshot at trigger time.
 * No image ever leaves the device — only this telemetry.
 */
export interface HitAttempt {
    shooterId: string;
    targetId: string;
    /** Shooter state at trigger time. headingDeg is REQUIRED for a valid attempt. */
    shooter: TelemetrySample;
    /** Best matching target sample (server picks nearest-in-time from its buffer). */
    target: TelemetrySample;
}
export type HitFailReason = 'no_heading' | 'time_skew' | 'out_of_range' | 'outside_cone' | 'outside_lateral' | 'low_confidence';
export interface HitVerdict {
    hit: boolean;
    reason: HitFailReason | null;
    /** 0..1 combined confidence (0 when a hard check fails). */
    confidence: number;
    /** Diagnostics for UI + tuning. */
    distanceM: number;
    angleDeltaDeg: number | null;
    toleranceDeg: number | null;
    timeSkewMs: number;
}
export interface HitConfig {
    /** Max distance shooter→target for a valid hit. */
    maxRangeM: number;
    /** Max |t_shooter − t_target| between the two samples. */
    maxTimeSkewMs: number;
    /** Base half-angle of the aiming cone (perfect GPS). */
    baseConeHalfAngleDeg: number;
    /** Upper cap for the widened tolerance (avoids 180° cones at point-blank). */
    maxToleranceDeg: number;
    /** Verdicts below this confidence are rejected even if inside the cone. */
    minConfidence: number;
}
export declare const DEFAULT_HIT_CONFIG: HitConfig;
export type GeofenceState = 'inside' | 'warning' | 'outside';
export interface GeofenceStatus {
    state: GeofenceState;
    /**
     * Signed distance to the polygon boundary in meters.
     * Positive = inside (distance to nearest edge), negative = outside.
     */
    signedDistanceM: number;
}
export interface PolygonValidationOptions {
    minPoints: number;
    minAreaM2: number;
    maxAreaM2: number;
}
export declare const DEFAULT_POLYGON_OPTIONS: PolygonValidationOptions;
export type PolygonValidationError = 'too_few_points' | 'self_intersecting' | 'area_too_small' | 'area_too_large';
export interface PolygonValidationResult {
    ok: boolean;
    errors: PolygonValidationError[];
    areaM2: number;
}
export interface PlausibilityConfig {
    /** Max sustained human speed in m/s (12 ≈ elite sprint; default catches vehicles/teleports). */
    maxSpeedMps: number;
    /** Ignore implausibility for gaps shorter than this (GPS jitter between close samples). */
    minGapMs: number;
}
export declare const DEFAULT_PLAUSIBILITY: PlausibilityConfig;
