import { Router } from "express";
import { z } from "zod";
import type { Ctx } from "../lib/ctx.js";
import { HttpError, body, emailSchema, notFound, parse } from "../lib/http.js";
import { requireRole } from "../middleware/auth.js";
import { classifyCsv } from "../services/csv.js";
import { issueCertificate } from "../services/certificate.js";
import { processDueJobs } from "../services/jobs.js";
import { addStudentEnrolment, revokeSessions, sendActivationCode } from "../services/people.js";
import { getLinks, saveLinks } from "./public.js";

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "track";

const trackBody = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(""),
  isPremium: z.boolean().default(false),
  priceNaira: z.number().positive().max(10_000_000).nullable().optional(),
});

export function adminRouter(ctx: Ctx) {
  const r = Router();
  const { db } = ctx;
  r.use(requireRole("ADMIN"));

  /* ------------------------------------------------------------ overview */
  r.get("/overview", async (_req, res) => {
    const [students, activeStudents, invited, tutors, tracks, published, passedAttempts, certs, pendingJobs, failedJobs, failedCerts] = await Promise.all([
      db.user.count({ where: { role: "STUDENT" } }),
      db.user.count({ where: { role: "STUDENT", status: "ACTIVE" } }),
      db.user.count({ where: { role: "STUDENT", status: "INVITED" } }),
      db.user.count({ where: { role: "TUTOR", status: { not: "DEACTIVATED" } } }),
      db.track.count({ where: { archived: false } }),
      db.class.count({ where: { status: "PUBLISHED" } }),
      db.quizAttempt.count({ where: { passed: true } }),
      db.certificate.count({ where: { status: "ISSUED" } }),
      db.syncJob.count({ where: { status: "PENDING" } }),
      db.syncJob.count({ where: { status: "FAILED" } }),
      db.certificate.count({ where: { status: "FAILED" } }),
    ]);
    res.json({ students, activeStudents, invited, tutors, tracks, published, passedAttempts, certs, pendingJobs, failedJobs, failedCerts });
  });

  /* ------------------------------------------------- tracks/modules/cohorts */
  const trackOut = (t: { id: string; name: string; slug: string; description: string; isPremium: boolean; priceKobo: number | null; currency: string; archived: boolean }) => ({
    ...t,
    priceNaira: t.priceKobo ? t.priceKobo / 100 : null,
  });

  r.get("/tracks", async (_req, res) => {
    const tracks = await db.track.findMany({
      orderBy: { name: "asc" },
      include: { cohorts: { orderBy: { createdAt: "asc" } }, modules: { orderBy: { position: "asc" } }, _count: { select: { enrolments: true } } },
    });
    res.json({ tracks: tracks.map((t) => ({ ...trackOut(t), cohorts: t.cohorts, modules: t.modules, enrolmentCount: t._count.enrolments })) });
  });

  r.post("/tracks", async (req, res) => {
    const b = body(req, trackBody);
    if (b.isPremium && !b.priceNaira) throw new HttpError(400, "VALIDATION", "Premium courses need a price.", { priceNaira: "Enter a price" });
    const slug = slugify(b.name);
    if (await db.track.findFirst({ where: { OR: [{ name: { equals: b.name, mode: "insensitive" } }, { slug }] } })) {
      throw new HttpError(409, "DUPLICATE", "A track with this name already exists.", { name: "Already in use" });
    }
    const t = await db.track.create({
      data: { name: b.name, slug, description: b.description, isPremium: b.isPremium, priceKobo: b.isPremium ? Math.round(b.priceNaira! * 100) : null },
    });
    res.status(201).json({ track: trackOut(t) });
  });

  r.patch("/tracks/:id", async (req, res) => {
    const b = body(req, trackBody.partial().extend({ archived: z.boolean().optional() }));
    const id = String(req.params.id);
    const current = await db.track.findUnique({ where: { id } });
    if (!current) throw notFound("Track");
    const isPremium = b.isPremium ?? current.isPremium;
    const priceKobo = b.priceNaira !== undefined ? (b.priceNaira ? Math.round(b.priceNaira * 100) : null) : current.priceKobo;
    if (isPremium && !priceKobo) throw new HttpError(400, "VALIDATION", "Premium courses need a price.", { priceNaira: "Enter a price" });
    const t = await db.track.update({
      where: { id },
      data: {
        name: b.name ?? undefined,
        slug: b.name ? slugify(b.name) : undefined,
        description: b.description ?? undefined,
        isPremium,
        priceKobo: isPremium ? priceKobo : null,
        archived: b.archived ?? undefined,
      },
    });
    res.json({ track: trackOut(t) });
  });

  r.post("/tracks/:id/modules", async (req, res) => {
    const b = body(req, z.object({ title: z.string().trim().min(2).max(100), isFinal: z.boolean().default(false) }));
    const trackId = String(req.params.id);
    if (!(await db.track.findUnique({ where: { id: trackId } }))) throw notFound("Track");
    const last = await db.module.findFirst({ where: { trackId }, orderBy: { position: "desc" } });
    const m = await db.module.create({ data: { trackId, title: b.title, isFinal: b.isFinal, position: (last?.position ?? 0) + 1 } });
    res.status(201).json({ module: m });
  });

  r.patch("/modules/:id", async (req, res) => {
    const b = body(req, z.object({ title: z.string().trim().min(2).max(100).optional(), isFinal: z.boolean().optional() }));
    const m = await db.module.update({ where: { id: String(req.params.id) }, data: b }).catch(() => null);
    if (!m) throw notFound("Module");
    res.json({ module: m });
  });

  r.post("/modules/:id/move", async (req, res) => {
    const { direction } = body(req, z.object({ direction: z.enum(["up", "down"]) }));
    const m = await db.module.findUnique({ where: { id: String(req.params.id) } });
    if (!m) throw notFound("Module");
    const other = await db.module.findFirst({
      where: { trackId: m.trackId, position: direction === "up" ? { lt: m.position } : { gt: m.position } },
      orderBy: { position: direction === "up" ? "desc" : "asc" },
    });
    if (other) {
      await db.$transaction([
        db.module.update({ where: { id: m.id }, data: { position: -1 } }),
        db.module.update({ where: { id: other.id }, data: { position: m.position } }),
        db.module.update({ where: { id: m.id }, data: { position: other.position } }),
      ]);
    }
    res.json({ ok: true });
  });

  const cohortBody = z.object({
    name: z.string().trim().min(1).max(80),
    startsAt: z.string().datetime().nullable().optional(),
    nextSessionAt: z.string().datetime().nullable().optional(),
  });

  r.post("/tracks/:id/cohorts", async (req, res) => {
    const b = body(req, cohortBody);
    const trackId = String(req.params.id);
    if (!(await db.track.findUnique({ where: { id: trackId } }))) throw notFound("Track");
    if (await db.cohort.findUnique({ where: { trackId_name: { trackId, name: b.name } } })) {
      throw new HttpError(409, "DUPLICATE", "This track already has a cohort with that name.", { name: "Already in use" });
    }
    const c = await db.cohort.create({
      data: { trackId, name: b.name, startsAt: b.startsAt ? new Date(b.startsAt) : null, nextSessionAt: b.nextSessionAt ? new Date(b.nextSessionAt) : null },
    });
    res.status(201).json({ cohort: c });
  });

  r.patch("/cohorts/:id", async (req, res) => {
    const b = body(req, cohortBody.partial());
    const c = await db.cohort
      .update({
        where: { id: String(req.params.id) },
        data: {
          name: b.name,
          startsAt: b.startsAt === undefined ? undefined : b.startsAt ? new Date(b.startsAt) : null,
          nextSessionAt: b.nextSessionAt === undefined ? undefined : b.nextSessionAt ? new Date(b.nextSessionAt) : null,
        },
      })
      .catch(() => null);
    if (!c) throw notFound("Cohort");
    res.json({ cohort: c });
  });

  /* ------------------------------------------------------------- students */
  r.get("/students", async (req, res) => {
    const q = parse(
      z.object({ search: z.string().optional(), trackId: z.string().optional(), cohortId: z.string().optional(), status: z.enum(["INVITED", "ACTIVE", "DEACTIVATED"]).optional() }),
      req.query,
    );
    const users = await db.user.findMany({
      where: {
        role: "STUDENT",
        status: q.status,
        OR: q.search
          ? [{ name: { contains: q.search, mode: "insensitive" } }, { email: { contains: q.search, mode: "insensitive" } }, { studentCode: { contains: q.search, mode: "insensitive" } }]
          : undefined,
        enrolments: q.trackId || q.cohortId ? { some: { trackId: q.trackId, cohortId: q.cohortId } } : undefined,
      },
      include: { enrolments: { include: { track: true, cohort: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    res.json({
      students: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        status: u.status,
        studentCode: u.studentCode,
        enrolments: u.enrolments.map((e) => ({ id: e.id, status: e.status, trackId: e.trackId, track: e.track.name, cohortId: e.cohortId, cohort: e.cohort.name })),
      })),
    });
  });

  r.post("/students", async (req, res) => {
    const b = body(req, z.object({ name: z.string().trim().min(2).max(120), email: emailSchema, trackId: z.string(), cohortId: z.string() }));
    const out = await addStudentEnrolment(ctx, b);
    if (!out.created && !out.enrolmentCreated) throw new HttpError(409, "ALREADY_ENROLLED", "This student is already enrolled in that track.", { email: "Already enrolled" });
    res.status(201).json({ student: { id: out.user.id, studentCode: out.user.studentCode }, emailSent: out.email?.sent ?? null, emailError: out.email?.error });
  });

  r.post("/students/import/preview", async (req, res) => {
    const b = body(req, z.object({ csv: z.string().min(1).max(1_000_000), trackId: z.string().optional(), cohortId: z.string().optional() }));
    res.json(await classifyCsv(ctx, b.csv, b));
  });

  r.post("/students/import/commit", async (req, res) => {
    const b = body(req, z.object({ csv: z.string().min(1).max(1_000_000), trackId: z.string().optional(), cohortId: z.string().optional() }));
    const { rows, counts } = await classifyCsv(ctx, b.csv, b);
    let imported = 0;
    let emailFailures = 0;
    for (const row of rows) {
      if (row.status !== "new_student" && row.status !== "new_enrolment") continue;
      const out = await addStudentEnrolment(ctx, { name: row.name, email: row.email, trackId: row.trackId!, cohortId: row.cohortId! });
      if (out.created || out.enrolmentCreated) imported++;
      if (out.email && !out.email.sent) emailFailures++;
    }
    res.json({ imported, skipped: rows.length - imported, emailFailures, counts });
  });

  r.post("/users/:id/resend-invite", async (req, res) => {
    const u = await db.user.findUnique({ where: { id: String(req.params.id) } });
    if (!u || u.role === "ADMIN") throw notFound("User");
    const out = await sendActivationCode(ctx, u.id);
    res.json({ emailSent: out.sent, emailError: out.error });
  });

  r.patch("/users/:id/email", async (req, res) => {
    const { email } = body(req, z.object({ email: emailSchema }));
    const u = await db.user.findUnique({ where: { id: String(req.params.id) } });
    if (!u || u.role === "ADMIN") throw notFound("User");
    if (email === u.email) return res.json({ ok: true, emailSent: null });
    if (await db.user.findUnique({ where: { email } })) throw new HttpError(409, "EMAIL_IN_USE", "That email is already used by another account.", { email: "Already in use" });
    await db.user.update({ where: { id: u.id }, data: { email, googleSub: null } });
    await revokeSessions(db, u.id);
    let emailSent: boolean | null = null;
    if (u.status === "INVITED") {
      // Reissuing access supersedes the invitation sent to the wrong address.
      emailSent = (await sendActivationCode(ctx, u.id)).sent;
    }
    res.json({ ok: true, emailSent });
  });

  r.post("/users/:id/deactivate", async (req, res) => {
    const u = await db.user.findUnique({ where: { id: String(req.params.id) } });
    if (!u || u.role === "ADMIN") throw notFound("User");
    await db.user.update({ where: { id: u.id }, data: { status: "DEACTIVATED" } });
    await revokeSessions(db, u.id);
    res.json({ ok: true });
  });

  r.post("/users/:id/reactivate", async (req, res) => {
    const u = await db.user.findUnique({ where: { id: String(req.params.id) } });
    if (!u || u.role === "ADMIN") throw notFound("User");
    await db.user.update({ where: { id: u.id }, data: { status: u.activatedAt ? "ACTIVE" : "INVITED" } });
    res.json({ ok: true });
  });

  r.patch("/enrolments/:id", async (req, res) => {
    const b = body(req, z.object({ cohortId: z.string().optional(), status: z.enum(["ACTIVE", "WITHDRAWN"]).optional() }));
    const en = await db.enrolment.findUnique({ where: { id: String(req.params.id) }, include: { user: true } });
    if (!en) throw notFound("Enrolment");
    if (b.cohortId) {
      const c = await db.cohort.findUnique({ where: { id: b.cohortId } });
      if (!c || c.trackId !== en.trackId) throw new HttpError(400, "BAD_COHORT", "That cohort does not belong to this track.");
    }
    const status = b.status === "ACTIVE" && en.user.status !== "ACTIVE" ? "INVITED" : b.status;
    const updated = await db.enrolment.update({ where: { id: en.id }, data: { cohortId: b.cohortId, status } });
    res.json({ enrolment: updated });
  });

  /* --------------------------------------------------------------- tutors */
  r.get("/tutors", async (_req, res) => {
    const users = await db.user.findMany({
      where: { role: "TUTOR" },
      include: { tutorAssignments: { where: { removedAt: null }, include: { track: true } }, _count: { select: { authoredClasses: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json({
      tutors: users.map((u) => ({
        id: u.id, name: u.name, email: u.email, status: u.status, classCount: u._count.authoredClasses,
        tracks: u.tutorAssignments.map((a) => ({ id: a.trackId, name: a.track.name })),
      })),
    });
  });

  async function setAssignments(userId: string, trackIds: string[]) {
    const tracks = await db.track.findMany({ where: { id: { in: trackIds } } });
    if (tracks.length !== new Set(trackIds).size) throw new HttpError(400, "BAD_TRACK", "One of the selected tracks does not exist.");
    await db.$transaction(async (tx) => {
      await tx.tutorAssignment.updateMany({ where: { userId, trackId: { notIn: trackIds }, removedAt: null }, data: { removedAt: new Date() } });
      for (const trackId of trackIds) {
        await tx.tutorAssignment.upsert({
          where: { userId_trackId: { userId, trackId } },
          update: { removedAt: null },
          create: { userId, trackId },
        });
      }
    });
  }

  r.post("/tutors", async (req, res) => {
    const b = body(req, z.object({ name: z.string().trim().min(2).max(120), email: emailSchema, trackIds: z.array(z.string()).min(1, "Choose at least one track") }));
    if (await db.user.findUnique({ where: { email: b.email } })) throw new HttpError(409, "EMAIL_IN_USE", "That email is already used by another account.", { email: "Already in use" });
    const u = await db.user.create({ data: { name: b.name, email: b.email, role: "TUTOR", status: "INVITED" } });
    await setAssignments(u.id, b.trackIds);
    const out = await sendActivationCode(ctx, u.id);
    res.status(201).json({ tutor: { id: u.id }, emailSent: out.sent, emailError: out.error });
  });

  r.put("/tutors/:id/tracks", async (req, res) => {
    const { trackIds } = body(req, z.object({ trackIds: z.array(z.string()) }));
    const u = await db.user.findUnique({ where: { id: String(req.params.id) } });
    if (!u || u.role !== "TUTOR") throw notFound("Tutor");
    await setAssignments(u.id, trackIds);
    res.json({ ok: true });
  });

  /** Removing a tutor deactivates the account and ends assignments. Classes, quiz links and results are kept. */
  r.delete("/tutors/:id", async (req, res) => {
    const u = await db.user.findUnique({ where: { id: String(req.params.id) } });
    if (!u || u.role !== "TUTOR") throw notFound("Tutor");
    await db.$transaction([
      db.user.update({ where: { id: u.id }, data: { status: "DEACTIVATED" } }),
      db.tutorAssignment.updateMany({ where: { userId: u.id, removedAt: null }, data: { removedAt: new Date() } }),
    ]);
    await revokeSessions(db, u.id);
    res.json({ ok: true });
  });

  /* ------------------------------------------------------------- reports */
  r.get("/enrolments", async (req, res) => {
    const q = parse(z.object({ trackId: z.string().optional(), cohortId: z.string().optional(), status: z.enum(["INVITED", "ACTIVE", "WITHDRAWN"]).optional() }), req.query);
    const rows = await db.enrolment.findMany({
      where: q,
      include: { user: true, track: true, cohort: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
    res.json({
      enrolments: rows.map((e) => ({
        id: e.id, studentId: e.userId, studentCode: e.user.studentCode, name: e.user.name, email: e.user.email,
        userStatus: e.user.status, status: e.status, track: e.track.name, cohort: e.cohort.name, cohortId: e.cohortId, createdAt: e.createdAt,
      })),
    });
  });

  r.get("/progress", async (req, res) => {
    const q = parse(z.object({ trackId: z.string().optional(), cohortId: z.string().optional() }), req.query);
    const enrolments = await db.enrolment.findMany({ where: { ...q, status: "ACTIVE" }, include: { user: true, track: true, cohort: true }, take: 1000 });
    const out = [];
    for (const e of enrolments) {
      const classes = await db.class.findMany({ where: { cohortId: e.cohortId, trackId: e.trackId, status: "PUBLISHED" }, select: { id: true } });
      const passed = await db.quizAttempt.findMany({ where: { userId: e.userId, passed: true, classId: { in: classes.map((c) => c.id) } }, distinct: ["classId"], select: { classId: true } });
      out.push({
        studentCode: e.user.studentCode, name: e.user.name, track: e.track.name, cohort: e.cohort.name,
        passed: passed.length, total: classes.length, percent: classes.length ? Math.round((passed.length / classes.length) * 100) : 0,
      });
    }
    res.json({ progress: out });
  });

  r.get("/scores", async (req, res) => {
    const q = parse(z.object({ trackId: z.string().optional(), cohortId: z.string().optional(), classId: z.string().optional() }), req.query);
    const attempts = await db.quizAttempt.findMany({
      where: { resultAt: { not: null }, classId: q.classId, class: { trackId: q.trackId, cohortId: q.cohortId } },
      include: { user: true, class: { include: { track: true, cohort: true } } },
      orderBy: { resultAt: "desc" },
      take: 1000,
    });
    res.json({
      scores: attempts.map((a) => ({
        id: a.id, studentCode: a.user.studentCode, name: a.user.name, track: a.class.track.name, cohort: a.class.cohort.name,
        classTitle: a.class.title, attemptNo: a.attemptNo, score: a.score, maxScore: a.maxScore, passed: a.passed, resultAt: a.resultAt,
      })),
    });
  });

  r.get("/certificates", async (_req, res) => {
    const eligible = await db.certificateEligibility.findMany({ include: { user: true, track: true }, orderBy: { eligibleAt: "desc" }, take: 500 });
    const certs = await db.certificate.findMany({ select: { id: true, userId: true, trackId: true, status: true, verificationRef: true, issuedAt: true, attempts: true, lastError: true } });
    res.json({
      certificates: eligible.map((e) => {
        const c = certs.find((x) => x.userId === e.userId && x.trackId === e.trackId);
        return {
          eligibilityId: e.id, studentCode: e.user.studentCode, name: e.user.name, track: e.track.name, userId: e.userId, trackId: e.trackId,
          eligibleAt: e.eligibleAt, status: c?.status ?? "NOT_ISSUED", verificationRef: c?.verificationRef ?? null, issuedAt: c?.issuedAt ?? null,
          attempts: c?.attempts ?? 0, lastError: c?.lastError ?? null,
        };
      }),
    });
  });

  r.post("/certificates/retry", async (req, res) => {
    const b = body(req, z.object({ userId: z.string(), trackId: z.string() }));
    try {
      const c = await issueCertificate(ctx, b.userId, b.trackId);
      res.json({ status: c.status });
    } catch (e) {
      throw new HttpError(502, "CERT_FAILED", e instanceof Error ? e.message : "Certificate could not be generated");
    }
  });

  r.get("/payments", async (_req, res) => {
    const p = await db.payment.findMany({ include: { user: true, track: true }, orderBy: { createdAt: "desc" }, take: 500 });
    res.json({
      payments: p.map((x) => ({
        id: x.id, reference: x.reference, studentCode: x.user.studentCode, name: x.user.name, course: x.track.name,
        amount: x.amountKobo / 100, currency: x.currency, status: x.status, paidAt: x.paidAt, createdAt: x.createdAt, note: x.failureNote,
      })),
    });
  });

  /* ------------------------------------------------------ settings & sync */
  r.get("/settings", async (_req, res) => res.json({ links: await getLinks(ctx) }));
  r.put("/settings", async (req, res) => {
    const url = z.string().trim().max(300).refine((v) => v === "" || /^https?:\/\//.test(v), "Enter a full web address starting with https://");
    const b = body(req, z.object({ communityUrl: url, whatsappUrl: url, websiteUrl: url }));
    await saveLinks(ctx, b);
    res.json({ links: await getLinks(ctx) });
  });

  r.get("/sync-jobs", async (_req, res) => {
    const jobs = await db.syncJob.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    res.json({ enabled: Boolean(ctx.sheets), jobs });
  });
  r.post("/sync-jobs/run", async (_req, res) => {
    // Failed jobs are re-queued by the admin explicitly.
    await db.syncJob.updateMany({ where: { status: "FAILED" }, data: { status: "PENDING", attempts: 0, nextRunAt: new Date() } });
    await db.syncJob.updateMany({ where: { status: "PENDING" }, data: { nextRunAt: new Date() } });
    res.json(await processDueJobs(ctx));
  });

  return r;
}
