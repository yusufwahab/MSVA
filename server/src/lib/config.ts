import { z } from "zod";

const bool = z
  .enum(["0", "1", "true", "false", ""])
  .optional()
  .transform((v) => v === "1" || v === "true");

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  /** Public origin of the Next.js app (used in emails, redirects and CSRF origin checks). */
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** Public origin of this API (used in callback URLs and by the test-only quiz page). */
  API_PUBLIC_URL: z.string().url().default("http://localhost:4000"),
  SESSION_TTL_DAYS: z.coerce.number().default(14),
  WATCH_THRESHOLD_PERCENT: z.coerce.number().min(1).max(100).default(80),

  /** "brevo" emails the one-time codes through Brevo; "test" keeps them in the database (never in production). */
  EMAIL_ADAPTER: z.enum(["test", "brevo"]).default("test"),
  BREVO_API_KEY: z.string().default(""),
  /** Must be a sender verified in Brevo. */
  EMAIL_FROM_ADDRESS: z.string().default(""),
  EMAIL_FROM_NAME: z.string().default("MS Virtual Academy"),
  /** How long an activation code (sent when someone is invited) stays valid. */
  ACTIVATION_CODE_TTL_HOURS: z.coerce.number().default(72),
  RESET_CODE_TTL_MINUTES: z.coerce.number().default(60),

  /** "test" uses an in-process stand-in; "live" talks to ClueQuest's partner API. */
  CLUEQUEST_ADAPTER: z.enum(["test", "live"]).default("live"),
  /** Origin of the ClueQuest web app. Multiplayer room links must be on it. */
  CLUEQUEST_BASE_URL: z.string().default(""),
  /** Page opened by "Create quiz in ClueQuest". */
  CLUEQUEST_AUTHORING_URL: z.string().default(""),
  /** Origin of the ClueQuest API (partner endpoints live under /api/partner/v1). */
  CLUEQUEST_API_URL: z.string().default(""),
  CLUEQUEST_API_KEY: z.string().default(""),
  CLUEQUEST_WEBHOOK_SECRET: z.string().default(""),
  /** MSVA's pass mark, sent to ClueQuest at launch. */
  QUIZ_PASS_MARK_PERCENT: z.coerce.number().min(0).max(100).default(70),
  /** Attempts a student may use per class. 0 means unlimited retakes. */
  QUIZ_MAX_ATTEMPTS: z.coerce.number().int().min(0).default(0),

  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),

  PAYSTACK_ADAPTER: z.enum(["test", "live"]).default("live"),
  PAYSTACK_SECRET_KEY: z.string().default(""),

  SHEETS_ADAPTER: z.enum(["none", "test", "google"]).default("none"),
  GOOGLE_SHEETS_ID: z.string().default(""),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().default(""),

  CERTIFICATE_SCRIPT_PATH: z.string().default(""),
  PYTHON_BIN: z.string().default("python"),

  COMMUNITY_URL: z.string().default(""),
  WHATSAPP_URL: z.string().default(""),
  WEBSITE_URL: z.string().default(""),

  ENABLE_TEST_ENDPOINTS: bool,
  RUN_JOBS: bool,
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === "production") {
    if (c.ENABLE_TEST_ENDPOINTS) throw new Error("ENABLE_TEST_ENDPOINTS must not be set in production");
    if (c.EMAIL_ADAPTER === "test") throw new Error("EMAIL_ADAPTER=test is not allowed in production");
    if (c.CLUEQUEST_ADAPTER === "test") throw new Error("CLUEQUEST_ADAPTER=test is not allowed in production");
    if (c.EMAIL_ADAPTER === "brevo" && (!c.BREVO_API_KEY || !c.EMAIL_FROM_ADDRESS)) throw new Error("BREVO_API_KEY and EMAIL_FROM_ADDRESS are required when EMAIL_ADAPTER=brevo");
    if (c.PAYSTACK_ADAPTER === "test") throw new Error("PAYSTACK_ADAPTER=test is not allowed in production");
  }
  return c;
}
