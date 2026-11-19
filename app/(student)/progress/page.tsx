"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert, Badge, Button, Card, Empty, Loading, PageHeader, Table, Td, buttonClass } from "@/components/ui";
import { api, errMsg, fmtDate } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface Attempt { id: string; attemptNo: number; score: number | null; maxScore: number | null; passMark: number | null; passed: boolean | null; resultAt: string | null }
interface Result { classId: string; classTitle: string; track: string; state: string; best: Attempt | null; attempts: Attempt[] }
type CertKind = "PARTICIPATION" | "COMPLETION";
interface Cert { kind: CertKind; state: "AWAITING_APPROVAL" | "READY" | "PREPARING"; id: string | null }
interface Dash { tracks: { track: { id: string; name: string }; certificates: Cert[] }[] }

const kindTitle = (k: CertKind) => (k === "PARTICIPATION" ? "Certificate of participation" : "Certificate of completion");

export default function Page() {
  const results = useLoad<{ results: Result[] }>("/api/student/results");
  const dash = useLoad<Dash>("/api/student/dashboard");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function retry(trackId: string, kind: CertKind) {
    setBusy(`${trackId}:${kind}`);
    setMsg(null);
    try {
      await api("/api/student/certificates/retry", { body: { trackId, kind } });
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
  const certs = (dash.data?.tracks ?? []).flatMap((t) => t.certificates.map((c) => ({ ...c, trackId: t.track.id, trackName: t.track.name })));

  return (
    <div className="space-y-8">
      <PageHeader title="Results and certificate" lead="Your scores, pass marks and attempt history for every class." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {certs.map((c) => (
        <Card key={`${c.trackId}:${c.kind}`} className="border-accent/50 bg-accent-soft">
          <h2 className="text-2xl">{kindTitle(c.kind)}: {c.trackName}</h2>
          <p className="mt-2 text-muted">
            {c.kind === "PARTICIPATION" ? "Thank you for taking part in this course." : "You have completed every module and the final assessment."}
          </p>
          {c.state === "READY" && c.id ? (
            <div className="mt-3">
              <a href={`/api/student/certificates/${c.id}/download`} className={buttonClass("primary")}>Download {c.kind === "PARTICIPATION" ? "participation" : "completion"} certificate (PDF)</a>
            </div>
          ) : c.state === "AWAITING_APPROVAL" ? (
            <div className="mt-3">
              <Alert tone="info" title="Waiting for approval">The academy reviews every certificate before it is released. You can download it here as soon as it is unlocked.</Alert>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <Alert tone="warn">Your certificate has been approved but is not ready yet.</Alert>
              <Button loading={busy === `${c.trackId}:${c.kind}`} onClick={() => retry(c.trackId, c.kind)}>Generate my certificate</Button>
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
