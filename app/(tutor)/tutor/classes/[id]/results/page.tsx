"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Alert, Badge, Card, Empty, Loading, PageHeader, Table, Td } from "@/components/ui";
import { useLoad } from "@/lib/useLoad";

interface Results {
  class: { title: string; track: { name: string }; cohort: { name: string } };
  totals: { enrolled: number; submitted: number; passed: number; outstanding: number };
  students: { studentCode: string; name: string; watchedPercent: number; attempts: number; submitted: boolean; latestScore: number | null; bestScore: number | null; maxScore: number | null; passed: boolean; lastResultAt: string | null; pending: boolean }[];
  outstanding: { studentCode: string; name: string; watchedPercent: number }[];
  questionInsights: { questionId: string; prompt: string; correctPercent: number; answered: number }[] | null;
}

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading } = useLoad<Results>(`/api/tutor/classes/${id}/results`);
  if (loading) return <Loading />;
  if (error || !data) return <Alert>{error ?? "Results could not be loaded."}</Alert>;
  const t = data.totals;

  return (
    <div className="space-y-8">
      <PageHeader title={`Results: ${data.class.title}`} lead={`${data.class.track.name} · ${data.class.cohort.name}`} />
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Enrolled", t.enrolled], ["Submitted", t.submitted], ["Passed", t.passed], ["Outstanding", t.outstanding]].map(([k, v]) => (
          <Card key={k as string}><dt className="text-sm font-semibold text-muted">{k}</dt><dd className="font-serif text-4xl" data-testid={`total-${String(k).toLowerCase()}`}>{v}</dd></Card>
        ))}
      </dl>
      <p className="text-sm text-muted">Each student is counted once, however many times they retake the quiz.</p>

      <section className="space-y-2">
        <h2 className="text-2xl">Individual scores</h2>
        {data.students.length === 0 ? <Empty title="No students are enrolled in this cohort yet" /> : (
          <Table head={["Student ID", "Name", "Watched", "Attempts", "Latest score", "Best score", "Status"]} caption="Scores per student">
            {data.students.map((s) => (
              <tr key={s.studentCode}>
                <Td>{s.studentCode}</Td><Td>{s.name}</Td><Td>{s.watchedPercent}%</Td><Td>{s.attempts}</Td>
                <Td>{s.latestScore != null ? `${s.latestScore}/${s.maxScore}` : "—"}</Td>
                <Td>{s.bestScore != null ? `${s.bestScore}/${s.maxScore}` : "—"}</Td>
                <Td>{s.passed ? <Badge tone="ok">Passed</Badge> : s.submitted ? <Badge tone="bad">Not passed</Badge> : s.pending ? <Badge tone="warn">Result pending</Badge> : <Badge>Outstanding</Badge>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      {data.outstanding.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-2xl">Students outstanding</h2>
          <ul className="divide-y divide-line border border-line bg-card">
            {data.outstanding.map((s) => <li key={s.studentCode} className="flex justify-between gap-3 px-4 py-2.5"><span>{s.name} <span className="text-muted">{s.studentCode}</span></span><span className="text-muted">Watched {s.watchedPercent}%</span></li>)}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-2xl">Question insights</h2>
        {data.questionInsights ? (
          <Table head={["Question", "Answered", "Correct"]} caption="Question-level results supplied by the quiz provider">
            {data.questionInsights.map((q) => <tr key={q.questionId}><Td>{q.prompt}</Td><Td>{q.answered}</Td><Td>{q.correctPercent}%</Td></tr>)}
          </Table>
        ) : (
          <p className="text-muted">ClueQuest does not send question-level data, so only scores are shown.</p>
        )}
      </section>
      <Link href="/tutor" className="inline-block min-h-11 py-2.5 font-semibold text-navy underline underline-offset-4">Back to my classes</Link>
    </div>
  );
}
