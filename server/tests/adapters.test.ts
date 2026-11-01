import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/lib/config.js";
import { LiveClueQuestClient, OtpUnavailableError, SupabaseOtpMailer } from "../src/services/adapters.js";
import { quizIdFor } from "./helpers.js";

const base = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://x",
  EMAIL_ADAPTER: "supabase",
  SUPABASE_URL: "https://proj.supabase.co/",
  SUPABASE_ANON_KEY: "anon-key",
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

describe("SupabaseOtpMailer", () => {
  it("asks Supabase Auth to email a code and checks it with the public key only", async () => {
    const f = fakeFetch(() => ({ status: 200 }));
    const mailer = new SupabaseOtpMailer(config, f.fn);
    expect(await mailer.sendCode("ada@example.com")).toEqual({ ok: true });
    expect(await mailer.verifyCode("ada@example.com", " 123456 ")).toBe(true);

    expect(f.calls[0]!.url).toBe("https://proj.supabase.co/auth/v1/otp");
    expect(JSON.parse(String(f.calls[0]!.init.body))).toEqual({ email: "ada@example.com", create_user: true });
    expect(f.calls[1]!.url).toBe("https://proj.supabase.co/auth/v1/verify");
    expect(JSON.parse(String(f.calls[1]!.init.body))).toEqual({ type: "email", email: "ada@example.com", token: "123456" });
    for (const c of f.calls) expect((c.init.headers as Record<string, string>).apikey).toBe("anon-key");
  });

  it("reports send failures, treats a rejected code as false, and signals an outage separately", async () => {
    const limited = new SupabaseOtpMailer(config, fakeFetch(() => ({ status: 429 })).fn);
    expect((await limited.sendCode("a@b.co")).ok).toBe(false);
    const down = new SupabaseOtpMailer(config, fakeFetch(() => new Error("offline")).fn);
    expect((await down.sendCode("a@b.co")).ok).toBe(false);

    const rejected = new SupabaseOtpMailer(config, fakeFetch(() => ({ status: 403, body: { msg: "Token has expired or is invalid" } })).fn);
    expect(await rejected.verifyCode("a@b.co", "000000")).toBe(false);
    for (const status of [500, 429]) {
      await expect(new SupabaseOtpMailer(config, fakeFetch(() => ({ status })).fn).verifyCode("a@b.co", "000000")).rejects.toBeInstanceOf(OtpUnavailableError);
    }
    await expect(down.verifyCode("a@b.co", "000000")).rejects.toBeInstanceOf(OtpUnavailableError);
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
  it("refuses test adapters and a half-configured Supabase", () => {
    expect(() => loadConfig({ ...prod, CLUEQUEST_ADAPTER: "test" })).toThrow(/CLUEQUEST_ADAPTER=test/);
    expect(() => loadConfig({ ...prod, EMAIL_ADAPTER: "test" })).toThrow(/EMAIL_ADAPTER=test/);
    expect(() => loadConfig({ ...prod, SUPABASE_ANON_KEY: "" })).toThrow(/SUPABASE_URL and SUPABASE_ANON_KEY/);
    expect(() => loadConfig({ ...prod, PAYSTACK_ADAPTER: "live" })).not.toThrow();
  });
});
