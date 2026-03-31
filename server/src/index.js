require('dotenv').config();
const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const cookieParser= require('cookie-parser');
const rateLimit   = require('express-rate-limit');
const { Pool }    = require('pg');
const fs          = require('fs');
const path        = require('path');

// ── Database ─────────────────────────────────
const db = new Pool({ connectionString: process.env.DATABASE_URL });
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
      console.log('✅ PostgreSQL connected (schema ok)');
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
app.use(rateLimit({ windowMs: 60_000, max: 300 }));

const io = new Server(server, {
  cors: { origin: corsOrigin, credentials: true },
  pingTimeout: 20000, pingInterval: 10000,
});
module.exports.io = io;

app.use('/api/auth',    require('./routes/auth'));
app.use('/api/users',   require('./routes/users'));
app.use('/api/chat',    require('./routes/chat'));
app.use('/api/groups',  require('./routes/groups'));
app.use('/api/lobbies', require('./routes/lobbies-router'));
app.use('/api/games',   require('./routes/games'));
app.use('/api/legal',   require('./routes/legal'));
app.get('/api/health',  (_, res) => {
  const v = require('fs').readFileSync(require('path').join(__dirname,'VERSION'),'utf8').trim();
  res.json({ ok: true, version: v, ts: Date.now() });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
  app.get('*', (_, res) =>
    res.sendFile(path.join(__dirname, '../client/build/index.html')));
}

require('./socket')(io, db);

// ── Start (migrate first, then listen) ───────
const PORT = process.env.PORT || 4000;
const VERSION = require('fs').readFileSync(require('path').join(__dirname,'VERSION'),'utf8').trim();
migrate().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 Server on :${PORT}  [v${VERSION}]`);
  });
});
