'use strict';
const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const { RACES, TDB, getTowersForRace } = require('../game/towers');

// Middleware: attach user if token present, but don't reject if missing
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      const jwt = require('jsonwebtoken');
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const { rows } = await req.db.query('SELECT id FROM users WHERE id=$1', [payload.sub]);
      if (rows[0]) req.user = rows[0];
    }
  } catch {}
  next();
};
const { getWaveConfig } = require('../game/engine');


const { BUILTIN_MAPS, TA_SEQUENCES } = require('../game/builtin-maps');

const router = express.Router();

// GET /api/workshop/meta — races, tower list, wave defaults
router.get('/meta', optionalAuth, (req, res) => {
  const wavePreviews = [];
  for (let w = 1; w <= 25; w++) {
    try {
      const cfg = getWaveConfig(w, 1.0);
      wavePreviews.push({ wave: w, type: cfg.type, count: cfg.count, isAir: cfg.isAir||false });
    } catch {}
  }
  res.json({ races: RACES, towers: TDB, wavePreviews });
});

// GET /api/workshop/maps — public gallery
router.get('/maps', optionalAuth, async (req, res) => {
  // Public browsing — no auth required, but shows my_rating if logged in
  const { sort = 'newest', search = '', page = 0 } = req.query;
  const limit = 20, offset = +page * limit;
  const orderBy = sort === 'popular' ? 'play_count DESC' :
                  sort === 'rated'   ? '(CASE WHEN rating_count>0 THEN rating_sum::float/rating_count ELSE 0 END) DESC' :
                  'created_at DESC';
  try {
    const { rows } = await req.db.query(`
      SELECT m.*, u.username AS creator_name,
        CASE WHEN m.rating_count > 0 THEN ROUND(m.rating_sum::numeric/m.rating_count, 1) ELSE NULL END AS avg_rating,
        (SELECT rating FROM workshop_ratings WHERE map_id=m.id AND user_id=$3) AS my_rating
      FROM workshop_maps m
      JOIN users u ON u.id = m.creator_id
      WHERE m.is_public = true
        AND ($4 = '' OR m.title ILIKE '%' || $4 || '%')
      ORDER BY ${orderBy}
      LIMIT $1 OFFSET $2
    `, [limit, offset, req.user?.id || null, search]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'db_error' }); }
});

// GET /api/workshop/maps/mine — own maps
router.get('/maps/mine', async (req, res) => {
  // Returns empty array if not authenticated — no redirect
  const userId = req.user?.id;
  if (!userId) return res.json([]);
  try {
    const { rows } = await req.db.query(`
      SELECT m.*,
        CASE WHEN m.rating_count > 0 THEN ROUND(m.rating_sum::numeric/m.rating_count, 1) ELSE NULL END AS avg_rating
      FROM workshop_maps m
      WHERE m.creator_id = $1
      ORDER BY m.updated_at DESC
    `, [userId]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'db_error' }); }
});

// GET /api/workshop/maps/:id
router.get('/maps/builtin', (req, res) => {
  res.json(BUILTIN_MAPS);
});

router.get('/maps/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await req.db.query(`
      SELECT m.*, u.username AS creator_name,
        CASE WHEN m.rating_count > 0 THEN ROUND(m.rating_sum::numeric/m.rating_count,1) ELSE NULL END AS avg_rating,
        (SELECT rating FROM workshop_ratings WHERE map_id=m.id AND user_id=$2) AS my_rating
      FROM workshop_maps m JOIN users u ON u.id=m.creator_id
      WHERE m.id=$1 AND (m.is_public=true OR m.creator_id=$2)
    `, [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'db_error' }); }
});

// POST /api/workshop/maps — create
router.post('/maps', requireAuth,
  body('title').trim().isLength({ min:2, max:64 }),
  body('config').isObject(),
  async (req, res) => {
    if (!validationResult(req).isEmpty()) return res.status(400).json({ error: 'invalid' });
    const { title, description='', game_mode='td', config, is_public=true } = req.body;
    try {
      const { rows } = await req.db.query(`
        INSERT INTO workshop_maps (creator_id, title, description, game_mode, config, is_public,
        game_type, cols, rows, layout_items, prebuilt_sequences)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
      `, [req.user.id, title, description.slice(0,256),
          req.body.game_type||game_mode||'td', JSON.stringify(config), is_public,
          req.body.game_type||'td', req.body.cols||25, req.body.rows||35,
          JSON.stringify(req.body.layout_items||[]), JSON.stringify(req.body.prebuilt_sequences||[])]);
      res.json(rows[0]);
    } catch (e) { res.status(500).json({ error: 'db_error' }); }
  }
);

// PUT /api/workshop/maps/:id — update
router.put('/maps/:id', requireAuth, async (req, res) => {
  const { title, description, config, is_public } = req.body;
  try {
    const { rows } = await req.db.query(`
      UPDATE workshop_maps SET title=$1, description=$2, config=$3, is_public=$4, updated_at=NOW(),
      game_type=COALESCE($7,'td'), cols=COALESCE($8,cols), rows=COALESCE($9,rows),
      layout_items=COALESCE($10,layout_items), prebuilt_sequences=COALESCE($11,prebuilt_sequences)
      WHERE id=$5 AND creator_id=$6 RETURNING *
    `, [title, description, JSON.stringify(config), is_public, req.params.id, req.user.id,
        req.body.game_type||null, req.body.cols||null, req.body.rows||null,
        req.body.layout_items?JSON.stringify(req.body.layout_items):null,
        req.body.prebuilt_sequences?JSON.stringify(req.body.prebuilt_sequences):null]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'db_error' }); }
});

// DELETE /api/workshop/maps/:id
router.delete('/maps/:id', requireAuth, async (req, res) => {
  await req.db.query('DELETE FROM workshop_maps WHERE id=$1 AND creator_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// POST /api/workshop/maps/:id/play — increment play count + start solo game
router.post('/maps/:id/play', requireAuth, async (req, res) => {
  // Builtin map shortcut
  const builtin = BUILTIN_MAPS.find(m => m.id === req.params.id);
  if (builtin) {
    return res.json({ ok:true, workshopConfig: builtin.config, mapId: builtin.id, title: builtin.title, game_mode: builtin.game_mode });
  }
  try {
    const { rows } = await req.db.query(
      'UPDATE workshop_maps SET play_count=play_count+1 WHERE id=$1 AND (is_public=true OR creator_id=$2) RETURNING config',
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json({ config: rows[0].config, mapId: req.params.id });
  } catch (e) { res.status(500).json({ error: 'db_error' }); }
});

// POST /api/workshop/maps/:id/rate
router.post('/maps/:id/rate', requireAuth,
  body('rating').isInt({ min:1, max:5 }),
  async (req, res) => {
    if (!validationResult(req).isEmpty()) return res.status(400).json({ error: 'invalid' });
    try {
      // Upsert rating
      await req.db.query(`
        INSERT INTO workshop_ratings (map_id, user_id, rating) VALUES ($1,$2,$3)
        ON CONFLICT (map_id, user_id) DO UPDATE SET rating=$3
      `, [req.params.id, req.user.id, req.body.rating]);
      // Recalculate
      await req.db.query(`
        UPDATE workshop_maps SET
          rating_sum = (SELECT COALESCE(SUM(rating),0) FROM workshop_ratings WHERE map_id=$1),
          rating_count = (SELECT COUNT(*) FROM workshop_ratings WHERE map_id=$1)
        WHERE id=$1
      `, [req.params.id]);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'db_error' }); }
  }
);

module.exports = router;
