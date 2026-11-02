import { Router } from "express";
import { z } from "zod";
import type { Ctx } from "../lib/ctx.js";
import { HttpError, body, forbidden, notFound } from "../lib/http.js";
import { requireRole } from "../middleware/auth.js";
import { launchQuizPreview, normaliseRoomUrl, parseQuizId, validateQuiz } from "../services/quiz.js";
import { parseYoutubeId } from "../services/progress.js";

export function tutorRouter(ctx: Ctx) {
  const r = Router();
  const { db, config } = ctx;
  r.use(requireRole("TUTOR"));

  const trackIds = async (userId: string) =>
    (await db.tutorAssignment.findMany({ where: { userId, removedAt: null }, select: { trackId: true } })).map((a) => a.trackId);

  /** Loads a class only if it belongs to one of the tutor's currently assigned tracks. */
  async function ownClass(userId: string, id: string) {
    const cls = await db.class.findUnique({ where: { id }, include: { track: true, cohort: true, module: true } });
    if (!cls) throw notFound("Class");
    if (!(await trackIds(userId)).includes(cls.trackId)) throw notFound("Class");
    return cls;
  }

  const stateOf = (c: { status: string; releaseAt: Date | null }) =>
    c.status === "DRAFT" ? "Draft" : c.releaseAt && c.releaseAt > new Date() ? "Scheduled" : "Live";

  const summary = (c: Awaited<ReturnType<typeof ownClass>>) => ({
    id: c.id, title: c.title, status: c.status, state: stateOf(c), releaseAt: c.releaseAt, updatedAt: c.updatedAt,
    track: { id: c.trackId, name: c.track.name }, cohort: { id: c.cohortId, name: c.cohort.name }, module: { id: c.moduleId, title: c.module.title, position: c.module.position },
    hasVideo: Boolean(c.youtubeId), hasQuiz: Boolean(c.quizId),
  });

  const detail = (c: Awaited<ReturnType<typeof ownClass>>) => ({
    ...summary(c),
    description: c.description, youtubeUrl: c.youtubeUrl, youtubeId: c.youtubeId,
    quizId: c.quizId, quizTitle: c.quizTitle, multiplayerUrl: c.multiplayerUrl,
  });

  r.get("/overview", async (req, res) => {
    const ids = await trackIds(req.user!.id);
    const tracks = await db.track.findMany({
      where: { id: { in: ids }, archived: false },
      include: { cohorts: { orderBy: { createdAt: "asc" } }, modules: { orderBy: { position: "asc" } } },
      orderBy: { name: "asc" },
    });
    res.json({
      tracks: tracks.map((t) => ({ id: t.id, name: t.name, cohorts: t.cohorts.map((c) => ({ id: c.id, name: c.name })), modules: t.modules.map((m) => ({ id: m.id, title: m.title, position: m.position })) })),
      quizAuthoringUrl: config.CLUEQUEST_AUTHORING_URL || null,
      watchThreshold: config.WATCH_THRESHOLD_PERCENT,
    });
  });

  r.get("/classes", async (req, res) => {
    const ids = await trackIds(req.user!.id);
    const classes = await db.class.findMany({
      where: { trackId: { in: ids } },
      include: { track: true, cohort: true, module: true },
      orderBy: { updatedAt: "desc" },
    });
    const out = [];
    for (const c of classes) {
      const enrolled = await db.enrolment.count({ where: { trackId: c.trackId, cohortId: c.cohortId, status: "ACTIVE" } });
      const submitted = c.status === "PUBLISHED" ? (await db.quizAttempt.findMany({ where: { classId: c.id, resultAt: { not: null } }, distinct: ["userId"], select: { userId: true } })).length : 0;
      out.push({ ...summary(c), enrolled, submitted });
    }
    res.json({ classes: out });
  });

  r.post("/classes", async (req, res) => {
    const b = body(req, z.object({ trackId: z.string(), cohortId: z.string(), moduleId: z.string() }));
    if (!(await trackIds(req.user!.id)).includes(b.trackId)) throw forbidden("You are not assigned to this track.");
    const [cohort, mod] = await Promise.all([db.cohort.findUnique({ where: { id: b.cohortId } }), db.module.findUnique({ where: { id: b.moduleId } })]);
    if (!cohort || cohort.trackId !== b.trackId) throw new HttpError(400, "VALIDATION", "Choose a cohort from this track.", { cohortId: "Choose a cohort from this track" });
    if (!mod || mod.trackId !== b.trackId) throw new HttpError(400, "VALIDATION", "Choose a module from this track.", { moduleId: "Choose a module from this track" });
    const last = await db.class.findFirst({ where: { moduleId: b.moduleId, cohortId: b.cohortId }, orderBy: { position: "desc" } });
    const created = await db.class.create({ data: { ...b, authorId: req.user!.id, position: (last?.position ?? 0) + 1 } });
    res.status(201).json({ id: created.id });
  });

  r.get("/classes/:id", async (req, res) => {
    res.json({ class: detail(await ownClass(req.user!.id, String(req.params.id))) });
  });

  const patchBody = z.object({
    title: z.string().trim().max(150).optional(),
    description: z.string().trim().max(4000).optional(),
    releaseAt: z.string().datetime({ offset: true }).nullable().optional(),
    youtubeUrl: z.string().trim().max(300).optional(),
    quizId: z.string().trim().max(500).optional(),
    multiplayerUrl: z.string().trim().max(500).optional(),
  });

  /** Applies and validates field changes. Incomplete values are fine for drafts, but anything entered must be valid. */
  async function applyPatch(cls: Awaited<ReturnType<typeof ownClass>>, b: z.infer<typeof patchBody>) {
    const errors: Record<string, string> = {};
    const data: Record<string, unknown> = {};
    if (b.title !== undefined) data.title = b.title;
    if (b.description !== undefined) data.description = b.description;
    if (b.releaseAt !== undefined) data.releaseAt = b.releaseAt ? new Date(b.releaseAt) : null;
    if (b.youtubeUrl !== undefined) {
      const id = b.youtubeUrl ? parseYoutubeId(b.youtubeUrl) : "";
      if (b.youtubeUrl && !id) errors.youtubeUrl = "Enter a YouTube video link, such as https://www.youtube.com/watch?v=...";
      else Object.assign(data, { youtubeUrl: b.youtubeUrl, youtubeId: id ?? "" });
    }
    const roomUrl = b.multiplayerUrl ?? cls.multiplayerUrl;
    if (b.quizId !== undefined) {
      if (!b.quizId) Object.assign(data, { quizId: "", quizTitle: "" });
      else {
        try {
          const wanted = parseQuizId(config, b.quizId);
          if (wanted !== cls.quizId) {
            const started = cls.status === "PUBLISHED" && (await db.quizAttempt.count({ where: { classId: cls.id } })) > 0;
            if (started) errors.quizId = "Students have already started this quiz, so it cannot be replaced.";
            else {
              const v = await validateQuiz(ctx, wanted);
              Object.assign(data, { quizId: v.quizId, quizTitle: v.title });
            }
          }
        } catch (e) {
          if (e instanceof HttpError && e.status !== 503) errors.quizId = e.message;
          else throw e;
        }
      }
    }
    if (b.multiplayerUrl !== undefined) {
      if (roomUrl) {
        try {
          data.multiplayerUrl = normaliseRoomUrl(config, roomUrl);
        } catch (e) {
          if (e instanceof HttpError && e.status !== 503) errors.multiplayerUrl = e.message;
          else throw e;
        }
      } else data.multiplayerUrl = "";
    }
    return { errors, data };
  }

  function publishErrors(c: { title: string; releaseAt: Date | null; youtubeId: string; quizId: string }) {
    const e: Record<string, string> = {};
    if (!c.title.trim()) e.title = "Add a title before publishing";
    if (!c.releaseAt) e.releaseAt = "Choose a release date and time";
    if (!c.youtubeId) e.youtubeUrl = "A YouTube video link is required to publish";
    if (!c.quizId) e.quizId = "An individual ClueQuest quiz is required to publish";
    return e;
  }

  r.patch("/classes/:id", async (req, res) => {
    const cls = await ownClass(req.user!.id, String(req.params.id));
    const b = body(req, patchBody);
    const { errors, data } = await applyPatch(cls, b);
    if (Object.keys(errors).length) throw new HttpError(400, "VALIDATION", "Please check the highlighted fields.", errors);
    if (cls.status === "PUBLISHED") {
      const merged = { title: cls.title, releaseAt: cls.releaseAt, youtubeId: cls.youtubeId, quizId: cls.quizId, ...data } as Parameters<typeof publishErrors>[0];
      const pe = publishErrors(merged);
      if (Object.keys(pe).length) throw new HttpError(400, "VALIDATION", "A published class must keep its title, release time, video and quiz.", pe);
    }
    const updated = await db.class.update({ where: { id: cls.id }, data, include: { track: true, cohort: true, module: true } });
    res.json({ class: detail(updated) });
  });

  r.post("/classes/:id/publish", async (req, res) => {
    const cls = await ownClass(req.user!.id, String(req.params.id));
    const errors = publishErrors(cls);
    if (Object.keys(errors).length) throw new HttpError(400, "VALIDATION", "This class is not ready to publish.", errors);
    const updated = await db.class.update({
      where: { id: cls.id },
      data: { status: "PUBLISHED", publishedAt: cls.publishedAt ?? new Date() },
      include: { track: true, cohort: true, module: true },
    });
    res.json({ class: detail(updated) });
  });

  r.post("/classes/:id/unpublish", async (req, res) => {
    const cls = await ownClass(req.user!.id, String(req.params.id));
    const used = (await db.quizAttempt.count({ where: { classId: cls.id } })) + (await db.viewProgress.count({ where: { classId: cls.id } }));
    if (used > 0) throw new HttpError(409, "IN_USE", "Students have already started this class, so it cannot go back to draft.");
    const updated = await db.class.update({ where: { id: cls.id }, data: { status: "DRAFT" }, include: { track: true, cohort: true, module: true } });
    res.json({ class: detail(updated) });
  });

  r.delete("/classes/:id", async (req, res) => {
    const cls = await ownClass(req.user!.id, String(req.params.id));
    if (cls.status !== "DRAFT") throw new HttpError(409, "NOT_DRAFT", "Only drafts can be deleted.");
    await db.class.delete({ where: { id: cls.id } });
    res.json({ ok: true });
  });

  r.post("/quiz/validate", async (req, res) => {
    const b = body(req, z.object({ quiz: z.string().trim().min(1).max(500) }));
    try {
      const v = await validateQuiz(ctx, b.quiz);
      res.json({ valid: true, title: v.title, quizId: v.quizId });
    } catch (e) {
      if (e instanceof HttpError && e.status === 400) return res.json({ valid: false, message: e.message });
      throw e;
    }
  });

  /** Starts the real quiz for the tutor. Nothing is recorded against any student. */
  r.post("/classes/:id/quiz/preview-launch", async (req, res) => {
    const cls = await ownClass(req.user!.id, String(req.params.id));
    res.json(await launchQuizPreview(ctx, cls));
  });

  /** What a student will see, regardless of release time. Never records progress. */
  r.get("/classes/:id/preview", async (req, res) => {
    const c = await ownClass(req.user!.id, String(req.params.id));
    res.json({
      preview: {
        title: c.title || "Untitled class", description: c.description, youtubeId: c.youtubeId, releaseAt: c.releaseAt,
        moduleTitle: c.module.title, quizAttached: Boolean(c.quizId), quizTitle: c.quizTitle, multiplayerUrl: c.multiplayerUrl,
        watchThreshold: config.WATCH_THRESHOLD_PERCENT, problems: publishErrors(c),
      },
    });
  });

  r.get("/classes/:id/results", async (req, res) => {
    const cls = await ownClass(req.user!.id, String(req.params.id));
    const enrolments = await db.enrolment.findMany({ where: { trackId: cls.trackId, cohortId: cls.cohortId, status: "ACTIVE" }, include: { user: true } });
    const attempts = await db.quizAttempt.findMany({ where: { classId: cls.id }, orderBy: { attemptNo: "asc" } });
    const progress = await db.viewProgress.findMany({ where: { classId: cls.id } });

    const rows = enrolments.map((e) => {
      const mine = attempts.filter((a) => a.userId === e.userId);
      const scored = mine.filter((a) => a.resultAt);
      const latest = scored[scored.length - 1];
      const best = scored.reduce<(typeof scored)[number] | null>((b, a) => (!b || (a.score ?? 0) > (b.score ?? 0) ? a : b), null);
      return {
        studentCode: e.user.studentCode, name: e.user.name,
        watchedPercent: progress.find((p) => p.userId === e.userId)?.watchedPercent ?? 0,
        attempts: mine.length, submitted: scored.length > 0,
        latestScore: latest?.score ?? null, bestScore: best?.score ?? null, maxScore: latest?.maxScore ?? best?.maxScore ?? null,
        passed: scored.some((a) => a.passed === true), lastResultAt: latest?.resultAt ?? null,
        pending: mine.some((a) => a.status === "LAUNCHED" && a.returnedAt),
      };
    });

    // Question-level insight only when the quiz provider supplies it. Each student's latest scored attempt counts once.
    const byQ = new Map<string, { prompt: string; correct: number; total: number }>();
    for (const e of enrolments) {
      const last = attempts.filter((a) => a.userId === e.userId && a.resultAt).pop();
      const qs = last?.questions as { questionId: string; prompt?: string; correct: boolean }[] | null | undefined;
      for (const q of qs ?? []) {
        const s = byQ.get(q.questionId) ?? { prompt: q.prompt ?? q.questionId, correct: 0, total: 0 };
        s.total++;
        if (q.correct) s.correct++;
        byQ.set(q.questionId, s);
      }
    }

    res.json({
      class: summary(cls),
      totals: {
        enrolled: rows.length,
        submitted: rows.filter((x) => x.submitted).length,
        passed: rows.filter((x) => x.passed).length,
        outstanding: rows.filter((x) => !x.submitted).length,
      },
      students: rows,
      outstanding: rows.filter((x) => !x.submitted).map((x) => ({ studentCode: x.studentCode, name: x.name, watchedPercent: x.watchedPercent })),
      questionInsights: byQ.size ? [...byQ.entries()].map(([id, s]) => ({ questionId: id, prompt: s.prompt, correctPercent: Math.round((s.correct / s.total) * 100), answered: s.total })) : null,
    });
  });

  return r;
}
