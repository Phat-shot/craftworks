// routes/games.js
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { db } = require('../index');

// Game history for current user
router.get('/history', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT gs.id, gs.game_mode, gs.difficulty, gs.status, gs.started_at, gs.ended_at,
            gp.wave, gp.score, gp.kills, gp.status AS player_status, gp.rank
     FROM game_players gp JOIN game_sessions gs ON gs.id=gp.session_id
     WHERE gp.user_id=$1 ORDER BY gs.started_at DESC LIMIT 20`,
    [req.user.id]
  );
  res.json(rows);
});

// Session detail (for replay/spectate)
router.get('/:sessionId', requireAuth, async (req, res) => {
  const { rows } = await db.query(
    `SELECT gs.*, json_agg(json_build_object(
       'user_id', gp.user_id, 'username', gp.username,
       'wave', gp.wave, 'score', gp.score, 'kills', gp.kills,
       'status', gp.status, 'rank', gp.rank
     ) ORDER BY gp.rank NULLS LAST) AS players
     FROM game_sessions gs JOIN game_players gp ON gp.session_id=gs.id
     WHERE gs.id=$1 GROUP BY gs.id`,
    [req.params.sessionId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  res.json(rows[0]);
});

module.exports = router;
