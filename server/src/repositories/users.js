'use strict';
// Lightweight data-access layer for the `users` table — not a full ORM,
// just the operations that were previously duplicated as ad-hoc SQL across
// multiple files (backend redesign plan, Phase 6). Started with `users`
// since it's the most-touched entity; other tables stay as direct db.query()
// calls in their respective routes for now.
const db = require('../db/pool');

const PROFILE_FIELDS = 'id, email, username, language, avatar_color, email_verified, is_guest, is_admin';

async function findById(id) {
  const { rows } = await db.query(`SELECT ${PROFILE_FIELDS} FROM users WHERE id=$1`, [id]);
  return rows[0] || null;
}

// Presence tracking — was two independent, identical UPDATE statements
// (socket.js on connect, socket/platform.js on disconnect).
async function setOnline(id, online) {
  await db.query('UPDATE users SET online=$1, last_seen=NOW() WHERE id=$2', [online, id]);
}

module.exports = { findById, setOnline, PROFILE_FIELDS };
