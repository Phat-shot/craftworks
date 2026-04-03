'use strict';
const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const QRCode   = require('qrcode');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── File upload setup ─────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '../../../uploads/brands');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(file.originalname);
    cb(ok ? null : new Error('Invalid file type'), ok);
  },
});

// ── Helper: check brand membership ───────────────────────────
async function requireBrandMember(req, res, brandId) {
  const { rows } = await req.db.query(
    `SELECT role FROM brand_members WHERE brand_id=$1 AND user_id=$2`,
    [brandId, req.user.id]
  );
  if (!rows[0]) { res.status(403).json({ error: 'not_brand_member' }); return null; }
  return rows[0].role;
}

function assetUrl(req, filename) {
  return `${req.protocol}://${req.get('host')}/uploads/brands/${filename}`;
}

// ═══════════════════════════════════════════════════════════════
//  BRANDS
// ═══════════════════════════════════════════════════════════════

// GET /api/brands — brands I belong to
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await req.db.query(`
      SELECT b.*, bm.role FROM brands b
      JOIN brand_members bm ON bm.brand_id=b.id
      WHERE bm.user_id=$1 AND b.is_active=true
      ORDER BY b.name
    `, [req.user.id]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'db_error' }); }
});

// POST /api/brands (admin-only for now: hardcode or check is_admin flag)
router.post('/', requireAuth, async (req, res) => {
  const { name, slug, primary_color='#3060c0', secondary_color='#e0a020',
    website_url, contact_email } = req.body;
  if (!name?.trim() || !slug?.trim()) return res.status(400).json({ error: 'missing_fields' });
  try {
    const { rows } = await req.db.query(`
      INSERT INTO brands (name,slug,primary_color,secondary_color,website_url,contact_email)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
    `, [name.trim(), slug.toLowerCase().trim(), primary_color, secondary_color, website_url||null, contact_email||null]);
    // Add creator as admin
    await req.db.query('INSERT INTO brand_members (brand_id,user_id,role) VALUES ($1,$2,$3)',
      [rows[0].id, req.user.id, 'admin']);
    res.json(rows[0]);
  } catch(e) {
    if (e.constraint?.includes('unique')) return res.status(409).json({ error: 'slug_taken' });
    res.status(500).json({ error: 'db_error', detail: e.message });
  }
});

// PUT /api/brands/:id
router.put('/:id', requireAuth, async (req, res) => {
  if (!await requireBrandMember(req, res, req.params.id)) return;
  const { name, primary_color, secondary_color, website_url, contact_email } = req.body;
  try {
    const { rows } = await req.db.query(`
      UPDATE brands SET name=$1,primary_color=$2,secondary_color=$3,website_url=$4,contact_email=$5
      WHERE id=$6 RETURNING *
    `, [name, primary_color, secondary_color, website_url, contact_email, req.params.id]);
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'db_error' }); }
});

// POST /api/brands/:id/upload — asset upload
router.post('/:id/upload', requireAuth, upload.single('file'), async (req, res) => {
  if (!await requireBrandMember(req, res, req.params.id)) return;
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  const url = assetUrl(req, req.file.filename);
  try {
    const { rows } = await req.db.query(`
      INSERT INTO brand_assets (brand_id,filename,url,asset_type,size_bytes)
      VALUES ($1,$2,$3,$4,$5) RETURNING *
    `, [req.params.id, req.file.filename, url, req.body.asset_type||'image', req.file.size]);
    res.json({ ...rows[0], url });
  } catch(e) { res.status(500).json({ error: 'db_error' }); }
});

// GET /api/brands/:id/assets
router.get('/:id/assets', requireAuth, async (req, res) => {
  if (!await requireBrandMember(req, res, req.params.id)) return;
  const { rows } = await req.db.query(
    'SELECT * FROM brand_assets WHERE brand_id=$1 ORDER BY created_at DESC',
    [req.params.id]
  );
  res.json(rows);
});

// ═══════════════════════════════════════════════════════════════
//  BRAND MAPS
// ═══════════════════════════════════════════════════════════════

router.get('/:brandId/maps', requireAuth, async (req, res) => {
  if (!await requireBrandMember(req, res, req.params.brandId)) return;
  const { rows } = await req.db.query(
    'SELECT * FROM brand_maps WHERE brand_id=$1 ORDER BY updated_at DESC',
    [req.params.brandId]
  );
  res.json(rows);
});

router.post('/:brandId/maps', requireAuth, async (req, res) => {
  if (!await requireBrandMember(req, res, req.params.brandId)) return;
  const {
    parent_map_id, name,
    bg_texture_url, path_texture_url, start_icon, goal_icon, logo_overlay_url,
    primary_color, label_gold, label_score, label_lives,
    icon_gold, icon_score, icon_lives,
    building_skins={}, unit_skins={}, ability_skins={},
  } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name_required' });
  try {
    const { rows } = await req.db.query(`
      INSERT INTO brand_maps
        (brand_id,parent_map_id,name,bg_texture_url,path_texture_url,start_icon,goal_icon,
         logo_overlay_url,primary_color,label_gold,label_score,label_lives,
         icon_gold,icon_score,icon_lives,building_skins,unit_skins,ability_skins)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *
    `, [req.params.brandId, parent_map_id||null, name.trim(),
        bg_texture_url||null, path_texture_url||null, start_icon||null, goal_icon||null,
        logo_overlay_url||null, primary_color||null,
        label_gold||null, label_score||null, label_lives||null,
        icon_gold||null, icon_score||null, icon_lives||null,
        JSON.stringify(building_skins), JSON.stringify(unit_skins), JSON.stringify(ability_skins)]);
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'db_error', detail: e.message }); }
});

router.put('/:brandId/maps/:id', requireAuth, async (req, res) => {
  if (!await requireBrandMember(req, res, req.params.brandId)) return;
  const {
    name, bg_texture_url, path_texture_url, start_icon, goal_icon, logo_overlay_url,
    primary_color, label_gold, label_score, label_lives,
    icon_gold, icon_score, icon_lives, building_skins, unit_skins, ability_skins,
  } = req.body;
  try {
    const { rows } = await req.db.query(`
      UPDATE brand_maps SET name=$1,bg_texture_url=$2,path_texture_url=$3,start_icon=$4,
        goal_icon=$5,logo_overlay_url=$6,primary_color=$7,label_gold=$8,label_score=$9,
        label_lives=$10,icon_gold=$11,icon_score=$12,icon_lives=$13,
        building_skins=$14,unit_skins=$15,ability_skins=$16,updated_at=NOW()
      WHERE id=$17 AND brand_id=$18 RETURNING *
    `, [name, bg_texture_url||null, path_texture_url||null, start_icon||null, goal_icon||null,
        logo_overlay_url||null, primary_color||null,
        label_gold||null, label_score||null, label_lives||null,
        icon_gold||null, icon_score||null, icon_lives||null,
        JSON.stringify(building_skins||{}), JSON.stringify(unit_skins||{}),
        JSON.stringify(ability_skins||{}), req.params.id, req.params.brandId]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'db_error' }); }
});

// ═══════════════════════════════════════════════════════════════
//  CHALLENGES
// ═══════════════════════════════════════════════════════════════

router.get('/:brandId/challenges', requireAuth, async (req, res) => {
  if (!await requireBrandMember(req, res, req.params.brandId)) return;
  const { rows } = await req.db.query(
    'SELECT * FROM challenges WHERE brand_id=$1 ORDER BY start_at DESC',
    [req.params.brandId]
  );
  res.json(rows);
});

router.post('/:brandId/challenges', requireAuth, async (req, res) => {
  if (!await requireBrandMember(req, res, req.params.brandId)) return;
  const {
    brand_map_id, title, description,
    start_at, end_at,
    prizes=[], top_winners=3, lottery_count=0,
    score_metric='score', max_entries_per_user=3,
    require_email=true, newsletter_opt_in_text,
  } = req.body;
  if (!title?.trim() || !start_at || !end_at)
    return res.status(400).json({ error: 'missing_fields' });
  try {
    const { rows } = await req.db.query(`
      INSERT INTO challenges
        (brand_id,brand_map_id,title,description,start_at,end_at,prizes,
         top_winners,lottery_count,score_metric,max_entries_per_user,
         require_email,newsletter_opt_in_text)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *
    `, [req.params.brandId, brand_map_id||null, title.trim(), description||null,
        start_at, end_at, JSON.stringify(prizes),
        top_winners, lottery_count, score_metric, max_entries_per_user,
        require_email, newsletter_opt_in_text||null]);
    const ch = rows[0];

    // Generate QR code with challenge link
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const link = `${baseUrl}/challenge/${ch.share_token}`;
    const qrPath = path.join(UPLOAD_DIR, `qr_${ch.id}.png`);
    await QRCode.toFile(qrPath, link, {
      color: { dark: req.body.primary_color||'#1a1a2e', light: '#ffffff' },
      width: 400, margin: 2,
    });
    const qrUrl = `${baseUrl}/uploads/brands/qr_${ch.id}.png`;
    await req.db.query('UPDATE challenges SET qr_code_url=$1 WHERE id=$2', [qrUrl, ch.id]);
    ch.qr_code_url = qrUrl;
    ch.link = link;
    res.json(ch);
  } catch(e) { res.status(500).json({ error: 'db_error', detail: e.message }); }
});

router.put('/:brandId/challenges/:id', requireAuth, async (req, res) => {
  if (!await requireBrandMember(req, res, req.params.brandId)) return;
  const { title, description, start_at, end_at, prizes, top_winners,
    lottery_count, score_metric, max_entries_per_user, require_email,
    newsletter_opt_in_text, is_active } = req.body;
  try {
    const { rows } = await req.db.query(`
      UPDATE challenges SET title=$1,description=$2,start_at=$3,end_at=$4,
        prizes=$5,top_winners=$6,lottery_count=$7,score_metric=$8,
        max_entries_per_user=$9,require_email=$10,newsletter_opt_in_text=$11,is_active=$12
      WHERE id=$13 AND brand_id=$14 RETURNING *
    `, [title, description, start_at, end_at, JSON.stringify(prizes||[]),
        top_winners||3, lottery_count||0, score_metric||'score',
        max_entries_per_user||3, require_email, newsletter_opt_in_text,
        is_active??true, req.params.id, req.params.brandId]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'db_error' }); }
});

// GET /api/brands/challenge/:token — public, resolve challenge by share token
router.get('/challenge/:token', async (req, res) => {
  try {
    const { rows } = await req.db.query(`
      SELECT c.*, b.name AS brand_name, b.logo_url, b.primary_color AS brand_color,
        bm.name AS map_name, bm.label_gold, bm.label_score, bm.label_lives,
        bm.icon_gold, bm.icon_score, bm.icon_lives,
        bm.bg_texture_url, bm.path_texture_url, bm.start_icon, bm.goal_icon,
        bm.logo_overlay_url, bm.building_skins, bm.unit_skins, bm.parent_map_id
      FROM challenges c
      JOIN brands b ON b.id=c.brand_id
      LEFT JOIN brand_maps bm ON bm.id=c.brand_map_id
      WHERE c.share_token=$1 AND c.is_active=true
    `, [req.params.token]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    const ch = rows[0];
    const now = new Date();
    ch.status = now < new Date(ch.start_at) ? 'upcoming'
              : now > new Date(ch.end_at)   ? 'ended'
              : 'active';
    res.json(ch);
  } catch(e) { res.status(500).json({ error: 'db_error' }); }
});

// GET /api/brands/challenge/:token/leaderboard
router.get('/challenge/:token/leaderboard', async (req, res) => {
  try {
    const { rows: [ch] } = await req.db.query(
      'SELECT id FROM challenges WHERE share_token=$1', [req.params.token]);
    if (!ch) return res.status(404).json({ error: 'not_found' });
    const { rows } = await req.db.query(`
      SELECT ce.id, COALESCE(u.username, ce.guest_name, 'Anonym') AS name,
        ce.score, ce.wave, ce.time_ms, ce.created_at
      FROM challenge_entries ce
      LEFT JOIN users u ON u.id=ce.user_id
      WHERE ce.challenge_id=$1
      ORDER BY ce.score DESC, ce.wave DESC, ce.created_at ASC
      LIMIT 50
    `, [ch.id]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: 'db_error' }); }
});

// POST /api/brands/challenge/:token/submit — score submission (DSGVO-konform)
router.post('/challenge/:token/submit', async (req, res) => {
  try {
    const { rows: [ch] } = await req.db.query(
      `SELECT c.*, b.name AS brand_name FROM challenges c
       JOIN brands b ON b.id=c.brand_id
       WHERE c.share_token=$1 AND c.is_active=true`,
      [req.params.token]
    );
    if (!ch) return res.status(404).json({ error: 'not_found' });
    const now = new Date();
    if (now < new Date(ch.start_at)) return res.status(400).json({ error: 'not_started' });
    if (now > new Date(ch.end_at))   return res.status(400).json({ error: 'challenge_ended' });

    const { guest_email, guest_name, newsletter_optin=false,
            score=0, wave=0, time_ms=null, session_id=null } = req.body;
    if (ch.require_email && !guest_email)
      return res.status(400).json({ error: 'email_required' });
    if (guest_email && !/^[^@]+@[^@]+\.[^@]+$/.test(guest_email))
      return res.status(400).json({ error: 'email_invalid' });

    // Check max entries per user
    if (guest_email) {
      const { rows: existing } = await req.db.query(
        'SELECT COUNT(*) AS n FROM challenge_entries WHERE challenge_id=$1 AND guest_email=$2',
        [ch.id, guest_email.toLowerCase()]
      );
      if (parseInt(existing[0].n) >= ch.max_entries_per_user)
        return res.status(429).json({ error: 'max_entries_reached' });
    }

    const ipHash = require('crypto')
      .createHash('sha256').update((req.ip||'') + (process.env.HASH_SALT||'salt')).digest('hex');

    const { rows } = await req.db.query(`
      INSERT INTO challenge_entries
        (challenge_id,guest_email,guest_name,newsletter_optin,score,wave,time_ms,session_id,ip_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,score,wave,created_at
    `, [ch.id, guest_email?.toLowerCase()||null, guest_name||null,
        newsletter_optin, score, wave, time_ms, session_id||null, ipHash]);

    // Compute current rank
    const { rows: rank } = await req.db.query(
      'SELECT COUNT(*)+1 AS rank FROM challenge_entries WHERE challenge_id=$1 AND score>$2',
      [ch.id, score]
    );
    res.json({ ok:true, entry: rows[0], rank: parseInt(rank[0].rank), brand_name: ch.brand_name });
  } catch(e) {
    console.error('Challenge submit error:', e.message);
    res.status(500).json({ error: 'db_error' });
  }
});

// GET challenge entries (brand admin)
router.get('/:brandId/challenges/:id/entries', requireAuth, async (req, res) => {
  if (!await requireBrandMember(req, res, req.params.brandId)) return;
  const { rows } = await req.db.query(`
    SELECT ce.*, COALESCE(u.username, ce.guest_name, 'Anonym') AS display_name
    FROM challenge_entries ce
    LEFT JOIN users u ON u.id=ce.user_id
    WHERE ce.challenge_id=$1
    ORDER BY ce.score DESC, ce.created_at ASC
  `, [req.params.id]);
  res.json(rows);
});

module.exports = router;
