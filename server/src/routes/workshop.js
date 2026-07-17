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


const { BUILTIN_MAPS } = require('../game/data/maps');
const { TA_SEQUENCES } = require('../game/builtin-maps');

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

// GET /api/workshop/maps/:id/export — download map as .craftworks.json
router.get('/maps/:id/export', requireAuth, async (req, res) => {
  try {
    let map;
    // Check builtins first
    const builtin = BUILTIN_MAPS.find(m => m.id === req.params.id);
    if (builtin) {
      map = builtin;
    } else {
      const { rows } = await req.db.query(
        `SELECT m.*, u.username AS creator_name
         FROM workshop_maps m JOIN users u ON u.id=m.creator_id
         WHERE m.id=$1 AND (m.is_public=true OR m.creator_id=$2)`,
        [req.params.id, req.user.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'not_found' });
      map = rows[0];
    }

    // Build complete export bundle
    const bundle = {
      _format: 'craftworks_map_v1',
      _exported_at: new Date().toISOString(),
      _exported_by: req.user?.username || 'unknown',
      // Identity
      id:          map.id,
      title:       map.title,
      icon:        map.icon || '🗺️',
      description: map.description || '',
      game_mode:   map.game_mode,
      difficulty:  map.difficulty || 'normal',
      // Visual assets
      bg_style:         map.bg_style || null,
      path_style:       map.path_style || null,
      bg_texture_url:   map.bg_texture_url || null,
      path_texture_url: map.path_texture_url || null,
      logo_overlay_url: map.logo_overlay_url || null,
      // Skin overrides
      building_skins: map.building_skins || {},
      unit_skins:     map.unit_skins || {},
      // Label overrides
      label_gold:  map.label_gold  || null,
      label_score: map.label_score || null,
      label_lives: map.label_lives || null,
      icon_gold:   map.icon_gold   || null,
      icon_score:  map.icon_score  || null,
      icon_lives:  map.icon_lives  || null,
      // Gameplay
      cols:            map.cols || null,
      rows:            map.rows || null,
      available_races: map.available_races || null,
      renderer:        map.renderer || null,
      // Layout
      layout_items:       map.layout_items       || map.config?.layout_items       || [],
      prebuilt_sequences: map.prebuilt_sequences || map.config?.ta_layout?.prebuilt_sequences || [],
      // Full config blob (for TA layout, round counts etc.)
      config: map.config || null,
    };

    const filename = `${(map.title||'map').replace(/[^a-z0-9]/gi,'_')}.craftworks.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(bundle);
  } catch (e) {
    console.error('[map/export]', e.message);
    res.status(500).json({ error: 'export_failed' });
  }
});

// POST /api/workshop/maps/import — upload .craftworks.json and create map
router.post('/maps/import', requireAuth, async (req, res) => {
  try {
    const bundle = req.body;
    if (!bundle || bundle._format !== 'craftworks_map_v1') {
      return res.status(400).json({ error: 'invalid_format', hint: 'Expected craftworks_map_v1' });
    }

    const {
      title, icon, description, game_mode, difficulty,
      bg_style, path_style, bg_texture_url, path_texture_url, logo_overlay_url,
      building_skins, unit_skins,
      label_gold, label_score, label_lives, icon_gold, icon_score, icon_lives,
      cols, rows, available_races, renderer,
      layout_items, prebuilt_sequences, config,
    } = bundle;

    if (!title || !game_mode) {
      return res.status(400).json({ error: 'missing_fields', required: ['title','game_mode'] });
    }

    // Build merged config (preserve ta_layout, merge sequences back in)
    const mergedConfig = {
      ...(config || {}),
      difficulty: difficulty || 'normal',
      available_races: available_races || config?.available_races || [],
    };
    if (game_mode === 'time_attack' && prebuilt_sequences?.length) {
      mergedConfig.ta_layout = {
        ...(mergedConfig.ta_layout || {}),
        ...(config?.ta_layout || {}),
        prebuilt_sequences,
      };
    }

    const { rows: created } = await req.db.query(`
      INSERT INTO workshop_maps
        (creator_id, title, icon, description, game_mode, difficulty,
         bg_style, path_style, bg_texture_url, path_texture_url, logo_overlay_url,
         building_skins, unit_skins,
         label_gold, label_score, label_lives, icon_gold, icon_score, icon_lives,
         cols, rows, available_races, game_type,
         layout_items, prebuilt_sequences, config, is_public)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,false)
      RETURNING id, title
    `, [
      req.user.id, title, icon||'🗺️', description||'', game_mode, difficulty||'normal',
      bg_style||null, path_style||null, bg_texture_url||null, path_texture_url||null, logo_overlay_url||null,
      JSON.stringify(building_skins||{}), JSON.stringify(unit_skins||{}),
      label_gold||null, label_score||null, label_lives||null,
      icon_gold||null, icon_score||null, icon_lives||null,
      cols||null, rows||null,
      available_races ? JSON.stringify(available_races) : null,
      game_mode,
      JSON.stringify(layout_items||[]),
      JSON.stringify(prebuilt_sequences||[]),
      JSON.stringify(mergedConfig),
    ]);

    res.json({ ok: true, map: created[0] });
  } catch (e) {
    console.error('[map/import]', e.message);
    res.status(500).json({ error: 'import_failed', detail: e.message });
  }
});


module.exports = router;
