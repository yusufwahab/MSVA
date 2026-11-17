import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/lib/config.js";
import { syncEnvAdmin } from "../src/services/admin.js";
import { PASSWORD, createAdmin, makeCtx, resetDb } from "./helpers.js";

const ctx = makeCtx();
const app = createApp(ctx);
const cfg = (extra: Record<string, string>) => loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgresql://x", ...extra });
const login = (email: string, password: string) => request(app).post("/api/auth/login").send({ email, password });

beforeAll(() => resetDb(ctx));
afterAll(() => ctx.db.$disconnect());

describe("admin from the environment", () => {
  it("does nothing unless both variables are set, and rejects a half or weak setting", async () => {
    expect(await syncEnvAdmin(ctx.db, cfg({}))).toBe("unchanged");
    expect(await ctx.db.user.count()).toBe(0);
    expect(() => cfg({ ADMIN_EMAIL: "boss@msva.test" })).toThrow(/set together/);
    expect(() => cfg({ ADMIN_EMAIL: "nope", ADMIN_PASSWORD: "long-enough-pw" })).toThrow(/valid email/);
    expect(() => cfg({ ADMIN_EMAIL: "boss@msva.test", ADMIN_PASSWORD: "short" })).toThrow(/10 characters/);
  });

  it("creates the admin, then follows changes to the email and password", async () => {
    const first = cfg({ ADMIN_EMAIL: "Boss@MSVA.test", ADMIN_PASSWORD: "first-password-1", ADMIN_NAME: "The Boss" });
    expect(await syncEnvAdmin(ctx.db, first)).toBe("created");
    expect(await syncEnvAdmin(ctx.db, first)).toBe("unchanged");
    const ok = await login("boss@msva.test", "first-password-1");
    expect(ok.status).toBe(200);
    expect(ok.body.user.role).toBe("ADMIN");
    expect(await ctx.db.session.count()).toBe(1);

    // New password: old one stops working and existing sessions are ended.
    expect(await syncEnvAdmin(ctx.db, cfg({ ADMIN_EMAIL: "boss@msva.test", ADMIN_PASSWORD: "second-password-2" }))).toBe("updated");
    expect(await ctx.db.session.count()).toBe(0);
    expect((await login("boss@msva.test", "first-password-1")).status).not.toBe(200);
    expect((await login("boss@msva.test", "second-password-2")).status).toBe(200);

    // New email: the same account moves, no second admin appears.
    expect(await syncEnvAdmin(ctx.db, cfg({ ADMIN_EMAIL: "new@msva.test", ADMIN_PASSWORD: "second-password-2" }))).toBe("updated");
    expect((await login("boss@msva.test", "second-password-2")).status).not.toBe(200);
    expect((await login("new@msva.test", "second-password-2")).status).toBe(200);
    expect(await ctx.db.user.count({ where: { role: "ADMIN" } })).toBe(1);
  });

  it("leaves other admins alone and refuses an email that belongs to someone else", async () => {
    await createAdmin(ctx, "other@msva.test");
    await syncEnvAdmin(ctx.db, cfg({ ADMIN_EMAIL: "new@msva.test", ADMIN_PASSWORD: "third-password-3" }));
    expect((await login("other@msva.test", PASSWORD)).status).toBe(200);
    await expect(syncEnvAdmin(ctx.db, cfg({ ADMIN_EMAIL: "other@msva.test", ADMIN_PASSWORD: "third-password-3" }))).rejects.toThrow(/different admin/);

    await ctx.db.user.create({ data: { email: "stu@msva.test", name: "Stu", role: "STUDENT", status: "ACTIVE" } });
    await expect(syncEnvAdmin(ctx.db, cfg({ ADMIN_EMAIL: "stu@msva.test", ADMIN_PASSWORD: "third-password-3" }))).rejects.toThrow(/non-admin/);
  });

  it("adopts an existing admin that already has that email", async () => {
    await resetDb(ctx);
    await createAdmin(ctx, "boss@msva.test");
    expect(await syncEnvAdmin(ctx.db, cfg({ ADMIN_EMAIL: "boss@msva.test", ADMIN_PASSWORD: "adopted-password-4" }))).toBe("updated");
    expect((await login("boss@msva.test", "adopted-password-4")).status).toBe(200);
    expect((await ctx.db.user.findUniqueOrThrow({ where: { email: "boss@msva.test" } })).envManaged).toBe(true);
  });
});
