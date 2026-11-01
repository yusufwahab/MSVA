import type { Ctx } from "../lib/ctx.js";
import type { DbOrTx } from "../lib/db.js";
import { HttpError } from "../lib/http.js";
import { randomToken, sha256 } from "../lib/security.js";
import { enqueueSync } from "./jobs.js";

export async function nextStudentCode(db: DbOrTx): Promise<string> {
  const c = await db.counter.upsert({
    where: { key: "student" },
    update: { value: { increment: 1 } },
    create: { key: "student", value: 1 },
  });
  return `MSVA-${String(c.value).padStart(5, "0")}`;
}

/**
 * Asks the mailer (Supabase Auth in production) to email a one-time code to the account's address.
 * A newer code replaces the earlier one, so "resend" and "correct the email" supersede old codes.
 */
export async function sendActivationCode(ctx: Ctx, userId: string) {
  const user = await ctx.db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.status !== "INVITED") throw new HttpError(409, "NOT_INVITED", "This account has already been activated.");
  const r = await ctx.mailer.sendCode(user.email);
  return { sent: r.ok, error: r.error };
}

export async function sendResetCode(ctx: Ctx, userId: string) {
  const user = await ctx.db.user.findUniqueOrThrow({ where: { id: userId } });
  const r = await ctx.mailer.sendCode(user.email);
  return { sent: r.ok, error: r.error };
}

export async function createSession(ctx: Ctx, userId: string) {
  const raw = randomToken(32);
  const expiresAt = new Date(Date.now() + ctx.config.SESSION_TTL_DAYS * 86400_000);
  await ctx.db.session.create({ data: { tokenHash: sha256(raw), userId, expiresAt } });
  return { raw, expiresAt };
}

export async function revokeSessions(db: DbOrTx, userId: string) {
  await db.session.deleteMany({ where: { userId } });
}

/** Creates (or extends) a student with an INVITED enrolment. Returns the user and whether it was new. */
export async function addStudentEnrolment(
  ctx: Ctx,
  input: { name: string; email: string; trackId: string; cohortId: string },
) {
  const { db } = ctx;
  const cohort = await db.cohort.findUnique({ where: { id: input.cohortId } });
  if (!cohort || cohort.trackId !== input.trackId) throw new HttpError(400, "BAD_COHORT", "That cohort does not belong to the selected track.");

  const result = await db.$transaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { email: input.email } });
    let created = false;
    if (user && user.role !== "STUDENT") throw new HttpError(409, "EMAIL_IN_USE", "That email belongs to a staff account.");
    if (!user) {
      user = await tx.user.create({
        data: { email: input.email, name: input.name, role: "STUDENT", status: "INVITED", studentCode: await nextStudentCode(tx) },
      });
      created = true;
    }
    const existing = await tx.enrolment.findUnique({ where: { userId_trackId: { userId: user.id, trackId: input.trackId } } });
    let enrolment = existing;
    let enrolmentCreated = false;
    if (!existing) {
      enrolment = await tx.enrolment.create({
        data: { userId: user.id, trackId: input.trackId, cohortId: input.cohortId, status: user.status === "ACTIVE" ? "ACTIVE" : "INVITED" },
      });
      enrolmentCreated = true;
    }
    return { user, created, enrolment: enrolment!, enrolmentCreated };
  });

  let email: { sent: boolean; error?: string } | null = null;
  if (result.user.status === "INVITED" && (result.created || result.enrolmentCreated)) email = await sendActivationCode(ctx, result.user.id);
  if (result.created) await enqueueSync(ctx, "registration", result.user.id, { userId: result.user.id });
  if (result.enrolmentCreated) await enqueueSync(ctx, "enrolment", result.enrolment.id, { enrolmentId: result.enrolment.id });
  return { ...result, email };
}
