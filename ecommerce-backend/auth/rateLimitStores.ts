// Shared rate-limit counters (fixed windows). One atomic statement per hit,
// timed by the database clock, so concurrent requests on several API
// instances cannot under-count. The store follows the users data source.
import mongoose from "mongoose";
import type { Pool } from "pg";
import type { RateLimitCount, RateLimitStore } from "./rateLimit.js";

type Db = mongoose.mongo.Db;

/** PostgreSQL (migration 0005_auth_rate_limits). */
export class PostgresRateLimitStore implements RateLimitStore {
  constructor(private readonly pool: Pool) {}

  async hit(key: Buffer, windowSeconds: number): Promise<RateLimitCount> {
    const { rows: [row] } = await this.pool.query<{ hits: number; reset_in: number }>(
      `INSERT INTO auth_rate_limits (key, hits, window_started_at, expires_at)
       VALUES ($1, 1, now(), now() + make_interval(secs => $2))
       ON CONFLICT (key) DO UPDATE SET
         hits = CASE WHEN auth_rate_limits.expires_at <= now() THEN 1 ELSE auth_rate_limits.hits + 1 END,
         window_started_at = CASE WHEN auth_rate_limits.expires_at <= now() THEN now() ELSE auth_rate_limits.window_started_at END,
         expires_at = CASE WHEN auth_rate_limits.expires_at <= now()
                           THEN now() + make_interval(secs => $2) ELSE auth_rate_limits.expires_at END
       RETURNING hits, ceil(extract(epoch FROM expires_at - now()))::int AS reset_in`,
      [key, windowSeconds],
    );
    if (!row) throw new Error("rate-limit upsert returned no row");
    return { hits: row.hits, resetInSeconds: Math.max(0, row.reset_in) };
  }

  async peek(key: Buffer): Promise<RateLimitCount> {
    const { rows: [row] } = await this.pool.query<{ hits: number; reset_in: number }>(
      `SELECT hits, ceil(extract(epoch FROM expires_at - now()))::int AS reset_in
         FROM auth_rate_limits WHERE key = $1 AND expires_at > now()`,
      [key],
    );
    return row ? { hits: row.hits, resetInSeconds: Math.max(0, row.reset_in) } : { hits: 0, resetInSeconds: 0 };
  }

  async clear(key: Buffer): Promise<void> {
    await this.pool.query("DELETE FROM auth_rate_limits WHERE key = $1", [key]);
  }

  /** Removes windows that ended more than retentionSeconds ago (sessions:cleanup). */
  async deleteExpired(retentionSeconds: number): Promise<number> {
    const { rowCount } = await this.pool.query(
      "DELETE FROM auth_rate_limits WHERE expires_at < now() - make_interval(secs => $1)",
      [retentionSeconds],
    );
    return rowCount ?? 0;
  }
}

/** Collection name; excluded from the MongoDB → PostgreSQL extraction (db/dataMigration/source.ts). */
export const MONGO_RATE_LIMIT_COLLECTION = "authRateLimits";

interface RateLimitDocument {
  _id: string;
  hits: number;
  expiresAt: Date;
}

/** MongoDB; a TTL index removes ended windows automatically. */
export class MongoRateLimitStore implements RateLimitStore {
  private indexes: Promise<unknown> | undefined;

  /** db is looked up per call: the connection is opened after the app is built. */
  constructor(private readonly db: () => Db | undefined) {}

  private async collection() {
    const db = this.db();
    if (!db) throw new Error("MongoDB is not connected");
    const collection = db.collection<RateLimitDocument>(MONGO_RATE_LIMIT_COLLECTION);
    this.indexes ??= collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "expiresAt_ttl" })
      .catch((error: unknown) => { this.indexes = undefined; throw error; });
    await this.indexes;
    return collection;
  }

  private static count(document: RateLimitDocument | null): RateLimitCount {
    if (!document || document.expiresAt.getTime() <= Date.now()) return { hits: 0, resetInSeconds: 0 };
    return { hits: document.hits, resetInSeconds: Math.max(0, Math.ceil((document.expiresAt.getTime() - Date.now()) / 1000)) };
  }

  async hit(key: Buffer, windowSeconds: number): Promise<RateLimitCount> {
    const collection = await this.collection();
    // An update pipeline is evaluated atomically against the stored document,
    // with $$NOW as the server clock.
    const expired = { $or: [{ $eq: [{ $type: "$expiresAt" }, "missing"] }, { $lte: ["$expiresAt", "$$NOW"] }] };
    const pipeline = [{
      $set: {
        hits: { $cond: [expired, 1, { $add: ["$hits", 1] }] },
        expiresAt: { $cond: [expired, { $add: ["$$NOW", windowSeconds * 1000] }, "$expiresAt"] },
      },
    }];
    const run = () => collection.findOneAndUpdate({ _id: key.toString("hex") }, pipeline, { upsert: true, returnDocument: "after" });
    let document: RateLimitDocument | null;
    try {
      document = await run();
    } catch (error) {
      // Two first hits racing to insert the same key: the loser retries as an update.
      if (!(error instanceof mongoose.mongo.MongoServerError && error.code === 11000)) throw error;
      document = await run();
    }
    if (!document) throw new Error("rate-limit upsert returned no document");
    return { hits: document.hits, resetInSeconds: Math.max(1, Math.ceil((document.expiresAt.getTime() - Date.now()) / 1000)) };
  }

  async peek(key: Buffer): Promise<RateLimitCount> {
    const collection = await this.collection();
    return MongoRateLimitStore.count(await collection.findOne({ _id: key.toString("hex") }));
  }

  async clear(key: Buffer): Promise<void> {
    const collection = await this.collection();
    await collection.deleteOne({ _id: key.toString("hex") });
  }
}
