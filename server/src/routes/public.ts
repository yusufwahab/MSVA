import { Router } from "express";
import type { Ctx } from "../lib/ctx.js";
import { notFound } from "../lib/http.js";

const KEYS = { communityUrl: "community_url", whatsappUrl: "whatsapp_url", websiteUrl: "website_url" } as const;

/** Configurable links: admin-saved values win over environment defaults. */
export async function getLinks(ctx: Ctx) {
  const rows = await ctx.db.appSetting.findMany({ where: { key: { in: Object.values(KEYS) } } });
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    communityUrl: map.get(KEYS.communityUrl) ?? ctx.config.COMMUNITY_URL,
    whatsappUrl: map.get(KEYS.whatsappUrl) ?? ctx.config.WHATSAPP_URL,
    websiteUrl: map.get(KEYS.websiteUrl) ?? ctx.config.WEBSITE_URL,
  };
}

export async function saveLinks(ctx: Ctx, links: { communityUrl: string; whatsappUrl: string; websiteUrl: string }) {
  for (const [field, key] of Object.entries(KEYS)) {
    const value = links[field as keyof typeof KEYS];
    await ctx.db.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
}

export function publicRouter(ctx: Ctx) {
  const r = Router();

  r.get("/config", async (_req, res) => {
    res.json({ links: await getLinks(ctx), googleEnabled: Boolean(ctx.config.GOOGLE_CLIENT_ID && ctx.config.GOOGLE_CLIENT_SECRET) });
  });

  r.get("/verify/:ref", async (req, res) => {
    const c = await ctx.db.certificate.findUnique({
      where: { verificationRef: String(req.params.ref) },
      include: { user: true, track: true },
    });
    if (!c || c.status !== "ISSUED") throw notFound("Certificate");
    res.json({ valid: true, name: c.user.name, studentCode: c.studentCode, track: c.track.name, issuedAt: c.issuedAt, reference: c.verificationRef });
  });

  return r;
}
