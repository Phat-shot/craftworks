'use strict';
// Platform-Dispatch: Chat, Freundes-Präsenz, Gruppen, Lobby-Mitgliedschaft/
// -Konfiguration. Spiegelbild von ./game.js — zusammen ersetzen sie den
// vormals einzigen socket.js-Handler, der beides vermischte (Phase 3 des
// Backend-Redesigns, siehe Plan). Reine Verschiebung der Dispatch-Ebene,
// keine Änderung an der eigentlichen Domain-Logik.
const { RACES } = require('../game/towers');
const aropsShared = require('@craftworks/arops-shared');
const { COMIC_MAP_COOLDOWN_MS, fetchComicMapFeatures } = require('../game/comic_map');
const users = require('../repositories/users');

// Per-lobby Cooldown für Comic-Map-Regeneration — Module-Scope-Map, EINMAL
// pro Serverprozess angelegt (nicht pro Verbindung), sonst würde jeder neue
// Connect den Cooldown vergessen.
const comicMapLastTry = new Map();

// Füllt fehlende AR-Ops-Rollen/Teams für alle aktuellen Mitglieder auf, damit
// jeder Client dieselbe Zuordnung rendert (kein lokales Raten nach Reihenfolge
// mehr). Wird sowohl von lobby:ar_update (hier) als auch von game.js' lobby:start
// (Preflight vor Matchstart) gebraucht — deshalb exportiert statt privat.
async function effectiveArSettings(db, lobbyId, ar) {
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

async function checkLobbyAllReady(io, db, lobbyId) {
  const { rows } = await db.query(
    'SELECT COUNT(*) FILTER (WHERE NOT ready) AS not_ready, COUNT(*) AS total FROM lobby_members WHERE lobby_id=$1',
    [lobbyId]);
  if (+rows[0].total >= 2 && +rows[0].not_ready === 0) {
    io.to(`lobby:${lobbyId}`).emit('lobby:all_ready');
  }
}

// Genutzt sowohl beim Connect (socket.js, direkt nach dem Handshake) als auch
// beim Disconnect hier — deshalb exportiert statt privat.
async function notifyFollowers(io, db, userId, payload) {
  try {
    const { rows } = await db.query('SELECT follower_id FROM follows WHERE following_id=$1', [userId]);
    rows.forEach(r => io.to(`user:${r.follower_id}`).emit(payload.event, payload));
  } catch {}
}

function registerPlatformHandlers(io, socket, db) {
  const { id: userId, username } = socket.user;

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
      // Mode selection + mode-specific settings. Whitelist MUST be kept in
      // sync with server/src/game/arops.js's MODES table and the DEFAULTS/
      // cfg parsing in createAropsGame — any field missing here gets
      // silently dropped (never reaches ar_settings, never reaches the
      // actual match), which from the host's perspective looks exactly
      // like "nothing happens when I tap this setting".
      const SUB_MODES = ['hide_and_seek', 'domination', 'ctf', 'seek_destroy', 'deathmatch'];
      if (SUB_MODES.includes(arSettings?.subMode)) next.subMode = arSettings.subMode;
      if (['seeker', 'spectator', 'freeze'].includes(arSettings?.foundMode)) {
        next.foundMode = arSettings.foundMode;
      }
      // Hide & Seek variant: 'classic' (default), 'ffa' (Jeder gegen jeden)
      // or 'the_ship' — see MODES.hide_and_seek in arops.js.
      if (['classic', 'ffa', 'the_ship'].includes(arSettings?.hsVariant)) {
        next.hsVariant = arSettings.hsVariant;
      }
      // Zerstören (seek_destroy): capture variant + whether targets reset
      // after a full cycle instead of ending the match.
      if (['instant', 'defuse'].includes(arSettings?.destroyVariant)) {
        next.destroyVariant = arSettings.destroyVariant;
      }
      if (typeof arSettings?.destroyReactivate === 'boolean') {
        next.destroyReactivate = arSettings.destroyReactivate;
      }
      // Deathmatch: on-hit consequence + lives (respawn variant only).
      if (['respawn', 'freeze'].includes(arSettings?.deathmatchOnHit)) {
        next.deathmatchOnHit = arSettings.deathmatchOnHit;
      }
      if (Number.isFinite(arSettings?.livesPerPlayer)) {
        next.livesPerPlayer = Math.min(10, Math.max(1, Math.round(+arSettings.livesPerPlayer)));
      }
      if (typeof arSettings?.debugMode === 'boolean') next.debugMode = arSettings.debugMode;
      if (arSettings?.hitTrackingMode === 'compass' || arSettings?.hitTrackingMode === 'ir') {
        next.hitTrackingMode = arSettings.hitTrackingMode;
      }
      // Host-assigned mapping of userId -> the numeric ID (0-255) their
      // physical ESP32 IR beacon broadcasts (see hardware/esp32-ir) —
      // only consulted server-side when hitTrackingMode is 'ir'.
      if (arSettings?.irIds && typeof arSettings.irIds === 'object') {
        next.irIds = {};
        for (const [uid, id] of Object.entries(arSettings.irIds)) {
          if (Number.isFinite(id) && id >= 0 && id <= 255) next.irIds[uid] = +id;
        }
      }
      // Host-configurable shot range/width — merged onto DEFAULT_HIT_CONFIG
      // in createAropsGame, so this genuinely changes hit validation, not
      // just the client-side overlay. Clamped to sane bounds regardless of
      // what the client sends.
      if (arSettings?.hitConfig && typeof arSettings.hitConfig === 'object') {
        next.hitConfig = { ...(next.hitConfig || {}) };
        if (Number.isFinite(arSettings.hitConfig.maxRangeM)) {
          next.hitConfig.maxRangeM = Math.min(200, Math.max(10, +arSettings.hitConfig.maxRangeM));
        }
        if (Number.isFinite(arSettings.hitConfig.baseConeHalfAngleDeg)) {
          next.hitConfig.baseConeHalfAngleDeg = Math.min(45, Math.max(1, +arSettings.hitConfig.baseConeHalfAngleDeg));
        }
      }
      // "Auto" mode: hiding/game duration, shot range and perk cooldowns
      // get derived from field size in createAropsGame instead — overrides
      // the manual presets above once a match actually starts.
      if (typeof arSettings?.autoScale === 'boolean') next.autoScale = arSettings.autoScale;
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
      const effective = await effectiveArSettings(db, lobbyId, next);
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
    await users.setOnline(userId, false);
    notifyFollowers(io, db, userId, { event: 'user:offline', userId });
  });
}

module.exports = { registerPlatformHandlers, effectiveArSettings, notifyFollowers };
