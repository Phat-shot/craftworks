// ═══════════════════════════════════════════════════════════
//  Field-size-scaled timings.
//  L = sqrt(areaM2) is the characteristic field length in meters.
//  Reference: walking speed ~1.4 m/s. Per user requirement all
//  values err LONGER rather than shorter and are clamped to
//  sane bounds. Every value can be overridden via ar_settings.
// ═══════════════════════════════════════════════════════════

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

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Compute all mode timings from the playfield area. */
export function scaleTimings(areaM2: number): ModeTimings {
  const L = Math.sqrt(Math.max(1, areaM2)); // characteristic length in m
  return {
    zoneRadiusM:          clamp(L / 25, 12, 45),
    freezeMs:             clamp(((L / 2) / 1.4) * 1000, 30_000, 120_000),
    freezeMoveToleranceM: 15, // fixed: below GPS drift would punish standing still
    freezeExtensionMs:    clamp((((L / 2) / 1.4) * 1000) * 0.25, 10_000, 30_000),
    baseSettingMs:        clamp((L / 1.4) * 1000, 90_000, 300_000),
    flagPickupDwellMs:    clamp((L / 50) * 1000, 4_000, 15_000),
    flagReturnMs:         clamp(L * 200, 30_000, 90_000),
    minBaseSeparationM:   clamp(L * 0.5, 60, 600),
    captureDwellMs:       clamp((L / 40) * 1000, 5_000, 20_000),
    plantDwellMs:         clamp((L / 30) * 1000, 8_000, 20_000),
    defuseDwellMs:        clamp((L / 40) * 1000, 6_000, 15_000),
    bombTimerMs:          clamp(((L / 1.4) + 30) * 1200, 90_000, 300_000),
  };
}

/** Drohne perk (hider): "opponent within range" alert radius, scaled to field size. */
export function scaleDroneRangeM(areaM2: number): number {
  const L = Math.sqrt(Math.max(1, areaM2));
  return clamp(L * 0.4, 50, 200);
}

// ── Zones (bases, capture points, bomb sites) ───────────────
import { LatLon } from './types';
import { haversineMeters } from './geo';

export interface Zone {
  id: string;
  lat: number;
  lon: number;
  radiusM: number;
}

export function isInZone(p: LatLon, z: Zone): boolean {
  return haversineMeters(p, { lat: z.lat, lon: z.lon }) <= z.radiusM;
}

/** Negative = inside (meters past the rim), positive = outside. */
export function distanceToZoneM(p: LatLon, z: Zone): number {
  return haversineMeters(p, { lat: z.lat, lon: z.lon }) - z.radiusM;
}

// ── Zone validation (host setup) ────────────────────────────
import { pointInPolygon } from './geo';

export type ZoneValidationError = 'outside_field' | 'zones_too_close' | 'too_many_zones';
export interface ZoneValidationResult { ok: boolean; errors: ZoneValidationError[]; }

/**
 * Validate host-placed zones: all inside the field, pairwise separation
 * ≥ 1.5x combined radii (no overlapping trivial multi-caps).
 */
export function validateZones(
  zones: Zone[],
  polygon: LatLon[],
  maxZones = 8
): ZoneValidationResult {
  const errors: ZoneValidationError[] = [];
  if (zones.length > maxZones) errors.push('too_many_zones');
  for (const z of zones) {
    if (!pointInPolygon({ lat: z.lat, lon: z.lon }, polygon)) {
      errors.push('outside_field');
      break;
    }
  }
  outer:
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const minSep = (zones[i]!.radiusM + zones[j]!.radiusM) * 1.5;
      if (haversineMeters(zones[i]!, zones[j]!) < minSep) {
        errors.push('zones_too_close');
        break outer;
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
