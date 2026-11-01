import type { Config } from "../lib/config.js";
import type { DbOrTx } from "../lib/db.js";
import { HttpError, forbidden, notFound } from "../lib/http.js";

export type ClassState =
  | "LOCKED"
  | "WATCH"
  | "RESUME"
  | "QUIZ"
  | "RESUME_QUIZ"
  | "PENDING"
  | "RETAKE"
  | "NO_RETAKE"
  | "PASSED";

export const ACTION_LABEL: Record<ClassState, string> = {
  LOCKED: "Locked",
  WATCH: "Watch class",
  RESUME: "Resume class",
  QUIZ: "Take session quiz",
  RESUME_QUIZ: "Resume session quiz",
  PENDING: "Result pending",
  RETAKE: "Retake quiz",
  NO_RETAKE: "Retake not available",
  PASSED: "Continue",
};

export function parseYoutubeId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\.|^m\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0] ?? null;
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (u.pathname === "/watch") id = u.searchParams.get("v");
      else {
        const m = u.pathname.match(/^\/(embed|shorts|live)\/([^/]+)/);
        id = m?.[2] ?? null;
      }
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export interface AttemptView {
  id: string;
  attemptNo: number;
  status: string;
  score: number | null;
  maxScore: number | null;
  passMark: number | null;
  passed: boolean | null;
  launchedAt: Date;
  resultAt: Date | null;
}

export interface ClassView {
  id: string;
  title: string;
  description: string;
  moduleId: string;
  moduleTitle: string;
  modulePosition: number;
  isFinal: boolean;
  releaseAt: Date | null;
  state: ClassState;
  actionLabel: string;
  watchedPercent: number;
  positionSeconds: number;
  quizEligible: boolean;
  attempts: AttemptView[];
  best: AttemptView | null;
}

export interface TrackView {
  enrolmentId: string;
  track: { id: string; name: string; isPremium: boolean };
  cohort: { id: string; name: string; nextSessionAt: Date | null };
  accessible: boolean;
  classes: ClassView[];
  upcoming: { releaseAt: Date }[];
  passedCount: number;
  totalCount: number;
  percent: number;
  nextSessionAt: Date | null;
}

const toAttemptView = (a: {
  id: string;
  attemptNo: number;
  status: string;
  score: number | null;
  maxScore: number | null;
  passMark: number | null;
  passed: boolean | null;
  launchedAt: Date;
  resultAt: Date | null;
}): AttemptView => ({
  id: a.id,
  attemptNo: a.attemptNo,
  status: a.status,
  score: a.score,
  maxScore: a.maxScore,
  passMark: a.passMark,
  passed: a.passed,
  launchedAt: a.launchedAt,
  resultAt: a.resultAt,
});

export function deriveState(
  watched: number,
  threshold: number,
  position: number,
  attempts: { status: string; passed: boolean | null; returnedAt: Date | null; attemptNo: number }[],
  maxAttempts = 0,
): ClassState {
  if (attempts.some((a) => a.passed === true)) return "PASSED";
  const latest = [...attempts].sort((a, b) => b.attemptNo - a.attemptNo)[0];
  if (latest) {
    if (latest.status === "LAUNCHED") return latest.returnedAt ? "PENDING" : "RESUME_QUIZ";
    if (latest.status === "FAILED") return maxAttempts > 0 && attempts.length >= maxAttempts ? "NO_RETAKE" : "RETAKE";
  }
  if (watched >= threshold) return "QUIZ";
  return watched > 0 || position > 0 ? "RESUME" : "WATCH";
}

export async function buildTrackViews(db: DbOrTx, config: Config, userId: string, now = new Date()): Promise<TrackView[]> {
  const enrolments = await db.enrolment.findMany({
    where: { userId, status: "ACTIVE" },
    include: { track: true, cohort: true },
    orderBy: { createdAt: "asc" },
  });
  const entitlements = await db.entitlement.findMany({ where: { userId } });
  const owned = new Set(entitlements.map((e) => e.trackId));
  const views: TrackView[] = [];
  for (const en of enrolments) {
    const accessible = !en.track.isPremium || owned.has(en.trackId);
    const classes = await db.class.findMany({
      where: { cohortId: en.cohortId, trackId: en.trackId, status: "PUBLISHED" },
      include: { module: true },
    });
    classes.sort(
      (a, b) =>
        a.module.position - b.module.position ||
        a.position - b.position ||
        (a.releaseAt?.getTime() ?? 0) - (b.releaseAt?.getTime() ?? 0),
    );
    const progress = await db.viewProgress.findMany({ where: { userId, classId: { in: classes.map((c) => c.id) } } });
    const attempts = await db.quizAttempt.findMany({ where: { userId, classId: { in: classes.map((c) => c.id) } } });
    const passedIds = new Set(attempts.filter((a) => a.passed === true).map((a) => a.classId));

    const modulePositionUnlocked = (pos: number) =>
      classes.filter((c) => c.module.position < pos).every((c) => passedIds.has(c.id));

    const visible: ClassView[] = [];
    const upcoming: { releaseAt: Date }[] = [];
    for (const c of classes) {
      if (!c.releaseAt || c.releaseAt > now) {
        if (c.releaseAt) upcoming.push({ releaseAt: c.releaseAt });
        continue;
      }
      const p = progress.find((x) => x.classId === c.id);
      const cAttempts = attempts.filter((a) => a.classId === c.id);
      const locked = !accessible || !modulePositionUnlocked(c.module.position);
      const watched = p?.watchedPercent ?? 0;
      const state: ClassState = locked ? "LOCKED" : deriveState(watched, config.WATCH_THRESHOLD_PERCENT, p?.positionSeconds ?? 0, cAttempts, config.QUIZ_MAX_ATTEMPTS);
      const views = cAttempts.sort((a, b) => a.attemptNo - b.attemptNo).map(toAttemptView);
      const scored = views.filter((v) => v.score !== null);
      const best = views.find((v) => v.passed) ?? scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0] ?? null;
      visible.push({
        id: c.id,
        title: c.title,
        description: c.description,
        moduleId: c.moduleId,
        moduleTitle: c.module.title,
        modulePosition: c.module.position,
        isFinal: c.module.isFinal,
        releaseAt: c.releaseAt,
        state,
        actionLabel: ACTION_LABEL[state],
        watchedPercent: watched,
        positionSeconds: p?.positionSeconds ?? 0,
        quizEligible: !locked && watched >= config.WATCH_THRESHOLD_PERCENT,
        attempts: views,
        best,
      });
    }
    const passedCount = classes.filter((c) => passedIds.has(c.id)).length;
    upcoming.sort((a, b) => a.releaseAt.getTime() - b.releaseAt.getTime());
    const nextSession = upcoming[0]?.releaseAt ?? (en.cohort.nextSessionAt && en.cohort.nextSessionAt > now ? en.cohort.nextSessionAt : null);
    views.push({
      enrolmentId: en.id,
      track: { id: en.track.id, name: en.track.name, isPremium: en.track.isPremium },
      cohort: { id: en.cohort.id, name: en.cohort.name, nextSessionAt: en.cohort.nextSessionAt },
      accessible,
      classes: visible,
      upcoming,
      passedCount,
      totalCount: classes.length,
      percent: classes.length ? Math.round((passedCount / classes.length) * 100) : 0,
      nextSessionAt: nextSession,
    });
  }
  return views;
}

export interface Primary {
  kind: "ACTION" | "WAITING" | "DONE" | "NONE";
  state?: ClassState;
  label?: string;
  classId?: string;
  classTitle?: string;
  trackName?: string;
  message?: string;
}

/** Answers "What do I do next?" from the student's track views. */
export function pickPrimary(tracks: TrackView[]): Primary {
  if (tracks.length === 0) return { kind: "NONE", message: "You are not enrolled in an active track yet." };
  for (const t of tracks) {
    if (!t.accessible) continue;
    const next = t.classes.find((c) => c.state !== "PASSED" && c.state !== "LOCKED");
    if (next) {
      const hasPassedBefore = t.classes.some((c) => c.state === "PASSED");
      const label = next.state === "WATCH" && hasPassedBefore ? "Continue" : next.actionLabel;
      return { kind: "ACTION", state: next.state, label, classId: next.id, classTitle: next.title, trackName: t.track.name };
    }
  }
  const t = tracks.find((x) => x.accessible) ?? tracks[0];
  if (t.upcoming.length || t.classes.length === 0) {
    return {
      kind: "WAITING",
      trackName: t.track.name,
      message: t.nextSessionAt ? "No class is open right now. Your next session is scheduled." : "No class is open right now. A date has not been announced yet.",
    };
  }
  return { kind: "DONE", trackName: t.track.name, message: "You have completed every available class." };
}

/** True when every published class for the student's cohort is passed (and the final module, if defined, has content). */
export async function isTrackComplete(db: DbOrTx, userId: string, trackId: string): Promise<boolean> {
  const en = await db.enrolment.findUnique({ where: { userId_trackId: { userId, trackId } } });
  if (!en || en.status !== "ACTIVE") return false;
  const classes = await db.class.findMany({
    where: { cohortId: en.cohortId, trackId, status: "PUBLISHED" },
    include: { module: true },
  });
  if (classes.length === 0) return false;
  const finalModule = await db.module.findFirst({ where: { trackId, isFinal: true } });
  if (finalModule && !classes.some((c) => c.moduleId === finalModule.id)) return false;
  const passed = await db.quizAttempt.findMany({
    where: { userId, passed: true, classId: { in: classes.map((c) => c.id) } },
    select: { classId: true },
  });
  const ids = new Set(passed.map((p) => p.classId));
  return classes.every((c) => ids.has(c.id));
}

/**
 * Server-side gate used by every student class endpoint, including direct URL access.
 * Checks enrolment, cohort, release time, premium entitlement and module prerequisites.
 */
export async function requireClassAccess(db: DbOrTx, config: Config, userId: string, classId: string, now = new Date()) {
  const cls = await db.class.findUnique({ where: { id: classId }, include: { module: true, track: true } });
  // Same response for unknown, draft and other-cohort classes so existence is not leaked.
  if (!cls || cls.status !== "PUBLISHED") throw notFound("Class");
  const en = await db.enrolment.findUnique({ where: { userId_trackId: { userId, trackId: cls.trackId } } });
  if (!en || en.status !== "ACTIVE" || en.cohortId !== cls.cohortId) throw notFound("Class");
  if (!cls.releaseAt || cls.releaseAt > now) throw notFound("Class");
  if (cls.track.isPremium) {
    const ent = await db.entitlement.findUnique({ where: { userId_trackId: { userId, trackId: cls.trackId } } });
    if (!ent) throw forbidden("This is a premium course. Purchase access to continue.");
  }
  const views = await buildTrackViews(db, config, userId, now);
  const tv = views.find((v) => v.track.id === cls.trackId);
  const view = tv?.classes.find((c) => c.id === cls.id);
  if (!view || view.state === "LOCKED") {
    throw new HttpError(403, "LOCKED", "Pass the quizzes in the earlier modules to unlock this class.");
  }
  return { cls, enrolment: en, view };
}
