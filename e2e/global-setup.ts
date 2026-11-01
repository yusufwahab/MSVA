import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

const DB = process.env.E2E_DATABASE_URL ?? "postgresql://msva:msva_dev_pw@localhost:54329/msva_e2e";
export const ADMIN = { email: "admin@e2e.test", name: "E2E Admin", password: "e2e-admin-password" };

/** Fresh database per run: migrate, wipe, then create the first admin through the real setup command. */
export default async function globalSetup() {
  const server = path.resolve(__dirname, "../server");
  const env = { ...process.env, DATABASE_URL: DB, DIRECT_URL: DB };
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const run = (args: string[], extra: Record<string, string> = {}) =>
    execFileSync(npx, args, { cwd: server, env: { ...env, ...extra }, stdio: "pipe", shell: process.platform === "win32" });

  run(["prisma", "migrate", "deploy"]);

  const req = createRequire(path.join(server, "package.json"));
  const { Client } = req("pg") as {
    Client: new (o: { connectionString: string }) => {
      connect(): Promise<void>;
      end(): Promise<void>;
      query<T>(sql: string): Promise<{ rows: T[] }>;
    };
  };
  const c = new Client({ connectionString: DB });
  await c.connect();
  const { rows } = await c.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' and tablename <> '_prisma_migrations'");
  await c.query(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await c.end();

  run(["tsx", "src/scripts/setup-admin.ts", "--email", ADMIN.email, "--name", ADMIN.name], { ADMIN_PASSWORD: ADMIN.password });
}
