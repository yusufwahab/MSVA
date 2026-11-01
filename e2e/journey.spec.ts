import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { ADMIN, PASSWORD, activateUi, anon, apiAs, attemptFor, emailCode, fillActivation, newActor, quizIdFor, resultPayload, signInUi, signedQuizResult } from "./support";

/**
 * The main acceptance journey, driven entirely through the browser UI:
 * admin invites student -> student activates -> tutor publishes class with video and individual quiz ->
 * student completes video -> launches ClueQuest as a guest -> result reaches MSVA -> tutor sees the same score ->
 * next class unlocks.
 */
test.describe.serial("complete learning journey", () => {
  let tag = "";
  let trackName = "";
  const email = () => `ada-${tag}@e2e.test`;
  const tutorEmail = () => `tutor-${tag}@e2e.test`;
  let admin: { ctx: BrowserContext; page: Page };
  let student: { ctx: BrowserContext; page: Page };
  let tutor: { ctx: BrowserContext; page: Page };
  let class1 = "";
  const classTitle1 = () => `Colour theory ${tag}`;
  const classTitle2 = () => `Typography ${tag}`;

  test.beforeAll(async ({ browser }, info) => {
    tag = `${info.project.name}${Date.now().toString(36)}`;
    trackName = `Graphic Design ${tag}`;
    admin = await newActor(browser, info);
    student = await newActor(browser, info);
    tutor = await newActor(browser, info);
  });
  test.afterAll(async () => {
    await Promise.all([admin.ctx.close(), student.ctx.close(), tutor.ctx.close()]);
  });

  test("admin creates a track, cohort and modules", async () => {
    const { page } = admin;
    await signInUi(page, ADMIN.email, ADMIN.password, /\/admin$/);
    await page.goto("/admin/tracks");
    await page.getByRole("button", { name: "New track" }).click();
    await page.getByLabel("Track name").fill(trackName);
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    const card = page.locator("section", { has: page.getByRole("heading", { name: trackName }) });
    await expect(card).toBeVisible();

    await card.getByRole("button", { name: "Add cohort" }).click();
    await page.getByLabel("Cohort name").fill("Cohort 1");
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(card.getByText("Cohort 1")).toBeVisible();

    for (const title of ["Foundations", "Layout"]) {
      await card.getByRole("button", { name: "Add module" }).click();
      await page.getByLabel("Module title").fill(title);
      await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
      await expect(card.getByText(title, { exact: false }).first()).toBeVisible();
    }
  });

  test("admin invites a student and a tutor", async () => {
    const { page } = admin;
    await page.goto("/admin/students");
    await page.getByRole("button", { name: "Add student" }).click();
    await page.getByLabel("Full name").fill("Ada Obi");
    await page.getByLabel("Email address").fill(email());
    await page.getByLabel("Track").selectOption({ label: trackName });
    await page.getByLabel("Cohort").selectOption({ label: "Cohort 1" });
    await page.getByRole("button", { name: "Add and send invite" }).click();
    await expect(page.getByText(`Invitation sent to ${email()}`)).toBeVisible();
    await expect(page.getByRole("row", { name: new RegExp(email()) })).toContainText("Awaiting activation");

    await page.goto("/admin/tutors");
    await page.getByRole("button", { name: "Invite tutor" }).click();
    await page.getByLabel("Full name").fill("Tola Tutor");
    await page.getByLabel("Email address").fill(tutorEmail());
    await page.getByLabel(trackName).check();
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.getByText(`Invitation sent to ${tutorEmail()}`)).toBeVisible();
  });

  test("student activates with the emailed code and lands on the dashboard", async () => {
    const { page } = student;
    const code = await emailCode(await anon(), email());
    await page.goto(`/activate?email=${encodeURIComponent(email())}`);
    await expect(page.getByLabel("Email address")).toHaveValue(email());

    // A wrong code is refused and does not use up the real one.
    await fillActivation(page, email(), code === "123456" ? "654321" : "123456");
    await expect(page.getByText("That code is not correct or has expired")).toBeVisible();

    await fillActivation(page, email(), code);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "No class is open right now" })).toBeVisible();
    await expect(page.getByText(trackName).first()).toBeVisible();

    // The code is single-use.
    await fillActivation(page, email(), code, "another-password-1");
    await expect(page.getByText("That code is not correct or has expired")).toBeVisible();
  });

  async function createClass(page: Page, o: { title: string; moduleTitle: string; quiz: string }) {
    await page.goto("/tutor");
    await page.getByRole("button", { name: "New class" }).click();
    await page.getByLabel("Track", { exact: true }).selectOption({ label: trackName });
    await page.getByLabel("Cohort").selectOption({ label: "Cohort 1" });
    await page.getByLabel("Module").selectOption({ label: o.moduleTitle });
    await page.getByRole("button", { name: "Create draft" }).click();
    await expect(page).toHaveURL(/\/tutor\/classes\/[^/]+$/);
    const id = page.url().split("/").pop()!;

    await page.getByLabel("Class title").fill(o.title);
    await page.getByLabel("Description").fill("Notes for this session.");
    await page.getByLabel("Release date and time").fill("2020-01-01T09:00");
    await page.getByLabel("YouTube video link").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    return { id, quiz: o.quiz };
  }

  test("tutor saves an incomplete draft, is blocked from publishing without a quiz, then attaches one", async ({}, info) => {
    const { page, ctx } = tutor;
    await activateUi(page, tutorEmail(), /\/tutor$/);
    await expect(page.getByRole("heading", { name: "My classes" })).toBeVisible();

    const c = await createClass(page, { title: classTitle1(), moduleTitle: "Foundations", quiz: quizIdFor(`${tag}-1`) });
    class1 = c.id;
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await expect(page.getByTestId("quiz-status")).toContainText("No quiz attached yet");

    // Publishing without the compulsory individual quiz is refused.
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Publish class" }).click();
    await expect(page.getByText("An individual ClueQuest quiz is required to publish")).toBeVisible();

    // A room address is not a quiz ID, so it cannot stand in for the individual quiz.
    await page.getByLabel("ClueQuest quiz ID").fill("https://cluequest.test/join/ABC123");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText(/quiz ID/i).first()).toBeVisible();

    // Addresses outside the configured ClueQuest origin are refused.
    await page.getByLabel("ClueQuest quiz ID").fill(`https://not-cluequest.example/quizzes/${quizIdFor("x")}`);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("must be on https://cluequest.test")).toBeVisible();

    // An id ClueQuest does not know is refused.
    await page.getByLabel("ClueQuest quiz ID").fill("00000000-0000-4000-8000-000000000000");
    await page.getByRole("button", { name: "Check quiz" }).click();
    await expect(page.getByText(/cannot find this quiz/i)).toBeVisible();

    // "Create quiz in ClueQuest" opens the authoring page in a new tab and keeps the draft.
    await page.getByLabel("ClueQuest quiz ID").fill("");
    const popup = ctx.waitForEvent("page");
    await page.getByRole("button", { name: "Create quiz in ClueQuest" }).click();
    expect((await popup).url()).toBe("https://cluequest.test/quizzes/new");
    await (await popup).close();
    await expect(page.getByText("ClueQuest opened in a new tab")).toBeVisible();

    await page.getByLabel("ClueQuest quiz ID").fill(c.quiz);
    await page.getByRole("button", { name: "Check quiz" }).click();
    await expect(page.getByText(/Quiz found/)).toBeVisible();
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByTestId("quiz-status")).toContainText("Quiz attached");

    await page.getByRole("link", { name: "Preview as student" }).click();
    await expect(page).toHaveURL(/preview$/);
    await expect(page.getByRole("button", { name: "Take session quiz" })).toBeDisabled();
    await page.goBack();

    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Publish class" }).click();
    await expect(page.getByText(/Published\./)).toBeVisible();
    void info;
  });

  test("tutor publishes a second class in the next module", async () => {
    const { page } = tutor;
    const c = await createClass(page, { title: classTitle2(), moduleTitle: "Layout", quiz: quizIdFor(`${tag}-2`) });
    await page.getByLabel("ClueQuest quiz ID").fill(c.quiz);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByTestId("quiz-status")).toContainText("Quiz attached");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Publish class" }).click();
    await expect(page.getByText(/Published\./)).toBeVisible();
  });

  test("student sees the class, watches enough video, and the quiz unlocks", async () => {
    const { page } = student;
    await page.goto("/dashboard");
    await expect(page.getByTestId("next-class")).toHaveText(classTitle1());
    // The second module is locked until the first quiz is passed.
    await expect(page.getByText(classTitle2())).toBeVisible();
    await expect(page.getByRole("link", { name: classTitle2() })).toHaveCount(0);

    await page.getByRole("link", { name: "Watch class" }).click();
    await expect(page).toHaveURL(new RegExp(`/classes/${class1}`));
    await expect(page.getByTestId("watched")).toContainText("0%");
    await expect(page.getByRole("button", { name: "Take session quiz" })).toHaveCount(0);

    // Viewing progress is saved server-side (the YouTube player reports it the same way).
    const r = await page.request.put(`/api/student/classes/${class1}/progress`, { data: { positionSeconds: 400, durationSeconds: 1000 } });
    expect(r.status()).toBe(200);
    await page.reload();
    await expect(page.getByTestId("watched")).toContainText("40%");
    await expect(page.getByRole("button", { name: "Take session quiz" })).toHaveCount(0);

    await page.request.put(`/api/student/classes/${class1}/progress`, { data: { positionSeconds: 900, durationSeconds: 1000 } });
    await page.reload();
    await expect(page.getByTestId("watched")).toContainText("90%");
    await expect(page.getByRole("button", { name: "Take session quiz" })).toBeEnabled();
  });

  test("student launches ClueQuest as a guest in the same tab and sees a pending result until the signed callback arrives", async () => {
    const { page } = student;
    await page.getByRole("button", { name: "Take session quiz" }).click();
    await expect(page).toHaveURL(/\/api\/test\/quiz\/launch/);
    await expect(page.getByText("No account, name or room code was asked for.")).toBeVisible();
    expect(page.context().pages()).toHaveLength(1); // same tab

    await page.getByRole("link", { name: "Return to MS Virtual Academy" }).click();
    await expect(page).toHaveURL(new RegExp(`/classes/${class1}`));
    // A browser redirect alone must not mark anything as passed.
    await expect(page.getByText("Result pending").first()).toBeVisible();
    await expect(page.getByText("Quiz passed")).toHaveCount(0);

    // ClueQuest sends the signed result later; the open page picks it up.
    const a = await anon();
    const at = await attemptFor(a, class1, email());
    const res = await signedQuizResult(a, resultPayload(at, { marksEarned: 8, marksPossible: 10, percent: 80, passed: true }));
    expect(res.status()).toBe(200);
    await expect(page.getByText("Quiz passed")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Your best score is 8/10.")).toBeVisible();

    // A duplicate delivery is harmless.
    const dup = await signedQuizResult(a, resultPayload(at));
    expect((await dup.json()).outcome).toBe("ignored");
  });

  test("tutor sees the same score and the next class unlocks for the student", async () => {
    const t = tutor.page;
    await t.goto(`/tutor/classes/${class1}/results`);
    await expect(t.getByTestId("total-enrolled")).toHaveText("1");
    await expect(t.getByTestId("total-submitted")).toHaveText("1");
    await expect(t.getByTestId("total-outstanding")).toHaveText("0");
    await expect(t.getByRole("row", { name: /Ada Obi/ })).toContainText("8/10");
    await expect(t.getByText("ClueQuest does not send question-level data")).toBeVisible();

    const s = student.page;
    await s.goto("/dashboard");
    await expect(s.getByTestId("next-class")).toHaveText(classTitle2());
    await s.getByRole("link", { name: "Continue", exact: true }).click();
    await expect(s.getByRole("heading", { name: classTitle2() })).toBeVisible();

    await s.goto("/progress");
    await expect(s.getByRole("heading", { name: classTitle1() })).toBeVisible();
    await expect(s.getByRole("row", { name: /8\/10/ })).toBeVisible();
  });

  test("a second sign-in works for the returning student", async ({ browser }, info) => {
    const fresh = await newActor(browser, info);
    await signInUi(fresh.page, email(), PASSWORD, /\/dashboard$/);
    const api = await apiAs(email(), PASSWORD);
    expect((await api.get("/api/auth/me")).status()).toBe(200);
    await fresh.ctx.close();
  });
});
