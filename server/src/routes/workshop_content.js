'use strict';
// Workshop content CRUD: buildings, units, custom races
const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const { RACES: BUILTIN_RACES, TDB: BUILTIN_BUILDINGS } = require('../game/towers');
const { EBASE, EBASE_HP } = require('../game/engine');

const router = express.Router();

// Optional auth: attach user if token present, return 200 not 401 when missing
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
const validate = (req, res, next) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
  next();
};

// ═══════════════════════════════════════════════════════════════
//  BUILDINGS (Gebäude)
// ═══════════════════════════════════════════════════════════════

// GET /api/workshop/buildings — own + public
router.get('/buildings', optionalAuth, async (req, res) => {
  const { mine } = req.query;
  try {
    const uid = req.user?.id || null;
    const { rows } = await req.db.query(`
      SELECT b.*, u.username AS creator_name
      FROM workshop_buildings b JOIN users u ON u.id=b.creator_id
      WHERE ($1::uuid IS NOT NULL AND b.creator_id=$1) OR ($2::boolean = false AND b.is_public=true)
      ORDER BY b.updated_at DESC
    `, [uid, mine === 'true']);
    res.json(rows);
  } catch { res.status(500).json({ error: 'db_error' }); }
});

// GET /api/workshop/buildings/builtin — built-in buildings reference
router.get('/buildings/builtin', (req, res) => {
  res.json(Object.entries(BUILTIN_BUILDINGS).map(([id, b]) => ({
    id, name: b.name, cost: b.cost, col: b.col,
    baseRange: b.baseRange, baseCd: b.baseCd, baseDmg: b.baseDmg,
    dmgType: b.dmgType, unlock: b.unlock||0, race: b.race,
    canHitAir: b.canHitAir, icon: b.race === 'universal' ? '⭐' : '🔧',
  })));
});

// POST /api/workshop/buildings
router.post('/buildings', requireAuth,
  body('name').trim().isLength({ min:2, max:64 }),
  body('base_dmg').isNumeric().toInt(),
  body('base_range').isNumeric().toFloat(),
  body('base_cd').isNumeric().toInt(),
  body('cost').isNumeric().toInt(),
  validate,
  async (req, res) => {
    const {
      name, description='', icon='🏰', color='#888888', sprite_type='generic',
      cost, base_range, base_cd, base_dmg, dmg_type='phys',
      unlock_wave=0, can_hit_air=true, flags={}, upgrade_paths=[], is_public=false
    } = req.body;
    try {
      const { rows } = await req.db.query(`
        INSERT INTO workshop_buildings
          (creator_id,name,description,icon,color,sprite_type,cost,base_range,base_cd,base_dmg,
           dmg_type,unlock_wave,can_hit_air,flags,upgrade_paths,is_public)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *
      `, [req.user.id, name, description, icon, color, sprite_type,
          cost, base_range, base_cd, base_dmg, dmg_type, unlock_wave,
          can_hit_air, JSON.stringify(flags), JSON.stringify(upgrade_paths), is_public]);
      res.json(rows[0]);
    } catch { res.status(500).json({ error: 'db_error' }); }
  }
);

// PUT /api/workshop/buildings/:id
router.put('/buildings/:id', requireAuth, async (req, res) => {
  const {
    name, description, icon, color, sprite_type, cost, base_range, base_cd, base_dmg,
    dmg_type, unlock_wave, can_hit_air, flags, upgrade_paths, is_public
  } = req.body;
  try {
    const { rows } = await req.db.query(`
      UPDATE workshop_buildings SET
        name=$1,description=$2,icon=$3,color=$4,sprite_type=$5,cost=$6,base_range=$7,
        base_cd=$8,base_dmg=$9,dmg_type=$10,unlock_wave=$11,can_hit_air=$12,
        flags=$13,upgrade_paths=$14,is_public=$15,updated_at=NOW()
      WHERE id=$16 AND creator_id=$17 RETURNING *
    `, [name, description, icon, color, sprite_type, cost, base_range, base_cd, base_dmg,
        dmg_type, unlock_wave, can_hit_air, JSON.stringify(flags),
        JSON.stringify(upgrade_paths), is_public, req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'db_error' }); }
});

// DELETE /api/workshop/buildings/:id
router.delete('/buildings/:id', requireAuth, async (req, res) => {
  await req.db.query('DELETE FROM workshop_buildings WHERE id=$1 AND creator_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
//  UNITS
// ═══════════════════════════════════════════════════════════════

// GET /api/workshop/units
router.get('/units', optionalAuth, async (req, res) => {
  const { mine } = req.query;
  try {
    const uid2 = req.user?.id || null;
    const { rows } = await req.db.query(`
      SELECT u2.*, u.username AS creator_name
      FROM workshop_units u2 JOIN users u ON u.id=u2.creator_id
      WHERE ($1::uuid IS NOT NULL AND u2.creator_id=$1) OR ($2::boolean = false AND u2.is_public=true)
      ORDER BY u2.created_at DESC
    `, [uid2, mine === 'true']);
    res.json(rows);
  } catch { res.status(500).json({ error: 'db_error' }); }
});

// GET builtin units reference
router.get('/units/builtin', (req, res) => {
  const units = Object.entries(EBASE).map(([id, e]) => ({
    id, name: e.name, col: e.col, szF: e.szF,
    base_hp: EBASE_HP[id], base_speed: e.spdBase, base_reward: e.rewBase,
    is_air: id.startsWith('air_'),
  }));
  res.json(units);
});

// POST /api/workshop/units
router.post('/units', requireAuth,
  body('name').trim().isLength({ min:2, max:64 }),
  body('base_hp').isNumeric().toInt(),
  body('base_speed').isNumeric().toFloat(),
  validate,
  async (req, res) => {
    const {
      name, description='', unit_class='enemy',
      icon='👾', color='#b02810', shape='circle', size_factor=0.26,
      base_hp=100, base_speed=1.5, base_reward=10,
      armor_phys=0, armor_magic=0, is_air=false,
      abilities={}, is_public=false
    } = req.body;
    try {
      const { rows } = await req.db.query(`
        INSERT INTO workshop_units
          (creator_id,name,description,unit_class,icon,color,shape,size_factor,
           base_hp,base_speed,base_reward,armor_phys,armor_magic,is_air,abilities,is_public)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *
      `, [req.user.id, name, description, unit_class, icon, color, shape, size_factor,
          base_hp, base_speed, base_reward, armor_phys, armor_magic, is_air,
          JSON.stringify(abilities), is_public]);
      res.json(rows[0]);
    } catch { res.status(500).json({ error: 'db_error' }); }
  }
);

// PUT /api/workshop/units/:id
router.put('/units/:id', requireAuth, async (req, res) => {
  const { name, description, icon, color, shape, size_factor,
    base_hp, base_speed, base_reward, armor_phys, armor_magic,
    is_air, abilities, is_public } = req.body;
  try {
    const { rows } = await req.db.query(`
      UPDATE workshop_units SET
        name=$1,description=$2,icon=$3,color=$4,shape=$5,size_factor=$6,
        base_hp=$7,base_speed=$8,base_reward=$9,armor_phys=$10,armor_magic=$11,
        is_air=$12,abilities=$13,is_public=$14
      WHERE id=$15 AND creator_id=$16 RETURNING *
    `, [name, description, icon, color, shape, size_factor,
        base_hp, base_speed, base_reward, armor_phys, armor_magic,
        is_air, JSON.stringify(abilities), is_public, req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'db_error' }); }
});

router.delete('/units/:id', requireAuth, async (req, res) => {
  await req.db.query('DELETE FROM workshop_units WHERE id=$1 AND creator_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
//  CUSTOM RACES
// ═══════════════════════════════════════════════════════════════

router.get('/races', optionalAuth, async (req, res) => {
  try {
    const { rows } = await req.db.query(`
      SELECT r.*, u.username AS creator_name
      FROM workshop_races r JOIN users u ON u.id=r.creator_id
      WHERE r.creator_id=$1 OR r.is_public=true
      ORDER BY r.updated_at DESC
    `, [req.user.id]);
    // Merge with builtin
    const builtin = Object.entries(BUILTIN_RACES).map(([id, r]) => ({
      id, ...r, creator_id: null, creator_name: 'System',
      building_ids: [], is_builtin: true, is_public: true,
    }));
    res.json([...builtin, ...rows]);
  } catch { res.status(500).json({ error: 'db_error' }); }
});

router.post('/races', requireAuth,
  body('name').trim().isLength({ min:2, max:64 }),
  validate,
  async (req, res) => {
    const { name, icon='⚔️', color='#888888', description='', building_ids=[], is_public=false } = req.body;
    try {
      const { rows } = await req.db.query(`
        INSERT INTO workshop_races (creator_id,name,icon,color,description,building_ids,is_public)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
      `, [req.user.id, name, icon, color, description, JSON.stringify(building_ids), is_public]);
      res.json(rows[0]);
    } catch { res.status(500).json({ error: 'db_error' }); }
  }
);

router.put('/races/:id', requireAuth, async (req, res) => {
  const { name, icon, color, description, building_ids, is_public } = req.body;
  try {
    const { rows } = await req.db.query(`
      UPDATE workshop_races SET name=$1,icon=$2,color=$3,description=$4,
        building_ids=$5,is_public=$6,updated_at=NOW()
      WHERE id=$7 AND creator_id=$8 RETURNING *
    `, [name, icon, color, description, JSON.stringify(building_ids), is_public, req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch { res.status(500).json({ error: 'db_error' }); }
});

router.delete('/races/:id', requireAuth, async (req, res) => {
  await req.db.query('DELETE FROM workshop_races WHERE id=$1 AND creator_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
