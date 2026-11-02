import { expect, test } from "@playwright/test";

test.describe("public pages", () => {
  test("landing page explains the academy and offers sign in and activation without self-enrolment", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Learn In-Demand Skills");
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Activate account" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "How the academy works" })).toBeVisible();
    for (const step of ["Join your assigned track", "Watch tutor-led sessions", "Take a quiz after every session", "Earn your certificate"]) {
      await expect(page.getByRole("heading", { name: new RegExp(step) })).toBeVisible();
    }
    await expect(page.getByText("There is no public sign-up")).toBeVisible();
    await expect(page.getByRole("link", { name: /sign up|register|enrol now|join now/i })).toHaveCount(0);
    // The configured community link appears in the footer.
    await expect(page.getByRole("link", { name: "Community" })).toHaveAttribute("href", "https://community.example.org");
  });

  test("layout does not overflow horizontally and uses no gradients", async ({ page }) => {
    for (const path of ["/", "/sign-in", "/activate", "/forgot-password"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(0);
    }
    await page.goto("/");
    const gradients = await page.evaluate(() =>
      [...document.querySelectorAll("*")].filter((el) => {
        const s = getComputedStyle(el);
        return s.backgroundImage.includes("gradient") || s.borderImageSource.includes("gradient");
      }).length,
    );
    expect(gradients).toBe(0);
  });

  test("keyboard users get a skip link and a visible focus indicator", async ({ page }) => {
    await page.goto("/sign-in");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
    expect(outline).not.toBe("none");
  });

  test("sign-in form has labelled fields and validates on the server", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await page.goto("/activate");
    await expect(page.getByRole("heading", { name: "Activate your account" })).toBeVisible();
    await page.goto("/verify/NOT-A-REAL-REFERENCE");
    await expect(page.getByRole("alert").filter({ hasText: "No issued certificate" })).toBeVisible();
  });

  test("light and dark themes can be switched, and the choice is remembered", async ({ page }) => {
    await page.goto("/");
    const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
    expect(await theme()).toBe("dark"); // dark is the default
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const darkBg = await bg();

    await page.getByRole("button", { name: "Switch to light mode" }).click();
    expect(await theme()).toBe("light");
    await expect.poll(bg).not.toBe(darkBg); // the colour eases over 150ms
    await page.reload();
    expect(await theme()).toBe("light"); // remembered across a reload and before first paint

    await page.goto("/sign-in");
    expect(await theme()).toBe("light"); // and across pages
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    expect(await theme()).toBe("dark");
    await expect.poll(bg).toBe(darkBg); // the colour eases over 150ms
  });
});
