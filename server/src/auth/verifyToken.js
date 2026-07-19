'use strict';
const jwt = require('jsonwebtoken');
const db = require('../db/pool');

// Shared JWT-verify + user-lookup — previously implemented twice
// independently (middleware/auth.js for REST, socket.js's own io.use()
// handshake middleware), with slightly different column sets and
// mismatched error strings ('invalid_token' vs. 'token_invalid').
const USER_FIELDS = 'id, email, username, language, avatar_color, email_verified, is_guest, is_admin';

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
  const { rows } = await db.query(`SELECT ${USER_FIELDS} FROM users WHERE id=$1`, [payload.sub]);
  if (!rows[0]) {
    const err = new Error('user_not_found');
    err.code = 'user_not_found';
    throw err;
  }
  return rows[0];
}

module.exports = { verifyToken };
