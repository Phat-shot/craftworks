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

const db = new Pool({ connectionString: process.env.DATABASE_URL });
db.connect()
  .then(() => console.log('✅ PostgreSQL connected'))
  .catch(e => { console.error('❌ DB error', e.message); process.exit(1); });
module.exports.db = db;

const app    = express();
const server = http.createServer(app);

// Always allow APP_URL + localhost — no need to set ALLOWED_ORIGINS manually
// No origin header = same-origin (React served by this same server) → always allow
const allowedOrigins = [
  ...(process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
  process.env.APP_URL,
  'http://localhost:4000',
  'http://127.0.0.1:4000',
].filter(Boolean);

function corsOrigin(origin, cb) {
  if (!origin) return cb(null, true);                    // same-origin / curl
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
app.get('/api/health',  (_, res) => res.json({ ok: true, ts: Date.now() }));

if (process.env.NODE_ENV === 'production') {
  const path = require('path');
  app.use(express.static(path.join(__dirname, '../client/build')));
  app.get('*', (_, res) =>
    res.sendFile(path.join(__dirname, '../client/build/index.html')));
}

require('./socket')(io, db);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server on :${PORT}`));
