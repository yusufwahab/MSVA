"use client";

import Link from "next/link";
import { Alert, Badge, Card, Empty, Loading, PageHeader, ProgressBar, buttonClass } from "@/components/ui";
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

export default function Page() {
  const { data, error, loading } = useLoad<Dash>("/api/student/dashboard");
  if (loading) return <Loading label="Loading your dashboard…" />;
  if (error || !data) return <Alert>{error ?? "Your dashboard could not be loaded."}</Alert>;
  const { primary } = data;
  const quizStates = ["QUIZ", "RESUME_QUIZ", "RETAKE"];

  return (
    <div className="space-y-8">
      <PageHeader title={`Hello, ${data.student.name.split(" ")[0]}`} lead={`Student ID ${data.student.studentCode}`} />

      <Card className="border-2 border-navy">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-clay">What to do next</h2>
        {primary.kind === "ACTION" && (
          <div className="mt-3 space-y-4">
            <p className="font-serif text-2xl sm:text-3xl" data-testid="next-class">{primary.classTitle}</p>
            <p className="text-muted">{primary.trackName}</p>
            {primary.state && quizStates.includes(primary.state) ? (
              <LaunchButton classId={primary.classId!} label={primary.label!} />
            ) : primary.state === "PENDING" ? (
              <div className="space-y-3">
                <Alert tone="warn">Result pending. Your quiz result has not reached us yet. This page updates when it arrives.</Alert>
                <Link href={`/classes/${primary.classId}`} className={buttonClass("secondary")}>Open class</Link>
              </div>
            ) : primary.state === "NO_RETAKE" ? (
              <Alert tone="warn">A retake is not available for this quiz. Please contact your tutor.</Alert>
            ) : (
              <Link href={`/classes/${primary.classId}`} className={buttonClass("primary")}>{primary.label}</Link>
            )}
          </div>
        )}
        {primary.kind !== "ACTION" && (
          <div className="mt-3 space-y-2">
            <h3 className="text-2xl">{primary.kind === "DONE" ? "You are up to date" : "No class is open right now"}</h3>
            {primary.trackName && <p className="text-muted">Assigned track: <strong>{primary.trackName}</strong></p>}
            <p className="text-muted">{primary.message}</p>
            {data.tracks[0]?.nextSessionAt && <p data-testid="next-session">Next session: <strong>{fmtDate(data.tracks[0].nextSessionAt)}</strong></p>}
          </div>
        )}
      </Card>

      {data.tracks.length === 0 && <Empty title="No active enrolment">The academy has not assigned you to a track yet.</Empty>}

      {data.tracks.map((t) => (
        <section key={t.enrolmentId} aria-labelledby={`t-${t.enrolmentId}`} className="space-y-4">
          <div>
            <h2 id={`t-${t.enrolmentId}`} className="text-2xl sm:text-3xl">{t.track.name}</h2>
            <p className="text-muted">{t.cohort.name}</p>
          </div>
          {!t.accessible ? (
            <Alert tone="info">This is a premium course. <Link className="font-semibold underline" href="/courses">Purchase access</Link> to unlock its classes.</Alert>
          ) : (
            <>
              <div className="space-y-2">
                <p className="text-sm font-semibold">Progress: {t.passedCount} of {t.totalCount} classes passed ({t.percent}%)</p>
                <ProgressBar percent={t.percent} label={`${t.track.name} progress`} />
              </div>
              {t.certificate.eligible && (
                <Alert tone="success" title="You have completed this track.">
                  <Link href="/progress" className="font-semibold underline">Download your certificate</Link>
                </Alert>
              )}
              {t.classes.length === 0 ? (
                <Empty title="No classes released yet">{t.nextSessionAt ? `Your next session is ${fmtDate(t.nextSessionAt)}.` : "Your tutor has not announced the next session yet."}</Empty>
              ) : (
                <ul className="divide-y divide-line border border-line bg-card">
                  {t.classes.map((c) => (
                    <li key={c.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm text-muted">Module {c.modulePosition}: {c.moduleTitle}{c.isFinal ? " (final assessment)" : ""}</p>
                        {c.state === "LOCKED" ? <p className="font-semibold">{c.title}</p> : <Link href={`/classes/${c.id}`} className="font-semibold text-navy underline underline-offset-4">{c.title}</Link>}
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm"><Badge tone={STATE_TONE[c.state]}>{STATE_TEXT[c.state]}</Badge>
                          {c.best?.score != null && <span>Score {c.best.score}/{c.best.maxScore}</span>}
                          {c.state === "LOCKED" && <span className="text-muted">Pass the earlier module to unlock</span>}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
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
            {data.links.communityUrl && <li><a className="inline-block min-h-11 py-2.5 font-semibold text-navy underline underline-offset-4" href={data.links.communityUrl} target="_blank" rel="noopener noreferrer">Academy community</a></li>}
            {data.links.whatsappUrl && <li><a className="inline-block min-h-11 py-2.5 font-semibold text-navy underline underline-offset-4" href={data.links.whatsappUrl} target="_blank" rel="noopener noreferrer">WhatsApp support</a></li>}
          </ul>
        </Card>
      )}
    </div>
  );
}
