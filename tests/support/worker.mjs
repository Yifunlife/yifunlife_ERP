import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createRuntime } from "./runtime.cjs";

const require = createRequire(import.meta.url);
const { Miniflare } = createRequire(require.resolve("wrangler"))("miniflare");
const root = fileURLToPath(new URL("../../", import.meta.url));
export const fixturePassword = "local-review-only-2026";

export async function createWorker(bindings = {}) {
  const worker = new Miniflare({
    scriptPath: root + "dist/server/index.js",
    // Vite emits computed dynamic imports; provide the built module manifest explicitly.
    modules: ["index.js", ...readdirSync(root + "dist/server", { recursive: true }).filter(path => path !== "index.js" && /\.m?js$/.test(path))].map(path => ({ type: "ESModule", path: root + "dist/server/" + path })),
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      directory: root + "dist/client", binding: "ASSETS",
      routerConfig: { has_user_worker: true },
    },
    d1Databases: ["DB"],
    r2Buckets: ["PRODUCT_IMAGES"],
    bindings,
  });
  try {
    const db = await worker.getD1Database("DB");
    const runtime = createRuntime();
    try {
      for (const { sql } of runtime.sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table'").all()) await db.prepare(sql).run();
      const password = await runtime.load("lib/auth.ts").createPasswordRecord(fixturePassword);
      for (const [email, role] of [["yifunlife@hotmail.com", "admin"], ["alice@example.test", "employee"], ["bob@example.test", "employee"], ["ceo@example.test", "ceo"]]) {
        await db.prepare("INSERT INTO app_users (email,username,name,password_hash,password_salt,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
          .bind(email, email, "Local review " + role, password.passwordHash, password.passwordSalt, role, "active", new Date().toISOString(), new Date().toISOString()).run();
      }
    } finally { runtime.close(); }
    return { worker, db };
  } catch (error) { await worker.dispose(); throw error; }
}
