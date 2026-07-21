require('dotenv').config();
const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const cookieParser= require('cookie-parser');
const rateLimit   = require('express-rate-limit');
const fs          = require('fs');
const path        = require('path');

// ── Database ─────────────────────────────────
const db = require('./db/pool');
module.exports.db = db;

// ── Auto-migrate: run schema.sql if tables missing ──
async function migrate() {
  const client = await db.connect();
  try {
    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema='public' AND table_name='users'`
    );
    if (rows.length > 0) {
      // Schema exists — run incremental migrations for new tables
      const sql = fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8');
      // Extract only IF NOT EXISTS statements to safely add new tables
      const incrementalStatements = sql
        .split(';')
        .filter(s => s.match(/CREATE EXTENSION IF NOT EXISTS|CREATE TABLE IF NOT EXISTS|CREATE INDEX IF NOT EXISTS|ALTER TABLE.*ADD COLUMN IF NOT EXISTS/i))
        .map(s => s.trim())
        .filter(Boolean);
      for (const stmt of incrementalStatements) {
        try { await client.query(stmt); }
        catch (e) {
          if (!e.message.includes('already exists') && !e.message.includes('does not exist')) {
            console.warn('Migration warning:', e.message.slice(0, 120));
          }
        }
      }
      console.log('✅ PostgreSQL connected (incremental migrations applied)');
      return;
    }
    console.log('⚙️  Running database migrations...');
    const sql = fs.readFileSync(
      path.join(__dirname, 'db/schema.sql'), 'utf8'
    );
    await client.query(sql);
    console.log('✅ PostgreSQL connected (schema applied)');
  } catch (e) {
    console.error('❌ Migration error:', e.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

// ── Express app ──────────────────────────────
const app    = express();
const server = http.createServer(app);

const allowedOrigins = [
  ...(process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
  process.env.APP_URL,
  'http://localhost:4000',
  'http://127.0.0.1:4000',
].filter(Boolean);

function corsOrigin(origin, cb) {
  if (!origin) return cb(null, true);
  if (allowedOrigins.includes(origin)) return cb(null, true);
  if (process.env.NODE_ENV !== 'production') return cb(null, true);
  console.warn('CORS blocked:', origin);
  cb(new Error('CORS'));
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.set('trust proxy', 1); // trust first proxy (Traefik/nginx)
app.use(rateLimit({ windowMs: 60_000, max: 300 }));

const io = new Server(server, {
  cors: { origin: corsOrigin, credentials: true },
  pingTimeout: 20000, pingInterval: 10000,
});
module.exports.io = io;

// API-Versionierung (Phase 4 des Backend-Redesigns): /api/v1/* ist der
// versionierte Einstiegspunkt für zukünftige Konsumenten. Die unpräfigierten
// /api/*-Pfade bleiben unverändert bestehen (Web-Client + die bereits gebaute
// Mobile-App rufen die auf) — dieselben Router-Instanzen werden einfach an
// beiden Pfaden gemountet, kein Duplikat der Routen-Logik, keine Breaking Change.
const authRouter      = require('./routes/auth');
const usersRouter     = require('./routes/users');
const chatRouter      = require('./routes/chat');
const groupsRouter    = require('./routes/groups');
const lobbiesRouter   = require('./routes/lobbies-router');
const gamesRouter     = require('./routes/games');
const legalRouter     = require('./routes/legal');
const brandsRouter    = require('./routes/brands');
const adminRouter     = require('./routes/admin');
const workshopRouter  = require('./routes/workshop');
const workshopContentRouter = require('./routes/workshop_content');
const injectDb = (req, res, next) => { req.db = db; next(); };

for (const prefix of ['/api', '/api/v1']) {
  app.use(`${prefix}/auth`,    authRouter);
  app.use(`${prefix}/users`,   usersRouter);
  app.use(`${prefix}/chat`,    chatRouter);
  app.use(`${prefix}/groups`,  groupsRouter);
  app.use(`${prefix}/lobbies`, lobbiesRouter);
  app.use(`${prefix}/games`,   gamesRouter);
  app.use(`${prefix}/legal`,   legalRouter);
  app.use(`${prefix}/brands`, injectDb, brandsRouter);
  app.use(`${prefix}/admin`, adminRouter);
  app.use(`${prefix}/workshop`, injectDb, workshopRouter);
  app.use(`${prefix}/workshop`, injectDb, workshopContentRouter);
  app.get(`${prefix}/health`, (_, res) => {
    const v = require('fs').readFileSync(require('path').join(__dirname,'VERSION'),'utf8').trim();
    res.json({ ok: true, version: v, ts: Date.now() });
  });
}
// Serve uploaded brand assets
app.use('/uploads/brands', require('express').static(require('path').join(__dirname,'../../uploads/brands')));

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  app.get('/{*splat}', (_, res) =>
    res.sendFile(path.join(__dirname, '../client/build/index.html')));
}

// Centralized fallback error handler — must be registered last (Express
// recognizes error middleware by its 4-arg arity, order after all routes).
app.use(require('./middleware/errorHandler'));

require('./socket')(io, db);

// ── Start (migrate first, then listen) ───────
const PORT = process.env.PORT || 4000;
const VERSION = require('fs').readFileSync(require('path').join(__dirname,'VERSION'),'utf8').trim();
migrate().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 Server on :${PORT}  [v${VERSION}]`);
  });
});
