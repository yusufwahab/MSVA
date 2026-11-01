import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import {
  ADMIN, PASSWORD, addStudent, anon, apiAs, attemptFor, emailCode, fillActivation, newActor, publishClass, resultPayload, seedWorld, signInUi, signedQuizResult, watchTo, type World,
} from "./support";

test.describe.serial("edge cases", () => {
  let w: World;
  let tag = "";
  let adminUi: { ctx: BrowserContext; page: Page };
  let sA: { email: string; api: APIRequestContext };
  let sB: { email: string; api: APIRequestContext };
  let ui: { ctx: BrowserContext; page: Page };
  let c1 = "";
  let c2 = "";

  test.beforeAll(async ({ browser }, info) => {
    tag = `${info.project.name}${Date.now().toString(36)}e`;
    w = await seedWorld(tag);
    sA = await addStudent(w, "Alice Edge", w.cohortA);
    sB = await addStudent(w, "Bob Edge", w.cohortB);
    c1 = await publishClass(w, { title: "Edge one", moduleId: w.mod1, multiplayer: "https://cluequest.test/join/LIVE1" });
    c2 = await publishClass(w, { title: "Edge two", moduleId: w.mod2 });
    adminUi = await newActor(browser, info);
    ui = await newActor(browser, info);
  });
  test.afterAll(async () => {
    await adminUi.ctx.close();
    await ui.ctx.close();
  });

  test("an expired code explains what to do, and a fresh code works", async ({ browser }, info) => {
    const email = `late-${tag}@e2e.test`;
    const r = await w.admin.post("/api/admin/students", { data: { name: "Late Student", email, trackId: w.trackId, cohortId: w.cohortB } });
    expect(r.status()).toBe(201);
    const stale = await emailCode(w.admin, email);
    await (await anon()).post("/api/test/expire-code", { data: { email } });
    const a = await newActor(browser, info);
    await fillActivation(a.page, email, stale);
    await expect(a.page.getByText("That code is not correct or has expired")).toBeVisible();
    await expect(a.page).toHaveURL(/\/activate/);

    // The student asks for a new code from the page itself; the old one stays dead.
    await a.page.getByRole("button", { name: "Send me a new code" }).click();
    await expect(a.page.getByText(/a new code is on its way/)).toBeVisible();
    const fresh = await emailCode(w.admin, email);
    expect(fresh).not.toBe(stale);
    await fillActivation(a.page, email, stale);
    await expect(a.page.getByText("That code is not correct or has expired")).toBeVisible();
    await fillActivation(a.page, email, fresh);
    await expect(a.page).toHaveURL(/\/dashboard$/);
    await a.ctx.close();
  });

  test("password reset by emailed code signs the student out everywhere", async ({ browser }, info) => {
    const s = await addStudent(w, "Reset Student", w.cohortB);
    const a = await newActor(browser, info);
    await a.page.goto("/forgot-password");
    await a.page.getByLabel("Email address").fill(s.email);
    await a.page.getByRole("button", { name: "Send code" }).click();
    await expect(a.page).toHaveURL(/\/reset-password\?email=/);
    await expect(a.page.getByRole("textbox", { name: "Email address" })).toHaveValue(s.email);
    await a.page.getByLabel("Code from the email").fill(await emailCode(w.admin, s.email));
    await a.page.getByLabel("New password").fill("a-brand-new-password");
    await a.page.getByLabel("Confirm password").fill("a-brand-new-password");
    await a.page.getByRole("button", { name: "Change password" }).click();
    await expect(a.page.getByRole("heading", { name: "Password changed" })).toBeVisible();
    expect((await s.api.get("/api/student/dashboard")).status()).toBe(401);
    await signInUi(a.page, s.email, "a-brand-new-password", /\/dashboard$/);
    await a.ctx.close();
  });

  test("importing the same CSV twice does not duplicate students", async () => {
    const { page } = adminUi;
    await signInUi(page, ADMIN.email, ADMIN.password, /\/admin$/);
    await page.goto("/admin/students");
    const csv = `name,email,track,cohort\nCsv One,csv1-${tag}@e2e.test,${w.trackName},Cohort A\nCsv Two,csv2-${tag}@e2e.test,${w.trackName},Cohort A\nBroken,not-an-email,${w.trackName},Cohort A\nCsv One again,csv1-${tag}@e2e.test,${w.trackName},Cohort A\n`;

    for (const round of [1, 2]) {
      await page.getByRole("button", { name: "Import CSV" }).click();
      await page.locator("#csv-file").setInputFiles({ name: "students.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
      await page.getByRole("button", { name: "Preview import" }).click();
      const dialog = page.getByRole("dialog");
      if (round === 1) {
        await expect(page.getByTestId("csv-summary")).toHaveText("2 to import · 1 skipped · 1 invalid");
        await expect(dialog.getByText("Email is not valid")).toBeVisible();
        await dialog.getByRole("button", { name: /^Import 2 and send invites$/ }).click();
        await expect(page.getByText("Imported 2 student(s); skipped 2.")).toBeVisible();
      } else {
        await expect(page.getByTestId("csv-summary")).toHaveText("0 to import · 3 skipped · 1 invalid");
        await expect(dialog.getByRole("button", { name: /^Import 0/ })).toBeDisabled();
        await dialog.getByRole("button", { name: "Edit file" }).click();
        await dialog.getByRole("button", { name: "Close" }).click();
      }
    }
    const rows = await (await w.admin.get(`/api/admin/students?search=csv1-${tag}`)).json();
    expect(rows.students).toHaveLength(1);
    expect(rows.students[0].enrolments).toHaveLength(1);
  });

  test("a student cannot open another cohort's class or skip a locked module", async () => {
    const { page } = ui;
    await signInUi(page, sB.email, PASSWORD, /\/dashboard$/);
    await page.goto(`/classes/${c1}`);
    await expect(page.getByRole("alert").filter({ hasText: "Class not found" })).toBeVisible();
    expect((await sB.api.get(`/api/student/classes/${c1}`)).status()).toBe(404);
    expect((await sB.api.post(`/api/student/classes/${c1}/quiz/launch`, { data: {} })).status()).toBe(404);
    // Unreleased or draft content is indistinguishable from missing content.
    expect((await sA.api.get("/api/student/classes/does-not-exist")).status()).toBe(404);

    // Student A: module two is locked even by direct URL.
    expect((await sA.api.get(`/api/student/classes/${c2}`)).status()).toBe(403);
    const a = await newActor((await ui.ctx.browser())!, test.info());
    await signInUi(a.page, sA.email, PASSWORD, /\/dashboard$/);
    await a.page.goto(`/classes/${c2}`);
    await expect(a.page.getByRole("alert").filter({ hasText: "Pass the quizzes in the earlier modules" })).toBeVisible();
    await a.ctx.close();
  });

  test("failed attempt, retake, delayed and duplicate callbacks, optional multiplayer", async () => {
    const a = await anon();
    const s = await newActor((await ui.ctx.browser())!, test.info());
    await signInUi(s.page, sA.email, PASSWORD, /\/dashboard$/);
    await s.page.goto(`/classes/${c1}`);

    // Optional multiplayer sits beside, not instead of, the individual quiz.
    await expect(s.page.getByRole("link", { name: "Join live game" })).toHaveAttribute("href", "https://cluequest.test/join/LIVE1");
    await expect(s.page.getByRole("button", { name: "Take session quiz" })).toHaveCount(0);
    await watchTo(sA.api, c1, 100);
    await s.page.reload();
    await expect(s.page.getByRole("button", { name: "Take session quiz" })).toBeEnabled();
    await expect(s.page.getByRole("link", { name: "Join live game" })).toBeVisible();

    // Attempt 1 fails; the student can retake.
    await s.page.getByRole("button", { name: "Take session quiz" }).click();
    await expect(s.page).toHaveURL(/quiz\/launch/);
    await s.page.getByRole("link", { name: "Return to MS Virtual Academy" }).click();
    await expect(s.page.getByText("Result pending").first()).toBeVisible();
    const at1 = await attemptFor(a, c1, sA.email);
    const failPayload = resultPayload(at1, { marksEarned: 3, percent: 30, passed: false });
    expect((await signedQuizResult(a, failPayload)).status()).toBe(200);
    await expect(s.page.getByRole("button", { name: "Retake quiz" })).toBeVisible({ timeout: 20_000 });
    await expect(s.page.getByText("Not passed yet")).toBeVisible();
    // Exact duplicate delivery (same event id).
    expect((await (await signedQuizResult(a, failPayload)).json()).outcome).toBe("duplicate");

    // Retake: a new attempt, then pass.
    await s.page.getByRole("button", { name: "Retake quiz" }).click();
    await expect(s.page).toHaveURL(/quiz\/launch/);
    const at2 = await attemptFor(a, c1, sA.email);
    expect(at2.id).not.toBe(at1.id);
    expect((await signedQuizResult(a, resultPayload(at2, { marksEarned: 9, percent: 90, passed: true }))).status()).toBe(200);
    await s.page.goto(`/classes/${c1}`);
    await expect(s.page.getByText("Quiz passed")).toBeVisible();
    await expect(s.page.getByRole("row", { name: /Not passed/ })).toBeVisible();
    await expect(s.page.getByRole("row", { name: /Passed/ })).toBeVisible();

    // Tutor counts the student once, with both attempts visible.
    const res = await (await w.tutor.get(`/api/tutor/classes/${c1}/results`)).json();
    expect(res.totals).toMatchObject({ enrolled: 1, submitted: 1, passed: 1 });
    expect(res.students[0].attempts).toBe(2);

    // Unsigned and tampered callbacks never change anything.
    const bad = await a.post("/api/webhooks/cluequest/result", { data: JSON.stringify(resultPayload(at2, { marksEarned: 10 })), headers: { "content-type": "application/json" } });
    expect(bad.status()).toBe(401);
    await s.ctx.close();
  });

  test("deactivating a student signs them out of an open session", async () => {
    const { page } = ui;
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Hello, Bob/ })).toBeVisible();

    const admin = adminUi.page;
    await admin.goto("/admin/students");
    await admin.getByLabel("Search by name, email or student ID").fill(sB.email);
    await admin.getByRole("button", { name: "Deactivate Bob Edge" }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "Deactivate" }).click();
    await expect(admin.getByText("has been deactivated and signed out everywhere")).toBeVisible();

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in/);
    expect((await sB.api.get("/api/student/dashboard")).status()).toBe(401);
  });

  test("role areas redirect people who wander into the wrong one", async ({ browser }, info) => {
    const a = await newActor(browser, info);
    await signInUi(a.page, sA.email, PASSWORD, /\/dashboard$/);
    await a.page.goto("/admin");
    await expect(a.page).toHaveURL(/\/dashboard$/);
    await a.page.goto("/tutor");
    await expect(a.page).toHaveURL(/\/dashboard$/);
    await a.ctx.close();

    const anonymous = await newActor(browser, info);
    await anonymous.page.goto("/dashboard");
    await expect(anonymous.page).toHaveURL(/\/sign-in\?next=%2Fdashboard/);
    await anonymous.ctx.close();
  });

  test("wrong password is rejected with a clear message", async ({ browser }, info) => {
    const a = await newActor(browser, info);
    await a.page.goto("/sign-in");
    await a.page.getByLabel("Email address").fill(sA.email);
    await a.page.getByLabel("Password").fill("not-the-password");
    await a.page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(a.page.getByRole("alert").filter({ hasText: "incorrect" })).toBeVisible();
    await a.ctx.close();
    void apiAs;
  });
});
