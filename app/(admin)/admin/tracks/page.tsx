"use client";

import { useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, Empty, Loading, Modal, PageHeader, TextArea, TextField } from "@/components/ui";
import { api, ApiError, errMsg, fmtDate, toLocalInput } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface Track {
  id: string; name: string; description: string; isPremium: boolean; priceNaira: number | null; archived: boolean; enrolmentCount: number;
  cohorts: { id: string; name: string; nextSessionAt: string | null }[];
  modules: { id: string; title: string; position: number; isFinal: boolean }[];
}

export default function Page() {
  const { data, error, loading, reload } = useLoad<{ tracks: Track[] }>("/api/admin/tracks");
  const [modal, setModal] = useState<null | { kind: "track" } | { kind: "cohort"; track: Track } | { kind: "module"; track: Track } | { kind: "session"; track: Track; cohort: Track["cohorts"][number] }>(null);
  const [vals, setVals] = useState({ name: "", description: "", price: "", premium: false, title: "", isFinal: false, session: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const open = (m: NonNullable<typeof modal>) => {
    setVals({ name: "", description: "", price: "", premium: false, title: "", isFinal: false, session: m.kind === "session" ? toLocalInput(m.cohort.nextSessionAt) : "" });
    setFields({});
    setMsg(null);
    setModal(m);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!modal) return;
    setBusy(true);
    setMsg(null);
    setFields({});
    try {
      if (modal.kind === "track") await api("/api/admin/tracks", { body: { name: vals.name, description: vals.description, isPremium: vals.premium, priceNaira: vals.premium ? Number(vals.price) || null : null } });
      if (modal.kind === "cohort") await api(`/api/admin/tracks/${modal.track.id}/cohorts`, { body: { name: vals.name } });
      if (modal.kind === "module") await api(`/api/admin/tracks/${modal.track.id}/modules`, { body: { title: vals.title, isFinal: vals.isFinal } });
      if (modal.kind === "session") await api(`/api/admin/cohorts/${modal.cohort.id}`, { method: "PATCH", body: { nextSessionAt: vals.session ? new Date(vals.session).toISOString() : null } });
      setModal(null);
      setNotice("Saved.");
      await reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setMsg(errMsg(err));
    }
    setBusy(false);
  }

  async function move(id: string, direction: "up" | "down") {
    await api(`/api/admin/modules/${id}/move`, { body: { direction } }).catch(() => undefined);
    await reload();
  }

  if (loading) return <Loading />;
  if (error || !data) return <Alert>{error ?? "Tracks could not be loaded."}</Alert>;

  return (
    <div className="space-y-6">
      <PageHeader title="Tracks and cohorts" lead="Create tracks, then cohorts and ordered modules inside each one.">
        <Button onClick={() => open({ kind: "track" })}>New track</Button>
      </PageHeader>
      {notice && <Alert tone="success">{notice}</Alert>}
      {data.tracks.length === 0 && <Empty title="No tracks yet">Create a track such as Front-End Development to begin.</Empty>}

      {data.tracks.map((t) => (
        <Card key={t.id} className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl">{t.name}</h2>
            {t.isPremium && <Badge tone="info">Premium · ₦{t.priceNaira?.toLocaleString()}</Badge>}
            <span className="text-sm text-muted">{t.enrolmentCount} enrolment(s)</span>
          </div>
          {t.description && <p className="text-muted">{t.description}</p>}
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center justify-between"><h3 className="text-lg">Cohorts</h3><Button variant="secondary" onClick={() => open({ kind: "cohort", track: t })}>Add cohort</Button></div>
              {t.cohorts.length === 0 ? <p className="text-muted">No cohorts yet.</p> : (
                <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                  {t.cohorts.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span><strong>{c.name}</strong><br /><span className="text-sm text-muted">Next session: {fmtDate(c.nextSessionAt)}</span></span>
                      <Button variant="quiet" onClick={() => open({ kind: "session", track: t, cohort: c })}>Set next session</Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between"><h3 className="text-lg">Modules (in order)</h3><Button variant="secondary" onClick={() => open({ kind: "module", track: t })}>Add module</Button></div>
              {t.modules.length === 0 ? <p className="text-muted">No modules yet. Tutors need at least one to create classes.</p> : (
                <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                  {t.modules.map((m, i) => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span>{m.position}. {m.title} {m.isFinal && <Badge tone="warn">Final assessment</Badge>}</span>
                      <span className="flex gap-1">
                        <Button variant="quiet" disabled={i === 0} aria-label={`Move ${m.title} up`} onClick={() => move(m.id, "up")}>Up</Button>
                        <Button variant="quiet" disabled={i === t.modules.length - 1} aria-label={`Move ${m.title} down`} onClick={() => move(m.id, "down")}>Down</Button>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </Card>
      ))}

      <Modal open={modal !== null} title={modal?.kind === "track" ? "New track" : modal?.kind === "cohort" ? `Add cohort to ${modal.track.name}` : modal?.kind === "module" ? `Add module to ${modal.track.name}` : "Set next session"} onClose={() => setModal(null)}>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {msg && <Alert>{msg}</Alert>}
          {modal?.kind === "track" && (
            <>
              <TextField label="Track name" value={vals.name} error={fields.name} onChange={(e) => setVals({ ...vals, name: e.target.value })} />
              <TextArea label="Description" value={vals.description} onChange={(e) => setVals({ ...vals, description: e.target.value })} />
              <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5" checked={vals.premium} onChange={(e) => setVals({ ...vals, premium: e.target.checked })} /> Premium course (paid access)</label>
              {vals.premium && <TextField label="Price in naira" type="number" min={1} inputMode="numeric" value={vals.price} error={fields.priceNaira} onChange={(e) => setVals({ ...vals, price: e.target.value })} />}
            </>
          )}
          {modal?.kind === "cohort" && <TextField label="Cohort name" value={vals.name} error={fields.name} onChange={(e) => setVals({ ...vals, name: e.target.value })} />}
          {modal?.kind === "module" && (
            <>
              <TextField label="Module title" value={vals.title} error={fields.title} onChange={(e) => setVals({ ...vals, title: e.target.value })} />
              <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5" checked={vals.isFinal} onChange={(e) => setVals({ ...vals, isFinal: e.target.checked })} /> This module holds the final assessment</label>
            </>
          )}
          {modal?.kind === "session" && <TextField label="Next session date and time" type="datetime-local" hint="Leave empty if not decided. Students see this on their dashboard when no class is open." value={vals.session} onChange={(e) => setVals({ ...vals, session: e.target.value })} />}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setModal(null)}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></div>
        </form>
      </Modal>
    </div>
  );
}
