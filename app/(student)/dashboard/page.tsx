"use client";

import Link from "next/link";
import { Alert, Badge, Card, Empty, Eyebrow, Loading, ProgressBar, buttonClass } from "@/components/ui";
import { LaunchButton } from "@/components/LaunchButton";
import { fmtDate } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface Attempt { score: number | null; maxScore: number | null; passed: boolean | null }
interface ClassRow {
  id: string; title: string; moduleTitle: string; modulePosition: number; isFinal: boolean; state: string; actionLabel: string;
  watchedPercent: number; releaseAt: string; best: Attempt | null;
}
interface TrackRow {
  enrolmentId: string; track: { id: string; name: string; isPremium: boolean }; cohort: { name: string }; accessible: boolean;
  passedCount: number; totalCount: number; percent: number; nextSessionAt: string | null; classes: ClassRow[];
  certificate: { eligible: boolean; id: string | null; status: string | null };
}
interface Dash {
  student: { name: string; studentCode: string };
  primary: { kind: "ACTION" | "WAITING" | "DONE" | "NONE"; state?: string; label?: string; classId?: string; classTitle?: string; trackName?: string; message?: string };
  watchThreshold: number;
  links: { communityUrl: string; whatsappUrl: string; websiteUrl: string };
  tracks: TrackRow[];
}

const STATE_TONE: Record<string, "ok" | "warn" | "bad" | "neutral" | "info"> = {
  PASSED: "ok", PENDING: "warn", RETAKE: "bad", NO_RETAKE: "bad", LOCKED: "neutral", QUIZ: "info", RESUME_QUIZ: "info", WATCH: "neutral", RESUME: "neutral",
};
const STATE_TEXT: Record<string, string> = {
  PASSED: "Passed", PENDING: "Result pending", RETAKE: "Retake needed", NO_RETAKE: "Retake unavailable", LOCKED: "Locked", QUIZ: "Quiz ready", RESUME_QUIZ: "Quiz in progress", WATCH: "Not started", RESUME: "In progress",
};

/** Groups a track's classes by module, keeping the module order. */
function byModule(classes: ClassRow[]) {
  const groups: { position: number; title: string; isFinal: boolean; classes: ClassRow[] }[] = [];
  for (const c of classes) {
    let g = groups.find((x) => x.position === c.modulePosition);
    if (!g) {
      g = { position: c.modulePosition, title: c.moduleTitle, isFinal: c.isFinal, classes: [] };
      groups.push(g);
    }
    g.classes.push(c);
  }
  return groups.sort((a, b) => a.position - b.position);
}

function ClassItem({ c }: { c: ClassRow }) {
  const locked = c.state === "LOCKED";
  const started = ["RESUME", "QUIZ", "RESUME_QUIZ"].includes(c.state);
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div className="flex min-w-0 items-start gap-4">
        <span
          aria-hidden="true"
          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${c.state === "PASSED" ? "bg-accent-bright text-on-accent" : "border border-line-strong text-muted"}`}
        >
          {c.state === "PASSED" ? "✓" : locked ? "–" : "•"}
        </span>
        <div className="min-w-0">
          {locked ? (
            <p className="font-semibold">{c.title}</p>
          ) : (
            <Link href={`/classes/${c.id}`} className="font-semibold text-accent-ink underline-offset-4 hover:underline">
              {c.title}
            </Link>
          )}
          <p className="mt-0.5 text-sm text-muted">
            {locked ? "Pass the earlier module to unlock" : `Released ${fmtDate(c.releaseAt, false)}`}
            {c.best?.score != null && <span className="text-ink"> · Score {c.best.score}/{c.best.maxScore}</span>}
          </p>
          {started && c.watchedPercent > 0 && (
            <div className="mt-2 flex max-w-xs items-center gap-3">
              <div className="flex-1">
                <ProgressBar percent={c.watchedPercent} label={`${c.title} watched`} />
              </div>
              <span className="text-xs text-muted">{c.watchedPercent}%</span>
            </div>
          )}
        </div>
      </div>
      <div className="shrink-0 sm:text-right">
        <Badge tone={STATE_TONE[c.state]}>{STATE_TEXT[c.state]}</Badge>
      </div>
    </li>
  );
}

export default function Page() {
  const { data, error, loading } = useLoad<Dash>("/api/student/dashboard");
  if (loading) return <Loading label="Loading your dashboard…" />;
  if (error || !data) return <Alert>{error ?? "Your dashboard could not be loaded."}</Alert>;
  const { primary } = data;
  const quizStates = ["QUIZ", "RESUME_QUIZ", "RETAKE"];
  const first = data.tracks.find((t) => t.accessible) ?? data.tracks[0];

  return (
    <div className="space-y-10">
      <header>
        <Eyebrow>{`Student ID ${data.student.studentCode}`}</Eyebrow>
        <h1 className="mt-1 text-3xl sm:text-5xl">Hello, {data.student.name.split(" ")[0]}</h1>
      </header>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="border-accent/50 bg-accent-soft lg:col-span-2">
          <Eyebrow>What to do next</Eyebrow>
          {primary.kind === "ACTION" && (
            <div className="mt-4 space-y-4">
              <p className="text-2xl font-extrabold leading-tight sm:text-4xl" data-testid="next-class">{primary.classTitle}</p>
              <p className="text-muted">{primary.trackName}</p>
              {primary.state && quizStates.includes(primary.state) ? (
                <LaunchButton classId={primary.classId!} label={primary.label!} />
              ) : primary.state === "PENDING" ? (
                <div className="space-y-3">
                  <Alert tone="warn">Result pending. Your quiz result has not reached us yet. This page updates when it arrives.</Alert>
                  <Link href={`/classes/${primary.classId}`} className={buttonClass("secondary")}>Open class</Link>
                </div>
              ) : primary.state === "NO_RETAKE" ? (
                <Alert tone="warn">You have used all your attempts for this quiz. Please contact your tutor.</Alert>
              ) : (
                <Link href={`/classes/${primary.classId}`} className={buttonClass("primary", "px-8")}>{primary.label}</Link>
              )}
            </div>
          )}
          {primary.kind !== "ACTION" && (
            <div className="mt-4 space-y-2">
              <h2 className="text-2xl sm:text-3xl">{primary.kind === "DONE" ? "You are up to date" : "No class is open right now"}</h2>
              {primary.trackName && <p className="text-muted">Assigned track: <strong className="text-ink">{primary.trackName}</strong></p>}
              <p className="text-muted">{primary.message}</p>
              {data.tracks[0]?.nextSessionAt && <p data-testid="next-session">Next session: <strong>{fmtDate(data.tracks[0].nextSessionAt)}</strong></p>}
            </div>
          )}
        </Card>

        {first && first.accessible && (
          <Card>
            <Eyebrow>Your progress</Eyebrow>
            <p className="mt-3 text-5xl font-extrabold tracking-tight">{first.percent}<span className="text-2xl text-muted">%</span></p>
            <p className="mt-1 text-sm font-semibold">{first.passedCount} of {first.totalCount} classes passed</p>
            <div className="mt-4"><ProgressBar percent={first.percent} label="Overall progress" /></div>
            <p className="mt-4 text-sm text-muted">{first.track.name} · {first.cohort.name}</p>
            {first.nextSessionAt && <p className="mt-1 text-sm text-muted">Next session: {fmtDate(first.nextSessionAt)}</p>}
          </Card>
        )}
      </div>

      {data.tracks.length === 0 && <Empty title="No active enrolment">The academy has not assigned you to a track yet.</Empty>}

      {data.tracks.map((t) => (
        <section key={t.enrolmentId} aria-labelledby={`t-${t.enrolmentId}`} className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id={`t-${t.enrolmentId}`} className="text-2xl sm:text-3xl">{t.track.name}</h2>
              <p className="text-muted">{t.cohort.name}</p>
            </div>
            {t.accessible && <p className="text-sm font-semibold">Progress: {t.passedCount} of {t.totalCount} classes passed ({t.percent}%)</p>}
          </div>
          {!t.accessible ? (
            <Alert tone="info">This is a premium course. <Link className="font-semibold underline" href="/courses">Purchase access</Link> to unlock its classes.</Alert>
          ) : (
            <>
              {t.certificate.eligible && (
                <Alert tone="success" title="You have completed this track.">
                  <Link href="/progress" className="font-semibold underline">Download your certificate</Link>
                </Alert>
              )}
              {t.classes.length === 0 ? (
                <Empty title="No classes released yet">{t.nextSessionAt ? `Your next session is ${fmtDate(t.nextSessionAt)}.` : "Your tutor has not announced the next session yet."}</Empty>
              ) : (
                <div className="space-y-6">
                  {byModule(t.classes).map((g) => (
                    <div key={g.position}>
                      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
                        Module {g.position}: {g.title}{g.isFinal ? " (final assessment)" : ""}
                      </h3>
                      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
                        {g.classes.map((c) => <ClassItem key={c.id} c={c} />)}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
              {t.nextSessionAt && t.classes.length > 0 && <p className="text-sm text-muted">Next session: {fmtDate(t.nextSessionAt)}</p>}
            </>
          )}
        </section>
      ))}

      {(data.links.communityUrl || data.links.whatsappUrl) && (
        <Card>
          <h2 className="text-xl">Need help or company?</h2>
          <ul className="mt-2 flex flex-wrap gap-x-6">
            {data.links.communityUrl && <li><a className="inline-block min-h-11 py-2.5 font-semibold text-accent-ink underline underline-offset-4" href={data.links.communityUrl} target="_blank" rel="noopener noreferrer">Academy community</a></li>}
            {data.links.whatsappUrl && <li><a className="inline-block min-h-11 py-2.5 font-semibold text-accent-ink underline underline-offset-4" href={data.links.whatsappUrl} target="_blank" rel="noopener noreferrer">WhatsApp support</a></li>}
          </ul>
        </Card>
      )}
    </div>
  );
}
