require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const helmet     = require('helmet');
const compression= require('compression');
const cookieParser=require('cookie-parser');
const rateLimit  = require('express-rate-limit');
const { Pool }   = require('pg');

const db = new Pool({ connectionString: process.env.DATABASE_URL });
db.connect()
  .then(() => console.log('✅ PostgreSQL connected'))
  .catch(e => { console.error('❌ DB error', e.message); process.exit(1); });
module.exports.db = db;

const app    = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({ origin: (o, cb) => (!o || allowedOrigins.includes(o) || process.env.NODE_ENV==='development') ? cb(null,true) : cb(new Error('CORS')), credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(rateLimit({ windowMs: 60_000, max: 300 }));

const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true },
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
  app.get('*', (_, res) => res.sendFile(path.join(__dirname, '../client/build/index.html')));
}

require('./socket')(io, db);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server on :${PORT}`));
