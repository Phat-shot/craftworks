const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { db } = require('../index');

// ── ME ───────────────────────────────────
router.get('/me', requireAuth, (req, res) => res.json(req.user));

router.patch('/me', requireAuth, async (req, res) => {
  const { username, avatar_color, language } = req.body;
  const fields = [], vals = [];
  if (username)     { fields.push(`username=$${vals.push(username)}`); }
  if (avatar_color) { fields.push(`avatar_color=$${vals.push(avatar_color)}`); }
  if (language)     { fields.push(`language=$${vals.push(language)}`); }
  if (!fields.length) return res.status(400).json({ error: 'nothing_to_update' });
  vals.push(req.user.id);
  try {
    const { rows } = await db.query(
      `UPDATE users SET ${fields.join(',')} WHERE id=$${vals.length} RETURNING id,username,avatar_color,language`,
      vals
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.constraint === 'users_username_key') return res.status(409).json({ error: 'username_taken' });
    res.status(500).json({ error: 'server_error' });
  }
});

// ── SEARCH USERS ─────────────────────────
router.get('/search', requireAuth, async (req, res) => {
  const { q } = req.query;
  if (!q || q.length < 2) return res.json([]);
  const { rows } = await db.query(
    `SELECT id, username, avatar_color, online FROM users
     WHERE username ILIKE $1 AND id <> $2 AND is_guest=false
     ORDER BY similarity(username,$3) DESC LIMIT 10`,
    [`%${q}%`, req.user.id, q]
  );
  res.json(rows);
});

// ── PUBLIC PROFILE ───────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.avatar_color, u.online, u.last_seen,
            (SELECT COUNT(*) FROM follows WHERE follower_id=u.id) AS following_count,
            (SELECT COUNT(*) FROM follows WHERE following_id=u.id) AS followers_count,
            EXISTS(SELECT 1 FROM follows WHERE follower_id=$2 AND following_id=u.id) AS is_following
     FROM users u WHERE u.id=$1`,
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  res.json(rows[0]);
});

// ── FOLLOW / UNFOLLOW ────────────────────
router.post('/:id/follow', requireAuth, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'cannot_follow_self' });
  try {
    await db.query(
      'INSERT INTO follows (follower_id, following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.user.id, req.params.id]
    );
    res.json({ following: true });
  } catch { res.status(500).json({ error: 'server_error' }); }
});

router.delete('/:id/follow', requireAuth, async (req, res) => {
  await db.query(
    'DELETE FROM follows WHERE follower_id=$1 AND following_id=$2',
    [req.user.id, req.params.id]
  );
  res.json({ following: false });
});

// ── FOLLOWING LIST ────────────────────────
router.get('/me/following', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.avatar_color, u.online
     FROM follows f JOIN users u ON u.id=f.following_id
     WHERE f.follower_id=$1 ORDER BY f.created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});

// ── LEADERBOARD ──────────────────────────
router.get('/leaderboard/:game_type', requireAuth, async (req, res) => {
  const { game_type } = req.params;
  const { difficulty } = req.query;
  const vals = [game_type];
  let extra = '';
  if (difficulty) { vals.push(difficulty); extra = `AND l.difficulty=$${vals.length}`; }

  const { rows } = await db.query(
    `SELECT DISTINCT ON (l.user_id)
            u.username, u.avatar_color,
            l.score, l.wave, l.difficulty, l.mode, l.played_at
     FROM leaderboard l JOIN users u ON u.id=l.user_id
     WHERE l.game_type=$1 ${extra}
     ORDER BY l.user_id, l.score DESC
     LIMIT 50`,
    vals
  );
  // sort by score
  rows.sort((a,b) => b.score - a.score);
  res.json(rows.map((r,i) => ({ ...r, rank: i+1 })));
});

module.exports = router;
