import type { Config } from "./config.js";
import type { Db } from "./db.js";
import type {
  CertificateRenderer,
  OtpMailer,
  PaystackClient,
  QuizClient,
  SheetsClient,
} from "../services/adapters.js";

export interface Ctx {
  db: Db;
  config: Config;
  mailer: OtpMailer;
  quiz: QuizClient;
  paystack: PaystackClient;
  /** null when SHEETS_ADAPTER=none */
  sheets: SheetsClient | null;
  certificates: CertificateRenderer;
}
