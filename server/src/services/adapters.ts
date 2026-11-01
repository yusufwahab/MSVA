import { createSign, randomInt } from "node:crypto";
import type { Config } from "../lib/config.js";
import type { Db } from "../lib/db.js";
import { randomToken, sha256 } from "../lib/security.js";

/* ---------------------------------------------------------------- Email */

/**
 * One-time codes for account activation and password reset.
 * With Supabase Auth the code is generated, emailed and checked by Supabase; MSVA never sees it.
 */
export interface OtpMailer {
  readonly mode: "test" | "supabase";
  sendCode(email: string): Promise<{ ok: boolean; error?: string }>;
  /** True only when the code is correct, unused and unexpired. Throws OtpUnavailableError if the service cannot be reached. */
  verifyCode(email: string, code: string): Promise<boolean>;
}

export class OtpUnavailableError extends Error {}

/** Keeps codes in the database and records each email so tests and local development can read the code. */
export class TestOtpMailer implements OtpMailer {
  readonly mode = "test" as const;
  constructor(
    private db: Db,
    private cfg: Config,
  ) {}
  async sendCode(email: string) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.db.$transaction([
      this.db.otpCode.updateMany({ where: { email, usedAt: null, supersededAt: null }, data: { supersededAt: new Date() } }),
      this.db.otpCode.create({ data: { email, codeHash: sha256(`${email}:${code}`), expiresAt: new Date(Date.now() + this.cfg.OTP_TTL_MINUTES * 60_000) } }),
      this.db.emailMessage.create({
        data: { to: email, subject: "Your MS Virtual Academy code", kind: "otp", text: `Your MS Virtual Academy code is ${code}`, html: "", provider: "test", status: "captured" },
      }),
    ]);
    return { ok: true };
  }
  async verifyCode(email: string, code: string) {
    const row = await this.db.otpCode.findFirst({ where: { email, usedAt: null, supersededAt: null }, orderBy: { createdAt: "desc" } });
    if (!row || row.expiresAt < new Date() || row.attempts >= 5) return false;
    if (row.codeHash !== sha256(`${email}:${code.trim()}`)) {
      await this.db.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      return false;
    }
    const used = await this.db.otpCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    return used.count === 1;
  }
}

/**
 * Supabase Auth email OTP over its REST API (the same calls supabase-js makes for signInWithOtp / verifyOtp).
 * The emails come from the templates and SMTP settings of the Supabase project; see docs/SUPABASE_AUTH.md.
 */
export class SupabaseOtpMailer implements OtpMailer {
  readonly mode = "supabase" as const;
  constructor(
    private cfg: Config,
    private fetchFn: typeof fetch = fetch,
  ) {}
  private call(path: string, body: object) {
    return this.fetchFn(`${this.cfg.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/${path}`, {
      method: "POST",
      headers: { apikey: this.cfg.SUPABASE_ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  async sendCode(email: string) {
    try {
      const res = await this.call("otp", { email, create_user: true });
      if (res.ok) return { ok: true };
      return { ok: false, error: res.status === 429 ? "Supabase is rate limiting email sends" : `Supabase responded ${res.status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Supabase request failed" };
    }
  }
  async verifyCode(email: string, code: string) {
    let res: Response;
    try {
      res = await this.call("verify", { type: "email", email, token: code.trim() });
    } catch {
      throw new OtpUnavailableError("Supabase request failed");
    }
    if (res.ok) return true;
    // A 4xx other than rate limiting means the code was wrong, used or expired.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) return false;
    throw new OtpUnavailableError(`Supabase responded ${res.status}`);
  }
}

/* ------------------------------------------------------------ ClueQuest */

export interface QuizLaunchRequest {
  quizId: string;
  /** MSVA's attempt id. ClueQuest pins the quiz and rules per assignmentRef and resumes an unfinished attempt. */
  assignmentRef: string;
  /** Opaque per-attempt student reference. Never contains a name or email. */
  learnerRef: string;
  returnUrl: string;
  passMarkPercent: number;
}
export interface QuizCheck {
  ok: boolean;
  title?: string;
  reason?: string;
}
export interface QuizClient {
  readonly mode: "test" | "live";
  /** Confirms the quiz exists, is published, is shared with learning platforms and can be played solo. */
  checkQuiz(quizId: string): Promise<QuizCheck>;
  createLaunch(req: QuizLaunchRequest): Promise<{ launchUrl: string; expiresAt: Date }>;
}

export class QuizNotConfiguredError extends Error {
  constructor(msg = "ClueQuest is not configured for this environment.") {
    super(msg);
  }
}

/** ClueQuest partner API v1 (see its docs/PARTNER_INTEGRATION.md). The API key stays on the server. */
export class LiveClueQuestClient implements QuizClient {
  readonly mode = "live" as const;
  constructor(
    private cfg: Config,
    private fetchFn: typeof fetch = fetch,
  ) {}
  private request(path: string, init: RequestInit = {}) {
    if (!this.cfg.CLUEQUEST_API_URL || !this.cfg.CLUEQUEST_API_KEY) throw new QuizNotConfiguredError();
    return this.fetchFn(`${this.cfg.CLUEQUEST_API_URL.replace(/\/$/, "")}/api/partner/v1/${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.cfg.CLUEQUEST_API_KEY}`, "content-type": "application/json", accept: "application/json" },
    });
  }
  async checkQuiz(quizId: string): Promise<QuizCheck> {
    const res = await this.request(`quizzes/${encodeURIComponent(quizId)}`);
    if (res.status === 404) {
      return { ok: false, reason: 'ClueQuest cannot find this quiz. Check the ID, and tick "Let connected learning platforms assign this quiz" on its Use page.' };
    }
    if (!res.ok) throw new Error(`ClueQuest responded ${res.status}`);
    const q = (await res.json()) as { title?: string; published?: boolean; activityTypes?: string[] };
    if (!q.published) return { ok: false, reason: "Publish this quiz in ClueQuest first." };
    if (!q.activityTypes?.includes("solo")) return { ok: false, reason: "This quiz cannot be played as an individual assignment." };
    return { ok: true, title: q.title ?? "" };
  }
  async createLaunch(req: QuizLaunchRequest) {
    const res = await this.request("launches", {
      method: "POST",
      body: JSON.stringify({
        quizId: req.quizId,
        assignmentRef: req.assignmentRef,
        learnerRef: req.learnerRef,
        returnUrl: req.returnUrl,
        activity: { type: "solo", style: "points", passMarkPercent: req.passMarkPercent, attemptLimit: 1 },
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { launchUrl?: string; expiresAt?: string };
    if (!res.ok || !json.launchUrl || !json.expiresAt) throw new Error(`ClueQuest launch failed (${res.status})`);
    return { launchUrl: json.launchUrl, expiresAt: new Date(json.expiresAt) };
  }
}

/** Test-only adapter. Launch links point to a local stand-in page; nothing here talks to ClueQuest. */
export class TestQuizClient implements QuizClient {
  readonly mode = "test" as const;
  constructor(private cfg: Config) {}
  async checkQuiz(quizId: string): Promise<QuizCheck> {
    if (quizId.startsWith("00000000")) return { ok: false, reason: "ClueQuest cannot find this quiz." };
    return { ok: true, title: "Test quiz" };
  }
  async createLaunch(req: QuizLaunchRequest) {
    const u = new URL("/api/test/quiz/launch", this.cfg.API_PUBLIC_URL);
    u.searchParams.set("attempt", req.assignmentRef);
    u.searchParams.set("return", req.returnUrl);
    return { launchUrl: u.toString(), expiresAt: new Date(Date.now() + 15 * 60_000) };
  }
}

/* ------------------------------------------------------------- Paystack */

export interface PaystackVerification {
  status: "success" | "failed" | "abandoned" | "pending";
  amountKobo: number;
  currency: string;
  email: string;
  reference: string;
}
export interface PaystackClient {
  initialize(i: {
    email: string;
    amountKobo: number;
    currency: string;
    reference: string;
    callbackUrl: string;
  }): Promise<{ authorizationUrl: string }>;
  verify(reference: string): Promise<PaystackVerification>;
}

export class LivePaystackClient implements PaystackClient {
  constructor(
    private secret: string,
    private fetchFn: typeof fetch = fetch,
  ) {}
  private headers() {
    if (!this.secret) throw new Error("PAYSTACK_SECRET_KEY is not configured");
    return { authorization: `Bearer ${this.secret}`, "content-type": "application/json" };
  }
  async initialize(i: Parameters<PaystackClient["initialize"]>[0]) {
    const res = await this.fetchFn("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ email: i.email, amount: i.amountKobo, currency: i.currency, reference: i.reference, callback_url: i.callbackUrl }),
    });
    const json = (await res.json()) as { status: boolean; data?: { authorization_url: string } };
    if (!res.ok || !json.status || !json.data) throw new Error("Paystack could not start the payment");
    return { authorizationUrl: json.data.authorization_url };
  }
  async verify(reference: string): Promise<PaystackVerification> {
    const res = await this.fetchFn(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: this.headers() });
    const json = (await res.json()) as {
      status: boolean;
      data?: { status: PaystackVerification["status"]; amount: number; currency: string; reference: string; customer?: { email?: string } };
    };
    if (!res.ok || !json.status || !json.data) throw new Error("Paystack could not verify the payment");
    const d = json.data;
    return { status: d.status, amountKobo: d.amount, currency: d.currency, reference: d.reference, email: (d.customer?.email ?? "").toLowerCase() };
  }
}

/** In-memory adapter for automated tests: tests decide what "Paystack" reports. */
export class TestPaystackClient implements PaystackClient {
  results = new Map<string, PaystackVerification>();
  constructor(private cfg: Config) {}
  async initialize(i: Parameters<PaystackClient["initialize"]>[0]) {
    this.results.set(i.reference, { status: "pending", amountKobo: i.amountKobo, currency: i.currency, email: i.email, reference: i.reference });
    return { authorizationUrl: `${this.cfg.API_PUBLIC_URL}/api/test/paystack/pay?reference=${i.reference}` };
  }
  async verify(reference: string) {
    const r = this.results.get(reference);
    if (!r) throw new Error("Unknown reference");
    return r;
  }
}

/* --------------------------------------------------------------- Sheets */

export interface SheetsClient {
  appendRow(tab: string, values: (string | number)[]): Promise<void>;
}

export class TestSheetsClient implements SheetsClient {
  rows: { tab: string; values: (string | number)[] }[] = [];
  failNext = 0;
  async appendRow(tab: string, values: (string | number)[]) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("Sheets unavailable");
    }
    this.rows.push({ tab, values });
  }
}

/** Google Sheets via a service account (JWT bearer flow). Requires a sheet shared with the service account. */
export class GoogleSheetsClient implements SheetsClient {
  private token?: { value: string; exp: number };
  constructor(
    private sheetId: string,
    private credsJson: string,
    private fetchFn: typeof fetch = fetch,
  ) {}
  private async accessToken() {
    if (this.token && this.token.exp > Date.now() + 60_000) return this.token.value;
    const creds = JSON.parse(this.credsJson) as { client_email: string; private_key: string };
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
      iss: creds.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })}`;
    const sig = createSign("RSA-SHA256").update(unsigned).sign(creds.private_key, "base64url");
    const res = await this.fetchFn("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
    });
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!res.ok || !json.access_token) throw new Error("Google token request failed");
    this.token = { value: json.access_token, exp: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }
  async appendRow(tab: string, values: (string | number)[]) {
    const token = await this.accessToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${this.sheetId}/values/${encodeURIComponent(tab)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ values: [values] }),
    });
    if (!res.ok) throw new Error(`Sheets responded ${res.status}`);
  }
}

/* --------------------------------------------------- Certificate renderer */

export interface CertificateData {
  studentName: string;
  studentCode: string;
  trackName: string;
  verificationRef: string;
  issuedOn: Date;
  verifyUrl: string;
}
export interface CertificateRenderer {
  render(d: CertificateData): Promise<Buffer>;
}

export function newReference(prefix: string) {
  return `${prefix}-${randomToken(6).replace(/[-_]/g, "").toUpperCase().slice(0, 10)}`;
}
