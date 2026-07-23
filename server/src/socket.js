'use strict';
const { verifyToken } = require('./auth/verifyToken');
const users = require('./repositories/users');
const { registerPlatformHandlers, notifyFollowers } = require('./socket/platform');
const { registerGameHandlers } = require('./socket/game');
const { registerHuntSandboxHandlers } = require('./socket/hunt');

module.exports = function setupSocket(io, db) {
  // ── Auth middleware ──────────────────────
  // Same distinction as middleware/auth.js's requireAuth (see its comment):
  // only a genuine token/session problem should ever surface as a
  // token-invalid-shaped error here. A DB error (e.g. from verifyToken's
  // internal users.findById on a transient connection/pool problem, no
  // .code set) still has to reject this connection attempt (there's no
  // socket.user to hand downstream handlers without it), but must be
  // labeled honestly instead of 'token_invalid' — the client can't
  // distinguish today, but this keeps the error surface accurate rather
  // than silently lying about why a connection failed.
  const TOKEN_ERROR_CODES = new Set(['unauthorized', 'token_invalid', 'user_not_found']);
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token
                 || socket.handshake.headers?.authorization?.split(' ')[1];
      socket.user = await verifyToken(token);
      next();
    } catch (e) {
      next(new Error(TOKEN_ERROR_CODES.has(e.code) ? e.code : 'server_error'));
    }
  });

  io.on('connection', async (socket) => {
    const { id: userId, username } = socket.user;
    console.log(`🔌 ${username} connected (${socket.id})`);

    socket.join(`user:${userId}`);
    await users.setOnline(userId, true);
    socket.join(`user:${userId}`); // personal room for VS/TA per-player ticks
    notifyFollowers(io, db, userId, { event: 'user:online', userId, username });

    registerPlatformHandlers(io, socket, db);
    registerGameHandlers(io, socket, db);
    registerHuntSandboxHandlers(io, socket, db);
  });
};
