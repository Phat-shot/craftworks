import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions, Animated } from 'react-native';
import { MapView, Camera, ShapeSource, FillLayer, LineLayer, CircleLayer } from '@maplibre/maplibre-react-native';
import {
  destinationPoint, DEFAULT_HIT_CONFIG, hitToleranceDeg, haversineMeters, bearingDeg, angleDeltaDeg,
} from '@craftworks/arops-shared';
import { useKeepAwake } from 'expo-keep-awake';
import { getSocket, getUser, getHeadingSettings } from '../api';
import { useTelemetry } from '../hooks/useTelemetry';
import { useWatchSync } from '../hooks/useWatchSync';
import CameraLayer from '../components/CameraLayer';
import ShockwaveEffect from '../components/ShockwaveEffect';
import { useIrScan } from '../hooks/useIrScan';
import Icon, { IconName } from '../components/Icon';
import ComicMapLayers, { ComicFeature } from '../components/ComicMapLayers';
import { blankMapStyle, OSM_STYLE, OSM_STYLE_DARK } from '../mapStyle';
import { useTheme, ThemeTokens, THEMES } from '../theme';

// owner/capture's key is a team letter in team mode, a userId in the ffa
// variant (every player captures individually) — see arops.js's Domination
// mode. colorForKey() below resolves either kind to a display color.
interface ZoneInfo { id: string; lat: number; lon: number; radiusM: number; owner?: string | null; capture?: { team?: string; userId?: string; pct: number } | null; }
interface FlagInfo {
  // Team mode: `team` ('a'|'b'). Ffa (N flags, one per player): `owner`
  // (userId) instead — see arops.js's CTF mode.
  team?: 'a'|'b'; owner?: string; state: string; carrier: string | null; lat?: number; lon?: number;
  // Whoever's currently dwelling to steal this flag (0/null while nobody
  // is raiding it) — team mode: pickupTeam ('a'|'b'). Ffa: pickupBy (userId).
  pickupPct?: number; pickupTeam?: 'a'|'b'|null; pickupBy?: string | null;
}
interface TargetInfo { id: string; lat: number; lon: number; radiusM: number; destroyed: boolean; active: boolean; }

interface Snap {
  sessionId?: string;
  subMode?: string;
  // 'team' (default) or 'ffa' — only meaningful for the 4 team-capable
  // modes (domination, ctf, seek_destroy, deathmatch).
  teamVariant?: 'team' | 'ffa';
  debugMode?: boolean;
  phase: string;
  phaseEndsAt: number | null;
  serverTime: number;
  polygon: { lat: number; lon: number }[];
  comicMap?: { features: ComicFeature[] } | null;
  hitTrackingMode?: 'compass' | 'ir';
  hitRangeM?: number;
  hitConeHalfAngleDeg?: number;
  // Raw dwell-time totals (ms) behind every *Pct value below — lets the
  // client compute remaining time instead of just showing a percentage.
  timings?: {
    freezeMs: number; captureDwellMs: number; flagPickupDwellMs: number;
    plantDwellMs: number; defuseDwellMs: number; zoneRadiusM: number;
    radarDurationMs: number;
  };
  winner: string | null;
  hidersRemaining: number;
  me: {
    role: string; team?: 'a'|'b'|null; status: string; score: number;
    class?: 'scout' | 'sniper' | 'bomber' | null;
    // Own effective hit-test shape (see server's effectiveHitInfo) — differs
    // from the top-level hitRangeM/hitConeHalfAngleDeg above if this player
    // has a class. 'cone' (Scout/default): hitRangeM + hitConeHalfAngleDeg.
    // 'lateral' (Sniper): hitRangeM (doubled) + lateralToleranceM (meters,
    // not an angle). 'omni' (Bomber): hitRangeM (quartered) only, no
    // direction at all.
    hitShape?: 'cone' | 'lateral' | 'omni';
    hitRangeM?: number;
    hitConeHalfAngleDeg?: number;
    lateralToleranceM?: number;
    isCaptain?: boolean;
    geofence: string; proximityAlert: boolean;
    frozenRemainingMs?: number; freezeViolations?: number;
    radarCooldownRemainingMs: number; hitCooldownRemainingMs: number;
    droneCooldownRemainingMs?: number;
    cloakCooldownRemainingMs?: number; cloakActive?: boolean; cloakRemainingMs?: number;
    fakeMarkerCooldownRemainingMs?: number; fakeMarkerActive?: boolean; fakeMarkerRemainingMs?: number;
    aufscheuchenCooldownRemainingMs?: number;
    // Scout's Reveal-Trap (any mode, any role) — armed at the Scout's
    // current position, one-shot: reveals the first opponent who walks
    // within range, then consumes itself. trapAlert only ever populated for
    // the trap's own owner (server never leaks who triggered someone else's).
    revealTrapCooldownRemainingMs?: number; trapArmed?: boolean;
    trapAlert?: { lat: number; lon: number; triggeredAt: number; expiresAt: number } | null;
    // Team ping (map tap) — only ever the viewer's own team's pings, never
    // the opponents' (see server's getAropsSnapshot, me.teamPings).
    teamPings?: { lat: number; lon: number; byUserId: string; ts: number; expiresAt: number }[];
  } | null;
  players: { userId: string; username: string; avatar_color?: string; team?: 'a'|'b'|null; frozen?: boolean; lat?: number; lon?: number; positionAgeMs?: number; exposed?: boolean; accuracyM?: number; status: string; score: number }[];
  // Mode extras
  teamScore?: { a: number; b: number };
  // Domination ffa: per-player score instead of teamScore (userId -> score).
  playerScore?: Record<string, number>;
  targetScore?: number;
  zones?: ZoneInfo[];
  // Team mode: { a, b }. Ctf ffa: keyed by userId instead (N flags, one per
  // player) — same field name either way, see arops.js's CTF mode.
  captures?: Record<string, number>;
  targetCaptures?: number;
  // Team mode: keys 'a'/'b'. Ffa (ctf/deathmatch): keyed by userId, every
  // player places their own base — see arops.js's baseKeyOf.
  bases?: Record<string, { lat: number; lon: number } | null>;
  zoneRadiusM?: number;
  flags?: FlagInfo[];
  // Zerstören (seek_destroy) — rotating multi-target list, see arops.js.
  targets?: TargetInfo[];
  destroyVariant?: 'instant' | 'defuse';
  capture?: { team?: 'a'|'b'; userId?: string; pct: number } | null;
  armed?: { explodeAt: number; defusePct: number } | null;
  events: { seq: number; type: string; userId?: string; winner?: string }[];
}

interface RadarContact { userId: string; lat: number; lon: number; ageMs: number; }

interface Toast { icon: IconName; text: string; }
const ERR_DE: Record<string, Toast> = {
  wrong_phase: { icon: 'hourglass', text: 'Noch Versteckphase — warte auf die Suchphase' },
  cooldown: { icon: 'hourglass', text: 'Noch im Cooldown' },
  outside_field: { icon: 'boundary', text: 'Du bist außerhalb des Spielfelds' },
  no_heading: { icon: 'compass', text: 'Kein Kompass — Handy in einer 8 bewegen' },
  role_cannot_shoot: { icon: 'ghost', text: 'Hider können nicht schießen' },
  implausible: { icon: 'warning', text: 'Position unplausibel' },
  frozen: { icon: 'snowflake', text: 'Du bist eingefroren' },
  bases_too_close: { icon: 'flag', text: 'Zu nah an der Gegner-Base' },
  not_captain: { icon: 'flag', text: 'Nur der Captain setzt die Base' },
  wrong_mode: { icon: 'close', text: 'Falscher Modus' },
  no_position: { icon: 'close', text: 'Keine Position bekannt' },
  perk_wrong_role: { icon: 'close', text: 'Für deine Rolle nicht verfügbar' },
};

// Per-submode phase naming — the raw phase ids ('base_setup', 'live') are
// shared plumbing across all 4 team-capable modes (see server's MODES),
// but reused verbatim they read as generic/unclear ("Live" tells a player
// nothing about what they're supposed to be doing). Only submodes with a
// name here override the fallback further down (hide_and_seek's own
// hiding/seeking phases already had good names and aren't touched).
const PHASE_LABELS: Record<string, Partial<Record<string, Toast>>> = {
  domination: {
    live: { icon: 'target', text: 'Kontrolle' },
  },
  ctf: {
    base_setup: { icon: 'flag', text: 'Base wählen' },
    live: { icon: 'flag', text: 'Flaggenjagd' },
  },
  seek_destroy: {
    live: { icon: 'bomb', text: 'Zerstören' },
  },
  deathmatch: {
    base_setup: { icon: 'flag', text: 'Base wählen' },
    live: { icon: 'skull', text: 'Jagd' },
  },
};

// View modes: free 2D comic map (manual pan/rotate/zoom) → compass-oriented
// 3D comic map → split cam/comic → transparent comic-over-camera → pure
// camera (no map at all). Shooting itself doesn't need the camera preview —
// telemetry (position + camera-forward heading) is fused continuously
// regardless of which view is on screen — pure camera is just for players
// who want an unobstructed viewfinder.
type ViewMode = 'comic2d' | 'comic3d' | 'split' | 'overlay' | 'camera';
const MODES: { id: ViewMode; icon: IconName; label: string }[] = [
  { id: 'comic2d', icon: 'map',       label: '2D' },
  { id: 'comic3d', icon: 'palette',   label: '3D' },
  { id: 'split',   icon: 'splitView', label: 'Split' },
  { id: 'overlay', icon: 'ghost',     label: 'Overlay' },
  { id: 'camera',  icon: 'camera',    label: 'Kamera' },
];

// Fixed blend for the hitbox/target overlay and the Overlay-mode map/camera
// blend — no longer a user-facing setting.
const OVERLAY_OPACITY = 0.5;

function hexToRgba(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Cooldown/duration indicator for the action-bar buttons below — a glowing
// border traced around the BUTTON ITSELF (not a separate icon-sized donut).
// Previous version was a pie/ring badge next to the icon that just vanished
// outright once the perk came off cooldown (reported as an abrupt "half-
// circle that disappears"); this instead lights up the button's own edge in
// 4 quarters (top → right → bottom → left, same clockwise reading a pie
// sweep had) with the lit length shrinking as `progress` counts down from 1
// to 0, plus a slow opacity pulse so it visibly "glows" rather than sitting
// static — vanishing the same way the old ring did once the perk is ready
// again (progress hits 0 → nothing rendered). Deliberately still no SVG
// dependency (see the reverted native-location experiment earlier this
// session) — pure Views + the built-in Animated API only.
function GlowBorder({ progress, color }: { progress: number; color: string }) {
  const pulse = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    const anim = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.55, duration: 650, useNativeDriver: true }),
    ]));
    anim.start();
    return () => anim.stop();
  }, [pulse]);
  const p = Math.max(0, Math.min(1, progress));
  if (p <= 0) return null;
  // Single continuous CLOCKWISE sweep starting at top-center ("0°", 12
  // o'clock) — a classic pie/countdown-timer read: at p=1 the whole border
  // is lit, and as p depletes toward 0 the ELAPSED portion erases starting
  // at the top and sweeping clockwise (top-right arm -> right edge ->
  // bottom-right arm -> bottom-left arm -> left edge -> top-left arm, 6
  // legs of equal 1/6 weight), always finishing the very last sliver
  // exactly back at top-center. Replaces an earlier symmetric two-sided
  // shrink (both halves depleting from their own center simultaneously)
  // that fixed a prior "reads as a static line" bug but gave up the actual
  // clockwise-timer semantics in the process.
  const legQ = (i: number) => Math.max(0, Math.min(1, 6 * p - (5 - i)));
  const armFrac = (i: number) => `${legQ(i) * 50}%` as `${number}%`;
  const edgeFrac = (i: number) => `${legQ(i) * 100}%` as `${number}%`;
  // Two layers per leg instead of one flat bar — a soft, low-opacity halo
  // (thicker) behind a crisp, bright core (thin, pulsing) — to actually read
  // as "glowing" rather than a hard-edged stroke. Both anchored flush INSIDE
  // the button's own edge, whole overlay clipped to the button's own corner
  // radius so the straight per-leg bars don't visibly overshoot the rounded
  // corners.
  const haloStyle = { backgroundColor: color, opacity: 0.22, borderRadius: 3 };
  const coreStyle = { backgroundColor: color, opacity: pulse as any, borderRadius: 1 };
  return (
    <View style={[StyleSheet.absoluteFill, { borderRadius: 12, overflow: 'hidden' }]} pointerEvents="none">
      {/* The border-sweep alone is still hard to read as "how much time is
          left" at a glance — a plain fill rising from the bottom (classic
          gauge/battery-level look) reads instantly, added as a first,
          lowest layer. Uses the overall `p` directly (not the per-leg
          sweep) — a supplementary reading aid, not part of the clockwise
          motion itself. */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${p * 100}%`, backgroundColor: color, opacity: 0.22 }} />
      {/* leg0: top-center -> top-right corner */}
      <View style={[{ position: 'absolute', top: 0, right: 0, height: 4, width: armFrac(0) }, haloStyle]} />
      <Animated.View style={[{ position: 'absolute', top: 0, right: 0, height: 2, width: armFrac(0) }, coreStyle]} />
      {/* leg1: top-right corner -> bottom-right corner */}
      <View style={[{ position: 'absolute', bottom: 0, right: 0, width: 4, height: edgeFrac(1) }, haloStyle]} />
      <Animated.View style={[{ position: 'absolute', bottom: 0, right: 0, width: 2, height: edgeFrac(1) }, coreStyle]} />
      {/* leg2: bottom-right corner -> bottom-center */}
      <View style={[{ position: 'absolute', bottom: 0, left: '50%', height: 4, width: armFrac(2) }, haloStyle]} />
      <Animated.View style={[{ position: 'absolute', bottom: 0, left: '50%', height: 2, width: armFrac(2) }, coreStyle]} />
      {/* leg3: bottom-center -> bottom-left corner */}
      <View style={[{ position: 'absolute', bottom: 0, left: 0, height: 4, width: armFrac(3) }, haloStyle]} />
      <Animated.View style={[{ position: 'absolute', bottom: 0, left: 0, height: 2, width: armFrac(3) }, coreStyle]} />
      {/* leg4: bottom-left corner -> top-left corner */}
      <View style={[{ position: 'absolute', top: 0, left: 0, width: 4, height: edgeFrac(4) }, haloStyle]} />
      <Animated.View style={[{ position: 'absolute', top: 0, left: 0, width: 2, height: edgeFrac(4) }, coreStyle]} />
      {/* leg5: top-left corner -> top-center */}
      <View style={[{ position: 'absolute', top: 0, right: '50%', height: 4, width: armFrac(5) }, haloStyle]} />
      <Animated.View style={[{ position: 'absolute', top: 0, right: '50%', height: 2, width: armFrac(5) }, coreStyle]} />
    </View>
  );
}

// Screen-space shot-range overlay for the map views (2D/3D/Split) — a
// stylized, fixed-pixel wedge/lane anchored at the player's own screen
// position (always screen-center, same convention the camera-mode aim
// overlays below already use), NOT a geo-referenced shape scaled to real
// meters/zoom. See the "Shot-range indicator" comment above (near
// activeHeadingDeg) for why this is deliberately a plain rotated View
// instead of a MapLibre ShapeSource baked into the map's own MapView.
// `rotateDeg` is 0 in every compass-driven view mode (map itself rotates,
// this stays screen-fixed) and the live heading-vs-map-bearing delta in
// free-2D mode (map doesn't rotate on its own, this does) — see renderMap.
// `pitchDeg` mirrors the MapView's own Camera pitch (mapPitch, 0 in free-2D,
// 45° once compass-oriented) — without it this flat overlay reads as a
// sticker "slapped on top" of the map's own tilted 3D perspective instead of
// looking like it lies on the same ground plane.
// `lengthPx` is the on-screen px equivalent of effectiveMaxRangeM at the
// map's current meters-per-pixel scale (see shotOverlayLengthPx above) — the
// cone/lane's reach then lines up with the map's own geo-referenced range
// ring instead of a fixed pixel guess that drifts out of sync on zoom.
// `anchorPx` is the player's actual screen position in free-2D mode (where
// the Camera is user-panned, not locked to the player) — null everywhere
// else, where the Camera is always centered on the player and '50%'/'50%'
// is already correct.
function ShotOverlay({ rotateDeg, pitchDeg, lengthPx, anchorPx, myHitShape, effectiveConeHalfAngleDeg, color }: {
  rotateDeg: number; pitchDeg: number; lengthPx: number; anchorPx: [number, number] | null;
  myHitShape: 'cone' | 'lateral' | 'omni'; effectiveConeHalfAngleDeg: number; color: string;
}) {
  if (myHitShape === 'omni') return null; // omni's range circle stays map-anchored (rotation-irrelevant)
  const LENGTH_PX = lengthPx;
  const fill = hexToRgba(color, 0.45);
  const border = hexToRgba(color, 0.8);
  // Wrapper is a zero-size anchor pinned exactly at the player's screen
  // position — rotating IT (not the shape itself) pivots the whole wedge
  // around that point, regardless of how far the shape extends above it.
  // `rotateX` tilts that same rigid (already heading-rotated, since `rotate`
  // is listed AFTER `rotateX` and so is applied to the point first/innermost)
  // shape to match the map's own pitch — `perspective` first in the list is
  // what makes that tilt read as actual depth instead of a flat vertical
  // squash, the standard RN recipe for a "tilted card" look.
  const anchor = {
    position: 'absolute' as const,
    top: anchorPx ? anchorPx[1] : ('50%' as const),
    left: anchorPx ? anchorPx[0] : ('50%' as const),
    width: 0, height: 0,
    transform: [{ perspective: 800 }, { rotateX: `${pitchDeg}deg` }, { rotate: `${rotateDeg}deg` }] as any,
  };
  // Apex AT the anchor (the player's own position, y=0 here), widening
  // AWAY (upward/outward, toward -LENGTH_PX) — a cone of fire narrows to a
  // point at the shooter and spreads out with range, not the other way
  // around. Reported inverted once already: borderBottomColor put the WIDE
  // edge at the anchor and the point pointing away instead.
  const shape = myHitShape === 'cone'
    ? (() => {
        const halfWidthPx = Math.tan(effectiveConeHalfAngleDeg * Math.PI / 180) * LENGTH_PX;
        return {
          position: 'absolute' as const, left: -halfWidthPx, top: -LENGTH_PX, width: 0, height: 0,
          borderLeftWidth: halfWidthPx, borderRightWidth: halfWidthPx, borderTopWidth: LENGTH_PX,
          borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: fill,
        };
      })()
    : { position: 'absolute' as const, left: -18, top: -LENGTH_PX, width: 36, height: LENGTH_PX,
        backgroundColor: fill, borderWidth: 1.5, borderColor: border };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={anchor}>
        <View style={shape} />
      </View>
    </View>
  );
}

// Freeze feedback on the own marker — a ring "rolling up" as the freeze
// counts down, screen-center-anchored like ShotOverlay above. 12 fixed tick
// marks around the anchor (each individually pre-rotated + offset — same
// zero-size-anchor rotation-pivot trick ShotOverlay uses, just once per
// tick instead of once for the whole shape) fading out clockwise as
// `progress` (frozenRemainingMs / freezeMs) depletes from 1 to 0 — a true
// circular arc/pie wipe isn't achievable with plain Views (no SVG, see
// GlowBorder's own comment above), this reads the same "winding down" way
// without it.
function FreezeRing({ progress, color }: { progress: number; color: string }) {
  const SEGMENTS = 12;
  const RADIUS = 26;
  const TICK_LEN = 8;
  const p = Math.max(0, Math.min(1, progress));
  if (p <= 0) return null;
  const litCount = Math.round(p * SEGMENTS);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: SEGMENTS }).map((_, i) => (
        <View key={i} style={{
          position: 'absolute', top: '50%', left: '50%', width: 0, height: 0,
          transform: [{ rotate: `${(360 / SEGMENTS) * i}deg` }],
        }}>
          <View style={{
            position: 'absolute', top: -(RADIUS + TICK_LEN), left: -1.5, width: 3, height: TICK_LEN,
            borderRadius: 1.5, backgroundColor: color, opacity: i < litCount ? 0.95 : 0.18,
          }} />
        </View>
      ))}
    </View>
  );
}

// Own-marker status badge (downed→arrow-to-base, found→cross/ghost, H&S
// seeker→magnifying glass — see ownBadge's own doc comment for the full
// state table) — small icon chip at the same screen anchor as ShotOverlay/
// FreezeRing. `rotateDeg` (only for the base-direction arrow) is already
// converted from an absolute compass bearing to a screen-relative angle by
// the caller (same north-up-offset math shotOverlayRotateDeg uses).
function OwnMarkerBadge({ icon, color, rotateDeg }: { icon: IconName; color: string; rotateDeg?: number }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={{
        position: 'absolute', top: '50%', left: '50%', width: 28, height: 28, marginTop: -14, marginLeft: -14,
        borderRadius: 14, backgroundColor: 'rgba(10,8,16,.85)', alignItems: 'center', justifyContent: 'center',
        transform: rotateDeg !== undefined ? [{ rotate: `${rotateDeg}deg` }] : undefined,
      }}>
        <Icon name={icon} size={16} color={color} />
      </View>
    </View>
  );
}

export default function GameScreen({ sessionId, onExit, watchSync }: {
  sessionId: string; onExit: () => void; watchSync: ReturnType<typeof useWatchSync>;
}) {
  useKeepAwake(); // screen lock would stop GPS → target_stale for everyone else
  // Only the game screen's own structural chrome (backgrounds, popup/modal
  // borders, action-bar frame, status bar) follows the Color/Nacht/Tag
  // theme — gameplay-semantic colors (class accents, team colors, hit/
  // freeze/status banners, the aim reticle) stay literal, see theme.ts's
  // header comment for why.
  const theme = useTheme();
  const st = useMemo(() => makeStyles(theme), [theme]);
  // Same dark-map treatment as LobbyScreen for both dark UI themes ('color',
  // 'night') — only 'day' keeps the light OSM look. See LobbyScreen.tsx's
  // equivalent comment for why comparing against THEMES.day works without
  // threading the ThemeName down separately.
  const isDarkUiTheme = theme !== THEMES.day;
  // Comic-map backdrop tracks the theme's own background color (see
  // mapStyle.ts's blankMapStyle) so it blends into the surrounding chrome
  // instead of a fixed color — matters most in the split-screen layout
  // where the map sits directly next to themed UI.
  const comicMapStyle = useMemo(() => blankMapStyle(theme.bg), [theme]);
  const socket = getSocket();
  const me = getUser();
  const [snap, setSnap] = useState<Snap | null>(null);
  const telemetry = useTelemetry(socket, sessionId);
  const hitRangeRef = useRef(DEFAULT_HIT_CONFIG.maxRangeM);
  const radarDurationMsRef = useRef(15_000);
  // Action-bar cooldown/duration indicators (GlowBorder above): the server only
  // ever sends *RemainingMs, never each perk's total duration (which varies
  // by field-size auto-scaling and host overrides anyway) — so the ring's
  // "total" is self-calibrated by remembering the highest remaining value
  // seen since it last hit 0 (i.e. the instant a perk is used, its
  // remainingMs IS the total). Written directly during render (same
  // established pattern as activeHeadingDegRef elsewhere in this file), not
  // in an effect — this only ever reads the latest snapshot tick, never
  // triggers a render itself.
  const radarCdTotalRef = useRef(0);
  const cloakCdTotalRef = useRef(0);
  const fakeCdTotalRef = useRef(0);
  const trapCdTotalRef = useRef(0);
  const cloakActiveTotalRef = useRef(0);
  const fakeActiveTotalRef = useRef(0);
  const cdFraction = (remainingMs: number, totalRef: { current: number }) => {
    if (remainingMs > totalRef.current) totalRef.current = remainingMs;
    if (remainingMs <= 0) { totalRef.current = 0; return 0; }
    return totalRef.current > 0 ? remainingMs / totalRef.current : 0;
  };
  const [lastResult, setLastResult] = useState<Toast | null>(null);
  // Bumped once per fired shot — ShockwaveEffect replays its animation
  // whenever this changes (see its own doc comment). 0 = "never fired yet".
  const [shotEffectKey, setShotEffectKey] = useState(0);
  const [radarContacts, setRadarContacts] = useState<RadarContact[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('comic3d');
  const cameraRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const [showRange, setShowRange] = useState(false);
  // Live map bearing + zoom, read back from the MapView itself. Bearing only
  // actually changes in free-2D mode (user's own rotate gesture, see
  // rotateEnabled below); every other mode drives the map's heading directly
  // (mapHeading) so there's nothing to read back there. Zoom can change in
  // EVERY mode (zoomEnabled follows `interactive`, independent of rotate) —
  // needed so ShotOverlay's on-screen size can track the same meters-per-
  // pixel scale the map's own geo-referenced range ring renders at,
  // regardless of how far the player has pinch-zoomed.
  const [mapBearingDeg, setMapBearingDeg] = useState(0);
  const [mapZoomLevel, setMapZoomLevel] = useState(16.5); // matches the initial Camera zoomLevel prop below
  const onMapRegionChange = (feature: any) => {
    const h = feature?.properties?.heading;
    if (typeof h === 'number') setMapBearingDeg(h);
    const z = feature?.properties?.zoomLevel;
    if (typeof z === 'number') setMapZoomLevel(z);
  };
  // Screen-space position of the player's own marker, in px relative to the
  // MapView — only needed in free-2D mode (see the effect near isFree2D
  // below for why).
  const [screenAnchorPx, setScreenAnchorPx] = useState<[number, number] | null>(null);
  // Compass smoothing (see useTelemetry's setHeadingInterpolation/
  // setHeadingSampleIntervalMs/setHeadingRenderRateHz doc for the full
  // performance investigation) is a device-level tradeoff, not a per-match
  // one — the controls for it now live on the start screen's Einstellungen
  // (App.tsx, persisted via api.ts's get/saveHeadingSettings) instead of an
  // in-match popup here. Applied once at mount from whatever was persisted.
  useEffect(() => {
    const s = getHeadingSettings();
    telemetry.setHeadingInterpolation(s.interpolation);
    telemetry.setHeadingSampleIntervalMs(s.sampleMs);
    telemetry.setHeadingRenderRateHz(s.renderHz);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Continuously decodes the AR Ops IR-ID beacon (see hardware/esp32-ir)
  // from the camera feed while a camera-showing view is mounted — "beim
  // Schuss und davor" means this has to be running before the shot too, not
  // just triggered at shoot-time, since decoding takes ~2s of aiming.
  const irScan = useIrScan();

  // First few seconds without a GPS/compass fix are normal and expected — only
  // treat it as an actual problem (and offer the retry banner) once it's gone
  // on long enough that it probably isn't just still starting up.
  const [initGraceOver, setInitGraceOver] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setInitGraceOver(true), 10_000);
    return () => clearTimeout(t);
  }, []);

  // Reported: GPS (and, same underlying reasoning, the compass) recovers
  // reliably once its status icon is manually tapped, but not reliably on
  // its own — the hook's own internal 4s-silence watchdog (useTelemetry.ts)
  // respects an in-flight guard that a manual tap force-clears, so it
  // doesn't always unstick things by itself. This automates exactly what
  // tapping does, every 15s.
  //
  // GPS retries UNCONDITIONALLY (not gated on `!telemetry.sample`) —
  // reported as still not reliably kicking in with that gate, and
  // `sample` is a poor staleness signal anyway: buildSample() stamps
  // `ts: Date.now()` fresh on every call, not the underlying fix's actual
  // age, so `sample` reads as "fine" forever after just one fix even if
  // the GPS died completely afterward. Removing the gate trades a
  // harmless periodic resubscribe (near-instant if the fix is already
  // healthy) for never silently failing to retry. Compass keeps its own
  // gate — its icon disappears once fixed, so there's nothing left to
  // retry for once activeHeadingDeg is non-null.
  //
  // Read via refs (not a `retryPosition`/`activeHeadingDeg` dependency)
  // since retryPosition/retryHeading are fresh, unmemoized closures every
  // render — depending on them directly would tear down and restart this
  // interval on every single tick, never letting it actually fire.
  // activeHeadingDegRef is written just after activeHeadingDeg is computed
  // further down (has to be, since it depends on hasCam/viewMode defined
  // later in this function).
  const telemetryRef = useRef(telemetry);
  telemetryRef.current = telemetry;
  const activeHeadingDegRef = useRef<number | null>(null);
  useEffect(() => {
    const iv = setInterval(() => {
      telemetryRef.current.retryPosition();
      if (activeHeadingDegRef.current === null) telemetryRef.current.retryHeading();
    }, 15_000);
    return () => clearInterval(iv);
  }, []);

  const [viewPopupOpen, setViewPopupOpen] = useState(false);
  const [endRecapOpen, setEndRecapOpen] = useState(false);
  // Measured (not guessed) so the settings FAB sits right above the action
  // bar regardless of its actual height (varies when the captain-setup base
  // row is shown) — see the bottomBar's onLayout below.
  const [bottomBarH, setBottomBarH] = useState(100);

  // ── Debug overlay: live stats + enemy distance/hitbox, overlaid on the
  // existing view — not a separate full-screen panel.
  const [debugOpen, setDebugOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [ticksPerSec, setTicksPerSec] = useState(0);
  const tickCounterRef = useRef(0);
  const debugMode = !!snap?.debugMode;

  useEffect(() => {
    const id = setInterval(() => {
      setTicksPerSec(tickCounterRef.current);
      tickCounterRef.current = 0;
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!debugMode) return;
    const onPong = ({ t }: { t: number }) => setPingMs(Date.now() - t);
    socket.on('debug:pong', onPong);
    const id = setInterval(() => socket.emit('debug:ping', { t: Date.now() }), 3000);
    return () => { clearInterval(id); socket.off('debug:pong', onPong); };
  }, [debugMode]);

  useEffect(() => {
    socket.emit('game:join', { sessionId });
    const onTick = (s: Snap) => {
      if (s.sessionId && s.sessionId !== sessionId) return; // stale session
      tickCounterRef.current++;
      // Own class-aware range (Sniper 2x, Bomber 0.25x) — the "Außer
      // Reichweite" toast below used to always show the match-wide default,
      // wrong for anyone with a non-default class.
      if (s.me?.hitRangeM ?? s.hitRangeM) hitRangeRef.current = (s.me?.hitRangeM ?? s.hitRangeM)!;
      if (s.timings?.radarDurationMs) radarDurationMsRef.current = s.timings.radarDurationMs;
      setSnap(s);
    };
    const onResult = (r: any) => {
      if (r.action === 'ar_hit_attempt') {
        let toast: Toast;
        if (r.hit) toast = { icon: 'crosshair', text: `Treffer! (${Math.round((r.confidence || 0) * 100)}%)` };
        else if (r.err) toast = ERR_DE[r.err] || { icon: 'close', text: r.err };
        else if (r.near) toast = { icon: 'windy', text: `Knapp! ${r.near.deltaDeg}° daneben (Toleranz ${r.near.toleranceDeg}°, ~${r.near.distanceM} m)` };
        else if (r.reason === 'no_candidates') toast = { icon: 'close', text: 'Kein gültiges Ziel (Team? Eingefroren? Keine Daten?)' };
        else if (r.reason === 'target_stale') toast = { icon: 'signalOff', text: 'Gegner-Position veraltet — dessen App/Display muss aktiv sein!' };
        else if (r.reason === 'low_confidence') toast = { icon: 'signal', text: 'Im Kegel, aber Datenqualität zu niedrig (GPS/Aktualität)' };
        else if (r.reason === 'out_of_range') toast = { icon: 'ruler', text: `Außer Reichweite (max. ${Math.round(hitRangeRef.current)} m)` };
        else toast = { icon: 'windy', text: 'Daneben — kein Ziel im Kegel' };
        setLastResult(toast);
        setTimeout(() => setLastResult(null), 4500);
      } else if (r.action === 'ar_use_perk' && r.contacts) {
        setRadarContacts(r.contacts);
        setTimeout(() => setRadarContacts([]), radarDurationMsRef.current);
      } else if (r.action === 'ar_use_perk' && typeof r.alert === 'boolean') {
        setLastResult({ icon: 'drone', text: r.alert ? 'Gegner in der Nähe!' : 'Nichts entdeckt' });
        setTimeout(() => setLastResult(null), 4000);
      } else if (r.action === 'ar_use_perk' && r.err) {
        setLastResult(ERR_DE[r.err] || { icon: 'close', text: r.err });
        setTimeout(() => setLastResult(null), 4000);
      } else if (r.action === 'ar_set_base') {
        setLastResult(r.ok ? { icon: 'flag', text: 'Base gesetzt!' } : (ERR_DE[r.err] || { icon: 'close', text: r.err }));
        setTimeout(() => setLastResult(null), 4000);
      }
    };
    socket.on('game:ar_tick', onTick);
    socket.on('game:action_result', onResult);
    return () => {
      socket.off('game:ar_tick', onTick);
      socket.off('game:action_result', onResult);
    };
  }, [sessionId]);

  const shoot = () => {
    const s = telemetry.snapshot();
    if (!s) return setLastResult({ icon: 'close', text: 'Keine Position' });
    const data: { sample: typeof s; irScan?: { deviceId: number; ts: number } } = { sample: s };
    // "beim Schuss und davor" — irScan.lastScan is whatever the camera most
    // recently decoded while aiming (useIrScan runs continuously whenever a
    // camera-showing view is mounted), not just at this exact instant. The
    // server (still the sole hit authority) checks it matches the claimed
    // target's assigned beacon ID and is recent enough — see arops.js.
    if (snap?.hitTrackingMode === 'ir' && irScan.lastScan) {
      data.irScan = { deviceId: irScan.lastScan.deviceId, ts: irScan.lastScan.ts };
    }
    socket.emit('game:action', { sessionId, action: 'ar_hit_attempt', data });
    setShotEffectKey(k => k + 1);
  };
  const useRadar = () =>
    socket.emit('game:action', { sessionId, action: 'ar_use_perk', data: { perk: 'radar' } });
  const useCloak = () =>
    socket.emit('game:action', { sessionId, action: 'ar_use_perk', data: { perk: 'cloak' } });
  const useFakeMarker = () =>
    socket.emit('game:action', { sessionId, action: 'ar_use_perk', data: { perk: 'fake_marker' } });
  const useRevealTrap = () =>
    socket.emit('game:action', { sessionId, action: 'ar_use_perk', data: { perk: 'reveal_trap' } });
  // Team ping (map tap, see onMapPress) — silently no-op for teamless modes
  // (no me.team means no teammates to ping; the server would reject it with
  // 'no_team' anyway, but checking client-side avoids a pointless round-trip).
  const usePing = (lat: number, lon: number) => {
    if (!snap?.me?.team) return;
    socket.emit('game:action', { sessionId, action: 'ar_use_perk', data: { perk: 'ping', lat, lon } });
  };

  const setBase = (lat?: number, lon?: number) =>
    socket.emit('game:action', {
      sessionId, action: 'ar_set_base',
      data: lat !== undefined ? { lat, lon } : {},
    });

  // ── Geo layers ────────────────────────────────────────────
  const center: [number, number] = useMemo(() => {
    const poly = snap?.polygon || [];
    if (telemetry.sample) return [telemetry.sample.lon, telemetry.sample.lat];
    if (poly.length) {
      return [
        poly.reduce((s, p) => s + p.lon, 0) / poly.length,
        poly.reduce((s, p) => s + p.lat, 0) / poly.length,
      ];
    }
    return [11.5755, 48.1374];
  }, [snap?.polygon, telemetry.sample?.lat, telemetry.sample?.lon]);

  // Only the play area itself is shown as "the map" — outside its boundary
  // the surroundings fade to dark instead of drawing a green line, and the
  // fade must start exactly AT the boundary (nothing fades away inside the
  // field) and reach fully opaque black well before it runs out of rings —
  // the free-pan/zoom 2D mode means the user can zoom/pan arbitrarily far
  // out, so the last ring is a huge fixed-size box (not scaled off the
  // field) guaranteeing black stays black however far they scroll. There's
  // no general polygon-buffer library in this project (would be a new
  // native-adjacent dependency for one visual effect), so this approximates
  // a buffer by scaling the polygon outward from its centroid in concentric
  // steps — good enough for typical roughly-convex fields, imperfect for
  // very concave/self-intersecting ones.
  const FADE_RING_COUNT = 16;
  const FADE_MAX_SCALE = 6;
  const FADE_HUGE_DEG = 5; // ~550km — covers any realistic pan/zoom
  const fadeGeoJSON = useMemo(() => {
    const poly = snap?.polygon || [];
    if (poly.length < 3) return null;
    const cx = poly.reduce((s, p) => s + p.lon, 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p.lat, 0) / poly.length;
    const scalePoly = (f: number) => poly.map(p => [cx + (p.lon - cx) * f, cy + (p.lat - cy) * f] as [number, number]);
    let prevRing = [...poly.map(p => [p.lon, p.lat] as [number, number]), [poly[0]!.lon, poly[0]!.lat] as [number, number]];
    const feats: any[] = [];
    // i=0 is the field boundary itself (scale 1, opacity 0) — every ring
    // after that is strictly outside it, so the very first visible step of
    // the fade only ever starts past the edge, never inside.
    for (let i = 1; i <= FADE_RING_COUNT; i++) {
      const t = i / FADE_RING_COUNT;
      const scale = 1 + (FADE_MAX_SCALE - 1) * t;
      const op = Math.min(1, t * t);
      const ring = scalePoly(scale);
      const closedRing = [...ring, ring[0]!];
      feats.push({
        type: 'Feature', properties: { op },
        geometry: { type: 'Polygon', coordinates: [closedRing, prevRing] },
      });
      prevRing = closedRing;
    }
    const huge: [number, number][] = [
      [cx - FADE_HUGE_DEG, cy - FADE_HUGE_DEG], [cx + FADE_HUGE_DEG, cy - FADE_HUGE_DEG],
      [cx + FADE_HUGE_DEG, cy + FADE_HUGE_DEG], [cx - FADE_HUGE_DEG, cy + FADE_HUGE_DEG],
      [cx - FADE_HUGE_DEG, cy - FADE_HUGE_DEG],
    ];
    feats.push({ type: 'Feature', properties: { op: 1 }, geometry: { type: 'Polygon', coordinates: [huge, prevRing] } });
    return { type: 'FeatureCollection' as const, features: feats };
  }, [JSON.stringify(snap?.polygon)]);

  const TEAM_COLOR = { a: '#40a0ff', b: '#ff5050' } as const;
  // Resolves a team-or-player key to a display color — 'a'/'b' in team mode,
  // a userId in the ffa variant of Domination/Zerstören/CTF/Deathmatch
  // (every player captures/owns individually, so there's no fixed 2-color
  // palette; fall back to each player's own avatar color).
  const colorForKey = (key?: string | null): string => {
    if (key === 'a' || key === 'b') return TEAM_COLOR[key];
    if (!key) return '#c0c0c0';
    return snap?.players.find(p => p.userId === key)?.avatar_color || '#f0c840';
  };

  // Distance + bearing + "currently in my shooting cone" per opponent whose
  // position I'm allowed to see (server already enforces the privacy rules —
  // players simply have no lat/lon here if hidden; debug sessions reveal
  // everyone). Single source of truth for the debug bar's text listing AND
  // the hitbox/cross visuals AND the camera target overlay below, so all
  // three always agree with each other.
  interface VisibleEnemy { userId: string; username: string; distanceM: number; bearingDeg: number; inCone: boolean; }
  const visibleEnemies: VisibleEnemy[] = useMemo(() => {
    if (!telemetry.sample) return [];
    const origin = { lat: telemetry.sample.lat, lon: telemetry.sample.lon };
    const heading = telemetry.heading;
    const out: VisibleEnemy[] = [];
    for (const p of snap?.players || []) {
      if (p.userId === me?.id || typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      const target = { lat: p.lat, lon: p.lon };
      const distanceM = haversineMeters(origin, target);
      const brg = bearingDeg(origin, target);
      let inCone = false;
      if (heading !== null) {
        const accSum = Math.max(4, (telemetry.sample.accuracyM || 0) + (p.accuracyM ?? telemetry.sample.accuracyM ?? 0));
        inCone = angleDeltaDeg(heading, brg) <= hitToleranceDeg(distanceM, accSum);
      }
      out.push({ userId: p.userId, username: p.username, distanceM, bearingDeg: brg, inCone });
    }
    return out.sort((a, b) => a.distanceM - b.distanceM);
  }, [telemetry.sample?.lat, telemetry.sample?.lon, telemetry.sample?.accuracyM,
      telemetry.heading, JSON.stringify(snap?.players), me?.id]);

  const actorsGeoJSON = useMemo(() => {
    const features: any[] = [];
    if (telemetry.sample) {
      // Grey once out of action (downed/found) — previously always the same
      // gold regardless of state, unlike every other player's dot (which
      // already reacts to frozen/team/inCone below).
      const ownColor = snap?.me?.status && snap.me.status !== 'alive' ? '#808080' : '#f0c840';
      features.push({ type: 'Feature', properties: { color: ownColor, op: 0.95 },
        geometry: { type: 'Point', coordinates: [telemetry.sample.lon, telemetry.sample.lat] } });
    }
    for (const p of snap?.players || []) {
      if (p.userId !== me?.id && typeof p.lat === 'number') {
        // Fade with position age: fresh = solid, ≥30s old = barely visible ghost
        const age = p.positionAgeMs ?? 0;
        const op = Math.max(0.25, 0.95 - (age / 30_000) * 0.7);
        // Debug: in my current shooting cone right now → bright red, overrides
        // the normal team/enemy color. Team modes: teammates blue, enemies
        // red; frozen = icy tint.
        const inCone = visibleEnemies.find(e => e.userId === p.userId)?.inCone;
        const color = inCone ? '#ff2020'
          : p.frozen ? '#a0d8ff'
          : p.team ? TEAM_COLOR[p.team] : '#ff4040';
        features.push({ type: 'Feature', properties: { color, op },
          geometry: { type: 'Point', coordinates: [p.lon!, p.lat!] } });
      }
    }
    for (const c of radarContacts) {
      const op = Math.max(0.25, 0.9 - (c.ageMs / 30_000) * 0.7);
      features.push({ type: 'Feature', properties: { color: '#ff8000', op },
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] } });
    }
    // Reveal-Trap trigger — only ever populated for the trap's own owner
    // (privacy: never leaks which opponent triggered it, just where).
    if (snap?.me?.trapAlert) {
      features.push({ type: 'Feature', properties: { color: '#ffcc00', op: 0.9 },
        geometry: { type: 'Point', coordinates: [snap.me.trapAlert.lon, snap.me.trapAlert.lat] } });
    }
    return { type: 'FeatureCollection' as const, features };
  }, [telemetry.sample?.lat, telemetry.sample?.lon, JSON.stringify(snap?.players), radarContacts, visibleEnemies, snap?.me?.trapAlert, snap?.me?.status]);

  // Team ping markers (map tap) — fade out as they approach expiry, same
  // convention as the age-based fades above. snap.me.teamPings is already
  // filtered server-side to the viewer's own team only (see arops.js).
  const pingsGeoJSON = useMemo(() => {
    const now = Date.now();
    const features = (snap?.me?.teamPings || []).map(pg => {
      const total = Math.max(1, pg.expiresAt - pg.ts);
      const op = Math.max(0.15, Math.min(1, (pg.expiresAt - now) / total));
      return { type: 'Feature' as const, properties: { op },
        geometry: { type: 'Point' as const, coordinates: [pg.lon, pg.lat] } };
    });
    return { type: 'FeatureCollection' as const, features };
  }, [JSON.stringify(snap?.me?.teamPings)]);

  // Host-configurable in the Lobby (Reichweite/Breite) — falls back to the
  // shared defaults until the snapshot carries a per-lobby override. "Breite"
  // is stored server-side as an angle (baseConeHalfAngleDeg, same formula
  // hit.ts validates with), translated back to a meters-wide lane here using
  // the same 10m reference distance the Lobby setting uses.
  //
  // Reported: perk/class overlays weren't reflected in the actual match —
  // this used to read the top-level snap.hitRangeM/hitConeHalfAngleDeg,
  // which the server deliberately keeps match-wide/unclassed (see its own
  // comment on those fields in getAropsSnapshot) specifically FOR backward
  // compat with this not-yet-existing client behavior. The viewer's own
  // effective (class-aware) values are in snap.me instead — reading those
  // now, with the match-wide ones only as a last-resort fallback (e.g. no
  // `me` at all, spectator-ish states).
  const myClass = snap?.me?.class;
  const myHitShape = snap?.me?.hitShape ?? 'cone';
  const effectiveMaxRangeM = snap?.me?.hitRangeM ?? snap?.hitRangeM ?? DEFAULT_HIT_CONFIG.maxRangeM;
  // Sniper (lateral) only — a fixed-meters-wide corridor, unrelated to any
  // angle. Scout/default (cone) doesn't convert its angle to a meters-width
  // lane anymore (see coneGeoJSON/coneCameraOverlay below) — reported: that
  // conversion drew Scout's actual widening angular cone as a constant-width
  // corridor that visually looked identical to Sniper's, and even narrowed
  // (in screen terms) toward the crosshair the way a real angular cone never
  // would when viewed from its own apex.
  const effectiveLaneWidthM = 2 * (snap?.me?.lateralToleranceM ?? 2);
  const effectiveConeHalfAngleDeg = snap?.me?.hitConeHalfAngleDeg ?? snap?.hitConeHalfAngleDeg
    ?? DEFAULT_HIT_CONFIG.baseConeHalfAngleDeg;
  // Reported: the aim overlay (cone/lane on the map, funnel in camera modes)
  // looked identical regardless of class — same generic orange everywhere,
  // no label — so it always read as "still showing Sniper" (or whichever
  // class was last actually distinguishable) with no way to confirm which
  // hitbox shape/size was actually loaded. Every class now gets its own
  // accent color (reused for the map cone, the camera funnel/radius, AND the
  // shared classInfoBadge below), plus that badge spells out the class name
  // and its current range/width numbers in text.
  const CLASS_COLOR: Record<'scout' | 'sniper' | 'bomber', string> = {
    scout: '#ff7828', sniper: '#40c0ff', bomber: '#f0c840',
  };
  const CLASS_LABEL: Record<'scout' | 'sniper' | 'bomber', string> = {
    scout: 'Scout', sniper: 'Sniper', bomber: 'Bomber',
  };
  const CLASS_ICON: Record<'scout' | 'sniper' | 'bomber', IconName> = {
    scout: 'crosshair', sniper: 'target', bomber: 'bomb',
  };
  const classKey = (myClass ?? 'scout') as 'scout' | 'sniper' | 'bomber';
  const classAccentColor = CLASS_COLOR[classKey];
  const classLabel = CLASS_LABEL[classKey];
  const classIcon = CLASS_ICON[classKey];
  const classStatText = myHitShape === 'omni'
    ? `Radius ${Math.round(effectiveMaxRangeM)}m`
    : myHitShape === 'cone'
    ? `${Math.round(effectiveMaxRangeM)}m Reichweite · ${Math.round(effectiveConeHalfAngleDeg * 2)}° Sichtfeld`
    : `${Math.round(effectiveMaxRangeM)}m Reichweite · ${effectiveLaneWidthM.toFixed(1)}m breit`;

  const hasCam = viewMode === 'split' || viewMode === 'overlay' || viewMode === 'camera';
  const isFree2D = viewMode === 'comic2d';
  // Every non-free-2D mode keeps a CONTROLLED Camera centered exactly on the
  // player (see `center`/`<Camera centerCoordinate={center}>` in renderMap
  // below), so the player is always dead-center there and ShotOverlay can
  // just anchor at '50%'/'50%' directly, no lookup needed (screenAnchorPx
  // stays null). Free-2D's Camera is uncontrolled (the user pans/zooms it
  // freely) — the player can be anywhere on screen, or off it entirely — so
  // the overlay has to track their actual projected screen point instead of
  // assuming screen-center, recomputed whenever the player moves or the map
  // itself is panned/zoomed/rotated (region-change) under them. Reported:
  // without this, the overlay sat at screen-center regardless of where the
  // player's marker actually was once the map had been panned away from it.
  useEffect(() => {
    if (!isFree2D || !telemetry.sample || !mapRef.current?.getPointInView) { setScreenAnchorPx(null); return; }
    let cancelled = false;
    mapRef.current.getPointInView([telemetry.sample.lon, telemetry.sample.lat])
      .then((pt: [number, number]) => { if (!cancelled) setScreenAnchorPx(pt); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isFree2D, telemetry.sample?.lat, telemetry.sample?.lon, mapBearingDeg, mapZoomLevel]);
  // Whichever heading is actually meaningful for how the phone is currently
  // expected to be held: flat/screen-up in pure map mode (top-edge heading),
  // upright/screen-towards-you once the camera is showing (camera-forward
  // heading — the same one used for aiming/hit-validation). It used to
  // always read telemetry.heading regardless of mode, which is the
  // camera-forward sensor even while the phone is held flat for a pure map
  // view — that mismatch against the map's own rotation (which already
  // correctly switched on hasCam) is what produced a reported "hybrid" cone
  // in comic3d: map rotates by top-edge heading, the old cone overlay
  // rotated by camera-forward heading, disagreeing the moment the two
  // sensor readings diverged (any non-flat, non-upright hold).
  const activeHeadingDeg = hasCam ? telemetry.heading : telemetry.topEdgeHeadingDeg;
  activeHeadingDegRef.current = activeHeadingDeg;
  // Shot-range indicator: TWO independent layers (see ShotOverlay below),
  // not one geo-referenced shape baked into the same MapView as the map
  // tiles. That used to still visibly "swim" against the map's own native
  // rotation even once both were driven by the identical activeHeadingDeg
  // value (reported again after two earlier fixes) — MapLibre's native
  // Camera.heading transform and a ShapeSource geometry update go through
  // separate, independently-scheduled native paint passes, so they can
  // still land a frame apart under rapid heading changes even with matching
  // source data. A plain screen-space View with its own `transform: rotate`
  // has no such second pipeline to race against.
  //  - compass/3D view modes: the MAP layer rotates (native Camera.heading);
  //    the overlay applies NO rotation of its own, so it just stays
  //    screen-fixed "pointing up" while the world turns under it — nothing
  //    to desync since it never re-renders on a heading change at all.
  //  - map/2D mode: the map only rotates via the user's own manual gesture,
  //    never the compass — the OVERLAY layer rotates instead, driven by
  //    activeHeadingDeg minus the map's own live bearing (mapBearingDeg,
  //    read back from the MapView itself below), so it keeps pointing the
  //    real heading regardless of how the user has the map oriented.

  // Approximate hit range around own position (toggleable)
  const rangeGeoJSON = useMemo(() => {
    if (!showRange || !telemetry.sample) return null;
    const origin = { lat: telemetry.sample.lat, lon: telemetry.sample.lon };
    const pts: [number, number][] = [];
    for (let i = 0; i <= 48; i++) {
      const p = destinationPoint(origin, (i / 48) * 360, effectiveMaxRangeM);
      pts.push([p.lon, p.lat]);
    }
    return {
      type: 'Feature' as const, properties: {},
      geometry: { type: 'Polygon' as const, coordinates: [pts] },
    };
  }, [showRange, telemetry.sample?.lat, telemetry.sample?.lon, effectiveMaxRangeM]);

  // The directional cone/lane itself is now the screen-space ShotOverlay
  // layer (see its own component below + renderMap) instead of a geo
  // ShapeSource here — only the rotation-invariant omni range circle/ring
  // above stays map-anchored.

  // Zones (domination), targets (Zerstören), bases (CTF/Deathmatch) as
  // circles — real-world-meter-accurate polygons (not CircleLayer's
  // screen-pixel radius, which wouldn't scale correctly with zoom), same
  // technique as the shot-range ring/lane above.
  const zoneCircle = (lat: number, lon: number, radiusM: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 32; i++) {
      const p = destinationPoint({ lat, lon }, (i / 32) * 360, radiusM);
      pts.push([p.lon, p.lat]);
    }
    return pts;
  };
  // Unified list of every zone/target/base marker, used for both the base
  // fill/outline and the "portal" glow layered underneath it.
  const markerEntities = useMemo(() => {
    const ents: { id: string; lat: number; lon: number; radiusM: number; color: string }[] = [];
    for (const z of snap?.zones || []) {
      ents.push({ id: 'z_' + z.id, lat: z.lat, lon: z.lon, radiusM: z.radiusM,
        color: z.owner ? colorForKey(z.owner) : '#c0c0c0' });
    }
    for (const t of snap?.targets || []) {
      if (t.destroyed) continue; // destroyed targets are gone, nothing left to draw
      ents.push({ id: 't_' + t.id, lat: t.lat, lon: t.lon, radiusM: t.radiusM,
        color: t.active ? '#f0c840' : '#605850' });
    }
    if (snap?.bases) {
      for (const key of Object.keys(snap.bases)) {
        const b = snap.bases[key];
        if (b) ents.push({ id: 'base_' + key, lat: b.lat, lon: b.lon, radiusM: snap.zoneRadiusM || 15, color: colorForKey(key) });
      }
    }
    return ents;
  }, [JSON.stringify(snap?.zones), JSON.stringify(snap?.targets), JSON.stringify(snap?.bases), snap?.zoneRadiusM]);

  const zonesGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: markerEntities.map(e => ({
      type: 'Feature' as const, properties: { color: e.color },
      geometry: { type: 'Polygon' as const, coordinates: [zoneCircle(e.lat, e.lon, e.radiusM)] },
    })),
  }), [markerEntities]);

  // "Portal" effect: 2 translucent glow rings underneath every marker,
  // larger and fainter the further out — stacked low-opacity fills read as
  // a soft radial glow (no native blur in MapLibre GL), giving the flat
  // circle some depth instead of a plain flat disc.
  const portalGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: markerEntities.flatMap(e => ([
      { type: 'Feature' as const, properties: { color: e.color, op: 0.05 },
        geometry: { type: 'Polygon' as const, coordinates: [zoneCircle(e.lat, e.lon, e.radiusM * 1.7)] } },
      { type: 'Feature' as const, properties: { color: e.color, op: 0.10 },
        geometry: { type: 'Polygon' as const, coordinates: [zoneCircle(e.lat, e.lon, e.radiusM * 1.35)] } },
      // Bright inner core, well inside the capture radius — the "event
      // horizon" at the portal's center.
      { type: 'Feature' as const, properties: { color: e.color, op: 0.35 },
        geometry: { type: 'Polygon' as const, coordinates: [zoneCircle(e.lat, e.lon, e.radiusM * 0.3)] } },
    ])),
  }), [markerEntities]);

  // Flow-ring: an arc drawn AT the marker's own radius, sweeping proportional
  // to capture/defuse/pickup progress, colored by the progressing team —
  // replaces the old raw "%" text with a ring that visibly fills/overwrites
  // instead. Remaining time (not %) is shown as text separately (scoreLine).
  const arcLine = (lat: number, lon: number, radiusM: number, pct: number) => {
    const sweep = Math.max(0, Math.min(100, pct)) / 100 * 360;
    if (sweep <= 0) return null;
    const steps = Math.max(2, Math.round(sweep / 6));
    const pts: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const p = destinationPoint({ lat, lon }, (i / steps) * sweep, radiusM);
      pts.push([p.lon, p.lat]);
    }
    return pts;
  };
  const flowRingGeoJSON = useMemo(() => {
    const feats: any[] = [];
    const push = (lat: number, lon: number, radiusM: number, key: string | undefined, pct: number) => {
      const line = arcLine(lat, lon, radiusM, pct);
      if (line) feats.push({ type: 'Feature', properties: { color: colorForKey(key) },
        geometry: { type: 'LineString', coordinates: line } });
    };
    for (const z of snap?.zones || []) {
      if (z.capture) push(z.lat, z.lon, z.radiusM, z.capture.team ?? z.capture.userId, z.capture.pct);
    }
    const activeTarget = (snap?.targets || []).find(t => t.active);
    if (activeTarget) {
      if (snap?.capture) push(activeTarget.lat, activeTarget.lon, activeTarget.radiusM, snap.capture.team ?? snap.capture.userId, snap.capture.pct);
      if (snap?.armed) push(activeTarget.lat, activeTarget.lon, activeTarget.radiusM, 'b', snap.armed.defusePct);
    }
    if (snap?.bases) {
      for (const f of snap.flags || []) {
        const raider = f.pickupTeam ?? f.pickupBy ?? null;
        if (raider) {
          const raidedBase = snap.bases[(f.team ?? f.owner)!];
          if (raidedBase) push(raidedBase.lat, raidedBase.lon, snap.zoneRadiusM || 15, raider, f.pickupPct || 0);
        }
      }
    }
    return { type: 'FeatureCollection' as const, features: feats };
  }, [JSON.stringify(snap?.zones), JSON.stringify(snap?.targets), JSON.stringify(snap?.capture),
      JSON.stringify(snap?.armed), JSON.stringify(snap?.flags), JSON.stringify(snap?.bases), snap?.zoneRadiusM]);

  // The hitbox/cross/camera-target overlay is a strong aim-assist — showing it
  // just because a position happens to be visible (teammate, flag-carrier)
  // would be too strong. It appears for opponents currently pinged by an
  // active detection means: a radar contact, a geofence exposure (they left
  // the field — visible to everyone, so the aim-assist is fair game too), or
  // (once a future perk actually reveals a position — drone currently only
  // gives a boolean proximity alert, no position, so it can't drive this yet)
  // another perk, or a debug session with the debug overlay open.
  const activeRevealIds = useMemo(() => {
    const ids = new Set(radarContacts.map(c => c.userId));
    for (const p of snap?.players || []) if (p.exposed) ids.add(p.userId);
    if (debugMode && debugOpen) {
      for (const p of snap?.players || []) if (p.userId !== me?.id) ids.add(p.userId);
    }
    return ids;
  }, [radarContacts, debugMode, debugOpen, JSON.stringify(snap?.players), me?.id]);

  // The real (planned) IR hit zone is a fixed 2x2m physical box, not a wide
  // angular cone — this previews that exact footprint at each visible
  // opponent's position, north/east-aligned.
  const HITBOX_SIZE_M = 2;
  const hitboxSquare = (lat: number, lon: number, sizeM: number) => {
    const diag = Math.SQRT2 * (sizeM / 2);
    return [45, 135, 225, 315, 45].map(brg => {
      const p = destinationPoint({ lat, lon }, brg, diag);
      return [p.lon, p.lat] as [number, number];
    });
  };
  const HOT_COLOR = '#ff2fd8';
  const NORMAL_COLOR = '#ff7828';
  const hitboxGeoJSON = useMemo(() => {
    const feats: any[] = [];
    if (!showRange) return { type: 'FeatureCollection' as const, features: feats };
    for (const p of snap?.players || []) {
      if (p.userId === me?.id || typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      if (!activeRevealIds.has(p.userId)) continue;
      const inCone = visibleEnemies.find(e => e.userId === p.userId)?.inCone;
      feats.push({
        type: 'Feature',
        properties: { color: inCone ? HOT_COLOR : NORMAL_COLOR, op: (inCone ? 0.22 : 0.35) * OVERLAY_OPACITY * 2 },
        geometry: { type: 'Polygon', coordinates: [hitboxSquare(p.lat, p.lon, HITBOX_SIZE_M)] },
      });
    }
    return { type: 'FeatureCollection' as const, features: feats };
  }, [showRange, JSON.stringify(snap?.players), me?.id, visibleEnemies, activeRevealIds]);

  // A visible hit-confirmation cross inside the box, only for opponents
  // currently in the shooting cone — the "hot" feedback the map version and
  // the camera overlay both draw identically.
  const hitboxCrossGeoJSON = useMemo(() => {
    const feats: any[] = [];
    if (!showRange) return { type: 'FeatureCollection' as const, features: feats };
    for (const p of snap?.players || []) {
      if (p.userId === me?.id || typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
      if (!activeRevealIds.has(p.userId)) continue;
      if (!visibleEnemies.find(e => e.userId === p.userId)?.inCone) continue;
      const diag = Math.SQRT2 * (HITBOX_SIZE_M / 2);
      const a = destinationPoint({ lat: p.lat, lon: p.lon }, 45, diag);
      const b = destinationPoint({ lat: p.lat, lon: p.lon }, 225, diag);
      const c = destinationPoint({ lat: p.lat, lon: p.lon }, 135, diag);
      const d = destinationPoint({ lat: p.lat, lon: p.lon }, 315, diag);
      feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] } });
      feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[c.lon, c.lat], [d.lon, d.lat]] } });
    }
    return { type: 'FeatureCollection' as const, features: feats };
  }, [showRange, JSON.stringify(snap?.players), me?.id, visibleEnemies, activeRevealIds]);

  const flagsGeoJSON = useMemo(() => {
    const feats: any[] = [];
    for (const f of snap?.flags || []) {
      if (typeof f.lat === 'number') {
        feats.push({ type: 'Feature', properties: { color: colorForKey(f.team ?? f.owner) },
          geometry: { type: 'Point', coordinates: [f.lon!, f.lat!] } });
      }
    }
    return { type: 'FeatureCollection' as const, features: feats };
  }, [JSON.stringify(snap?.flags)]);

  // ── Derived state ─────────────────────────────────────────
  const remainingS = snap?.phaseEndsAt ? Math.max(0, Math.round((snap.phaseEndsAt - snap.serverTime) / 1000)) : 0;

  // Push the same data the phone itself shows (privacy-filtered contacts,
  // comic-map features, phase/timer) to a paired watch every 2s — plenty for
  // a wrist HUD, no need for the 1Hz telemetry rate.
  useEffect(() => {
    if (!watchSync.paired) return;
    const iv = setInterval(() => {
      const contacts = visibleEnemies
        .filter(e => activeRevealIds.has(e.userId))
        .map(e => ({ id: e.userId, bearingDeg: e.bearingDeg, distanceM: e.distanceM, hot: e.inCone }));
      watchSync.push({
        phase: snap?.phase ?? '–',
        remainingS,
        myLat: telemetry.sample?.lat ?? null,
        myLon: telemetry.sample?.lon ?? null,
        headingDeg: telemetry.heading,
        contacts,
        comicFeatures: (snap?.comicMap?.features ?? []).map(f => ({ kind: f.type, points: f.points })),
      });
    }, 2000);
    return () => clearInterval(iv);
  }, [watchSync.paired, snap?.phase, remainingS, telemetry.sample?.lat, telemetry.sample?.lon,
      telemetry.heading, visibleEnemies, activeRevealIds, snap?.comicMap]);
  const isSeeker = snap?.me?.role === 'seeker';
  // Used to key off "does this player have a team" as a stand-in for "is
  // this one of the 4 non-hide_and_seek modes, which all use the 'live'
  // phase (see server's shootPhases)" — broke for the ffa variant of those
  // modes (no team assigned, but still 'live'/'base_setup', never H&S's
  // 'seeking'). subMode is the actual signal, independent of team.
  const isTeamCapableMode = snap?.subMode !== 'hide_and_seek';
  const shootPhase = isTeamCapableMode ? snap?.phase === 'live' : snap?.phase === 'seeking';
  const canShoot = shootPhase && snap?.me?.status === 'alive'
    && (snap?.me?.frozenRemainingMs ?? 0) <= 0
    && (isTeamCapableMode || isSeeker);
  const radarCd = snap?.me?.radarCooldownRemainingMs ?? 0;
  const hitCd = snap?.me?.hitCooldownRemainingMs ?? 0;
  const cloakCd = snap?.me?.cloakCooldownRemainingMs ?? 0;
  const cloakActive = !!snap?.me?.cloakActive;
  const cloakRemainingS = Math.ceil((snap?.me?.cloakRemainingMs ?? 0) / 1000);
  const fakeMarkerCd = snap?.me?.fakeMarkerCooldownRemainingMs ?? 0;
  const fakeMarkerActive = !!snap?.me?.fakeMarkerActive;
  const fakeMarkerRemainingS = Math.ceil((snap?.me?.fakeMarkerRemainingMs ?? 0) / 1000);
  const trapCd = snap?.me?.revealTrapCooldownRemainingMs ?? 0;
  const trapArmed = !!snap?.me?.trapArmed;
  const trapAlert = snap?.me?.trapAlert ?? null;
  const phaseLabel: Toast = snap?.phase === 'hiding' ? { icon: 'ghost', text: 'Versteckphase' }
    : snap?.phase === 'seeking' ? { icon: 'flashlight', text: 'Suchphase' }
    : snap?.phase === 'ended' ? { icon: 'flagCheckered', text: 'Beendet' }
    : (snap?.subMode && snap?.phase && PHASE_LABELS[snap.subMode]?.[snap.phase])
    || (snap?.phase === 'base_setup' ? { icon: 'flag', text: 'Base setzen' }
      : snap?.phase === 'warmup' ? { icon: 'hourglass', text: 'Warmup' }
      : snap?.phase === 'live' ? { icon: 'circle', text: 'Live' } : { icon: 'hourglass', text: '' });
  const frozenMs = snap?.me?.frozenRemainingMs ?? 0;
  // Own-marker status badge: downed (respawn variant, lives left) → arrow
  // toward own base; found (eliminated, or H&S hider caught) → cross, unless
  // it's specifically an H&S hider → ghost instead; H&S seeker still
  // actively hunting → magnifying glass. Own base position is always
  // visible to the player themself (never an opponent's), no privacy
  // concern reusing it here (same field the base-setup UI already reads).
  const ownBadge = useMemo(() => {
    if (!snap?.me) return null;
    const status = snap.me.status;
    if (status === 'downed') {
      const baseKey = snap.teamVariant === 'ffa' ? me?.id : snap.me.team;
      const base = baseKey ? snap.bases?.[baseKey] : null;
      if (!base || !telemetry.sample) return null;
      return { icon: 'navigation' as IconName, color: '#ffffff', bearing: bearingDeg(telemetry.sample, base) };
    }
    if (status === 'found') {
      return snap.subMode === 'hide_and_seek' && snap.me.role === 'hider'
        ? { icon: 'ghost' as IconName, color: '#c0c0ff', bearing: null }
        : { icon: 'closeCircle' as IconName, color: '#ff4040', bearing: null };
    }
    if (snap.subMode === 'hide_and_seek' && snap.me.role === 'seeker' && status === 'alive') {
      return { icon: 'magnify' as IconName, color: '#f0c840', bearing: null };
    }
    return null;
  }, [snap?.me?.status, snap?.me?.team, snap?.me?.role, snap?.subMode, snap?.teamVariant, snap?.bases,
      telemetry.sample?.lat, telemetry.sample?.lon, me?.id]);
  const isCaptainSetup = snap?.phase === 'base_setup' && snap?.me?.isCaptain;
  // Remaining time (not raw %) from a progress percentage + its known total
  // dwell time (snap.timings) — the flow-ring on the map shows the % itself
  // visually, this is just the "how long until it flips" text.
  const pctToRemainingS = (pct: number, totalMs?: number): number | null =>
    totalMs ? Math.max(0, Math.ceil(totalMs * (1 - pct / 100) / 1000)) : null;
  const zerstorenLine = (): string | null => {
    if (!snap || snap.subMode !== 'seek_destroy') return null;
    if (snap.armed) {
      const explodeS = Math.max(0, Math.ceil((snap.armed.explodeAt - snap.serverTime) / 1000));
      const defuseS = snap.armed.defusePct ? pctToRemainingS(snap.armed.defusePct, snap.timings?.defuseDwellMs) : null;
      return `Explosion in ${explodeS}s${defuseS !== null ? ` · entschärft in ${defuseS}s` : ''}`;
    }
    if (snap.capture) {
      const totalMs = snap.destroyVariant === 'defuse' ? snap.timings?.plantDwellMs : snap.timings?.captureDwellMs;
      const s = pctToRemainingS(snap.capture.pct, totalMs);
      const verb = snap.destroyVariant === 'defuse' ? 'Scharf in' : 'Erobert in';
      return s !== null ? `${verb} ${s}s` : null;
    }
    // No active progress: 'defuse' variant has fixed attacker/defender roles,
    // 'instant' doesn't (either team can capture the active target).
    return snap.destroyVariant === 'defuse' ? (snap.me?.team === 'a' ? 'Angreifer' : 'Verteidiger') : 'Ziel aktiv';
  };
  const ffaVariant = snap?.teamVariant === 'ffa';
  const scoreLine: string | null = snap?.subMode === 'domination'
    ? (ffaVariant
        ? `Du: ${snap?.playerScore?.[me?.id || ''] ?? 0} · Ziel ${snap?.targetScore}`
        : `A ${snap?.teamScore?.a ?? 0} : ${snap?.teamScore?.b ?? 0} B · Ziel ${snap?.targetScore}`)
    : snap?.subMode === 'ctf'
    ? (ffaVariant
        ? `Du: ${snap?.captures?.[me?.id || ''] ?? 0} Eroberungen · Ziel ${snap?.targetCaptures}`
        : `A ${snap?.captures?.a ?? 0} : ${snap?.captures?.b ?? 0} B · Ziel ${snap?.targetCaptures}`)
    : snap?.subMode === 'seek_destroy'
    ? zerstorenLine()
    : null;
  const scoreIcon: IconName = snap?.subMode === 'ctf' ? 'flag' : snap?.subMode === 'seek_destroy' ? 'bomb' : 'target';
  // Top-right status-bar indicator — used to always show H&S's "Hider: N",
  // which reads as meaningless noise in the other 4 modes (that counter
  // isn't even tracked for them). Swap in whatever's actually the relevant
  // at-a-glance number per mode; tapping it opens the full ranked roster
  // (rosterOpen below) for anyone who wants more than the one headline stat.
  const statusIndicator: Toast = snap?.subMode === 'ctf'
    ? { icon: 'flag', text: `Flaggen: ${(snap?.flags || []).filter(f => f.state === 'home').length}/${(snap?.flags || []).length} sicher` }
    : snap?.subMode === 'domination'
    ? { icon: 'target', text: `Zonen: ${(snap?.zones || []).filter(z => z.owner).length}/${(snap?.zones || []).length} aktiv` }
    : snap?.subMode === 'seek_destroy'
    ? { icon: 'bomb', text: `Ziele: ${(snap?.targets || []).filter(t => t.destroyed).length}/${(snap?.targets || []).length} zerstört` }
    : snap?.subMode === 'deathmatch'
    ? { icon: 'skull', text: `Gegner: ${(snap?.players || []).filter(p =>
        p.userId !== me?.id && p.status === 'alive' && (ffaVariant || p.team !== snap?.me?.team)
      ).length}` }
    : { icon: isSeeker ? 'flashlight' : 'ghost', text: `Hider: ${snap?.hidersRemaining ?? '–'}` };
  // Only scan for the IR beacon when the host actually picked IR mode — in
  // compass mode (the default) there's nothing to gain from running the
  // frame processor at all, just camera/native overhead and unnecessary
  // exposure to a still-experimental native code path for no benefit.
  const irEnabled = snap?.hitTrackingMode === 'ir';
  // 2D free mode is manually rotated by the user (MapLibre's rotate gesture)
  // — never fight that with a compass-driven heading. Every other map-showing
  // mode is compass-oriented (heading-up).
  const mapHeading = isFree2D ? 0 : (activeHeadingDeg ?? 0);
  const mapPitch = isFree2D ? 0 : (activeHeadingDeg !== null ? 45 : 0);
  // ShotOverlay rotation: screen-fixed (0) wherever the MAP is the layer
  // doing the rotating (mapHeading above already = activeHeadingDeg there);
  // in free-2D mode the map doesn't rotate on its own, so the OVERLAY makes
  // up the difference between the real heading and however the map is
  // currently (manually) oriented.
  const shotOverlayRotateDeg = isFree2D ? (activeHeadingDeg ?? 0) - mapBearingDeg : 0;
  // Standard Web Mercator meters-per-pixel at a given latitude/zoom — lets
  // ShotOverlay's screen-space wedge be sized in real px that match the SAME
  // scale the map's own geo-referenced range ring (rangeGeoJSON) renders at,
  // so the two stay visually congruent instead of the overlay's reach
  // silently disagreeing with the actual max-range circle drawn on the map.
  // The textbook constant (156543.03392) assumes classic 256px raster
  // tiles; MapLibre GL's vector tiles are 512px, i.e. one full zoom level
  // coarser at the same reported zoomLevel — reported (and confirmed): the
  // overlay was rendering exactly half the map's own range-ring diameter
  // with the 256px constant. +1 to the exponent (equivalently doubling the
  // constant) corrects for the 512px tile convention.
  const metersPerPixel = (latDeg: number, zoom: number) =>
    (156543.03392 * Math.cos(latDeg * Math.PI / 180)) / Math.pow(2, zoom + 1);
  const shotOverlayLengthPx = telemetry.sample
    ? Math.max(8, effectiveMaxRangeM / metersPerPixel(telemetry.sample.lat, mapZoomLevel))
    : 130;
  const recenterMap = () => {
    if (!telemetry.sample) return;
    cameraRef.current?.setCamera({
      centerCoordinate: [telemetry.sample.lon, telemetry.sample.lat],
      zoomLevel: 16.5, heading: 0, pitch: 0, animationDuration: 300,
    });
  };

  if (telemetry.granted === false) {
    return (
      <View style={[st.wrap, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ color: '#ff6040', fontSize: 15, textAlign: 'center', padding: 24 }}>
          Ohne Standort-Berechtigung kann AR Ops nicht spielen.{'\n'}Bitte in den Einstellungen erlauben.
        </Text>
        {/* Reported: this could be reached and then never leave, forcing a
            full app restart, even with permission actually available — this
            hook's own permission request is independent of whatever the
            Lobby screen already triggered moments earlier, so a transient
            hiccup on THIS particular call could land here without it being
            a real denial. Retry re-asks instead of being a dead end. */}
        <TouchableOpacity style={st.permRetryBtn} onPress={telemetry.retryPermission}>
          <Icon name="crosshair" size={16} color={theme.accent} />
          <Text style={st.permRetryTxt}>Erneut versuchen</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const onMapPress = (feature: any) => {
    const c = feature?.geometry?.coordinates;
    if (!Array.isArray(c)) return;
    if (isCaptainSetup) { setBase(c[1], c[0]); return; }
    // Any other tap on the map (outside base-setup) drops a team ping —
    // see usePing above.
    usePing(c[1], c[0]);
  };
  // The comic map is a nice-to-have (host-generated, needs OpenStreetMap's rate-
  // limited Overpass API) — if it was never generated or the fetch failed, fall
  // back to plain OSM tiles instead of an empty background so the match is still
  // playable with a real map underneath.
  const hasComicMap = (snap?.comicMap?.features?.length ?? 0) > 0;
  const renderMap = (interactive: boolean, free2d: boolean = false) => (
    <View style={{ flex: 1 }}>
    <MapView ref={mapRef} style={{ flex: 1 }} mapStyle={(hasComicMap ? comicMapStyle : (isDarkUiTheme ? OSM_STYLE_DARK : OSM_STYLE)) as any} onPress={onMapPress}
      scrollEnabled={interactive} zoomEnabled={interactive} rotateEnabled={free2d}
      // Zoom can change whenever zoomEnabled/`interactive` is true, in every
      // view mode (not just free-2D) — tracked here regardless of free2d so
      // ShotOverlay's meters-per-pixel sizing (shotOverlayLengthPx) stays
      // correct if the player pinch-zooms in compass/3D mode too. Bearing is
      // only ever read back for the free-2D rotation calc, but there's no
      // harm updating it here unconditionally as well.
      onRegionIsChanging={interactive ? onMapRegionChange : undefined}
      onRegionDidChange={interactive ? onMapRegionChange : undefined}>
      {/* Pitch only once the compass is actually driving the rotation — a
          tilted-but-static (non-rotating) map reads as broken, not "3D".
          The free-2D mode is uncontrolled (defaultSettings, no ref-less
          re-render fighting the user's own pan/rotate/zoom gestures) — only
          the re-center button below moves it imperatively after that. */}
      {free2d ? (
        <Camera ref={cameraRef}
          defaultSettings={{ centerCoordinate: center, zoomLevel: 16.5, heading: 0, pitch: 0 }}
          animationDuration={250} />
      ) : (
        // animationDuration=0 (unlike the free2d Camera above): heading comes
        // from the live compass and changes on every telemetry tick, same as
        // hitboxGeoJSON below — that redraws instantly on each tick since
        // it's plain synchronous geometry, but an eased transition here would
        // still be mid-flight catching up to the previous tick's heading when
        // the next one already lands, so the map perpetually lags a beat
        // behind everything drawn on it instead of staying rigidly pinned
        // together — reported as the hitbox overlay "swaying" on its own in
        // 3D mode instead of just rotating along with the map.
        <Camera centerCoordinate={center} zoomLevel={16.5} heading={mapHeading}
          pitch={mapPitch} animationDuration={0} />
      )}
      {hasComicMap && <ComicMapLayers features={snap!.comicMap!.features} />}
      {fadeGeoJSON && (
        <ShapeSource id="fade" shape={fadeGeoJSON as any}>
          <FillLayer id="fadeFill" style={{ fillColor: '#05040a', fillOpacity: ['get', 'op'] as any }} />
        </ShapeSource>
      )}
      {/* Bomber (omni) has no aim direction at all — a circle is the honest
          shape for "hit anything within range, any direction", and stays
          map-anchored since a circle is rotation-invariant either way.
          Everyone else (cone: Scout/default, lateral: Sniper) gets the
          directional corridor instead, via the screen-space ShotOverlay
          layer below (outside this MapView) rather than a shape here — see
          the "Shot-range indicator" comment near activeHeadingDeg above. */}
      {myHitShape === 'omni' && rangeGeoJSON && (
        <ShapeSource id="range" shape={rangeGeoJSON}>
          <FillLayer id="rangeFill" style={{ fillColor: classAccentColor, fillOpacity: 0.5 }} />
        </ShapeSource>
      )}
      {/* Range ring — every class, not just Bomber: a thin dashed outline at
          the full max-range circle, regardless of the class's actual
          directional shape. Gives a quick "how far could I possibly reach in
          any direction" reference even for Scout/Sniper's narrower cone/lane. */}
      {rangeGeoJSON && (
        <ShapeSource id="rangeRing" shape={rangeGeoJSON}>
          <LineLayer id="rangeRingLine" style={{ lineColor: classAccentColor, lineWidth: 1.5, lineOpacity: 0.6, lineDasharray: [2, 2] as any }} />
        </ShapeSource>
      )}
      {hitboxGeoJSON.features.length > 0 && (
        <ShapeSource id="hitboxes" shape={hitboxGeoJSON as any}>
          <FillLayer id="hitboxFill" style={{ fillColor: ['get', 'color'] as any, fillOpacity: ['get', 'op'] as any }} />
          <LineLayer id="hitboxLine" style={{ lineColor: ['get', 'color'] as any, lineWidth: 2 }} />
        </ShapeSource>
      )}
      {hitboxCrossGeoJSON.features.length > 0 && (
        <ShapeSource id="hitboxCross" shape={hitboxCrossGeoJSON as any}>
          <LineLayer id="hitboxCrossLine" style={{ lineColor: HOT_COLOR, lineWidth: 2.5 }} />
        </ShapeSource>
      )}
      {portalGeoJSON.features.length > 0 && (
        <ShapeSource id="portals" shape={portalGeoJSON as any}>
          <FillLayer id="portalFill" style={{ fillColor: ['get', 'color'] as any, fillOpacity: ['get', 'op'] as any }} />
        </ShapeSource>
      )}
      {zonesGeoJSON.features.length > 0 && (
        <ShapeSource id="zones" shape={zonesGeoJSON as any}>
          <FillLayer id="zoneFill" style={{ fillColor: ['get', 'color'] as any, fillOpacity: 0.14 }} />
          <LineLayer id="zoneLine" style={{ lineColor: ['get', 'color'] as any, lineWidth: 2 }} />
        </ShapeSource>
      )}
      {flowRingGeoJSON.features.length > 0 && (
        <ShapeSource id="flowRings" shape={flowRingGeoJSON as any}>
          <LineLayer id="flowRingLine" style={{ lineColor: ['get', 'color'] as any, lineWidth: 5, lineOpacity: 0.9 }} />
        </ShapeSource>
      )}
      {flagsGeoJSON.features.length > 0 && (
        <ShapeSource id="flags" shape={flagsGeoJSON as any}>
          <CircleLayer id="flagDots" style={{
            circleRadius: 6, circleColor: ['get', 'color'] as any,
            circleStrokeWidth: 2, circleStrokeColor: '#000000',
          }} />
        </ShapeSource>
      )}
      {actorsGeoJSON.features.length > 0 && (
        <ShapeSource id="actors" shape={actorsGeoJSON as any}>
          <CircleLayer id="actorDots" style={{
            circleRadius: 9, circleColor: ['get', 'color'] as any,
            circleStrokeWidth: 2, circleStrokeColor: '#ffffff', circleOpacity: ['get', 'op'] as any,
            // 'map' instead of the default 'viewport': the own-position dot
            // (first feature pushed into actorsGeoJSON, from telemetry.sample)
            // shares this single layer/style with every other actor dot
            // (teammates, enemies, radar contacts) — circlePitchAlignment is
            // a whole-layer paint property, not per-feature, so this tilts
            // all of them together with the map plane instead of always
            // facing the camera flat-on. Unlike LobbyScreen's map, this one's
            // Camera does set a real non-zero pitch (mapPitch, 45° once the
            // compass is driving 3D/compass mode — see mapPitch above), so
            // the effect is actually visible here.
            circlePitchAlignment: 'map',
          }} />
        </ShapeSource>
      )}
      {pingsGeoJSON.features.length > 0 && (
        <ShapeSource id="pings" shape={pingsGeoJSON as any}>
          <CircleLayer id="pingRings" style={{
            circleRadius: 16, circleColor: 'transparent',
            circleStrokeWidth: 3, circleStrokeColor: '#40e0ff', circleStrokeOpacity: ['get', 'op'] as any,
          }} />
        </ShapeSource>
      )}
    </MapView>
    {showRange && telemetry.sample && activeHeadingDeg !== null && (
      <ShotOverlay rotateDeg={shotOverlayRotateDeg} pitchDeg={mapPitch}
        lengthPx={shotOverlayLengthPx} anchorPx={screenAnchorPx} myHitShape={myHitShape}
        effectiveConeHalfAngleDeg={effectiveConeHalfAngleDeg} color={classAccentColor} />
    )}
    {/* Own-marker state feedback — screen-center anchor only holds in
        controlled-camera views (map locked to the player's own position,
        see the Camera above); free-2D lets the player pan away from their
        own dot, so there's no fixed screen point to anchor a ring/badge to
        there — same scoping ShotOverlay itself already has via its anchorPx
        param. */}
    {!isFree2D && telemetry.sample && snap?.timings?.freezeMs && frozenMs > 0 && (
      <FreezeRing progress={frozenMs / snap.timings.freezeMs} color="#a0d8ff" />
    )}
    {!isFree2D && telemetry.sample && frozenMs <= 0 && ownBadge && (
      <OwnMarkerBadge icon={ownBadge.icon} color={ownBadge.color}
        rotateDeg={ownBadge.bearing !== null ? ownBadge.bearing - (activeHeadingDeg ?? 0) : undefined} />
    )}
    </View>
  );

  const crosshair = (
    <View style={st.crosshair} pointerEvents="none">
      <View style={st.chH} /><View style={st.chV} />
      <View style={st.chRing} />
    </View>
  );

  // Same hitbox markers as the map view, projected onto the camera preview by
  // heading offset so both views agree ("muss konsistent sein"). No pitch/
  // elevation compensation yet (no device data for it) — markers sit on a
  // fixed horizontal band, correct only while holding the phone level. FOV is
  // an approximation of the rear camera preview, not read from device
  // intrinsics.
  const CAMERA_FOV_DEG = 65;
  const screenW = Dimensions.get('window').width;
  const cameraTargets = useMemo(() => {
    if (!showRange || telemetry.heading === null) return [];
    const heading = telemetry.heading;
    return visibleEnemies.filter(e => activeRevealIds.has(e.userId)).map(e => {
      let delta = e.bearingDeg - heading;
      delta = ((delta + 540) % 360) - 180; // normalize to -180..180
      if (Math.abs(delta) > CAMERA_FOV_DEG / 2 + 8) return null; // off-screen
      const x = screenW * (0.5 + delta / CAMERA_FOV_DEG);
      const angularSizeDeg = (180 / Math.PI) * (2 * Math.atan(1 / Math.max(2, e.distanceM)));
      const size = Math.min(110, Math.max(20, (angularSizeDeg / CAMERA_FOV_DEG) * screenW));
      return { userId: e.userId, distanceM: e.distanceM, inCone: e.inCone, x, size };
    }).filter((t): t is { userId: string; distanceM: number; inCone: boolean; x: number; size: number } => t !== null);
  }, [showRange, telemetry.heading, visibleEnemies, screenW, activeRevealIds]);

  // Camera preview of the 2m lane: honest perspective would need device pitch
  // (how far down the phone is tilted) to place near/far correctly, which we
  // don't read yet — so this fakes a converging "alley" using fixed vertical
  // anchors instead of real elevation, valid mainly when holding the phone
  // roughly level. Rendered as one continuous tapering bar (dense stacked
  // bands, no gaps) rather than discrete rungs — same distance-based width
  // math the map's ground-projected cone polygon uses, just screen-projected.
  // top/height are percentages of whatever container this renders into
  // (not the device's full height) — split mode shows this in a half-height
  // box, and a fixed-pixel calc against the full screen made the bands land
  // outside that box's actual bounds there.
  const LANE_NEAR_M = 6;
  const LANE_BANDS = 40;
  const laneBands = useMemo(() => {
    // Lateral (Sniper) only now — Cone (Scout/default) renders as a
    // constant-angular-width band instead (coneCameraOverlay below), it
    // doesn't taper the way a fixed-meters lane does.
    if (!showRange || telemetry.heading === null || myHitShape !== 'lateral') return [];
    const yTopPct = 42, yBotPct = 99;
    const out: { topPct: number; heightPct: number; wPx: number }[] = [];
    for (let i = 0; i < LANE_BANDS; i++) {
      const t0 = i / LANE_BANDS, t1 = (i + 1) / LANE_BANDS, tMid = (t0 + t1) / 2;
      const d = LANE_NEAR_M + tMid * (effectiveMaxRangeM - LANE_NEAR_M);
      const angDeg = (180 / Math.PI) * 2 * Math.atan((effectiveLaneWidthM / 2) / d);
      const physicalWpx = Math.max(3, (angDeg / CAMERA_FOV_DEG) * screenW);
      // The bottom edge spans the full screen width (an obvious, dramatic
      // "gun-sight" funnel) and narrows to the physically-accurate lane
      // width right at the crosshair/vanishing point — accuracy matters
      // most exactly there, not at the near edge.
      const wPx = screenW * (1 - tMid) + physicalWpx * tMid;
      const pct0 = yBotPct - t0 * (yBotPct - yTopPct);
      const pct1 = yBotPct - t1 * (yBotPct - yTopPct);
      out.push({ topPct: pct1, heightPct: pct0 - pct1 + 0.3, wPx });
    }
    return out;
  }, [showRange, telemetry.heading, myHitShape, screenW, effectiveMaxRangeM, effectiveLaneWidthM]);

  // Every camera-view shot area is a flat 50%-opacity filled region — no
  // thin "Striche" (the old Bomber marker was literally just a 3px line) —
  // plus a 75%-opacity frame for definition against the busy camera feed
  // (the map versions of these shapes deliberately stay borderless, see
  // coneFill/rangeFill above — this is camera-only).
  const AIM_AREA_OPACITY = 0.5;
  const AIM_BORDER_OPACITY = 0.75;

  // Sniper only — tapering funnel for a fixed-METERS lane (perspective
  // genuinely narrows a constant-meters width as distance grows, so the
  // converging "gun-sight" look is physically honest here). Frame: only the
  // LEFT/RIGHT edge of each band gets a border (not top/bottom) — bands sit
  // flush against each other, so a full border per band would draw a seam
  // line at every single one of the 40 band boundaries; left/right-only
  // instead traces just the funnel's own tapering outline. First/last band
  // additionally close off the near/far edge.
  const laneOverlay = (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {laneBands.map((b, i) => (
        <View key={i} style={{
          position: 'absolute', top: `${b.topPct}%`, left: '50%', marginLeft: -b.wPx / 2,
          width: b.wPx, height: `${b.heightPct}%`, backgroundColor: hexToRgba(classAccentColor, AIM_AREA_OPACITY),
          borderLeftWidth: 1.5, borderRightWidth: 1.5, borderColor: hexToRgba(classAccentColor, AIM_BORDER_OPACITY),
          borderBottomWidth: i === 0 ? 1.5 : 0, borderTopWidth: i === laneBands.length - 1 ? 1.5 : 0,
        }} />
      ))}
    </View>
  );

  // Scout/default (cone) — a constant ANGULAR width, unlike Sniper's fixed-
  // meters lane above. Screen-space horizontal position already IS angular
  // offset from the aim direction (see cameraTargets' own x calculation
  // below), so a true angle-based cone viewed from the shooter's own apex
  // doesn't taper with distance at all — it's the same width at the near
  // edge as right at the crosshair. Previously reused the same tapering
  // funnel as Sniper, which visually (and incorrectly) implied the shot got
  // narrower/more precise at range, the opposite of what actually widens.
  // Reported: too wide on a large field, and separately still too wide even
  // at a normal field size — a literal angle→px projection against the
  // camera's own FOV (CAMERA_FOV_DEG=65°) is technically the "honest"
  // width (that's really how much of a 65°-wide view a 34°-wide cone
  // occupies), but it reads as visually dominating/overwhelming the whole
  // screen rather than as a focused aim reference. VISUAL_SCALE pulls the
  // band in regardless of field size — no longer a literal 1:1 FOV
  // projection, a deliberately narrower stylized band — with a lower
  // absolute cap (50% of screen width) for whatever's left of the earlier
  // large-field case (cone angle exceeding the camera's own FOV entirely).
  const CONE_CAMERA_VISUAL_SCALE = 0.4;
  const coneCameraWidthPx = Math.min(screenW * 0.5,
    Math.max(3, (2 * effectiveConeHalfAngleDeg / CAMERA_FOV_DEG) * screenW * CONE_CAMERA_VISUAL_SCALE));
  const coneCameraOverlay = (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={{
        position: 'absolute', top: '42%', left: '50%', marginLeft: -coneCameraWidthPx / 2,
        width: coneCameraWidthPx, height: '57%',
        backgroundColor: hexToRgba(classAccentColor, AIM_AREA_OPACITY),
        borderWidth: 1.5, borderColor: hexToRgba(classAccentColor, AIM_BORDER_OPACITY),
      }} />
    </View>
  );

  // Bomber (omni) — no aim direction at all, so the converging "gun-sight"
  // funnel above is actively misleading for this class: it implies you need
  // to point at something. Used to be a single flat 3px line ("keine
  // Zielrichtung nötig"); replaced with an actual filled AREA shaped like a
  // shallow dome/curve (widest and brightest in the center, tapering toward
  // the screen edges — evokes the horizon of an all-around radius rather
  // than a straight bar) with an extra brighter band layered along its near
  // (bottom/foreground) edge — the "highlighted foreground" strip. Doesn't
  // depend on telemetry.heading at all, matching that Bomber doesn't need a
  // compass fix to shoot (see canShoot's class exception server-side).
  const OMNI_BANDS = 28;
  const omniCameraBands = useMemo(() => {
    const yTopPct = 40, yBotPct = 92;
    const out: { topPct: number; heightPct: number; leftPct: number; widthPct: number; opacity: number }[] = [];
    for (let i = 0; i < OMNI_BANDS; i++) {
      const t0 = i / OMNI_BANDS, t1 = (i + 1) / OMNI_BANDS, tMid = (t0 + t1) / 2;
      const curve = Math.sin(tMid * Math.PI); // 0 at the edges, 1 dead center — the dome silhouette
      const nearness = 1 - tMid; // 1 at the near/bottom (foreground) edge, 0 at the top
      const widthPct = 8 + curve * 84;
      const pct0 = yBotPct - t0 * (yBotPct - yTopPct);
      const pct1 = yBotPct - t1 * (yBotPct - yTopPct);
      out.push({
        topPct: pct1, heightPct: pct0 - pct1 + 0.3,
        leftPct: (100 - widthPct) / 2, widthPct,
        opacity: AIM_AREA_OPACITY * (0.35 + curve * 0.25 + nearness * 0.4),
      });
    }
    return out;
  }, []); // pure static geometry — color/opacity tinting happens at render time below
  const radiusArcOverlay = (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {omniCameraBands.map((b, i) => (
        <View key={i} style={{
          position: 'absolute', top: `${b.topPct}%`, left: `${b.leftPct}%`,
          width: `${b.widthPct}%`, height: `${b.heightPct}%`,
          backgroundColor: hexToRgba(classAccentColor, b.opacity),
          borderLeftWidth: 1.5, borderRightWidth: 1.5, borderColor: hexToRgba(classAccentColor, AIM_BORDER_OPACITY),
          borderBottomWidth: i === 0 ? 1.5 : 0, borderTopWidth: i === omniCameraBands.length - 1 ? 1.5 : 0,
        }} />
      ))}
      <Text style={{
        position: 'absolute', top: '32%', left: 0, right: 0, textAlign: 'center',
        color: '#fff', fontSize: 11, fontWeight: '800',
      }}>
        Radius {Math.round(effectiveMaxRangeM)}m — keine Zielrichtung nötig
      </Text>
    </View>
  );

  // omni (Bomber) → radius marker, no direction. lateral (Sniper) → tapering
  // meters-wide funnel. cone (Scout/default) → constant-width angular band.
  const aimOverlay = myHitShape === 'omni' ? radiusArcOverlay
    : myHitShape === 'lateral' ? laneOverlay
    : coneCameraOverlay;

  // Persistent "which hitbox is loaded" badge — shown across every view mode
  // (comic2d/3d, split, overlay, camera) whenever the Schussbereich/showRange
  // preview is on, same gate as the cone/lane/hitbox visuals above so it only
  // appears alongside the thing it's explaining. Rendered once here (not
  // duplicated inside laneOverlay/radiusArcOverlay, which only mount inside
  // camera-showing modes) so map-only modes get the same clarity.
  const classInfoBadge = showRange && (
    <View style={st.classBadge} pointerEvents="none">
      <Icon name={classIcon} size={13} color={classAccentColor} />
      <Text style={[st.classBadgeTxt, { color: classAccentColor }]} numberOfLines={1}>
        {classLabel} · {classStatText}
      </Text>
    </View>
  );

  const targetOverlay = (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {cameraTargets.map(t => (
        <View key={t.userId} style={{
          position: 'absolute', left: t.x - t.size / 2, top: '48%', width: t.size, height: t.size,
          marginTop: -t.size / 2, borderRadius: 4, alignItems: 'center', justifyContent: 'center',
          borderWidth: 2, borderColor: t.inCone ? HOT_COLOR : NORMAL_COLOR,
          backgroundColor: t.inCone
            ? `rgba(255,47,216,${(0.22 * OVERLAY_OPACITY * 2).toFixed(2)})`
            : `rgba(255,120,40,${(0.35 * OVERLAY_OPACITY * 2).toFixed(2)})`,
        }}>
          {t.inCone && (
            <>
              <View style={{ position: 'absolute', width: '150%', height: 2, backgroundColor: HOT_COLOR, transform: [{ rotate: '45deg' }] }} />
              <View style={{ position: 'absolute', width: '150%', height: 2, backgroundColor: HOT_COLOR, transform: [{ rotate: '-45deg' }] }} />
            </>
          )}
          <Text style={st.targetDist}>{Math.round(t.distanceM)}m</Text>
        </View>
      ))}
    </View>
  );

  // Shooting works identically in every view mode now — no more "switch to
  // camera to shoot" fallback button.
  const centerButton = canShoot && (
    <TouchableOpacity style={[st.shutter, hitCd > 0 && st.shutterCd]} onPress={shoot} disabled={hitCd > 0}>
      {hitCd > 0 ? <Text style={st.shutterTxt}>{Math.ceil(hitCd / 1000) + 's'}</Text> : <Icon name="photo" size={26} color="#f0c840" />}
    </TouchableOpacity>
  );

  // Bottom bar layout: exactly Radar | Schuss | Klassen-Perk — every player
  // gets precisely 2 actions (plus the shutter), never more. Used to fan out
  // up to 4 extra buttons (Drohne, Cloak, Fake-Marker, Aufscheuchen) across
  // H&S roles/classes; simplified down to the single perk tied to the
  // player's own class (scout → Falle, sniper → Fake-Marker, bomber →
  // Cloak) — Drohne/Aufscheuchen (H&S-role-only, not class-tied) dropped
  // from the bar entirely. Server-side gating for all of these is
  // unchanged (role-bypass paths like "H&S hider also gets Fake-Marker"
  // still work if ever triggered another way), this only simplifies which
  // buttons the client exposes.
  // Glow-border colors: muted purple while recharging (cooldown), cyan while
  // an effect is actively running (cloak/fake-marker) — visually distinct so
  // "still recharging" never reads as "buffed right now".
  const CD_RING_COLOR = '#8a6ad0';
  const ACTIVE_RING_COLOR = '#40e0ff';
  const radarBtn = (
    <TouchableOpacity key="radar" style={[st.radarBtn, st.btnRow]} onPress={useRadar}
      disabled={radarCd > 0 || !shootPhase}>
      {radarCd > 0 && <GlowBorder progress={cdFraction(radarCd, radarCdTotalRef)} color={CD_RING_COLOR} />}
      <Icon name="radar" size={15} color="#c0a0f0" />
      <Text style={st.actTxt}>{radarCd > 0 ? Math.ceil(radarCd / 60_000) + 'min' : 'Radar'}</Text>
    </TouchableOpacity>
  );
  const classPerkBtn = classKey === 'bomber' ? (
    <TouchableOpacity key="cloak" style={[st.radarBtn, st.btnRow]} onPress={useCloak}
      disabled={cloakCd > 0 || cloakActive || !shootPhase}>
      {cloakActive
        ? <GlowBorder progress={cdFraction(snap?.me?.cloakRemainingMs ?? 0, cloakActiveTotalRef)} color={ACTIVE_RING_COLOR} />
        : cloakCd > 0 && <GlowBorder progress={cdFraction(cloakCd, cloakCdTotalRef)} color={CD_RING_COLOR} />}
      <Icon name="ghost" size={15} color="#c0a0f0" />
      <Text style={st.actTxt}>
        {cloakActive ? cloakRemainingS + 's' : cloakCd > 0 ? Math.ceil(cloakCd / 1000) + 's' : 'Cloak'}
      </Text>
    </TouchableOpacity>
  ) : classKey === 'sniper' ? (
    <TouchableOpacity key="fake" style={[st.radarBtn, st.btnRow]} onPress={useFakeMarker}
      disabled={fakeMarkerCd > 0 || !shootPhase}>
      {fakeMarkerActive
        ? <GlowBorder progress={cdFraction(snap?.me?.fakeMarkerRemainingMs ?? 0, fakeActiveTotalRef)} color={ACTIVE_RING_COLOR} />
        : fakeMarkerCd > 0 && <GlowBorder progress={cdFraction(fakeMarkerCd, fakeCdTotalRef)} color={CD_RING_COLOR} />}
      <Icon name="mask" size={15} color="#c0a0f0" />
      <Text style={st.actTxt}>{fakeMarkerCd > 0 ? Math.ceil(fakeMarkerCd / 1000) + 's' : 'Fake'}</Text>
    </TouchableOpacity>
  ) : (
    <TouchableOpacity key="trap" style={[st.radarBtn, st.btnRow]} onPress={useRevealTrap}
      disabled={trapCd > 0 || trapArmed || !shootPhase}>
      {trapCd > 0 && <GlowBorder progress={cdFraction(trapCd, trapCdTotalRef)} color={CD_RING_COLOR} />}
      <Icon name="trap" size={15} color="#c0a0f0" />
      <Text style={st.actTxt}>
        {trapArmed ? 'Aktiv' : trapCd > 0 ? Math.ceil(trapCd / 1000) + 's' : 'Falle'}
      </Text>
    </TouchableOpacity>
  );
  const perkLeft = [radarBtn];
  const perkRight = [classPerkBtn];

  return (
    <View style={st.wrap}>
      {/* Schuss-Feedback — screen-center-anchoriert (wie ShotOverlay), löst
          bei JEDEM abgesetzten Schuss aus (shoot()), unabhängig vom
          Reichweiten-Anzeige-Toggle. */}
      <ShockwaveEffect triggerKey={shotEffectKey} color={classAccentColor} />
      {/* Status bar — single row: timer | phase (centered) | mode indicator
          (tappable for the ranked roster). Used to be phase/timer/indicator
          on one row plus a second row (statusScoreRow) folding in the
          mode-specific score text (Domination/CTF %, Zerstören armed/defuse
          countdown) — reported as reading like two separate banners; the
          score text is still one tap away via the roster, so it's dropped
          here rather than crammed alongside the other three. */}
      <View style={st.status}>
        <View style={st.statusRow}>
          <View style={[st.iconTextRow, st.statusSide]}>
            <Icon name="clock" size={13} color="#80ff80" />
            <Text style={st.timer}>{Math.floor(remainingS / 60)}:{String(remainingS % 60).padStart(2, '0')}</Text>
          </View>
          <View style={[st.iconTextRow, st.statusCenter]}>
            <Icon name={phaseLabel.icon} size={13} color="#f0c840" />
            <Text style={st.phase} numberOfLines={1}>{phaseLabel.text}</Text>
          </View>
          <TouchableOpacity style={[st.iconTextRow, st.statusSide, st.statusSideRight]} onPress={() => setRosterOpen(o => !o)}>
            <Icon name={statusIndicator.icon} size={13} color="#a090c0" />
            <Text style={st.info} numberOfLines={1}>{statusIndicator.text}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {frozenMs > 0 && (
        <View style={st.frozenBanner}>
          <Icon name="snowflake" size={13} color="#04121f" />
          <Text style={st.frozenTxt}>EINGEFROREN — {Math.ceil(frozenMs / 1000)}s · Stehen bleiben! Bewegung verlängert.</Text>
        </View>
      )}
      {snap?.me?.proximityAlert && (
        <View style={st.proxAlert}>
          <Icon name="warning" size={13} color="#fff" />
          <Text style={st.proxTxt}>GEGNER IN DER NÄHE</Text>
        </View>
      )}
      {cloakActive && (
        <View style={st.cloakBanner}>
          <Icon name="ghost" size={13} color="#fff" />
          <Text style={st.cloakTxt}>CLOAK AKTIV — {cloakRemainingS}s</Text>
        </View>
      )}
      {fakeMarkerActive && (
        <View style={st.cloakBanner}>
          <Icon name="mask" size={13} color="#fff" />
          <Text style={st.cloakTxt}>FAKE-MARKER AKTIV — {fakeMarkerRemainingS}s</Text>
        </View>
      )}
      {trapAlert && (
        <View style={st.cloakBanner}>
          <Icon name="trap" size={13} color="#fff" />
          <Text style={st.cloakTxt}>
            FALLE AUSGELÖST — Gegner {Math.round(haversineMeters(
              { lat: telemetry.sample?.lat ?? trapAlert.lat, lon: telemetry.sample?.lon ?? trapAlert.lon },
              trapAlert
            ))}m entfernt
          </Text>
        </View>
      )}
      {snap?.me?.geofence === 'warning' && (
        <View style={st.geoWarn}>
          <Icon name="boundary" size={12} color="#100" />
          <Text style={st.geoTxt}>Spielfeldrand!</Text>
        </View>
      )}
      {snap?.me?.geofence === 'outside' && (
        <View style={st.geoOut}>
          <Icon name="alertOctagon" size={12} color="#100" />
          <Text style={st.geoTxt}>AUSSERHALB — zurück ins Feld!</Text>
        </View>
      )}
      {!!lastResult && (
        <View style={st.result}>
          <Icon name={lastResult.icon} size={13} color="#f0c840" />
          <Text style={st.resultTxt}>{lastResult.text}</Text>
        </View>
      )}

      {/* ── View modes ── */}
      {/*
        Single CameraLayer instance, gated on `hasCam` rather than mounted
        separately per viewMode: switching directly between two camera-using
        modes (split/overlay) used to unmount + remount CameraView in the
        same React commit, racing its native session teardown on Android and
        hanging the camera. Only crossing hasCam's own boundary (camera <->
        pure map) unmounts it now. The shot itself works in every mode — the
        camera preview is only ever a visual backdrop for split/overlay.
      */}
      <View style={{ flex: 1 }}>
        {!hasCam && viewMode === 'comic2d' && renderMap(true, true)}
        {!hasCam && viewMode === 'comic3d' && renderMap(true, false)}
        {!hasCam && viewMode === 'comic2d' && (
          <TouchableOpacity style={st.recenterBtn} onPress={recenterMap}>
            <Icon name="crosshair" size={20} color={theme.accent} />
          </TouchableOpacity>
        )}
        {hasCam && (
          <CameraLayer frameProcessor={irEnabled ? irScan.frameProcessor : undefined}>
            {/* Same crosshair/lane-funnel/target bundle in every camera-showing
                mode — it used to only render correctly in pure camera mode
                (split's half-height container broke the lane math, overlay
                skipped it entirely); consistency matters more here than the
                theoretical double-marker risk the old overlay-mode comment
                worried about. */}
            {viewMode === 'split' && (
              <View style={{ flex: 1 }}>
                <View style={{ flex: 1 }}>{crosshair}{aimOverlay}{targetOverlay}</View>
                <View style={{ flex: 1 }}>{renderMap(false)}</View>
              </View>
            )}
            {viewMode === 'overlay' && (
              <>
                <View style={[StyleSheet.absoluteFill, { opacity: OVERLAY_OPACITY }]} pointerEvents="none">
                  {renderMap(false)}
                </View>
                {crosshair}{aimOverlay}{targetOverlay}
              </>
            )}
            {viewMode === 'camera' && <>{crosshair}{aimOverlay}{targetOverlay}</>}
          </CameraLayer>
        )}
        {classInfoBadge}

        {/* Debug overlay: floats directly over whichever view is active —
            rendered last so it actually paints on top of the native
            MapView/CameraView instead of underneath it; text only, doesn't
            push any other layout down or intercept taps. */}
        {debugMode && debugOpen && (
          <View style={st.debugBar} pointerEvents="none">
            <View style={st.iconTextRow}>
              <Icon name="bug" size={12} color="#40ff80" />
              <Text style={st.debugBarTxt}>Ping {pingMs ?? '–'}ms · {ticksPerSec}/s</Text>
            </View>
            {/* proximityAlert is a passive per-tick server sensor (any
                alive opponent within range, see arops.js's tick loop) —
                separate from the Drone perk's own one-shot alert toast, but
                easy to mistake for "only ever works via the perk" since
                nothing else surfaced its live state. */}
            <View style={st.iconTextRow}>
              <Icon name="warning" size={11} color={snap?.me?.proximityAlert ? '#ff4040' : '#80e0a0'} />
              <Text style={[st.debugBarTxt, snap?.me?.proximityAlert && st.debugBarTxtHot]}>
                proximityAlert: {snap?.me?.proximityAlert ? 'true' : 'false'}
              </Text>
            </View>
            {visibleEnemies.map(e => (
              <View key={e.userId} style={st.iconTextRow}>
                <Icon name={e.inCone ? 'crosshair' : 'circle'} size={11} color={e.inCone ? '#ff4040' : '#80e0a0'} />
                <Text style={[st.debugBarTxt, e.inCone && st.debugBarTxtHot]}>
                  {e.username}: {Math.round(e.distanceM)}m
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Ranked roster — opened by tapping the status bar's mode-specific
            indicator (top right). Uses p.score, already sent for every
            player regardless of role/team fog-of-war (see server's
            getAropsSnapshot roster entry) — same number the endgame overlay
            already shows for "Deine Punkte", just for everyone at once. */}
        {rosterOpen && (
          <TouchableOpacity style={st.rosterOverlay} activeOpacity={1} onPress={() => setRosterOpen(false)}>
            <View style={st.rosterCard}>
              <View style={st.rosterHeader}>
                <Icon name="trophy" size={16} color={theme.accent} />
                <Text style={st.rosterTitle}>Rangliste</Text>
              </View>
              {[...(snap?.players || [])].sort((a, b) => b.score - a.score).map((p, i) => (
                <View key={p.userId} style={st.rosterRow}>
                  <Text style={st.rosterRank}>{i + 1}.</Text>
                  <View style={[st.rosterDot, { backgroundColor: p.team ? TEAM_COLOR[p.team] : (p.avatar_color || '#c0a0f0') }]} />
                  <Text style={[st.rosterName, p.userId === me?.id && st.rosterNameMe]} numberOfLines={1}>
                    {p.username}
                  </Text>
                  {p.status !== 'alive' && <Icon name="skull" size={12} color="#807050" />}
                  <Text style={st.rosterScore}>{p.score}</Text>
                </View>
              ))}
            </View>
          </TouchableOpacity>
        )}
      </View>

      {/* Endgame overlay */}
      {snap?.phase === 'ended' && (() => {
        // Ffa modes (Domination/Bomb/Deathmatch/CTF with teamVariant='ffa')
        // end with a 'player_'+userId winner instead of 'team_a'/'team_b'.
        const end: Toast = snap.winner === 'seekers' ? { icon: 'flashlight', text: 'Seeker gewinnen!' }
          : snap.winner === 'hiders' ? { icon: 'ghost', text: 'Hider gewinnen!' }
          : snap.winner === 'draw' ? { icon: 'handshake', text: 'Unentschieden' }
          : snap.winner === 'player_' + (me?.id || '') ? { icon: 'trophy', text: 'Du gewinnst!' }
          : snap.winner?.startsWith('player_') ? { icon: 'skull', text: 'Jemand anderes gewinnt' }
          : snap.winner === 'team_' + (snap.me?.team || '') ? { icon: 'trophy', text: 'Dein Team gewinnt!' }
          : { icon: 'skull', text: 'Gegner-Team gewinnt' };
        return (
          <View style={st.endOverlay}>
            <TouchableOpacity style={{ alignItems: 'center' }} onPress={() => setEndRecapOpen(o => !o)}>
              <Icon name={end.icon} size={32} color={theme.accent} style={{ marginBottom: 8 }} />
              <Text style={st.endTitle}>{end.text}</Text>
              <Text style={st.endScore}>Deine Punkte: {snap.me?.score ?? 0}</Text>
              {!endRecapOpen && <Text style={st.endHint}>Antippen für Recap</Text>}
            </TouchableOpacity>
            {endRecapOpen && (
              <View style={st.endRecap}>
                {!!scoreLine && (
                  <View style={st.iconTextRow}>
                    <Icon name={scoreIcon} size={13} color={theme.accent} />
                    <Text style={st.endRecapTxt}>{scoreLine}</Text>
                  </View>
                )}
                <View style={st.iconTextRow}>
                  <Icon name={isSeeker ? 'flashlight' : 'ghost'} size={13} color={theme.text2} />
                  <Text style={st.endRecapTxt}>Verbleibende Hider: {snap.hidersRemaining}</Text>
                </View>
                <TouchableOpacity style={st.endExitBtn} onPress={onExit}>
                  <Icon name="home" size={16} color={theme.onAccent} />
                  <Text style={st.endExitTxt}>Beenden</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      })()}

      {/* Views-Popup: Kartenmodus, Schussbereich, Debug. Uhr-Kopplung läuft
          nur noch übers Hauptmenü — hier nur noch ein reiner Status-Icon
          oben links (siehe watchStatusFab unten), kein Kopplungs-Einstieg
          mehr. Als Flyout links neben dem (jetzt direkt über der Action-Bar
          sitzenden) Settings-Button verankert, statt einer vollbreiten
          Leiste über der Bar. */}
      {viewPopupOpen && (
        <View style={[st.viewPopup, { bottom: bottomBarH + 8 }]}>
          <View style={st.modeRow}>
            {MODES.map(m => (
              <TouchableOpacity key={m.id}
                style={[st.modeBtn, viewMode === m.id && st.modeBtnActive]}
                onPress={() => setViewMode(m.id)}>
                <Icon name={m.icon} size={18} color={viewMode === m.id ? theme.accent : theme.text2} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[st.modeBtn, showRange && st.modeBtnActive]}
              onPress={() => setShowRange(r => !r)}>
              <Icon name="target" size={18} color={showRange ? theme.accent : theme.text2} />
            </TouchableOpacity>
            {debugMode && (
              <TouchableOpacity
                style={[st.modeBtn, debugOpen && st.modeBtnActive]}
                onPress={() => setDebugOpen(o => !o)}>
                <Icon name="bug" size={18} color={debugOpen ? theme.accent : theme.text2} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Verbindungs-Icons, oben links, konsistente Reihenfolge + Farbschema:
          IR/ESP → GPS → Uhr. Alle vier Fabs (inkl. Kompass rechts) teilen
          jetzt dieselbe statische Hintergrund-/Rahmenfarbe — vorher hatten
          IR/Uhr zusätzlich modeBtnActive (verändert Hintergrund+Rahmen bei
          "aktiv"), GPS/Kompass nicht, was zwischen den Fabs uneinheitlich
          aussah. Nur noch die Icon-Farbe signalisiert Status: Grün =
          verfügbar/aktiv, gedimmtes Grau = normal aus (nichts Falsches
          daran, z.B. Uhr nicht gekoppelt — Kopplung ist optional und läuft
          nur übers Hauptmenü). IR immer sichtbar (nicht mehr an irEnabled
          gebunden), grau solange keine Kamera-Erkennung läuft/aktiv ist.
          Nur GPS hat einen echten Fehlschlag-Zustand (Rot) und ist deshalb
          antippbar — IR/Uhr haben in-Game nichts, was ein Tap sinnvoll
          neu starten könnte. */}
      <View style={st.espStatusFab}>
        <Icon name="flash" size={18} color={irScan.lastScan && (Date.now() - irScan.lastScan.ts < 3000) ? '#80ff40' : '#605850'} />
      </View>
      {/* GPS-Status — antippbar (erzwingt telemetry.retryPosition, dieselbe
          Aktion wie die frühere volle Banner-Leiste, die diese Fab ersetzt):
          grau = sucht noch (Grace-Zeit läuft), rot = nicht verfügbar (Grace
          um, kein Fix), grün = verfügbar. Zusätzlich alle 15s automatischer
          Retry-Versuch (siehe telemetryRef-Effect oben) — Tippen bleibt
          trotzdem für sofortigen Neustart nützlich. */}
      <TouchableOpacity style={st.gpsStatusFab} onPress={telemetry.retryPosition}>
        <Icon name="crosshair" size={18}
          color={telemetry.sample ? '#80ff40' : initGraceOver ? '#ff6040' : '#605850'} />
      </TouchableOpacity>
      <View style={st.watchStatusFab}>
        <Icon name="watch" size={18} color={watchSync.paired ? '#80ff40' : '#605850'} />
      </View>

      {/* Kompass-Status, oben rechts, spiegelbildlich zur linken Reihe —
          antippbar wie GPS (erzwingt telemetry.retryHeading), automatischer
          15s-Retry solange keine Ausrichtung da ist (siehe
          telemetryRef-Effect oben, gleiches Prinzip wie GPS). Verschwindet
          komplett sobald eine Ausrichtung da ist — kein permanentes
          Icon mehr für einen Zustand, der nichts mehr zu melden hat. */}
      {activeHeadingDeg === null && (
        <TouchableOpacity style={st.compassStatusFab} onPress={telemetry.retryHeading}>
          <Icon name="compass" size={18} color={initGraceOver ? '#ff6040' : '#605850'} />
        </TouchableOpacity>
      )}

      {/* Floating settings toggle — pulled out of the bottom bar so that bar
          can stay exactly Perk1 | Schuss | Perk2, symmetric. Sits directly
          above the action bar (measured height, see bottomBarH) instead of
          floating over the map/overlapping the bar's own buttons. */}
      <TouchableOpacity
        style={[st.settingsFab, { bottom: bottomBarH + 8 }, viewPopupOpen && st.modeBtnActive]}
        onPress={() => setViewPopupOpen(o => !o)}>
        <Icon name="settings" size={20} color={viewPopupOpen ? theme.accent : theme.text2} />
      </TouchableOpacity>

      {/* Bottom bar: Perk1 | Schuss | Perk2 */}
      <View style={st.bottomBar} onLayout={e => {
        // Guard against redundant updates — onLayout can fire again after the
        // resulting re-render even when the height didn't meaningfully
        // change, which would otherwise re-render in a tight loop.
        const h = e.nativeEvent.layout.height;
        setBottomBarH(prev => Math.abs(prev - h) < 1 ? prev : h);
      }}>
        {isCaptainSetup && (
          <TouchableOpacity style={[st.baseBtn, st.btnRow, st.baseBtnRow]} onPress={() => setBase()}>
            <Icon name="flag" size={14} color={theme.accent} />
            <Text style={st.baseTxt}>Base HIER setzen</Text>
          </TouchableOpacity>
        )}
        <View style={st.bottomRow}>
          <View style={st.bottomSide}>{perkLeft}</View>
          <View style={st.bottomCenter}>{centerButton}</View>
          <View style={st.bottomSide}>{perkRight}</View>
        </View>
      </View>
    </View>
  );
}

function makeStyles(theme: ThemeTokens) {
  return StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.bg },
  permRetryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8,
    backgroundColor: theme.bg2, borderWidth: 2, borderColor: theme.accent,
    borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12,
  },
  permRetryTxt: { color: theme.accent, fontWeight: '800', fontSize: 14 },
  status: {
    paddingTop: 52, paddingHorizontal: 16, paddingBottom: 10,
    backgroundColor: theme.bg2,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  // Three-slot single row: timer/indicator each take an equal side flex
  // (indicator's flipped to flex-end so its text hugs the right edge),
  // phase gets a slightly bigger center flex so its label reads as the
  // visual anchor of the bar.
  statusSide: { flex: 1 },
  statusSideRight: { justifyContent: 'flex-end' },
  statusCenter: { flex: 1.3, justifyContent: 'center' },
  iconTextRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  phase: { color: theme.accent, fontWeight: '800', fontSize: 14 },
  timer: { color: '#80ff80', fontWeight: '800', fontSize: 14 },
  info: { color: theme.text2, fontSize: 13 },
  proxAlert: { flexDirection: 'row', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(224,48,32,.9)', padding: 8, alignItems: 'center' },
  cloakBanner: { flexDirection: 'row', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(120,60,200,.9)', padding: 8, alignItems: 'center' },
  cloakTxt: { color: '#fff', fontWeight: '900', fontSize: 13 },
  frozenBanner: { flexDirection: 'row', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(80,160,255,.92)', padding: 8, alignItems: 'center' },
  frozenTxt: { color: '#04121f', fontWeight: '900', fontSize: 12 },
  baseBtn: { backgroundColor: theme.bg2, borderWidth: 2, borderColor: theme.accent, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  baseTxt: { color: theme.accent, fontWeight: '800', fontSize: 13 },
  proxTxt: { color: '#fff', fontWeight: '900', fontSize: 13 },
  geoWarn: { flexDirection: 'row', justifyContent: 'center', gap: 5, backgroundColor: 'rgba(240,200,64,.85)', padding: 6, alignItems: 'center' },
  geoOut: { flexDirection: 'row', justifyContent: 'center', gap: 5, backgroundColor: 'rgba(224,48,32,.95)', padding: 6, alignItems: 'center' },
  geoTxt: { color: '#100', fontWeight: '800', fontSize: 12 },
  result: { flexDirection: 'row', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(20,16,32,.95)', padding: 8, alignItems: 'center' },
  resultTxt: { color: '#f0c840', fontWeight: '800' },
  crosshair: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  chH: { position: 'absolute', width: 50, height: 2, backgroundColor: 'rgba(240,200,64,.8)' },
  chV: { position: 'absolute', width: 2, height: 50, backgroundColor: 'rgba(240,200,64,.8)' },
  chRing: { width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: 'rgba(240,200,64,.5)' },
  targetDist: { position: 'absolute', bottom: -16, color: '#fff', fontSize: 10, fontWeight: '800' },
  shutter: {
    width: 70, height: 70, borderRadius: 35, backgroundColor: 'rgba(240,200,64,.25)',
    borderWidth: 4, borderColor: 'rgba(240,200,64,.5)', alignItems: 'center', justifyContent: 'center',
  },
  shutterCd: { borderColor: '#605030' },
  shutterTxt: { fontSize: 24, color: '#f0c840', fontWeight: '800' },
  endOverlay: {
    position: 'absolute', top: '35%', left: 24, right: 24, backgroundColor: theme.bg2,
    borderWidth: 2, borderColor: theme.accent, borderRadius: 16, padding: 24, alignItems: 'center', zIndex: 50,
  },
  endTitle: { color: theme.accent, fontSize: 22, fontWeight: '900', marginBottom: 8 },
  endScore: { color: '#80ff80', fontSize: 16 },
  endHint: { color: theme.text3, fontSize: 11, marginTop: 8 },
  endRecap: { marginTop: 16, width: '100%', gap: 8, alignItems: 'center' },
  endRecapTxt: { color: theme.text2, fontSize: 13, fontWeight: '700' },
  endExitBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8,
    backgroundColor: theme.accent, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 12,
  },
  endExitTxt: { color: theme.onAccent, fontWeight: '900', fontSize: 15 },
  viewPopup: {
    // Floating flyout anchored to the left of the settings FAB (right: 60 —
    // FAB width 42 + margin) instead of a full-width bar; `bottom` is set
    // inline to match the FAB's own measured offset above the action bar.
    position: 'absolute', right: 60, backgroundColor: theme.bg2,
    borderWidth: 1, borderColor: theme.border, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8, gap: 8, zIndex: 20,
  },
  debugBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center',
    backgroundColor: 'rgba(8,16,8,.25)', borderBottomWidth: 1, borderBottomColor: 'rgba(64,255,128,.5)',
    paddingHorizontal: 12, paddingVertical: 6,
  },
  debugBarTxt: { color: '#a0e0a0', fontSize: 11, fontWeight: '700' },
  debugBarTxtHot: { color: '#ff4040', fontWeight: '900' },
  rosterOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(5,4,10,.7)', alignItems: 'center', justifyContent: 'center', zIndex: 60,
  },
  rosterCard: {
    width: '82%', maxHeight: '70%', backgroundColor: theme.bg2,
    borderWidth: 2, borderColor: theme.accent, borderRadius: 16, padding: 16,
  },
  rosterHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10, justifyContent: 'center' },
  rosterTitle: { color: theme.accent, fontSize: 16, fontWeight: '900' },
  rosterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  rosterRank: { color: theme.text3, fontSize: 12, width: 20 },
  rosterDot: { width: 10, height: 10, borderRadius: 5 },
  rosterName: { color: theme.text, fontSize: 14, flex: 1 },
  rosterNameMe: { color: theme.accent, fontWeight: '900' },
  rosterScore: { color: '#80ff80', fontSize: 14, fontWeight: '800' },
  bottomBar: { backgroundColor: theme.bg2, paddingBottom: 24, paddingTop: 8 },
  modeRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 8 },
  modeBtn: {
    width: 46, height: 40, borderRadius: 8, backgroundColor: theme.bg3,
    borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center',
  },
  modeBtnActive: { borderColor: theme.borderStrong, backgroundColor: theme.bg2 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
  bottomSide: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  bottomCenter: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  radarBtn: {
    backgroundColor: theme.bg3, borderWidth: 2, borderColor: theme.border,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
  },
  actTxt: { color: theme.text2, fontWeight: '800', fontSize: 14 },
  baseBtnRow: { marginHorizontal: 16, marginBottom: 8, justifyContent: 'center' },
  settingsFab: {
    // `bottom` here is just a fallback for the first render before bottomBarH
    // is measured — the actual value is always overridden inline (bottomBarH + 8).
    position: 'absolute', right: 14, bottom: 108, width: 42, height: 38, borderRadius: 8,
    backgroundColor: theme.bg3, borderWidth: 1, borderColor: theme.border,
    alignItems: 'center', justifyContent: 'center', zIndex: 20,
  },
  recenterBtn: {
    position: 'absolute', right: 14, bottom: 70, width: 46, height: 46, borderRadius: 23,
    backgroundColor: theme.bg2, borderWidth: 2, borderColor: theme.accent,
    alignItems: 'center', justifyContent: 'center', zIndex: 20,
  },
  classBadge: {
    position: 'absolute', top: 8, left: 40, right: 40, zIndex: 15,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    backgroundColor: 'rgba(10,8,16,.75)', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  classBadgeTxt: { fontSize: 11, fontWeight: '800' },
  // Left row, in order: esp/IR, gps, watch (see the render comment above).
  espStatusFab: {
    position: 'absolute', left: 14, top: 86, width: 38, height: 38, borderRadius: 8,
    backgroundColor: theme.bg3, borderWidth: 1, borderColor: theme.border,
    alignItems: 'center', justifyContent: 'center', zIndex: 20,
  },
  gpsStatusFab: {
    position: 'absolute', left: 58, top: 86, width: 38, height: 38, borderRadius: 8,
    backgroundColor: theme.bg3, borderWidth: 1, borderColor: theme.border,
    alignItems: 'center', justifyContent: 'center', zIndex: 20,
  },
  watchStatusFab: {
    position: 'absolute', left: 102, top: 86, width: 38, height: 38, borderRadius: 8,
    backgroundColor: theme.bg3, borderWidth: 1, borderColor: theme.border,
    alignItems: 'center', justifyContent: 'center', zIndex: 20,
  },
  // Right side, mirrors the left row.
  compassStatusFab: {
    position: 'absolute', right: 14, top: 86, width: 38, height: 38, borderRadius: 8,
    backgroundColor: theme.bg3, borderWidth: 1, borderColor: theme.border,
    alignItems: 'center', justifyContent: 'center', zIndex: 20,
  },
  });
}
