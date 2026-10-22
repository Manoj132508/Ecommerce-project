// Every environment variable the backend reads. All are optional at the type
// level because each is validated where it is used (server start-up, the auth
// middleware, the database configs), exactly as before the TypeScript port.
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      /** MongoDB connection string (backend .env). Required by server.ts. */
      MONGODB_URI?: string;
      /** HTTP port; defaults to 3000. */
      PORT?: string;
      /** HS256 signing secret for JWTs. Required by server.ts and protect. */
      JWT_SECRET?: string;
      /** Extra comma-separated CORS origins. */
      CLIENT_URL?: string;
      /** PostgreSQL connection string (.env.postgres). Used only by scripts until Phase 3. */
      DATABASE_URL?: string;
      /** Docker Compose PostgreSQL settings (.env.postgres). */
      POSTGRES_DB?: string;
      POSTGRES_USER?: string;
      POSTGRES_PASSWORD?: string;
      /** Per-domain data source, "mongo" (default) or "postgres" (config/dataSources.ts). */
      DATA_SOURCE_DELIVERY_OPTIONS?: string;
      DATA_SOURCE_PRODUCTS?: string;
      DATA_SOURCE_USERS?: string;
      DATA_SOURCE_CARTS?: string;
      DATA_SOURCE_ORDERS?: string;
      /** Must be "true" to select PostgreSQL while NODE_ENV=production. */
      POSTGRES_PRODUCTION_ENABLED?: string;
      NODE_ENV?: string;
    }
  }
}

export {};
