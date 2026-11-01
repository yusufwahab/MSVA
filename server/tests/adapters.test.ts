import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/lib/config.js";
import { BrevoOtpMailer, LiveClueQuestClient } from "../src/services/adapters.js";
import { makeCtx, quizIdFor } from "./helpers.js";

const base = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://x",
  EMAIL_ADAPTER: "brevo",
  BREVO_API_KEY: "xkeysib-test",
  EMAIL_FROM_ADDRESS: "academy@example.org",
  EMAIL_FROM_NAME: "MS Virtual Academy",
  CLUEQUEST_API_URL: "https://api.cluequest.test/",
  CLUEQUEST_API_KEY: "cq_key",
};
const config = loadConfig(base);

type Call = { url: string; init: RequestInit };
function fakeFetch(respond: (url: string) => { status: number; body?: unknown } | Error) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = respond(url);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("BrevoOtpMailer", () => {
  const ctx = makeCtx();
  const sentBody = (c: Call) => JSON.parse(String(c.init.body)) as { sender: unknown; to: { email: string }[]; subject: string; textContent: string; htmlContent: string };
  const codeIn = (c: Call) => sentBody(c).textContent.match(/code is (\d{6})/)![1]!;

  it("emails a code through Brevo and then accepts that code exactly once", async () => {
    const f = fakeFetch(() => ({ status: 201 }));
    const mailer = new BrevoOtpMailer(ctx.db, config, f.fn);
    const email = `brevo-ok-${Date.now()}@example.org`;
    expect(await mailer.sendCode({ email, name: "Ada Obi" }, "activate")).toEqual({ ok: true });

    const call = f.calls[0]!;
    expect(call.url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((call.init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-test");
    const body = sentBody(call);
    expect(body.sender).toEqual({ name: "MS Virtual Academy", email: "academy@example.org" });
    expect(body.to).toEqual([{ email }]);
    expect(body.subject).toMatch(/activation code/);
    expect(body.htmlContent).toContain(codeIn(call));
    expect(body.textContent).toContain(`${config.APP_URL}/activate?email=${encodeURIComponent(email)}`);

    const code = codeIn(call);
    expect(await mailer.verifyCode(email, "000000" === code ? "000001" : "000000")).toBe(false);
    expect(await mailer.verifyCode(email, code)).toBe(true);
    expect(await mailer.verifyCode(email, code)).toBe(false);

    // Only metadata is kept: the stored message never contains the code.
    const log = await ctx.db.emailMessage.findFirstOrThrow({ where: { to: email } });
    expect(log).toMatchObject({ provider: "brevo", status: "sent", text: "", html: "" });
  });

  it("uses reset wording and the reset page for a password reset", async () => {
    const f = fakeFetch(() => ({ status: 201 }));
    const email = `brevo-reset-${Date.now()}@example.org`;
    await new BrevoOtpMailer(ctx.db, config, f.fn).sendCode({ email, name: "Ada" }, "reset");
    const body = sentBody(f.calls[0]!);
    expect(body.subject).toMatch(/password reset code/);
    expect(body.textContent).toContain("/reset-password?email=");
  });

  it("reports a Brevo failure and discards the code, so an earlier delivered code keeps working", async () => {
    const email = `brevo-fail-${Date.now()}@example.org`;
    const good = fakeFetch(() => ({ status: 201 }));
    const first = new BrevoOtpMailer(ctx.db, config, good.fn);
    await first.sendCode({ email, name: "Ada" }, "activate");
    const delivered = codeIn(good.calls[0]!);

    for (const respond of [() => ({ status: 401 }), () => new Error("offline")]) {
      const bad = new BrevoOtpMailer(ctx.db, config, fakeFetch(respond).fn);
      const r = await bad.sendCode({ email, name: "Ada" }, "activate");
      expect(r.ok).toBe(false);
      expect(r.error).toBeTruthy();
    }
    expect(await ctx.db.emailMessage.count({ where: { to: email, status: "failed" } })).toBe(2);
    expect(await ctx.db.otpCode.count({ where: { email } })).toBe(1);
    expect(await first.verifyCode(email, delivered)).toBe(true);
  });

  it("makes a newer code replace the older one, and locks a code after five wrong guesses", async () => {
    const f = fakeFetch(() => ({ status: 201 }));
    const mailer = new BrevoOtpMailer(ctx.db, config, f.fn);
    const email = `brevo-new-${Date.now()}@example.org`;
    await mailer.sendCode({ email, name: "Ada" }, "activate");
    await mailer.sendCode({ email, name: "Ada" }, "activate");
    const [older, newer] = [codeIn(f.calls[0]!), codeIn(f.calls[1]!)];
    if (older !== newer) expect(await mailer.verifyCode(email, older)).toBe(false);
    const wrong = newer === "111111" ? "222222" : "111111";
    for (let i = 0; i < 5; i++) await mailer.verifyCode(email, wrong);
    expect(await mailer.verifyCode(email, newer)).toBe(false);
  });
});

describe("LiveClueQuestClient (ClueQuest partner API v1)", () => {
  const id = quizIdFor("live");

  it("looks a quiz up with the bearer key and applies the assignability rules", async () => {
    const ok = fakeFetch(() => ({ status: 200, body: { quizId: id, title: "Algebra", published: true, activityTypes: ["solo", "cbt"] } }));
    expect(await new LiveClueQuestClient(config, ok.fn).checkQuiz(id)).toEqual({ ok: true, title: "Algebra" });
    expect(ok.calls[0]!.url).toBe(`https://api.cluequest.test/api/partner/v1/quizzes/${id}`);
    expect((ok.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer cq_key");

    const missing = await new LiveClueQuestClient(config, fakeFetch(() => ({ status: 404 })).fn).checkQuiz(id);
    expect(missing.ok).toBe(false);
    expect(missing.reason).toMatch(/Let connected learning platforms/);
    const draft = await new LiveClueQuestClient(config, fakeFetch(() => ({ status: 200, body: { published: false, activityTypes: ["solo"] } })).fn).checkQuiz(id);
    expect(draft.reason).toMatch(/Publish/);
    const liveOnly = await new LiveClueQuestClient(config, fakeFetch(() => ({ status: 200, body: { published: true, activityTypes: ["live"] } })).fn).checkQuiz(id);
    expect(liveOnly.ok).toBe(false);
    await expect(new LiveClueQuestClient(config, fakeFetch(() => ({ status: 500 })).fn).checkQuiz(id)).rejects.toThrow();
  });

  it("creates a one-attempt solo launch keyed by MSVA's attempt, with no name or email", async () => {
    const f = fakeFetch(() => ({ status: 201, body: { launchUrl: "https://app.cluequest.test/launch/abc", expiresAt: "2026-11-01T15:15:00.000Z" } }));
    const out = await new LiveClueQuestClient(config, f.fn).createLaunch({
      quizId: id,
      assignmentRef: "attempt-1",
      learnerRef: "opaque-ref",
      returnUrl: "https://portal.example/classes/c1?returned=1",
      passMarkPercent: 70,
    });
    expect(out.launchUrl).toBe("https://app.cluequest.test/launch/abc");
    expect(out.expiresAt.toISOString()).toBe("2026-11-01T15:15:00.000Z");
    expect(f.calls[0]!.url).toBe("https://api.cluequest.test/api/partner/v1/launches");
    expect(f.calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({
      quizId: id,
      assignmentRef: "attempt-1",
      learnerRef: "opaque-ref",
      returnUrl: "https://portal.example/classes/c1?returned=1",
      activity: { type: "solo", style: "points", passMarkPercent: 70, attemptLimit: 1 },
    });
    await expect(
      new LiveClueQuestClient(config, fakeFetch(() => ({ status: 422 })).fn).createLaunch({ quizId: id, assignmentRef: "a", learnerRef: "l", returnUrl: "x", passMarkPercent: 70 }),
    ).rejects.toThrow(/launch failed/);
  });

  it("refuses to call out until the API URL and key are configured", async () => {
    const bare = loadConfig({ NODE_ENV: "development", DATABASE_URL: "postgresql://x" });
    await expect(new LiveClueQuestClient(bare, fakeFetch(() => ({ status: 200 })).fn).checkQuiz(id)).rejects.toThrow(/not configured/);
  });
});

describe("production configuration", () => {
  const prod = { ...base, NODE_ENV: "production" };
  it("refuses test adapters and a half-configured Brevo", () => {
    expect(() => loadConfig({ ...prod, CLUEQUEST_ADAPTER: "test" })).toThrow(/CLUEQUEST_ADAPTER=test/);
    expect(() => loadConfig({ ...prod, EMAIL_ADAPTER: "test" })).toThrow(/EMAIL_ADAPTER=test/);
    expect(() => loadConfig({ ...prod, BREVO_API_KEY: "" })).toThrow(/BREVO_API_KEY and EMAIL_FROM_ADDRESS/);
    expect(() => loadConfig({ ...prod, EMAIL_FROM_ADDRESS: "" })).toThrow(/BREVO_API_KEY and EMAIL_FROM_ADDRESS/);
    expect(() => loadConfig({ ...prod, PAYSTACK_ADAPTER: "live" })).not.toThrow();
  });
});
