'use strict';
// ═══════════════════════════════════════════════════════════
//  AR OPS — server engine (mode-plugin architecture)
//
//  CORE (mode-agnostic): telemetry ingest + anti-spoof, hit
//  validation, geofence, perks, freeze mechanic, zone presence,
//  per-player privacy-preserving snapshots.
//
//  MODES (plugins in the MODES table below):
//   hide_and_seek — seekers photograph hiders; found = out
//   domination    — hold host-placed zones, points per second
//   ctf           — captains place bases, steal the enemy flag
//   seek_destroy  — attackers plant at a site, defenders defuse
//
//  All timings scale with field size (shared scaleTimings).
//  Team modes use FREEZE on hit: frozen players cannot shoot,
//  capture, carry or plant; moving >15 m extends the freeze.
// ═══════════════════════════════════════════════════════════
const shared = require('../../../packages/arops-shared/dist/src');

const BUFFER_CAP = 40;
const EVENT_CAP = 50;
const PRESENCE_MAX_AGE_MS = 12_000;   // stale positions cannot capture

const DEFAULTS = {
  hidingDurationMs: 120_000,
  gameDurationMs: 20 * 60_000,
  hitCooldownMs: 3_000,
  radarCooldownMs: 15 * 60_000,
  proximityRangeM: 40,
  geofenceWarnM: 10,
  geofenceGraceMs: 30_000,
  geofenceAutoFoundMs: 120_000,
  maxStrikes: 3,
  targetScore: 300,       // domination: points to win
  targetCaptures: 3,      // ctf: captures to win
  droneCooldownMs: 60_000,
  cloakCooldownMs: 90_000,
  cloakDurationMs: 30_000,
  fakeMarkerCooldownMs: 90_000,
  fakeMarkerDurationMs: 45_000,
  aufscheuchenCooldownMs: 45_000,
  aufscheuchenDurationMs: 6_000,
};

function now() { return Date.now(); }

function pushEvent(gs, type, data) {
  gs.events.push({ seq: ++gs._eventSeq, ts: now(), type, ...data });
  if (gs.events.length > EVENT_CAP) gs.events.splice(0, gs.events.length - EVENT_CAP);
}

function isFrozen(p, t) { return t < (p.frozenUntil || 0); }
function isCloaked(p, t) { return t < (p.cloakUntil || 0); }

function applyFreeze(gs, target, byUserId, t) {
  target.frozenUntil = t + gs.timings.freezeMs;
  target.freezeAnchor = target.lastAccepted
    ? { lat: target.lastAccepted.lat, lon: target.lastAccepted.lon } : null;
  target.freezeViolations = 0;
  pushEvent(gs, 'player_frozen', { userId: target.userId, byUserId, durationMs: gs.timings.freezeMs });
}

function isTeamMode(gs) { return gs.subMode !== 'hide_and_seek'; }

/**
 * Mark a hider as found. Host-configurable fate (ar_settings.foundMode):
 *  'spectator' (default) — status flips to 'found', excluded from further play.
 *  'seeker'              — role flips to seeker, status stays 'alive' so they
 *                           keep flowing through telemetry/geofence/tick and
 *                           can hunt the remaining hiders themselves.
 */
function foundHider(gs, target, t, byUserId) {
  target.foundBy = byUserId;
  target.foundAt = t;
  if (gs.cfg.foundMode === 'seeker') {
    target.role = 'seeker';
  } else {
    target.status = 'found';
  }
}

function opponentOf(gs, a, b) {
  return isTeamMode(gs) ? a.team !== b.team : a.role !== b.role;
}

/** Players currently counting for zone presence: alive, unfrozen, in-field, fresh. */
function zonePresence(gs, zone, t) {
  const byTeam = { a: [], b: [] };
  const all = [];
  for (const p of Object.values(gs.players)) {
    if (p.status !== 'alive' || !p.lastAccepted) continue;
    if (isFrozen(p, t)) continue;
    if (p.geofence === 'outside') continue;
    if (t - p.lastAccepted.ts > PRESENCE_MAX_AGE_MS) continue;
    if (!shared.isInZone(p.lastAccepted, zone)) continue;
    all.push(p.userId);
    if (p.team && byTeam[p.team]) byTeam[p.team].push(p.userId);
  }
  return { all, byTeam };
}

/** Dwell helper: advance a {uid, ms} progress slot for a single dweller. */
function advanceDwell(slot, presentUids, dtMs) {
  // slot: { uid, ms } | null. Continuous presence of the SAME uid accumulates.
  if (presentUids.length === 0) return null;
  const uid = slot && presentUids.includes(slot.uid) ? slot.uid : presentUids[0];
  const ms = (slot && slot.uid === uid ? slot.ms : 0) + dtMs;
  return { uid, ms };
}

// ═══════════════════════════════════════════════════════════
//  MODE PLUGINS
// ═══════════════════════════════════════════════════════════
const MODES = {

  // ── HIDE & SEEK (unchanged behavior) ──────────────────────
  hide_and_seek: {
    usesTeams: false,
    initialPhase: () => 'hiding',
    shootPhases: ['seeking'],
    phaseDurationMs(gs) {
      return gs.phase === 'hiding' ? gs.cfg.hidingDurationMs
        : gs.phase === 'seeking' ? gs.cfg.gameDurationMs : 0;
    },
    canShoot(gs, p) {
      if (p.role !== 'seeker') return 'role_cannot_shoot';
      return null;
    },
    targetFilter(gs, shooter, c) { return c.role === 'hider'; },
    applyHit(gs, shooter, target, verdict, t) {
      foundHider(gs, target, t, shooter.userId);
      shooter.score += 10;
      pushEvent(gs, 'player_found', {
        userId: target.userId, byUserId: shooter.userId,
        confidence: Math.round(verdict.confidence * 100) / 100,
        distanceM: Math.round(verdict.distanceM * 10) / 10,
      });
      this.checkWin(gs);
    },
    checkWin(gs) {
      // Solo debug sessions (host alone, no bots) can't have a winner — never
      // auto-end them just because there are trivially "0 hiders left".
      if (Object.keys(gs.players).length < 2) return;
      const hidersLeft = Object.values(gs.players)
        .filter(p => p.role === 'hider' && p.status === 'alive').length;
      if (hidersLeft === 0) endGame(gs, 'seekers');
    },
    tick(gs, t) {
      if (gs.phase === 'hiding' && t - gs.phaseStartTime >= gs.cfg.hidingDurationMs) {
        gs.phase = 'seeking';
        gs.phaseStartTime = t;
        pushEvent(gs, 'phase_change', { phase: 'seeking' });
      } else if (gs.phase === 'seeking' && t - gs.phaseStartTime >= gs.cfg.gameDurationMs) {
        endGame(gs, 'hiders');
        return;
      }
      // Geofence: exposure + auto-found for hiders
      for (const p of Object.values(gs.players)) {
        if (p.status !== 'alive' || p.outsideSince === null) continue;
        const outsideFor = t - p.outsideSince;
        if (p.role === 'hider' && outsideFor >= gs.cfg.geofenceAutoFoundMs) {
          foundHider(gs, p, t, null);
          pushEvent(gs, 'player_found', { userId: p.userId, byUserId: null, reason: 'left_field' });
          this.checkWin(gs);
          if (gs.gameOver) return;
        }
      }
    },
    onGameEnd(gs) {
      for (const p of Object.values(gs.players)) {
        if (p.role === 'hider' && p.status === 'alive') p.score += 20;
      }
    },
    snapshotExtras(gs) {
      return {
        hidersRemaining: Object.values(gs.players)
          .filter(p => p.role === 'hider' && p.status === 'alive').length,
      };
    },
    revealPosition() { return false; },
  },

  // ── DOMINATION ────────────────────────────────────────────
  domination: {
    usesTeams: true,
    initialPhase: () => 'live',
    shootPhases: ['live'],
    phaseDurationMs(gs) { return gs.phase === 'live' ? gs.cfg.gameDurationMs : 0; },
    initState(gs) {
      gs.modeState = {
        owners: Object.fromEntries(gs.zones.map(z => [z.id, null])),
        capProgress: {},   // zid -> { team, ms }
        teamScore: { a: 0, b: 0 },
      };
    },
    canShoot() { return null; },
    targetFilter(gs, shooter, c) { return c.team !== shooter.team; },
    applyHit(gs, shooter, target, verdict, t) {
      applyFreeze(gs, target, shooter.userId, t);
      shooter.score += 5;
    },
    tick(gs, t, dtMs) {
      const ms = gs.modeState;
      if (gs.phase !== 'live') return;
      // Zone capture + scoring
      for (const z of gs.zones) {
        const pres = zonePresence(gs, z, t);
        const teamsIn = ['a', 'b'].filter(tm => pres.byTeam[tm].length > 0);
        if (teamsIn.length === 1) {
          const tm = teamsIn[0];
          if (ms.owners[z.id] !== tm) {
            const prog = ms.capProgress[z.id];
            const nextMs = (prog && prog.team === tm ? prog.ms : 0) + dtMs;
            ms.capProgress[z.id] = { team: tm, ms: nextMs };
            if (nextMs >= gs.timings.captureDwellMs) {
              ms.owners[z.id] = tm;
              delete ms.capProgress[z.id];
              for (const uid of pres.byTeam[tm]) gs.players[uid].score += 5;
              pushEvent(gs, 'zone_captured', { zoneId: z.id, team: tm });
            }
          }
        }
        // contested or empty: progress pauses (kept, not reset)
        const owner = ms.owners[z.id];
        if (owner) ms.teamScore[owner] += dtMs / 1000; // 1 pt per second per zone
      }
      // Win: target score or time limit
      if (ms.teamScore.a >= gs.cfg.targetScore) return endGame(gs, 'team_a');
      if (ms.teamScore.b >= gs.cfg.targetScore) return endGame(gs, 'team_b');
      if (t - gs.phaseStartTime >= gs.cfg.gameDurationMs) {
        endGame(gs, ms.teamScore.a > ms.teamScore.b ? 'team_a'
          : ms.teamScore.b > ms.teamScore.a ? 'team_b' : 'draw');
      }
    },
    onGameEnd() {},
    snapshotExtras(gs) {
      const ms = gs.modeState;
      return {
        teamScore: { a: Math.floor(ms.teamScore.a), b: Math.floor(ms.teamScore.b) },
        targetScore: gs.cfg.targetScore,
        zones: gs.zones.map(z => ({
          id: z.id, lat: z.lat, lon: z.lon, radiusM: z.radiusM,
          owner: ms.owners[z.id],
          capture: ms.capProgress[z.id]
            ? { team: ms.capProgress[z.id].team,
                pct: Math.min(100, Math.round(100 * ms.capProgress[z.id].ms / gs.timings.captureDwellMs)) }
            : null,
        })),
      };
    },
    revealPosition() { return false; },
  },

  // ── CAPTURE THE FLAG ──────────────────────────────────────
  ctf: {
    usesTeams: true,
    initialPhase: () => 'base_setup',
    shootPhases: ['live'],
    phaseDurationMs(gs) {
      return gs.phase === 'base_setup' ? gs.timings.baseSettingMs
        : gs.phase === 'live' ? gs.cfg.gameDurationMs : 0;
    },
    initState(gs) {
      gs.modeState = {
        bases: { a: null, b: null },
        flags: {
          a: { state: 'home', carrier: null, lat: null, lon: null, droppedAt: null, pickupProg: null },
          b: { state: 'home', carrier: null, lat: null, lon: null, droppedAt: null, pickupProg: null },
        },
        captures: { a: 0, b: 0 },
      };
    },
    canShoot() { return null; },
    targetFilter(gs, shooter, c) { return c.team !== shooter.team; },
    applyHit(gs, shooter, target, verdict, t) {
      applyFreeze(gs, target, shooter.userId, t);
      shooter.score += 5;
      // Carrier hit → flag drops on the spot
      for (const [ft, flag] of Object.entries(gs.modeState.flags)) {
        if (flag.state === 'carried' && flag.carrier === target.userId) {
          dropFlag(gs, ft, target, t);
        }
      }
    },
    tick(gs, t, dtMs) {
      const ms = gs.modeState;
      if (gs.phase === 'base_setup') {
        if (t - gs.phaseStartTime >= gs.timings.baseSettingMs) {
          // Timeout: unset bases fall back to the captain's current position
          for (const tm of ['a', 'b']) {
            if (!ms.bases[tm]) {
              const cap = gs.players[gs.captains[tm]];
              const pos = cap?.lastAccepted
                || fieldCentroid(gs.polygon, tm === 'a' ? -0.25 : 0.25);
              ms.bases[tm] = { lat: pos.lat, lon: pos.lon };
              pushEvent(gs, 'base_set', { team: tm, auto: true });
            }
          }
          gs.phase = 'live';
          gs.phaseStartTime = t;
          pushEvent(gs, 'phase_change', { phase: 'live' });
        }
        return;
      }
      if (gs.phase !== 'live') return;

      const baseZone = tm => ({ id: 'base_' + tm, ...ms.bases[tm], radiusM: gs.timings.zoneRadiusM });

      for (const tm of ['a', 'b']) {
        const flag = ms.flags[tm];
        const enemyTeam = tm === 'a' ? 'b' : 'a';

        if (flag.state === 'home') {
          // Enemies dwell in this base to steal the flag
          const pres = zonePresence(gs, baseZone(tm), t);
          const enemies = pres.byTeam[enemyTeam];
          flag.pickupProg = advanceDwell(flag.pickupProg, enemies, enemies.length ? dtMs : 0);
          if (!enemies.length) flag.pickupProg = null;
          if (flag.pickupProg && flag.pickupProg.ms >= gs.timings.flagPickupDwellMs) {
            flag.state = 'carried';
            flag.carrier = flag.pickupProg.uid;
            flag.pickupProg = null;
            pushEvent(gs, 'flag_taken', { flagTeam: tm, byUserId: flag.carrier });
          }
        } else if (flag.state === 'carried') {
          const carrier = gs.players[flag.carrier];
          if (!carrier || carrier.status !== 'alive' || carrier.geofence === 'outside') {
            dropFlag(gs, tm, carrier, t);
            continue;
          }
          // Capture: carrier inside OWN base while own flag is home
          const ownBase = baseZone(enemyTeam); // carrier's own team is enemyTeam of the flag
          if (carrier.lastAccepted && shared.isInZone(carrier.lastAccepted, ownBase)
              && ms.flags[enemyTeam].state === 'home' && !isFrozen(carrier, t)) {
            ms.captures[enemyTeam]++;
            carrier.score += 20;
            flag.state = 'home'; flag.carrier = null;
            pushEvent(gs, 'flag_captured', { byTeam: enemyTeam, byUserId: carrier.userId });
            if (ms.captures[enemyTeam] >= gs.cfg.targetCaptures) {
              return endGame(gs, 'team_' + enemyTeam);
            }
          }
        } else if (flag.state === 'dropped') {
          // Own team touch → instant return; enemy touch → instant pickup; timeout → home
          const dz = { id: 'flag_' + tm, lat: flag.lat, lon: flag.lon, radiusM: 10 };
          const pres = zonePresence(gs, dz, t);
          if (pres.byTeam[tm].length > 0) {
            flag.state = 'home'; flag.carrier = null; flag.droppedAt = null;
            pushEvent(gs, 'flag_returned', { flagTeam: tm, byUserId: pres.byTeam[tm][0] });
          } else if (pres.byTeam[enemyTeam].length > 0) {
            flag.state = 'carried'; flag.carrier = pres.byTeam[enemyTeam][0]; flag.droppedAt = null;
            pushEvent(gs, 'flag_taken', { flagTeam: tm, byUserId: flag.carrier });
          } else if (t - flag.droppedAt >= gs.timings.flagReturnMs) {
            flag.state = 'home'; flag.carrier = null; flag.droppedAt = null;
            pushEvent(gs, 'flag_returned', { flagTeam: tm, byUserId: null });
          }
        }
      }

      if (t - gs.phaseStartTime >= gs.cfg.gameDurationMs) {
        endGame(gs, ms.captures.a > ms.captures.b ? 'team_a'
          : ms.captures.b > ms.captures.a ? 'team_b' : 'draw');
      }
    },
    onGameEnd() {},
    snapshotExtras(gs) {
      const ms = gs.modeState;
      const flagPos = (tm) => {
        const f = ms.flags[tm];
        if (f.state === 'home') return ms.bases[tm];
        if (f.state === 'dropped') return { lat: f.lat, lon: f.lon };
        const c = gs.players[f.carrier];
        return c?.lastAccepted ? { lat: c.lastAccepted.lat, lon: c.lastAccepted.lon } : ms.bases[tm];
      };
      return {
        captures: ms.captures,
        targetCaptures: gs.cfg.targetCaptures,
        bases: ms.bases,
        zoneRadiusM: gs.timings.zoneRadiusM,
        flags: ['a', 'b'].map(tm => ({
          team: tm, state: ms.flags[tm].state, carrier: ms.flags[tm].carrier,
          ...(ms.bases[tm] || gs.phase === 'live' ? (flagPos(tm) || {}) : {}),
        })),
        baseSetup: gs.phase === 'base_setup' ? {
          myTeamBaseSet: null, // filled per-player below via revealPosition path (kept simple)
        } : null,
      };
    },
    // Flag carriers are visible to EVERYONE (classic CTF rule)
    revealPosition(gs, viewer, p) {
      const ms = gs.modeState;
      return Object.values(ms.flags).some(f => f.state === 'carried' && f.carrier === p.userId);
    },
  },

  // ── SEEK & DESTROY ────────────────────────────────────────
  seek_destroy: {
    usesTeams: true,
    initialPhase: () => 'live',
    shootPhases: ['live'],
    phaseDurationMs(gs) { return gs.phase === 'live' ? gs.cfg.gameDurationMs : 0; },
    initState(gs) {
      gs.modeState = {
        bomb: null,           // { siteId, plantedAt, explodeAt, defuseProg }
        plantProg: null,      // { uid, siteId, ms }
      };
    },
    canShoot() { return null; },
    targetFilter(gs, shooter, c) { return c.team !== shooter.team; },
    applyHit(gs, shooter, target, verdict, t) {
      applyFreeze(gs, target, shooter.userId, t);
      shooter.score += 5;
    },
    tick(gs, t, dtMs) {
      const ms = gs.modeState;
      if (gs.phase !== 'live') return;

      if (!ms.bomb) {
        // Attackers (team a) plant at any site
        let advanced = false;
        for (const z of gs.zones) {
          const pres = zonePresence(gs, z, t);
          const attackers = pres.byTeam.a;
          if (attackers.length) {
            const slot = ms.plantProg && ms.plantProg.siteId === z.id
              ? { uid: ms.plantProg.uid, ms: ms.plantProg.ms } : null;
            const next = advanceDwell(slot, attackers, dtMs);
            ms.plantProg = { uid: next.uid, siteId: z.id, ms: next.ms };
            advanced = true;
            if (next.ms >= gs.timings.plantDwellMs) {
              ms.bomb = {
                siteId: z.id, plantedAt: t,
                explodeAt: t + gs.timings.bombTimerMs, defuseProg: null,
              };
              ms.plantProg = null;
              gs.players[next.uid].score += 10;
              pushEvent(gs, 'bomb_planted', { siteId: z.id, byUserId: next.uid, explodeAt: ms.bomb.explodeAt });
            }
            break; // one plant progress at a time
          }
        }
        if (!advanced) ms.plantProg = null;
        // Time up without plant → defenders win
        if (!ms.bomb && t - gs.phaseStartTime >= gs.cfg.gameDurationMs) {
          return endGame(gs, 'team_b');
        }
      } else {
        // Defenders defuse at the bomb site
        const site = gs.zones.find(z => z.id === ms.bomb.siteId);
        const pres = zonePresence(gs, site, t);
        const defenders = pres.byTeam.b;
        ms.bomb.defuseProg = advanceDwell(ms.bomb.defuseProg, defenders, defenders.length ? dtMs : 0);
        if (!defenders.length) ms.bomb.defuseProg = null;
        if (ms.bomb.defuseProg && ms.bomb.defuseProg.ms >= gs.timings.defuseDwellMs) {
          gs.players[ms.bomb.defuseProg.uid].score += 10;
          pushEvent(gs, 'bomb_defused', { byUserId: ms.bomb.defuseProg.uid });
          return endGame(gs, 'team_b');
        }
        if (t >= ms.bomb.explodeAt) {
          pushEvent(gs, 'bomb_exploded', { siteId: ms.bomb.siteId });
          return endGame(gs, 'team_a');
        }
      }
    },
    onGameEnd() {},
    snapshotExtras(gs) {
      const ms = gs.modeState;
      return {
        sites: gs.zones.map(z => ({ id: z.id, lat: z.lat, lon: z.lon, radiusM: z.radiusM })),
        bomb: ms.bomb ? {
          siteId: ms.bomb.siteId,
          explodeAt: ms.bomb.explodeAt,
          defusePct: ms.bomb.defuseProg
            ? Math.min(100, Math.round(100 * ms.bomb.defuseProg.ms / gs.timings.defuseDwellMs)) : 0,
        } : null,
        plantPct: ms.plantProg
          ? Math.min(100, Math.round(100 * ms.plantProg.ms / gs.timings.plantDwellMs)) : 0,
      };
    },
    revealPosition() { return false; },
  },
};

function dropFlag(gs, flagTeam, carrier, t) {
  const flag = gs.modeState.flags[flagTeam];
  const pos = carrier?.lastAccepted || gs.modeState.bases[flagTeam];
  flag.state = 'dropped';
  flag.lat = pos.lat; flag.lon = pos.lon;
  flag.droppedAt = t;
  flag.carrier = null;
  pushEvent(gs, 'flag_dropped', { flagTeam });
}

function fieldCentroid(polygon, offsetFrac = 0) {
  const lat = polygon.reduce((s, p) => s + p.lat, 0) / polygon.length;
  const lon = polygon.reduce((s, p) => s + p.lon, 0) / polygon.length;
  return { lat: lat + offsetFrac * 0.0005, lon };
}

// ═══════════════════════════════════════════════════════════
//  SESSION CREATION
// ═══════════════════════════════════════════════════════════
function createAropsGame(sessionId, players, workshopConfig) {
  const ar = workshopConfig?.ar_settings || {};
  const polygon = ar.polygon || [];
  const subMode = MODES[ar.subMode] ? ar.subMode : 'hide_and_seek';
  const mode = MODES[subMode];

  const polyCheck = shared.validatePolygon(polygon);
  if (!polyCheck.ok) {
    throw new Error('invalid_polygon: ' + polyCheck.errors.join(','));
  }

  const areaM2 = shared.polygonAreaM2(polygon);

  // "Auto" mode: hiding/game duration, shot range/width, and perk cooldowns
  // are derived from the field size instead of the fixed DEFAULTS — ON by
  // default (only off if the host explicitly disables it), since field area
  // no longer has an upper limit (DEFAULT_POLYGON_OPTIONS.maxAreaM2) and
  // fixed presets stop making sense once a field is much bigger than what
  // they were tuned for. This only replaces the BASE — an explicit ar[k] /
  // ar.hitConfig value (host override, or a test file's deliberately tiny
  // ms timings) always wins, applied after this, same as it always was.
  const autoScale = ar.autoScale !== false;
  const auto = autoScale ? shared.scaleCoreConfig(areaM2) : null;

  const cfg = { ...DEFAULTS };
  if (auto) {
    cfg.hidingDurationMs = auto.hidingDurationMs;
    cfg.gameDurationMs = auto.gameDurationMs;
    cfg.radarCooldownMs = auto.radarCooldownMs;
    cfg.droneCooldownMs = auto.droneCooldownMs;
    cfg.cloakCooldownMs = auto.cloakCooldownMs;
    cfg.fakeMarkerCooldownMs = auto.fakeMarkerCooldownMs;
    cfg.aufscheuchenCooldownMs = auto.aufscheuchenCooldownMs;
  }
  for (const k of Object.keys(DEFAULTS)) {
    if (typeof ar[k] === 'number') cfg[k] = ar[k];
  }
  cfg.autoScale = autoScale;
  cfg.foundMode = ar.foundMode === 'seeker' ? 'seeker' : 'spectator';
  cfg.debugMode = ar.debugMode === true;

  const hitConfig = { ...shared.DEFAULT_HIT_CONFIG };
  if (auto) {
    hitConfig.maxRangeM = auto.hitRangeM;
    // Same meters-at-10m-reference → angle conversion the Lobby's manual
    // "Breite" presets use (see LobbyScreen.tsx REF_DIST_M), so auto and
    // manual modes are directly comparable.
    hitConfig.baseConeHalfAngleDeg = Math.atan(auto.hitHalfWidthM / 10) * (180 / Math.PI);
  }
  Object.assign(hitConfig, ar.hitConfig || {});

  // Field-size-scaled timings; each key overridable via ar_settings.timings
  const timings = shared.scaleTimings(areaM2);
  if (ar.timings && typeof ar.timings === 'object') {
    for (const k of Object.keys(timings)) {
      if (typeof ar.timings[k] === 'number') timings[k] = ar.timings[k];
    }
  }

  // Zones (domination points / bomb sites), host-placed
  const zones = (Array.isArray(ar.zones) ? ar.zones : [])
    .filter(z => z && Number.isFinite(z.lat) && Number.isFinite(z.lon))
    .slice(0, 8)
    .map((z, i) => ({ id: 'z' + (i + 1), lat: +z.lat, lon: +z.lon, radiusM: timings.zoneRadiusM }));
  if (subMode === 'domination' || subMode === 'seek_destroy') {
    const minZones = subMode === 'domination' ? 2 : 1;
    if (zones.length < minZones) throw new Error('need_zones');
    const zCheck = shared.validateZones(zones, polygon);
    if (!zCheck.ok) throw new Error('invalid_zones: ' + zCheck.errors.join(','));
  }

  const roles = ar.roles || {};
  const teamOverride = ar.teams || {};
  const playerState = {};
  const captains = { a: null, b: null };
  let seekerCount = 0;
  players.forEach((p, idx) => {
    const role = roles[p.userId] || (idx === 0 ? 'seeker' : 'hider');
    if (role === 'seeker') seekerCount++;
    // Teams: explicit override or alternating assignment
    const team = mode.usesTeams
      ? (teamOverride[p.userId] === 'a' || teamOverride[p.userId] === 'b'
          ? teamOverride[p.userId] : (idx % 2 === 0 ? 'a' : 'b'))
      : null;
    if (team && !captains[team]) captains[team] = p.userId;
    playerState[p.userId] = {
      userId: p.userId, username: p.username, avatar_color: p.avatar_color,
      role, team, isBot: !!p.isBot,
      status: 'alive',
      foundBy: null, foundAt: null,
      score: 0,
      buffer: [], lastAccepted: null,
      strikes: 0, suspicious: false,
      geofence: 'inside', outsideSince: null, exposed: false, exposedAt: null,
      lastHitAttemptAt: 0,
      perks: { radarLastUsed: 0, droneLastUsed: 0, cloakLastUsed: 0, fakeMarkerLastUsed: 0, aufscheuchenLastUsed: 0 },
      proximityAlert: false,
      cloakUntil: 0, fakeMarkers: null, fakeMarkerUntil: 0, fakeProximityUntil: 0,
      frozenUntil: 0, freezeAnchor: null, freezeViolations: 0,
    };
  });
  // Every normal match needs at least one seeker — but a solo debug session
  // (host testing the hider view alone) should be able to explicitly opt out.
  if (!mode.usesTeams && seekerCount === 0 && !cfg.debugMode) {
    const first = Object.values(playerState)[0];
    if (first) first.role = 'seeker';
  }

  const gs = {
    sessionId, mode: 'ar_ops', subMode,
    polygon, cfg, hitConfig, timings, zones, captains,
    comicMap: ar.comicMap && Array.isArray(ar.comicMap.features) ? ar.comicMap : null,
    // Forward-prep only: no engine behavior branches on this yet, IR hit
    // detection isn't implemented. Exposed in the snapshot so clients can
    // already show/prepare for it.
    hitTrackingMode: ar.hitTrackingMode === 'ir' ? 'ir' : 'compass',
    players: playerState,
    phase: mode.initialPhase(),
    phaseStartTime: now(),
    gameOver: false, _gameOverWin: false, winner: null,
    events: [], _eventSeq: 0,
    modeState: {},
    _lastModeTick: now(),
    _hasBots: Object.values(playerState).some(p => p.isBot),
    _lastBotStep: 0,
  };
  if (mode.initState) mode.initState(gs);
  return gs;
}

// ═══════════════════════════════════════════════════════════
//  TELEMETRY (core — freeze movement penalty lives here)
// ═══════════════════════════════════════════════════════════
function validSample(s) {
  return s && typeof s.lat === 'number' && typeof s.lon === 'number'
    && Number.isFinite(s.lat) && Number.isFinite(s.lon)
    && Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180
    && typeof s.ts === 'number' && s.ts > 0
    && typeof s.accuracyM === 'number' && s.accuracyM >= 0;
}

function actionArTelemetry(gs, userId, data) {
  const p = gs.players[userId];
  if (!p) return { ok: false, err: 'not_in_game' };
  if (gs.gameOver) return { ok: false, err: 'game_over' };
  const s = data?.sample;
  if (!validSample(s)) return { ok: false, err: 'bad_sample' };

  const sample = {
    lat: s.lat, lon: s.lon, ts: s.ts,
    accuracyM: s.accuracyM,
    headingDeg: (typeof s.headingDeg === 'number' && Number.isFinite(s.headingDeg))
      ? ((s.headingDeg % 360) + 360) % 360 : null,
    speedMps: typeof s.speedMps === 'number' ? s.speedMps : null,
  };

  if (p.lastAccepted && sample.ts <= p.lastAccepted.ts) {
    return { ok: false, err: 'stale_sample' };
  }
  if (p.lastAccepted && !shared.isMovementPlausible(p.lastAccepted, sample)) {
    p.strikes++;
    if (p.strikes >= gs.cfg.maxStrikes && !p.suspicious) {
      p.suspicious = true;
      pushEvent(gs, 'player_suspicious', { userId });
    }
    return { ok: false, err: 'implausible', strikes: p.strikes };
  }

  p.buffer.push(sample);
  if (p.buffer.length > BUFFER_CAP) p.buffer.splice(0, p.buffer.length - BUFFER_CAP);
  p.lastAccepted = sample;

  // FREEZE movement penalty: moving beyond tolerance extends the freeze
  const t = now();
  if (isFrozen(p, t) && p.freezeAnchor) {
    const moved = shared.haversineMeters(p.freezeAnchor, sample);
    if (moved > gs.timings.freezeMoveToleranceM) {
      p.frozenUntil += gs.timings.freezeExtensionMs;
      p.freezeAnchor = { lat: sample.lat, lon: sample.lon };
      p.freezeViolations++;
      pushEvent(gs, 'freeze_extended', {
        userId, extensionMs: gs.timings.freezeExtensionMs, violations: p.freezeViolations,
      });
    }
  }

  const gf = shared.geofenceStatus(sample, gs.polygon, gs.cfg.geofenceWarnM);
  p.geofence = gf.state;
  if (gf.state === 'outside') {
    if (p.outsideSince === null) p.outsideSince = now();
  } else {
    p.outsideSince = null;
    if (p.exposed) { p.exposed = false; p.exposedAt = null; }
  }

  return { ok: true, geofence: gf.state, signedDistanceM: Math.round(gf.signedDistanceM * 10) / 10 };
}

// ═══════════════════════════════════════════════════════════
//  HIT ATTEMPT (core; mode decides gating + consequence)
// ═══════════════════════════════════════════════════════════
const pickTargetSample = shared.pickTargetSample;

function actionArHitAttempt(gs, userId, data) {
  const mode = MODES[gs.subMode];
  const shooter = gs.players[userId];
  if (!shooter) return { ok: false, err: 'not_in_game' };
  if (gs.gameOver) return { ok: false, err: 'game_over' };
  if (!mode.shootPhases.includes(gs.phase)) return { ok: false, err: 'wrong_phase' };
  const t = now();
  if (isFrozen(shooter, t)) {
    return { ok: false, err: 'frozen', remainingMs: shooter.frozenUntil - t };
  }
  const gateErr = mode.canShoot(gs, shooter);
  if (gateErr) return { ok: false, err: gateErr };
  if (shooter.geofence === 'outside') return { ok: false, err: 'outside_field' };

  if (t - shooter.lastHitAttemptAt < gs.cfg.hitCooldownMs) {
    return { ok: false, err: 'cooldown', remainingMs: gs.cfg.hitCooldownMs - (t - shooter.lastHitAttemptAt) };
  }

  const trigger = data?.sample;
  if (!validSample(trigger)) return { ok: false, err: 'bad_sample' };
  if (trigger.headingDeg === null || trigger.headingDeg === undefined) {
    return { ok: false, err: 'no_heading' };
  }
  if (shooter.lastAccepted && !shared.isMovementPlausible(shooter.lastAccepted, trigger)) {
    shooter.strikes++;
    return { ok: false, err: 'implausible' };
  }

  shooter.lastHitAttemptAt = t;

  const candidates = Object.values(gs.players).filter(c =>
    c.userId !== userId &&
    c.status === 'alive' &&
    !isFrozen(c, t) &&                                   // frozen players are safe
    mode.targetFilter(gs, shooter, c) &&
    (!data.targetId || c.userId === data.targetId) &&
    c.buffer.length > 0
  );

  let bestVerdict = null, bestTarget = null;
  let nearMiss = null;
  const reasonCounts = {}; // direction-independent failure diagnostics
  for (const c of candidates) {
    const targetSample = pickTargetSample(c.buffer, trigger.ts);
    if (!targetSample) continue;
    const verdict = shared.validateHit({
      shooterId: userId, targetId: c.userId,
      shooter: {
        lat: trigger.lat, lon: trigger.lon, ts: trigger.ts,
        accuracyM: trigger.accuracyM, headingDeg: trigger.headingDeg,
      },
      target: targetSample,
    }, gs.hitConfig);
    if (verdict.hit && (!bestVerdict || verdict.confidence > bestVerdict.confidence)) {
      bestVerdict = verdict; bestTarget = c;
    } else if (!verdict.hit) {
      reasonCounts[verdict.reason] = (reasonCounts[verdict.reason] || 0) + 1;
    }
    if (!verdict.hit && verdict.angleDeltaDeg !== null && verdict.toleranceDeg !== null) {
      if (verdict.angleDeltaDeg <= verdict.toleranceDeg * 2) {
        if (!nearMiss || verdict.angleDeltaDeg / verdict.toleranceDeg < nearMiss.ratio) {
          nearMiss = {
            ratio: verdict.angleDeltaDeg / verdict.toleranceDeg,
            deltaDeg: Math.round(verdict.angleDeltaDeg),
            toleranceDeg: Math.round(verdict.toleranceDeg),
            distanceM: Math.round(verdict.distanceM / 5) * 5,
          };
        }
      }
    }
  }

  if (!bestVerdict) {
    // Diagnostic reason (never leaks direction):
    //  no_candidates — nobody targetable (same team/role, frozen, no telemetry)
    //  low_confidence — someone was IN the cone but data quality too low
    //  target_stale — a target's telemetry is too old (app in background?)
    //  out_of_range — targets exist but all beyond max range
    let reason = null;
    if (candidates.length === 0) reason = 'no_candidates';
    else if (reasonCounts.low_confidence) reason = 'low_confidence';
    else if (reasonCounts.time_skew) reason = 'target_stale';
    else if (reasonCounts.out_of_range && !reasonCounts.outside_cone) reason = 'out_of_range';
    return {
      ok: true, hit: false, reason,
      near: nearMiss ? {
        deltaDeg: nearMiss.deltaDeg,
        toleranceDeg: nearMiss.toleranceDeg,
        distanceM: nearMiss.distanceM,
      } : null,
    };
  }

  mode.applyHit(gs, shooter, bestTarget, bestVerdict, t);

  return {
    ok: true, hit: true, targetId: bestTarget.userId,
    confidence: bestVerdict.confidence,
    distanceM: bestVerdict.distanceM,
  };
}

// ═══════════════════════════════════════════════════════════
//  CTF: captain sets the team base during base_setup
// ═══════════════════════════════════════════════════════════
function actionArSetBase(gs, userId, data) {
  if (gs.subMode !== 'ctf') return { ok: false, err: 'wrong_mode' };
  if (gs.phase !== 'base_setup') return { ok: false, err: 'wrong_phase' };
  const p = gs.players[userId];
  if (!p) return { ok: false, err: 'not_in_game' };
  if (gs.captains[p.team] !== userId) return { ok: false, err: 'not_captain' };

  // Position: explicit map tap or current position
  let pos = null;
  if (data && Number.isFinite(data.lat) && Number.isFinite(data.lon)) {
    pos = { lat: +data.lat, lon: +data.lon };
  } else if (p.lastAccepted) {
    pos = { lat: p.lastAccepted.lat, lon: p.lastAccepted.lon };
  }
  if (!pos) return { ok: false, err: 'no_position' };
  if (!shared.pointInPolygon(pos, gs.polygon)) return { ok: false, err: 'outside_field' };

  const other = gs.modeState.bases[p.team === 'a' ? 'b' : 'a'];
  if (other && shared.haversineMeters(pos, other) < gs.timings.minBaseSeparationM) {
    return { ok: false, err: 'bases_too_close', minSeparationM: Math.round(gs.timings.minBaseSeparationM) };
  }
  gs.modeState.bases[p.team] = pos;
  pushEvent(gs, 'base_set', { team: p.team, auto: false });
  return { ok: true, base: pos };
}

// ═══════════════════════════════════════════════════════════
//  PERKS (core; opponent = other role/team)
// ═══════════════════════════════════════════════════════════
/** Rejection-sample a point inside the field polygon (for Fake-Marker decoys). */
function randomPointInPolygon(polygon) {
  if (!polygon || polygon.length < 3) return null;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const v of polygon) {
    if (v.lat < minLat) minLat = v.lat;
    if (v.lat > maxLat) maxLat = v.lat;
    if (v.lon < minLon) minLon = v.lon;
    if (v.lon > maxLon) maxLon = v.lon;
  }
  for (let i = 0; i < 20; i++) {
    const cand = { lat: minLat + Math.random() * (maxLat - minLat), lon: minLon + Math.random() * (maxLon - minLon) };
    if (shared.pointInPolygon(cand, polygon)) return cand;
  }
  return null;
}

function actionArUsePerk(gs, userId, data) {
  const mode = MODES[gs.subMode];
  const p = gs.players[userId];
  if (!p) return { ok: false, err: 'not_in_game' };
  if (gs.gameOver) return { ok: false, err: 'game_over' };
  if (!mode.shootPhases.includes(gs.phase)) return { ok: false, err: 'wrong_phase' };
  const t = now();
  const perk = data?.perk;

  if (perk === 'radar') {
    const elapsed = t - p.perks.radarLastUsed;
    if (p.perks.radarLastUsed && elapsed < gs.cfg.radarCooldownMs) {
      return { ok: false, err: 'cooldown', remainingMs: gs.cfg.radarCooldownMs - elapsed };
    }
    p.perks.radarLastUsed = t;
    const opponents = Object.values(gs.players).filter(c =>
      c.userId !== userId && c.status === 'alive' && opponentOf(gs, p, c) && c.lastAccepted && !isCloaked(c, t)
    );
    const contacts = opponents.map(c => ({
      userId: c.userId,
      lat: c.lastAccepted.lat, lon: c.lastAccepted.lon,
      ageMs: t - c.lastAccepted.ts,
    }));
    // Fake-Marker decoys: mixed into a seeker's contacts, same shape as real
    // ones — indistinguishable, no separate reveal path.
    if (p.role === 'seeker') {
      for (const h of Object.values(gs.players)) {
        if (h.role !== 'hider' || h.status !== 'alive' || !h.fakeMarkers || t >= (h.fakeMarkerUntil || 0)) continue;
        h.fakeMarkers.forEach((m, i) => {
          contacts.push({ userId: `decoy_${h.userId}_${i}`, lat: m.lat, lon: m.lon, ageMs: Math.round(Math.random() * 5000) });
        });
      }
    }
    pushEvent(gs, 'radar_used', { userId });
    return { ok: true, contacts };
  }

  // Drone / Cloak / Fake-Marker / Aufscheuchen are Hide & Seek's hider/seeker
  // asymmetry — 'role' is a vestigial field in team modes, so gate explicitly.
  if (['drone', 'cloak', 'fake_marker', 'aufscheuchen'].includes(perk) && gs.subMode !== 'hide_and_seek') {
    return { ok: false, err: 'wrong_mode' };
  }

  if (perk === 'drone') {
    if (p.role !== 'hider') return { ok: false, err: 'perk_wrong_role' };
    const elapsed = t - p.perks.droneLastUsed;
    if (p.perks.droneLastUsed && elapsed < gs.cfg.droneCooldownMs) {
      return { ok: false, err: 'cooldown', remainingMs: gs.cfg.droneCooldownMs - elapsed };
    }
    p.perks.droneLastUsed = t;
    const range = shared.scaleDroneRangeM(shared.polygonAreaM2(gs.polygon));
    const alert = !!(p.lastAccepted && Object.values(gs.players).some(c =>
      c.userId !== userId && c.role === 'seeker' && c.status === 'alive' && c.lastAccepted &&
      shared.haversineMeters(p.lastAccepted, c.lastAccepted) <= range
    ));
    pushEvent(gs, 'drone_used', { userId });
    return { ok: true, alert };
  }

  if (perk === 'cloak') {
    if (p.role !== 'hider') return { ok: false, err: 'perk_wrong_role' };
    const elapsed = t - p.perks.cloakLastUsed;
    if (p.perks.cloakLastUsed && elapsed < gs.cfg.cloakCooldownMs) {
      return { ok: false, err: 'cooldown', remainingMs: gs.cfg.cloakCooldownMs - elapsed };
    }
    p.perks.cloakLastUsed = t;
    p.cloakUntil = t + gs.cfg.cloakDurationMs;
    pushEvent(gs, 'cloak_used', { userId });
    return { ok: true };
  }

  if (perk === 'fake_marker') {
    if (p.role !== 'hider') return { ok: false, err: 'perk_wrong_role' };
    const elapsed = t - p.perks.fakeMarkerLastUsed;
    if (p.perks.fakeMarkerLastUsed && elapsed < gs.cfg.fakeMarkerCooldownMs) {
      return { ok: false, err: 'cooldown', remainingMs: gs.cfg.fakeMarkerCooldownMs - elapsed };
    }
    p.perks.fakeMarkerLastUsed = t;
    const fallback = p.lastAccepted ? { lat: p.lastAccepted.lat, lon: p.lastAccepted.lon } : null;
    p.fakeMarkers = [randomPointInPolygon(gs.polygon) || fallback, randomPointInPolygon(gs.polygon) || fallback]
      .filter(Boolean);
    p.fakeMarkerUntil = t + gs.cfg.fakeMarkerDurationMs;
    pushEvent(gs, 'fake_marker_used', { userId });
    return { ok: true };
  }

  if (perk === 'aufscheuchen') {
    if (p.role !== 'seeker') return { ok: false, err: 'perk_wrong_role' };
    const elapsed = t - p.perks.aufscheuchenLastUsed;
    if (p.perks.aufscheuchenLastUsed && elapsed < gs.cfg.aufscheuchenCooldownMs) {
      return { ok: false, err: 'cooldown', remainingMs: gs.cfg.aufscheuchenCooldownMs - elapsed };
    }
    p.perks.aufscheuchenLastUsed = t;
    for (const h of Object.values(gs.players)) {
      if (h.role === 'hider' && h.status === 'alive') h.fakeProximityUntil = t + gs.cfg.aufscheuchenDurationMs;
    }
    pushEvent(gs, 'aufscheuchen_used', { userId });
    return { ok: true };
  }

  return { ok: false, err: 'unknown_perk' };
}

// ═══════════════════════════════════════════════════════════
//  BOTS (debug/testing only — added via LobbyScreen's "+ Bot" button,
//  never persisted to the users table; see socket.js lobby:ar_update).
//  Movement is fed through actionArTelemetry like a real client, so
//  hit/radar/geofence/zone code never needs to special-case bots.
// ═══════════════════════════════════════════════════════════
const BOT_STEP_MS = 1200;   // < DEFAULT_PLAUSIBILITY.minGapMs(1500) — every
                            // step is trivially plausibility-exempt, matching
                            // a real client's ~1s telemetry cadence.
const BOT_SPEED_MPS = 1.3;  // brisk walking pace

function nearestAlivePlayer(gs, from, filterFn) {
  let best = null, bestDist = Infinity;
  for (const c of Object.values(gs.players)) {
    if (c.userId === from.userId || c.status !== 'alive' || !c.lastAccepted || !filterFn(c)) continue;
    const d = shared.haversineMeters(from.lastAccepted, c.lastAccepted);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
}

function tickBots(gs, t) {
  if (!gs._hasBots) return;
  if (gs._lastBotStep && t - gs._lastBotStep < BOT_STEP_MS) return;
  gs._lastBotStep = t;

  const stepM = (BOT_STEP_MS / 1000) * BOT_SPEED_MPS;
  for (const p of Object.values(gs.players)) {
    if (!p.isBot || p.status !== 'alive') continue;

    if (!p.lastAccepted) {
      const start = randomPointInPolygon(gs.polygon) || fieldCentroid(gs.polygon);
      actionArTelemetry(gs, p.userId, {
        sample: { lat: start.lat, lon: start.lon, ts: t, accuracyM: 4, headingDeg: 0 },
      });
      continue;
    }

    let dest;
    if (gs.subMode === 'hide_and_seek') {
      // Hiders sit still once they've picked a spot during 'hiding'; seekers
      // don't move until 'seeking' starts (mirrors what a real player can do).
      if (p.role === 'hider' && gs.phase === 'hiding') continue;
      if (p.role === 'seeker' && gs.phase !== 'seeking') continue;
      const target = p.role === 'seeker'
        ? nearestAlivePlayer(gs, p, c => c.role === 'hider')
        : nearestAlivePlayer(gs, p, c => c.role === 'seeker');
      if (target) {
        const brg = shared.bearingDeg(p.lastAccepted, target.lastAccepted);
        dest = shared.destinationPoint(p.lastAccepted, p.role === 'seeker' ? brg : (brg + 180) % 360, stepM);
      }
    }
    // Team modes (v1 scope) and hide_and_seek bots without a target: wander.
    if (!dest) {
      dest = shared.destinationPoint(p.lastAccepted, Math.random() * 360, stepM);
    }
    if (!shared.pointInPolygon(dest, gs.polygon)) {
      // Would leave the field — head back toward the centroid instead.
      const centroid = fieldCentroid(gs.polygon);
      dest = shared.destinationPoint(p.lastAccepted, shared.bearingDeg(p.lastAccepted, centroid), stepM);
    }
    actionArTelemetry(gs, p.userId, {
      sample: {
        lat: dest.lat, lon: dest.lon, ts: t, accuracyM: 4,
        headingDeg: shared.bearingDeg(p.lastAccepted, dest),
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════
//  TICK (core: geofence exposure + proximity, then mode logic)
// ═══════════════════════════════════════════════════════════
function tickArops(gs) {
  if (gs.gameOver) return;
  const mode = MODES[gs.subMode];
  const t = now();
  const dtMs = Math.min(2000, Math.max(0, t - gs._lastModeTick));
  gs._lastModeTick = t;

  // Geofence exposure (all modes)
  for (const p of Object.values(gs.players)) {
    if (p.status !== 'alive' || p.outsideSince === null) continue;
    if (!p.exposed && t - p.outsideSince >= gs.cfg.geofenceGraceMs) {
      p.exposed = true;
      p.exposedAt = t;
      pushEvent(gs, 'player_exposed', { userId: p.userId });
    }
  }

  mode.tick(gs, t, dtMs);
  if (gs.gameOver) return;

  tickBots(gs, t);

  // Proximity warner (active shoot phases only)
  for (const p of Object.values(gs.players)) {
    p.proximityAlert = false;
    if (p.status !== 'alive' || !p.lastAccepted || !mode.shootPhases.includes(gs.phase)) continue;
    for (const o of Object.values(gs.players)) {
      if (o.userId === p.userId || o.status !== 'alive' || !opponentOf(gs, p, o) || !o.lastAccepted) continue;
      if (isCloaked(o, t)) continue; // Cloak defeats detection sensors, not point-blank hits
      if (shared.haversineMeters(p.lastAccepted, o.lastAccepted) <= gs.cfg.proximityRangeM) {
        p.proximityAlert = true;
        break;
      }
    }
    // Aufscheuchen: seeker-faked alert, indistinguishable from a real one
    if (t < (p.fakeProximityUntil || 0)) p.proximityAlert = true;
  }
}

function endGame(gs, winner) {
  const mode = MODES[gs.subMode];
  gs.phase = 'ended';
  gs.gameOver = true;
  gs.winner = winner;
  if (mode.onGameEnd) mode.onGameEnd(gs);
  gs._gameOverWin = winner === 'seekers' || winner === 'team_a';
  pushEvent(gs, 'game_over', { winner });
}

// ═══════════════════════════════════════════════════════════
//  SNAPSHOT (per-player; teammates see each other, carriers public)
// ═══════════════════════════════════════════════════════════
function getAropsSnapshot(gs, userId) {
  const mode = MODES[gs.subMode];
  const me = gs.players[userId];
  const t = now();

  const phaseEndsAt = gs.phase === 'ended' ? null
    : gs.phaseStartTime + mode.phaseDurationMs(gs);

  const roster = Object.values(gs.players).map(p => {
    const entry = {
      userId: p.userId, username: p.username, avatar_color: p.avatar_color,
      role: p.role, team: p.team, status: p.status, foundBy: p.foundBy, score: p.score,
      suspicious: p.suspicious,
      frozen: isFrozen(p, t),
    };
    const isOpponent = me ? opponentOf(gs, me, p) : true;
    const reveal =
      p.userId === userId ||
      (me && !isOpponent) ||                               // teammates see each other
      (p.exposed && isOpponent && p.lastAccepted) ||       // geofence penalty
      (mode.revealPosition && mode.revealPosition(gs, me, p)) || // e.g. flag carrier
      gs.cfg.debugMode; // debug sessions (host-only, never default) skip fog of war entirely
    if (reveal && p.lastAccepted) {
      entry.lat = p.lastAccepted.lat;
      entry.lon = p.lastAccepted.lon;
      entry.positionAgeMs = t - p.lastAccepted.ts;
      entry.exposed = p.exposed;
      entry.accuracyM = p.lastAccepted.accuracyM;
    }
    return entry;
  });

  return {
    mode: 'ar_ops', subMode: gs.subMode,
    sessionId: gs.sessionId,
    phase: gs.phase, phaseEndsAt, serverTime: t,
    polygon: gs.polygon,
    comicMap: gs.comicMap,
    hitTrackingMode: gs.hitTrackingMode,
    // Host-configured shot range/cone width, exposed so the client overlay
    // matches whatever is actually being validated (see hitConfig above).
    hitRangeM: gs.hitConfig.maxRangeM,
    hitConeHalfAngleDeg: gs.hitConfig.baseConeHalfAngleDeg,
    winner: gs.winner,
    debugMode: !!gs.cfg.debugMode,
    autoScale: !!gs.cfg.autoScale,
    timings: {
      freezeMs: gs.timings.freezeMs,
      captureDwellMs: gs.timings.captureDwellMs,
      flagPickupDwellMs: gs.timings.flagPickupDwellMs,
      plantDwellMs: gs.timings.plantDwellMs,
      defuseDwellMs: gs.timings.defuseDwellMs,
      zoneRadiusM: gs.timings.zoneRadiusM,
    },
    me: me ? {
      role: me.role, team: me.team, status: me.status, score: me.score,
      isCaptain: me.team ? gs.captains[me.team] === userId : false,
      geofence: me.geofence, exposed: me.exposed,
      strikes: me.strikes,
      proximityAlert: me.proximityAlert,
      frozenRemainingMs: Math.max(0, (me.frozenUntil || 0) - t),
      freezeViolations: me.freezeViolations,
      radarCooldownRemainingMs: Math.max(0,
        gs.cfg.radarCooldownMs - (t - me.perks.radarLastUsed)),
      hitCooldownRemainingMs: Math.max(0,
        gs.cfg.hitCooldownMs - (t - me.lastHitAttemptAt)),
      droneCooldownRemainingMs: Math.max(0,
        gs.cfg.droneCooldownMs - (t - me.perks.droneLastUsed)),
      cloakCooldownRemainingMs: Math.max(0,
        gs.cfg.cloakCooldownMs - (t - me.perks.cloakLastUsed)),
      cloakActive: t < (me.cloakUntil || 0),
      cloakRemainingMs: Math.max(0, (me.cloakUntil || 0) - t),
      fakeMarkerCooldownRemainingMs: Math.max(0,
        gs.cfg.fakeMarkerCooldownMs - (t - me.perks.fakeMarkerLastUsed)),
      fakeMarkerActive: t < (me.fakeMarkerUntil || 0),
      fakeMarkerRemainingMs: Math.max(0, (me.fakeMarkerUntil || 0) - t),
      aufscheuchenCooldownRemainingMs: Math.max(0,
        gs.cfg.aufscheuchenCooldownMs - (t - me.perks.aufscheuchenLastUsed)),
    } : null,
    players: roster,
    events: gs.events.slice(-15),
    ...(mode.snapshotExtras ? mode.snapshotExtras(gs, me, t) : {}),
  };
}

module.exports = {
  createAropsGame, tickArops, getAropsSnapshot,
  actionArTelemetry, actionArHitAttempt, actionArUsePerk, actionArSetBase,
  ARO_DEFAULTS: DEFAULTS,
};
