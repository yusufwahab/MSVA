import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { Ctx } from "../lib/ctx.js";
import { HttpError } from "../lib/http.js";
import { sha256 } from "../lib/security.js";

export const SESSION_COOKIE = "msva_session";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "TUTOR" | "STUDENT";
  studentCode: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Resolves the session on every request and re-reads the user's status from the database,
 * so deactivating an account revokes access immediately, even for an existing session.
 */
export function authenticate(ctx: Ctx): RequestHandler {
  return async (req, _res, next) => {
    try {
      const raw = req.cookies?.[SESSION_COOKIE] as string | undefined;
      if (raw) {
        const s = await ctx.db.session.findUnique({ where: { tokenHash: sha256(raw) }, include: { user: true } });
        if (s && s.expiresAt > new Date() && s.user.status === "ACTIVE") {
          const u = s.user;
          req.user = { id: u.id, email: u.email, name: u.name, role: u.role, studentCode: u.studentCode };
        } else if (s && (s.expiresAt <= new Date() || s.user.status === "DEACTIVATED")) {
          await ctx.db.session.delete({ where: { id: s.id } }).catch(() => undefined);
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, "UNAUTHENTICATED", "Please sign in to continue."));
  next();
};

export const requireRole =
  (...roles: AuthUser["role"][]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, "UNAUTHENTICATED", "Please sign in to continue."));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, "FORBIDDEN", "You do not have access to this area."));
    next();
  };

/** Rejects cross-site browser writes. Non-browser clients send no Origin header. */
export function originCheck(ctx: Ctx): RequestHandler {
  const allowed = new Set([new URL(ctx.config.APP_URL).origin, new URL(ctx.config.API_PUBLIC_URL).origin]);
  return (req: Request, _res: Response, next: NextFunction) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.get("origin");
    if (origin && !allowed.has(origin)) return next(new HttpError(403, "BAD_ORIGIN", "Cross-site request blocked."));
    next();
  };
}
