"use client";

import { useState } from "react";
import { Alert, Badge, Empty, Loading, PageHeader, ProgressBar, SelectField, Table, Td } from "@/components/ui";
import { fmtDate } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

type Tab = "enrolments" | "progress" | "scores";
interface Track { id: string; name: string; cohorts: { id: string; name: string }[] }

function Section({ tab, qs }: { tab: Tab; qs: string }) {
  const { data, error, loading } = useLoad<Record<string, Record<string, unknown>[]>>(`/api/admin/${tab}${qs}`);
  if (loading) return <Loading />;
  if (error || !data) return <Alert>{error ?? "Report unavailable."}</Alert>;
  const rows = data[tab];
  if (!rows.length) return <Empty title="Nothing to show for these filters" />;

  if (tab === "enrolments")
    return (
      <Table head={["Student ID", "Name", "Email", "Track", "Cohort", "Enrolment", "Joined"]} caption="Enrolments">
        {rows.map((r) => (
          <tr key={String(r.id)}><Td>{String(r.studentCode)}</Td><Td>{String(r.name)}</Td><Td>{String(r.email)}</Td><Td>{String(r.track)}</Td><Td>{String(r.cohort)}</Td><Td><Badge tone={r.status === "ACTIVE" ? "ok" : "warn"}>{String(r.status)}</Badge></Td><Td>{fmtDate(r.createdAt as string, false)}</Td></tr>
        ))}
      </Table>
    );
  if (tab === "progress")
    return (
      <Table head={["Student ID", "Name", "Track", "Cohort", "Classes passed", "Progress"]} caption="Student progress">
        {rows.map((r, i) => (
          <tr key={i}><Td>{String(r.studentCode)}</Td><Td>{String(r.name)}</Td><Td>{String(r.track)}</Td><Td>{String(r.cohort)}</Td><Td>{String(r.passed)} of {String(r.total)}</Td><Td className="min-w-32"><ProgressBar percent={Number(r.percent)} label={`${r.name} progress`} /></Td></tr>
        ))}
      </Table>
    );
  return (
    <Table head={["Student ID", "Name", "Track", "Class", "Attempt", "Score", "Outcome", "Date"]} caption="Quiz scores">
      {rows.map((r) => (
        <tr key={String(r.id)}><Td>{String(r.studentCode)}</Td><Td>{String(r.name)}</Td><Td>{String(r.track)}</Td><Td>{String(r.classTitle)}</Td><Td>{String(r.attemptNo)}</Td><Td>{String(r.score)}/{String(r.maxScore)}</Td><Td>{r.passed ? "Passed" : "Not passed"}</Td><Td>{fmtDate(r.resultAt as string)}</Td></tr>
      ))}
    </Table>
  );
}

export default function Page() {
  const [tab, setTab] = useState<Tab>("enrolments");
  const [trackId, setTrackId] = useState("");
  const [cohortId, setCohortId] = useState("");
  const tracks = useLoad<{ tracks: Track[] }>("/api/admin/tracks");
  const cohorts = tracks.data?.tracks.find((t) => t.id === trackId)?.cohorts ?? [];
  const qs = new URLSearchParams({ ...(trackId ? { trackId } : {}), ...(cohortId ? { cohortId } : {}) }).toString();
  const tabs: [Tab, string][] = [["enrolments", "Enrolments"], ["progress", "Progress"], ["scores", "Scores"]];

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" lead="Enrolments, progress and quiz scores across the academy." />
      <div role="tablist" aria-label="Report type" className="inline-flex flex-wrap gap-1 rounded-full border border-line bg-surface p-1">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-11 rounded-full px-5 text-[0.95rem] font-semibold ${tab === k ? "bg-accent-bright text-on-accent" : "text-ink/85 hover:bg-surface-2"}`}>{label}</button>
        ))}
      </div>
      <div className="grid gap-4 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2">
        <SelectField label="Track" value={trackId} onChange={(e) => { setTrackId(e.target.value); setCohortId(""); }}>
          <option value="">All tracks</option>{tracks.data?.tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </SelectField>
        <SelectField label="Cohort" value={cohortId} disabled={!trackId} onChange={(e) => setCohortId(e.target.value)}>
          <option value="">All cohorts</option>{cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </SelectField>
      </div>
      <div role="tabpanel"><Section key={tab + qs} tab={tab} qs={qs ? `?${qs}` : ""} /></div>
    </div>
  );
}
