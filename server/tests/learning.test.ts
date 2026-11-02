import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PAYSTACK_SECRET, activateWithCode, agentFor, createAdmin, makeCtx, paystack, quizIdFor, quizResult, resetDb, sheets, signIn } from "./helpers.js";
import { hmacHex } from "../src/lib/security.js";
import { LiveClueQuestClient } from "../src/services/adapters.js";

const ctx = makeCtx();
const { app, agent } = agentFor(ctx);

type A = ReturnType<typeof agent>;
let admin: A, tutor: A, student: A, outsider: A;
let trackId = "", cohortId = "", otherCohortId = "", mod1 = "", mod2 = "", finalMod = "";
let class1 = "", class2 = "", classFinal = "";

const past = () => new Date(Date.now() - 3600_000).toISOString();
const future = () => new Date(Date.now() + 7 * 86400_000).toISOString();

async function activate(email: string, name: string, make: () => Promise<unknown>) {
  await make();
  await activateWithCode(ctx, app, email);
  const a = agent();
  await signIn(a, email);
  return a;
}

async function makeClass(title: string, moduleId: string, quiz: string, cohort = cohortId) {
  const c = await tutor.post("/api/tutor/classes").send({ trackId, cohortId: cohort, moduleId });
  const id = c.body.id as string;
  const p = await tutor.patch(`/api/tutor/classes/${id}`).send({ title, releaseAt: past(), youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", quizId: quiz });
  expect(p.status, JSON.stringify(p.body)).toBe(200);
  const pub = await tutor.post(`/api/tutor/classes/${id}/publish`).send({});
  expect(pub.status, JSON.stringify(pub.body)).toBe(200);
  return id;
}

async function watch(a: A, classId: string, pct: number) {
  return a.put(`/api/student/classes/${classId}/progress`).send({ positionSeconds: pct * 10, durationSeconds: 1000 });
}

async function launch(a: A, classId: string) {
  const r = await a.post(`/api/student/classes/${classId}/quiz/launch`).send({});
  return r;
}

async function attemptFor(email: string, classId: string) {
  return ctx.db.quizAttempt.findFirstOrThrow({ where: { classId, user: { email } }, orderBy: { attemptNo: "desc" } });
}

function resultFor(attempt: { id: string; studentRef: string; quizId: string }, over: Record<string, unknown> = {}) {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2)}`,
    type: "attempt.submitted",
    partnerAssignmentRef: attempt.id,
    learnerRef: attempt.studentRef,
    attemptId: `cq-${Math.random().toString(36).slice(2)}`,
    quizId: attempt.quizId,
    quizVersion: 1,
    activityType: "solo",
    style: "points",
    marksEarned: 8,
    marksPossible: 10,
    percent: 80,
    passMarkPercent: 70,
    passed: true,
    points: 650,
    pointsPossible: 1000,
    submittedAt: new Date().toISOString(),
    autoSubmitted: false,
    ...over,
  };
}

beforeAll(async () => {
  await resetDb(ctx);
  await createAdmin(ctx);
  admin = agent();
  await signIn(admin, "admin@msva.test");
  trackId = (await admin.post("/api/admin/tracks").send({ name: "Graphic Design" })).body.track.id;
  cohortId = (await admin.post(`/api/admin/tracks/${trackId}/cohorts`).send({ name: "Cohort A" })).body.cohort.id;
  otherCohortId = (await admin.post(`/api/admin/tracks/${trackId}/cohorts`).send({ name: "Cohort B" })).body.cohort.id;
  mod1 = (await admin.post(`/api/admin/tracks/${trackId}/modules`).send({ title: "Foundations" })).body.module.id;
  mod2 = (await admin.post(`/api/admin/tracks/${trackId}/modules`).send({ title: "Layout" })).body.module.id;
  finalMod = (await admin.post(`/api/admin/tracks/${trackId}/modules`).send({ title: "Final assessment", isFinal: true })).body.module.id;

  tutor = await activate("tutor@msva.test", "Tutor", () => admin.post("/api/admin/tutors").send({ name: "Tutor", email: "tutor@msva.test", trackIds: [trackId] }));
  student = await activate("stu@msva.test", "Stu", () => admin.post("/api/admin/students").send({ name: "Stu Dent", email: "stu@msva.test", trackId, cohortId }));
  outsider = await activate("out@msva.test", "Out", () => admin.post("/api/admin/students").send({ name: "Out Sider", email: "out@msva.test", trackId, cohortId: otherCohortId }));
});
afterAll(async () => {
  await ctx.db.$disconnect();
});

describe("class publishing", () => {
  it("saves incomplete drafts but refuses to publish without video or individual quiz", async () => {
    const c = await tutor.post("/api/tutor/classes").send({ trackId, cohortId, moduleId: mod1 });
    const id = c.body.id;
    expect((await tutor.patch(`/api/tutor/classes/${id}`).send({ title: "Draft only" })).status).toBe(200);
    const pub = await tutor.post(`/api/tutor/classes/${id}/publish`).send({});
    expect(pub.status).toBe(400);
    expect(Object.keys(pub.body.error.fields).sort()).toEqual(["quizId", "releaseAt", "youtubeUrl"]);

    await tutor.patch(`/api/tutor/classes/${id}`).send({ releaseAt: past(), youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" });
    const stillMissingQuiz = await tutor.post(`/api/tutor/classes/${id}/publish`).send({});
    expect(Object.keys(stillMissingQuiz.body.error.fields)).toEqual(["quizId"]);
    await tutor.delete(`/api/tutor/classes/${id}`);
  });

  it("accepts a quiz id or a ClueQuest address, and rejects other origins, unknown quizzes and bad video links", async () => {
    const id = (await tutor.post("/api/tutor/classes").send({ trackId, cohortId, moduleId: mod1 })).body.id;
    const wrongOrigin = await tutor.patch(`/api/tutor/classes/${id}`).send({ quizId: `https://evil.example/quizzes/${quizIdFor("x")}` });
    expect(wrongOrigin.status).toBe(400);
    expect(wrongOrigin.body.error.fields.quizId).toMatch(/cluequest\.test/);
    const notAnId = await tutor.patch(`/api/tutor/classes/${id}`).send({ quizId: "https://cluequest.test/join/ABC123" });
    expect(notAnId.body.error.fields.quizId).toMatch(/quiz ID/i);
    const garbage = await tutor.patch(`/api/tutor/classes/${id}`).send({ quizId: "my quiz" });
    expect(garbage.body.error.fields.quizId).toMatch(/quiz ID/i);
    const unknown = await tutor.patch(`/api/tutor/classes/${id}`).send({ quizId: "00000000-0000-4000-8000-000000000000" });
    expect(unknown.body.error.fields.quizId).toMatch(/cannot find/i);
    const wrongRoom = await tutor.patch(`/api/tutor/classes/${id}`).send({ multiplayerUrl: "https://evil.example/join/ABC" });
    expect(wrongRoom.body.error.fields.multiplayerUrl).toMatch(/cluequest\.test/);
    const badVideo = await tutor.patch(`/api/tutor/classes/${id}`).send({ youtubeUrl: "https://vimeo.com/123" });
    expect(badVideo.body.error.fields.youtubeUrl).toBeTruthy();

    const validate = await tutor.post("/api/tutor/quiz/validate").send({ quiz: `https://cluequest.test/quizzes/${quizIdFor("ok")}/use` });
    expect(validate.body).toMatchObject({ valid: true, quizId: quizIdFor("ok"), title: "Test quiz" });
    const bad = await tutor.post("/api/tutor/quiz/validate").send({ quiz: "nonsense" });
    expect(bad.body.valid).toBe(false);
    const saved = await tutor.patch(`/api/tutor/classes/${id}`).send({ quizId: quizIdFor("ok").toUpperCase() });
    expect(saved.body.class.quizId).toBe(quizIdFor("ok"));
    await tutor.delete(`/api/tutor/classes/${id}`);
  });

  it("hides scheduled and other-cohort classes from students", async () => {
    class1 = await makeClass("Intro to design", mod1, quizIdFor("intro"));
    const scheduled = (await tutor.post("/api/tutor/classes").send({ trackId, cohortId, moduleId: mod1 })).body.id;
    await tutor.patch(`/api/tutor/classes/${scheduled}`).send({ title: "Later", releaseAt: future(), youtubeUrl: "https://youtu.be/dQw4w9WgXcQ", quizId: quizIdFor("later") });
    await tutor.post(`/api/tutor/classes/${scheduled}/publish`);

    expect((await student.get(`/api/student/classes/${class1}`)).status).toBe(200);
    expect((await student.get(`/api/student/classes/${scheduled}`)).status).toBe(404);
    expect((await outsider.get(`/api/student/classes/${class1}`)).status).toBe(404);
    const dash = await student.get("/api/student/dashboard");
    expect(JSON.stringify(dash.body)).not.toContain("Later");
    expect(dash.body.tracks[0].nextSessionAt).toBeTruthy();
    await tutor.post(`/api/tutor/classes/${scheduled}/unpublish`);
  });
});

describe("quiz handoff and results", () => {
  it("requires the watch threshold, then launches ClueQuest with an opaque reference", async () => {
    class2 = await makeClass("Layout basics", mod2, quizIdFor("layout"));

    expect((await launch(student, class1)).body.error.code).toBe("NOT_ELIGIBLE");
    expect((await watch(student, class1, 30)).body.quizEligible).toBe(false);
    expect((await watch(student, class1, 85)).body.quizEligible).toBe(true);
    // Progress never goes backwards.
    expect((await watch(student, class1, 10)).body.watchedPercent).toBe(85);

    const r = await launch(student, class1);
    expect(r.status).toBe(200);
    expect(r.body.launchUrl).toContain("/api/test/quiz/launch");
    const a = await attemptFor("stu@msva.test", class1);
    expect(a.studentRef).not.toContain("stu");
    expect(r.body.launchUrl).not.toContain("stu%40");
    // Relaunching resumes the same attempt.
    await launch(student, class1);
    expect(await ctx.db.quizAttempt.count({ where: { classId: class1 } })).toBe(1);
  });

  it("enforces module prerequisites on direct URL access", async () => {
    const blocked = await student.get(`/api/student/classes/${class2}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("LOCKED");
    expect((await watch(student, class2, 90)).status).toBe(403);
    expect((await launch(student, class2)).status).toBe(403);
  });

  it("does not treat a browser return as a pass; shows pending until a signed callback arrives", async () => {
    await student.post(`/api/student/classes/${class1}/returned`).send({});
    const d = await student.get(`/api/student/classes/${class1}`);
    expect(d.body.state).toBe("PENDING");
    expect((await student.get(`/api/student/classes/${class2}`)).status).toBe(403);
  });

  it("rejects unsigned, tampered, stale and mismatched callbacks", async () => {
    const a = await attemptFor("stu@msva.test", class1);
    expect((await request(app).post("/api/webhooks/cluequest/result").send(resultFor(a))).status).toBe(401);
    expect((await quizResult(app, resultFor(a), { tamper: true })).status).toBe(401);
    expect((await quizResult(app, resultFor(a), { secret: "wrong" })).status).toBe(401);
    expect((await quizResult(app, resultFor(a), { timestamp: Math.floor(Date.now() / 1000) - 3600 })).status).toBe(401);
    expect((await quizResult(app, resultFor(a, { learnerRef: "someone-else" }))).status).toBe(422);
    expect((await quizResult(app, resultFor(a, { quizId: quizIdFor("other") }))).body.error.code).toBe("QUIZ_MISMATCH");
    expect((await quizResult(app, resultFor(a, { partnerAssignmentRef: "nope" }))).status).toBe(422);
    expect((await quizResult(app, { ...resultFor(a), marksEarned: "high" })).status).toBe(422);
    expect((await ctx.db.quizAttempt.findUniqueOrThrow({ where: { id: a.id } })).resultAt).toBeNull();
  });

  it("stores a valid result once, ignores duplicates and late conflicting events, and unlocks the next module", async () => {
    const a = await attemptFor("stu@msva.test", class1);
    const payload = resultFor(a);
    const first = await quizResult(app, payload);
    expect(first.status).toBe(200);
    expect(first.body.outcome).toBe("applied");
    const dup = await quizResult(app, payload);
    expect(dup.body.outcome).toBe("duplicate");
    const conflicting = await quizResult(app, resultFor(a, { marksEarned: 1, percent: 10, passed: false }));
    expect(conflicting.body.outcome).toBe("ignored");

    const row = await ctx.db.quizAttempt.findUniqueOrThrow({ where: { id: a.id } });
    expect(row).toMatchObject({ status: "PASSED", score: 8, maxScore: 10, passMark: 7, passed: true });
    expect(row.providerAttemptId).toBe(payload.attemptId);
    expect(await ctx.db.quizAttempt.count({ where: { classId: class1 } })).toBe(1);

    // Student view and unlock
    const view = await student.get(`/api/student/classes/${class1}`);
    expect(view.body.state).toBe("PASSED");
    expect(view.body.next.id).toBe(class2);
    expect((await student.get(`/api/student/classes/${class2}`)).status).toBe(200);
    expect((await launch(student, class1)).body.error.code).toBe("ALREADY_PASSED");

    // Score synced to Sheets queue
    await admin.post("/api/admin/sync-jobs/run").send({});
    expect(sheets(ctx).rows.some((r) => r.tab === "Scores" && r.values.includes("PASS"))).toBe(true);
  });

  it("shows the tutor the same score and counts students once; ClueQuest sends no per-question detail", async () => {
    const res = await tutor.get(`/api/tutor/classes/${class1}/results`);
    expect(res.body.totals).toEqual({ enrolled: 1, submitted: 1, passed: 1, outstanding: 0 });
    expect(res.body.students[0]).toMatchObject({ studentCode: expect.stringMatching(/^MSVA-/), latestScore: 8, maxScore: 10, passed: true, attempts: 1 });
    expect(res.body.questionInsights).toBeNull();
    const mine = await student.get("/api/student/results");
    expect(mine.body.results[0].best.score).toBe(8);

    const none = await tutor.get(`/api/tutor/classes/${class2}/results`);
    expect(none.body.questionInsights).toBeNull();
    expect(none.body.outstanding).toHaveLength(1);
  });

  it("allows a retake after a failed attempt and counts a retaking student once", async () => {
    await watch(student, class2, 100);
    expect((await launch(student, class2)).status).toBe(200);
    const fail = await attemptFor("stu@msva.test", class2);
    await quizResult(app, resultFor(fail, { marksEarned: 3, percent: 30, passed: false }));
    let v = await student.get(`/api/student/classes/${class2}`);
    expect(v.body.state).toBe("RETAKE");
    expect(v.body.actionLabel).toBe("Retake quiz");
    // The failed class keeps the final module locked.
    classFinal = await makeClass("Final project", finalMod, quizIdFor("final"));
    expect((await student.get(`/api/student/classes/${classFinal}`)).status).toBe(403);

    expect((await launch(student, class2)).status).toBe(200);
    const retry = await attemptFor("stu@msva.test", class2);
    expect(retry.attemptNo).toBe(2);
    await quizResult(app, resultFor(retry, { marksEarned: 9, percent: 90, passed: true }));
    v = await student.get(`/api/student/classes/${class2}`);
    expect(v.body.state).toBe("PASSED");
    expect(v.body.attempts).toHaveLength(2);
    const res = await tutor.get(`/api/tutor/classes/${class2}/results`);
    expect(res.body.totals.submitted).toBe(1);
    expect(res.body.students[0]).toMatchObject({ attempts: 2, latestScore: 9, bestScore: 9 });
  });

  it("blocks a retake once the configured attempt limit is used", async () => {
    const id = await makeClass("One shot", mod1, quizIdFor("oneshot"));
    await watch(student, id, 100);
    await launch(student, id);
    const a = await attemptFor("stu@msva.test", id);
    ctx.config.QUIZ_MAX_ATTEMPTS = 1;
    try {
      await quizResult(app, resultFor(a, { marksEarned: 2, percent: 20, passed: false }));
      const v = await student.get(`/api/student/classes/${id}`);
      expect(v.body.state).toBe("NO_RETAKE");
      expect((await launch(student, id)).body.error.code).toBe("NO_RETAKE");
    } finally {
      ctx.config.QUIZ_MAX_ATTEMPTS = 0;
    }
    await ctx.db.class.update({ where: { id }, data: { status: "DRAFT" } });
  });

  it("issues one certificate after the final assessment and keeps issuance retryable", async () => {
    expect((await student.get("/api/student/dashboard")).body.tracks[0].certificate.eligible).toBe(false);
    await watch(student, classFinal, 100);
    await launch(student, classFinal);
    const a = await attemptFor("stu@msva.test", classFinal);
    // Make PDF generation fail once.
    const real = ctx.certificates.render;
    ctx.certificates.render = async () => {
      throw new Error("renderer down");
    };
    await quizResult(app, resultFor(a));
    ctx.certificates.render = real;
    expect(await ctx.db.certificateEligibility.count()).toBe(1);
    const failed = await ctx.db.certificate.findFirstOrThrow();
    expect(failed.status).toBe("FAILED");
    expect(failed.lastError).toMatch(/renderer down/);

    const retry = await student.post("/api/student/certificates/retry").send({ trackId });
    expect(retry.body.status).toBe("ISSUED");
    expect(await ctx.db.certificate.count()).toBe(1);

    const dl = await student.get(`/api/student/certificates/${retry.body.id}/download`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(dl.status).toBe(200);
    expect((dl.body as Buffer).subarray(0, 4).toString()).toBe("%PDF");
    // Someone else cannot download it.
    expect((await outsider.get(`/api/student/certificates/${retry.body.id}/download`)).status).toBe(404);

    const cert = await ctx.db.certificate.findFirstOrThrow();
    const verify = await request(app).get(`/api/public/verify/${cert.verificationRef}`);
    expect(verify.body).toMatchObject({ valid: true, name: "Stu Dent", track: "Graphic Design" });
    expect(verify.body.studentCode).toMatch(/^MSVA-/);
    expect((await request(app).get("/api/public/verify/NOPE")).status).toBe(404);
  });

  it("returns an unavailable error, not a fake launch, when ClueQuest is not configured", async () => {
    const id = await makeClass("Live adapter check", mod1, quizIdFor("livecheck"));
    await watch(student, id, 100);
    const test = ctx.quiz;
    ctx.quiz = new LiveClueQuestClient(ctx.config);
    const r = await launch(student, id);
    ctx.quiz = test;
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("QUIZ_UNAVAILABLE");
    await ctx.db.class.update({ where: { id }, data: { status: "DRAFT" } });
  });
});

describe("optional multiplayer", () => {
  it("shows a separate live-game link without replacing the individual quiz", async () => {
    const id = (await tutor.post("/api/tutor/classes").send({ trackId, cohortId, moduleId: mod1 })).body.id;
    const p = await tutor.patch(`/api/tutor/classes/${id}`).send({
      title: "With live room", releaseAt: past(), youtubeUrl: "https://youtu.be/dQw4w9WgXcQ", quizId: quizIdFor("solo"), multiplayerUrl: "https://cluequest.test/join/XYZ",
    });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    await tutor.post(`/api/tutor/classes/${id}/publish`);
    const v = await student.get(`/api/student/classes/${id}`);
    expect(v.body.class.multiplayerUrl).toBe("https://cluequest.test/join/XYZ");
    expect(v.body.class.hasQuiz).toBe(true);
    // Removing the individual quiz from a published class is refused even when a room link exists.
    const strip = await tutor.patch(`/api/tutor/classes/${id}`).send({ quizId: "" });
    expect(strip.status).toBe(400);
    await ctx.db.class.update({ where: { id }, data: { status: "DRAFT" } });
  });
});

describe("tutor quiz preview", () => {
  it("lets the tutor launch the real quiz without recording an attempt, and discards the result", async () => {
    const id = await makeClass("Preview me", mod1, quizIdFor("preview"));
    const before = await ctx.db.quizAttempt.count();
    const r = await tutor.post(`/api/tutor/classes/${id}/quiz/preview-launch`).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.launchUrl).toContain("/api/test/quiz/launch");
    expect(r.body.launchUrl).not.toContain("tutor%40");
    expect(await ctx.db.quizAttempt.count()).toBe(before);

    // Each preview is a fresh assignment, so the tutor can try as often as they like.
    const ref = new URL(r.body.launchUrl).searchParams.get("attempt")!;
    expect(ref).toMatch(/^preview-/);
    const again = await tutor.post(`/api/tutor/classes/${id}/quiz/preview-launch`).send({});
    expect(new URL(again.body.launchUrl).searchParams.get("attempt")).not.toBe(ref);

    const payload = {
      eventId: "evt-preview-1", type: "attempt.submitted", partnerAssignmentRef: ref, learnerRef: "preview-x", attemptId: "cq-preview-1",
      quizId: quizIdFor("preview"), marksEarned: 5, marksPossible: 10, passMarkPercent: 70, passed: false, submittedAt: new Date().toISOString(),
    };
    expect((await request(app).post("/api/webhooks/cluequest/result").send(payload)).status).toBe(401); // still must be signed
    const cb = await quizResult(app, payload);
    expect(cb.status).toBe(200);
    expect(cb.body.outcome).toBe("preview");
    expect(await ctx.db.callbackEvent.count({ where: { eventId: "evt-preview-1" } })).toBe(0);
    expect(await ctx.db.quizAttempt.count()).toBe(before);
    await ctx.db.class.update({ where: { id }, data: { status: "DRAFT" } });
  });

  it("needs an attached quiz and is for tutors only", async () => {
    const empty = (await tutor.post("/api/tutor/classes").send({ trackId, cohortId, moduleId: mod1 })).body.id as string;
    const none = await tutor.post(`/api/tutor/classes/${empty}/quiz/preview-launch`).send({});
    expect(none.status).toBe(409);
    expect(none.body.error.code).toBe("NO_QUIZ");
    expect((await student.post(`/api/tutor/classes/${class1}/quiz/preview-launch`).send({})).status).toBe(403);
    await tutor.delete(`/api/tutor/classes/${empty}`);
  });
});

describe("premium courses (Paystack test adapter)", () => {
  let premiumId = "";
  it("only unlocks after server-side verification of amount, currency and customer", async () => {
    premiumId = (await admin.post("/api/admin/tracks").send({ name: "Advanced Security", isPremium: true, priceNaira: 25000 })).body.track.id;
    await admin.post(`/api/admin/tracks/${premiumId}/cohorts`).send({ name: "Premium 1" });

    const courses = await student.get("/api/student/courses");
    expect(courses.body.courses[0]).toMatchObject({ name: "Advanced Security", price: 25000, owned: false });

    const co = await student.post(`/api/student/courses/${premiumId}/checkout`).send({});
    expect(co.status).toBe(200);
    const ref = co.body.reference as string;

    // Nothing paid yet.
    expect((await student.post("/api/student/payments/verify").send({ reference: ref })).body.status).toBe("PENDING");

    // Wrong amount reported by Paystack must not unlock.
    await request(app).post("/api/test/paystack/complete").send({ reference: ref, status: "success", amountKobo: 100 });
    expect((await student.post("/api/student/payments/verify").send({ reference: ref })).body.status).toBe("FAILED");
    expect(await ctx.db.entitlement.count()).toBe(0);

    const co2 = await student.post(`/api/student/courses/${premiumId}/checkout`).send({});
    const ref2 = co2.body.reference as string;
    await request(app).post("/api/test/paystack/complete").send({ reference: ref2, status: "success" });

    // Another student cannot verify it.
    expect((await outsider.post("/api/student/payments/verify").send({ reference: ref2 })).status).toBe(404);

    // Webhook: bad signature rejected, repeated good notifications grant exactly once.
    const raw = JSON.stringify({ event: "charge.success", data: { reference: ref2 } });
    expect((await request(app).post("/api/webhooks/paystack").set("x-paystack-signature", "bad").set("content-type", "application/json").send(raw)).status).toBe(401);
    const sig = hmacHex("sha512", PAYSTACK_SECRET, raw);
    for (let i = 0; i < 3; i++) {
      expect((await request(app).post("/api/webhooks/paystack").set("x-paystack-signature", sig).set("content-type", "application/json").send(raw)).status).toBe(200);
    }
    await student.post("/api/student/payments/verify").send({ reference: ref2 });
    expect(await ctx.db.entitlement.count()).toBe(1);
    expect(await ctx.db.payment.count({ where: { status: "SUCCESS" } })).toBe(1);
    expect(await ctx.db.enrolment.count({ where: { trackId: premiumId, user: { email: "stu@msva.test" } } })).toBe(1);

    expect((await student.post(`/api/student/courses/${premiumId}/checkout`).send({})).status).toBe(409);
    const list = await admin.get("/api/admin/payments");
    expect(list.body.payments.filter((p: { status: string }) => p.status === "SUCCESS")).toHaveLength(1);
    expect(paystack(ctx).results.size).toBe(2);
  });
});

describe("admin views and settings", () => {
  it("lists enrolments, progress, scores and certificates, and stores configurable links", async () => {
    expect((await admin.get("/api/admin/enrolments")).body.enrolments.length).toBeGreaterThan(1);
    const prog = await admin.get("/api/admin/progress");
    expect(prog.body.progress.find((p: { name: string }) => p.name === "Stu Dent")).toBeTruthy();
    expect((await admin.get("/api/admin/scores")).body.scores.length).toBeGreaterThan(2);
    expect((await admin.get("/api/admin/certificates")).body.certificates[0].status).toBe("ISSUED");

    const bad = await admin.put("/api/admin/settings").send({ communityUrl: "javascript:alert(1)", whatsappUrl: "", websiteUrl: "" });
    expect(bad.status).toBe(400);
    await admin.put("/api/admin/settings").send({ communityUrl: "https://community.example", whatsappUrl: "https://wa.me/123", websiteUrl: "https://msva.example" });
    expect((await request(app).get("/api/public/config")).body.links.whatsappUrl).toBe("https://wa.me/123");
  });
});
