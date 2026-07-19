'use strict';
const { verifyToken } = require('./auth/verifyToken');
const { registerPlatformHandlers, notifyFollowers } = require('./socket/platform');
const { registerGameHandlers } = require('./socket/game');

module.exports = function setupSocket(io, db) {
  // ── Auth middleware ──────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token
                 || socket.handshake.headers?.authorization?.split(' ')[1];
      socket.user = await verifyToken(token);
      next();
    } catch (e) { next(new Error(e.code || 'token_invalid')); }
  });

  io.on('connection', async (socket) => {
    const { id: userId, username } = socket.user;
    console.log(`🔌 ${username} connected (${socket.id})`);

    socket.join(`user:${userId}`);
    await db.query('UPDATE users SET online=true, last_seen=NOW() WHERE id=$1', [userId]);
    socket.join(`user:${userId}`); // personal room for VS/TA per-player ticks
    notifyFollowers(io, db, userId, { event: 'user:online', userId, username });

    registerPlatformHandlers(io, socket, db);
    registerGameHandlers(io, socket, db);
  });
};
