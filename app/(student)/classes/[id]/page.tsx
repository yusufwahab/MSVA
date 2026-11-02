"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef } from "react";
import { LaunchButton } from "@/components/LaunchButton";
import { VideoPlayer } from "@/components/VideoPlayer";
import { Alert, Badge, Card, Eyebrow, Loading, ProgressBar, Table, Td, buttonClass } from "@/components/ui";
import { api, fmtDate } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface Attempt { id: string; attemptNo: number; status: string; score: number | null; maxScore: number | null; passMark: number | null; passed: boolean | null; resultAt: string | null }
interface Detail {
  class: { id: string; title: string; description: string; youtubeId: string; moduleTitle: string; trackName: string; hasQuiz: boolean; multiplayerUrl: string | null };
  state: string; actionLabel: string; watchedPercent: number; positionSeconds: number; watchThreshold: number; quizEligible: boolean;
  attempts: Attempt[]; best: Attempt | null; next: { id: string; title: string } | null;
}
interface Outline {
  tracks: { track: { name: string }; accessible: boolean; classes: { id: string; title: string; moduleTitle: string; modulePosition: number; state: string }[] }[];
}

const DOT: Record<string, string> = { PASSED: "✓", LOCKED: "–", PENDING: "…" };

/** The track's classes beside the video, so a student always sees where this class sits. */
function Curriculum({ trackName, currentId }: { trackName: string; currentId: string }) {
  const { data } = useLoad<Outline>("/api/student/dashboard");
  const track = data?.tracks.find((t) => t.track.name === trackName && t.accessible);
  if (!track || track.classes.length === 0) return null;
  const modules: { position: number; title: string; classes: typeof track.classes }[] = [];
  for (const c of track.classes) {
    let m = modules.find((x) => x.position === c.modulePosition);
    if (!m) modules.push((m = { position: c.modulePosition, title: c.moduleTitle, classes: [] }));
    m.classes.push(c);
  }
  modules.sort((a, b) => a.position - b.position);
  return (
    <nav aria-label="Classes in this track" className="rounded-[1.25rem] border border-line bg-surface p-5 shadow-card lg:sticky lg:top-24">
      <h2 className="text-lg">{trackName}</h2>
      <div className="mt-4 space-y-5">
        {modules.map((m) => (
          <div key={m.position}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Module {m.position}: {m.title}</p>
            <ul className="mt-2 space-y-1">
              {m.classes.map((c) => {
                const current = c.id === currentId;
                const body = (
                  <>
                    <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${c.state === "PASSED" ? "bg-accent-bright text-on-accent" : current ? "border border-accent-bright text-accent-ink" : "border border-line-strong text-muted"}`}>
                      {DOT[c.state] ?? "•"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  </>
                );
                return (
                  <li key={c.id}>
                    {c.state === "LOCKED" ? (
                      <span className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted">{body}</span>
                    ) : (
                      <Link href={`/classes/${c.id}`} aria-current={current ? "page" : undefined} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${current ? "bg-accent-soft font-semibold text-accent-ink" : "hover:bg-surface-2"}`}>
                        {body}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}

function ClassView() {
  const { id } = useParams<{ id: string }>();
  const returned = useSearchParams().get("returned") === "1";
  const { data, error, loading, reload } = useLoad<Detail>(`/api/student/classes/${id}`);
  const lastSent = useRef(0);

  // Coming back from ClueQuest: record the return, then keep checking until the signed result arrives.
  useEffect(() => {
    if (returned) api(`/api/student/classes/${id}/returned`, { body: {} }).then(reload).catch(() => undefined);
  }, [returned, id, reload]);

  const pending = data?.state === "PENDING";
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [pending, reload]);

  const onProgress = useCallback(
    (position: number, duration: number) => {
      if (Date.now() - lastSent.current < 3000) return;
      lastSent.current = Date.now();
      api(`/api/student/classes/${id}/progress`, { method: "PUT", body: { positionSeconds: position, durationSeconds: duration } })
        .then(() => reload())
        .catch(() => undefined);
    },
    [id, reload],
  );

  if (loading) return <Loading label="Loading class…" />;
  if (error || !data)
    return (
      <div className="space-y-4">
        <Alert>{error ?? "This class could not be loaded."}</Alert>
        <Link href="/dashboard" className={buttonClass("secondary")}>Back to dashboard</Link>
      </div>
    );

  const c = data.class;
  const canQuiz = ["QUIZ", "RESUME_QUIZ", "RETAKE"].includes(data.state);

  return (
    <div className="space-y-6">
      <Link href="/dashboard" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-ink hover:underline">← Back to dashboard</Link>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <div>
            <Eyebrow>{`${c.trackName} · ${c.moduleTitle}`}</Eyebrow>
            <h1 className="mt-1 text-3xl sm:text-4xl">{c.title}</h1>
          </div>

          <VideoPlayer videoId={c.youtubeId} startSeconds={data.positionSeconds} onProgress={onProgress} />

          <div className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-semibold" data-testid="watched">Watched: {data.watchedPercent}%</p>
              {data.state === "PASSED" && <Badge tone="ok">Passed</Badge>}
            </div>
            <div className="mt-2"><ProgressBar percent={data.watchedPercent} label="Video watched" /></div>
            {!data.quizEligible && data.state !== "PASSED" && <p className="mt-2 text-sm text-muted">Watch at least {data.watchThreshold}% of the class to unlock the quiz.</p>}
          </div>

          {c.description && <p className="max-w-3xl whitespace-pre-line text-muted">{c.description}</p>}

          <Card className="border-accent/50">
            <h2 className="text-xl">Session quiz</h2>
            <div className="mt-4 space-y-3">
              {data.state === "PASSED" && (
                <>
                  <Alert tone="success" title="Quiz passed">Your best score is {data.best?.score}/{data.best?.maxScore}.</Alert>
                  {data.next ? <Link href={`/classes/${data.next.id}`} className={buttonClass("primary")}>Continue to {data.next.title}</Link> : <Link href="/dashboard" className={buttonClass("primary")}>Continue</Link>}
                </>
              )}
              {data.state === "PENDING" && <Alert tone="warn" title="Result pending">We are waiting for your result. You can leave this page; your progress updates when it arrives.</Alert>}
              {data.state === "NO_RETAKE" && <Alert tone="warn" title="Retake unavailable">Your last attempt did not pass and you have used all your attempts. Please contact your tutor.</Alert>}
              {data.state === "RETAKE" && <Alert tone="warn" title="Not passed yet">Your last attempt was below the pass mark. You can try again.</Alert>}
              {!data.class.hasQuiz && <Alert tone="info">No quiz has been attached to this class yet.</Alert>}
              {canQuiz && data.class.hasQuiz && <LaunchButton classId={c.id} label={data.actionLabel} />}
              {!canQuiz && !["PASSED", "PENDING", "NO_RETAKE"].includes(data.state) && (
                <button type="button" disabled className={buttonClass("primary")} aria-describedby="why-locked">{data.actionLabel}</button>
              )}
              {!canQuiz && !["PASSED", "PENDING", "NO_RETAKE"].includes(data.state) && <p id="why-locked" className="text-sm text-muted">The quiz opens after you watch {data.watchThreshold}% of the video.</p>}
              <p className="text-sm text-muted">You go straight to the quiz. No ClueQuest account, name or room code is needed.</p>
            </div>
          </Card>

          {c.multiplayerUrl && (
            <Card>
              <h2 className="text-xl">Optional live game</h2>
              <p className="mt-1 text-muted">Play with classmates as a guest. This is extra practice and does not replace the session quiz.</p>
              <a href={c.multiplayerUrl} target="_blank" rel="noopener noreferrer" className={`${buttonClass("secondary")} mt-3`}>Join live game</a>
            </Card>
          )}

          {data.attempts.length > 0 && (
            <section>
              <h2 className="mb-3 text-xl">Your attempts</h2>
              <Table head={["Attempt", "Score", "Pass mark", "Outcome", "Date"]} caption="Quiz attempts for this class">
                {data.attempts.map((a) => (
                  <tr key={a.id}>
                    <Td>{a.attemptNo}</Td>
                    <Td>{a.score != null ? `${a.score}/${a.maxScore}` : "—"}</Td>
                    <Td>{a.passMark ?? "—"}</Td>
                    <Td>{a.passed === true ? <Badge tone="ok">Passed</Badge> : a.passed === false ? <Badge tone="bad">Not passed</Badge> : <Badge tone="warn">Result pending</Badge>}</Td>
                    <Td>{fmtDate(a.resultAt)}</Td>
                  </tr>
                ))}
              </Table>
            </section>
          )}
        </div>
        <aside className="min-w-0">
          <Curriculum trackName={c.trackName} currentId={c.id} />
        </aside>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <ClassView />
    </Suspense>
  );
}
