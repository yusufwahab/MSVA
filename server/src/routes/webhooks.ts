import { Router } from "express";
import type { Ctx } from "../lib/ctx.js";
import { HttpError } from "../lib/http.js";
import { QUIZ_SIGNATURE_HEADER, QUIZ_TIMESTAMP_HEADER, processQuizResult } from "../services/quiz.js";
import { processPaystackWebhook } from "../services/payments.js";

/** Mounted with express.raw so the exact bytes can be verified against the signature. */
export function webhookRouter(ctx: Ctx) {
  const r = Router();

  r.post("/cluequest/result", async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, "BAD_REQUEST", "Expected a JSON body");
    const outcome = await processQuizResult(ctx, req.body, req.get(QUIZ_SIGNATURE_HEADER), req.get(QUIZ_TIMESTAMP_HEADER));
    // Duplicates and already-resolved attempts still return 200 so ClueQuest stops retrying.
    res.json({ ok: true, outcome });
  });

  r.post("/paystack", async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(400, "BAD_REQUEST", "Expected a JSON body");
    res.json(await processPaystackWebhook(ctx, req.body, req.get("x-paystack-signature")));
  });

  return r;
}
