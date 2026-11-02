"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { LaunchButton } from "@/components/LaunchButton";
import { Alert, Card, Loading, PageHeader, buttonClass } from "@/components/ui";
import { fmtDate } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface Preview {
  title: string; description: string; youtubeId: string; releaseAt: string | null; moduleTitle: string; quizAttached: boolean; quizTitle: string;
  multiplayerUrl: string; watchThreshold: number; problems: Record<string, string>;
}

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading } = useLoad<{ preview: Preview }>(`/api/tutor/classes/${id}/preview`);
  if (loading) return <Loading />;
  if (error || !data) return <Alert>{error ?? "Preview unavailable."}</Alert>;
  const p = data.preview;
  const problems = Object.values(p.problems);

  return (
    <div className="space-y-6">
      <Alert tone="info" title="Preview">This is how students will see the class. Nothing you do here is recorded. Release: {fmtDate(p.releaseAt)}.</Alert>
      {problems.length > 0 && <Alert tone="warn" title="Not ready to publish yet"><ul className="list-disc pl-5">{problems.map((x) => <li key={x}>{x}</li>)}</ul></Alert>}
      <PageHeader title={p.title} lead={p.moduleTitle} />
      {p.youtubeId ? (
        <div className="aspect-video w-full overflow-hidden rounded-2xl border border-line bg-black">
          <iframe className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${p.youtubeId}`} title="Class video preview" allow="encrypted-media; picture-in-picture" allowFullScreen />
        </div>
      ) : (
        <Alert tone="warn">No valid YouTube video is attached.</Alert>
      )}
      {p.description && <p className="max-w-3xl whitespace-pre-line text-muted">{p.description}</p>}
      <Card className="border-accent/50">
        <h2 className="text-xl">Session quiz</h2>
        <p className="mt-2 text-muted">Students must watch {p.watchThreshold}% of the video before “Take session quiz” unlocks.</p>
        <p className="mt-2">{p.quizAttached ? <>Attached: <strong>{p.quizTitle || "Individual quiz"}</strong></> : "No individual quiz attached."}</p>
        <div className="mt-4">
          {p.quizAttached ? (
            <div className="space-y-2">
              <LaunchButton classId={id} label="Take session quiz" endpoint={`/api/tutor/classes/${id}/quiz/preview-launch`} />
              <p className="text-sm text-muted">Try the real quiz as a student would. Your attempt is not recorded, and you come back to this page afterwards.</p>
            </div>
          ) : (
            <button type="button" disabled className={buttonClass("primary")}>Take session quiz</button>
          )}
        </div>
      </Card>
      {p.multiplayerUrl && (
        <Card>
          <h2 className="text-xl">Optional live game</h2>
          <p className="mt-2 text-muted">Shown separately as “Join live game”. It does not replace the quiz.</p>
        </Card>
      )}
      <Link href={`/tutor/classes/${id}`} className={buttonClass("secondary")}>Back to editor</Link>
    </div>
  );
}
