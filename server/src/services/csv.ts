import { parse as parseCsv } from "csv-parse/sync";
import type { Ctx } from "../lib/ctx.js";
import { HttpError, emailSchema } from "../lib/http.js";

export type RowStatus = "new_student" | "new_enrolment" | "already_enrolled" | "duplicate_in_file" | "invalid";

export interface PreviewRow {
  line: number;
  name: string;
  email: string;
  track: string;
  cohort: string;
  status: RowStatus;
  reason?: string;
  trackId?: string;
  cohortId?: string;
}

export const MAX_IMPORT_ROWS = 2000;

/** Classifies every row against current data. Used for both preview and commit so the two cannot disagree. */
export async function classifyCsv(ctx: Ctx, csv: string, defaults: { trackId?: string; cohortId?: string }) {
  let records: Record<string, string>[];
  try {
    records = parseCsv(csv, {
      columns: (h: string[]) => h.map((x) => x.trim().toLowerCase()),
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    });
  } catch {
    throw new HttpError(400, "BAD_CSV", "The file could not be read as CSV. Use the columns name, email, track, cohort.");
  }
  if (records.length === 0) throw new HttpError(400, "EMPTY_CSV", "The file has no rows.");
  if (records.length > MAX_IMPORT_ROWS) throw new HttpError(400, "CSV_TOO_LARGE", `Import at most ${MAX_IMPORT_ROWS} rows at a time.`);

  const tracks = await ctx.db.track.findMany({ where: { archived: false }, include: { cohorts: true } });
  const defTrack = defaults.trackId ? tracks.find((t) => t.id === defaults.trackId) : undefined;
  const defCohort = defaults.cohortId ? defTrack?.cohorts.find((c) => c.id === defaults.cohortId) : undefined;
  const seen = new Set<string>();
  const rows: PreviewRow[] = [];

  for (const [i, rec] of records.entries()) {
    const row: PreviewRow = {
      line: i + 2,
      name: (rec.name ?? "").trim(),
      email: (rec.email ?? "").trim().toLowerCase(),
      track: (rec.track ?? "").trim(),
      cohort: (rec.cohort ?? "").trim(),
      status: "invalid",
    };
    const fail = (reason: string) => rows.push({ ...row, status: "invalid", reason });

    if (!row.name) { fail("Name is missing"); continue; }
    if (!emailSchema.safeParse(row.email).success) { fail("Email is not valid"); continue; }

    const track = row.track ? tracks.find((t) => t.name.toLowerCase() === row.track.toLowerCase()) : defTrack;
    if (!track) { fail(row.track ? `Track "${row.track}" does not exist` : "Track is missing"); continue; }
    const cohort = row.cohort ? track.cohorts.find((c) => c.name.toLowerCase() === row.cohort.toLowerCase()) : defCohort?.trackId === track.id ? defCohort : undefined;
    if (!cohort) { fail(row.cohort ? `Cohort "${row.cohort}" does not exist in ${track.name}` : "Cohort is missing"); continue; }
    row.track = track.name;
    row.cohort = cohort.name;

    const key = `${row.email}|${track.id}`;
    if (seen.has(key)) { rows.push({ ...row, status: "duplicate_in_file", reason: "Appears earlier in this file" }); continue; }
    seen.add(key);

    const user = await ctx.db.user.findUnique({ where: { email: row.email }, include: { enrolments: true } });
    if (user && user.role !== "STUDENT") { fail("This email belongs to a staff account"); continue; }
    const base = { ...row, trackId: track.id, cohortId: cohort.id };
    if (!user) rows.push({ ...base, status: "new_student" });
    else if (user.enrolments.some((e) => e.trackId === track.id)) rows.push({ ...base, status: "already_enrolled", reason: "Already enrolled in this track" });
    else rows.push({ ...base, status: "new_enrolment", reason: "Existing student, new track" });
  }

  const counts = rows.reduce<Record<RowStatus, number>>(
    (a, r) => ({ ...a, [r.status]: a[r.status] + 1 }),
    { new_student: 0, new_enrolment: 0, already_enrolled: 0, duplicate_in_file: 0, invalid: 0 },
  );
  return { rows, counts };
}
