import type { Request } from "express";
import { z, type ZodType } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new HttpError(404, "NOT_FOUND", `${what} not found`);
export const forbidden = (msg = "You do not have access to this") => new HttpError(403, "FORBIDDEN", msg);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, "BAD_REQUEST", msg, details);

export function parse<T extends ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const i of r.error.issues) fields[i.path.join(".") || "_"] ??= i.message;
    throw new HttpError(400, "VALIDATION", "Please check the highlighted fields.", fields);
  }
  return r.data;
}

export const body = <T extends ZodType>(req: Request, schema: T) => parse(schema, req.body ?? {});

export const normaliseEmail = (e: string) => e.trim().toLowerCase();

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(254);

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200, "Password is too long");
