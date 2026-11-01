import type { Ctx } from "../lib/ctx.js";
import { HttpError, notFound } from "../lib/http.js";
import { hmacHex, safeEqualHex } from "../lib/security.js";
import { newReference } from "./adapters.js";

export async function startCheckout(ctx: Ctx, userId: string, trackId: string) {
  const { db, config } = ctx;
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const track = await db.track.findUnique({ where: { id: trackId } });
  if (!track || track.archived || !track.isPremium || !track.priceKobo) throw notFound("Course");
  const enrolled = await db.enrolment.count({ where: { userId, status: "ACTIVE" } });
  if (!enrolled) throw new HttpError(403, "NOT_ENROLLED", "Only enrolled students can purchase course access.");
  if (await db.entitlement.findUnique({ where: { userId_trackId: { userId, trackId } } })) {
    throw new HttpError(409, "ALREADY_OWNED", "You already have access to this course.");
  }
  const reference = newReference("MSVA-PAY");
  await db.payment.create({
    data: { userId, trackId, reference, amountKobo: track.priceKobo, currency: track.currency },
  });
  const { authorizationUrl } = await ctx.paystack.initialize({
    email: user.email,
    amountKobo: track.priceKobo,
    currency: track.currency,
    reference,
    callbackUrl: `${config.APP_URL}/payments/callback`,
  });
  return { reference, authorizationUrl };
}

/**
 * Confirms a payment with Paystack (never trusting a redirect or webhook body) and grants access
 * only when status, amount, currency, reference and customer email all match our own record.
 * Safe to call repeatedly: a payment can be marked successful, and an entitlement created, only once.
 */
export async function verifyAndGrant(ctx: Ctx, reference: string) {
  const { db } = ctx;
  const payment = await db.payment.findUnique({ where: { reference }, include: { user: true } });
  if (!payment) throw notFound("Payment");
  if (payment.status === "SUCCESS") return { status: "SUCCESS" as const, trackId: payment.trackId };

  const v = await ctx.paystack.verify(reference);
  if (v.status !== "success") {
    if (v.status === "failed" || v.status === "abandoned") {
      await db.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED", failureNote: `Paystack status: ${v.status}` } });
      return { status: "FAILED" as const, trackId: payment.trackId };
    }
    return { status: "PENDING" as const, trackId: payment.trackId };
  }
  const mismatch =
    v.reference !== payment.reference ||
    v.amountKobo !== payment.amountKobo ||
    v.currency !== payment.currency ||
    v.email !== payment.user.email;
  if (mismatch) {
    await db.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED", failureNote: "Verification mismatch (amount, currency or customer)" } });
    return { status: "FAILED" as const, trackId: payment.trackId };
  }

  await db.$transaction(async (tx) => {
    const flipped = await tx.payment.updateMany({ where: { id: payment.id, status: { not: "SUCCESS" } }, data: { status: "SUCCESS", paidAt: new Date(), failureNote: null } });
    if (flipped.count === 0) return; // another request already granted access
    await tx.entitlement.upsert({
      where: { userId_trackId: { userId: payment.userId, trackId: payment.trackId } },
      update: {},
      create: { userId: payment.userId, trackId: payment.trackId, paymentId: payment.id },
    });
    const hasEnrolment = await tx.enrolment.findUnique({ where: { userId_trackId: { userId: payment.userId, trackId: payment.trackId } } });
    if (!hasEnrolment) {
      const cohort = await tx.cohort.findFirst({ where: { trackId: payment.trackId }, orderBy: { createdAt: "asc" } });
      if (cohort) await tx.enrolment.create({ data: { userId: payment.userId, trackId: payment.trackId, cohortId: cohort.id, status: "ACTIVE" } });
    }
  });
  return { status: "SUCCESS" as const, trackId: payment.trackId };
}

export async function processPaystackWebhook(ctx: Ctx, raw: Buffer, signature: string | undefined) {
  const secret = ctx.config.PAYSTACK_SECRET_KEY;
  if (!secret) throw new HttpError(503, "PAYSTACK_NOT_CONFIGURED", "Paystack is not configured");
  if (!signature || !safeEqualHex(hmacHex("sha512", secret, raw), signature)) throw new HttpError(401, "BAD_SIGNATURE", "Invalid signature");
  let evt: { event?: string; data?: { reference?: string } };
  try {
    evt = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new HttpError(400, "BAD_REQUEST", "Body must be JSON");
  }
  if (evt.event === "charge.success" && evt.data?.reference) {
    const exists = await ctx.db.payment.findUnique({ where: { reference: evt.data.reference } });
    if (exists) await verifyAndGrant(ctx, evt.data.reference);
  }
  return { received: true };
}
