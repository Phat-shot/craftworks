'use strict';
// ═══════════════════════════════════════════════════════════
//  AR OPS — server engine (mode-plugin architecture)
//
//  CORE (mode-agnostic): telemetry ingest + anti-spoof, hit
//  validation, geofence, perks, freeze mechanic, zone presence,
//  per-player privacy-preserving snapshots.
//
//  MODES (plugins in the MODES table below):
//   hide_and_seek — 3 variants via ar_settings.hsVariant: 'classic'
//                   (seekers photograph hiders; found = out), 'ffa'
//                   (jeder gegen jeden, permanent elimination), 'the_ship'
//                   (secret assassin-chain, one target each, kill = inherit)
//   domination    — hold host-placed zones, points per second
//   ctf           — captains place bases, steal the enemy flag
//   seek_destroy  — "Zerstören": rotating multi-target list, instant
//                   capture or arm/defuse variant (see MODES entry)
//   deathmatch    — team TDM, on-hit is respawn (lives) or freeze
//
//  All timings scale with field size (shared scaleTimings).
//  Team modes use FREEZE on hit: frozen players cannot shoot,
//  capture, carry or plant; moving >15 m extends the freeze.
//
//  Steckbriefe (declarative descriptions of the modes above and of the
//  hider/seeker/team_member player types — name, short description,
//  hasBases/hasTargets, team-vs-individual, shot range/width, unique
//  perks) live in packages/arops-shared/src/profiles.ts. Pure metadata for
//  now, not yet a behavior source — see that file's own header comment.
// ═══════════════════════════════════════════════════════════
const shared = require('@craftworks/arops-shared');

const BUFFER_CAP = 40;
const EVENT_CAP = 50;
const PRESENCE_MAX_AGE_MS = 12_000;   // stale positions cannot capture

const DEFAULTS = {
  hidingDurationMs: 120_000,
  gameDurationMs: 20 * 60_000,
  hitCooldownMs: 3_000,
  radarCooldownMs: 15 * 60_000,
  radarDurationMs: 15_000,        // how long revealed radar contacts stay visible to the client
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
  revealTrapCooldownMs: 60_000,   // Scout class perk (any mode)
  revealTrapDurationMs: 20_000,   // how long a placed trap stays armed
  revealTrapRevealMs: 8_000,      // how long the triggered reveal stays visible to the owner
  livesPerPlayer: 3,              // Deathmatch (respawn variant): lives before elimination
  pingCooldownMs: 5_000,          // team ping (map tap): rate limit against spam
  pingDurationMs: 20_000,         // how long a ping marker stays visible to teammates
};

function now() { return Date.now(); }

function pushEvent(gs, type, data) {
  gs.events.push({ seq: ++gs._eventSeq, ts: now(), type, ...data });
  if (gs.events.length > EVENT_CAP) gs.events.splice(0, gs.events.length - EVENT_CAP);
}

function isFrozen(p, t) { return t < (p.frozenUntil || 0); }
function isCloaked(p, t) { return t < (p.cloakUntil || 0); }

// Shared cooldown check for actionArUsePerk's perk/ping branches — was
// hand-duplicated per branch (elapsed/compare/error-shape all repeated
// identically). Only CHECKS; the caller still assigns
// container[key] = t itself once it's actually ready to consume the
// cooldown (some branches, e.g. reveal_trap, have a further failure check
// — missing position — that must be able to reject WITHOUT consuming the
// cooldown, so the assignment can't be folded into this helper).
function cooldownError(container, key, cooldownMs, t) {
  const last = container[key];
  const elapsed = t - last;
  if (last && elapsed < cooldownMs) return { ok: false, err: 'cooldown', remainingMs: cooldownMs - elapsed };
  return null;
}

function applyFreeze(gs, target, byUserId, t) {
  target.frozenUntil = t + gs.timings.freezeMs;
  target.freezeAnchor = target.lastAccepted
    ? { lat: target.lastAccepted.lat, lon: target.lastAccepted.lon } : null;
  target.freezeViolations = 0;
  pushEvent(gs, 'player_frozen', { userId: target.userId, byUserId, durationMs: gs.timings.freezeMs });
}

/**
 * Shared on-hit resolution for the 4 combat modes (Domination, CTF,
 * Seek&Destroy, Deathmatch) — host-configurable via cfg.onHit:
 *  'respawn' — lose a life, 'downed' until the base/respawn checkpoint (see
 *              applySpawnCheckpoint/tickSpawnRespawn) revives it, eliminated
 *              ('found') at 0 lives.
 *  'freeze'  — the plain team-mode freeze mechanic, no lives lost at all.
 * Returns 'eliminated' | 'downed' | 'frozen' so callers that track their own
 * win condition on elimination (currently only Deathmatch) know when to
 * check it.
 */
function resolveCombatHit(gs, target, byUserId, t) {
  if (gs.cfg.onHit === 'respawn') {
    const ms = gs.modeState;
    const remaining = Math.max(0, (ms.lives[target.userId] ?? gs.cfg.livesPerPlayer) - 1);
    ms.lives[target.userId] = remaining;
    if (remaining <= 0) {
      target.status = 'found'; // eliminated — out for the rest of the match
      dropEliminatedPerkItem(gs, target, t);
      pushEvent(gs, 'player_eliminated', { userId: target.userId, byUserId });
      return 'eliminated';
    }
    target.status = 'downed';
    target.spawnDwellMs = 0;
    pushEvent(gs, 'player_downed', { userId: target.userId, byUserId, livesRemaining: remaining });
    return 'downed';
  }
  applyFreeze(gs, target, byUserId, t);
  return 'frozen';
}

// Item pickup radius (meters) — same convention as the flag's own instant
// pickup-on-presence zone (CTF, dropFlag/tick loop), not a dwell.
const ITEM_PICKUP_RADIUS_M = 10;

/**
 * A final (permanent) elimination drops the victim's class perk — scout's
 * reveal_trap, sniper's fake_marker, bomber's cloak (see
 * PLAYER_TYPE_PROFILES[cls].uniquePerks[0], the exact 1:1 class->perk
 * mapping already used everywhere else) — as a one-time pickup at their
 * last known position. Hider/seeker ROLE perks (radar/drone/aufscheuchen)
 * never drop — only a CLASS grants exactly one perk, so classless players
 * (uniquePerks: [] on 'team_member') simply drop nothing. No position, no
 * drop (nothing to place it at). Called at every site that sets a
 * player's status to the permanent 'found' state — see this session's
 * plan/research for the full enumeration (resolveCombatHit's eliminated
 * branch, foundHider's spectator branch, H&S ffa/the_ship's kill + geofence
 * branches).
 */
function dropEliminatedPerkItem(gs, target, t) {
  const perkId = shared.PLAYER_TYPE_PROFILES[target.class]?.uniquePerks?.[0];
  if (!perkId || !target.lastAccepted) return;
  gs.items.push({
    id: `item_${++gs._itemSeq}`, perkId,
    lat: target.lastAccepted.lat, lon: target.lastAccepted.lon,
    droppedAt: t,
  });
}

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
  } else if (gs.cfg.foundMode === 'freeze') {
    // "Sucher kann Finder freezen": found doesn't remove the hider from the
    // match or flip their role — they're just temporarily out of action,
    // exactly like team-mode freeze, and resume hiding once it expires.
    applyFreeze(gs, target, byUserId, t);
  } else {
    target.status = 'found';
    dropEliminatedPerkItem(gs, target, t);
  }
}

// Delegates to the current mode's own isOpponentPair hook instead of a
// hardcoded string check against 'hide_and_seek' — a mode is NOT
// necessarily team-based just because it isn't literally hide_and_seek
// (Deathmatch, The Ship: neither team-based, and any name other than
// 'hide_and_seek' would have wrongly fallen into the team branch here,
// comparing two `undefined` teams as equal → every player treated as a
// "teammate" → position leak to everyone, see MODES[x].usesTeams instead).
function opponentOf(gs, a, b) {
  return MODES[gs.subMode].isOpponentPair(gs, a, b);
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
    // Hide & Seek has three variants (gs.cfg.hsVariant), all under this one
    // subMode — not three separate modes:
    //  'classic' (default) — seeker/hider roles, as always.
    //  'ffa' ("Jeder gegen jeden") — no teams, no roles; every other player
    //    is always a valid target, a hit eliminates permanently (no
    //    freeze/respawn). Last player standing wins; time limit falls back
    //    to highest score (tie -> draw).
    //  'the_ship' — secret assassin-chain target assignment. Every player is
    //    secretly assigned exactly one other player as their sole target,
    //    and is exactly one other player's target — the whole roster forms
    //    a single cycle (built once here), never independent pairs, so a
    //    hit can never leave a survivor without a hunter or a target. On a
    //    kill, the shooter inherits the eliminated target's own target,
    //    splicing them out of the cycle and keeping it a single loop over
    //    whoever's left. Only the killer's identity leaks (public roster,
    //    same as any other mode) — a player's TARGET's identity is secret
    //    to everyone but that player, delivered via a me-only snapshot
    //    field (me.targetUserId, see getAropsSnapshot) that carries an
    //    identity, never a position — deliberately not an overload of the
    //    revealPosition hook below (which answers a different question:
    //    "is this player's location visible").
    // 'ffa' and 'the_ship' share the same "no teams/roles" shape (checkWin,
    // onGameEnd, snapshotExtras, isOpponentPair) — only canShoot/
    // targetFilter/applyHit and the geofence-elimination branch below
    // actually differ between them.
    initState(gs) {
      if (gs.cfg.hsVariant !== 'the_ship') return;
      const ids = Object.keys(gs.players);
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      const targets = {};
      if (ids.length >= 2) {
        ids.forEach((uid, i) => { targets[uid] = ids[(i + 1) % ids.length]; });
      } else if (ids.length === 1) {
        targets[ids[0]] = null; // solo debug session: nobody to hunt
      }
      gs.modeState = { targets };
    },
    canShoot(gs, p) {
      if (gs.cfg.hsVariant === 'the_ship') {
        return gs.modeState.targets[p.userId] ? null : 'no_target';
      }
      if (gs.cfg.hsVariant === 'ffa') return null; // anyone can shoot anyone
      if (p.role !== 'seeker') return 'role_cannot_shoot';
      return null;
    },
    // The Ship restricts targetFilter to a single specific player instead
    // of a whole category — you can only ever hit your own assigned
    // target, nobody else. 'ffa' has no category restriction at all.
    targetFilter(gs, shooter, c) {
      if (gs.cfg.hsVariant === 'the_ship') return c.userId === gs.modeState.targets[shooter.userId];
      if (gs.cfg.hsVariant === 'ffa') return true;
      return c.role === 'hider';
    },
    applyHit(gs, shooter, target, verdict, t) {
      if (gs.cfg.hsVariant === 'the_ship') {
        shooter.score += 10;
        const ms = gs.modeState;
        const inherited = ms.targets[target.userId];
        target.status = 'found'; // eliminated — permanently out
        dropEliminatedPerkItem(gs, target, t);
        ms.targets[target.userId] = null;
        // Guards the only case a cycle splice could self-target: exactly 2
        // players left (A→B→A) — hitting B would otherwise assign A as A's
        // own target. Harmless in practice (checkWin ends the match the
        // same tick since only A remains) but null is the honest value.
        ms.targets[shooter.userId] = (inherited && inherited !== shooter.userId) ? inherited : null;
        pushEvent(gs, 'player_eliminated', { userId: target.userId, byUserId: shooter.userId });
        this.checkWin(gs);
        return;
      }
      if (gs.cfg.hsVariant === 'ffa') {
        shooter.score += 10;
        target.status = 'found'; // eliminated — permanent, no freeze/respawn
        dropEliminatedPerkItem(gs, target, t);
        pushEvent(gs, 'player_eliminated', { userId: target.userId, byUserId: shooter.userId });
        this.checkWin(gs);
        return;
      }
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
      // auto-end them just because there are trivially "0 left".
      if (Object.keys(gs.players).length < 2) return;
      if (gs.cfg.hsVariant !== 'classic') {
        const alive = Object.values(gs.players).filter(p => p.status === 'alive');
        if (alive.length <= 1) endGame(gs, alive.length === 1 ? alive[0].userId : 'draw');
        return;
      }
      const hidersLeft = Object.values(gs.players)
        .filter(p => p.role === 'hider' && p.status === 'alive').length;
      if (hidersLeft === 0) endGame(gs, 'seekers');
    },
    tick(gs, t) {
      // 'ffa'/'the_ship' have no hiding phase (no hider role to hide from) —
      // they skip straight through to the shootable phase on the very
      // first tick, same phase machinery as classic, just zero-length.
      if (gs.phase === 'hiding') {
        const hidingDone = gs.cfg.hsVariant !== 'classic' || t - gs.phaseStartTime >= gs.cfg.hidingDurationMs;
        if (hidingDone) {
          gs.phase = 'seeking';
          gs.phaseStartTime = t;
          pushEvent(gs, 'phase_change', { phase: 'seeking' });
        }
      } else if (gs.phase === 'seeking' && t - gs.phaseStartTime >= gs.cfg.gameDurationMs) {
        if (gs.cfg.hsVariant === 'classic') {
          endGame(gs, 'hiders');
        } else {
          // No teams/hiders to compare — highest score wins (tie -> draw).
          const alive = Object.values(gs.players).filter(p => p.status === 'alive');
          if (alive.length === 0) { endGame(gs, 'draw'); return; }
          const top = Math.max(...alive.map(p => p.score));
          const leaders = alive.filter(p => p.score === top);
          endGame(gs, leaders.length === 1 ? leaders[0].userId : 'draw');
        }
        return;
      }
      // Geofence: exposure + auto-elimination for whoever leaves too long.
      // Classic: only hiders (seekers have nothing to hide from). The Ship:
      // everyone, spliced out of the assassin chain same as a kill. 'ffa':
      // everyone, plain permanent elimination (no chain to splice).
      for (const p of Object.values(gs.players)) {
        if (p.status !== 'alive' || p.outsideSince === null) continue;
        const outsideFor = t - p.outsideSince;
        if (outsideFor < gs.cfg.geofenceAutoFoundMs) continue;
        if (gs.cfg.hsVariant === 'the_ship') {
          const ms = gs.modeState;
          const hunter = Object.values(gs.players).find(h => ms.targets[h.userId] === p.userId);
          const inherited = ms.targets[p.userId];
          p.status = 'found';
          dropEliminatedPerkItem(gs, p, t);
          ms.targets[p.userId] = null;
          if (hunter) ms.targets[hunter.userId] = (inherited && inherited !== hunter.userId) ? inherited : null;
          pushEvent(gs, 'player_eliminated', { userId: p.userId, byUserId: null, reason: 'left_field' });
          this.checkWin(gs);
          if (gs.gameOver) return;
        } else if (gs.cfg.hsVariant === 'ffa') {
          p.status = 'found';
          dropEliminatedPerkItem(gs, p, t);
          pushEvent(gs, 'player_eliminated', { userId: p.userId, byUserId: null, reason: 'left_field' });
          this.checkWin(gs);
          if (gs.gameOver) return;
        } else if (p.role === 'hider') {
          foundHider(gs, p, t, null);
          pushEvent(gs, 'player_found', { userId: p.userId, byUserId: null, reason: 'left_field' });
          this.checkWin(gs);
          if (gs.gameOver) return;
        }
      }
    },
    onGameEnd(gs) {
      if (gs.cfg.hsVariant !== 'classic') return;
      for (const p of Object.values(gs.players)) {
        if (p.role === 'hider' && p.status === 'alive') p.score += 20;
      }
    },
    snapshotExtras(gs) {
      if (gs.cfg.hsVariant !== 'classic') {
        return { aliveCount: Object.values(gs.players).filter(p => p.status === 'alive').length };
      }
      return {
        hidersRemaining: Object.values(gs.players)
          .filter(p => p.role === 'hider' && p.status === 'alive').length,
      };
    },
    isOpponentPair(gs, a, b) {
      if (gs.cfg.hsVariant !== 'classic') return true;
      return a.role !== b.role;
    },
    revealPosition() { return false; },
  },

  // ── DOMINATION ────────────────────────────────────────────
  domination: {
    usesTeams: true,
    // No base concept to the mode itself (points are zones, not spawns) —
    // only needed when 'respawn' is chosen (somewhere to revive), same
    // reasoning as Deathmatch. 'freeze' needs no base at all, but still gets
    // a short prep phase 1 (see MODES.seek_destroy's comment for why).
    initialPhase: (cfg) => cfg.onHit === 'respawn' ? 'base_setup' : 'warmup',
    shootPhases: ['live'],
    phaseDurationMs(gs) {
      return gs.phase === 'base_setup' ? gs.timings.baseSettingMs
        : gs.phase === 'warmup' ? gs.timings.warmupMs
        : gs.phase === 'live' ? gs.cfg.gameDurationMs : 0;
    },
    initState(gs) {
      gs.modeState = {
        owners: Object.fromEntries(gs.zones.map(z => [z.id, null])), // team letter, or userId in ffa
        capProgress: {},   // zid -> { key, ms } (key: team letter, or userId in ffa)
        teamScore: { a: 0, b: 0 },  // team variant only
        playerScore: {},            // ffa variant only: userId -> score (seconds held)
        ...(gs.cfg.onHit === 'respawn' ? {
          bases: gs.cfg.teamVariant === 'ffa'
            ? Object.fromEntries(Object.values(gs.players).map(p => [p.userId, null]))
            : { a: null, b: null },
          lives: Object.fromEntries(Object.values(gs.players).map(p => [p.userId, gs.cfg.livesPerPlayer])),
        } : {}),
      };
    },
    canShoot() { return null; },
    targetFilter(gs, shooter, c) {
      return gs.cfg.teamVariant === 'ffa' ? c.userId !== shooter.userId : c.team !== shooter.team;
    },
    applyHit(gs, shooter, target, verdict, t) {
      resolveCombatHit(gs, target, shooter.userId, t);
      shooter.score += 5;
    },
    tick(gs, t, dtMs) {
      const ms = gs.modeState;
      if (gs.phase === 'base_setup') {
        if (t - gs.phaseStartTime >= gs.timings.baseSettingMs) transitionFromBaseSetup(gs, t);
        return;
      }
      if (gs.phase === 'warmup') {
        if (t - gs.phaseStartTime >= gs.timings.warmupMs) transitionFromWarmup(gs, t);
        return;
      }
      if (gs.phase !== 'live') return;
      const ffa = gs.cfg.teamVariant === 'ffa';
      // Zone capture + scoring — presentKeys is either the ≤1 team dwelling
      // alone in the zone, or (ffa) the single player dwelling alone in it.
      for (const z of gs.zones) {
        const pres = zonePresence(gs, z, t);
        const presentKeys = ffa ? pres.all : ['a', 'b'].filter(tm => pres.byTeam[tm].length > 0);
        if (presentKeys.length === 1) {
          const key = presentKeys[0];
          if (ms.owners[z.id] !== key) {
            const prog = ms.capProgress[z.id];
            const nextMs = (prog && prog.key === key ? prog.ms : 0) + dtMs;
            ms.capProgress[z.id] = { key, ms: nextMs };
            if (nextMs >= gs.timings.captureDwellMs) {
              ms.owners[z.id] = key;
              delete ms.capProgress[z.id];
              if (ffa) gs.players[key].score += 5;
              else for (const uid of pres.byTeam[key]) gs.players[uid].score += 5;
              pushEvent(gs, 'zone_captured', ffa ? { zoneId: z.id, userId: key } : { zoneId: z.id, team: key });
            }
          }
        }
        // contested or empty: progress pauses (kept, not reset)
        const owner = ms.owners[z.id];
        if (owner) {
          if (ffa) ms.playerScore[owner] = (ms.playerScore[owner] || 0) + dtMs / 1000;
          else ms.teamScore[owner] += dtMs / 1000; // 1 pt per second per zone
        }
      }
      // Win: target score or time limit
      if (ffa) {
        for (const [uid, sc] of Object.entries(ms.playerScore)) {
          if (sc >= gs.cfg.targetScore) return endGame(gs, 'player_' + uid);
        }
        if (t - gs.phaseStartTime >= gs.cfg.gameDurationMs) {
          const entries = Object.entries(ms.playerScore);
          if (!entries.length) return endGame(gs, 'draw');
          entries.sort((a, b) => b[1] - a[1]);
          const leaders = entries.filter(([, sc]) => sc === entries[0][1]);
          return endGame(gs, leaders.length > 1 ? 'draw' : 'player_' + leaders[0][0]);
        }
      } else {
        if (ms.teamScore.a >= gs.cfg.targetScore) return endGame(gs, 'team_a');
        if (ms.teamScore.b >= gs.cfg.targetScore) return endGame(gs, 'team_b');
        if (t - gs.phaseStartTime >= gs.cfg.gameDurationMs) {
          endGame(gs, ms.teamScore.a > ms.teamScore.b ? 'team_a'
            : ms.teamScore.b > ms.teamScore.a ? 'team_b' : 'draw');
        }
      }
    },
    onGameEnd() {},
    snapshotExtras(gs) {
      const ms = gs.modeState;
      const ffa = gs.cfg.teamVariant === 'ffa';
      return {
        ...(ffa
          ? { playerScore: Object.fromEntries(Object.entries(ms.playerScore).map(([k, v]) => [k, Math.floor(v)])) }
          : { teamScore: { a: Math.floor(ms.teamScore.a), b: Math.floor(ms.teamScore.b) } }),
        targetScore: gs.cfg.targetScore,
        zones: gs.zones.map(z => ({
          id: z.id, lat: z.lat, lon: z.lon, radiusM: z.radiusM,
          owner: ms.owners[z.id],
          capture: ms.capProgress[z.id]
            ? { [ffa ? 'userId' : 'team']: ms.capProgress[z.id].key,
                pct: Math.min(100, Math.round(100 * ms.capProgress[z.id].ms / gs.timings.captureDwellMs)) }
            : null,
        })),
        onHit: gs.cfg.onHit,
        ...(ms.lives ? { lives: ms.lives, livesPerPlayer: gs.cfg.livesPerPlayer } : {}),
        ...(ms.bases ? { bases: ms.bases } : {}),
      };
    },
    isOpponentPair(gs, a, b) {
      return gs.cfg.teamVariant === 'ffa' ? a.userId !== b.userId : a.team !== b.team;
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
    // Team mode: 2 flags keyed 'a'/'b', captain-placed bases. Ffa ("jeder
    // Spieler setzt seine Base und hat eine Flagge"): N flags, one per
    // player, own base each — every OTHER player is a potential thief
    // (isOpponentPair below), and capturing just requires bringing a stolen
    // flag to your OWN base (no requirement your own flag also be home —
    // with N players that would make scoring nearly impossible whenever
    // anyone's flag is contested, unlike the classic 2-team case).
    initState(gs) {
      const ffa = gs.cfg.teamVariant === 'ffa';
      const keys = ffa ? Object.keys(gs.players) : ['a', 'b'];
      gs.modeState = {
        bases: ffa ? Object.fromEntries(keys.map(k => [k, null])) : { a: null, b: null },
        flags: Object.fromEntries(keys.map(k =>
          [k, { state: 'home', carrier: null, lat: null, lon: null, droppedAt: null, pickupProg: null }])),
        captures: Object.fromEntries(keys.map(k => [k, 0])),
        // Only meaningful when cfg.onHit === 'respawn' (see resolveCombatHit)
        // — always allocated regardless, same convention Deathmatch already
        // used before onHit was generalized to all 4 combat modes.
        lives: Object.fromEntries(Object.values(gs.players).map(p => [p.userId, gs.cfg.livesPerPlayer])),
      };
    },
    canShoot() { return null; },
    targetFilter(gs, shooter, c) {
      return gs.cfg.teamVariant === 'ffa' ? c.userId !== shooter.userId : c.team !== shooter.team;
    },
    applyHit(gs, shooter, target, verdict, t) {
      resolveCombatHit(gs, target, shooter.userId, t);
      shooter.score += 5;
      // Carrier hit → flag drops on the spot
      for (const [fk, flag] of Object.entries(gs.modeState.flags)) {
        if (flag.state === 'carried' && flag.carrier === target.userId) {
          dropFlag(gs, fk, target, t);
        }
      }
    },
    tick(gs, t, dtMs) {
      const ms = gs.modeState;
      const ffa = gs.cfg.teamVariant === 'ffa';
      if (gs.phase === 'base_setup') {
        if (t - gs.phaseStartTime >= gs.timings.baseSettingMs) transitionFromBaseSetup(gs, t);
        return;
      }
      if (gs.phase !== 'live') return;

      const baseZone = k => ({ id: 'base_' + k, ...ms.bases[k], radiusM: gs.timings.zoneRadiusM });

      if (ffa) {
        for (const key of Object.keys(ms.flags)) {
          const flag = ms.flags[key];
          if (flag.state === 'home') {
            const pres = zonePresence(gs, baseZone(key), t);
            const thieves = pres.all.filter(uid => uid !== key);
            flag.pickupProg = advanceDwell(flag.pickupProg, thieves, thieves.length ? dtMs : 0);
            if (!thieves.length) flag.pickupProg = null;
            if (flag.pickupProg && flag.pickupProg.ms >= gs.timings.flagPickupDwellMs) {
              flag.state = 'carried';
              flag.carrier = flag.pickupProg.uid;
              flag.pickupProg = null;
              pushEvent(gs, 'flag_taken', { flagOwner: key, byUserId: flag.carrier });
            }
          } else if (flag.state === 'carried') {
            const carrier = gs.players[flag.carrier];
            if (!carrier || carrier.status !== 'alive' || carrier.geofence === 'outside') {
              dropFlag(gs, key, carrier, t);
              continue;
            }
            const carrierBase = ms.bases[carrier.userId];
            if (carrierBase && carrier.lastAccepted
                && shared.isInZone(carrier.lastAccepted, { ...carrierBase, radiusM: gs.timings.zoneRadiusM })
                && !isFrozen(carrier, t)) {
              ms.captures[carrier.userId] = (ms.captures[carrier.userId] || 0) + 1;
              carrier.score += 20;
              flag.state = 'home'; flag.carrier = null;
              pushEvent(gs, 'flag_captured', { byUserId: carrier.userId, flagOwner: key });
              if (ms.captures[carrier.userId] >= gs.cfg.targetCaptures) {
                return endGame(gs, 'player_' + carrier.userId);
              }
            }
          } else if (flag.state === 'dropped') {
            const dz = { id: 'flag_' + key, lat: flag.lat, lon: flag.lon, radiusM: 10 };
            const pres = zonePresence(gs, dz, t);
            if (pres.all.includes(key)) {
              flag.state = 'home'; flag.carrier = null; flag.droppedAt = null;
              pushEvent(gs, 'flag_returned', { flagOwner: key, byUserId: key });
            } else if (pres.all.length > 0) {
              const thief = pres.all[0];
              flag.state = 'carried'; flag.carrier = thief; flag.droppedAt = null;
              pushEvent(gs, 'flag_taken', { flagOwner: key, byUserId: thief });
            } else if (t - flag.droppedAt >= gs.timings.flagReturnMs) {
              flag.state = 'home'; flag.carrier = null; flag.droppedAt = null;
              pushEvent(gs, 'flag_returned', { flagOwner: key, byUserId: null });
            }
          }
        }
        if (t - gs.phaseStartTime >= gs.cfg.gameDurationMs) {
          const entries = Object.entries(ms.captures);
          if (!entries.length) return endGame(gs, 'draw');
          entries.sort((a, b) => b[1] - a[1]);
          const leaders = entries.filter(([, c]) => c === entries[0][1]);
          endGame(gs, leaders.length > 1 ? 'draw' : 'player_' + leaders[0][0]);
        }
        return;
      }

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
      const ffa = gs.cfg.teamVariant === 'ffa';
      const flagPos = (key) => {
        const f = ms.flags[key];
        if (f.state === 'home') return ms.bases[key];
        if (f.state === 'dropped') return { lat: f.lat, lon: f.lon };
        const c = gs.players[f.carrier];
        return c?.lastAccepted ? { lat: c.lastAccepted.lat, lon: c.lastAccepted.lon } : ms.bases[key];
      };
      return {
        captures: ms.captures,
        targetCaptures: gs.cfg.targetCaptures,
        bases: ms.bases,
        zoneRadiusM: gs.timings.zoneRadiusM,
        onHit: gs.cfg.onHit,
        ...(gs.cfg.onHit === 'respawn' ? { lives: ms.lives, livesPerPlayer: gs.cfg.livesPerPlayer } : {}),
        flags: Object.keys(ms.flags).map(key => {
          const f = ms.flags[key];
          return {
            [ffa ? 'owner' : 'team']: key, state: f.state, carrier: f.carrier,
            ...(ms.bases[key] || gs.phase === 'live' ? (flagPos(key) || {}) : {}),
            // Thief's dwell progress stealing this flag — only ever non-null
            // while state === 'home' (pickupProg is unused/null otherwise).
            // Client uses this to flow-ring the base being raided, colored
            // by the raiding team (team mode) or raiding player (ffa).
            pickupPct: f.pickupProg
              ? Math.min(100, Math.round(100 * f.pickupProg.ms / gs.timings.flagPickupDwellMs)) : 0,
            ...(ffa
              ? { pickupBy: f.pickupProg ? f.pickupProg.uid : null }
              : { pickupTeam: f.pickupProg ? (key === 'a' ? 'b' : 'a') : null }),
          };
        }),
      };
    },
    isOpponentPair(gs, a, b) {
      return gs.cfg.teamVariant === 'ffa' ? a.userId !== b.userId : a.team !== b.team;
    },
    // Flag carriers are visible to EVERYONE (classic CTF rule)
    revealPosition(gs, viewer, p) {
      const ms = gs.modeState;
      return Object.values(ms.flags).some(f => f.state === 'carried' && f.carrier === p.userId);
    },
  },

  // ── SEEK & DESTROY ────────────────────────────────────────
  // ── ZERSTÖREN (replaces the old single bomb-site "Seek & Destroy") ────
  // Rotating single-active-target: one of gs.zones is "active" at a time,
  // capturing it destroys it and the next non-destroyed zone activates.
  // Two host-configurable variants (cfg.destroyVariant):
  //  'instant' (default) — symmetric, EITHER team can capture the active
  //    target (dwell-to-capture, same convention as Domination's zone
  //    capture) — whoever gets there first destroys it and scores.
  //  'defuse' — asymmetric, mirrors the old mechanic: team 'a' dwells to
  //    arm/plant the active target, which then has a timer (2x the plant
  //    dwell time) before it explodes/is destroyed; team 'b' can defuse
  //    during that window (dwell-to-defuse) — defusing does NOT destroy
  //    the target, it just resets the arm attempt so team 'a' can try again.
  // cfg.destroyReactivate (host toggle): once every zone has been
  // destroyed, either the match ends immediately (default, false) or every
  // zone reactivates and the cycle continues until the time limit (true).
  seek_destroy: {
    usesTeams: true,
    // No base concept to the mode itself (targets are host/random-placed
    // zones, not spawns) — only needed when 'respawn' is chosen (somewhere
    // to revive). Freeze needs no base, but still gets a "Warmup" phase 1
    // instead of dropping straight into 'live' with zero prep time —
    // previously this mode had NO phase 1 at all regardless of onHit.
    initialPhase: (cfg) => cfg.onHit === 'respawn' ? 'base_setup' : 'warmup',
    shootPhases: ['live'],
    phaseDurationMs(gs) {
      return gs.phase === 'base_setup' ? gs.timings.baseSettingMs
        : gs.phase === 'warmup' ? gs.timings.warmupMs
        : gs.phase === 'live' ? gs.cfg.gameDurationMs : 0;
    },
    initState(gs) {
      gs.modeState = {
        activeIndex: 0,
        destroyed: gs.zones.map(() => false),
        captureProg: null, // { team, ms } (instant) or { uid, team, ms } (defuse arm progress)
        armed: null,       // { armedAt, explodeAt, defuseProg } (defuse variant only)
        ...(gs.cfg.onHit === 'respawn' ? {
          bases: gs.cfg.teamVariant === 'ffa'
            ? Object.fromEntries(Object.values(gs.players).map(p => [p.userId, null]))
            : { a: null, b: null },
          lives: Object.fromEntries(Object.values(gs.players).map(p => [p.userId, gs.cfg.livesPerPlayer])),
        } : {}),
      };
    },
    canShoot() { return null; },
    targetFilter(gs, shooter, c) {
      return gs.cfg.teamVariant === 'ffa' ? c.userId !== shooter.userId : c.team !== shooter.team;
    },
    applyHit(gs, shooter, target, verdict, t) {
      resolveCombatHit(gs, target, shooter.userId, t);
      shooter.score += 5;
    },
    // Destroys the currently active zone, credits `scoringUids` (may be
    // empty — the passive explosion case credits nobody individually),
    // then activates the next non-destroyed zone or ends the match. `byKey`
    // is a team letter in team mode, a userId in ffa (createAropsGame forces
    // destroyVariant back to 'instant' whenever ffa — 'defuse' is inherently
    // attacker/defender-shaped and never reaches this function under ffa).
    destroyActive(gs, byKey, scoringUids, t) {
      const ms = gs.modeState;
      const ffa = gs.cfg.teamVariant === 'ffa';
      const zone = gs.zones[ms.activeIndex];
      ms.destroyed[ms.activeIndex] = true;
      ms.captureProg = null;
      ms.armed = null;
      for (const uid of scoringUids) { const p = gs.players[uid]; if (p) p.score += 10; }
      pushEvent(gs, 'target_destroyed', ffa ? { zoneId: zone.id, byUserId: byKey } : { zoneId: zone.id, byTeam: byKey });

      const remaining = gs.zones.map((_, i) => i).filter(i => !ms.destroyed[i]);
      if (remaining.length === 0) {
        if (gs.cfg.destroyReactivate) {
          ms.destroyed = ms.destroyed.map(() => false);
          ms.activeIndex = 0;
          pushEvent(gs, 'targets_reactivated', {});
        } else {
          return endGame(gs, ffa ? 'player_' + byKey : (byKey === 'a' ? 'team_a' : 'team_b'));
        }
      } else {
        ms.activeIndex = remaining[0];
      }
    },
    tick(gs, t, dtMs) {
      const ms = gs.modeState;
      if (gs.phase === 'base_setup') {
        if (t - gs.phaseStartTime >= gs.timings.baseSettingMs) transitionFromBaseSetup(gs, t);
        return;
      }
      if (gs.phase === 'warmup') {
        if (t - gs.phaseStartTime >= gs.timings.warmupMs) transitionFromWarmup(gs, t);
        return;
      }
      if (gs.phase !== 'live') return;
      const ffa = gs.cfg.teamVariant === 'ffa';
      const zone = gs.zones[ms.activeIndex];
      if (!zone) return; // defensive — shouldn't happen, all zones destroyed without reactivation ends the match already

      if (gs.cfg.destroyVariant === 'defuse') {
        if (!ms.armed) {
          const pres = zonePresence(gs, zone, t);
          const attackers = pres.byTeam.a;
          const slot = ms.captureProg && ms.captureProg.team === 'a' ? ms.captureProg : null;
          if (attackers.length) {
            const next = advanceDwell(slot, attackers, dtMs);
            ms.captureProg = { team: 'a', uid: next.uid, ms: next.ms };
            if (next.ms >= gs.timings.plantDwellMs) {
              ms.armed = { armedAt: t, explodeAt: t + gs.timings.plantDwellMs * 2, defuseProg: null };
              ms.captureProg = null;
              pushEvent(gs, 'target_armed', { zoneId: zone.id, byUserId: next.uid, explodeAt: ms.armed.explodeAt });
            }
          } else {
            ms.captureProg = null;
          }
        } else {
          const pres = zonePresence(gs, zone, t);
          const defenders = pres.byTeam.b;
          ms.armed.defuseProg = advanceDwell(ms.armed.defuseProg, defenders, defenders.length ? dtMs : 0);
          if (!defenders.length) ms.armed.defuseProg = null;
          if (ms.armed.defuseProg && ms.armed.defuseProg.ms >= gs.timings.defuseDwellMs) {
            pushEvent(gs, 'target_defused', { zoneId: zone.id, byUserId: ms.armed.defuseProg.uid });
            const p = gs.players[ms.armed.defuseProg.uid]; if (p) p.score += 10;
            ms.armed = null; // defusing spares the target — stays active, attackers can re-arm it
          } else if (t >= ms.armed.explodeAt) {
            this.destroyActive(gs, 'a', [], t);
          }
        }
      } else if (ffa) {
        // instant, ffa: any single player alone in the zone dwell-captures it
        const pres = zonePresence(gs, zone, t);
        if (pres.all.length === 1) {
          const uid = pres.all[0];
          const prog = ms.captureProg && ms.captureProg.uid === uid ? ms.captureProg : null;
          const nextMs = (prog ? prog.ms : 0) + dtMs;
          ms.captureProg = { uid, ms: nextMs };
          if (nextMs >= gs.timings.captureDwellMs) {
            this.destroyActive(gs, uid, [uid], t);
            return;
          }
        }
      } else {
        // instant (default): either team can dwell-capture the active target
        const pres = zonePresence(gs, zone, t);
        const teamsIn = ['a', 'b'].filter(tm => pres.byTeam[tm].length > 0);
        if (teamsIn.length === 1) {
          const tm = teamsIn[0];
          const prog = ms.captureProg && ms.captureProg.team === tm ? ms.captureProg : null;
          const nextMs = (prog ? prog.ms : 0) + dtMs;
          ms.captureProg = { team: tm, ms: nextMs };
          if (nextMs >= gs.timings.captureDwellMs) {
            this.destroyActive(gs, tm, pres.byTeam[tm], t);
            return;
          }
        }
        // contested by both teams or empty: progress pauses (kept), same
        // convention as Domination's zone capture.
      }

      if (!gs.gameOver && t - gs.phaseStartTime >= gs.cfg.gameDurationMs) {
        if (ffa) {
          const entries = Object.values(gs.players).map(p => [p.userId, p.score]);
          if (!entries.length) return endGame(gs, 'draw');
          entries.sort((a, b) => b[1] - a[1]);
          const leaders = entries.filter(([, sc]) => sc === entries[0][1]);
          endGame(gs, leaders.length > 1 ? 'draw' : 'player_' + leaders[0][0]);
        } else {
          const scores = { a: 0, b: 0 };
          for (const p of Object.values(gs.players)) if (p.team) scores[p.team] += p.score;
          endGame(gs, scores.a > scores.b ? 'team_a' : scores.b > scores.a ? 'team_b' : 'draw');
        }
      }
    },
    onGameEnd() {},
    snapshotExtras(gs) {
      const ms = gs.modeState;
      const ffa = gs.cfg.teamVariant === 'ffa';
      return {
        targets: gs.zones.map((z, i) => ({
          id: z.id, lat: z.lat, lon: z.lon, radiusM: z.radiusM,
          destroyed: ms.destroyed[i], active: i === ms.activeIndex,
        })),
        destroyVariant: gs.cfg.destroyVariant,
        // Team/player attribution: 'instant' variant can be captured by
        // whoever's dwelling alone (team or, in ffa, individual player);
        // 'defuse' variant's capture progress here is always team a's
        // arming attempt (defusing is a separate, always-team-b progress,
        // see armed below — ffa never reaches 'defuse', see destroyVariant
        // force-reset in createAropsGame). Client colors the flow-ring
        // overlay by team, or by the capturing player's avatar color in ffa.
        capture: ms.captureProg
          ? { [ffa ? 'userId' : 'team']: ffa ? ms.captureProg.uid : ms.captureProg.team,
              pct: Math.min(100, Math.round(100 * ms.captureProg.ms /
                (gs.cfg.destroyVariant === 'defuse' ? gs.timings.plantDwellMs : gs.timings.captureDwellMs))) }
          : null,
        armed: ms.armed ? {
          explodeAt: ms.armed.explodeAt,
          defusePct: ms.armed.defuseProg
            ? Math.min(100, Math.round(100 * ms.armed.defuseProg.ms / gs.timings.defuseDwellMs)) : 0,
        } : null,
        onHit: gs.cfg.onHit,
        ...(ms.lives ? { lives: ms.lives, livesPerPlayer: gs.cfg.livesPerPlayer } : {}),
        ...(ms.bases ? { bases: ms.bases } : {}),
      };
    },
    isOpponentPair(gs, a, b) {
      return gs.cfg.teamVariant === 'ffa' ? a.userId !== b.userId : a.team !== b.team;
    },
    revealPosition() { return false; },
  },

  // ── DEATHMATCH ────────────────────────────────────────────
  // Team vs team, no objective besides frags. Two on-hit consequences
  // (cfg.onHit, host-configurable, see resolveCombatHit): 'respawn' — lose a
  // life, 'downed' until the base/respawn checkpoint (see
  // applySpawnCheckpoint/tickSpawnRespawn) revives it, eliminated at 0
  // lives (Deathmatch's default) — or 'freeze' — the plain team-mode freeze
  // mechanic, no lives lost at all. 'respawn' reuses the exact same
  // base_setup phase as CTF (captain places a base, see actionArSetBase)
  // since it needs somewhere to revive; 'freeze' needs no base at all, so
  // phase 1 is the base-less 'warmup' prep phase instead (shared with
  // Domination/Seek&Destroy's freeze path).
  deathmatch: {
    usesTeams: true,
    initialPhase: (cfg) => cfg.onHit === 'respawn' ? 'base_setup' : 'warmup',
    shootPhases: ['live'],
    phaseDurationMs(gs) {
      return gs.phase === 'base_setup' ? gs.timings.baseSettingMs
        : gs.phase === 'warmup' ? gs.timings.warmupMs
        : gs.phase === 'live' ? gs.cfg.gameDurationMs : 0;
    },
    initState(gs) {
      gs.modeState = {
        // Team mode: bases keyed 'a'/'b', captain-placed. Ffa: bases keyed
        // by userId, every player places their own (see tick's base_setup).
        // Only allocated when 'respawn' is chosen — 'freeze' has nothing to
        // check players into, and skips base_setup entirely (see initialPhase).
        ...(gs.cfg.onHit === 'respawn' ? {
          bases: gs.cfg.teamVariant === 'ffa'
            ? Object.fromEntries(Object.values(gs.players).map(p => [p.userId, null]))
            : { a: null, b: null },
        } : {}),
        lives: Object.fromEntries(Object.values(gs.players).map(p => [p.userId, gs.cfg.livesPerPlayer])),
      };
    },
    isOpponentPair(gs, a, b) {
      return gs.cfg.teamVariant === 'ffa' ? a.userId !== b.userId : a.team !== b.team;
    },
    canShoot() { return null; },
    targetFilter(gs, shooter, c) {
      return gs.cfg.teamVariant === 'ffa' ? c.userId !== shooter.userId : c.team !== shooter.team;
    },
    applyHit(gs, shooter, target, verdict, t) {
      shooter.score += 10;
      if (resolveCombatHit(gs, target, shooter.userId, t) === 'eliminated') this.checkWin(gs);
    },
    checkWin(gs) {
      if (gs.cfg.teamVariant === 'ffa') {
        // Last player standing wins — only reachable under cfg.onHit
        // 'respawn' (the only variant that ever sets status='found' here,
        // same asymmetry as team mode's checkWin/'freeze' comment below).
        const alive = Object.values(gs.players).filter(p => p.status !== 'found');
        if (alive.length === 0) return endGame(gs, 'draw');
        if (alive.length === 1) return endGame(gs, 'player_' + alive[0].userId);
        return;
      }
      const remaining = { a: 0, b: 0 };
      for (const p of Object.values(gs.players)) {
        if (p.team && p.status !== 'found') remaining[p.team]++;
      }
      if (remaining.a === 0 && remaining.b === 0) return endGame(gs, 'draw');
      if (remaining.a === 0) return endGame(gs, 'team_b');
      if (remaining.b === 0) return endGame(gs, 'team_a');
    },
    tick(gs, t) {
      const ms = gs.modeState;
      const ffa = gs.cfg.teamVariant === 'ffa';
      if (gs.phase === 'base_setup') {
        if (t - gs.phaseStartTime >= gs.timings.baseSettingMs) transitionFromBaseSetup(gs, t);
        return;
      }
      if (gs.phase === 'warmup') {
        if (t - gs.phaseStartTime >= gs.timings.warmupMs) transitionFromWarmup(gs, t);
        return;
      }
      if (gs.phase !== 'live') return;
      if (t - gs.phaseStartTime >= gs.cfg.gameDurationMs) {
        // Time limit: 'respawn' compares total lives left, 'freeze' compares
        // score (frags) — lives never change under 'freeze', so a lives
        // comparison would always tie there.
        if (ffa) {
          const entries = Object.values(gs.players).map(p =>
            [p.userId, gs.cfg.onHit === 'respawn' ? (ms.lives[p.userId] ?? 0) : p.score]);
          if (!entries.length) return endGame(gs, 'draw');
          entries.sort((a, b) => b[1] - a[1]);
          const leaders = entries.filter(([, sc]) => sc === entries[0][1]);
          endGame(gs, leaders.length > 1 ? 'draw' : 'player_' + leaders[0][0]);
        } else {
          const sums = { a: 0, b: 0 };
          for (const p of Object.values(gs.players)) {
            if (!p.team) continue;
            sums[p.team] += gs.cfg.onHit === 'respawn' ? (ms.lives[p.userId] ?? 0) : p.score;
          }
          endGame(gs, sums.a > sums.b ? 'team_a' : sums.b > sums.a ? 'team_b' : 'draw');
        }
      }
    },
    onGameEnd() {},
    snapshotExtras(gs) {
      return {
        lives: gs.modeState.lives,
        livesPerPlayer: gs.cfg.livesPerPlayer,
        onHit: gs.cfg.onHit,
        bases: gs.modeState.bases,
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

// Shared 'base_setup' -> 'live' transition (CTF always; Domination/
// Seek&Destroy/Deathmatch only when cfg.onHit === 'respawn', see each mode's
// initialPhase): auto-places any base a captain/player never set (falls
// back to their current position, or the field centroid if that's
// unavailable too), then hands off to the live phase and marks anyone not
// standing in their own base as needing to spawn in (applySpawnCheckpoint).
function transitionFromBaseSetup(gs, t) {
  const ms = gs.modeState;
  const ffa = gs.cfg.teamVariant === 'ffa';
  if (ffa) {
    // No captains in ffa — every player who hasn't placed their own base
    // yet falls back to their own current position.
    Object.values(gs.players).forEach((p, i) => {
      if (!ms.bases[p.userId]) {
        const pos = p.lastAccepted || fieldCentroid(gs.polygon, i * 0.1 - 0.3);
        ms.bases[p.userId] = { lat: pos.lat, lon: pos.lon };
        pushEvent(gs, 'base_set', { userId: p.userId, auto: true });
      }
    });
  } else {
    for (const tm of ['a', 'b']) {
      if (!ms.bases[tm]) {
        const cap = gs.players[gs.captains[tm]];
        const pos = cap?.lastAccepted || fieldCentroid(gs.polygon, tm === 'a' ? -0.25 : 0.25);
        ms.bases[tm] = { lat: pos.lat, lon: pos.lon };
        pushEvent(gs, 'base_set', { team: tm, auto: true });
      }
    }
  }
  gs.phase = 'live';
  gs.phaseStartTime = t;
  pushEvent(gs, 'phase_change', { phase: 'live' });
  applySpawnCheckpoint(gs, t);
}

// Shared 'warmup' -> 'live' transition (Domination/Seek&Destroy/Deathmatch
// when cfg.onHit === 'freeze') — a plain prep timer, no base to place and
// nobody to check into a spawn checkpoint (freeze needs neither).
function transitionFromWarmup(gs, t) {
  gs.phase = 'live';
  gs.phaseStartTime = t;
  pushEvent(gs, 'phase_change', { phase: 'live' });
}

// ═══════════════════════════════════════════════════════════
//  BASE/RESPAWN CHECKPOINT (any mode with team bases — CTF always;
//  Domination/Seek&Destroy/Deathmatch when cfg.onHit === 'respawn')
// ═══════════════════════════════════════════════════════════
// Generic, mode-agnostic primitive: modes that store bases in
// gs.modeState.bases[team] can call applySpawnCheckpoint() at the exact
// moment their own setup phase ends (see transitionFromBaseSetup above).
// tickSpawnRespawn() then runs every core tick regardless of mode — for
// modes/configs with no gs.modeState.bases at all (freeze-mode Domination/
// Seek&Destroy/Deathmatch, hide_and_seek incl. its ffa/the_ship variants),
// `gs.modeState.bases` is absent, so both functions are no-ops.
// Bases are keyed by team letter in team mode, by userId in the ffa variant
// (every player places their own base instead of a team captain placing a
// shared one) — same gs.modeState.bases map either way.
function baseKeyOf(p) { return p.team || p.userId; }

function isInOwnBase(gs, p) {
  if (!gs.modeState.bases) return false;
  const base = gs.modeState.bases[baseKeyOf(p)];
  if (!base || !p.lastAccepted) return false;
  return shared.haversineMeters(p.lastAccepted, base) <= gs.timings.zoneRadiusM;
}

// Called by a mode's tick() at the instant its setup phase ends. Anyone not
// standing in their own base right then doesn't get removed from the match
// — they're marked 'downed' and can still catch up via tickSpawnRespawn's
// dwell window below (late-spawn is allowed, no hard cutoff, per the
// AR-Ops modes plan). No team check here (unlike before) — the ffa variant
// has no teams at all, but still has one base per player via baseKeyOf.
function applySpawnCheckpoint(gs, t) {
  for (const p of Object.values(gs.players)) {
    if (!isInOwnBase(gs, p)) {
      p.status = 'downed';
      p.spawnDwellMs = 0;
      pushEvent(gs, 'player_needs_spawn', { userId: p.userId });
    }
  }
}

// Core tick (mode-agnostic, alongside the geofence-exposure loop) — any
// downed player who dwells CONTINUOUSLY in their own base for
// spawnCheckDwellMs spawns in (status -> 'alive'). Leaving the base resets
// progress, same convention as every other dwell mechanic here
// (capture/plant/defuse/flag pickup).
function tickSpawnRespawn(gs, t, dtMs) {
  for (const p of Object.values(gs.players)) {
    if (p.status !== 'downed') continue;
    if (isInOwnBase(gs, p)) {
      p.spawnDwellMs = (p.spawnDwellMs || 0) + dtMs;
      if (p.spawnDwellMs >= gs.timings.spawnCheckDwellMs) {
        p.status = 'alive';
        p.spawnDwellMs = 0;
        pushEvent(gs, 'player_spawned', { userId: p.userId });
      }
    } else {
      p.spawnDwellMs = 0;
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  SESSION CREATION
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
//  MATCH-SIMULATION (debug-only — see packages/arops-shared/src/simScript.ts
//  for the fixed, non-configurable snippet definitions this drives; the
//  mobile Match-Simulation screen imports the SAME module to predict
//  expected outcomes, so the two can never silently drift apart).
// ═══════════════════════════════════════════════════════════
// A snippet only ever supplies `subMode`/`classes`/`teams`/`zones`/
// `hitConfig`/`onHit`/`destroyVariant` — every other ar_settings field
// (polygon, simulation, simSnippetKey) passes through unchanged, so the
// rest of createAropsGame's normal parsing below runs completely unaware
// this is a simulation, exactly like a host manually configuring the same
// values from the Lobby UI would.
function applySimOverrides(ar, players) {
  const scenario = shared.SIM_SCENARIOS.find(s => s.key === ar.simSnippetKey);
  if (!scenario) return ar;
  const origin = fieldCentroid(ar.polygon || []);
  const tester = players.find(p => !p.isBot);
  const classes = tester ? { [tester.userId]: scenario.testerClass } : {};
  const teams = (tester && scenario.testerTeam) ? { [tester.userId]: scenario.testerTeam } : {};
  for (const b of scenario.bots) {
    classes[b.id] = b.class;
    if (b.team) teams[b.id] = b.team;
  }
  const zones = (scenario.zones || []).map(z => shared.destinationPoint(origin, z.bearingDeg, z.distanceM));
  return {
    ...ar,
    subMode: scenario.subMode,
    classes, teams, zones,
    teamVariant: 'team',
    ...(scenario.onHit ? { onHit: scenario.onHit } : {}),
    ...(scenario.hitConfig ? { hitConfig: scenario.hitConfig } : {}),
    // Bypasses platform.js's 5s floor on client-sent timings entirely (this
    // writes directly into the internal ar object before createAropsGame's
    // own parsing, which has no such floor) — lets a whole freeze/capture
    // cycle fit inside a scenario that's only 1-10s long in total.
    ...(scenario.timings ? { timings: scenario.timings } : {}),
    debugMode: true, // ground-truth visibility — the tester must see real bot positions
  };
}

function createAropsGame(sessionId, players, workshopConfig) {
  let ar = workshopConfig?.ar_settings || {};
  if (ar.simulation === true) ar = applySimOverrides(ar, players);
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
    // Scout's class perk — previously missing here entirely, so it stayed
    // stuck at the fixed DEFAULTS value regardless of field/match size
    // while every other perk cooldown did scale.
    cfg.revealTrapCooldownMs = auto.revealTrapCooldownMs;
    // Perk effect durations — previously fixed constants, never field-scaled
    // regardless of match size. All share the same value ("Dauer ist analog
    // Radar" — same anchor points as radarCooldownMs above).
    cfg.radarDurationMs = auto.perkDurationMs;
    cfg.cloakDurationMs = auto.perkDurationMs;
    cfg.fakeMarkerDurationMs = auto.perkDurationMs;
    cfg.aufscheuchenDurationMs = auto.perkDurationMs;
    cfg.revealTrapDurationMs = auto.perkDurationMs;
    // Passive "opponent nearby" sensor (tickCore, sets me.proximityAlert
    // every tick for every player) — same "opponent within range" concept
    // the Drone perk's own alert already uses (see actionArUsePerk's
    // 'drone' branch, shared.scaleDroneRangeM), reused here for the exact
    // same reason: DEFAULTS' flat 40m stayed fixed regardless of field size,
    // so on anything bigger than a small field this basically never fired —
    // reported as "the passive alert never shows, only the Drone perk's
    // does" (the perk's own range happened to scale, this one didn't).
    cfg.proximityRangeM = shared.scaleDroneRangeM(areaM2);
    // Respawn-variant lives (Domination/CTF/Seek&Destroy/Deathmatch) —
    // meaningless under 'freeze' but harmless to set either way, same
    // "always compute, only some modes read it" convention as livesPerPlayer
    // in DEFAULTS/deathmatch already used before onHit was generalized.
    cfg.livesPerPlayer = auto.livesPerPlayer;
  }
  for (const k of Object.keys(DEFAULTS)) {
    if (typeof ar[k] === 'number') cfg[k] = ar[k];
  }
  cfg.autoScale = autoScale;
  cfg.foundMode = ['seeker', 'freeze'].includes(ar.foundMode) ? ar.foundMode : 'spectator';
  cfg.debugMode = ar.debugMode === true;
  cfg.simulation = ar.simulation === true;
  // Hide & Seek variant: 'classic' (default, seeker/hider roles), 'ffa'
  // ("Jeder gegen jeden" — no teams/roles, permanent elimination) or
  // 'the_ship' (secret assassin-chain — no roles). All three are variants,
  // not separate modes — same subMode either way, see MODES.hide_and_seek.
  cfg.hsVariant = ['ffa', 'the_ship'].includes(ar.hsVariant) ? ar.hsVariant : 'classic';
  // On-hit consequence for all 4 combat modes (Domination, CTF,
  // Seek&Destroy, Deathmatch) — see resolveCombatHit. Default preserves each
  // mode's original, pre-toggle behavior so existing matches/tests aren't
  // silently changed by adding the option: Deathmatch always defaulted to
  // 'respawn' (its identity), the other three always unconditionally froze
  // on hit, so 'freeze' stays their default unless the host opts into
  // 'respawn' instead.
  const defaultOnHit = subMode === 'deathmatch' ? 'respawn' : 'freeze';
  cfg.onHit = ['freeze', 'respawn'].includes(ar.onHit) ? ar.onHit : defaultOnHit;
  // Zerstören: 'instant' (either team captures the active target, default)
  // vs 'defuse' (attacker-arms/defender-defuses, mirrors the old
  // single-bomb-site mechanic but generalized to a rotating target list).
  cfg.destroyVariant = ar.destroyVariant === 'defuse' ? 'defuse' : 'instant';
  cfg.destroyReactivate = ar.destroyReactivate === true;
  // Team/FFA variant for the 4 team-capable modes (domination, ctf,
  // seek_destroy, deathmatch) — 'team' (default, unchanged behavior) or
  // 'ffa' ("Jeder gegen jeden", every player for themselves). Only
  // meaningful when mode.usesTeams; hide_and_seek has its own hsVariant
  // instead (it's never team-based to begin with). Zerstören's 'defuse'
  // sub-variant is inherently two-sided (attacker arms / defender defuses)
  // and has no ffa reading — the lobby UI hides that picker in ffa, but
  // guard here too in case a stale ar_settings still has it set.
  cfg.teamVariant = (mode.usesTeams && ar.teamVariant === 'ffa') ? 'ffa' : 'team';
  if (cfg.teamVariant === 'ffa' && subMode === 'seek_destroy') cfg.destroyVariant = 'instant';

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

  // Zones (domination points / bomb sites / Zerstören targets) — host-placed
  // via ar.zones, or generated via ar.randomZoneCount (e.g. a repeated tap
  // on the mode in the lobby increasing the requested count, see the
  // AR-Ops modes plan) using the shared generateRandomZones helper. Random
  // only kicks in when the host placed no zones by hand.
  let zones = (Array.isArray(ar.zones) ? ar.zones : [])
    .filter(z => z && Number.isFinite(z.lat) && Number.isFinite(z.lon))
    .slice(0, 8)
    .map((z, i) => ({ id: 'z' + (i + 1), lat: +z.lat, lon: +z.lon, radiusM: timings.zoneRadiusM }));
  if (zones.length === 0 && Number.isFinite(ar.randomZoneCount) && ar.randomZoneCount > 0) {
    zones = shared.generateRandomZones(
      polygon, Math.min(8, Math.round(ar.randomZoneCount)), timings.zoneRadiusM * 3, timings.zoneRadiusM
    );
  }
  if (subMode === 'domination' || subMode === 'seek_destroy') {
    const minZones = subMode === 'domination' ? 2 : 1;
    if (zones.length < minZones) throw new Error('need_zones');
    const zCheck = shared.validateZones(zones, polygon);
    if (!zCheck.ok) throw new Error('invalid_zones: ' + zCheck.errors.join(','));
  }

  const roles = ar.roles || {};
  const teamOverride = ar.teams || {};
  // Player classes (Scout/Sniper/Bomber) — additive to role/team, not a
  // replacement. See packages/arops-shared/src/profiles.ts's
  // PLAYER_TYPE_PROFILES for the combat-stat rationale behind each class.
  // Defaults to 'scout' when unset — MUST match effectiveArSettings'
  // (server/src/socket/platform.js) own default, or the lobby preview and
  // the actual match would disagree on what a player's class is.
  const classOverride = ar.classes || {};
  const playerState = {};
  const captains = { a: null, b: null };
  let seekerCount = 0;
  players.forEach((p, idx) => {
    const role = roles[p.userId] || (idx === 0 ? 'seeker' : 'hider');
    if (role === 'seeker') seekerCount++;
    // Teams: explicit override or alternating assignment — ffa players get
    // no team at all (null), same as hide_and_seek's ffa/the_ship variants.
    const team = (mode.usesTeams && cfg.teamVariant !== 'ffa')
      ? (teamOverride[p.userId] === 'a' || teamOverride[p.userId] === 'b'
          ? teamOverride[p.userId] : (idx % 2 === 0 ? 'a' : 'b'))
      : null;
    if (team && !captains[team]) captains[team] = p.userId;
    const playerClass = ['scout', 'sniper', 'bomber'].includes(classOverride[p.userId])
      ? classOverride[p.userId] : 'scout';
    playerState[p.userId] = {
      userId: p.userId, username: p.username, avatar_color: p.avatar_color,
      role, team, class: playerClass, isBot: !!p.isBot,
      status: 'alive',
      foundBy: null, foundAt: null,
      score: 0,
      buffer: [], lastAccepted: null,
      strikes: 0, suspicious: false,
      geofence: 'inside', outsideSince: null, exposed: false, exposedAt: null,
      lastHitAttemptAt: 0,
      perks: {
        radarLastUsed: 0, droneLastUsed: 0, cloakLastUsed: 0, fakeMarkerLastUsed: 0,
        aufscheuchenLastUsed: 0, revealTrapLastUsed: 0,
      },
      proximityAlert: false,
      cloakUntil: 0, fakeMarkers: null, fakeMarkerUntil: 0, fakeProximityUntil: 0,
      frozenUntil: 0, freezeAnchor: null, freezeViolations: 0,
      trap: null, trapAlert: null, // Scout's Reveal-Trap perk state
      spawnDwellMs: 0, // Base/respawn checkpoint (CTF, Deathmatch)
      lastPingAt: 0, // team ping cooldown (map tap)
      heldItem: null, // { perkId, pickedUpAt } — a dropped class-perk item, see gs.items
    };
  });
  // Every normal (classic) Hide & Seek match needs at least one seeker —
  // but a solo debug session (host testing the hider view alone) should be
  // able to explicitly opt out, and the 'ffa'/'the_ship' variants have no
  // seeker/hider role concept at all (role is simply unused there).
  if (subMode === 'hide_and_seek' && cfg.hsVariant === 'classic' && seekerCount === 0 && !cfg.debugMode) {
    const first = Object.values(playerState)[0];
    if (first) first.role = 'seeker';
  }

  const gs = {
    sessionId, mode: 'ar_ops', subMode,
    polygon, cfg, hitConfig, timings, zones, captains,
    comicMap: ar.comicMap && Array.isArray(ar.comicMap.features) ? ar.comicMap : null,
    hitTrackingMode: ar.hitTrackingMode === 'ir' ? 'ir' : 'compass',
    // Host-assigned mapping of userId -> the numeric ID (0-255) their
    // physical ESP32 IR beacon broadcasts (see hardware/esp32-ir). Only
    // consulted when hitTrackingMode === 'ir' — see actionArHitAttempt,
    // which requires the shooter's client to have actually camera-decoded
    // the claimed target's assigned ID recently before a hit counts, in
    // addition to (not instead of) the existing GPS/compass cone check.
    irIds: (ar.irIds && typeof ar.irIds === 'object') ? { ...ar.irIds } : {},
    players: playerState,
    phase: mode.initialPhase(cfg),
    phaseStartTime: now(),
    gameOver: false, _gameOverWin: false, winner: null,
    events: [], _eventSeq: 0,
    // A final kill drops the victim's class perk as a one-time pickup —
    // mode-agnostic like events/modeState, not tucked into modeState since
    // every mode (not just the current one's own state shape) can produce
    // one. See dropEliminatedPerkItem/tickArops's pickup loop.
    items: [], _itemSeq: 0,
    modeState: {},
    // Team ping (map tap): mode-agnostic, like events/modeState above — any
    // team mode gets this for free. Per-team so a viewer only ever reads
    // their OWN team's array in the snapshot (see getAropsSnapshot's
    // me.teamPings) — never the opponent's, unlike gs.events which is the
    // same broadcast list for everyone.
    teamPings: { a: [], b: [] },
    _lastModeTick: now(),
    _hasBots: Object.values(playerState).some(p => p.isBot),
    _lastBotStep: 0,
    _simSnippet: cfg.simulation ? shared.SIM_SCENARIOS.find(s => s.key === ar.simSnippetKey) || null : null,
    _simOrigin: cfg.simulation ? fieldCentroid(polygon) : null,
    _simStartAt: now(),
    _simTesterId: cfg.simulation ? (players.find(p => !p.isBot)?.userId || null) : null,
    _simShotsDone: new Set(),
    _lastSimBotStep: 0,
  };
  if (mode.initState) mode.initState(gs);
  // Simulation scenarios are only ever 1-10s long in total — the normal
  // real-match warmup/base_setup prep phase (tens of seconds, see each
  // mode's initialPhase/phaseDurationMs) would completely dominate that
  // budget for no benefit (nobody needs prep time against a scripted bot).
  // Skip straight to 'live' using the same transition functions a real
  // match reaches on its own once the timer elapses — both already
  // tolerate running before any player telemetry exists (bases fall back
  // to the field centroid). Never applies outside cfg.simulation.
  if (cfg.simulation) {
    if (gs.phase === 'warmup') transitionFromWarmup(gs, now());
    else if (gs.phase === 'base_setup') transitionFromBaseSetup(gs, now());
  }
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
//  PLAYER CLASSES (Scout/Sniper/Bomber — additive to role/team)
// ═══════════════════════════════════════════════════════════
// Derives the effective per-shooter hit-test shape from the match-wide
// gs.hitConfig + the shooter's class. No class (null) = gs.hitConfig
// unchanged, cone model — today's exact behavior. Single source of truth
// for both actionArHitAttempt (actual validation) and getAropsSnapshot
// (what the client displays), so the two can never drift apart.
//
// Sniper's lateral tolerance is derived from hitConfig.baseConeHalfAngleDeg
// via the inverse of the auto-scale conversion used when building hitConfig
// (see createAropsGame: baseConeHalfAngleDeg = atan(hitHalfWidthM/10) * 180/PI)
// rather than a separate stored value — this way it automatically follows
// ANY change to baseConeHalfAngleDeg (auto-scaled or host-manual override),
// not just the auto-scaled path.
function effectiveHitInfo(hitConfig, playerClass) {
  if (playerClass === 'sniper') {
    const lateralToleranceM = Math.tan(hitConfig.baseConeHalfAngleDeg * Math.PI / 180) * 10;
    return { hitShape: 'lateral', hitRangeM: hitConfig.maxRangeM * 2, lateralToleranceM };
  }
  if (playerClass === 'bomber') {
    return { hitShape: 'omni', hitRangeM: hitConfig.maxRangeM * 0.25 };
  }
  if (playerClass === 'scout') {
    // "Shotgun" wide corridor — 3x the baseline cone half-angle, capped at
    // maxToleranceDeg (the same ceiling every shooter's effective tolerance
    // is already capped at, see hitToleranceDeg in packages/arops-shared/
    // src/hit.ts — widening past that ceiling would have no further effect).
    const wideConeHalfAngleDeg = Math.min(hitConfig.maxToleranceDeg, hitConfig.baseConeHalfAngleDeg * 3);
    return { hitShape: 'cone', hitRangeM: hitConfig.maxRangeM, hitConeHalfAngleDeg: wideConeHalfAngleDeg };
  }
  return { hitShape: 'cone', hitRangeM: hitConfig.maxRangeM, hitConeHalfAngleDeg: hitConfig.baseConeHalfAngleDeg };
}

function validateHitForShooter(shooter, attempt, hitConfig) {
  const info = effectiveHitInfo(hitConfig, shooter.class);
  const cfg = { ...hitConfig, maxRangeM: info.hitRangeM };
  if (info.hitShape === 'lateral') return shared.validateHitLateral(attempt, cfg, info.lateralToleranceM);
  if (info.hitShape === 'omni') return shared.validateHitOmni(attempt, cfg);
  cfg.baseConeHalfAngleDeg = info.hitConeHalfAngleDeg; // default or Scout's widened cone
  return shared.validateHit(attempt, cfg);
}

// ═══════════════════════════════════════════════════════════
//  HIT ATTEMPT (core; mode decides gating + consequence)
// ═══════════════════════════════════════════════════════════
// A beacon broadcast cycle is ~2.1s (see hardware/esp32-ir firmware) — this
// just needs to comfortably cover "decoded a moment before/during the shot",
// not exactly one cycle.
const IR_SCAN_MAX_AGE_MS = 4000;
const pickTargetSample = shared.pickTargetSample;

function actionArHitAttempt(gs, userId, data) {
  const mode = MODES[gs.subMode];
  const shooter = gs.players[userId];
  if (!shooter) return { ok: false, err: 'not_in_game' };
  if (gs.gameOver) return { ok: false, err: 'game_over' };
  if (shooter.status === 'downed') return { ok: false, err: 'downed' };
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
  // Bomber's whole design premise is "no aiming needed" (360° omnidirectional
  // hit-test, see effectiveHitInfo) — requiring a working compass would
  // contradict that, so this universal gate is the one place classes make an
  // exception to an otherwise shooter-agnostic check.
  if (shooter.class !== 'bomber' && (trigger.headingDeg === null || trigger.headingDeg === undefined)) {
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
    const verdict = validateHitForShooter(shooter, {
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
    // Note: for a lateral-shape shooter (Sniper), angleDeltaDeg/toleranceDeg
    // below actually carry METERS, not degrees (see validateHitLateral) — the
    // near-miss diagnostic math still works numerically (same unit compared
    // to itself), but the field NAMES are misleading for that shooter until
    // the client-side near-miss display is updated to be shape-aware
    // (planned for the mobile UI phase, not yet part of this change).
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

  // IR mode: the GPS/compass cone check above still has to pass (never
  // relaxed), but additionally requires the shooter's phone to have
  // camera-decoded the claimed target's assigned beacon ID recently — real
  // physical confirmation they were looking at that specific player, not
  // just that the angle math picked them as the closest candidate. See
  // hardware/esp32-ir and useIrScan.ts on the client for where the scan
  // comes from; never trust it without the cone check still having passed.
  if (gs.hitTrackingMode === 'ir') {
    const scan = data?.irScan;
    const expectedId = gs.irIds[bestTarget.userId];
    // Compared against the shot's own trigger.ts (the phone's clock), not
    // the server's `t` — both timestamps come from the same client, so this
    // avoids introducing a server/phone clock-skew dependency the rest of
    // the freshness checks in this function don't have either.
    const scanValid = scan
      && Number.isFinite(scan.deviceId)
      && Number.isFinite(scan.ts)
      && expectedId !== undefined
      && scan.deviceId === expectedId
      && (trigger.ts - scan.ts) <= IR_SCAN_MAX_AGE_MS
      && scan.ts <= trigger.ts;
    if (!scanValid) {
      return { ok: true, hit: false, reason: 'ir_not_confirmed' };
    }
  }

  mode.applyHit(gs, shooter, bestTarget, bestVerdict, t);

  return {
    ok: true, hit: true, targetId: bestTarget.userId,
    confidence: bestVerdict.confidence,
    distanceM: bestVerdict.distanceM,
  };
}

// ═══════════════════════════════════════════════════════════
//  CTF/Deathmatch: base placement during base_setup — captain sets the
//  team base (team mode), or every player sets their own (ffa variant)
// ═══════════════════════════════════════════════════════════
function actionArSetBase(gs, userId, data) {
  // Generic capability check (gs.modeState.bases) instead of a hardcoded
  // mode name — CTF and Deathmatch both use the same base_setup/bases
  // shape; any future base-having mode gets this for free.
  if (!gs.modeState.bases) return { ok: false, err: 'wrong_mode' };
  if (gs.phase !== 'base_setup') return { ok: false, err: 'wrong_phase' };
  const p = gs.players[userId];
  if (!p) return { ok: false, err: 'not_in_game' };
  const ffa = gs.cfg.teamVariant === 'ffa';
  if (!ffa && gs.captains[p.team] !== userId) return { ok: false, err: 'not_captain' };
  const key = baseKeyOf(p);

  // Position: explicit map tap or current position
  let pos = null;
  if (data && Number.isFinite(data.lat) && Number.isFinite(data.lon)) {
    pos = { lat: +data.lat, lon: +data.lon };
  } else if (p.lastAccepted) {
    pos = { lat: p.lastAccepted.lat, lon: p.lastAccepted.lon };
  }
  if (!pos) return { ok: false, err: 'no_position' };
  if (!shared.pointInPolygon(pos, gs.polygon)) return { ok: false, err: 'outside_field' };

  // Team mode: one other base to stay clear of. Ffa: every other player's
  // already-placed base.
  const others = ffa
    ? Object.entries(gs.modeState.bases).filter(([k, v]) => k !== key && v).map(([, v]) => v)
    : [gs.modeState.bases[p.team === 'a' ? 'b' : 'a']].filter(Boolean);
  for (const other of others) {
    if (shared.haversineMeters(pos, other) < gs.timings.minBaseSeparationM) {
      return { ok: false, err: 'bases_too_close', minSeparationM: Math.round(gs.timings.minBaseSeparationM) };
    }
  }
  gs.modeState.bases[key] = pos;
  pushEvent(gs, 'base_set', ffa ? { userId, auto: false } : { team: p.team, auto: false });
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
  if (p.status === 'downed') return { ok: false, err: 'downed' };
  if (!mode.shootPhases.includes(gs.phase)) return { ok: false, err: 'wrong_phase' };
  const t = now();
  const perk = data?.perk;

  // Team ping (map tap in-game): drops a short-lived marker visible only to
  // the pinger's own team — never to opponents, and no-op for teamless
  // modes (no teammates to ping). Delivery is per-viewer (gs.teamPings[team]
  // filtered in getAropsSnapshot by the VIEWER's own team), not the shared
  // gs.events broadcast list every player already receives — that list
  // never carries positions, and pings must not be the first thing that does.
  if (perk === 'ping') {
    if (!p.team) return { ok: false, err: 'no_team' };
    const lat = data?.lat, lon = data?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { ok: false, err: 'bad_location' };
    const cd = cooldownError(p, 'lastPingAt', gs.cfg.pingCooldownMs, t);
    if (cd) return cd;
    p.lastPingAt = t;
    const pings = gs.teamPings[p.team];
    pings.push({ lat, lon, byUserId: userId, ts: t, expiresAt: t + gs.cfg.pingDurationMs });
    if (pings.length > 5) pings.splice(0, pings.length - 5);
    return { ok: true };
  }

  if (perk === 'radar') {
    const cd = cooldownError(p.perks, 'radarLastUsed', gs.cfg.radarCooldownMs, t);
    if (cd) return cd;
    p.perks.radarLastUsed = t;
    const opponents = Object.values(gs.players).filter(c =>
      c.userId !== userId && c.status === 'alive' && opponentOf(gs, p, c) && c.lastAccepted && !isCloaked(c, t)
    );
    // Reported "radar zeigt keine Spieler" — no obvious bug in this filter
    // itself on review, but c.lastAccepted specifically requires the OTHER
    // player's telemetry to have been recently accepted by the server, so
    // this can legitimately return empty if their GPS hasn't produced a fix
    // yet (a separate, already-known issue this session). Logged so a
    // recurrence shows exactly why — e.g. all-alive-but-zero-lastAccepted
    // points at the telemetry side, not this perk.
    if (opponents.length === 0) {
      const allOthers = Object.values(gs.players).filter(c => c.userId !== userId);
      console.warn(`[radar] no contacts userId=${userId} sessionId=${gs.sessionId} ` +
        `others=${allOthers.length} alive=${allOthers.filter(c => c.status === 'alive').length} ` +
        `withFix=${allOthers.filter(c => c.lastAccepted).length}`);
    }
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
  // fake_marker/cloak get an ADDITIONAL access path here: the Sniper/Bomber
  // classes reuse them cross-mode (see PLAYER_TYPE_PROFILES in
  // packages/arops-shared/src/profiles.ts), on top of — not instead of —
  // the Hider-in-hide_and_seek role path checked below. Drone/Aufscheuchen
  // stay role/mode-exclusive; no class reuses them.
  const classOverridesModeGate =
    (perk === 'fake_marker' && p.class === 'sniper') ||
    (perk === 'cloak' && p.class === 'bomber');
  if (['drone', 'cloak', 'fake_marker', 'aufscheuchen'].includes(perk)
      && gs.subMode !== 'hide_and_seek' && !classOverridesModeGate) {
    return { ok: false, err: 'wrong_mode' };
  }

  if (perk === 'drone') {
    if (p.role !== 'hider') return { ok: false, err: 'perk_wrong_role' };
    const cd = cooldownError(p.perks, 'droneLastUsed', gs.cfg.droneCooldownMs, t);
    if (cd) return cd;
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
    if (p.role !== 'hider' && p.class !== 'bomber') return { ok: false, err: 'perk_wrong_role' };
    const cd = cooldownError(p.perks, 'cloakLastUsed', gs.cfg.cloakCooldownMs, t);
    if (cd) return cd;
    p.perks.cloakLastUsed = t;
    p.cloakUntil = t + gs.cfg.cloakDurationMs;
    pushEvent(gs, 'cloak_used', { userId });
    return { ok: true };
  }

  if (perk === 'fake_marker') {
    if (p.role !== 'hider' && p.class !== 'sniper') return { ok: false, err: 'perk_wrong_role' };
    const cd = cooldownError(p.perks, 'fakeMarkerLastUsed', gs.cfg.fakeMarkerCooldownMs, t);
    if (cd) return cd;
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
    const cd = cooldownError(p.perks, 'aufscheuchenLastUsed', gs.cfg.aufscheuchenCooldownMs, t);
    if (cd) return cd;
    p.perks.aufscheuchenLastUsed = t;
    for (const h of Object.values(gs.players)) {
      if (h.role === 'hider' && h.status === 'alive') h.fakeProximityUntil = t + gs.cfg.aufscheuchenDurationMs;
    }
    pushEvent(gs, 'aufscheuchen_used', { userId });
    return { ok: true };
  }

  // Scout class perk, any mode — placed at the player's current position,
  // triggers passively (see tickArops) rather than as an immediate-effect
  // action like the perks above: an opponent has to actually walk into
  // range before anything is revealed.
  if (perk === 'reveal_trap') {
    if (p.class !== 'scout') return { ok: false, err: 'perk_wrong_role' };
    const cd = cooldownError(p.perks, 'revealTrapLastUsed', gs.cfg.revealTrapCooldownMs, t);
    if (cd) return cd;
    if (!p.lastAccepted) return { ok: false, err: 'no_position' };
    p.perks.revealTrapLastUsed = t;
    p.trap = {
      lat: p.lastAccepted.lat, lon: p.lastAccepted.lon,
      armedUntil: t + gs.cfg.revealTrapDurationMs,
    };
    pushEvent(gs, 'reveal_trap_placed', { userId });
    return { ok: true };
  }

  return { ok: false, err: 'unknown_perk' };
}

/**
 * Use a picked-up dropped-perk item (see gs.items / tickArops's pickup
 * loop / dropEliminatedPerkItem) — deliberately NOT actionArUsePerk: no
 * cooldown check, no role/class gate (the item itself, not the player's
 * own class, is what earns the effect here), one-shot consumption instead
 * of a cooldown timer — never touches gs.players[x].perks.*LastUsed, so it
 * can never affect (or be affected by) the player's own perk cooldowns.
 * Mirrors the exact same effect application as the matching branch in
 * actionArUsePerk (cloak/fake_marker/reveal_trap are the only 3 possible
 * drops — one perk per class, see PLAYER_TYPE_PROFILES.uniquePerks) so a
 * picked-up item behaves identically to the class's own use of it.
 */
function actionArUseItem(gs, userId) {
  const mode = MODES[gs.subMode];
  const p = gs.players[userId];
  if (!p) return { ok: false, err: 'not_in_game' };
  if (gs.gameOver) return { ok: false, err: 'game_over' };
  if (p.status === 'downed') return { ok: false, err: 'downed' };
  if (!mode.shootPhases.includes(gs.phase)) return { ok: false, err: 'wrong_phase' };
  if (!p.heldItem) return { ok: false, err: 'no_item' };
  const t = now();
  const perkId = p.heldItem.perkId;

  if (perkId === 'cloak') {
    p.heldItem = null;
    p.cloakUntil = t + gs.cfg.cloakDurationMs;
    pushEvent(gs, 'item_used', { userId, perkId });
    return { ok: true };
  }
  if (perkId === 'fake_marker') {
    p.heldItem = null;
    const fallback = p.lastAccepted ? { lat: p.lastAccepted.lat, lon: p.lastAccepted.lon } : null;
    p.fakeMarkers = [randomPointInPolygon(gs.polygon) || fallback, randomPointInPolygon(gs.polygon) || fallback]
      .filter(Boolean);
    p.fakeMarkerUntil = t + gs.cfg.fakeMarkerDurationMs;
    pushEvent(gs, 'item_used', { userId, perkId });
    return { ok: true };
  }
  if (perkId === 'reveal_trap') {
    if (!p.lastAccepted) return { ok: false, err: 'no_position' };
    p.heldItem = null;
    p.trap = { lat: p.lastAccepted.lat, lon: p.lastAccepted.lon, armedUntil: t + gs.cfg.revealTrapDurationMs };
    pushEvent(gs, 'item_used', { userId, perkId });
    return { ok: true };
  }
  return { ok: false, err: 'unknown_item' };
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
//  MATCH-SIMULATION BOT DRIVER (replaces tickBots when gs.cfg.simulation —
//  see applySimOverrides above and packages/arops-shared/src/simScript.ts).
//  Bots walk their scripted route at the same brisk-walk pace tickBots
//  already uses (gradual steps, not a teleport — a big instant jump would
//  trip the same anti-spoof plausibility check a real client is subject
//  to), and fire their own scripted shots (tester-fired shots are driven by
//  the mobile Match-Simulation screen itself, not here).
// ═══════════════════════════════════════════════════════════
const SIM_BOT_STEP_MS = 1200;
const SIM_BOT_SPEED_MPS = 1.3;

function activeSimWaypoint(route, elapsedMs) {
  let active = route[0];
  for (const w of route) {
    if (w.tMs <= elapsedMs) active = w; else break;
  }
  return active;
}

function tickSimBots(gs, t) {
  const snippet = gs._simSnippet;
  if (!snippet) return;
  if (gs._lastSimBotStep && t - gs._lastSimBotStep < SIM_BOT_STEP_MS) return;
  gs._lastSimBotStep = t;
  const elapsed = t - gs._simStartAt;
  const stepM = (SIM_BOT_STEP_MS / 1000) * SIM_BOT_SPEED_MPS;

  for (const botScript of snippet.bots) {
    const p = gs.players[botScript.id];
    if (!p || p.status !== 'alive') continue;
    const wp = activeSimWaypoint(botScript.route, elapsed);
    const dest = shared.destinationPoint(gs._simOrigin, wp.bearingDeg, wp.distanceM);
    if (!p.lastAccepted) {
      actionArTelemetry(gs, p.userId, {
        sample: { lat: dest.lat, lon: dest.lon, ts: t, accuracyM: 3, headingDeg: 0 },
      });
      continue;
    }
    const distToDest = shared.haversineMeters(p.lastAccepted, dest);
    const headingDeg = shared.bearingDeg(p.lastAccepted, dest);
    const next = distToDest <= stepM ? dest : shared.destinationPoint(p.lastAccepted, headingDeg, stepM);
    actionArTelemetry(gs, p.userId, {
      sample: { lat: next.lat, lon: next.lon, ts: t, accuracyM: 3, headingDeg },
    });
  }

  for (let i = 0; i < snippet.shoots.length; i++) {
    const beat = snippet.shoots[i];
    if (beat.shooterId === 'tester' || elapsed < beat.tMs || gs._simShotsDone.has(i)) continue;
    gs._simShotsDone.add(i);
    const shooterId = beat.shooterId;
    const targetId = beat.targetId === 'tester' ? gs._simTesterId : beat.targetId;
    const shooter = gs.players[shooterId];
    const target = gs.players[targetId];
    if (!shooter || !target || !shooter.lastAccepted || !target.lastAccepted) continue;
    const headingDeg = shared.bearingDeg(shooter.lastAccepted, target.lastAccepted);
    actionArHitAttempt(gs, shooterId, {
      sample: { lat: shooter.lastAccepted.lat, lon: shooter.lastAccepted.lon, ts: t, accuracyM: 3, headingDeg },
      targetId,
    });
  }
}

// ═══════════════════════════════════════════════════════════
//  TICK (core: geofence exposure + proximity, then mode logic)
// ═══════════════════════════════════════════════════════════
// Elimination-based win check for the respawn variant (onHit==='respawn')
// — Domination/CTF/Seek&Destroy have no checkWin at all (only Deathmatch
// and Hide&Seek do, see MODES.deathmatch.checkWin/MODES.hide_and_seek.
// checkWin), so if every player on one side reached 0 lives (permanently
// 'found') before the mode's own objective/time-limit ending happened to
// fire, the match previously just continued indefinitely with a side that
// had no active players left — reported live: a Seek&Destroy match with
// destroyReactivate off appeared to "hang" near the end. Deathmatch is
// deliberately excluded here — it already has its own tested checkWin for
// exactly this, a second parallel path would be redundant.
function checkEliminationWin(gs) {
  if (gs.gameOver || gs.cfg.onHit !== 'respawn') return;
  if (!['domination', 'ctf', 'seek_destroy'].includes(gs.subMode)) return;
  if (Object.keys(gs.players).length < 2) return; // solo debug session — no opponent to eliminate
  if (gs.cfg.teamVariant === 'ffa') {
    const alive = Object.values(gs.players).filter(p => p.status !== 'found');
    if (alive.length <= 1) endGame(gs, alive.length === 1 ? 'player_' + alive[0].userId : 'draw');
    return;
  }
  const teamAPlayers = Object.values(gs.players).filter(p => p.team === 'a');
  const teamBPlayers = Object.values(gs.players).filter(p => p.team === 'b');
  if (!teamAPlayers.length || !teamBPlayers.length) return; // no real opponent side (e.g. solo debug)
  const aAlive = teamAPlayers.some(p => p.status !== 'found');
  const bAlive = teamBPlayers.some(p => p.status !== 'found');
  if (aAlive && bAlive) return;
  if (!aAlive && !bAlive) endGame(gs, 'draw');
  else endGame(gs, aAlive ? 'team_a' : 'team_b');
}

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

  // Base/respawn checkpoint (no-op for modes without gs.modeState.bases)
  tickSpawnRespawn(gs, t, dtMs);

  mode.tick(gs, t, dtMs);
  if (gs.gameOver) return;

  checkEliminationWin(gs);
  if (gs.gameOver) return;

  if (gs.cfg.simulation) tickSimBots(gs, t); else tickBots(gs, t);

  // Proximity warner (active shoot phases only) — the real always-on
  // distance check only ever fires in debug sessions now (diagnostic value
  // only, see the debug bar in GameScreen.tsx); a passive "opponent nearby"
  // signal with no cooldown and no player action behind it turned out to be
  // a genuine, undodgeable position leak in every normal match ("Gegner in
  // der Nähe" fired for every player regardless of any perk use). The one
  // legitimate always-on source stays: Aufscheuchen's fake trigger IS the
  // perk's entire purpose (spook a hider into thinking a seeker is close),
  // so it keeps firing regardless of debugMode.
  for (const p of Object.values(gs.players)) {
    p.proximityAlert = false;
    if (gs.cfg.debugMode && p.status === 'alive' && p.lastAccepted && mode.shootPhases.includes(gs.phase)) {
      for (const o of Object.values(gs.players)) {
        if (o.userId === p.userId || o.status !== 'alive' || !opponentOf(gs, p, o) || !o.lastAccepted) continue;
        if (isCloaked(o, t)) continue; // Cloak defeats detection sensors, not point-blank hits
        if (shared.haversineMeters(p.lastAccepted, o.lastAccepted) <= gs.cfg.proximityRangeM) {
          p.proximityAlert = true;
          break;
        }
      }
    }
    // Aufscheuchen: seeker-faked alert, indistinguishable from a real one —
    // always active, independent of debugMode (see comment above).
    if (t < (p.fakeProximityUntil || 0)) p.proximityAlert = true;
  }

  // Reveal-Trap (Scout, any mode) — passive trigger check. An armed trap
  // reveals the first opponent to come within range to its owner, then is
  // consumed (one-shot; re-placing costs the cooldown again). Mode-agnostic,
  // same as radar/proximity, so it lives in the core tick, not a mode.tick.
  for (const p of Object.values(gs.players)) {
    if (p.trapAlert && t >= p.trapAlert.expiresAt) p.trapAlert = null;
    if (!p.trap) continue;
    if (t >= p.trap.armedUntil) { p.trap = null; continue; }
    for (const o of Object.values(gs.players)) {
      if (o.userId === p.userId || o.status !== 'alive' || !opponentOf(gs, p, o) || !o.lastAccepted) continue;
      if (isCloaked(o, t)) continue; // Cloak defeats detection sensors, not point-blank hits
      if (shared.haversineMeters(p.trap, o.lastAccepted) <= gs.timings.revealTrapRadiusM) {
        p.trapAlert = {
          lat: o.lastAccepted.lat, lon: o.lastAccepted.lon,
          triggeredAt: t, expiresAt: t + gs.cfg.revealTrapRevealMs,
        };
        p.trap = null;
        pushEvent(gs, 'reveal_trap_triggered', { userId: p.userId, byUserId: o.userId });
        break;
      }
    }
  }

  // Dropped-item pickup — instant on presence, same convention as CTF's
  // dropped-flag pickup (no dwell). Any alive player without an item
  // already in their slot picks up the first item they're close enough to;
  // capacity is exactly 1, so a player already holding one walks past
  // untouched items until they use or (match end) lose their current one.
  if (gs.items.length) {
    for (const p of Object.values(gs.players)) {
      if (p.status !== 'alive' || p.heldItem || !p.lastAccepted) continue;
      const idx = gs.items.findIndex(it => shared.haversineMeters(p.lastAccepted, it) <= ITEM_PICKUP_RADIUS_M);
      if (idx === -1) continue;
      const item = gs.items[idx];
      gs.items.splice(idx, 1);
      p.heldItem = { perkId: item.perkId, pickedUpAt: t };
      pushEvent(gs, 'item_picked_up', { userId: p.userId, perkId: item.perkId });
    }
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
      role: p.role, team: p.team, class: p.class, status: p.status, foundBy: p.foundBy, score: p.score,
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
    // These two stay match-wide/unclassed for backward compat with the
    // current mobile UI (which doesn't yet render per-class aim overlays,
    // see the mobile UI phase of the AR-Ops modes plan) — the viewer's OWN
    // effective values (which may differ if they have a class) are in
    // `me` below instead; validation itself (actionArHitAttempt) is always
    // authoritative regardless of what any client renders.
    hitRangeM: gs.hitConfig.maxRangeM,
    hitConeHalfAngleDeg: gs.hitConfig.baseConeHalfAngleDeg,
    winner: gs.winner,
    debugMode: !!gs.cfg.debugMode,
    autoScale: !!gs.cfg.autoScale,
    // 'team' (default) or 'ffa' — only meaningful for the 4 team-capable
    // modes, but harmless to always include (hide_and_seek always 'team'
    // here, it has its own hsVariant instead). Lets clients tell apart e.g.
    // domination's teamScore vs. playerScore without guessing from which
    // fields happen to be present.
    teamVariant: gs.cfg.teamVariant,
    timings: {
      freezeMs: gs.timings.freezeMs,
      captureDwellMs: gs.timings.captureDwellMs,
      flagPickupDwellMs: gs.timings.flagPickupDwellMs,
      plantDwellMs: gs.timings.plantDwellMs,
      defuseDwellMs: gs.timings.defuseDwellMs,
      zoneRadiusM: gs.timings.zoneRadiusM,
      radarDurationMs: gs.cfg.radarDurationMs,
    },
    me: me ? {
      role: me.role, team: me.team, class: me.class, status: me.status, score: me.score,
      // Ffa base-having modes (CTF/Deathmatch): every player places their
      // own base, so every player "is captain" for this purpose — gated on
      // gs.modeState.bases existing at all so ffa Domination/Zerstören
      // (no bases) correctly stay false.
      isCaptain: gs.cfg.teamVariant === 'ffa' ? !!gs.modeState.bases : (me.team ? gs.captains[me.team] === userId : false),
      geofence: me.geofence, exposed: me.exposed,
      strikes: me.strikes,
      proximityAlert: me.proximityAlert,
      frozenRemainingMs: Math.max(0, (me.frozenUntil || 0) - t),
      freezeViolations: me.freezeViolations,
      // Own effective hit-test shape (differs from the top-level match-wide
      // hitRangeM/hitConeHalfAngleDeg above if this player has a class —
      // see effectiveHitInfo, the single source of truth shared with
      // actionArHitAttempt's actual validation).
      ...effectiveHitInfo(gs.hitConfig, me.class),
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
      revealTrapCooldownRemainingMs: Math.max(0,
        gs.cfg.revealTrapCooldownMs - (t - me.perks.revealTrapLastUsed)),
      trapArmed: !!me.trap,
      // Only ever populated for the trap's own owner — never leaks who
      // triggered someone else's trap to anyone but that trap's owner.
      trapAlert: me.trapAlert ? { ...me.trapAlert } : null,
      // A picked-up dropped-item — perkId only (no cooldown/timer state,
      // it's one-shot). See actionArUseItem/tickArops's pickup loop.
      heldItem: me.heldItem ? { perkId: me.heldItem.perkId } : null,
      // Base/respawn checkpoint (CTF, Deathmatch) — lets the client
      // highlight the player's own base prominently when they need to
      // reach it, per the AR-Ops modes plan (mobile UI, later phase).
      needsSpawn: me.status === 'downed',
      ownBase: me.team && gs.modeState.bases ? gs.modeState.bases[me.team] || null : null,
      // The Ship: identity of the player's assigned target — NEVER their
      // position (that's the whole point of the mode). The client resolves
      // the username via the public roster, which itself only ever carries
      // a position when independently revealed (never true here, since
      // isOpponentPair is always true for this mode).
      targetUserId: gs.modeState.targets ? (gs.modeState.targets[userId] || null) : null,
      // Team ping (map tap): only the viewer's OWN team's recent pings,
      // expired ones filtered out — never the opponent team's array, and
      // empty for teamless modes (me.team is null there).
      teamPings: me.team
        ? (gs.teamPings[me.team] || []).filter(pg => t < pg.expiresAt)
        : [],
    } : null,
    players: roster,
    // Dropped perk-items — always visible to everyone, no fog-of-war
    // gating, same "physical object on the ground" precedent as CTF's
    // flags (see MODES.ctf.snapshotExtras' flagPos).
    items: gs.items,
    events: gs.events.slice(-15),
    ...(mode.snapshotExtras ? mode.snapshotExtras(gs, me, t) : {}),
  };
}

module.exports = {
  createAropsGame, tickArops, getAropsSnapshot,
  actionArTelemetry, actionArHitAttempt, actionArUsePerk, actionArUseItem, actionArSetBase,
  ARO_DEFAULTS: DEFAULTS,
};
