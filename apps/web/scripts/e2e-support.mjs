// Shared helpers for the end-to-end scripts: an HTTP(S) client with a
// browser-like cookie jar, process control, and a throwaway PostgreSQL
// container (removed afterwards). Never touches development or production data.
import { execFile, execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const run = promisify(execFile);
export const WEB = fileURLToPath(new URL("..", import.meta.url));
export const BACKEND = path.resolve(WEB, "../../ecommerce-backend");
export const backendRequire = createRequire(path.join(BACKEND, "package.json"));

export const ALL_POSTGRES = {
  DATA_SOURCE_DELIVERY_OPTIONS: "postgres", DATA_SOURCE_PRODUCTS: "postgres", DATA_SOURCE_USERS: "postgres",
  DATA_SOURCE_CARTS: "postgres", DATA_SOURCE_ORDERS: "postgres",
};

export function createChecker() {
  const result = { passed: 0, failed: 0 };
  const check = (name, ok, detail = "") => {
    if (ok) result.passed += 1; else result.failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
  };
  return { check, result };
}

export function requireBuilds() {
  for (const [label, file] of [["backend build", path.join(BACKEND, "dist/server.js")], ["Next.js build", path.join(WEB, ".next/BUILD_ID")]]) {
    if (!existsSync(file)) throw new Error(`${label} missing (${file}); run npm run build first`);
  }
}

export const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
  server.on("error", reject);
});

/** HTTP(S) request with an optional cookie jar, like a browser tab. Never logs cookie values. */
export function request(url, { method = "GET", headers = {}, body, jar, ca, servername, raw = false } = {}) {
  return new Promise((resolve, reject) => {
    (async () => {
      const target = new URL(url);
      const cookie = jar ? await jar.getCookieString(url) : "";
      const transport = target.protocol === "https:" ? https : http;
      const connectHost = target.hostname === "localhost" ? "127.0.0.1" : target.hostname;
      const call = transport.request({
        host: connectHost, port: target.port, path: `${target.pathname}${target.search}`, method,
        servername: servername ?? target.hostname, ca,
        headers: { Host: target.host, ...headers, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", async () => {
          const setCookies = response.headers["set-cookie"] ?? [];
          if (jar) for (const line of setCookies) await jar.setCookie(line, url);
          const buffer = Buffer.concat(chunks);
          const text = raw ? "" : buffer.toString("utf8");
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { /* HTML */ }
          resolve({ status: response.statusCode, headers: response.headers, setCookies, text, json, buffer });
        });
      });
      call.on("error", reject);
      if (body) call.write(JSON.stringify(body));
      call.end();
    })().catch(reject);
  });
}

export async function waitFor(url, attempts = 480) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await request(url);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`${url} did not start`);
}

export function start(command, args, options) {
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (chunk) => { log += chunk; });
  child.stderr.on("data", (chunk) => { log += chunk; });
  child.log = () => log;
  return child;
}

export async function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    // next dev starts child processes; end the whole tree.
    await run("taskkill", ["/pid", String(child.pid), "/T", "/F"]).catch(() => undefined);
  } else {
    child.kill();
  }
  await new Promise((resolve) => { child.once("exit", resolve); setTimeout(resolve, 3000); });
}

export function opensslPath() {
  for (const candidate of ["openssl", "C:/Program Files/Git/usr/bin/openssl.exe", "C:/Program Files/Git/mingw64/bin/openssl.exe"]) {
    try { execFileSync(candidate, ["version"], { stdio: "ignore" }); return candidate; } catch { /* next */ }
  }
  throw new Error("openssl was not found (needed for the HTTPS-equivalent scenario)");
}

/** A migrated throwaway PostgreSQL database in Docker. Call stop() when done. */
export async function startThrowawayPostgres(label) {
  const pg = backendRequire("pg");
  const password = randomBytes(18).toString("hex");
  const { stdout } = await run("docker", [
    "run", "--detach", "--rm", "--label", `ecommerce-web.${label}=true`,
    "--env", "POSTGRES_USER=e2e", "--env", `POSTGRES_PASSWORD=${password}`, "--env", "POSTGRES_DB=e2e",
    "--publish", "127.0.0.1::5432", "postgres:17-alpine",
  ]);
  const container = stdout.trim();
  const stopContainer = () => run("docker", ["stop", container]).catch(() => undefined);
  try {
    const { stdout: mapped } = await run("docker", ["port", container, "5432/tcp"]);
    const databaseUrl = `postgres://e2e:${password}@127.0.0.1:${mapped.trim().split(":").pop()}/e2e`;
    const pool = new pg.Pool({ connectionString: databaseUrl });
    for (let attempt = 0; ; attempt += 1) {
      try { await pool.query("SELECT 1"); break; } catch (error) {
        if (attempt > 240) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    // The image's init phase restarts the server once; wait for the final instance.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await pool.query("SELECT 1");
    execFileSync(process.execPath, ["dist/scripts/dbMigrate.js", "up"], { cwd: BACKEND, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "ignore" });
    return { databaseUrl, pool, stop: async () => { await pool.end(); await stopContainer(); } };
  } catch (error) {
    await stopContainer();
    throw error;
  }
}
