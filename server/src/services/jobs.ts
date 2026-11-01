import type { Ctx } from "../lib/ctx.js";

const MAX_ATTEMPTS = 8;

/** Queues a one-way Google Sheets update. Never throws: a Sheets problem must not block onboarding or assessments. */
export async function enqueueSync(ctx: Ctx, kind: "registration" | "enrolment" | "score", entityId: string, payload: Record<string, string>) {
  if (!ctx.sheets) return;
  try {
    await ctx.db.syncJob.create({ data: { kind, dedupeKey: `${kind}:${entityId}:${Date.now()}`, payload } });
  } catch {
    /* swallow: queueing is best-effort */
  }
}

async function rowFor(ctx: Ctx, kind: string, payload: Record<string, string>): Promise<{ tab: string; values: (string | number)[] } | null> {
  const { db } = ctx;
  if (kind === "registration") {
    const u = await db.user.findUnique({ where: { id: payload.userId } });
    if (!u) return null;
    return { tab: "Registrations", values: [u.studentCode ?? "", u.name, u.email, u.createdAt.toISOString()] };
  }
  if (kind === "enrolment") {
    const e = await db.enrolment.findUnique({ where: { id: payload.enrolmentId }, include: { user: true, track: true, cohort: true } });
    if (!e) return null;
    return { tab: "Enrolments", values: [e.user.studentCode ?? "", e.user.email, e.track.name, e.cohort.name, e.status, new Date().toISOString()] };
  }
  if (kind === "score") {
    const a = await db.quizAttempt.findUnique({ where: { id: payload.attemptId }, include: { user: true, class: { include: { track: true } } } });
    if (!a) return null;
    return {
      tab: "Scores",
      values: [a.user.studentCode ?? "", a.class.track.name, a.class.title, a.attemptNo, a.score ?? "", a.maxScore ?? "", a.passed ? "PASS" : "FAIL", a.resultAt?.toISOString() ?? ""],
    };
  }
  return null;
}

/** Runs due jobs with exponential back-off. Returns counts for the admin view. */
export async function processDueJobs(ctx: Ctx, limit = 25) {
  const out = { done: 0, retried: 0, failed: 0 };
  if (!ctx.sheets) return out;
  const jobs = await ctx.db.syncJob.findMany({
    where: { status: "PENDING", nextRunAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  for (const job of jobs) {
    try {
      const row = await rowFor(ctx, job.kind, job.payload as Record<string, string>);
      if (row) await ctx.sheets.appendRow(row.tab, row.values);
      await ctx.db.syncJob.update({ where: { id: job.id }, data: { status: "DONE", doneAt: new Date(), attempts: { increment: 1 }, lastError: null } });
      out.done++;
    } catch (e) {
      const attempts = job.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await ctx.db.syncJob.update({
        where: { id: job.id },
        data: {
          attempts,
          status: giveUp ? "FAILED" : "PENDING",
          nextRunAt: new Date(Date.now() + Math.min(2 ** attempts * 30_000, 3600_000)),
          lastError: e instanceof Error ? e.message.slice(0, 300) : "Unknown error",
        },
      });
      if (giveUp) out.failed++;
      else out.retried++;
    }
  }
  return out;
}
