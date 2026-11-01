import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { Ctx } from "../lib/ctx.js";
import { HttpError, body, emailSchema, passwordSchema } from "../lib/http.js";
import { hashPassword, randomToken, sha256, verifyPassword } from "../lib/security.js";
import { SESSION_COOKIE, requireAuth } from "../middleware/auth.js";
import { createSession, revokeSessions, sendActivationCode, sendResetCode } from "../services/people.js";
import { OtpUnavailableError } from "../services/adapters.js";
import { enqueueSync } from "../services/jobs.js";

export function setSessionCookie(ctx: Ctx, res: Response, raw: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, raw, {
    httpOnly: true,
    sameSite: "lax",
    secure: ctx.config.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export const publicUser = (u: { id: string; email: string; name: string; role: string; studentCode: string | null }) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  studentCode: u.studentCode,
});

export function authRouter(ctx: Ctx) {
  const r = Router();
  const { db, config } = ctx;
  const limiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: config.NODE_ENV === "test" || config.ENABLE_TEST_ENDPOINTS ? 1000 : 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many attempts. Try again in a few minutes." } },
  });

  r.post("/login", limiter, async (req, res) => {
    const { email, password } = body(req, z.object({ email: emailSchema, password: z.string().min(1).max(200) }));
    const user = await db.user.findUnique({ where: { email } });
    const ok = user && user.status === "ACTIVE" && (await verifyPassword(password, user.passwordHash));
    if (!ok) throw new HttpError(401, "BAD_CREDENTIALS", "Email or password is incorrect, or the account is not active.");
    const s = await createSession(ctx, user.id);
    setSessionCookie(ctx, res, s.raw, s.expiresAt);
    res.json({ user: publicUser(user) });
  });

  r.post("/logout", async (req, res) => {
    const raw = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (raw) await db.session.deleteMany({ where: { tokenHash: sha256(raw) } });
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  r.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

  const purposeSchema = z.enum(["activate", "reset"]);
  const codeSchema = z.string().trim().min(4).max(12);

  /** Emails a one-time code. The response is identical whether or not the address belongs to an eligible account. */
  r.post("/otp/request", limiter, async (req, res) => {
    const { email, purpose } = body(req, z.object({ email: emailSchema, purpose: purposeSchema }));
    const user = await db.user.findUnique({ where: { email } });
    if (user && user.status === (purpose === "activate" ? "INVITED" : "ACTIVE")) {
      const r = purpose === "activate" ? await sendActivationCode(ctx, user.id) : await sendResetCode(ctx, user.id);
      if (!r.sent) console.error(`OTP email not sent (${purpose}): ${r.error}`);
    }
    res.status(202).json({ ok: true });
  });

  /**
   * Checks the emailed code, then finishes the action in the same request: activation sets the first password and
   * signs the student in; reset sets a new password and ends every open session.
   */
  r.post("/verify-otp", limiter, async (req, res) => {
    const { email, code, purpose, password } = body(req, z.object({ email: emailSchema, code: codeSchema, purpose: purposeSchema, password: passwordSchema }));
    const user = await db.user.findUnique({ where: { email } });
    let ok = false;
    if (user && user.status === (purpose === "activate" ? "INVITED" : "ACTIVE")) {
      try {
        ok = await ctx.mailer.verifyCode(email, code);
      } catch (e) {
        if (e instanceof OtpUnavailableError) throw new HttpError(503, "OTP_UNAVAILABLE", "We could not check your code right now. Please try again in a moment.");
        throw e;
      }
    }
    if (!ok || !user) throw new HttpError(400, "INVALID_CODE", "That code is not correct or has expired. Request a new one.");

    const passwordHash = await hashPassword(password);
    if (purpose === "reset") {
      await db.user.update({ where: { id: user.id }, data: { passwordHash } });
      await revokeSessions(db, user.id);
      return res.json({ ok: true });
    }
    const activated = await activateUser(ctx, user.id, { passwordHash });
    const s = await createSession(ctx, activated.id);
    setSessionCookie(ctx, res, s.raw, s.expiresAt);
    res.json({ user: publicUser(activated), redirectTo: homeFor(activated.role) });
  });

  /* ---------------------------------------------------------- Google */
  const googleRedirect = () => `${config.API_PUBLIC_URL}/api/auth/google/callback`;

  r.get("/google/start", (req, res) => {
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) throw new HttpError(404, "GOOGLE_DISABLED", "Google sign-in is not configured.");
    const nonce = randomToken(16);
    res.cookie("msva_oauth", JSON.stringify({ nonce }), { httpOnly: true, sameSite: "lax", maxAge: 10 * 60_000, secure: config.NODE_ENV === "production" });
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.search = new URLSearchParams({
      client_id: config.GOOGLE_CLIENT_ID,
      redirect_uri: googleRedirect(),
      response_type: "code",
      scope: "openid email profile",
      state: nonce,
      prompt: "select_account",
    }).toString();
    res.redirect(u.toString());
  });

  r.get("/google/callback", async (req, res) => {
    const fail = (code: string) => res.redirect(`${config.APP_URL}/sign-in?error=${code}`);
    try {
      const cookie = req.cookies?.msva_oauth ? (JSON.parse(req.cookies.msva_oauth as string) as { nonce: string }) : null;
      res.clearCookie("msva_oauth");
      if (!cookie || cookie.nonce !== req.query.state || typeof req.query.code !== "string") return fail("google_state");
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: req.query.code,
          client_id: config.GOOGLE_CLIENT_ID,
          client_secret: config.GOOGLE_CLIENT_SECRET,
          redirect_uri: googleRedirect(),
          grant_type: "authorization_code",
        }),
      });
      const tok = (await tokenRes.json()) as { id_token?: string };
      if (!tokenRes.ok || !tok.id_token) return fail("google_failed");
      // The id_token comes straight from Google's token endpoint over TLS, so its payload can be read directly.
      const claims = JSON.parse(Buffer.from(tok.id_token.split(".")[1]!, "base64url").toString()) as {
        email?: string;
        email_verified?: boolean;
        sub?: string;
        aud?: string;
      };
      if (claims.aud !== config.GOOGLE_CLIENT_ID || !claims.email || claims.email_verified !== true || !claims.sub) return fail("google_unverified");
      const email = claims.email.toLowerCase();
      let user = await db.user.findUnique({ where: { email } });
      if (!user) return fail("google_not_invited");
      if (user.status === "DEACTIVATED") return fail("inactive");
      if (user.status === "INVITED") {
        // Google has verified this address, and an admin invited it, so no emailed code is needed.
        user = await activateUser(ctx, user.id, { googleSub: claims.sub });
      } else if (user.googleSub && user.googleSub !== claims.sub) {
        return fail("google_failed");
      } else if (!user.googleSub) {
        user = await db.user.update({ where: { id: user.id }, data: { googleSub: claims.sub } });
      }
      const s = await createSession(ctx, user.id);
      setSessionCookie(ctx, res, s.raw, s.expiresAt);
      res.redirect(`${config.APP_URL}${homeFor(user.role)}`);
    } catch {
      fail("google_failed");
    }
  });

  return r;
}

const homeFor = (role: string) => (role === "STUDENT" ? "/dashboard" : role === "TUTOR" ? "/tutor" : "/admin");

/** Activates the account and only the enrolments an admin approved. Fails if it was already activated. */
export async function activateUser(ctx: Ctx, userId: string, creds: { passwordHash?: string; googleSub?: string }) {
  const { db } = ctx;
  const user = await db.$transaction(async (tx) => {
    const claimed = await tx.user.updateMany({ where: { id: userId, status: "INVITED" }, data: { status: "ACTIVE", activatedAt: new Date(), ...creds } });
    if (claimed.count !== 1) throw new HttpError(409, "ALREADY_ACTIVE", "This account has already been activated.");
    await tx.enrolment.updateMany({ where: { userId, status: "INVITED" }, data: { status: "ACTIVE" } });
    return tx.user.findUniqueOrThrow({ where: { id: userId } });
  });
  const enrolments = await db.enrolment.findMany({ where: { userId, status: "ACTIVE" }, select: { id: true } });
  for (const e of enrolments) await enqueueSync(ctx, "enrolment", e.id, { enrolmentId: e.id });
  return user;
}
