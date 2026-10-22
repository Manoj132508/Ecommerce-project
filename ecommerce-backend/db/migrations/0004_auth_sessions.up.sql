-- 0004 server-side sessions for HttpOnly cookie authentication (Phase 5B).
--
-- The browser holds an opaque random token in an HttpOnly cookie; only its
-- SHA-256 is stored here, so a copy of this table cannot be replayed as a
-- login. Each session has an idle expiry (extended on use) capped by an
-- absolute expiry (never extended). Revocation is one-way.
-- Expired and revoked rows are removed only by the deliberate cleanup command
-- (npm run sessions:cleanup); nothing deletes them automatically.

CREATE TABLE auth_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash          bytea NOT NULL
                      CONSTRAINT auth_sessions_token_hash_sha256 CHECK (octet_length(token_hash) = 32),
  -- A session is meaningless without its user.
  user_id             text NOT NULL
                      CONSTRAINT auth_sessions_user_id_fkey REFERENCES users (id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  idle_expires_at     timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at          timestamptz,
  revoked_reason      text
                      CONSTRAINT auth_sessions_revoked_reason_known
                      CHECK (revoked_reason IN ('logout', 'logout_all', 'rotated', 'password_change', 'admin')),
  -- Shown to the user in a future "signed-in devices" list; truncated by the application.
  user_agent          text
                      CONSTRAINT auth_sessions_user_agent_length CHECK (char_length(user_agent) <= 512),
  CONSTRAINT auth_sessions_token_hash_key UNIQUE (token_hash),
  CONSTRAINT auth_sessions_revocation_complete CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT auth_sessions_expiry_order CHECK (
    absolute_expires_at > created_at AND idle_expires_at <= absolute_expires_at
  )
);

-- A user's live sessions (logout everywhere).
CREATE INDEX auth_sessions_user_id_active_idx ON auth_sessions (user_id) WHERE revoked_at IS NULL;
-- Cleanup of expired and revoked sessions.
CREATE INDEX auth_sessions_absolute_expires_at_idx ON auth_sessions (absolute_expires_at);
CREATE INDEX auth_sessions_idle_expires_at_idx ON auth_sessions (idle_expires_at);
CREATE INDEX auth_sessions_revoked_at_idx ON auth_sessions (revoked_at) WHERE revoked_at IS NOT NULL;

-- Identity and lifetime limits never change; revocation cannot be undone;
-- the idle expiry may only move within the absolute limit (CHECK above).
CREATE FUNCTION auth_sessions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.token_hash, NEW.user_id, NEW.created_at, NEW.absolute_expires_at)
     IS DISTINCT FROM
     (OLD.id, OLD.token_hash, OLD.user_id, OLD.created_at, OLD.absolute_expires_at) THEN
    RAISE EXCEPTION 'session identity and absolute expiry are immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND
     (NEW.revoked_at, NEW.revoked_reason) IS DISTINCT FROM (OLD.revoked_at, OLD.revoked_reason) THEN
    RAISE EXCEPTION 'a revoked session stays revoked'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER auth_sessions_guard BEFORE UPDATE ON auth_sessions
  FOR EACH ROW EXECUTE FUNCTION auth_sessions_guard();
