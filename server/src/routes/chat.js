const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { db } = require('../index');

// ── DM HISTORY ───────────────────────────
router.get('/dm/:userId', requireAuth, async (req, res) => {
  const { before, limit = 50 } = req.query;
  const vals = [req.user.id, req.params.userId, Math.min(+limit, 100)];
  let extra = '';
  if (before) { vals.push(before); extra = `AND m.created_at < $${vals.length}`; }

  const { rows } = await db.query(
    `SELECT m.id, m.sender_id, m.content, m.created_at, m.read,
            u.username AS sender_name, u.avatar_color
     FROM messages m JOIN users u ON u.id=m.sender_id
     WHERE ((m.sender_id=$1 AND m.recipient_id=$2)
         OR (m.sender_id=$2 AND m.recipient_id=$1))
         ${extra}
     ORDER BY m.created_at DESC LIMIT $3`,
    vals
  );
  // Mark as read
  await db.query(
    `UPDATE messages SET read=true
     WHERE recipient_id=$1 AND sender_id=$2 AND read=false`,
    [req.user.id, req.params.userId]
  );
  res.json(rows.reverse());
});

// ── GROUP CHAT HISTORY ───────────────────
router.get('/group/:groupId', requireAuth, async (req, res) => {
  // Check membership
  const { rows: mem } = await db.query(
    'SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2',
    [req.params.groupId, req.user.id]
  );
  if (!mem[0]) return res.status(403).json({ error: 'not_member' });

  const { before, limit = 50 } = req.query;
  const vals = [req.params.groupId, Math.min(+limit, 100)];
  let extra = '';
  if (before) { vals.push(before); extra = `AND m.created_at < $${vals.length}`; }

  const { rows } = await db.query(
    `SELECT m.id, m.sender_id, m.content, m.created_at,
            u.username AS sender_name, u.avatar_color
     FROM messages m JOIN users u ON u.id=m.sender_id
     WHERE m.group_id=$1 ${extra}
     ORDER BY m.created_at DESC LIMIT $2`,
    vals
  );
  res.json(rows.reverse());
});

// ── UNREAD COUNTS ────────────────────────
router.get('/unread', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT sender_id, COUNT(*) AS count
     FROM messages
     WHERE recipient_id=$1 AND read=false
     GROUP BY sender_id`,
    [req.user.id]
  );
  const map = {};
  rows.forEach(r => { map[r.sender_id] = +r.count; });
  res.json(map);
});

// ── CONVERSATIONS LIST ────────────────────
router.get('/conversations', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (other_id)
            other_id,
            u.username AS other_name,
            u.avatar_color,
            u.online,
            m.content AS last_message,
            m.created_at,
            (SELECT COUNT(*) FROM messages
             WHERE recipient_id=$1 AND sender_id=other_id AND read=false) AS unread
     FROM (
       SELECT CASE WHEN sender_id=$1 THEN recipient_id ELSE sender_id END AS other_id,
              id, content, created_at
       FROM messages
       WHERE (sender_id=$1 OR recipient_id=$1) AND group_id IS NULL
       ORDER BY created_at DESC
     ) m
     JOIN users u ON u.id=m.other_id
     ORDER BY other_id, m.created_at DESC`,
    [req.user.id]
  );
  res.json(rows);
});

module.exports = router;
