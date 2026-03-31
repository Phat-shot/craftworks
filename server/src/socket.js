const jwt    = require('jsonwebtoken');
const { nanoid } = require('nanoid');

// In-memory game state (per session)
// In production: use Redis for multi-instance scaling
const gameSessions = new Map(); // sessionId -> { players:{}, mode, waveTimers:{} }

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

    // Join personal room
    socket.join(`user:${userId}`);

    // Update online status
    await db.query('UPDATE users SET online=true, last_seen=NOW() WHERE id=$1', [userId]);
    // Notify followers
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
        const payload = {
          id: rows[0].id, sender_id: userId, sender_name: username,
          avatar_color: socket.user.avatar_color, content: msg,
          created_at: rows[0].created_at,
        };
        io.to(`user:${to}`).emit('chat:dm', { ...payload, from: userId });
        socket.emit('chat:dm:sent', payload);
      } catch (e) { console.error('DM error', e); }
    });

    socket.on('chat:group', async ({ groupId, content }) => {
      if (!content?.trim() || !groupId) return;
      // Verify membership
      const { rows: mem } = await db.query(
        'SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2', [groupId, userId]);
      if (!mem[0]) return socket.emit('error', { code: 'not_member' });

      const msg = content.trim().slice(0, 2000);
      const { rows } = await db.query(
        `INSERT INTO messages (sender_id, group_id, content)
         VALUES ($1,$2,$3) RETURNING id, created_at`,
        [userId, groupId, msg]
      );
      const payload = {
        id: rows[0].id, group_id: groupId, sender_id: userId,
        sender_name: username, avatar_color: socket.user.avatar_color,
        content: msg, created_at: rows[0].created_at,
      };
      io.to(`group:${groupId}`).emit('chat:group', payload);
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

    socket.on('group:leave_room', ({ groupId }) => {
      socket.leave(`group:${groupId}`);
    });

    // ── LOBBY ─────────────────────────────
    socket.on('lobby:join', async ({ lobbyId }) => {
      const { rows } = await db.query(
        `SELECT l.*, lm.user_id IS NOT NULL AS is_member
         FROM lobbies l
         LEFT JOIN lobby_members lm ON lm.lobby_id=l.id AND lm.user_id=$2
         WHERE l.id=$1`, [lobbyId, userId]);
      if (!rows[0] || !rows[0].is_member)
        return socket.emit('error', { code: 'not_in_lobby' });
      socket.join(`lobby:${lobbyId}`);
      // Send current members to joiner
      const { rows: members } = await db.query(
        `SELECT u.id, u.username, u.avatar_color, lm.ready
         FROM lobby_members lm JOIN users u ON u.id=lm.user_id WHERE lm.lobby_id=$1`,
        [lobbyId]
      );
      socket.emit('lobby:state', { members });
      socket.to(`lobby:${lobbyId}`).emit('lobby:player_joined', {
        userId, username, avatar_color: socket.user.avatar_color, ready: false
      });
    });

    socket.on('lobby:ready', async ({ lobbyId, ready }) => {
      await db.query(
        'UPDATE lobby_members SET ready=$1 WHERE lobby_id=$2 AND user_id=$3',
        [ready, lobbyId, userId]
      );
      io.to(`lobby:${lobbyId}`).emit('lobby:player_ready', { userId, ready });
      await checkLobbyAllReady(io, db, lobbyId);
    });

    socket.on('lobby:leave', async ({ lobbyId }) => {
      await db.query(
        'DELETE FROM lobby_members WHERE lobby_id=$1 AND user_id=$2', [lobbyId, userId]);
      socket.leave(`lobby:${lobbyId}`);
      io.to(`lobby:${lobbyId}`).emit('lobby:player_left', { userId, username });
      // If host left, transfer or close
      const { rows } = await db.query(
        'SELECT host_id FROM lobbies WHERE id=$1', [lobbyId]);
      if (rows[0]?.host_id === userId) {
        const { rows: members } = await db.query(
          'SELECT user_id FROM lobby_members WHERE lobby_id=$1 LIMIT 1', [lobbyId]);
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
      if (!rows[0] || rows[0].host_id !== userId)
        return socket.emit('error', { code: 'not_host' });
      const lobby = rows[0];

      // Create game session
      const { rows: session } = await db.query(
        `INSERT INTO game_sessions (lobby_id, game_mode, difficulty)
         VALUES ($1,$2,$3) RETURNING id`,
        [lobbyId, lobby.game_mode, lobby.difficulty]
      );
      const sessionId = session[0].id;

      // Get all members
      const { rows: members } = await db.query(
        `SELECT u.id, u.username, u.avatar_color
         FROM lobby_members lm JOIN users u ON u.id=lm.user_id WHERE lm.lobby_id=$1`,
        [lobbyId]
      );

      // Insert game_players rows
      for (const m of members) {
        await db.query(
          'INSERT INTO game_players (session_id, user_id, username) VALUES ($1,$2,$3)',
          [sessionId, m.id, m.username]
        );
      }

      // Init in-memory session
      const playerMap = {};
      members.forEach(m => {
        playerMap[m.id] = { userId: m.id, username: m.username,
          avatar_color: m.avatar_color, wave: 0, lives: 50, score: 0, kills: 0,
          status: 'playing', waveFinishedAt: null };
      });
      gameSessions.set(sessionId, {
        sessionId, lobbyId, mode: lobby.game_mode, difficulty: lobby.difficulty,
        players: playerMap, waveTimers: {},
      });

      await db.query("UPDATE lobbies SET status='in_progress' WHERE id=$1", [lobbyId]);

      // Notify all lobby members
      io.to(`lobby:${lobbyId}`).emit('game:start', {
        sessionId, mode: lobby.game_mode, difficulty: lobby.difficulty,
        players: members, playerCount: members.length,
      });
    });

    // ── GAME EVENTS ───────────────────────
    socket.on('game:join', ({ sessionId }) => {
      socket.join(`game:${sessionId}`);
    });

    socket.on('game:state_update', ({ sessionId, wave, lives, score, kills }) => {
      const session = gameSessions.get(sessionId);
      if (!session || !session.players[userId]) return;
      const player = session.players[userId];
      player.wave  = wave  ?? player.wave;
      player.lives = lives ?? player.lives;
      player.score = score ?? player.score;
      player.kills = kills ?? player.kills;
      // Broadcast to all players in this game
      io.to(`game:${sessionId}`).emit('game:player_update', {
        userId, wave: player.wave, lives: player.lives,
        score: player.score, kills: player.kills, status: player.status,
      });
    });

    socket.on('game:wave_finished', async ({ sessionId, wave }) => {
      const session = gameSessions.get(sessionId);
      if (!session || !session.players[userId]) return;
      const player = session.players[userId];
      player.wave = wave;
      player.waveFinishedAt = Date.now();

      io.to(`game:${sessionId}`).emit('game:player_wave_done', { userId, username, wave });

      // Handle wave start logic per mode
      if (session.mode === 'classic') {
        // All must finish before next wave starts — check if all done
        const playing = Object.values(session.players).filter(p => p.status === 'playing');
        const allDone = playing.every(p => p.wave >= wave || p.status !== 'playing');
        if (allDone) {
          io.to(`game:${sessionId}`).emit('game:wave_start', { wave: wave + 1 });
        }
      } else if (session.mode === 'tournament') {
        // 15s timer per player after their wave finish
        if (session.waveTimers[userId]) clearTimeout(session.waveTimers[userId]);
        session.waveTimers[userId] = setTimeout(() => {
          io.to(`user:${userId}`).emit('game:wave_start', { wave: wave + 1, auto: true });
          delete session.waveTimers[userId];
        }, 15_000);
      }
      // chaos mode: handled purely client-side with auto-start

      // Update DB
      await db.query(
        'UPDATE game_players SET wave=$1, score=$2, kills=$3 WHERE session_id=$4 AND user_id=$5',
        [wave, player.score, player.kills, sessionId, userId]
      );
    });

    socket.on('game:died', async ({ sessionId, score, wave, kills }) => {
      const session = gameSessions.get(sessionId);
      if (!session || !session.players[userId]) return;
      const player = session.players[userId];
      player.status = 'dead';
      player.score = score; player.wave = wave; player.kills = kills;

      await db.query(
        "UPDATE game_players SET status='dead', wave=$1, score=$2, kills=$3, finished_at=NOW() WHERE session_id=$4 AND user_id=$5",
        [wave, score, kills, sessionId, userId]
      );
      io.to(`game:${sessionId}`).emit('game:player_died', { userId, username, wave, score });
      await checkGameFinished(io, db, sessionId, session);
    });

    socket.on('game:finished', async ({ sessionId, score, wave, kills }) => {
      const session = gameSessions.get(sessionId);
      if (!session || !session.players[userId]) return;
      const player = session.players[userId];
      player.status = 'finished';
      player.score = score; player.wave = wave; player.kills = kills;

      await db.query(
        "UPDATE game_players SET status='finished', wave=$1, score=$2, kills=$3, finished_at=NOW() WHERE session_id=$4 AND user_id=$5",
        [wave, score, kills, sessionId, userId]
      );
      io.to(`game:${sessionId}`).emit('game:player_finished', { userId, username, wave, score });

      // Save to leaderboard
      await db.query(
        'INSERT INTO leaderboard (user_id, game_type, score, wave, difficulty, mode) VALUES ($1,$2,$3,$4,$5,$6)',
        [userId, 'tower_defense', score, wave, session.difficulty, session.mode]
      );

      await checkGameFinished(io, db, sessionId, session);
    });

    // ── DISCONNECT ────────────────────────
    socket.on('disconnect', async () => {
      console.log(`🔌 ${username} disconnected`);
      await db.query('UPDATE users SET online=false, last_seen=NOW() WHERE id=$1', [userId]);
      notifyFollowers(io, db, userId, { event: 'user:offline', userId });
    });
  });
};

// ── HELPERS ──────────────────────────────

async function checkLobbyAllReady(io, db, lobbyId) {
  const { rows } = await db.query(
    'SELECT COUNT(*) FILTER (WHERE NOT ready) AS not_ready, COUNT(*) AS total FROM lobby_members WHERE lobby_id=$1',
    [lobbyId]
  );
  if (+rows[0].total >= 2 && +rows[0].not_ready === 0) {
    io.to(`lobby:${lobbyId}`).emit('lobby:all_ready');
  }
}

async function checkGameFinished(io, db, sessionId, session) {
  const playing = Object.values(session.players).filter(p => p.status === 'playing');
  if (playing.length > 0) return; // still someone playing

  // All done — determine winner
  const all = Object.values(session.players);
  all.sort((a, b) => {
    if (a.status === 'finished' && b.status !== 'finished') return -1;
    if (b.status === 'finished' && a.status !== 'finished') return 1;
    if (b.wave !== a.wave) return b.wave - a.wave;
    return b.score - a.score;
  });

  // Assign ranks & save
  for (let i = 0; i < all.length; i++) {
    await db.query(
      'UPDATE game_players SET rank=$1, status=CASE WHEN status=\'playing\' THEN \'finished\' ELSE status END WHERE session_id=$2 AND user_id=$3',
      [i+1, sessionId, all[i].userId]
    );
  }
  await db.query("UPDATE game_sessions SET status='finished', ended_at=NOW() WHERE id=$1", [sessionId]);

  io.to(`game:${sessionId}`).emit('game:over', {
    winner: all[0],
    rankings: all.map((p, i) => ({ ...p, rank: i+1 })),
  });

  // Cleanup
  gameSessions.delete(sessionId);
}

async function notifyFollowers(io, db, userId, payload) {
  try {
    const { rows } = await db.query(
      'SELECT follower_id FROM follows WHERE following_id=$1', [userId]);
    rows.forEach(r => io.to(`user:${r.follower_id}`).emit(payload.event, payload));
  } catch {}
}
