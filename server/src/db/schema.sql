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

-- ── WORKSHOP ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workshop_maps (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        VARCHAR(64) NOT NULL,
  description  VARCHAR(256),
  game_mode    VARCHAR(32) NOT NULL DEFAULT 'td',
  -- Config JSON: { difficulty, available_races, wave_overrides, settings }
  config       JSONB NOT NULL DEFAULT '{}',
  is_public    BOOLEAN DEFAULT TRUE,
  play_count   INTEGER DEFAULT 0,
  rating_sum   INTEGER DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workshop_ratings (
  map_id     UUID NOT NULL REFERENCES workshop_maps(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (map_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workshop_maps_creator  ON workshop_maps(creator_id);
CREATE INDEX IF NOT EXISTS idx_workshop_maps_public   ON workshop_maps(is_public, created_at DESC);

-- ── WORKSHOP: CUSTOM CONTENT ──────────────────────────────────
-- Buildings (was: towers)
CREATE TABLE IF NOT EXISTS workshop_buildings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(64) NOT NULL,
  description VARCHAR(256),
  -- Visual
  icon        VARCHAR(8)  NOT NULL DEFAULT '🏰',
  color       VARCHAR(16) NOT NULL DEFAULT '#888888',
  sprite_type VARCHAR(32) DEFAULT 'generic', -- 'generic'|'dart'|'splash'|etc for renderer hint
  -- Base stats
  cost        INTEGER NOT NULL DEFAULT 100,
  base_range  NUMERIC(4,2) NOT NULL DEFAULT 3.0,
  base_cd     INTEGER NOT NULL DEFAULT 1000,   -- ms cooldown
  base_dmg    INTEGER NOT NULL DEFAULT 20,
  dmg_type    VARCHAR(16) NOT NULL DEFAULT 'phys', -- phys|magic|expl
  unlock_wave INTEGER NOT NULL DEFAULT 0,
  can_hit_air BOOLEAN DEFAULT TRUE,
  -- Special flags (JSON): { isSpinAoe, isRingAoe, isAura, isPull, isHealAura, splashR, ... }
  flags       JSONB NOT NULL DEFAULT '{}',
  -- Upgrade paths: array of 3 paths, each with 5 upgrades
  -- [{ id, name, icon, upgrades: [{desc, cost, effects: {dmg, rangeDelta, ...}}] }]
  upgrade_paths JSONB NOT NULL DEFAULT '[]',
  is_public   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Units (enemies + future player units)
CREATE TABLE IF NOT EXISTS workshop_units (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(64) NOT NULL,
  description VARCHAR(256),
  unit_class  VARCHAR(16) NOT NULL DEFAULT 'enemy', -- 'enemy'|'friendly' (future)
  -- Visual
  icon        VARCHAR(8)  NOT NULL DEFAULT '👾',
  color       VARCHAR(16) NOT NULL DEFAULT '#b02810',
  shape       VARCHAR(16) NOT NULL DEFAULT 'circle', -- circle|square|diamond
  size_factor NUMERIC(3,2) NOT NULL DEFAULT 0.26,
  -- Stats
  base_hp     INTEGER NOT NULL DEFAULT 100,
  base_speed  NUMERIC(4,2) NOT NULL DEFAULT 1.5,
  base_reward INTEGER NOT NULL DEFAULT 10,
  armor_phys  NUMERIC(3,2) NOT NULL DEFAULT 0.0,
  armor_magic NUMERIC(3,2) NOT NULL DEFAULT 0.0,
  is_air      BOOLEAN DEFAULT FALSE,
  -- Special abilities (JSON): { healer_aura, boss_crown, regen, ... }
  abilities   JSONB NOT NULL DEFAULT '{}',
  is_public   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Custom Races
CREATE TABLE IF NOT EXISTS workshop_races (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(64) NOT NULL,
  icon        VARCHAR(8)  NOT NULL DEFAULT '⚔️',
  color       VARCHAR(16) NOT NULL DEFAULT '#c0a060',
  description VARCHAR(256),
  -- Array of building IDs (mix of built-in keys + UUID refs)
  -- e.g. ["dart", "poison", "uuid-of-custom-building"]
  building_ids JSONB NOT NULL DEFAULT '[]',
  is_public   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Maps can reference custom content via workshop_map_content
ALTER TABLE workshop_maps ADD COLUMN IF NOT EXISTS
  custom_races    JSONB NOT NULL DEFAULT '[]'; -- array of race UUIDs or built-in keys
ALTER TABLE workshop_maps ADD COLUMN IF NOT EXISTS
  custom_units    JSONB NOT NULL DEFAULT '[]'; -- array of unit UUIDs for wave editor

CREATE INDEX IF NOT EXISTS idx_workshop_buildings_creator ON workshop_buildings(creator_id);
CREATE INDEX IF NOT EXISTS idx_workshop_units_creator     ON workshop_units(creator_id);
CREATE INDEX IF NOT EXISTS idx_workshop_races_creator     ON workshop_races(creator_id);

-- ── WORKSHOP: ABILITIES ───────────────────────────────────────
-- Abilities are reusable upgrade paths assignable to buildings and units
-- Each ability has up to 6 levels (0=passive/base, 1-5=upgrades)
CREATE TABLE IF NOT EXISTS workshop_abilities (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(64) NOT NULL,
  description VARCHAR(256),
  icon        VARCHAR(8)  NOT NULL DEFAULT '⬆️',
  -- levels: array of 6 objects [{desc, cost, effects:{dmg,rangeDelta,...}}]
  -- level 0 = passive/always-on base effect (cost=0)
  -- levels 1-5 = upgrades
  levels      JSONB NOT NULL DEFAULT '[]',
  is_public   BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workshop_abilities_creator ON workshop_abilities(creator_id);

-- ── WORKSHOP: WAVE SETS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS workshop_wave_sets (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(64) NOT NULL,
  description   VARCHAR(256),
  wave_count    INTEGER NOT NULL DEFAULT 25,
  mode          VARCHAR(16) NOT NULL DEFAULT 'standard', -- 'standard'|'full_custom'
  default_spawn VARCHAR(16) NOT NULL DEFAULT 'snake',    -- 'snake'|'group'|'parallel'|'random'
  standard      JSONB NOT NULL DEFAULT '{}',  -- StandardConfig: base_type,hp_factor,count_start,...
  waves         JSONB NOT NULL DEFAULT '[]',  -- Per-wave overrides
  is_public     BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workshop_wave_sets_creator ON workshop_wave_sets(creator_id);

ALTER TABLE workshop_wave_sets ADD COLUMN IF NOT EXISTS mode VARCHAR(16) NOT NULL DEFAULT 'standard';
ALTER TABLE workshop_wave_sets ADD COLUMN IF NOT EXISTS default_spawn VARCHAR(16) NOT NULL DEFAULT 'snake';
ALTER TABLE workshop_wave_sets ADD COLUMN IF NOT EXISTS standard JSONB NOT NULL DEFAULT '{}';
