import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { Ctx } from "../lib/ctx.js";
import { HttpError } from "../lib/http.js";
import { newReference, type CertificateData, type CertificateKind, type CertificateRenderer } from "./adapters.js";

const ASSETS = fileURLToPath(new URL("../../assets/certificates/", import.meta.url));

type Font = "Times-Roman" | "Times-Bold" | "Helvetica" | "Helvetica-Bold";

/** Draws one line centred on `cx`, shrinking the font until it fits `maxWidth`. `top` is the top of the text. */
function fitted(doc: PDFKit.PDFDocument, text: string, font: Font, max: number, min: number, maxWidth: number, cx: number, top: number, color: string) {
  let size = max;
  doc.font(font);
  while (size > min && doc.fontSize(size).widthOfString(text) > maxWidth) size -= 0.5;
  doc.fillColor(color).fontSize(size).text(text, cx - maxWidth / 2, top, { width: maxWidth, align: "center", lineBreak: false });
}

/** Draws the verification QR as vector squares, so it stays sharp at any zoom or print size. */
function drawQr(doc: PDFKit.PDFDocument, url: string, x: number, y: number, size: number) {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const cell = size / n;
  doc.fillColor("#111111");
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.data[r * n + c]) doc.rect(x + c * cell, y + r * cell, cell + 0.15, cell + 0.15).fill();
    }
  }
}

const longDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const numericDate = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

/**
 * Prints a student's details onto the academy's certificate artwork (server/assets/certificates).
 * Everything that never changes (logos, signatures, seal, wording) is part of the artwork.
 */
export class PdfKitRenderer implements CertificateRenderer {
  render(d: CertificateData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const completion = d.kind === "COMPLETION";
      // Page sizes follow the artwork: 842 x 600 pt for participation, and the completion image's own proportions.
      const W = 842;
      const H = completion ? Math.round((W * 1298) / 1680) : 600;
      const title = completion ? "Certificate of Completion" : "Certificate of Participation";
      const doc = new PDFDocument({ size: [W, H], margin: 0, info: { Title: `${title} - ${d.studentName}`, Author: "MS Virtual Academy" } });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      try {
        doc.image(`${ASSETS}${completion ? "completion" : "participation"}.jpg`, 0, 0, { width: W, height: H });
        if (completion) {
          // Coordinates below are in pixels of the 1680 x 1298 artwork.
          const k = W / 1680;
          fitted(doc, d.studentName, "Times-Bold", 92 * k, 30, 1150 * k, W / 2, 505 * k - 46 * k, "#1b1a14");
          fitted(doc, d.trackName, "Helvetica-Bold", 50 * k, 20, 1200 * k, W / 2, 740 * k - 25 * k, "#2a2616");
          // Cover the sample QR printed on the artwork, then draw this certificate's own.
          doc.rect(778 * k, 1104 * k, 152 * k, 150 * k).fill("#ffffff");
          drawQr(doc, d.verifyUrl, 792 * k, 1116 * k, 126 * k);
          doc.font("Helvetica-Bold").fontSize(22 * k).fillColor("#1b1a14");
          doc.text(d.verificationRef, 600 * k, 1267 * k - 11 * k, { lineBreak: false });
          doc.text(`DATE ISSUED: ${numericDate(d.issuedOn)}`, 1300 * k - 360 * k, 1267 * k - 11 * k, { width: 360 * k, align: "right", lineBreak: false });
        } else {
          fitted(doc, d.studentName, "Times-Roman", 38, 18, 520, W / 2, 250, "#121212");
          fitted(doc, "for participating in", "Helvetica", 11, 11, 520, W / 2, 301, "#444444");
          fitted(doc, d.trackName, "Helvetica-Bold", 17, 10, 520, W / 2, 318, "#946b08");
          drawQr(doc, d.verifyUrl, 326, 540, 44);
          doc.font("Helvetica").fontSize(7.5).fillColor("#444444");
          doc.text(`Certificate ID: ${d.verificationRef}`, 380, 546, { lineBreak: false });
          doc.text(`Issued: ${longDate(d.issuedOn)}`, 380, 557, { lineBreak: false });
          doc.text("Scan to verify", 380, 568, { lineBreak: false });
        }
        doc.end();
      } catch (e) {
        reject(e);
      }
    });
  }
}

/**
 * Runs the academy's Python certificate script. Contract assumed by MSVA (to be confirmed with the
 * script's owner): the script reads one JSON object from stdin and writes the PDF bytes to stdout.
 * The JSON includes `kind` ("PARTICIPATION" or "COMPLETION").
 */
export class PythonScriptRenderer implements CertificateRenderer {
  constructor(
    private script: string,
    private python: string,
  ) {}
  render(d: CertificateData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const p = spawn(this.python, [this.script], { stdio: ["pipe", "pipe", "pipe"] });
      const out: Buffer[] = [];
      let err = "";
      p.stdout.on("data", (c: Buffer) => out.push(c));
      p.stderr.on("data", (c: Buffer) => (err += c.toString()));
      p.on("error", reject);
      p.on("close", (code) => {
        const buf = Buffer.concat(out);
        if (code === 0 && buf.subarray(0, 4).toString() === "%PDF") resolve(buf);
        else reject(new Error(`Certificate script failed (exit ${code}): ${err.slice(0, 200)}`));
      });
      p.stdin.end(JSON.stringify({ ...d, issuedOn: d.issuedOn.toISOString() }));
    });
  }
}

/**
 * Eligibility is recorded first (CertificateEligibility), and a student can download only after an admin unlocks it.
 * Unlocking issues the PDF. Issuance is a separate, retryable step: a failed PDF leaves a FAILED Certificate row
 * that can be retried without re-checking results.
 *
 * Completion eligibility is recorded here once every class is passed. Participation eligibility is recorded when a
 * payment succeeds (see services/payments.ts).
 */
export async function ensureEligibility(ctx: Ctx, userId: string, trackId: string) {
  const { db } = ctx;
  const { isTrackComplete } = await import("./progress.js");
  if (!(await isTrackComplete(db, userId, trackId))) return null;
  return db.certificateEligibility.upsert({
    where: { userId_trackId_kind: { userId, trackId, kind: "COMPLETION" } },
    update: {},
    create: { userId, trackId, kind: "COMPLETION" },
  });
}

/** Admin unlock: lets the student download, and issues the PDF straight away. A failed PDF can be retried. */
export async function unlockCertificate(ctx: Ctx, adminId: string, userId: string, trackId: string, kind: CertificateKind) {
  const { db } = ctx;
  const elig = await db.certificateEligibility.findUnique({ where: { userId_trackId_kind: { userId, trackId, kind } } });
  if (!elig) throw new HttpError(404, "NOT_ELIGIBLE", "This student is not eligible for that certificate.");
  if (!elig.unlockedAt) {
    await db.certificateEligibility.update({ where: { id: elig.id }, data: { unlockedAt: new Date(), unlockedById: adminId } });
  }
  try {
    const cert = await issueCertificate(ctx, userId, trackId, kind);
    return { status: cert.status };
  } catch {
    return { status: "FAILED" as const };
  }
}

/** Takes a certificate back: the student can no longer download it and it no longer verifies. */
export async function lockCertificate(ctx: Ctx, userId: string, trackId: string, kind: CertificateKind) {
  const r = await ctx.db.certificateEligibility.updateMany({ where: { userId, trackId, kind }, data: { unlockedAt: null, unlockedById: null } });
  if (r.count === 0) throw new HttpError(404, "NOT_ELIGIBLE", "This student is not eligible for that certificate.");
}

/** What a student sees for one certificate. */
export function studentCertificateState(elig: { unlockedAt: Date | null }, cert: { id: string; status: string } | undefined) {
  if (!elig.unlockedAt) return { state: "AWAITING_APPROVAL" as const, id: null };
  if (cert?.status === "ISSUED") return { state: "READY" as const, id: cert.id };
  return { state: "PREPARING" as const, id: null };
}

export async function issueCertificate(ctx: Ctx, userId: string, trackId: string, kind: CertificateKind) {
  const { db, config, certificates } = ctx;
  const elig = await db.certificateEligibility.findUnique({ where: { userId_trackId_kind: { userId, trackId, kind } } });
  if (!elig) throw new HttpError(403, "NOT_ELIGIBLE", "Student is not eligible for this certificate");
  if (!elig.unlockedAt) throw new HttpError(403, "NOT_UNLOCKED", "This certificate has not been unlocked by an admin yet.");
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const track = await db.track.findUniqueOrThrow({ where: { id: trackId } });

  const key = { userId_trackId_kind: { userId, trackId, kind } };
  let cert = await db.certificate.findUnique({ where: key });
  if (cert?.status === "ISSUED") return cert;
  if (!cert) {
    try {
      cert = await db.certificate.create({
        data: { userId, trackId, kind, studentCode: user.studentCode ?? "", verificationRef: newReference("MSVA-CERT") },
      });
    } catch {
      cert = await db.certificate.findUniqueOrThrow({ where: key });
      if (cert.status === "ISSUED") return cert;
    }
  }
  try {
    const pdf = await certificates.render({
      kind,
      studentName: user.name,
      studentCode: user.studentCode ?? "",
      trackName: track.name,
      verificationRef: cert.verificationRef,
      issuedOn: new Date(),
      verifyUrl: `${config.APP_URL}/verify/${cert.verificationRef}`,
    });
    return await db.certificate.update({
      where: { id: cert.id },
      data: { status: "ISSUED", pdf: new Uint8Array(pdf), issuedAt: new Date(), attempts: { increment: 1 }, lastError: null },
    });
  } catch (e) {
    await db.certificate.update({
      where: { id: cert.id },
      data: { status: "FAILED", attempts: { increment: 1 }, lastError: e instanceof Error ? e.message.slice(0, 300) : "Unknown error" },
    });
    throw e;
  }
}
