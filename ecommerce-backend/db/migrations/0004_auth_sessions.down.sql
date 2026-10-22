-- Reverts 0004_auth_sessions. Signs out every cookie session; legacy bearer
-- tokens are unaffected. Take a pg_dump backup first (db/README.md).

DROP TRIGGER auth_sessions_guard ON auth_sessions;
DROP FUNCTION auth_sessions_guard();
DROP TABLE auth_sessions;
