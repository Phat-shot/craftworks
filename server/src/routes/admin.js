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

// Dashboard for the Sessions tab (Admin.jsx): active + recent + a 24h
// summary in one call, matching the existing 5s-polling Promise.all
// convention the client already uses for /lobbies + /users.
router.get('/sessions', async (req, res) => {
  const { rows: active } = await db.query(
    `SELECT gs.id, gs.lobby_id, gs.game_mode, gs.status, gs.started_at,
            l.name AS lobby_name, l.code AS lobby_code
     FROM game_sessions gs LEFT JOIN lobbies l ON l.id = gs.lobby_id
     WHERE gs.ended_at IS NULL ORDER BY gs.started_at DESC`
  );
  const { rows: recent } = await db.query(
    `SELECT gs.id, gs.lobby_id, gs.game_mode, gs.status, gs.started_at, gs.ended_at,
            l.name AS lobby_name, l.code AS lobby_code
     FROM game_sessions gs LEFT JOIN lobbies l ON l.id = gs.lobby_id
     WHERE gs.ended_at IS NOT NULL ORDER BY gs.ended_at DESC LIMIT 50`
  );
  const { rows: byStatus } = await db.query(
    `SELECT status, COUNT(*)::int AS count FROM game_sessions
     WHERE started_at >= NOW() - INTERVAL '24 hours' GROUP BY status`
  );
  const { rows: byMode } = await db.query(
    `SELECT game_mode, COUNT(*)::int AS count FROM game_sessions
     WHERE started_at >= NOW() - INTERVAL '24 hours' GROUP BY game_mode`
  );
  res.json({
    active: active.map(s => ({ ...s, workerRunning: gameManager.has(s.id) })),
    recent,
    last24h: { total: byStatus.reduce((s, r) => s + r.count, 0), byStatus, byMode },
  });
});

// Granular pendant to /lobbies/:id/force-end — kills exactly one session
// instead of every unended session on its lobby (a lobby only ever has one
// live session at a time in practice, but this is the right primitive for
// a session-scoped dashboard row).
router.post('/sessions/:id/kill', async (req, res) => {
  const sessionId = req.params.id;
  const { rows } = await db.query(
    `SELECT id, lobby_id FROM game_sessions WHERE id=$1 AND ended_at IS NULL`, [sessionId]
  );
  const session = rows[0];
  if (!session) return res.status(404).json({ error: 'not_found' });
  if (gameManager.has(sessionId)) gameManager.destroy(sessionId);
  await db.query(`UPDATE game_sessions SET status='finished', ended_at=NOW() WHERE id=$1`, [sessionId]);
  if (session.lobby_id) {
    await db.query(`UPDATE lobbies SET status='finished' WHERE id=$1`, [session.lobby_id]);
  }
  res.json({ ok: true });
});

// Real DELETE, not a soft-deactivate — every FK from other tables to
// users(id) is already ON DELETE CASCADE or ON DELETE SET NULL in
// schema.sql (refresh_tokens, lobby_members, game_players, lobbies.host_id,
// leaderboard, consent_log, ...), so this alone fully removes the account
// and everything it owns. Works for guest accounts too (same users row
// shape, just is_guest=true). Two guards: can't delete your own account
// through this route, and can't delete the last remaining admin (would
// lock the whole admin area out with no way back in short of a manual
// DB UPDATE).
router.delete('/users/:id', async (req, res) => {
  const targetId = req.params.id;
  if (targetId === req.user.id) return res.status(400).json({ error: 'cannot_delete_self' });
  const { rows } = await db.query('SELECT is_admin FROM users WHERE id=$1', [targetId]);
  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  if (rows[0].is_admin) {
    const { rows: adminCount } = await db.query('SELECT COUNT(*)::int AS n FROM users WHERE is_admin=true');
    if (adminCount[0].n <= 1) return res.status(400).json({ error: 'cannot_delete_last_admin' });
  }
  await db.query('DELETE FROM users WHERE id=$1', [targetId]);
  res.json({ ok: true });
});

// Grant or revoke admin — the "can authorize further accounts" half of the
// bootstrap story (see auth.js's /register, which auto-grants the first
// admin when none exists yet; every admin after that is set here). Same
// last-admin guard as delete: revoking the only remaining admin would be a
// self-inflicted lockout with no in-app way to recover.
router.post('/users/:id/set-admin', async (req, res) => {
  const targetId = req.params.id;
  const isAdmin = req.body?.isAdmin === true;
  if (!isAdmin) {
    const { rows } = await db.query('SELECT is_admin FROM users WHERE id=$1', [targetId]);
    if (rows[0]?.is_admin) {
      const { rows: adminCount } = await db.query('SELECT COUNT(*)::int AS n FROM users WHERE is_admin=true');
      if (adminCount[0].n <= 1) return res.status(400).json({ error: 'cannot_revoke_last_admin' });
    }
  }
  const { rowCount } = await db.query('UPDATE users SET is_admin=$1 WHERE id=$2', [isAdmin, targetId]);
  if (!rowCount) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

module.exports = router;
