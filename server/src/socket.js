'use strict';
const jwt    = require('jsonwebtoken');
const engine = require('./game/engine');

// Active game engines: sessionId -> gameState
const activeGames = new Map();
// Game loop intervals: sessionId -> intervalId
const gameLoops   = new Map();

const TICK_RATE = 20; // ticks per second

module.exports = function setupSocket(io, db) {

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
         FROM lobby_members lm JOIN users u ON u.id=lm.user_id WHERE lm.lobby_id=$1`, [lobbyId]);
      socket.emit('lobby:state', { members });
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

    socket.on('lobby:start', async ({ lobbyId }) => {
      const { rows } = await db.query('SELECT * FROM lobbies WHERE id=$1', [lobbyId]);
      if (!rows[0] || rows[0].host_id !== userId) return socket.emit('error', { code: 'not_host' });
      const lobby = rows[0];

      const { rows: session } = await db.query(
        `INSERT INTO game_sessions (lobby_id, game_mode, difficulty) VALUES ($1,$2,$3) RETURNING id`,
        [lobbyId, lobby.game_mode, lobby.difficulty]
      );
      const sessionId = session[0].id;

      const { rows: members } = await db.query(
        `SELECT u.id AS "userId", u.username, u.avatar_color
         FROM lobby_members lm JOIN users u ON u.id=lm.user_id WHERE lm.lobby_id=$1`, [lobbyId]);

      for (const m of members) {
        await db.query('INSERT INTO game_players (session_id, user_id, username) VALUES ($1,$2,$3)',
          [sessionId, m.userId, m.username]);
      }

      // Create server-side game engine
      const gs = engine.createGame(sessionId, lobby.difficulty, lobby.game_mode, members);
      activeGames.set(sessionId, gs);

      // Start game loop
      const interval = setInterval(() => {
        const gs = activeGames.get(sessionId);
        if (!gs) { clearInterval(interval); return; }

        engine.tick(gs);

        const snap = engine.getSnapshot(gs);

        // Emit full state to all players in this game
        io.to(`game:${sessionId}`).emit('game:tick', snap);

        // Handle events that need one-time notifications
        if (gs._waveJustStarted) {
          gs._waveJustStarted = false;
          const cfg = { wave: gs.wave };
          io.to(`game:${sessionId}`).emit('game:wave_started', cfg);
        }
        if (gs._waveJustEnded) {
          gs._waveJustEnded = false;
          io.to(`game:${sessionId}`).emit('game:wave_ended', {
            wave: gs.wave, bonus: gs._waveEndBonus,
          });
        }
        if (gs.gameOver && !gs._gameOverEmitted) {
          gs._gameOverEmitted = true;
          clearInterval(interval);
          gameLoops.delete(sessionId);

          // Save to DB and emit game over
          finalizeGame(io, db, sessionId, gs);
        }
      }, 1000 / TICK_RATE);

      gameLoops.set(sessionId, interval);

      await db.query("UPDATE lobbies SET status='in_progress' WHERE id=$1", [lobbyId]);

      io.to(`lobby:${lobbyId}`).emit('game:start', {
        sessionId, mode: lobby.game_mode, difficulty: lobby.difficulty,
        players: members, playerCount: members.length,
      });
    });

    // ── GAME ACTIONS (server-authoritative) ──
    socket.on('game:join', ({ sessionId }) => {
      socket.join(`game:${sessionId}`);
      // Send full state immediately on join
      const gs = activeGames.get(sessionId);
      if (gs) socket.emit('game:tick', engine.getSnapshot(gs));
    });

    socket.on('game:action', ({ sessionId, action, data }) => {
      const gs = activeGames.get(sessionId);
      if (!gs) return socket.emit('game:action_result', { ok:false, err:'no_session' });

      let result;
      switch (action) {
        case 'place_tower':   result = engine.actionPlaceTower(gs, userId, data.type, data.row, data.col); break;
        case 'upgrade_path':  result = engine.actionUpgradePath(gs, userId, data.towerId, data.pi); break;
        case 'sell_tower':    result = engine.actionSellTower(gs, userId, data.towerId); break;
        case 'start_wave':    result = engine.actionStartWave(gs, userId); break;
        default: result = { ok:false, err:'unknown_action' };
      }

      socket.emit('game:action_result', { action, ...result });
    });

    // Solo game: start engine without lobby
    socket.on('game:solo_start', async ({ difficulty }) => {
      const { rows } = await db.query(
        `INSERT INTO game_sessions (lobby_id, game_mode, difficulty) VALUES (NULL,'solo',$1) RETURNING id`,
        [difficulty]
      );
      const sessionId = rows[0].id;
      const gs = engine.createGame(sessionId, difficulty, 'solo', [{
        userId, username, avatar_color: socket.user.avatar_color,
      }]);
      activeGames.set(sessionId, gs);

      const interval = setInterval(() => {
        const gs = activeGames.get(sessionId);
        if (!gs) { clearInterval(interval); return; }
        engine.tick(gs);
        socket.emit('game:tick', engine.getSnapshot(gs));
        if (gs._waveJustStarted) { gs._waveJustStarted = false; }
        if (gs._waveJustEnded)   { gs._waveJustEnded   = false; }
        if (gs.gameOver && !gs._gameOverEmitted) {
          gs._gameOverEmitted = true;
          clearInterval(interval);
          gameLoops.delete(sessionId);
          finalizeGame(io, db, sessionId, gs);
        }
      }, 1000 / TICK_RATE);

      gameLoops.set(sessionId, interval);
      socket.join(`game:${sessionId}`);
      socket.emit('game:solo_started', { sessionId, difficulty });
    });

    // ── DISCONNECT ────────────────────────
    socket.on('disconnect', async () => {
      console.log(`🔌 ${username} disconnected`);
      await db.query('UPDATE users SET online=false, last_seen=NOW() WHERE id=$1', [userId]);
      notifyFollowers(io, db, userId, { event: 'user:offline', userId });
    });
  });
};

// ── HELPERS ──────────────────────────────────────────────
async function finalizeGame(io, db, sessionId, gs) {
  const all = Object.values(gs.players);
  all.sort((a, b) => (b.score||0) - (a.score||0));

  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    await db.query(
      `UPDATE game_players SET status='finished', wave=$1, score=$2, kills=$3, rank=$4, finished_at=NOW()
       WHERE session_id=$5 AND user_id=$6`,
      [gs.wave, p.score||0, p.kills||0, i+1, sessionId, p.userId]
    );
    if (gs.wave > 0) {
      await db.query(
        'INSERT INTO leaderboard (user_id, game_type, score, wave, difficulty, mode) VALUES ($1,$2,$3,$4,$5,$6)',
        [p.userId, 'tower_defense', p.score||0, gs.wave, gs.difficulty, gs.mode]
      ).catch(() => {});
    }
  }
  await db.query("UPDATE game_sessions SET status='finished', ended_at=NOW() WHERE id=$1", [sessionId]);

  io.to(`game:${sessionId}`).emit('game:over', {
    win: gs._gameOverWin,
    rankings: all.map((p, i) => ({ ...p, rank: i+1, wave: gs.wave })),
  });
  activeGames.delete(sessionId);
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
