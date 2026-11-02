import { z } from "zod";
import type { Config } from "../lib/config.js";
import type { Ctx } from "../lib/ctx.js";
import { HttpError, badRequest } from "../lib/http.js";
import { hmacHex, randomToken, safeEqualHex } from "../lib/security.js";
import { ensureEligibility } from "./certificate.js";
import { enqueueSync } from "./jobs.js";
import { requireClassAccess } from "./progress.js";
import { QuizNotConfiguredError } from "./adapters.js";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function baseOrigin(config: Config) {
  if (!config.CLUEQUEST_BASE_URL) throw new HttpError(503, "QUIZ_NOT_CONFIGURED", "CLUEQUEST_BASE_URL is not configured on the server.");
  try {
    return new URL(config.CLUEQUEST_BASE_URL).origin;
  } catch {
    throw new HttpError(503, "QUIZ_NOT_CONFIGURED", "CLUEQUEST_BASE_URL is not a valid URL.");
  }
}

/** Accepts a ClueQuest quiz id, or an address on the ClueQuest site that contains one, and returns the id. */
export function parseQuizId(config: Config, raw: string): string {
  const text = raw.trim();
  if (/^https?:\/\//i.test(text)) {
    let u: URL;
    try {
      u = new URL(text);
    } catch {
      throw badRequest("Quiz link must be a full web address.");
    }
    const origin = baseOrigin(config);
    if (u.origin !== origin) throw badRequest(`Quiz link must be on ${origin}.`);
    const m = u.pathname.match(UUID);
    if (!m) throw badRequest("That ClueQuest address does not contain a quiz ID. Use the quiz ID from its Use page.");
    return m[0].toLowerCase();
  }
  if (text.length === 36 && UUID.test(text)) return text.toLowerCase();
  throw badRequest("Enter the quiz ID from ClueQuest, for example 9f0c2d1e-4b7a-4c1d-8e55-0a1b2c3d4e5f.");
}

/** Multiplayer room links must be on the ClueQuest site. */
export function normaliseRoomUrl(config: Config, raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw badRequest("Multiplayer link must be a full web address.");
  }
  const origin = baseOrigin(config);
  if (u.origin !== origin) throw badRequest(`Multiplayer link must be on ${origin}.`);
  u.hash = "";
  return u.toString();
}

/** Resolves the tutor's input to a quiz id and confirms with ClueQuest that it can be assigned. */
export async function validateQuiz(ctx: Ctx, rawQuiz: string) {
  const quizId = parseQuizId(ctx.config, rawQuiz);
  let check;
  try {
    check = await ctx.quiz.checkQuiz(quizId);
  } catch (e) {
    if (e instanceof QuizNotConfiguredError) throw new HttpError(503, "QUIZ_NOT_CONFIGURED", e.message);
    throw new HttpError(503, "QUIZ_UNAVAILABLE", "ClueQuest could not be reached to check this quiz. Try again shortly.");
  }
  if (!check.ok) throw badRequest(check.reason ?? "ClueQuest does not recognise this quiz.");
  return { quizId, title: check.title ?? "" };
}

/** Assignment references that start with this belong to a tutor previewing a quiz; their results are never stored. */
export const PREVIEW_PREFIX = "preview-";

/** Maps a failed launch to the message a person should see. */
function launchError(e: unknown) {
  if (e instanceof QuizNotConfiguredError) return new HttpError(503, "QUIZ_UNAVAILABLE", "Quizzes are not available yet. Please try again later.");
  console.error("[quiz] launch failed:", e instanceof Error ? `${e.message}${e.cause ? ` (${String(e.cause)})` : ""}` : e);
  return new HttpError(502, "QUIZ_ERROR", "We could not reach the quiz service. Please try again.");
}

/**
 * Lets a tutor take the real quiz from the class preview. No QuizAttempt is created, so nothing reaches the
 * students' progress, the tutor's results or the Sheets queue, and every launch is a fresh assignment.
 */
export async function launchQuizPreview(ctx: Ctx, cls: { id: string; quizId: string }) {
  if (!cls.quizId) throw new HttpError(409, "NO_QUIZ", "Attach a quiz to this class first.");
  try {
    const launch = await ctx.quiz.createLaunch({
      quizId: cls.quizId,
      assignmentRef: `${PREVIEW_PREFIX}${cls.id}-${randomToken(8)}`,
      learnerRef: `${PREVIEW_PREFIX}${randomToken(12)}`,
      returnUrl: `${ctx.config.APP_URL}/tutor/classes/${cls.id}/preview?returned=1`,
      passMarkPercent: ctx.config.QUIZ_PASS_MARK_PERCENT,
    });
    return { launchUrl: launch.launchUrl };
  } catch (e) {
    throw launchError(e);
  }
}

export async function launchQuiz(ctx: Ctx, userId: string, classId: string) {
  const { db, config } = ctx;
  const { cls, view } = await requireClassAccess(db, config, userId, classId);
  if (!cls.quizId) throw new HttpError(409, "NO_QUIZ", "This class has no quiz attached yet.");
  if (view.state === "PASSED") throw new HttpError(409, "ALREADY_PASSED", "You have already passed this quiz.");
  if (view.state === "PENDING") throw new HttpError(409, "RESULT_PENDING", "Your result is still being processed.");
  if (view.state === "NO_RETAKE") throw new HttpError(403, "NO_RETAKE", "You have used all your attempts for this quiz. Contact your tutor.");
  if (!view.quizEligible) throw new HttpError(403, "NOT_ELIGIBLE", `Watch at least ${config.WATCH_THRESHOLD_PERCENT}% of the class to unlock the quiz.`);

  const attempt = await db.$transaction(async (tx) => {
    const open = await tx.quizAttempt.findFirst({ where: { userId, classId, status: "LAUNCHED" }, orderBy: { attemptNo: "desc" } });
    if (open) return open;
    const count = await tx.quizAttempt.count({ where: { userId, classId } });
    return tx.quizAttempt.create({
      data: { userId, classId, quizId: cls.quizId, attemptNo: count + 1, studentRef: randomToken(18) },
    });
  });

  try {
    const launch = await ctx.quiz.createLaunch({
      quizId: attempt.quizId,
      assignmentRef: attempt.id,
      learnerRef: attempt.studentRef,
      returnUrl: `${config.APP_URL}/classes/${classId}?returned=1`,
      passMarkPercent: config.QUIZ_PASS_MARK_PERCENT,
    });
    await db.quizAttempt.update({ where: { id: attempt.id }, data: { launchExpires: launch.expiresAt } });
    return { launchUrl: launch.launchUrl, attemptNo: attempt.attemptNo };
  } catch (e) {
    throw launchError(e);
  }
}

/** Called when the student lands back on the class page. A redirect never marks a quiz as passed. */
export async function markReturned(ctx: Ctx, userId: string, classId: string) {
  await ctx.db.quizAttempt.updateMany({ where: { userId, classId, status: "LAUNCHED", returnedAt: null }, data: { returnedAt: new Date() } });
}

/** The `attempt.submitted` event from ClueQuest (its docs/PARTNER_INTEGRATION.md, section 3). */
const resultSchema = z.object({
  eventId: z.string().min(1).max(200),
  type: z.literal("attempt.submitted"),
  partnerAssignmentRef: z.string().min(1),
  learnerRef: z.string().min(1),
  attemptId: z.string().min(1).max(200),
  quizId: z.string().min(1),
  marksEarned: z.number().finite().min(0),
  marksPossible: z.number().finite().positive(),
  passMarkPercent: z.number().finite().min(0).max(100).nullable().optional(),
  passed: z.boolean(),
  submittedAt: z.string().datetime().optional(),
});

export const QUIZ_SIGNATURE_HEADER = "x-cluequest-signature";
export const QUIZ_TIMESTAMP_HEADER = "x-cluequest-timestamp";

/** Header value: `v1=` + hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`). */
export function signQuizPayload(secret: string, timestamp: string, rawBody: string) {
  return `v1=${hmacHex("sha256", secret, `${timestamp}.${rawBody}`)}`;
}

export async function processQuizResult(ctx: Ctx, rawBody: Buffer, signature: string | undefined, timestamp: string | undefined) {
  const { db, config } = ctx;
  if (!config.CLUEQUEST_WEBHOOK_SECRET) throw new HttpError(503, "QUIZ_NOT_CONFIGURED", "Result callbacks are not configured.");
  const ts = Number(timestamp);
  if (!signature || !timestamp || !Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    throw new HttpError(401, "BAD_SIGNATURE", "Invalid or stale signature");
  }
  const expected = signQuizPayload(config.CLUEQUEST_WEBHOOK_SECRET, timestamp, rawBody.toString("utf8"));
  const given = signature.startsWith("v1=") ? signature.slice(3) : "";
  if (!safeEqualHex(expected.slice(3), given)) throw new HttpError(401, "BAD_SIGNATURE", "Invalid or stale signature");

  let json: unknown;
  try {
    json = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw badRequest("Body must be JSON");
  }
  const p = resultSchema.safeParse(json);
  if (!p.success) throw new HttpError(422, "INVALID_PAYLOAD", "Payload failed validation", p.error.issues.map((i) => i.path.join(".")));
  const r = p.data;
  // A tutor's preview attempt: acknowledge it so ClueQuest stops retrying, but keep nothing.
  if (r.partnerAssignmentRef.startsWith(PREVIEW_PREFIX)) return "preview" as const;

  const attempt = await db.quizAttempt.findUnique({ where: { id: r.partnerAssignmentRef } });
  if (!attempt || attempt.studentRef !== r.learnerRef) throw new HttpError(422, "UNKNOWN_ATTEMPT", "No matching attempt");
  if (attempt.quizId.toLowerCase() !== r.quizId.toLowerCase()) throw new HttpError(422, "QUIZ_MISMATCH", "Quiz does not match the launched attempt");

  const outcome = await db.$transaction(async (tx) => {
    const seen = await tx.callbackEvent.findUnique({ where: { eventId: r.eventId } });
    if (seen) return "duplicate" as const;
    const fresh = await tx.quizAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    if (fresh.resultAt) {
      await tx.callbackEvent.create({ data: { eventId: r.eventId, attemptId: attempt.id, outcome: "ignored_already_resolved" } });
      return "ignored" as const;
    }
    const clash = await tx.quizAttempt.findUnique({ where: { providerAttemptId: r.attemptId } });
    if (clash && clash.id !== attempt.id) throw new HttpError(422, "ATTEMPT_CLASH", "Attempt already linked elsewhere");
    await tx.quizAttempt.update({
      where: { id: attempt.id },
      data: {
        status: r.passed ? "PASSED" : "FAILED",
        passed: r.passed,
        score: r.marksEarned,
        maxScore: r.marksPossible,
        passMark: r.passMarkPercent == null ? null : Math.round(((r.marksPossible * r.passMarkPercent) / 100) * 100) / 100,
        providerAttemptId: r.attemptId,
        resultAt: r.submittedAt ? new Date(r.submittedAt) : new Date(),
      },
    });
    await tx.callbackEvent.create({ data: { eventId: r.eventId, attemptId: attempt.id, outcome: "applied" } });
    return "applied" as const;
  });

  if (outcome === "applied") {
    await enqueueSync(ctx, "score", attempt.id, { attemptId: attempt.id });
    if (r.passed) {
      const cls = await db.class.findUniqueOrThrow({ where: { id: attempt.classId } });
      await ensureEligibility(ctx, attempt.userId, cls.trackId).catch(() => undefined);
    }
  }
  return outcome;
}
