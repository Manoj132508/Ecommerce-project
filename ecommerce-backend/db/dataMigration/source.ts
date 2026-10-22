// Read-only access to the MongoDB source.
//
// Only listCollections() and find() are used: nothing here can insert, update
// or delete. For production, also connect with a MongoDB user that has the
// built-in "read" role only (db/README.md).
import { createHash } from "node:crypto";
import mongoose from "mongoose";

const { MongoClient, BSON } = mongoose.mongo;

export type SourceDocument = Record<string, unknown>;

export interface SourceSnapshot {
  databaseName: string;
  /** Every collection, documents sorted by _id for deterministic processing. */
  collections: Map<string, SourceDocument[]>;
  /** SHA-256 of the canonical Extended JSON of every document. */
  fingerprint: string;
  extractedAt: Date;
}

const sortById = (a: SourceDocument, b: SourceDocument) => {
  const left = String(a._id);
  const right = String(b._id);
  return left < right ? -1 : left > right ? 1 : 0;
};

export function fingerprintOf(collections: Map<string, SourceDocument[]>): string {
  const hash = createHash("sha256");
  for (const name of [...collections.keys()].sort()) {
    hash.update(`${name}\n`);
    for (const document of collections.get(name) ?? []) {
      // Canonical mode keeps types (Int32 vs Double, ObjectId, Date) visible.
      hash.update(`${BSON.EJSON.stringify(document, { relaxed: false })}\n`);
    }
  }
  return hash.digest("hex");
}

/**
 * Operational collections written by the running API, not application data:
 * never extracted, fingerprinted or migrated. (Rate-limit counters change with
 * every sign-in attempt, even during a write freeze.)
 */
export const OPERATIONAL_COLLECTIONS: ReadonlySet<string> = new Set(["authRateLimits"]);

/** Reads every application collection of the URI's database. Never writes. */
export async function extractSource(uri: string): Promise<SourceSnapshot> {
  const client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  try {
    const db = client.db();
    const names = (await db.listCollections({}, { nameOnly: true }).toArray())
      .map((collection) => collection.name)
      .filter((name) => !name.startsWith("system.") && !OPERATIONAL_COLLECTIONS.has(name))
      .sort();

    const collections = new Map<string, SourceDocument[]>();
    for (const name of names) {
      const documents = await db.collection<SourceDocument>(name).find({}).toArray();
      collections.set(name, documents.sort(sortById));
    }

    return {
      databaseName: db.databaseName,
      collections,
      fingerprint: fingerprintOf(collections),
      extractedAt: new Date(),
    };
  } finally {
    await client.close();
  }
}

// ------------------------------------------------- connection safety guard

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Host names of a MongoDB or PostgreSQL connection string, without credentials. */
export function connectionHosts(uri: string): string[] {
  const match = /^[a-z+]+:\/\/(?:[^@/]*@)?([^/?]*)/i.exec(uri);
  const hostList = match?.[1] ?? "";
  return hostList
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean)
    .map((host) => (host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.replace(/:\d+$/, "")).toLowerCase());
}

/** True only when every host is this machine. SRV records are always remote. */
export function isLocalConnection(uri: string): boolean {
  if (/^mongodb\+srv:/i.test(uri)) return false;
  const hosts = connectionHosts(uri);
  return hosts.length > 0 && hosts.every((host) => LOCAL_HOSTS.has(host));
}

/** Host list and database name for reports; never credentials or options. */
export function describeConnection(uri: string): string {
  const database = /^[a-z+]+:\/\/[^/]*\/([^?]*)/i.exec(uri)?.[1] ?? "";
  return `${connectionHosts(uri).join(",")}/${database}`;
}
