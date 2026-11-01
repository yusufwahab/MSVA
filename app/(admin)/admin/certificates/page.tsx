"use client";

import { useState } from "react";
import { Alert, Badge, Button, Empty, Loading, PageHeader, Table, Td } from "@/components/ui";
import { api, errMsg, fmtDate } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface Row { eligibilityId: string; studentCode: string; name: string; track: string; userId: string; trackId: string; eligibleAt: string; status: string; verificationRef: string | null; issuedAt: string | null; attempts: number; lastError: string | null }

export default function Page() {
  const { data, error, loading, reload } = useLoad<{ certificates: Row[] }>("/api/admin/certificates");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function retry(r: Row) {
    setBusy(r.eligibilityId);
    setMsg(null);
    try {
      await api("/api/admin/certificates/retry", { body: { userId: r.userId, trackId: r.trackId } });
      setMsg({ tone: "success", text: `Certificate issued for ${r.name}.` });
    } catch (e) {
      setMsg({ tone: "error", text: errMsg(e) });
    }
    setBusy(null);
    await reload();
  }

  if (loading) return <Loading />;
  if (error || !data) return <Alert>{error ?? "Certificates unavailable."}</Alert>;
  return (
    <div className="space-y-6">
      <PageHeader title="Certificates" lead="Eligibility is recorded when a student passes everything. Issuing the PDF is a separate step that can be retried." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {data.certificates.length === 0 ? <Empty title="No students are eligible yet" /> : (
        <Table head={["Student ID", "Name", "Track", "Eligible since", "Certificate", "Reference", ""]} caption="Certificates">
          {data.certificates.map((r) => (
            <tr key={r.eligibilityId}>
              <Td>{r.studentCode}</Td><Td>{r.name}</Td><Td>{r.track}</Td><Td>{fmtDate(r.eligibleAt, false)}</Td>
              <Td><Badge tone={r.status === "ISSUED" ? "ok" : r.status === "FAILED" ? "bad" : "warn"}>{r.status === "NOT_ISSUED" ? "Not issued" : r.status}</Badge>{r.lastError && <div className="mt-1 text-xs text-danger">{r.lastError}</div>}</Td>
              <Td>{r.verificationRef ?? "—"}</Td>
              <Td>{r.status !== "ISSUED" && <Button variant="secondary" loading={busy === r.eligibilityId} onClick={() => retry(r)} aria-label={`Retry certificate for ${r.name}`}>Retry</Button>}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
