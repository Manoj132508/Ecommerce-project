-- 0005 shared rate-limit counters for authentication endpoints (R37).
--
-- One row per (rule, subject) key: the SHA-256 of the rule name and the client
-- address or email address, so neither is stored. Fixed windows: a hit after
-- expires_at starts a new window. Rows are operational data, never migrated;
-- ended windows are removed by npm run sessions:cleanup.

CREATE TABLE auth_rate_limits (
  key               bytea PRIMARY KEY
                    CONSTRAINT auth_rate_limits_key_sha256 CHECK (octet_length(key) = 32),
  hits              integer NOT NULL
                    CONSTRAINT auth_rate_limits_hits_positive CHECK (hits >= 1),
  window_started_at timestamptz NOT NULL,
  expires_at        timestamptz NOT NULL,
  CONSTRAINT auth_rate_limits_window_order CHECK (expires_at > window_started_at)
);

CREATE INDEX auth_rate_limits_expires_at_idx ON auth_rate_limits (expires_at);
