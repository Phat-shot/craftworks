-- ══════════════════════════════════════════
--  PLATFORM SCHEMA v1.0
-- ══════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for username search

-- ── USERS ────────────────────────────────
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  username      VARCHAR(32)  UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email_verified BOOLEAN DEFAULT FALSE,
  language      VARCHAR(5) DEFAULT 'de',
  avatar_color  VARCHAR(7) DEFAULT '#4a90e2',
  is_guest      BOOLEAN DEFAULT FALSE,
  online        BOOLEAN DEFAULT FALSE,
  last_seen     TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_users_email    ON users(email);
CREATE INDEX idx_users_username ON users USING gin(username gin_trgm_ops);

-- ── EMAIL VERIFICATION ───────────────────
CREATE TABLE email_verifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(128) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── PASSWORD RESETS ──────────────────────
CREATE TABLE password_resets (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(128) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── REFRESH TOKENS ───────────────────────
CREATE TABLE refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      VARCHAR(512) UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── FOLLOWS (unidirectional) ─────────────
CREATE TABLE follows (
  follower_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);
CREATE INDEX idx_follows_following ON follows(following_id);

-- ── GROUPS ───────────────────────────────
CREATE TABLE groups (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       VARCHAR(64) NOT NULL,
  owner_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code       VARCHAR(8)  UNIQUE NOT NULL,
  max_size   INTEGER DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_groups_code ON groups(code);

CREATE TABLE group_members (
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       VARCHAR(16) DEFAULT 'member', -- 'owner','member'
  joined_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);

-- ── MESSAGES ─────────────────────────────
CREATE TABLE messages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- DM: recipient_id set, group_id null
  -- Group: group_id set, recipient_id null
  recipient_id UUID REFERENCES users(id) ON DELETE CASCADE,
  group_id     UUID REFERENCES groups(id) ON DELETE CASCADE,
  content      TEXT NOT NULL,
  read         BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  CHECK (
    (recipient_id IS NOT NULL AND group_id IS NULL) OR
    (recipient_id IS NULL     AND group_id IS NOT NULL)
  )
);
CREATE INDEX idx_messages_dm    ON messages(sender_id, recipient_id, created_at);
CREATE INDEX idx_messages_group ON messages(group_id, created_at);

-- ── LOBBIES ──────────────────────────────
CREATE TABLE lobbies (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(64) NOT NULL,
  game_type   VARCHAR(32) NOT NULL DEFAULT 'tower_defense',
  game_mode   VARCHAR(32) NOT NULL DEFAULT 'classic', -- classic|tournament|chaos
  host_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code        VARCHAR(8)  UNIQUE NOT NULL,
  status      VARCHAR(16) DEFAULT 'waiting', -- waiting|starting|in_progress|finished
  max_players INTEGER DEFAULT 4,
  difficulty  VARCHAR(16) DEFAULT 'normal',
  is_public   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_lobbies_code   ON lobbies(code);
CREATE INDEX idx_lobbies_status ON lobbies(status, is_public);

CREATE TABLE lobby_members (
  lobby_id  UUID NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ready     BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (lobby_id, user_id)
);

-- ── GAME SESSIONS ────────────────────────
CREATE TABLE game_sessions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lobby_id   UUID REFERENCES lobbies(id) ON DELETE SET NULL,
  game_type  VARCHAR(32) NOT NULL DEFAULT 'tower_defense',
  game_mode  VARCHAR(32) NOT NULL DEFAULT 'classic',
  difficulty VARCHAR(16) DEFAULT 'normal',
  status     VARCHAR(16) DEFAULT 'in_progress', -- in_progress|finished
  started_at TIMESTAMPTZ DEFAULT NOW(),
  ended_at   TIMESTAMPTZ
);

CREATE TABLE game_players (
  session_id UUID NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username   VARCHAR(32) NOT NULL,
  wave       INTEGER DEFAULT 0,
  lives      INTEGER DEFAULT 50,
  score      INTEGER DEFAULT 0,
  kills      INTEGER DEFAULT 0,
  status     VARCHAR(16) DEFAULT 'playing', -- playing|dead|winner|finished
  rank       INTEGER,
  finished_at TIMESTAMPTZ,
  PRIMARY KEY (session_id, user_id)
);

-- ── LEADERBOARD ──────────────────────────
CREATE TABLE leaderboard (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_type  VARCHAR(32) NOT NULL DEFAULT 'tower_defense',
  score      INTEGER NOT NULL,
  wave       INTEGER NOT NULL,
  difficulty VARCHAR(16),
  mode       VARCHAR(32),
  played_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_lb_user      ON leaderboard(user_id, game_type);
CREATE INDEX idx_lb_score     ON leaderboard(game_type, score DESC);

-- ── LEGAL / DSGVO ────────────────────────
CREATE TABLE consent_log (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  event      VARCHAR(64) NOT NULL, -- 'registered','privacy_accepted','deleted'
  ip_hash    VARCHAR(128),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
