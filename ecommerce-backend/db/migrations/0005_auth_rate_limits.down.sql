-- Reverts 0005_auth_rate_limits. Drops the counters (all limits reset); with
-- the table gone, a PostgreSQL-backed API refuses to start until 0005 is applied again.

DROP TABLE auth_rate_limits;
