import { mkdirSync } from "node:fs";
import { test } from "@playwright/test";
import { ADMIN, PASSWORD, addStudent, newActor, publishClass, seedWorld, signInUi, watchTo } from "./support";

/**
 * Design review helper, not a regression test: set VISUAL=<output folder> to capture every screen
 * in both themes for the project's viewport. Skipped otherwise.
 */
const OUT = process.env.VISUAL;
test.skip(!OUT, "set VISUAL=<folder> to capture screenshots");

test("capture every screen in dark and light", async ({ browser }, info) => {
  test.setTimeout(240_000);
  const dir = `${OUT}/${info.project.name}`;
  mkdirSync(dir, { recursive: true });
  const w = await seedWorld(`vis${info.project.name}${Date.now().toString(36)}`);
  const s = await addStudent(w, "Ada Visual", w.cohortA);
  const c1 = await publishClass(w, { title: "Colour theory", moduleId: w.mod1, multiplayer: "https://cluequest.test/join/LIVE1" });
  await publishClass(w, { title: "Typography and layout", moduleId: w.mod2 });
  await watchTo(s.api, c1, 45);

  for (const theme of ["dark", "light"] as const) {
    const shot = async (page: import("@playwright/test").Page, name: string) => {
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${dir}/${theme}-${name}.png`, fullPage: true });
    };
    const actor = async () => {
      const a = await newActor(browser, info);
      await a.ctx.addInitScript((t) => localStorage.setItem("msva-theme", t), theme);
      return a;
    };

    // Public
    const pub = await actor();
    for (const [path, name] of [["/", "landing"], ["/sign-in", "sign-in"], ["/activate", "activate"], ["/forgot-password", "forgot"]] as const) {
      await pub.page.goto(path);
      await shot(pub.page, name);
    }
    await pub.ctx.close();

    // Student
    const st = await actor();
    await signInUi(st.page, s.email, PASSWORD, /\/dashboard$/);
    await shot(st.page, "student-dashboard");
    await st.page.goto(`/classes/${c1}`);
    await st.page.waitForSelector("[data-testid=watched]");
    await shot(st.page, "student-class");
    await st.page.goto("/progress");
    await shot(st.page, "student-progress");
    await st.page.goto("/courses");
    await shot(st.page, "student-courses");
    await st.ctx.close();

    // Tutor
    const tu = await actor();
    await signInUi(tu.page, `tutor-${w.tag}@e2e.test`, PASSWORD, /\/tutor$/);
    await shot(tu.page, "tutor-home");
    await tu.page.goto(`/tutor/classes/${c1}`);
    await tu.page.waitForSelector("[data-testid=quiz-status]");
    await shot(tu.page, "tutor-class");
    await tu.page.goto(`/tutor/classes/${c1}/results`);
    await tu.page.waitForSelector("[data-testid=total-enrolled]");
    await shot(tu.page, "tutor-results");
    await tu.page.goto(`/tutor/classes/${c1}/preview`);
    await shot(tu.page, "tutor-preview");
    await tu.ctx.close();

    // Admin
    const ad = await actor();
    await signInUi(ad.page, ADMIN.email, ADMIN.password, /\/admin$/);
    await shot(ad.page, "admin-overview");
    for (const [path, name] of [
      ["/admin/tracks", "tracks"],
      ["/admin/students", "students"],
      ["/admin/tutors", "tutors"],
      ["/admin/reports", "reports"],
      ["/admin/certificates", "certificates"],
      ["/admin/payments", "payments"],
      ["/admin/settings", "settings"],
    ] as const) {
      await ad.page.goto(path);
      await shot(ad.page, `admin-${name}`);
    }
    await ad.ctx.close();
  }
});
