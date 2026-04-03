'use strict';
// Workshop content CRUD: buildings, units, custom races
const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const { RACES: BUILTIN_RACES, TDB: BUILTIN_BUILDINGS } = require('../game/towers');
const { EBASE, EBASE_HP } = require('../game/engine');

const router = express.Router();

const jwt2 = require('jsonwebtoken');
// Optional auth: attach user if token present, return 200 not 401 when missing
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token && req.db) {
      const payload = jwt2.verify(token, process.env.JWT_SECRET);
      const { rows } = await req.db.query('SELECT id FROM users WHERE id=$1', [payload.sub]);
      if (rows[0]) req.user = rows[0];
    }
  } catch {}
  next();
};
const validate = (req, res, next) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) {
    console.error('Validation failed:', JSON.stringify(errs.array()));
    return res.status(400).json({ errors: errs.array(), error: errs.array()[0]?.msg });
  }
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
  body('base_dmg').optional().isNumeric(),
  body('base_range').optional().isNumeric(),
  body('base_cd').optional().isNumeric(),
  body('cost').optional().isNumeric(),
  validate,
  async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'not_authenticated' });
    const {
      name, description='', icon='🏰', color='#888888', sprite_type='generic',
      cost=100, base_range=3.0, base_cd=1000, base_dmg=20, dmg_type='phys',
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
    } catch (e) {
      console.error('Building save error:', e.message);
      res.status(500).json({ error: 'db_error', detail: e.message });
    }
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
  body('base_hp').optional().isNumeric(),
  body('base_speed').optional().isNumeric(),
  validate,
  async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'not_authenticated' });
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
    } catch (e) {
      console.error('Unit save error:', e.message);
      res.status(500).json({ error: 'db_error', detail: e.message });
    }
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
    if (!req.user) return res.status(401).json({ error: 'not_authenticated' });
    const { name, icon='⚔️', color='#888888', description='', building_ids=[], is_public=false } = req.body;
    try {
      const { rows } = await req.db.query(`
        INSERT INTO workshop_races (creator_id,name,icon,color,description,building_ids,is_public)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
      `, [req.user.id, name, icon, color, description, JSON.stringify(building_ids), is_public]);
      res.json(rows[0]);
    } catch (e) {
      console.error('Race save error:', e.message);
      res.status(500).json({ error: 'db_error', detail: e.message });
    }
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

// ═══════════════════════════════════════════════════════════════
//  ABILITIES
// ═══════════════════════════════════════════════════════════════

// Builtin abilities = all upgrade paths of all builtin towers
router.get('/abilities/builtin', (req, res) => {
  const { TDB } = require('../game/towers');
  const abilities = [];
  for (const [towerId, tower] of Object.entries(TDB)) {
    (tower.paths || []).forEach((path, pi) => {
      abilities.push({
        id: `${towerId}_${path.id}`,
        name: path.name,
        icon: path.icon,
        tower: tower.name,
        tower_id: towerId,
        race: tower.race,
        path_index: pi,
        levels: [
          { desc: 'Basis (kein Upgrade)', cost: 0, effects: {} },
          ...path.upgrades.map(u => ({ desc: u.desc, cost: u.cost, effects:
            Object.fromEntries(Object.entries(u).filter(([k])=>!['desc','cost'].includes(k)))
          }))
        ],
        is_builtin: true,
      });
    });
  }
  res.json(abilities);
});

router.get('/abilities', optionalAuth, async (req, res) => {
  try {
    const uid = req.user?.id || null;
    const { rows } = await req.db.query(`
      SELECT a.*, u.username AS creator_name
      FROM workshop_abilities a JOIN users u ON u.id=a.creator_id
      WHERE ($1::uuid IS NOT NULL AND a.creator_id=$1) OR a.is_public=true
      ORDER BY a.updated_at DESC
    `, [uid]);
    res.json(rows);
  } catch (e) { console.error('Abilities GET error:', e.message); res.status(500).json({ error: 'db_error' }); }
});

router.post('/abilities', requireAuth, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'not_authenticated' });
  const { name, description='', icon='⬆️', levels=[], is_public=false } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name_required' });
  try {
    const { rows } = await req.db.query(`
      INSERT INTO workshop_abilities (creator_id,name,description,icon,levels,is_public)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
    `, [req.user.id, name.trim(), description, icon, JSON.stringify(levels), is_public]);
    res.json(rows[0]);
  } catch (e) { console.error('Ability save error:', e.message); res.status(500).json({ error: 'db_error', detail: e.message }); }
});

router.put('/abilities/:id', requireAuth, async (req, res) => {
  const { name, description, icon, levels, is_public } = req.body;
  try {
    const { rows } = await req.db.query(`
      UPDATE workshop_abilities SET name=$1,description=$2,icon=$3,levels=$4,is_public=$5,updated_at=NOW()
      WHERE id=$6 AND creator_id=$7 RETURNING *
    `, [name, description, icon, JSON.stringify(levels), is_public, req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'db_error' }); }
});

router.delete('/abilities/:id', requireAuth, async (req, res) => {
  await req.db.query('DELETE FROM workshop_abilities WHERE id=$1 AND creator_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════
//  WAVE SETS
// ═══════════════════════════════════════════════════════════════

router.get('/wave-sets', optionalAuth, async (req, res) => {
  try {
    const uid = req.user?.id || null;
    const { rows } = await req.db.query(`
      SELECT w.*, u.username AS creator_name
      FROM workshop_wave_sets w JOIN users u ON u.id=w.creator_id
      WHERE ($1::uuid IS NOT NULL AND w.creator_id=$1) OR w.is_public=true
      ORDER BY w.updated_at DESC
    `, [uid]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'db_error' }); }
});

router.post('/wave-sets', requireAuth, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'not_authenticated' });
  const { name, description='', wave_count=25, mode='standard', default_spawn='snake',
    standard={}, waves=[], is_public=false } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name_required' });
  try {
    const { rows } = await req.db.query(`
      INSERT INTO workshop_wave_sets (creator_id,name,description,wave_count,mode,default_spawn,standard,waves,is_public)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [req.user.id, name.trim(), description, wave_count, mode, default_spawn,
        JSON.stringify(standard), JSON.stringify(waves), is_public]);
    res.json(rows[0]);
  } catch (e) { console.error('Wave-set save:', e.message); res.status(500).json({ error: 'db_error', detail: e.message }); }
});

router.put('/wave-sets/:id', requireAuth, async (req, res) => {
  const { name, description, wave_count, mode, default_spawn, standard, waves, is_public } = req.body;
  try {
    const { rows } = await req.db.query(`
      UPDATE workshop_wave_sets SET name=$1,description=$2,wave_count=$3,mode=$4,
        default_spawn=$5,standard=$6,waves=$7,is_public=$8,updated_at=NOW()
      WHERE id=$9 AND creator_id=$10 RETURNING *
    `, [name, description, wave_count||25, mode||'standard', default_spawn||'snake',
        JSON.stringify(standard||{}), JSON.stringify(waves||[]), is_public, req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'db_error' }); }
});

router.delete('/wave-sets/:id', requireAuth, async (req, res) => {
  await req.db.query('DELETE FROM workshop_wave_sets WHERE id=$1 AND creator_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
