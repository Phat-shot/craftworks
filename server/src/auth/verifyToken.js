'use strict';
const jwt = require('jsonwebtoken');
const users = require('../repositories/users');

// Shared JWT-verify + user-lookup — previously implemented twice
// independently (middleware/auth.js for REST, socket.js's own io.use()
// handshake middleware), with slightly different column sets and
// mismatched error strings ('invalid_token' vs. 'token_invalid').
async function verifyToken(token) {
  if (!token) {
    const err = new Error('unauthorized');
    err.code = 'unauthorized';
    throw err;
  }
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    const err = new Error('token_invalid');
    err.code = 'token_invalid';
    throw err;
  }
  const user = await users.findById(payload.sub);
  if (!user) {
    const err = new Error('user_not_found');
    err.code = 'user_not_found';
    throw err;
  }
  return user;
}

module.exports = { verifyToken };
