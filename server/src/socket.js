'use strict';
const jwt         = require('jsonwebtoken');
const engine      = require('./game/engine');
const gameManager = require('./game/game_manager');
const { RACES, TDB, getTowersForRace } = require('./game/towers');
const { BUILTIN_MAPS: BUILTIN_MAP_LIST } = require('./game/data/maps');
const aropsShared = require('../../packages/arops-shared/dist/src');

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



// AR OPS "comic map" — real geodata processing lives in its own dependency-free
// module (server/src/game/comic_map.js) so it stays trivially unit-testable
// without pulling in socket.js's full auth/DB dependency tree.
const { COMIC_MAP_COOLDOWN_MS, fetchComicMapFeatures } = require('./game/comic_map');

module.exports = function setupSocket(io, db) {
  // Per-lobby cooldown for comic-map regeneration (module-scope Map: one
  // setupSocket() call per server process, shared across all connections).
  const comicMapLastTry = new Map();

  // ── Auth middleware ──────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token
                 || socket.handshake.headers?.authorization?.split(' ')[1];
      if (!token) return next(new Error('unauthorized'));
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const { rows } = await db.query(
        'SELECT id, username, avatar_color, is_guest FROM users WHERE id=$1', [payload.sub]);
      if (!rows[0]) return next(new Error('user_not_found'));
      socket.user = rows[0];
      next();
    } catch { next(new Error('invalid_token')); }
  });

  io.on('connection', async (socket) => {
    const { id: userId, username } = socket.user;
    console.log(`🔌 ${username} connected (${socket.id})`);

    socket.join(`user:${userId}`);
    await db.query('UPDATE users SET online=true, last_seen=NOW() WHERE id=$1', [userId]);
    socket.join(`user:${userId}`); // personal room for VS/TA per-player ticks
    notifyFollowers(io, db, userId, { event: 'user:online', userId, username });

    // ── CHAT ──────────────────────────────
    socket.on('chat:dm', async ({ to, content }) => {
      if (!content?.trim() || !to) return;
      const msg = content.trim().slice(0, 2000);
      try {
        const { rows } = await db.query(
          `INSERT INTO messages (sender_id, recipient_id, content)
           VALUES ($1,$2,$3) RETURNING id, created_at`,
          [userId, to, msg]
        );
        const payload = { id:rows[0].id, sender_id:userId, sender_name:username, avatar_color:socket.user.avatar_color, content:msg, created_at:rows[0].created_at };
        io.to(`user:${to}`).emit('chat:dm', { ...payload, from: userId });
        socket.emit('chat:dm:sent', payload);
      } catch (e) { console.error('DM error', e); }
    });

    socket.on('chat:group', async ({ groupId, content }) => {
      if (!content?.trim() || !groupId) return;
      const { rows: mem } = await db.query(
        'SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [groupId, userId]);
      if (!mem[0]) return socket.emit('error', { code: 'not_member' });
      const msg = content.trim().slice(0, 2000);
      const { rows } = await db.query(
        `INSERT INTO messages (sender_id, group_id, content) VALUES ($1,$2,$3) RETURNING id, created_at`,
        [userId, groupId, msg]
      );
      io.to(`group:${groupId}`).emit('chat:group', {
        id:rows[0].id, group_id:groupId, sender_id:userId,
        sender_name:username, avatar_color:socket.user.avatar_color,
        content:msg, created_at:rows[0].created_at,
      });
    });

    socket.on('chat:typing', ({ to, groupId }) => {
      if (to)      io.to(`user:${to}`).emit('chat:typing', { from: userId, username });
      if (groupId) socket.to(`group:${groupId}`).emit('chat:typing', { from: userId, username });
    });

    // ── GROUP ROOM ────────────────────────
    socket.on('group:join', async ({ groupId }) => {
      const { rows } = await db.query(
        'SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [groupId, userId]);
      if (!rows[0]) return socket.emit('error', { code: 'not_member' });
      socket.join(`group:${groupId}`);
      socket.to(`group:${groupId}`).emit('group:member_joined', { userId, username });
    });

    socket.on('group:leave_room', ({ groupId }) => socket.leave(`group:${groupId}`));

    // ── LOBBY ─────────────────────────────
    socket.on('lobby:join', async ({ lobbyId }) => {
      const { rows } = await db.query(
        `SELECT l.*, lm.user_id IS NOT NULL AS is_member
         FROM lobbies l LEFT JOIN lobby_members lm ON lm.lobby_id=l.id AND lm.user_id=$2
         WHERE l.id=$1`, [lobbyId, userId]);
      if (!rows[0] || !rows[0].is_member) return socket.emit('error', { code: 'not_in_lobby' });
      socket.join(`lobby:${lobbyId}`);
      const { rows: members } = await db.query(
        `SELECT u.id, u.username, u.avatar_color, lm.ready
         FROM lobby_members lm JOIN users u ON u.id=lm.user_id WHERE lm.lobby_id=$1 ORDER BY lm.joined_at ASC`, [lobbyId]);
      socket.emit('lobby:state', { members, hostId: rows[0].host_id });
      // AR Ops: make roles/teams EXPLICIT for every member (single source of
      // truth — clients previously guessed defaults from local member order,
      // which desynced), then deliver current state to the whole room.
      if (rows[0].game_mode === 'ar_ops') {
        const ar = rows[0].workshop_map_config?.ar_settings || {};
        ar.roles = ar.roles || {};
        ar.teams = ar.teams || {};
        let changed = false;
        members.forEach((m, idx) => {
          if (!ar.roles[m.id]) {
            ar.roles[m.id] = m.id === rows[0].host_id ? 'seeker' : 'hider';
            changed = true;
          }
          if (!ar.teams[m.id]) {
            ar.teams[m.id] = idx % 2 === 0 ? 'a' : 'b';
            changed = true;
          }
        });
        if (changed) {
          const cfg = { ...(rows[0].workshop_map_config || {}), game_mode: 'ar_ops', ar_settings: ar };
          await db.query('UPDATE lobbies SET workshop_map_config=$1 WHERE id=$2', [JSON.stringify(cfg), lobbyId]);
        }
        const polygonCheck = (ar.polygon && ar.polygon.length >= 3)
          ? aropsShared.validatePolygon(ar.polygon) : null;
        // Room-wide so every client (incl. the joiner) has identical role state
        io.to(`lobby:${lobbyId}`).emit('lobby:ar_updated', { arSettings: ar, polygonCheck });
      }
      socket.to(`lobby:${lobbyId}`).emit('lobby:player_joined', {
        userId, username, avatar_color: socket.user.avatar_color, ready: false });
    });

    socket.on('lobby:ready', async ({ lobbyId, ready }) => {
      await db.query('UPDATE lobby_members SET ready=$1 WHERE lobby_id=$2 AND user_id=$3', [ready, lobbyId, userId]);
      io.to(`lobby:${lobbyId}`).emit('lobby:player_ready', { userId, ready });
      await checkLobbyAllReady(io, db, lobbyId);
    });

    socket.on('lobby:leave', async ({ lobbyId }) => {
      await db.query('DELETE FROM lobby_members WHERE lobby_id=$1 AND user_id=$2', [lobbyId, userId]);
      socket.leave(`lobby:${lobbyId}`);
      io.to(`lobby:${lobbyId}`).emit('lobby:player_left', { userId, username });
      const { rows } = await db.query('SELECT host_id FROM lobbies WHERE id=$1', [lobbyId]);
      if (rows[0]?.host_id === userId) {
        const { rows: members } = await db.query('SELECT user_id FROM lobby_members WHERE lobby_id=$1 LIMIT 1', [lobbyId]);
        if (members[0]) {
          await db.query('UPDATE lobbies SET host_id=$1 WHERE id=$2', [members[0].user_id, lobbyId]);
          io.to(`lobby:${lobbyId}`).emit('lobby:host_changed', { newHostId: members[0].user_id });
        } else {
          await db.query("UPDATE lobbies SET status='finished' WHERE id=$1", [lobbyId]);
        }
      }
    });

    // Fill in authoritative default roles/teams for all current members so
    // every client renders the SAME assignment (no local guessing by order).
    async function effectiveArSettings(lobbyId, ar) {
      const out = { ...(ar || {}) };
      try {
        const { rows: mem } = await db.query(
          `SELECT lm.user_id, l.host_id FROM lobby_members lm
           JOIN lobbies l ON l.id = lm.lobby_id
           WHERE lm.lobby_id=$1 ORDER BY lm.joined_at ASC`, [lobbyId]);
        const roles = { ...(out.roles || {}) };
        const teams = { ...(out.teams || {}) };
        mem.forEach((m, idx) => {
          if (!roles[m.user_id]) roles[m.user_id] = m.user_id === m.host_id ? 'seeker' : 'hider';
          if (teams[m.user_id] !== 'a' && teams[m.user_id] !== 'b') teams[m.user_id] = idx % 2 === 0 ? 'a' : 'b';
        });
        // Bots default the same way, continuing the index sequence after real
        // members — MUST match the ordering used in lobby:start's member merge,
        // or the lobby preview and the actual match would disagree on defaults.
        const bots = Array.isArray(out.bots) ? out.bots : [];
        bots.forEach((b, i) => {
          const idx = mem.length + i;
          if (!roles[b.id]) roles[b.id] = 'hider';
          if (teams[b.id] !== 'a' && teams[b.id] !== 'b') teams[b.id] = idx % 2 === 0 ? 'a' : 'b';
        });
        out.roles = roles;
        out.teams = teams;
      } catch (e) { console.error('effectiveArSettings:', e.message); }
      return out;
    }

    // ── AR OPS: host updates playfield/roles/settings ────
    socket.on('lobby:ar_update', async ({ lobbyId, arSettings }) => {
      try {
        const { rows } = await db.query('SELECT host_id, game_mode, workshop_map_config FROM lobbies WHERE id=$1', [lobbyId]);
        if (!rows[0]) return socket.emit('error', { code: 'lobby_not_found' });
        if (rows[0].host_id !== userId) return socket.emit('error', { code: 'not_host' });
        if (rows[0].game_mode !== 'ar_ops') return socket.emit('error', { code: 'wrong_mode' });

        // Whitelist + sanitize fields (never trust client blobs)
        const cur = rows[0].workshop_map_config?.ar_settings || {};
        const next = { ...cur };
        if (Array.isArray(arSettings?.polygon)) {
          next.polygon = arSettings.polygon
            .filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lon))
            .slice(0, 30)
            .map(p => ({ lat: +p.lat, lon: +p.lon }));
        }
        if (arSettings?.roles && typeof arSettings.roles === 'object') {
          next.roles = {};
          for (const [uid, role] of Object.entries(arSettings.roles)) {
            if (role === 'seeker' || role === 'hider') next.roles[uid] = role;
          }
        }
        for (const k of ['hidingDurationMs', 'gameDurationMs', 'radarCooldownMs', 'proximityRangeM']) {
          if (Number.isFinite(arSettings?.[k])) next[k] = Math.max(0, +arSettings[k]);
        }
        // Mode selection + mode-specific settings
        const SUB_MODES = ['hide_and_seek', 'domination', 'ctf', 'seek_destroy'];
        if (SUB_MODES.includes(arSettings?.subMode)) next.subMode = arSettings.subMode;
        if (arSettings?.foundMode === 'seeker' || arSettings?.foundMode === 'spectator') {
          next.foundMode = arSettings.foundMode;
        }
        if (typeof arSettings?.debugMode === 'boolean') next.debugMode = arSettings.debugMode;
        if (Array.isArray(arSettings?.bots)) {
          next.bots = arSettings.bots
            .filter(b => b && typeof b.id === 'string' && b.id.startsWith('bot_') && typeof b.username === 'string')
            .slice(0, 12)
            .map(b => ({ id: b.id, username: b.username.slice(0, 24) }));
        }
        if (Array.isArray(arSettings?.zones)) {
          next.zones = arSettings.zones
            .filter(z => z && Number.isFinite(z.lat) && Number.isFinite(z.lon))
            .slice(0, 8)
            .map(z => ({ lat: +z.lat, lon: +z.lon }));
        }
        if (arSettings?.teams && typeof arSettings.teams === 'object') {
          next.teams = {};
          for (const [uid, tm] of Object.entries(arSettings.teams)) {
            if (tm === 'a' || tm === 'b') next.teams[uid] = tm;
          }
        }
        if (Number.isFinite(arSettings?.targetScore)) {
          next.targetScore = Math.min(10_000, Math.max(10, Math.round(+arSettings.targetScore)));
        }
        if (Number.isFinite(arSettings?.targetCaptures)) {
          next.targetCaptures = Math.min(10, Math.max(1, Math.round(+arSettings.targetCaptures)));
        }

        // Validate polygon; auto-repair tap-order self-intersection by
        // sorting points around the centroid (fixes the #1 host frustration:
        // self_intersecting + bogus area_too_large from a crossed polygon)
        let polygonCheck = null;
        if (next.polygon && next.polygon.length >= 3) {
          polygonCheck = aropsShared.validatePolygon(next.polygon);
          if (!polygonCheck.ok && polygonCheck.errors.includes('self_intersecting')) {
            const sorted = aropsShared.sortPolygonPoints(next.polygon);
            const sortedCheck = aropsShared.validatePolygon(sorted);
            if (!sortedCheck.errors.includes('self_intersecting')) {
              next.polygon = sorted;
              polygonCheck = sortedCheck;
            }
          }
        }

        const cfg = { ...(rows[0].workshop_map_config || {}), game_mode: 'ar_ops', ar_settings: next };
        await db.query('UPDATE lobbies SET workshop_map_config=$1 WHERE id=$2', [JSON.stringify(cfg), lobbyId]);
        const effective = await effectiveArSettings(lobbyId, next);
        io.to(`lobby:${lobbyId}`).emit('lobby:ar_updated', { arSettings: effective, polygonCheck });
      } catch (e) {
        console.error('lobby:ar_update error:', e.message);
        socket.emit('error', { code: 'ar_update_failed' });
      }
    });

    // ── AR OPS: host generates the "comic map" (real geodata for the field) ──
    socket.on('lobby:generate_comic_map', async ({ lobbyId, reqId }) => {
      try {
        const { rows } = await db.query('SELECT host_id, game_mode, workshop_map_config FROM lobbies WHERE id=$1', [lobbyId]);
        if (!rows[0]) return socket.emit('lobby:comic_map_error', { reqId, err: 'lobby_not_found' });
        if (rows[0].host_id !== userId) return socket.emit('lobby:comic_map_error', { reqId, err: 'not_host' });
        if (rows[0].game_mode !== 'ar_ops') return socket.emit('lobby:comic_map_error', { reqId, err: 'wrong_mode' });

        const ar = rows[0].workshop_map_config?.ar_settings || {};
        const polygon = ar.polygon;
        if (!Array.isArray(polygon) || polygon.length < 3) {
          return socket.emit('lobby:comic_map_error', { reqId, err: 'no_polygon' });
        }
        if (!aropsShared.validatePolygon(polygon).ok) {
          return socket.emit('lobby:comic_map_error', { reqId, err: 'invalid_polygon' });
        }

        const lastTry = comicMapLastTry.get(lobbyId) || 0;
        const elapsed = Date.now() - lastTry;
        if (elapsed < COMIC_MAP_COOLDOWN_MS) {
          return socket.emit('lobby:comic_map_error', { reqId, err: 'cooldown', remainingMs: COMIC_MAP_COOLDOWN_MS - elapsed });
        }
        comicMapLastTry.set(lobbyId, Date.now());

        const features = await fetchComicMapFeatures(polygon);
        const comicMap = { features, polygonSnapshot: JSON.stringify(polygon), fetchedAt: Date.now() };
        const next = { ...ar, comicMap };
        const cfg = { ...(rows[0].workshop_map_config || {}), game_mode: 'ar_ops', ar_settings: next };
        await db.query('UPDATE lobbies SET workshop_map_config=$1 WHERE id=$2', [JSON.stringify(cfg), lobbyId]);
        io.to(`lobby:${lobbyId}`).emit('lobby:comic_map_ready', { reqId, comicMap });
      } catch (e) {
        console.error('lobby:generate_comic_map error:', e.message);
        const reason = e.message === 'overpass_rate_limited' ? 'rate_limited'
          : e.message === 'overpass_timeout' ? 'timeout'
          : e.message === 'overpass_network_error' ? 'network_error'
          : 'fetch_failed';
        socket.emit('lobby:comic_map_error', { reqId, err: reason });
      }
    });

    socket.on('lobby:start', async ({ lobbyId }) => {
      try {
      const { rows } = await db.query('SELECT * FROM lobbies WHERE id=$1', [lobbyId]);
      if (!rows[0]) return socket.emit('error', { code: 'lobby_not_found' });
      if (rows[0].host_id !== userId) return socket.emit('error', { code: 'not_host' });
      const lobby = rows[0];

      // AR Ops preflight: playfield + roles must be complete before start
      if (lobby.game_mode === 'ar_ops') {
        const ar = await effectiveArSettings(lobbyId, lobby.workshop_map_config?.ar_settings);
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
      gameManager.on(sessionId, 'game_over',     ({ win, players })    => finalizeGameFromWorker(io, db, sessionId, players, win));

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
      gameManager.on(sessionId, 'game_over',    ({ win, players }) => finalizeGameFromWorker(io, db, sessionId, players, win));

      socket.join(`game:${sessionId}`);
      socket.emit('game:solo_started', { sessionId, difficulty: effectiveDifficulty, race, mode: gameMode });
      console.log(`[solo_started] sessionId=${sessionId} mode=${gameMode}`);
      } catch(e) {
        console.error('[solo_start error]', e.message);
        socket.emit('game:error', { code: 'start_failed', detail: e.message });
      }
    });

    // ── RACE SELECTION ───────────────────
    socket.on('lobby:set_race', async ({ lobbyId, race }) => {
      if (!RACES[race] && race !== 'standard') return;
      // Check the lobby's map config - if available_races is restricted, enforce it
      try {
        const { rows } = await db.query('SELECT workshop_map_config FROM lobbies WHERE id=$1', [lobbyId]);
        const cfg = rows?.[0]?.workshop_map_config;
        const allowed = cfg?.available_races || cfg?.config?.available_races;
        if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(race)) {
          // Snap to first allowed race instead of rejecting
          race = allowed[0];
        }
      } catch (e) {}
      await db.query(
        'UPDATE lobby_members SET race=$1 WHERE lobby_id=$2 AND user_id=$3',
        [race, lobbyId, userId]
      ).catch(() => {});
      io.to(`lobby:${lobbyId}`).emit('lobby:race_changed', { userId, race });
    });

    // ── DISCONNECT ────────────────────────
    socket.on('disconnect', async () => {
      console.log(`🔌 ${username} disconnected`);
      await db.query('UPDATE users SET online=false, last_seen=NOW() WHERE id=$1', [userId]);
      notifyFollowers(io, db, userId, { event: 'user:offline', userId });
    });
  });
};

// ── GAME META ROUTES ─────────────────────────────────────
// These are added to express app by the caller
module.exports.getRacesHandler = (req, res) => {
  res.json({ races: RACES, towers: TDB });
};

// ── HELPERS ──────────────────────────────────────────────
async function finalizeGameFromWorker(io, db, sessionId, players, win) {
  const all = Object.values(players || {});
  all.sort((a, b) => (b.score||0) - (a.score||0));

  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    await db.query(
      `UPDATE game_players SET status='finished', wave=$1, score=$2, kills=$3, rank=$4, finished_at=NOW()
       WHERE session_id=$5 AND user_id=$6`,
      [p.wave||0, p.score||0, p.kills||0, i+1, sessionId, p.userId]
    ).catch(()=>{});
    if ((p.wave||0) > 0) {
      await db.query(
        'INSERT INTO leaderboard (user_id, game_type, score, wave, difficulty, mode) VALUES ($1,$2,$3,$4,$5,$6)',
        [p.userId, 'tower_defense', p.score||0, p.wave||0, p.difficulty||'normal', p.mode||'solo']
      ).catch(() => {});
    }
  }
  await db.query("UPDATE game_sessions SET status='finished', ended_at=NOW() WHERE id=$1", [sessionId]);

  io.to(`game:${sessionId}`).emit('game:over', {
    win, rankings: all.map((p, i) => ({ ...p, rank: i+1 })),
  });
  gameManager.destroy(sessionId);
}

async function checkLobbyAllReady(io, db, lobbyId) {
  const { rows } = await db.query(
    'SELECT COUNT(*) FILTER (WHERE NOT ready) AS not_ready, COUNT(*) AS total FROM lobby_members WHERE lobby_id=$1',
    [lobbyId]);
  if (+rows[0].total >= 2 && +rows[0].not_ready === 0) {
    io.to(`lobby:${lobbyId}`).emit('lobby:all_ready');
  }
}

async function notifyFollowers(io, db, userId, payload) {
  try {
    const { rows } = await db.query('SELECT follower_id FROM follows WHERE following_id=$1', [userId]);
    rows.forEach(r => io.to(`user:${r.follower_id}`).emit(payload.event, payload));
  } catch {}
}
