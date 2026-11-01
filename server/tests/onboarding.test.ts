import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { PASSWORD, activateWithCode, agentFor, createAdmin, latestCode, makeCtx, resetDb, signIn, sheets } from "./helpers.js";

const ctx = makeCtx();
const { app, agent } = agentFor(ctx);

let trackId = "";
let cohortId = "";
let admin: ReturnType<typeof agent>;

beforeAll(async () => {
  await resetDb(ctx);
  await createAdmin(ctx);
  admin = agent();
  await signIn(admin, "admin@msva.test");
  trackId = (await admin.post("/api/admin/tracks").send({ name: "Front-End Development" })).body.track.id;
  cohortId = (await admin.post(`/api/admin/tracks/${trackId}/cohorts`).send({ name: "Cohort 1" })).body.cohort.id;
});
afterAll(async () => {
  await ctx.db.$disconnect();
});

describe("student onboarding", () => {
  it("creates a permanent student ID and emails a one-time code", async () => {
    const r = await admin.post("/api/admin/students").send({ name: "Ada Obi", email: "Ada@Example.com", trackId, cohortId });
    expect(r.status).toBe(201);
    expect(r.body.student.studentCode).toMatch(/^MSVA-\d{5}$/);
    expect(r.body.emailSent).toBe(true);

    // Student cannot sign in before activating.
    expect((await request(app).post("/api/auth/login").send({ email: "ada@example.com", password: PASSWORD })).status).toBe(401);

    const code = await latestCode(ctx, "ada@example.com");
    const weak = await request(app).post("/api/auth/verify-otp").send({ email: "ada@example.com", code, purpose: "activate", password: "short" });
    expect(weak.status).toBe(400);
    const wrong = await request(app).post("/api/auth/verify-otp").send({ email: "ada@example.com", code: code === "000000" ? "000001" : "000000", purpose: "activate", password: PASSWORD });
    expect(wrong.body.error.code).toBe("INVALID_CODE");

    const ok = await activateWithCode(ctx, app, "ada@example.com");
    expect(ok.status).toBe(200);
    expect(ok.body.redirectTo).toBe("/dashboard");
    expect(ok.headers["set-cookie"]?.[0]).toContain("HttpOnly");

    const reuse = await request(app).post("/api/auth/verify-otp").send({ email: "ada@example.com", code, purpose: "activate", password: PASSWORD });
    expect(reuse.status).toBe(400);

    const en = await ctx.db.enrolment.findFirstOrThrow({ where: { user: { email: "ada@example.com" } } });
    expect(en.status).toBe("ACTIVE");
  });

  it("rejects an expired code and a superseded code", async () => {
    await admin.post("/api/admin/students").send({ name: "Bola", email: "bola@example.com", trackId, cohortId });
    const first = await latestCode(ctx, "bola@example.com");
    const u = await ctx.db.user.findUniqueOrThrow({ where: { email: "bola@example.com" } });
    await admin.post(`/api/admin/users/${u.id}/resend-invite`).send({});
    const second = await latestCode(ctx, "bola@example.com");
    expect(second).not.toBe(first);
    const old = await request(app).post("/api/auth/verify-otp").send({ email: "bola@example.com", code: first, purpose: "activate", password: PASSWORD });
    expect(old.body.error.code).toBe("INVALID_CODE");

    await ctx.db.otpCode.updateMany({ where: { email: "bola@example.com" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await request(app).post("/api/auth/verify-otp").send({ email: "bola@example.com", code: second, purpose: "activate", password: PASSWORD });
    expect(expired.status).toBe(400);
    expect(expired.body.error.code).toBe("INVALID_CODE");
    expect((await ctx.db.user.findUniqueOrThrow({ where: { email: "bola@example.com" } })).status).toBe("INVITED");

    // The student can ask for a fresh code from the activation page, and unknown addresses get the same reply.
    const again = await request(app).post("/api/auth/otp/request").send({ email: "bola@example.com", purpose: "activate" });
    const unknown = await request(app).post("/api/auth/otp/request").send({ email: "nobody@example.com", purpose: "activate" });
    expect(again.status).toBe(202);
    expect(unknown.body).toEqual(again.body);
    expect(await ctx.db.emailMessage.count({ where: { to: "nobody@example.com" } })).toBe(0);
    expect((await activateWithCode(ctx, app, "bola@example.com")).status).toBe(200);
  });

  it("locks a code after five wrong guesses", async () => {
    await admin.post("/api/admin/students").send({ name: "Guess", email: "guess@example.com", trackId, cohortId });
    const good = await latestCode(ctx, "guess@example.com");
    const wrongCode = good === "111111" ? "222222" : "111111";
    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/auth/verify-otp").send({ email: "guess@example.com", code: wrongCode, purpose: "activate", password: PASSWORD });
    }
    expect((await request(app).post("/api/auth/verify-otp").send({ email: "guess@example.com", code: good, purpose: "activate", password: PASSWORD })).status).toBe(400);
  });

  it("corrects an incorrect email and sends the code to the new address only", async () => {
    await admin.post("/api/admin/students").send({ name: "Chidi", email: "chdi@example.com", trackId, cohortId });
    const u = await ctx.db.user.findUniqueOrThrow({ where: { email: "chdi@example.com" } });
    const oldCode = await latestCode(ctx, "chdi@example.com");
    const r = await admin.patch(`/api/admin/users/${u.id}/email`).send({ email: "chidi@example.com" });
    expect(r.body.emailSent).toBe(true);
    // The old address no longer belongs to the account, so its code is useless.
    const stale = await request(app).post("/api/auth/verify-otp").send({ email: "chdi@example.com", code: oldCode, purpose: "activate", password: PASSWORD });
    expect(stale.status).toBe(400);
    expect((await activateWithCode(ctx, app, "chidi@example.com")).status).toBe(200);
  });

  it("does not duplicate a student when the same CSV is imported twice", async () => {
    const csv = ["name,email,track,cohort", "Dayo,dayo@example.com,Front-End Development,Cohort 1", "Eze,eze@example.com,Front-End Development,Cohort 1", "Dayo again,DAYO@example.com,Front-End Development,Cohort 1", "Bad,not-an-email,Front-End Development,Cohort 1", "Nowhere,nw@example.com,Unknown Track,Cohort 1"].join("\n");
    const prev = await admin.post("/api/admin/students/import/preview").send({ csv });
    expect(prev.body.counts).toMatchObject({ new_student: 2, duplicate_in_file: 1, invalid: 2 });
    expect(prev.body.rows.find((r: { email: string; status: string }) => r.email === "not-an-email").reason).toMatch(/not valid/);

    const first = await admin.post("/api/admin/students/import/commit").send({ csv });
    expect(first.body.imported).toBe(2);
    const second = await admin.post("/api/admin/students/import/commit").send({ csv });
    expect(second.body.imported).toBe(0);
    expect(await ctx.db.user.count({ where: { email: { in: ["dayo@example.com", "eze@example.com"] } } })).toBe(2);
    expect(await ctx.db.enrolment.count({ where: { user: { email: "dayo@example.com" } } })).toBe(1);
    const again = await admin.post("/api/admin/students/import/preview").send({ csv });
    expect(again.body.counts.already_enrolled).toBe(2);
  });

  it("revokes an existing session when the account is deactivated", async () => {
    const s = agent();
    await signIn(s, "ada@example.com");
    expect((await s.get("/api/student/dashboard")).status).toBe(200);
    const u = await ctx.db.user.findUniqueOrThrow({ where: { email: "ada@example.com" } });
    await admin.post(`/api/admin/users/${u.id}/deactivate`).send({});
    expect((await s.get("/api/student/dashboard")).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ email: "ada@example.com", password: PASSWORD })).status).toBe(401);
    await admin.post(`/api/admin/users/${u.id}/reactivate`).send({});
    await signIn(agent(), "ada@example.com");
  });

  it("supports password reset with an emailed code, without revealing whether an account exists", async () => {
    const unknown = await request(app).post("/api/auth/otp/request").send({ email: "nobody@example.com", purpose: "reset" });
    const known = await request(app).post("/api/auth/otp/request").send({ email: "ada@example.com", purpose: "reset" });
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(await ctx.db.emailMessage.count({ where: { to: "nobody@example.com" } })).toBe(0);
    const code = await latestCode(ctx, "ada@example.com");
    const s = agent();
    await signIn(s, "ada@example.com");
    // An active account cannot be "activated" again with a reset code.
    expect((await request(app).post("/api/auth/verify-otp").send({ email: "ada@example.com", code, purpose: "activate", password: "a-brand-new-password" })).status).toBe(400);
    expect((await request(app).post("/api/auth/verify-otp").send({ email: "ada@example.com", code, purpose: "reset", password: "a-brand-new-password" })).status).toBe(200);
    expect((await s.get("/api/auth/me")).status).toBe(401);
    await signIn(agent(), "ada@example.com", "a-brand-new-password");
    // restore for later tests
    const u = await ctx.db.user.findUniqueOrThrow({ where: { email: "ada@example.com" } });
    const { hashPassword } = await import("../src/lib/security.js");
    await ctx.db.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
  });

  it("queues Sheets jobs and survives a Sheets outage", async () => {
    sheets(ctx).failNext = 1000;
    await admin.post("/api/admin/students").send({ name: "Fumi", email: "fumi@example.com", trackId, cohortId });
    const run1 = await admin.post("/api/admin/sync-jobs/run").send({});
    expect(run1.body.retried).toBeGreaterThan(0);
    expect(await ctx.db.user.count({ where: { email: "fumi@example.com" } })).toBe(1);
    sheets(ctx).failNext = 0;
    const run2 = await admin.post("/api/admin/sync-jobs/run").send({});
    expect(run2.body.done).toBeGreaterThan(0);
    expect(sheets(ctx).rows.some((r) => r.tab === "Registrations" && r.values.includes("fumi@example.com"))).toBe(true);
  });
});

describe("roles and tutors", () => {
  it("blocks students and anonymous users from admin APIs", async () => {
    expect((await request(app).get("/api/admin/students")).status).toBe(401);
    const s = agent();
    await signIn(s, "ada@example.com");
    expect((await s.get("/api/admin/students")).status).toBe(403);
    expect((await s.get("/api/tutor/classes")).status).toBe(403);
  });

  it("keeps classes and results when a tutor is removed", async () => {
    const t = await admin.post("/api/admin/tutors").send({ name: "Tutor One", email: "tutor1@example.com", trackIds: [trackId] });
    expect(t.status).toBe(201);
    const act = await activateWithCode(ctx, app, "tutor1@example.com");
    expect(act.body.redirectTo).toBe("/tutor");
    const tut = agent();
    await signIn(tut, "tutor1@example.com");
    const mod = (await admin.post(`/api/admin/tracks/${trackId}/modules`).send({ title: "Module 1" })).body.module;
    const created = await tut.post("/api/tutor/classes").send({ trackId, cohortId, moduleId: mod.id });
    expect(created.status).toBe(201);

    await admin.delete(`/api/admin/tutors/${t.body.tutor.id}`);
    expect((await tut.get("/api/tutor/classes")).status).toBe(401);
    expect(await ctx.db.class.count({ where: { authorId: t.body.tutor.id } })).toBe(1);
  });

  it("limits a tutor to assigned tracks", async () => {
    const other = (await admin.post("/api/admin/tracks").send({ name: "Cybersecurity" })).body.track.id;
    const otherCohort = (await admin.post(`/api/admin/tracks/${other}/cohorts`).send({ name: "C1" })).body.cohort.id;
    const otherMod = (await admin.post(`/api/admin/tracks/${other}/modules`).send({ title: "M1" })).body.module.id;
    await admin.post("/api/admin/tutors").send({ name: "Tutor Two", email: "tutor2@example.com", trackIds: [trackId] });
    await activateWithCode(ctx, app, "tutor2@example.com");
    const tut = agent();
    await signIn(tut, "tutor2@example.com");
    const r = await tut.post("/api/tutor/classes").send({ trackId: other, cohortId: otherCohort, moduleId: otherMod });
    expect(r.status).toBe(403);
    const overview = await tut.get("/api/tutor/overview");
    expect(overview.body.tracks.map((t: { name: string }) => t.name)).toEqual(["Front-End Development"]);
  });
});
