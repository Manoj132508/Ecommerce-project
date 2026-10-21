import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import type { TestProject } from "vitest/node";

const run = promisify(execFile);

// Same image as compose.yaml, so tests exercise the production engine version.
const IMAGE = "postgres:17-alpine";
const LABEL = "ecommerce-backend.migration-tests=true";

declare module "vitest" {
  export interface ProvidedContext {
    postgresAdminUrl: string;
  }
}

async function waitUntilReady(url: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: url });
    try {
      // The image's init phase only listens on a Unix socket, so a TCP
      // connection succeeds only once the final server is up.
      await client.connect();
      await client.query("SELECT 1");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      await client.end().catch(() => {});
    }
  }

  throw new Error(`Test PostgreSQL did not become ready: ${String(lastError)}`);
}

export default async function setup(project: TestProject) {
  // Throwaway credentials: never the values in .env.postgres.
  const user = "migration_test";
  const password = randomBytes(18).toString("hex");

  const { stdout: containerId } = await run("docker", [
    "run", "--detach", "--rm",
    "--label", LABEL,
    "--env", `POSTGRES_USER=${user}`,
    "--env", `POSTGRES_PASSWORD=${password}`,
    "--env", "POSTGRES_DB=postgres",
    // Random free host port, reachable from this machine only.
    "--publish", "127.0.0.1::5432",
    IMAGE,
  ]);
  const id = containerId.trim();

  try {
    const { stdout: mapping } = await run("docker", ["port", id, "5432/tcp"]);
    const port = mapping.trim().split("\n")[0]?.split(":").at(-1);
    if (!port) {
      throw new Error(`Could not read the test container's port from "${mapping}"`);
    }

    const url = `postgresql://${user}:${password}@127.0.0.1:${port}/postgres`;
    await waitUntilReady(url);
    project.provide("postgresAdminUrl", url);
  } catch (error) {
    await run("docker", ["rm", "--force", id]).catch(() => {});
    throw error;
  }

  return async () => {
    await run("docker", ["rm", "--force", id]);
  };
}
