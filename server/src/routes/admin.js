'use strict';
// Diagnostic/ops panel — read (and one force-end action) access to live
// users/lobbies/sessions, for tracking down "lobby not found" / stale-
// session reports that are hard to reproduce from a single device's logs
// alone. Admin-gated (requireAdmin, see middleware/auth.js) — grant with
// `UPDATE users SET is_admin=true WHERE email='...';` (see schema.sql).
const express = require('express');
const db = require('../db/pool');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const gameManager = require('../game/game_manager');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/users', async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, username, email, is_guest, is_admin, online, last_seen, created_at
     FROM users ORDER BY last_seen DESC LIMIT 200`
  );
  res.json(rows);
});

// Lobbies + their members + whatever active (unended) game_session each one
// has, cross-checked against the in-memory GameManager — a lobby whose DB
// session has no matching worker (or vice versa) is exactly the kind of
// drift a "lobby not found"/stuck-lobby report would otherwise be invisible
// from the outside.
router.get('/lobbies', async (req, res) => {
  const { rows: lobbies } = await db.query(
    `SELECT l.id, l.name, l.code, l.game_mode, l.status, l.created_at,
            l.host_id, u.username AS host_username, u.online AS host_online,
            (SELECT COUNT(*) FROM lobby_members WHERE lobby_id = l.id) AS member_count
     FROM lobbies l JOIN users u ON u.id = l.host_id
     ORDER BY l.created_at DESC LIMIT 100`
  );
  const ids = lobbies.map(l => l.id);
  const { rows: members } = await db.query(
    `SELECT lm.lobby_id, u.id, u.username, u.online, lm.ready
     FROM lobby_members lm JOIN users u ON u.id = lm.user_id
     WHERE lm.lobby_id = ANY($1::uuid[])`,
    [ids]
  );
  const { rows: sessions } = await db.query(
    `SELECT id, lobby_id, status, started_at
     FROM game_sessions WHERE lobby_id = ANY($1::uuid[]) AND ended_at IS NULL
     ORDER BY started_at DESC`,
    [ids]
  );
  const membersByLobby = {};
  for (const m of members) (membersByLobby[m.lobby_id] ??= []).push(m);
  const sessionByLobby = {};
  for (const s of sessions) if (!sessionByLobby[s.lobby_id]) sessionByLobby[s.lobby_id] = s; // newest first
  res.json(lobbies.map(l => ({
    ...l,
    members: membersByLobby[l.id] || [],
    activeSession: sessionByLobby[l.id]
      ? { ...sessionByLobby[l.id], workerRunning: gameManager.has(sessionByLobby[l.id].id) }
      : null,
  })));
});

// Manual escape hatch for a lobby stuck in a bad state (e.g. workerRunning
// disagrees with the DB, or members can't get lobby:ar_update/lobby:start
// to succeed and restarting the lobby from scratch is faster than tracing
// it further mid-field-test) — ends any live session's worker, marks the
// session finished, and marks the lobby finished so a stale reference to it
// reads as "actually over" instead of silently lingering forever (lobby
// rows are never deleted anywhere in this codebase).
router.post('/lobbies/:id/force-end', async (req, res) => {
  const lobbyId = req.params.id;
  const { rows: sessions } = await db.query(
    `SELECT id FROM game_sessions WHERE lobby_id=$1 AND ended_at IS NULL`, [lobbyId]
  );
  for (const s of sessions) {
    if (gameManager.has(s.id)) gameManager.destroy(s.id);
    await db.query(`UPDATE game_sessions SET status='finished', ended_at=NOW() WHERE id=$1`, [s.id]);
  }
  const { rowCount } = await db.query(
    `UPDATE lobbies SET status='finished' WHERE id=$1`, [lobbyId]
  );
  if (!rowCount) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true, sessionsEnded: sessions.length });
});

module.exports = router;
