"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Badge, Button, Card, Empty, Loading, PageHeader, Table, Td, buttonClass } from "@/components/ui";
import { api, errMsg, fmtDate } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface Attempt { id: string; attemptNo: number; score: number | null; maxScore: number | null; passMark: number | null; passed: boolean | null; resultAt: string | null }
interface Result { classId: string; classTitle: string; track: string; state: string; best: Attempt | null; attempts: Attempt[] }
interface Dash { tracks: { track: { id: string; name: string }; certificate: { eligible: boolean; id: string | null; status: string | null } }[] }

export default function Page() {
  const results = useLoad<{ results: Result[] }>("/api/student/results");
  const dash = useLoad<Dash>("/api/student/dashboard");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function retry(trackId: string) {
    setBusy(trackId);
    setMsg(null);
    try {
      await api("/api/student/certificates/retry", { body: { trackId } });
      setMsg({ tone: "success", text: "Your certificate is ready." });
      await dash.reload();
    } catch (e) {
      setMsg({ tone: "error", text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  if (results.loading || dash.loading) return <Loading />;
  if (results.error || !results.data) return <Alert>{results.error ?? "Results could not be loaded."}</Alert>;
  const certTracks = dash.data?.tracks.filter((t) => t.certificate.eligible) ?? [];

  return (
    <div className="space-y-8">
      <PageHeader title="Results and certificate" lead="Your scores, pass marks and attempt history for every class." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {certTracks.map((t) => (
        <Card key={t.track.id} className="border-accent/50 bg-accent-soft">
          <h2 className="text-2xl">Certificate: {t.track.name}</h2>
          {t.certificate.status === "ISSUED" && t.certificate.id ? (
            <div className="mt-3 space-y-2">
              <p className="text-muted">You have completed every module and the final assessment.</p>
              <a href={`/api/student/certificates/${t.certificate.id}/download`} className={buttonClass("primary")}>Download certificate (PDF)</a>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <Alert tone="warn">You are eligible. Your certificate has not been generated yet.</Alert>
              <Button loading={busy === t.track.id} onClick={() => retry(t.track.id)}>Generate my certificate</Button>
            </div>
          )}
        </Card>
      ))}

      {results.data.results.length === 0 ? (
        <Empty title="No quiz results yet">When you finish a session quiz, your score appears here. <Link href="/dashboard" className="font-semibold text-accent-ink underline">Go to your dashboard</Link>.</Empty>
      ) : (
        results.data.results.map((r) => (
          <section key={r.classId} className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl"><Link className="text-accent-ink underline underline-offset-4" href={`/classes/${r.classId}`}>{r.classTitle}</Link></h2>
              <span className="text-sm text-muted">{r.track}</span>
              {r.state === "PASSED" ? <Badge tone="ok">Passed</Badge> : r.state === "PENDING" ? <Badge tone="warn">Result pending</Badge> : <Badge tone="bad">Not passed</Badge>}
            </div>
            <Table head={["Attempt", "Score", "Pass mark", "Outcome", "Date"]} caption={`Attempts for ${r.classTitle}`}>
              {r.attempts.map((a) => (
                <tr key={a.id}>
                  <Td>{a.attemptNo}</Td>
                  <Td>{a.score != null ? `${a.score}/${a.maxScore}` : "—"}</Td>
                  <Td>{a.passMark ?? "—"}</Td>
                  <Td>{a.passed === true ? "Passed" : a.passed === false ? "Not passed" : "Result pending"}</Td>
                  <Td>{fmtDate(a.resultAt)}</Td>
                </tr>
              ))}
            </Table>
          </section>
        ))
      )}
    </div>
  );
}
