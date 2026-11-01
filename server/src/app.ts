import cookieParser from "cookie-parser";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { ZodError } from "zod";
import type { Config } from "./lib/config.js";
import type { Ctx } from "./lib/ctx.js";
import { createPrisma, type Db } from "./lib/db.js";
import { HttpError } from "./lib/http.js";
import { authenticate, originCheck } from "./middleware/auth.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { publicRouter } from "./routes/public.js";
import { studentRouter } from "./routes/student.js";
import { testRouter } from "./routes/test.js";
import { tutorRouter } from "./routes/tutor.js";
import { webhookRouter } from "./routes/webhooks.js";
import {
  GoogleSheetsClient,
  LiveClueQuestClient,
  LivePaystackClient,
  SupabaseOtpMailer,
  TestOtpMailer,
  TestPaystackClient,
  TestQuizClient,
  TestSheetsClient,
} from "./services/adapters.js";
import { PdfKitRenderer, PythonScriptRenderer } from "./services/certificate.js";

/** Wires adapters from configuration. Tests pass overrides to inject fakes. */
export function buildContext(config: Config, overrides: Partial<Ctx> & { db?: Db } = {}): Ctx {
  const db = overrides.db ?? createPrisma(config.DATABASE_URL);
  return {
    db,
    config,
    mailer: overrides.mailer ?? (config.EMAIL_ADAPTER === "supabase" ? new SupabaseOtpMailer(config) : new TestOtpMailer(db, config)),
    quiz: overrides.quiz ?? (config.CLUEQUEST_ADAPTER === "test" ? new TestQuizClient(config) : new LiveClueQuestClient(config)),
    paystack: overrides.paystack ?? (config.PAYSTACK_ADAPTER === "test" ? new TestPaystackClient(config) : new LivePaystackClient(config.PAYSTACK_SECRET_KEY)),
    sheets:
      overrides.sheets !== undefined
        ? overrides.sheets
        : config.SHEETS_ADAPTER === "google"
          ? new GoogleSheetsClient(config.GOOGLE_SHEETS_ID, config.GOOGLE_SERVICE_ACCOUNT_JSON)
          : config.SHEETS_ADAPTER === "test"
            ? new TestSheetsClient()
            : null,
    certificates:
      overrides.certificates ?? (config.CERTIFICATE_SCRIPT_PATH ? new PythonScriptRenderer(config.CERTIFICATE_SCRIPT_PATH, config.PYTHON_BIN) : new PdfKitRenderer()),
  };
}

export function createApp(ctx: Ctx) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // Webhooks need the untouched bytes for signature checks, so they are mounted before the JSON parser.
  app.use("/api/webhooks", express.raw({ type: () => true, limit: "1mb" }), webhookRouter(ctx));

  app.use(express.json({ limit: "2mb" }));
  app.use("/api", authenticate(ctx), originCheck(ctx));
  app.use("/api/public", publicRouter(ctx));
  app.use("/api/auth", authRouter(ctx));
  app.use("/api/admin", adminRouter(ctx));
  app.use("/api/tutor", tutorRouter(ctx));
  app.use("/api/student", studentRouter(ctx));
  if (ctx.config.ENABLE_TEST_ENDPOINTS) app.use("/api/test", testRouter(ctx));

  app.use("/api", (_req, _res, next) => next(new HttpError(404, "NOT_FOUND", "Not found")));

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, fields: err.details } });
    } else if (err instanceof ZodError) {
      res.status(400).json({ error: { code: "VALIDATION", message: "Invalid request" } });
    } else if (err?.type === "entity.parse.failed") {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: "Body must be valid JSON" } });
    } else if (err?.type === "entity.too.large") {
      res.status(413).json({ error: { code: "TOO_LARGE", message: "Request is too large" } });
    } else {
      console.error(err);
      res.status(500).json({ error: { code: "SERVER_ERROR", message: "Something went wrong on our side. Please try again." } });
    }
  };
  app.use(onError);
  return app;
}
