import { Router } from "express";
import type { Ctx } from "../lib/ctx.js";
import { TestPaystackClient } from "../services/adapters.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Test-only helpers. Mounted solely when ENABLE_TEST_ENDPOINTS=1 (refused in production by config).
 * Nothing here talks to the real ClueQuest, Paystack or Supabase.
 */
export function testRouter(ctx: Ctx) {
  const r = Router();

  r.get("/emails", async (req, res) => {
    const to = typeof req.query.to === "string" ? req.query.to.toLowerCase() : undefined;
    const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
    const emails = await ctx.db.emailMessage.findMany({ where: { to, kind }, orderBy: { createdAt: "desc" }, take: 20 });
    res.json({ emails });
  });

  /** Lets browser tests build a correctly signed ClueQuest callback for a real attempt. */
  r.get("/attempts", async (req, res) => {
    const classId = String(req.query.classId ?? "");
    const email = String(req.query.email ?? "").toLowerCase();
    const attempts = await ctx.db.quizAttempt.findMany({
      where: { classId, user: { email } },
      orderBy: { attemptNo: "desc" },
      select: { id: true, studentRef: true, quizId: true, attemptNo: true, status: true },
    });
    res.json({ attempts });
  });

  r.post("/expire-code", async (req, res) => {
    const email = String(req.body?.email ?? "").toLowerCase();
    await ctx.db.otpCode.updateMany({ where: { email }, data: { expiresAt: new Date(Date.now() - 1000) } });
    res.json({ ok: true });
  });

  /** Stand-in for the ClueQuest quiz page, so the same-tab handoff and return can be exercised in browsers. */
  r.get("/quiz/launch", (req, res) => {
    const back = String(req.query.return ?? "");
    res.type("html").send(
      `<!doctype html><html lang="en"><head><title>Test ClueQuest quiz</title></head><body style="font-family:sans-serif;padding:2rem"><h1>Test ClueQuest quiz stand-in</h1><p>Attempt <code id="attempt">${esc(String(req.query.attempt ?? ""))}</code></p><p>No account, name or room code was asked for.</p><a id="return" href="${esc(back)}">Return to MS Virtual Academy</a></body></html>`,
    );
  });

  r.get("/paystack/pay", (req, res) => {
    res.type("html").send(`<!doctype html><html lang="en"><body><h1>Test Paystack checkout</h1><p>${esc(String(req.query.reference ?? ""))}</p></body></html>`);
  });

  r.post("/paystack/complete", (req, res) => {
    const p = ctx.paystack;
    if (!(p instanceof TestPaystackClient)) return res.status(400).json({ error: "not the test adapter" });
    const cur = p.results.get(String(req.body?.reference));
    if (!cur) return res.status(404).json({ error: "unknown reference" });
    p.results.set(cur.reference, { ...cur, status: req.body?.status ?? "success", amountKobo: req.body?.amountKobo ?? cur.amountKobo, currency: req.body?.currency ?? cur.currency });
    res.json({ ok: true });
  });

  return r;
}
