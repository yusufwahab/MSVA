"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Alert, Badge, Button, Empty, Loading, Modal, PageHeader, SelectField, Stat, Table, Td } from "@/components/ui";
import { api, errMsg, fmtDate } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface Row {
  id: string; title: string; status: string; state: "Draft" | "Scheduled" | "Live"; releaseAt: string | null;
  track: { id: string; name: string }; cohort: { name: string }; module: { title: string };
  hasVideo: boolean; hasQuiz: boolean; enrolled: number; submitted: number;
}
interface Overview { tracks: { id: string; name: string; cohorts: { id: string; name: string }[]; modules: { id: string; title: string }[] }[] }

const TONE = { Draft: "neutral", Scheduled: "warn", Live: "ok" } as const;

export default function Page() {
  const router = useRouter();
  const list = useLoad<{ classes: Row[] }>("/api/tutor/classes");
  const overview = useLoad<Overview>("/api/tutor/overview");
  const [open, setOpen] = useState(false);
  const [trackId, setTrackId] = useState("");
  const [cohortId, setCohortId] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const track = overview.data?.tracks.find((t) => t.id === trackId);

  async function create(e: FormEvent) {
    e.preventDefault();
    const f: Record<string, string> = {};
    if (!trackId) f.trackId = "Choose a track";
    if (!cohortId) f.cohortId = "Choose a cohort";
    if (!moduleId) f.moduleId = "Choose a module";
    setFields(f);
    if (Object.keys(f).length) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ id: string }>("/api/tutor/classes", { body: { trackId, cohortId, moduleId } });
      router.push(`/tutor/classes/${r.id}`);
    } catch (e2) {
      setErr(errMsg(e2));
      setBusy(false);
    }
  }

  if (list.loading || overview.loading) return <Loading />;
  if (list.error || !list.data) return <Alert>{list.error ?? "Classes could not be loaded."}</Alert>;
  const noTracks = (overview.data?.tracks.length ?? 0) === 0;

  return (
    <div className="space-y-6">
      <PageHeader title="My classes" lead="Classes for the teaching areas you are assigned to.">
        <Button onClick={() => setOpen(true)} disabled={noTracks}>New class</Button>
      </PageHeader>

      {noTracks && <Alert tone="info">You have not been assigned to a track yet. Ask the academy administrator to assign one.</Alert>}

      {list.data.classes.length > 0 && (
        <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="All classes" value={list.data.classes.length} />
          <Stat label="Live" value={list.data.classes.filter((c) => c.state === "Live").length} />
          <Stat label="Scheduled" value={list.data.classes.filter((c) => c.state === "Scheduled").length} />
          <Stat label="Drafts" value={list.data.classes.filter((c) => c.state === "Draft").length} />
        </dl>
      )}

      {!noTracks && list.data.classes.length === 0 ? (
        <Empty title="No classes yet">Create your first class as a draft. You can finish it later.</Empty>
      ) : (
        list.data.classes.length > 0 && (
          <Table head={["Class", "Track and cohort", "Release", "Status", "Quiz results", ""]} caption="Your classes">
            {list.data.classes.map((c) => (
              <tr key={c.id}>
                <Td><Link className="font-semibold text-accent-ink underline underline-offset-4" href={`/tutor/classes/${c.id}`}>{c.title || "Untitled class"}</Link><div className="text-muted">{c.module.title}</div></Td>
                <Td>{c.track.name}<div className="text-muted">{c.cohort.name}</div></Td>
                <Td>{fmtDate(c.releaseAt)}</Td>
                <Td><Badge tone={TONE[c.state]}>{c.state}</Badge>{c.status === "DRAFT" && (!c.hasVideo || !c.hasQuiz) && <div className="mt-1 text-xs text-muted">Needs {[!c.hasVideo && "video", !c.hasQuiz && "quiz"].filter(Boolean).join(" and ")}</div>}</Td>
                <Td>{c.status === "PUBLISHED" ? `${c.submitted} of ${c.enrolled} submitted` : "—"}</Td>
                <Td>{c.status === "PUBLISHED" && <Link className="font-semibold text-accent-ink underline underline-offset-4" href={`/tutor/classes/${c.id}/results`}>Results</Link>}</Td>
              </tr>
            ))}
          </Table>
        )
      )}

      <Modal open={open} title="New class" onClose={() => setOpen(false)}>
        <form onSubmit={create} className="space-y-4" noValidate>
          {err && <Alert>{err}</Alert>}
          <SelectField label="Track" value={trackId} error={fields.trackId} onChange={(e) => { setTrackId(e.target.value); setCohortId(""); setModuleId(""); }}>
            <option value="">Choose a track</option>
            {overview.data?.tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </SelectField>
          <SelectField label="Cohort" value={cohortId} error={fields.cohortId} disabled={!track} onChange={(e) => setCohortId(e.target.value)}>
            <option value="">Choose a cohort</option>
            {track?.cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectField>
          <SelectField label="Module" value={moduleId} error={fields.moduleId} disabled={!track} hint={track && track.modules.length === 0 ? "This track has no modules yet. Ask an administrator to add one." : undefined} onChange={(e) => setModuleId(e.target.value)}>
            <option value="">Choose a module</option>
            {track?.modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
          </SelectField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>Create draft</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
