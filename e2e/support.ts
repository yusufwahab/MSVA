import { createHash, createHmac } from "node:crypto";
import { expect, request as pwRequest, type APIRequestContext, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { ADMIN } from "./global-setup";

export const WEB = "http://localhost:3100";
export const API = "http://localhost:4100";
export const QUIZ_SECRET = "e2e-cluequest-secret";
export const PASSWORD = "e2e-student-password";
export { ADMIN };

/** A browser context with the project's device settings and ClueQuest's domain stubbed (it does not exist in tests). */
export async function newActor(browser: Browser, info: TestInfo): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...info.project.use, baseURL: WEB });
  await ctx.route("https://cluequest.test/**", (route) => route.fulfill({ contentType: "text/html", body: "<h1>ClueQuest authoring stand-in</h1>" }));
  // The real YouTube player is not needed; progress is driven through the API in tests.
  await ctx.route("https://www.youtube.com/**", (route) => route.abort());
  return { ctx, page: await ctx.newPage() };
}

export async function apiAs(email: string, password: string): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: API });
  const r = await ctx.post("/api/auth/login", { data: { email, password } });
  expect(r.status(), `login ${email}`).toBe(200);
  return ctx;
}

export async function anon(): Promise<APIRequestContext> {
  return pwRequest.newContext({ baseURL: API });
}

/** Stable, valid-looking ClueQuest quiz id for a label. */
export function quizIdFor(label: string) {
  const h = createHash("sha1").update(label).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** The newest one-time code the test mailer recorded for an address. */
export async function emailCode(a: APIRequestContext, to: string): Promise<string> {
  const r = await a.get(`/api/test/emails?to=${encodeURIComponent(to)}&kind=otp`);
  const { emails } = (await r.json()) as { emails: { text: string }[] };
  expect(emails.length, `code email for ${to}`).toBeGreaterThan(0);
  return emails[0].text.match(/\b(\d{6})\b/)![1]!;
}

export async function signInUi(page: Page, email: string, password: string, expectUrl: RegExp) {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(expectUrl);
}

export async function fillActivation(page: Page, email: string, code: string, password = PASSWORD) {
  await page.goto(`/activate?email=${encodeURIComponent(email)}`);
  await expect(page.getByLabel("Email address")).toHaveValue(email);
  await page.getByLabel("Code from the email").fill(code);
  await page.getByLabel("Choose a password").fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: /^Activate and go to my dashboard$/ }).click();
}

/** Activates through the real page, using the code the test mailer recorded. */
export async function activateUi(page: Page, email: string, expectUrl: RegExp) {
  await fillActivation(page, email, await emailCode(await anon(), email));
  await expect(page).toHaveURL(expectUrl);
}

export function signedQuizResult(a: APIRequestContext, payload: Record<string, unknown>) {
  const raw = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `v1=${createHmac("sha256", QUIZ_SECRET).update(`${ts}.${raw}`).digest("hex")}`;
  return a.post("/api/webhooks/cluequest/result", {
    data: raw,
    headers: { "content-type": "application/json", "x-cluequest-timestamp": ts, "x-cluequest-signature": sig, "x-cluequest-event-id": String(payload.eventId) },
  });
}

export async function attemptFor(a: APIRequestContext, classId: string, email: string) {
  const r = await a.get(`/api/test/attempts?classId=${classId}&email=${encodeURIComponent(email)}`);
  const { attempts } = (await r.json()) as { attempts: { id: string; studentRef: string; quizId: string; attemptNo: number }[] };
  return attempts[0];
}

export function resultPayload(at: { id: string; studentRef: string; quizId: string }, over: Record<string, unknown> = {}) {
  return {
    eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: "attempt.submitted",
    partnerAssignmentRef: at.id,
    learnerRef: at.studentRef,
    attemptId: `cq-${Math.random().toString(36).slice(2)}`,
    quizId: at.quizId,
    quizVersion: 1,
    activityType: "solo",
    style: "points",
    marksEarned: 8,
    marksPossible: 10,
    percent: 80,
    passMarkPercent: 70,
    passed: true,
    submittedAt: new Date().toISOString(),
    autoSubmitted: false,
    ...over,
  };
}

/* ---------------------------------------------------------- API seeding */

export interface World {
  tag: string;
  admin: APIRequestContext;
  tutor: APIRequestContext;
  trackId: string;
  trackName: string;
  cohortA: string;
  cohortB: string;
  mod1: string;
  mod2: string;
}

const past = () => new Date(Date.now() - 3600_000).toISOString();

export async function createStaff(admin: APIRequestContext, anonCtx: APIRequestContext, kind: "tutors" | "students", body: Record<string, unknown>) {
  const r = await admin.post(`/api/admin/${kind}`, { data: body });
  expect(r.status(), JSON.stringify(await r.json().catch(() => ({})))).toBe(201);
  const code = await emailCode(admin, body.email as string);
  const act = await anonCtx.post("/api/auth/verify-otp", { data: { email: body.email, code, purpose: "activate", password: PASSWORD } });
  expect(act.status()).toBe(200);
  return apiAs(body.email as string, PASSWORD);
}

export async function seedWorld(tag: string): Promise<World> {
  const admin = await apiAs(ADMIN.email, ADMIN.password);
  const an = await anon();
  const trackName = `Track ${tag}`;
  const trackId = (await (await admin.post("/api/admin/tracks", { data: { name: trackName } })).json()).track.id as string;
  const cohortA = (await (await admin.post(`/api/admin/tracks/${trackId}/cohorts`, { data: { name: "Cohort A" } })).json()).cohort.id as string;
  const cohortB = (await (await admin.post(`/api/admin/tracks/${trackId}/cohorts`, { data: { name: "Cohort B" } })).json()).cohort.id as string;
  const mod1 = (await (await admin.post(`/api/admin/tracks/${trackId}/modules`, { data: { title: "Module One" } })).json()).module.id as string;
  const mod2 = (await (await admin.post(`/api/admin/tracks/${trackId}/modules`, { data: { title: "Module Two" } })).json()).module.id as string;
  const tutor = await createStaff(admin, an, "tutors", { name: "Edge Tutor", email: `tutor-${tag}@e2e.test`, trackIds: [trackId] });
  return { tag, admin, tutor, trackId, trackName, cohortA, cohortB, mod1, mod2 };
}

export async function addStudent(w: World, name: string, cohortId: string) {
  const email = `${name.toLowerCase().replace(/\W+/g, "")}-${w.tag}@e2e.test`;
  const api = await createStaff(w.admin, await anon(), "students", { name, email, trackId: w.trackId, cohortId });
  return { email, api };
}

export async function publishClass(
  w: World,
  o: { title: string; moduleId: string; cohortId?: string; quiz?: string; multiplayer?: string; release?: string },
) {
  const created = await w.tutor.post("/api/tutor/classes", { data: { trackId: w.trackId, cohortId: o.cohortId ?? w.cohortA, moduleId: o.moduleId } });
  const id = (await created.json()).id as string;
  const patch = await w.tutor.patch(`/api/tutor/classes/${id}`, {
    data: {
      title: o.title,
      releaseAt: o.release ?? past(),
      youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      quizId: o.quiz ?? quizIdFor(`${w.tag}-${o.title}`),
      multiplayerUrl: o.multiplayer ?? "",
    },
  });
  expect(patch.status(), JSON.stringify(await patch.json())).toBe(200);
  const pub = await w.tutor.post(`/api/tutor/classes/${id}/publish`, { data: {} });
  expect(pub.status()).toBe(200);
  return id;
}

export async function watchTo(a: APIRequestContext, classId: string, pct: number) {
  const r = await a.put(`/api/student/classes/${classId}/progress`, { data: { positionSeconds: pct * 10, durationSeconds: 1000 } });
  expect(r.status()).toBe(200);
}
