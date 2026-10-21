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
    }
  }
}

export {};
