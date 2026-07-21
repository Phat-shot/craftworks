'use strict';
// Game-Dispatch: Session-Start (Lobby → laufendes Match), In-Match-Actions,
// Solo-Modus. Spiegelbild von ./platform.js — siehe dortigen Kommentar.
// lobby:start trägt zwar den "lobby:"-Präfix, gehört aber hierher: es
// bootstrapped die Game-Engine (gameManager.create) und ist damit der
// eigentliche Übergang von der Lobby- in die Game-Domäne.
const gameManager = require('../game/game_manager');
const { RACES } = require('../game/towers');
const aropsShared = require('@craftworks/arops-shared');
const { BUILTIN_MAPS: BUILTIN_MAP_LIST } = require('../game/data/maps');
const { effectiveArSettings } = require('./platform');

// Enrich TA workshopConfig with server-side sequences (never sent through client)
function enrichTaConfig(wc) {
  try {
    if (!wc) return wc;
    const mapId = wc.id || wc.map_id;
    const builtin = mapId && BUILTIN_MAP_LIST?.find(m => m.id === mapId);
    if (!builtin?.config?.ta_layout) return wc;
    const bTl = builtin.config.ta_layout;
    const cTl = wc.ta_layout || {};
    const numRounds = cTl.rounds || bTl.rounds || 10;
    const allSeqs = bTl.prebuilt_sequences || [];

    // Pre-select rounds here (main thread) — send only selected rounds to worker
    let selectedSeqs = [];
    if (allSeqs.length > 0) {
      const pool = [...allSeqs];
      for (let i = 0; i < numRounds; i++) {
        if (pool.length === 0) pool.push(...allSeqs);
        selectedSeqs.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      }
    }

    const tl = {
      ...bTl,                                    // start with builtin defaults (cols/rows/gpr/wpr)
      ...cTl,                                    // client overrides (rounds, countdown)
      rounds:             numRounds,
      round_selection:    'sequential',          // already randomized above
      prebuilt_sequences: selectedSeqs,          // 10 rounds (not 50) — MUST be last
    };
    console.log('[enrichTa]', mapId + ': ' + selectedSeqs.length + ' rounds selected, cols=' + tl.cols);
    return { ...wc, ta_layout: tl };
  } catch(e) {
    console.error('[enrichTaConfig] error:', e.message);
    return wc;
  }
}

async function finalizeGameFromWorker(io, db, sessionId, players, win, abandoned = false) {
  const all = Object.values(players || {});
  all.sort((a, b) => (b.score||0) - (a.score||0));

  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    // AR Ops bots (userId 'bot_...', see platform.js's own bot-id check)
    // never get a real game_players row in the first place — they're not
    // real users, just synthetic in-memory opponents — so this UPDATE was
    // guaranteed to fail every single time for every bot in every finished
    // match (Postgres: "invalid input syntax for type uuid"), silently
    // swallowed by the .catch below but spamming the server log on every
    // AR Ops game with bots. Skip them outright instead of querying for a
    // row that structurally can't exist.
    if (p.isBot || (typeof p.userId === 'string' && p.userId.startsWith('bot_'))) continue;
    await db.query(
      `UPDATE game_players SET status='finished', wave=$1, score=$2, kills=$3, rank=$4, finished_at=NOW()
       WHERE session_id=$5 AND user_id=$6`,
      [p.wave||0, p.score||0, p.kills||0, i+1, sessionId, p.userId]
    ).catch(()=>{});
    // Abandoned sessions (idle-timeout, see worker.js) never had a genuine
    // finish — skip the leaderboard entirely rather than record a near-zero
    // score as if it were a real result.
    if (!abandoned && (p.wave||0) > 0) {
      await db.query(
        'INSERT INTO leaderboard (user_id, game_type, score, wave, difficulty, mode) VALUES ($1,$2,$3,$4,$5,$6)',
        [p.userId, 'tower_defense', p.score||0, p.wave||0, p.difficulty||'normal', p.mode||'solo']
      ).catch(() => {});
    }
  }
  await db.query(
    `UPDATE game_sessions SET status=$1, ended_at=NOW() WHERE id=$2`,
    [abandoned ? 'abandoned' : 'finished', sessionId]
  );

  io.to(`game:${sessionId}`).emit('game:over', {
    win, rankings: all.map((p, i) => ({ ...p, rank: i+1 })),
  });
  gameManager.destroy(sessionId);
}

function registerGameHandlers(io, socket, db) {
  const { id: userId, username } = socket.user;

  socket.on('lobby:start', async ({ lobbyId }) => {
    try {
    const { rows } = await db.query('SELECT * FROM lobbies WHERE id=$1', [lobbyId]);
    if (!rows[0]) {
      // See platform.js's lobby:ar_update for why this is logged: lobbies
      // are never DELETEd anywhere, only their status updated, so this is
      // unexpected and worth a server-side trail if it recurs.
      console.warn(`[lobby:start] lobby_not_found lobbyId=${lobbyId} userId=${userId}`);
      // Reported to also happen independent of any server redeploy — rules
      // out "container was mid-restart" as the sole explanation. Log the
      // requester's own recent lobbies alongside so a recurrence shows
      // whether lobbyId is a genuinely wrong/stale id (absent from this
      // list too) or something stranger (present here, but the direct
      // SELECT above still missed it).
      db.query('SELECT id, code, status, created_at FROM lobbies WHERE host_id=$1 ORDER BY created_at DESC LIMIT 3', [userId])
        .then(r => console.warn(`[lobby:start] recent lobbies for host ${userId}: ${JSON.stringify(r.rows)}`))
        .catch(() => {});
      return socket.emit('error', { code: 'lobby_not_found' });
    }
    if (rows[0].host_id !== userId) return socket.emit('error', { code: 'not_host' });
    const lobby = rows[0];

    // AR Ops preflight: playfield + roles must be complete before start
    if (lobby.game_mode === 'ar_ops') {
      const ar = await effectiveArSettings(db, lobbyId, lobby.workshop_map_config?.ar_settings);
      lobby.workshop_map_config = { ...(lobby.workshop_map_config || {}), ar_settings: ar };
      const polyCheck = ar?.polygon ? aropsShared.validatePolygon(ar.polygon) : { ok: false, errors: ['too_few_points'] };
      if (!polyCheck.ok) {
        return socket.emit('error', { code: 'ar_invalid_polygon', details: polyCheck.errors });
      }
      const { rows: cnt } = await db.query('SELECT COUNT(*) AS n FROM lobby_members WHERE lobby_id=$1', [lobbyId]);
      const botCount = Array.isArray(ar?.bots) ? ar.bots.length : 0;
      if (!ar?.debugMode && (+cnt[0].n + botCount) < 2) {
        return socket.emit('error', { code: 'ar_need_two_players' });
      }
      // Zone preflight for zone-based modes
      const sub = ar?.subMode || 'hide_and_seek';
      if (sub === 'domination' || sub === 'seek_destroy') {
        const minZones = sub === 'domination' ? 2 : 1;
        const zonesRaw = Array.isArray(ar?.zones) ? ar.zones : [];
        if (zonesRaw.length < minZones) {
          return socket.emit('error', { code: 'ar_need_zones', min: minZones });
        }
        const t = aropsShared.scaleTimings(aropsShared.polygonAreaM2(ar.polygon));
        const zones = zonesRaw.map((z, i) => ({ id: 'z' + i, lat: +z.lat, lon: +z.lon, radiusM: t.zoneRadiusM }));
        const zc = aropsShared.validateZones(zones, ar.polygon);
        if (!zc.ok) return socket.emit('error', { code: 'ar_zones_invalid', details: zc.errors });
      }
    }

    // Kill any still-running session of this lobby BEFORE starting a new one.
    // Without this, old AR workers (matches run up to 30 min) keep emitting
    // ar_tick to the same users → client flickers between old and new game.
    try {
      const { rows: stale } = await db.query(
        `SELECT id FROM game_sessions WHERE lobby_id=$1 AND ended_at IS NULL`, [lobbyId]);
      for (const s of stale) {
        if (gameManager.has(s.id)) gameManager.destroy(s.id);
        await db.query(`UPDATE game_sessions SET status='finished', ended_at=NOW() WHERE id=$1`, [s.id]);
      }
      if (stale.length) console.log(`[lobby:start] destroyed ${stale.length} stale session(s) for lobby ${lobbyId}`);
    } catch (e) { console.error('[lobby:start] stale cleanup:', e.message); }

    const { rows: session } = await db.query(
      `INSERT INTO game_sessions (lobby_id, game_mode, difficulty) VALUES ($1,$2,$3) RETURNING id`,
      [lobbyId, lobby.game_mode, lobby.difficulty]
    );
    const sessionId = session[0].id;

    const { rows: members } = await db.query(
      `SELECT u.id AS "userId", u.username, u.avatar_color
       FROM lobby_members lm JOIN users u ON u.id=lm.user_id WHERE lm.lobby_id=$1 ORDER BY lm.joined_at ASC`, [lobbyId]);

    for (const m of members) {
      await db.query('INSERT INTO game_players (session_id, user_id, username) VALUES ($1,$2,$3)',
        [sessionId, m.userId, m.username]);
    }

    // Bots have no `users` row (FK constraint) — appended AFTER persistence,
    // in-memory only, same order convention as effectiveArSettings' defaulting.
    if (lobby.game_mode === 'ar_ops' && Array.isArray(lobby.workshop_map_config?.ar_settings?.bots)) {
      for (const b of lobby.workshop_map_config.ar_settings.bots) {
        members.push({ userId: b.id, username: b.username, avatar_color: null, isBot: true });
      }
    }

    // Create game in worker thread
    const playerRaces = {};
    for (const m of members) playerRaces[m.userId] = m.race || 'standard';
    let workshopMapConfig = lobby.workshop_map_config || null;
    if (lobby.game_mode === 'time_attack') workshopMapConfig = enrichTaConfig(workshopMapConfig);

    gameManager.create(sessionId, {
      difficulty: lobby.difficulty, mode: lobby.game_mode,
      players: members, playerRaces, workshopConfig: workshopMapConfig,
    });
    // Route messages per mode
    gameManager.on(sessionId, 'tick',          ({ snap })            => io.to(`game:${sessionId}`).emit('game:tick', snap));
    gameManager.on(sessionId, 'wave_started',  ({ wave })            => io.to(`game:${sessionId}`).emit('game:wave_started', { wave }));
    gameManager.on(sessionId, 'wave_ended',    ({ wave, bonus })     => io.to(`game:${sessionId}`).emit('game:wave_ended', { wave, bonus }));
    // VS: per-player fog-of-war ticks
    gameManager.on(sessionId, 'vs_tick',       ({ userId, snap })    => io.to(`user:${userId}`).emit('game:vs_tick', snap));
    // Time Attack: per-player ticks
    gameManager.on(sessionId, 'ta_tick',       ({ userId, snap })    => io.to(`user:${userId}`).emit('game:ta_tick', snap));
    gameManager.on(sessionId, 'ar_tick',       ({ userId, snap })    => io.to(`user:${userId}`).emit('game:ar_tick', snap));
    gameManager.on(sessionId, 'ta_round_end',  (msg)                 => io.to(`game:${sessionId}`).emit('game:ta_round_end', msg));
    gameManager.on(sessionId, 'game_over',     ({ win, players, abandoned }) => finalizeGameFromWorker(io, db, sessionId, players, win, abandoned));

    await db.query("UPDATE lobbies SET status='in_progress' WHERE id=$1", [lobbyId]);

    console.log(`[game:start] sessionId=${sessionId} mode=${lobby.game_mode} players=${members.length}`);
    io.to(`lobby:${lobbyId}`).emit('game:start', {
      sessionId, mode: lobby.game_mode, difficulty: lobby.difficulty,
      players: members, playerCount: members.length,
      races: RACES,
      workshopConfig: workshopMapConfig,
    });
    } catch(e) {
      console.error('lobby:start error:', e.message);
      socket.emit('error', { code: 'server_error', detail: e.message });
    }
  });

  // ── GAME ACTIONS (server-authoritative) ──
  socket.on('game:join', ({ sessionId }) => {
    socket.join(`game:${sessionId}`);
  });

  // Debug-mode RTT probe (AR Ops debug overlay) — immediate echo, no cost
  // to normal play since it's only ever sent when the overlay is open.
  socket.on('debug:ping', ({ t }) => {
    if (typeof t === 'number') socket.emit('debug:pong', { t });
  });

  socket.on('game:action', async ({ sessionId, action, data }) => {
    if (!gameManager.has(sessionId)) {
      console.warn(`[game:action] no_session: sid=${sessionId} action=${action} user=${userId}`);
      return socket.emit('game:action_result', { ok:false, err:'no_session' });
    }
    const result = await gameManager.action(sessionId, userId, action, data || {});
    socket.emit('game:action_result', { action, ...result });
  });

  // Solo game: start engine without lobby
  socket.on('game:solo_start', async ({ difficulty, race = 'standard', workshopConfig = null, mode = 'solo' }) => {
    try {
    const effectiveDifficulty = workshopConfig?.difficulty || difficulty;
    // Normalize gameMode: 'td' -> 'solo' for engine, keep original for DB
    const rawMode = workshopConfig?.game_mode || mode;
    const gameMode = rawMode === 'td' ? 'solo' : rawMode;
    if (gameMode === 'time_attack') workshopConfig = enrichTaConfig(workshopConfig);
    const dbMode   = rawMode; // store original in DB
    console.log(`[solo_start] user=${userId} mode=${gameMode} diff=${effectiveDifficulty} race=${race}`);
    const { rows } = await db.query(
      `INSERT INTO game_sessions (lobby_id, game_mode, difficulty) VALUES (NULL,$1,$2) RETURNING id`,
      [dbMode, effectiveDifficulty]
    );
    const sessionId = rows[0].id;

    gameManager.create(sessionId, {
      difficulty: effectiveDifficulty, mode: gameMode,
      players: [{ userId, username, avatar_color: socket.user.avatar_color }],
      playerRaces: { [userId]: race },
      workshopConfig,
    });
    gameManager.on(sessionId, 'tick',         ({ snap })         => socket.emit('game:tick', snap));
    gameManager.on(sessionId, 'wave_started', ({ wave })         => socket.emit('game:wave_started', { wave }));
    gameManager.on(sessionId, 'wave_ended',   ({ wave, bonus })  => socket.emit('game:wave_ended', { wave, bonus }));
    gameManager.on(sessionId, 'vs_tick',      ({ userId, snap }) => socket.emit('game:vs_tick', snap));
    gameManager.on(sessionId, 'ta_tick',      ({ userId, snap }) => socket.emit('game:ta_tick', snap));
    gameManager.on(sessionId, 'ar_tick',      ({ userId: uid, snap }) => { if (uid === userId) socket.emit('game:ar_tick', snap); });
    gameManager.on(sessionId, 'ta_round_end', (msg)              => socket.emit('game:ta_round_end', msg));
    gameManager.on(sessionId, 'game_over',    ({ win, players, abandoned }) => finalizeGameFromWorker(io, db, sessionId, players, win, abandoned));

    socket.join(`game:${sessionId}`);
    socket.emit('game:solo_started', { sessionId, difficulty: effectiveDifficulty, race, mode: gameMode });
    console.log(`[solo_started] sessionId=${sessionId} mode=${gameMode}`);
    } catch(e) {
      console.error('[solo_start error]', e.message);
      socket.emit('game:error', { code: 'start_failed', detail: e.message });
    }
  });
}

module.exports = { registerGameHandlers };
