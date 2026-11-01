import { createHash } from "node:crypto";
import request from "supertest";
import { buildContext, createApp } from "../src/app.js";
import { loadConfig } from "../src/lib/config.js";
import type { Ctx } from "../src/lib/ctx.js";
import { hashPassword } from "../src/lib/security.js";
import { signQuizPayload } from "../src/services/quiz.js";
import { TestPaystackClient, TestSheetsClient } from "../src/services/adapters.js";

export const QUIZ_SECRET = "test-cluequest-secret";
export const PAYSTACK_SECRET = "sk_test_unit";
export const PASSWORD = "correct-horse-battery";

export function makeCtx(extra: Record<string, string> = {}): Ctx {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: process.env.DATABASE_URL,
    EMAIL_ADAPTER: "test",
    CLUEQUEST_ADAPTER: "test",
    CLUEQUEST_BASE_URL: "https://cluequest.test",
    CLUEQUEST_AUTHORING_URL: "https://cluequest.test/quizzes/new",
    CLUEQUEST_WEBHOOK_SECRET: QUIZ_SECRET,
    PAYSTACK_ADAPTER: "test",
    PAYSTACK_SECRET_KEY: PAYSTACK_SECRET,
    SHEETS_ADAPTER: "test",
    ENABLE_TEST_ENDPOINTS: "1",
    WATCH_THRESHOLD_PERCENT: "80",
    ...extra,
  });
  return buildContext(config);
}

export async function resetDb(ctx: Ctx) {
  const rows = await ctx.db.$queryRawUnsafe<{ tablename: string }[]>(
    `select tablename from pg_tables where schemaname='public' and tablename <> '_prisma_migrations'`,
  );
  const list = rows.map((r) => `"${r.tablename}"`).join(", ");
  await ctx.db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function createAdmin(ctx: Ctx, email = "admin@msva.test") {
  return ctx.db.user.create({
    data: { email, name: "Admin", role: "ADMIN", status: "ACTIVE", passwordHash: await hashPassword(PASSWORD), activatedAt: new Date() },
  });
}

export function agentFor(ctx: Ctx) {
  const app = createApp(ctx);
  return { app, agent: () => request.agent(app) };
}

export async function signIn(agent: ReturnType<typeof request.agent>, email: string, password = PASSWORD) {
  const r = await agent.post("/api/auth/login").send({ email, password });
  if (r.status !== 200) throw new Error(`login failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.user;
}

/** Stable, valid-looking ClueQuest quiz id for a label, so tests can name their quizzes. */
export function quizIdFor(label: string) {
  const h = createHash("sha1").update(label).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** The six-digit code in the most recent one-time-code email sent to an address. */
export async function latestCode(ctx: Ctx, to: string) {
  const m = await ctx.db.emailMessage.findFirst({ where: { to, kind: "otp" }, orderBy: { createdAt: "desc" } });
  if (!m) throw new Error(`no code email for ${to}`);
  return m.text.match(/\b(\d{6})\b/)![1]!;
}

/** Completes activation with the emailed code, the way the activation page does. */
export async function activateWithCode(ctx: Ctx, app: Parameters<typeof request>[0], email: string, password = PASSWORD) {
  return request(app).post("/api/auth/verify-otp").send({ email, code: await latestCode(ctx, email), purpose: "activate", password });
}

export function quizResult(
  app: Parameters<typeof request>[0],
  payload: Record<string, unknown>,
  opts: { secret?: string; timestamp?: number; tamper?: boolean } = {},
) {
  const raw = JSON.stringify(payload);
  const ts = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const sig = signQuizPayload(opts.secret ?? QUIZ_SECRET, ts, opts.tamper ? raw + " " : raw);
  return request(app)
    .post("/api/webhooks/cluequest/result")
    .set("content-type", "application/json")
    .set("x-cluequest-timestamp", ts)
    .set("x-cluequest-signature", sig)
    .set("x-cluequest-event-id", String(payload.eventId ?? ""))
    .send(raw);
}

export const sheets = (ctx: Ctx) => ctx.sheets as TestSheetsClient;
export const paystack = (ctx: Ctx) => ctx.paystack as TestPaystackClient;
