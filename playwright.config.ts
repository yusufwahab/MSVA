import { defineConfig, devices } from "@playwright/test";

const WEB = "http://localhost:3100";
const API = "http://localhost:4100";
export const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgresql://msva:msva_dev_pw@localhost:54329/msva_e2e";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: WEB, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    // Phone-sized viewport on Chromium (touch, mobile UA).
    { name: "phone", use: { ...devices["Pixel 5"] } },
  ],
  webServer: [
    {
      command: "npm --prefix server run start",
      url: `${API}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: "4100",
        DATABASE_URL: E2E_DB,
        APP_URL: WEB,
        API_PUBLIC_URL: API,
        EMAIL_ADAPTER: "test",
        CLUEQUEST_ADAPTER: "test",
        CLUEQUEST_BASE_URL: "https://cluequest.test",
        CLUEQUEST_AUTHORING_URL: "https://cluequest.test/quizzes/new",
        CLUEQUEST_WEBHOOK_SECRET: "e2e-cluequest-secret",
        PAYSTACK_ADAPTER: "test",
        PAYSTACK_SECRET_KEY: "sk_test_e2e",
        SHEETS_ADAPTER: "none",
        ENABLE_TEST_ENDPOINTS: "1",
        WATCH_THRESHOLD_PERCENT: "80",
        COMMUNITY_URL: "https://community.example.org",
      },
    },
    {
      command: "npm run build && npm run start -- -p 3100",
      url: WEB,
      reuseExistingServer: false,
      timeout: 300_000,
      env: { API_ORIGIN: API },
    },
  ],
});
