import { Router } from "express";
import { z } from "zod";
import type { Ctx } from "../lib/ctx.js";
import { HttpError, body, notFound } from "../lib/http.js";
import { requireRole } from "../middleware/auth.js";
import { launchQuiz, markReturned } from "../services/quiz.js";
import { issueCertificate, studentCertificateState } from "../services/certificate.js";
import { startCheckout, verifyAndGrant } from "../services/payments.js";
import { buildTrackViews, pickPrimary, requireClassAccess } from "../services/progress.js";
import { getLinks } from "./public.js";

export function studentRouter(ctx: Ctx) {
  const r = Router();
  const { db, config } = ctx;
  r.use(requireRole("STUDENT"));

  r.get("/dashboard", async (req, res) => {
    const userId = req.user!.id;
    const tracks = await buildTrackViews(db, config, userId);
    const certs = await db.certificate.findMany({ where: { userId }, select: { id: true, trackId: true, kind: true, status: true } });
    const eligible = await db.certificateEligibility.findMany({ where: { userId } });
    res.json({
      student: { name: req.user!.name, studentCode: req.user!.studentCode },
      primary: pickPrimary(tracks),
      watchThreshold: config.WATCH_THRESHOLD_PERCENT,
      links: await getLinks(ctx),
      tracks: tracks.map((t) => ({
        enrolmentId: t.enrolmentId, track: t.track, cohort: t.cohort, accessible: t.accessible,
        passedCount: t.passedCount, totalCount: t.totalCount, percent: t.percent, nextSessionAt: t.nextSessionAt,
        classes: t.classes.map((c) => ({
          id: c.id, title: c.title, moduleTitle: c.moduleTitle, modulePosition: c.modulePosition, isFinal: c.isFinal, state: c.state,
          actionLabel: c.actionLabel, watchedPercent: c.watchedPercent, releaseAt: c.releaseAt, best: c.best,
        })),
        certificates: eligible
          .filter((e) => e.trackId === t.track.id)
          .map((e) => ({ kind: e.kind, ...studentCertificateState(e, certs.find((c) => c.trackId === e.trackId && c.kind === e.kind)) })),
      })),
    });
  });

  r.get("/classes/:id", async (req, res) => {
    const userId = req.user!.id;
    const { cls, view } = await requireClassAccess(db, config, userId, String(req.params.id));
    const tracks = await buildTrackViews(db, config, userId);
    const tv = tracks.find((t) => t.track.id === cls.trackId)!;
    const idx = tv.classes.findIndex((c) => c.id === cls.id);
    const next = view.state === "PASSED" ? tv.classes.slice(idx + 1).find((c) => c.state !== "LOCKED" && c.state !== "PASSED") : undefined;
    res.json({
      class: {
        id: cls.id, title: cls.title, description: cls.description, youtubeId: cls.youtubeId, releaseAt: cls.releaseAt,
        moduleTitle: view.moduleTitle, trackName: cls.track.name,
        hasQuiz: Boolean(cls.quizId),
        multiplayerUrl: cls.multiplayerUrl || null,
      },
      state: view.state,
      actionLabel: view.actionLabel,
      watchedPercent: view.watchedPercent,
      positionSeconds: view.positionSeconds,
      watchThreshold: config.WATCH_THRESHOLD_PERCENT,
      quizEligible: view.quizEligible,
      attempts: view.attempts,
      best: view.best,
      next: next ? { id: next.id, title: next.title } : null,
    });
  });

  r.put("/classes/:id/progress", async (req, res) => {
    const b = body(req, z.object({ positionSeconds: z.number().int().min(0).max(86_400), durationSeconds: z.number().int().min(0).max(86_400) }));
    const userId = req.user!.id;
    const { cls } = await requireClassAccess(db, config, userId, String(req.params.id));
    const pct = b.durationSeconds > 0 ? Math.min(100, Math.floor((b.positionSeconds / b.durationSeconds) * 100)) : 0;
    const prev = await db.viewProgress.findUnique({ where: { userId_classId: { userId, classId: cls.id } } });
    const watchedPercent = Math.max(prev?.watchedPercent ?? 0, pct);
    await db.viewProgress.upsert({
      where: { userId_classId: { userId, classId: cls.id } },
      update: { positionSeconds: b.positionSeconds, durationSeconds: b.durationSeconds || prev?.durationSeconds || 0, watchedPercent },
      create: { userId, classId: cls.id, positionSeconds: b.positionSeconds, durationSeconds: b.durationSeconds, watchedPercent },
    });
    res.json({ watchedPercent, quizEligible: watchedPercent >= config.WATCH_THRESHOLD_PERCENT });
  });

  r.post("/classes/:id/quiz/launch", async (req, res) => {
    const out = await launchQuiz(ctx, req.user!.id, String(req.params.id));
    res.json(out);
  });

  r.post("/classes/:id/returned", async (req, res) => {
    await requireClassAccess(db, config, req.user!.id, String(req.params.id));
    await markReturned(ctx, req.user!.id, String(req.params.id));
    res.json({ ok: true });
  });

  r.get("/results", async (req, res) => {
    const tracks = await buildTrackViews(db, config, req.user!.id);
    res.json({
      results: tracks.flatMap((t) =>
        t.classes
          .filter((c) => c.attempts.length > 0)
          .map((c) => ({ classId: c.id, classTitle: c.title, track: t.track.name, state: c.state, best: c.best, attempts: c.attempts })),
      ),
    });
  });

  /* --------------------------------------------------------- certificates */
  r.get("/certificates/:id/download", async (req, res) => {
    const c = await db.certificate.findUnique({ where: { id: String(req.params.id) }, include: { track: true } });
    // Another student's certificate looks identical to a missing one.
    if (!c || c.userId !== req.user!.id || c.status !== "ISSUED" || !c.pdf) throw notFound("Certificate");
    // Still locked (or taken back) by an admin: the same answer as a missing one.
    const elig = await db.certificateEligibility.findUnique({ where: { userId_trackId_kind: { userId: c.userId, trackId: c.trackId, kind: c.kind } } });
    if (!elig?.unlockedAt) throw notFound("Certificate");
    res.setHeader("content-type", "application/pdf");
    res.setHeader("content-disposition", `attachment; filename="MSVA-${c.kind.toLowerCase()}-certificate-${c.studentCode}.pdf"`);
    res.send(Buffer.from(c.pdf));
  });

  r.post("/certificates/retry", async (req, res) => {
    const { trackId, kind } = body(req, z.object({ trackId: z.string(), kind: z.enum(["PARTICIPATION", "COMPLETION"]) }));
    const elig = await db.certificateEligibility.findUnique({ where: { userId_trackId_kind: { userId: req.user!.id, trackId, kind } } });
    if (!elig) throw new HttpError(403, "NOT_ELIGIBLE", "You are not eligible for this certificate yet.");
    if (!elig.unlockedAt) throw new HttpError(403, "NOT_UNLOCKED", "This certificate is waiting for approval from the academy.");
    try {
      const c = await issueCertificate(ctx, req.user!.id, trackId, kind);
      res.json({ id: c.id, status: c.status });
    } catch {
      throw new HttpError(502, "CERT_FAILED", "We could not generate your certificate yet. Please try again shortly.");
    }
  });

  /* -------------------------------------------------------------- courses */
  r.get("/courses", async (req, res) => {
    const userId = req.user!.id;
    const [tracks, owned, payments] = await Promise.all([
      db.track.findMany({ where: { isPremium: true, archived: false }, orderBy: { name: "asc" } }),
      db.entitlement.findMany({ where: { userId } }),
      db.payment.findMany({ where: { userId, status: "PENDING" } }),
    ]);
    res.json({
      courses: tracks.map((t) => ({
        id: t.id, name: t.name, description: t.description, price: (t.priceKobo ?? 0) / 100, currency: t.currency,
        owned: owned.some((o) => o.trackId === t.id), pending: payments.some((p) => p.trackId === t.id),
      })),
    });
  });

  r.post("/courses/:id/checkout", async (req, res) => {
    res.json(await startCheckout(ctx, req.user!.id, String(req.params.id)));
  });

  r.post("/payments/verify", async (req, res) => {
    const { reference } = body(req, z.object({ reference: z.string().min(5).max(100) }));
    const p = await db.payment.findUnique({ where: { reference } });
    if (!p || p.userId !== req.user!.id) throw notFound("Payment");
    const out = await verifyAndGrant(ctx, reference);
    res.json({ status: out.status });
  });

  return r;
}
