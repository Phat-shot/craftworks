const router  = require('express').Router();
const QRCode  = require('qrcode');
const { nanoid } = require('nanoid');
const { requireAuth, requireVerified } = require('../middleware/auth');
const { db }  = require('../index');

// ══ GROUPS ═══════════════════════════════

const groupsRouter = require('express').Router();

function genCode() { return nanoid(8).toUpperCase(); }

// Create group
groupsRouter.post('/', requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name || name.length < 2 || name.length > 64)
    return res.status(400).json({ error: 'invalid_name' });
  let code, tries = 0;
  while (tries++ < 5) {
    code = genCode();
    const { rows } = await db.query('SELECT 1 FROM groups WHERE code=$1', [code]);
    if (!rows[0]) break;
  }
  const { rows } = await db.query(
    'INSERT INTO groups (name, owner_id, code) VALUES ($1,$2,$3) RETURNING *',
    [name, req.user.id, code]
  );
  await db.query(
    "INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'owner')",
    [rows[0].id, req.user.id]
  );
  res.status(201).json(rows[0]);
});

// My groups
groupsRouter.get('/mine', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT g.*, gm.role,
            (SELECT COUNT(*) FROM group_members WHERE group_id=g.id) AS member_count
     FROM groups g JOIN group_members gm ON gm.group_id=g.id
     WHERE gm.user_id=$1 ORDER BY g.created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});

// Join by code
groupsRouter.post('/join/:code', requireAuth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM groups WHERE code=$1', [req.params.code.toUpperCase()]);
  if (!rows[0]) return res.status(404).json({ error: 'group_not_found' });
  const g = rows[0];
  const { rows: count } = await db.query(
    'SELECT COUNT(*) FROM group_members WHERE group_id=$1', [g.id]);
  if (+count[0].count >= g.max_size) return res.status(409).json({ error: 'group_full' });
  await db.query(
    'INSERT INTO group_members (group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [g.id, req.user.id]
  );
  res.json({ ok: true, group: g });
});

// Get QR for group invite
groupsRouter.get('/:id/qr', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    'SELECT g.code FROM groups g JOIN group_members gm ON gm.group_id=g.id WHERE g.id=$1 AND gm.user_id=$2',
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(403).json({ error: 'not_member' });
  const url = `${process.env.APP_URL}/join/group/${rows[0].code}`;
  const qr = await QRCode.toDataURL(url);
  res.json({ qr, code: rows[0].code, url });
});

// Group members
groupsRouter.get('/:id/members', requireAuth, async (req, res) => {
  const { rows: mem } = await db.query(
    'SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2',
    [req.params.id, req.user.id]
  );
  if (!mem[0]) return res.status(403).json({ error: 'not_member' });
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.avatar_color, u.online, gm.role
     FROM group_members gm JOIN users u ON u.id=gm.user_id
     WHERE gm.group_id=$1 ORDER BY gm.joined_at`,
    [req.params.id]
  );
  res.json(rows);
});

// Leave group
groupsRouter.delete('/:id/leave', requireAuth, async (req, res) => {
  await db.query(
    'DELETE FROM group_members WHERE group_id=$1 AND user_id=$2',
    [req.params.id, req.user.id]
  );
  res.json({ ok: true });
});

// ══ LOBBIES ══════════════════════════════

const lobbiesRouter = require('express').Router();

// Create lobby
lobbiesRouter.post('/', requireAuth, async (req, res) => {
  const { name, game_mode = 'classic', difficulty = 'normal', max_players = 4, is_public = true } = req.body;
  if (!name) return res.status(400).json({ error: 'invalid_name' });
  let code, tries = 0;
  while (tries++ < 5) {
    code = genCode();
    const { rows } = await db.query('SELECT 1 FROM lobbies WHERE code=$1', [code]);
    if (!rows[0]) break;
  }
  const { rows } = await db.query(
    `INSERT INTO lobbies (name, game_mode, host_id, code, max_players, difficulty, is_public)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name, game_mode, req.user.id, code, Math.min(+max_players, 8), difficulty, is_public]
  );
  await db.query(
    'INSERT INTO lobby_members (lobby_id, user_id) VALUES ($1,$2)',
    [rows[0].id, req.user.id]
  );
  res.status(201).json(rows[0]);
});

// Public lobbies
lobbiesRouter.get('/public', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT l.*,
            (SELECT COUNT(*) FROM lobby_members WHERE lobby_id=l.id) AS player_count,
            u.username AS host_name
     FROM lobbies l JOIN users u ON u.id=l.host_id
     WHERE l.is_public=true AND l.status='waiting'
     ORDER BY l.created_at DESC LIMIT 50`
  );
  res.json(rows);
});

// Join by code
lobbiesRouter.post('/join/:code', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    "SELECT * FROM lobbies WHERE code=$1 AND status='waiting'",
    [req.params.code.toUpperCase()]
  );
  if (!rows[0]) return res.status(404).json({ error: 'lobby_not_found_or_started' });
  const l = rows[0];
  const { rows: count } = await db.query(
    'SELECT COUNT(*) FROM lobby_members WHERE lobby_id=$1', [l.id]);
  if (+count[0].count >= l.max_players) return res.status(409).json({ error: 'lobby_full' });
  await db.query(
    'INSERT INTO lobby_members (lobby_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [l.id, req.user.id]
  );
  res.json({ ok: true, lobby: l });
});

// QR for lobby
lobbiesRouter.get('/:id/qr', requireAuth, async (req, res) => {
  const { rows } = await db.query('SELECT code FROM lobbies WHERE id=$1 AND host_id=$2',
    [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(403).json({ error: 'not_host' });
  const url = `${process.env.APP_URL}/join/lobby/${rows[0].code}`;
  const qr = await QRCode.toDataURL(url);
  res.json({ qr, code: rows[0].code, url });
});

// Lobby detail + members
lobbiesRouter.get('/:id', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT l.*, u.username AS host_name,
            (SELECT COUNT(*) FROM lobby_members WHERE lobby_id=l.id) AS player_count
     FROM lobbies l JOIN users u ON u.id=l.host_id WHERE l.id=$1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  const { rows: members } = await db.query(
    `SELECT u.id, u.username, u.avatar_color, lm.ready
     FROM lobby_members lm JOIN users u ON u.id=lm.user_id WHERE lm.lobby_id=$1`,
    [req.params.id]
  );
  res.json({ ...rows[0], members });
});

module.exports = { groupsRouter, lobbiesRouter };
