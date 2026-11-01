import { spawn } from "node:child_process";
import PDFDocument from "pdfkit";
import type { Ctx } from "../lib/ctx.js";
import { newReference, type CertificateData, type CertificateRenderer } from "./adapters.js";

export class PdfKitRenderer implements CertificateRenderer {
  render(d: CertificateData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 60 });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      const w = doc.page.width;
      doc.rect(30, 30, w - 60, doc.page.height - 60).lineWidth(2).stroke("#1d2b53");
      doc.fillColor("#1d2b53").font("Times-Bold").fontSize(34).text("MS Virtual Academy", 0, 100, { align: "center" });
      doc.font("Times-Roman").fontSize(16).fillColor("#333").text("Certificate of Completion", { align: "center" });
      doc.moveDown(2).fontSize(14).text("This certifies that", { align: "center" });
      doc.moveDown(0.5).font("Times-Bold").fontSize(30).fillColor("#111").text(d.studentName, { align: "center" });
      doc.moveDown(0.5).font("Times-Roman").fontSize(14).fillColor("#333").text("has completed all required sessions, quizzes and the final assessment of", { align: "center" });
      doc.moveDown(0.5).font("Times-Bold").fontSize(22).fillColor("#1d2b53").text(d.trackName, { align: "center" });
      doc.moveDown(2).font("Times-Roman").fontSize(11).fillColor("#333");
      doc.text(`Student ID: ${d.studentCode}`, { align: "center" });
      doc.text(`Issued: ${d.issuedOn.toISOString().slice(0, 10)}`, { align: "center" });
      doc.text(`Verification reference: ${d.verificationRef}`, { align: "center" });
      doc.text(`Verify at ${d.verifyUrl}`, { align: "center" });
      doc.end();
    });
  }
}

/**
 * Runs the academy's Python certificate script. Contract assumed by MSVA (to be confirmed with the
 * script's owner): the script reads one JSON object from stdin and writes the PDF bytes to stdout.
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
 * Eligibility is recorded first (CertificateEligibility). Issuance is a separate, retryable step:
 * a failed PDF leaves a FAILED Certificate row that can be retried without re-checking results.
 */
export async function ensureEligibility(ctx: Ctx, userId: string, trackId: string) {
  const { db } = ctx;
  const { isTrackComplete } = await import("./progress.js");
  if (!(await isTrackComplete(db, userId, trackId))) return null;
  const elig = await db.certificateEligibility.upsert({
    where: { userId_trackId: { userId, trackId } },
    update: {},
    create: { userId, trackId },
  });
  await issueCertificate(ctx, userId, trackId).catch(() => undefined);
  return elig;
}

export async function issueCertificate(ctx: Ctx, userId: string, trackId: string) {
  const { db, config, certificates } = ctx;
  const elig = await db.certificateEligibility.findUnique({ where: { userId_trackId: { userId, trackId } } });
  if (!elig) throw new Error("Student is not eligible for a certificate");
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const track = await db.track.findUniqueOrThrow({ where: { id: trackId } });

  let cert = await db.certificate.findUnique({ where: { userId_trackId: { userId, trackId } } });
  if (cert?.status === "ISSUED") return cert;
  if (!cert) {
    try {
      cert = await db.certificate.create({
        data: { userId, trackId, studentCode: user.studentCode ?? "", verificationRef: newReference("MSVA-CERT") },
      });
    } catch {
      cert = await db.certificate.findUniqueOrThrow({ where: { userId_trackId: { userId, trackId } } });
      if (cert.status === "ISSUED") return cert;
    }
  }
  try {
    const pdf = await certificates.render({
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
