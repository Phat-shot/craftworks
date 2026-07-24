'use strict';
// ═══════════════════════════════════════════════════════════
//  SCHNITZELJAGD ("Hunt") scenario CRUD + session-code generation + POI
//  3D-model upload. First real API surface for Hunt beyond the sandbox —
//  see server/src/db/schema.sql's Schnitzeljagd block for the table shapes
//  and server/src/game/hunt.js for the pure engine these scenarios feed
//  into once played (server/src/socket/hunt.js's hunt:join_by_code).
//
//  Scenario save is a WHOLE-DOCUMENT replace, same convention as
//  client/src/pages/MapEditor.jsx's workshop_maps save: the editor holds
//  its full POI/route list locally and PUTs/POSTs the entire thing at
//  once — no incremental per-POI endpoints. On update, existing pois/
//  routes are deleted and reinserted from the payload (routes cascade-
//  delete with their pois via the schema's ON DELETE CASCADE), simplest
//  correct approach for an editor with no concurrent-multi-editor story.
// ═══════════════════════════════════════════════════════════
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { nanoid } = require('nanoid');
const { requireAuth, requireCreator } = require('../middleware/auth');

const router = express.Router();

// ── File upload setup (POI 3D model / thumbnail) — same pattern as
// routes/brands.js's brand-asset upload. glb/gltf for the "3D-Objekt
// einblenden" visualization mode, plus images for a flat POI thumbnail. ──
const UPLOAD_DIR = path.join(__dirname, '../../../uploads/hunt');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB — glb/gltf models run bigger than plain images
  fileFilter: (req, file, cb) => {
    const ok = /\.(glb|gltf|png|jpg|jpeg|webp)$/i.test(file.originalname);
    cb(ok ? null : new Error('Invalid file type'), ok);
  },
});
function assetUrl(req, filename) {
  return `${req.protocol}://${req.get('host')}/uploads/hunt/${filename}`;
}

function genSessionCode() { return nanoid(8).toUpperCase(); } // same convention as lobbies.js's genCode()

// Normalizes one poi payload entry (client-supplied, either creating or
// replacing) into the exact column set hunt_pois expects, with sane
// defaults — kept in one place so POST and PUT can't silently drift.
function normalizePoi(p) {
  return {
    order_index: Number.isFinite(p.order_index) ? p.order_index : 0,
    name: String(p.name || 'POI').slice(0, 128),
    lat: +p.lat, lon: +p.lon,
    radius_m: Number.isFinite(p.radius_m) ? p.radius_m : 15,
    poi_type: ['puzzle', 'target', 'capture', 'base', 'carry_from', 'carry_to'].includes(p.poi_type) ? p.poi_type : 'target',
    puzzle_config: p.puzzle_config && typeof p.puzzle_config === 'object' ? p.puzzle_config : {},
    task_time_limit_ms: Number.isFinite(p.task_time_limit_ms) ? p.task_time_limit_ms : null,
    timeout_action: p.timeout_action && typeof p.timeout_action === 'object' ? p.timeout_action : {},
    visualization: ['satellite', 'comic', 'model3d'].includes(p.visualization) ? p.visualization : 'satellite',
    model_asset_url: p.model_asset_url || null,
  };
}

async function insertPoisAndRoutes(db, scenarioId, pois, routes) {
  // tempId (client-generated, e.g. a uuid or incrementing counter — never
  // persisted) -> real DB-generated UUID, so routes (which reference pois
  // by whatever id the client used while building the sequence) can be
  // re-pointed at the real rows.
  const idMap = new Map();
  for (const p of pois) {
    const n = normalizePoi(p);
    const { rows } = await db.query(
      `INSERT INTO hunt_pois (scenario_id, order_index, name, lat, lon, radius_m, poi_type,
         puzzle_config, task_time_limit_ms, timeout_action, visualization, model_asset_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [scenarioId, n.order_index, n.name, n.lat, n.lon, n.radius_m, n.poi_type,
        JSON.stringify(n.puzzle_config), n.task_time_limit_ms, JSON.stringify(n.timeout_action),
        n.visualization, n.model_asset_url]
    );
    idMap.set(String(p.tempId ?? p.id), rows[0].id);
  }
  for (const r of routes) {
    const fromId = idMap.get(String(r.from_tempId ?? r.from_poi_id));
    const toId = idMap.get(String(r.to_tempId ?? r.to_poi_id));
    if (!fromId || !toId) continue; // dangling reference — skip rather than fail the whole save
    await db.query(
      `INSERT INTO hunt_routes (scenario_id, from_poi_id, to_poi_id, route_type, enforcement,
         travel_time_limit_ms, timeout_action, path_geojson)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [scenarioId, fromId, toId,
        r.route_type === 'defined' ? 'defined' : 'freeform',
        r.enforcement === 'strict' ? 'strict' : 'guidance',
        Number.isFinite(r.travel_time_limit_ms) ? r.travel_time_limit_ms : null,
        JSON.stringify(r.timeout_action && typeof r.timeout_action === 'object' ? r.timeout_action : {}),
        r.path_geojson ? JSON.stringify(r.path_geojson) : null]
    );
  }
  // Carry pairing — reciprocal link between a carry_from and its matching
  // carry_to POI (schema.sql's hunt_pois.carry_pair_poi_id). Written to
  // BOTH sides regardless of which one(s) the client actually sent
  // carryPairTempId on, so the link can never end up one-sided/stale — the
  // editor keeps both ends in sync locally too (see HuntEditor.jsx), this
  // is just a server-side safety net on top of that.
  const pairs = new Map(); // realId -> realId
  for (const p of pois) {
    const pairRef = p.carryPairTempId ?? p.carry_pair_id ?? p.carry_pair_poi_id;
    if (!pairRef) continue;
    const selfId = idMap.get(String(p.tempId ?? p.id));
    const otherId = idMap.get(String(pairRef));
    if (!selfId || !otherId) continue;
    pairs.set(selfId, otherId);
    pairs.set(otherId, selfId);
  }
  for (const [selfId, otherId] of pairs) {
    await db.query('UPDATE hunt_pois SET carry_pair_poi_id=$1 WHERE id=$2', [otherId, selfId]);
  }
  return idMap;
}

// GET /api/hunt/scenarios — my own scenarios (admins see everyone's, same
// convention as workshop's "mine" vs public split, simplified to one list
// since Hunt scenarios have no public gallery yet).
router.get('/scenarios', requireAuth, async (req, res) => {
  try {
    const { rows } = await req.db.query(`
      SELECT s.*, COUNT(p.id)::int AS poi_count
      FROM hunt_scenarios s
      LEFT JOIN hunt_pois p ON p.scenario_id = s.id
      WHERE $2 = true OR s.creator_id = $1
      GROUP BY s.id
      ORDER BY s.updated_at DESC
    `, [req.user.id, !!req.user.is_admin]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'db_error' }); }
});

// GET /api/hunt/scenarios/playable — the lobby-side "pick a scenario to run"
// list for the Schnitzeljagd AR-Ops mode (see socket/game.js's lobby:start
// preflight). Deliberately NOT owner/admin-scoped like /scenarios above —
// any host needs to be able to pick any scenario with at least one POI, not
// just their own — and deliberately minimal fields, no pois/routes/full
// config leak, just enough for a picker list. Must stay registered BEFORE
// /scenarios/:id below, or Express would try (and fail) to match "playable"
// as that route's :id param instead.
router.get('/scenarios/playable', requireAuth, async (req, res) => {
  try {
    const { rows } = await req.db.query(`
      SELECT s.id, s.title, COUNT(p.id)::int AS poi_count,
        s.config->>'progressMode' AS progress_mode
      FROM hunt_scenarios s
      LEFT JOIN hunt_pois p ON p.scenario_id = s.id
      GROUP BY s.id
      HAVING COUNT(p.id) > 0
      ORDER BY s.updated_at DESC
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'db_error' }); }
});

// GET /api/hunt/scenarios/:id — full detail (pois ordered, routes)
router.get('/scenarios/:id', requireAuth, async (req, res) => {
  try {
    const { rows: sRows } = await req.db.query(
      'SELECT * FROM hunt_scenarios WHERE id=$1', [req.params.id]);
    const scenario = sRows[0];
    if (!scenario) return res.status(404).json({ error: 'not_found' });
    if (scenario.creator_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: 'not_owner' });
    }
    const { rows: pois } = await req.db.query(
      'SELECT * FROM hunt_pois WHERE scenario_id=$1 ORDER BY order_index ASC, created_at ASC', [req.params.id]);
    const { rows: routes } = await req.db.query(
      'SELECT * FROM hunt_routes WHERE scenario_id=$1', [req.params.id]);
    res.json({ ...scenario, pois, routes });
  } catch (e) { res.status(500).json({ error: 'db_error' }); }
});

// POST /api/hunt/scenarios — create (requires is_admin or is_creator, see
// schema.sql's comment on hunt_scenarios/users.is_creator)
router.post('/scenarios', requireAuth, requireCreator, async (req, res) => {
  const { title, config = {}, pois = [], routes = [] } = req.body;
  if (!title || typeof title !== 'string' || title.trim().length < 2) {
    return res.status(400).json({ error: 'invalid_title' });
  }
  if (!pois.length) return res.status(400).json({ error: 'need_pois' });
  try {
    const { rows } = await req.db.query(
      `INSERT INTO hunt_scenarios (creator_id, title, config) VALUES ($1,$2,$3) RETURNING *`,
      [req.user.id, title.trim().slice(0, 128), JSON.stringify(config)]
    );
    const scenario = rows[0];
    await insertPoisAndRoutes(req.db, scenario.id, pois, routes);
    const { rows: newPois } = await req.db.query(
      'SELECT * FROM hunt_pois WHERE scenario_id=$1 ORDER BY order_index ASC, created_at ASC', [scenario.id]);
    const { rows: newRoutes } = await req.db.query('SELECT * FROM hunt_routes WHERE scenario_id=$1', [scenario.id]);
    res.json({ ...scenario, pois: newPois, routes: newRoutes });
  } catch (e) { res.status(500).json({ error: 'db_error' }); }
});

// PUT /api/hunt/scenarios/:id — whole-document replace (title/config +
// pois/routes wholesale delete+reinsert)
router.put('/scenarios/:id', requireAuth, async (req, res) => {
  const { title, config, pois = [], routes = [] } = req.body;
  try {
    const { rows: existing } = await req.db.query(
      'SELECT creator_id FROM hunt_scenarios WHERE id=$1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'not_found' });
    if (existing[0].creator_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: 'not_owner' });
    }
    await req.db.query(
      `UPDATE hunt_scenarios SET title=COALESCE($1,title), config=COALESCE($2,config), updated_at=NOW() WHERE id=$3`,
      [title ? title.trim().slice(0, 128) : null, config ? JSON.stringify(config) : null, req.params.id]
    );
    // Pois cascade-delete their own routes (hunt_routes.from/to_poi_id are
    // ON DELETE CASCADE) — one DELETE clears both tables for this scenario.
    await req.db.query('DELETE FROM hunt_pois WHERE scenario_id=$1', [req.params.id]);
    if (pois.length) await insertPoisAndRoutes(req.db, req.params.id, pois, routes);
    const { rows: newScenario } = await req.db.query('SELECT * FROM hunt_scenarios WHERE id=$1', [req.params.id]);
    const { rows: newPois } = await req.db.query(
      'SELECT * FROM hunt_pois WHERE scenario_id=$1 ORDER BY order_index ASC, created_at ASC', [req.params.id]);
    const { rows: newRoutes } = await req.db.query('SELECT * FROM hunt_routes WHERE scenario_id=$1', [req.params.id]);
    res.json({ ...newScenario[0], pois: newPois, routes: newRoutes });
  } catch (e) { res.status(500).json({ error: 'db_error' }); }
});

// DELETE /api/hunt/scenarios/:id
router.delete('/scenarios/:id', requireAuth, async (req, res) => {
  try {
    const { rowCount } = await req.db.query(
      'DELETE FROM hunt_scenarios WHERE id=$1 AND (creator_id=$2 OR $3=true)',
      [req.params.id, req.user.id, !!req.user.is_admin]
    );
    if (!rowCount) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'db_error' }); }
});

// POST /api/hunt/scenarios/:id/sessions — generate a new, independently-
// living scan code for this scenario (see schema.sql: generating a code
// never replaces an older one, both keep working until their own expiry).
router.post('/scenarios/:id/sessions', requireAuth, async (req, res) => {
  const { maxUsers = null, validityDays = 300 } = req.body || {};
  try {
    const { rows: sRows } = await req.db.query(
      'SELECT creator_id FROM hunt_scenarios WHERE id=$1', [req.params.id]);
    if (!sRows[0]) return res.status(404).json({ error: 'not_found' });
    if (sRows[0].creator_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: 'not_owner' });
    }
    const code = genSessionCode();
    const days = Math.max(1, +validityDays || 300);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const { rows } = await req.db.query(
      `INSERT INTO hunt_sessions (scenario_id, code, max_users, expires_at)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, code, Number.isFinite(maxUsers) ? maxUsers : null, expiresAt]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'db_error' }); }
});

// GET /api/hunt/scenarios/:id/sessions — list this scenario's active codes
router.get('/scenarios/:id/sessions', requireAuth, async (req, res) => {
  try {
    const { rows: sRows } = await req.db.query(
      'SELECT creator_id FROM hunt_scenarios WHERE id=$1', [req.params.id]);
    if (!sRows[0]) return res.status(404).json({ error: 'not_found' });
    if (sRows[0].creator_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: 'not_owner' });
    }
    const { rows } = await req.db.query(
      'SELECT * FROM hunt_sessions WHERE scenario_id=$1 ORDER BY created_at DESC', [req.params.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: 'db_error' }); }
});

// GET /api/hunt/sessions/:code — lightweight preview before joining (title
// + POI count), so the play page can show something before the socket
// join. No ownership gate — anyone with the code can preview/join, same
// "the code IS the access control" model as lobbies.
router.get('/sessions/:code', requireAuth, async (req, res) => {
  try {
    const { rows } = await req.db.query(`
      SELECT hs.code, hs.expires_at, hs.max_users, sc.id AS scenario_id, sc.title,
        (SELECT COUNT(*)::int FROM hunt_pois WHERE scenario_id = sc.id) AS poi_count
      FROM hunt_sessions hs
      JOIN hunt_scenarios sc ON sc.id = hs.scenario_id
      WHERE hs.code = $1
    `, [req.params.code.toUpperCase()]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    if (new Date(rows[0].expires_at) < new Date()) return res.status(410).json({ error: 'expired' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'db_error' }); }
});

// POST /api/hunt/pois/upload-model — 3D model (glb/gltf) or thumbnail
// image for a POI's visualization. Returns just the URL; the editor wires
// it into the relevant POI's model_asset_url on its own next save.
router.post('/pois/upload-model', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  res.json({ url: assetUrl(req, req.file.filename) });
});

module.exports = router;
