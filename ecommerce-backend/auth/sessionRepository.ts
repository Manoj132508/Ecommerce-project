// PostgreSQL session store (migration 0004). Parameterised SQL only. Every
// expiry decision uses the database clock (now()), so application and
// database clocks cannot disagree about whether a session is alive.
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../db/pool.js";
import { generateSessionToken, hashSessionToken, isWellFormedToken } from "./tokens.js";

export type RevocationReason = "logout" | "logout_all" | "rotated" | "password_change" | "admin";

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface SessionLifetimes {
  idleSeconds: number;
  absoluteSeconds: number;
  renewAfterSeconds: number;
}

export interface SessionRepository {
  /**
   * Starts a session. When the browser presented a session token, that session
   * is revoked in the same transaction (rotation: no session fixation).
   * The raw token is returned once, for the cookie, and never stored.
   */
  create(userId: string, userAgent: string | undefined, replacing?: string): Promise<{ token: string; session: SessionRecord }>;
  /** The live session for a token: not revoked, not past either expiry. */
  findActive(token: string): Promise<SessionRecord | null>;
  /** Extends the idle expiry if the last extension is old enough. Null when not due. */
  renew(sessionId: string): Promise<SessionRecord | null>;
  revoke(sessionId: string, reason: RevocationReason): Promise<boolean>;
  revokeAllForUser(userId: string, reason: RevocationReason): Promise<number>;
  /** Deletes sessions that expired or were revoked more than retentionSeconds ago. */
  deleteExpired(retentionSeconds: number): Promise<number>;
}

interface SessionRow {
  id: string;
  user_id: string;
  created_at: Date;
  last_seen_at: Date;
  idle_expires_at: Date;
  absolute_expires_at: Date;
}

const COLUMNS = "id::text AS id, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at";

const toSession = (row: SessionRow): SessionRecord => ({
  id: row.id,
  userId: row.user_id,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
  idleExpiresAt: row.idle_expires_at,
  absoluteExpiresAt: row.absolute_expires_at,
});

const truncate = (value: string | undefined) => (value === undefined ? null : value.slice(0, 512));

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly pool: Pool, private readonly lifetimes: SessionLifetimes) {}

  async create(userId: string, userAgent: string | undefined, replacing?: string) {
    return withTransaction(this.pool, async (client) => {
      if (replacing !== undefined && isWellFormedToken(replacing)) {
        await client.query(
          `UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'rotated'
            WHERE token_hash = $1 AND revoked_at IS NULL`,
          [hashSessionToken(replacing)],
        );
      }
      const token = generateSessionToken();
      const session = await this.insert(client, token, userId, userAgent);
      return { token, session };
    });
  }

  private async insert(client: PoolClient, token: string, userId: string, userAgent: string | undefined) {
    const { rows: [row] } = await client.query<SessionRow>(
      `INSERT INTO auth_sessions (token_hash, user_id, idle_expires_at, absolute_expires_at, user_agent)
       VALUES ($1, $2, now() + make_interval(secs => $3), now() + make_interval(secs => $4), $5)
       RETURNING ${COLUMNS}`,
      [hashSessionToken(token), userId, this.lifetimes.idleSeconds, this.lifetimes.absoluteSeconds, truncate(userAgent)],
    );
    if (!row) throw new Error("INSERT returned no row");
    return toSession(row);
  }

  async findActive(token: string) {
    // A malformed value cannot be a token we issued; skip the query.
    if (!isWellFormedToken(token)) return null;
    const { rows: [row] } = await this.pool.query<SessionRow>(
      `SELECT ${COLUMNS} FROM auth_sessions
        WHERE token_hash = $1 AND revoked_at IS NULL
          AND idle_expires_at > now() AND absolute_expires_at > now()`,
      [hashSessionToken(token)],
    );
    return row ? toSession(row) : null;
  }

  async renew(sessionId: string) {
    const { rows: [row] } = await this.pool.query<SessionRow>(
      `UPDATE auth_sessions
          SET last_seen_at = now(),
              idle_expires_at = LEAST(now() + make_interval(secs => $2), absolute_expires_at)
        WHERE id = $1 AND revoked_at IS NULL
          AND idle_expires_at > now() AND absolute_expires_at > now()
          AND last_seen_at <= now() - make_interval(secs => $3)
        RETURNING ${COLUMNS}`,
      [sessionId, this.lifetimes.idleSeconds, this.lifetimes.renewAfterSeconds],
    );
    return row ? toSession(row) : null;
  }

  async revoke(sessionId: string, reason: RevocationReason) {
    const { rowCount } = await this.pool.query(
      "UPDATE auth_sessions SET revoked_at = now(), revoked_reason = $2 WHERE id = $1 AND revoked_at IS NULL",
      [sessionId, reason],
    );
    return (rowCount ?? 0) > 0;
  }

  async revokeAllForUser(userId: string, reason: RevocationReason) {
    const { rowCount } = await this.pool.query(
      "UPDATE auth_sessions SET revoked_at = now(), revoked_reason = $2 WHERE user_id = $1 AND revoked_at IS NULL",
      [userId, reason],
    );
    return rowCount ?? 0;
  }

  async deleteExpired(retentionSeconds: number) {
    const { rowCount } = await this.pool.query(
      `DELETE FROM auth_sessions
        WHERE absolute_expires_at < now() - make_interval(secs => $1)
           OR idle_expires_at < now() - make_interval(secs => $1)
           OR revoked_at < now() - make_interval(secs => $1)`,
      [retentionSeconds],
    );
    return rowCount ?? 0;
  }
}
