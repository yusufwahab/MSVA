"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { Alert, Badge, Button, ConfirmModal, Empty, Loading, Modal, PageHeader, SelectField, Table, Td, TextArea, TextField } from "@/components/ui";
import { api, ApiError, errMsg } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface Student {
  id: string; name: string; email: string; status: "INVITED" | "ACTIVE" | "DEACTIVATED"; studentCode: string;
  enrolments: { id: string; track: string; cohort: string; status: string }[];
}
interface Track { id: string; name: string; cohorts: { id: string; name: string }[] }
interface PreviewRow { line: number; name: string; email: string; track: string; cohort: string; status: string; reason?: string }
interface Preview { rows: PreviewRow[]; counts: Record<string, number> }

const ROW_LABEL: Record<string, string> = { new_student: "New student", new_enrolment: "New enrolment", already_enrolled: "Already enrolled (skipped)", duplicate_in_file: "Duplicate in file (skipped)", invalid: "Invalid" };
const ROW_TONE: Record<string, "ok" | "neutral" | "bad" | "warn"> = { new_student: "ok", new_enrolment: "ok", already_enrolled: "neutral", duplicate_in_file: "warn", invalid: "bad" };
const STATUS_TONE = { ACTIVE: "ok", INVITED: "warn", DEACTIVATED: "bad" } as const;

export default function Page() {
  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState("");
  const q = new URLSearchParams({ ...(search ? { search } : {}), ...(statusF ? { status: statusF } : {}) }).toString();
  const list = useLoad<{ students: Student[] }>(`/api/admin/students${q ? `?${q}` : ""}`);
  const tracks = useLoad<{ tracks: Track[] }>("/api/admin/tracks");

  const [modal, setModal] = useState<null | "add" | "csv" | "email" | "deactivate" | "reactivate">(null);
  const [target, setTarget] = useState<Student | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const [form, setForm] = useState({ name: "", email: "", trackId: "", cohortId: "" });
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [newEmail, setNewEmail] = useState("");

  const cohorts = tracks.data?.tracks.find((t) => t.id === form.trackId)?.cohorts ?? [];

  function openModal(m: typeof modal, s?: Student) {
    setModal(m);
    setTarget(s ?? null);
    setErr(null);
    setFields({});
    setPreview(null);
    if (m === "add") setForm({ name: "", email: "", trackId: "", cohortId: "" });
    if (m === "csv") { setCsv(""); setForm((f) => ({ ...f, trackId: "", cohortId: "" })); }
    if (m === "email" && s) setNewEmail(s.email);
  }
  const close = () => setModal(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      setErr(errMsg(e));
    }
    setBusy(false);
  }

  const emailNote = (sent: boolean | null | undefined, ok: string) =>
    sent === false ? { tone: "warn" as const, text: "Saved, but the email could not be sent. Use “Resend invite” to try again." } : { tone: "success" as const, text: ok };

  async function add(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const r = await api<{ emailSent: boolean | null }>("/api/admin/students", { body: form });
      setNotice(emailNote(r.emailSent, `Invitation sent to ${form.email}.`));
      close();
      await list.reload();
    });
  }

  async function readFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) { setCsv(await f.text()); setPreview(null); }
  }

  const csvBody = () => ({ csv, trackId: form.trackId || undefined, cohortId: form.cohortId || undefined });

  async function doPreview() {
    await run(async () => setPreview(await api<Preview>("/api/admin/students/import/preview", { body: csvBody() })));
  }

  async function doCommit() {
    await run(async () => {
      const r = await api<{ imported: number; skipped: number; emailFailures: number }>("/api/admin/students/import/commit", { body: csvBody() });
      setNotice({ tone: r.emailFailures ? "warn" : "success", text: `Imported ${r.imported} student(s); skipped ${r.skipped}.${r.emailFailures ? ` ${r.emailFailures} invitation email(s) failed — use Resend invite.` : ""}` });
      close();
      await list.reload();
    });
  }

  async function resend(s: Student) {
    setNotice(null);
    try {
      const r = await api<{ emailSent: boolean }>(`/api/admin/users/${s.id}/resend-invite`, { body: {} });
      setNotice(r.emailSent ? { tone: "success", text: `New invitation sent to ${s.email}. The previous link no longer works.` } : { tone: "error", text: "The email could not be sent. Try again shortly." });
    } catch (e) {
      setNotice({ tone: "error", text: errMsg(e) });
    }
  }

  async function changeEmail(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const r = await api<{ emailSent: boolean | null }>(`/api/admin/users/${target!.id}/email`, { method: "PATCH", body: { email: newEmail } });
      setNotice(emailNote(r.emailSent, "Email updated."));
      close();
      await list.reload();
    });
  }

  async function setActive(on: boolean) {
    await run(async () => {
      await api(`/api/admin/users/${target!.id}/${on ? "reactivate" : "deactivate"}`, { body: {} });
      setNotice({ tone: "success", text: on ? `${target!.name} can sign in again.` : `${target!.name} has been deactivated and signed out everywhere.` });
      close();
      await list.reload();
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Students" lead="Add students one at a time or import a CSV. Each student gets a permanent ID and an emailed activation code.">
        <Button variant="secondary" onClick={() => openModal("csv")}>Import CSV</Button>
        <Button onClick={() => openModal("add")}>Add student</Button>
      </PageHeader>

      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      <div className="grid gap-4 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-[1fr_14rem]">
        <TextField label="Search by name, email or student ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        <SelectField label="Status" value={statusF} onChange={(e) => setStatusF(e.target.value)}>
          <option value="">All</option><option value="INVITED">Awaiting activation</option><option value="ACTIVE">Active</option><option value="DEACTIVATED">Deactivated</option>
        </SelectField>
      </div>

      {list.loading ? <Loading /> : list.error ? <Alert>{list.error}</Alert> : list.data!.students.length === 0 ? (
        <Empty title="No students found">Add your first student, or adjust the filters.</Empty>
      ) : (
        <Table head={["Student", "Track and cohort", "Status", "Actions"]} caption="Students">
          {list.data!.students.map((s) => (
            <tr key={s.id}>
              <Td><strong>{s.name}</strong><div className="text-muted">{s.email}</div><div className="text-muted">{s.studentCode}</div></Td>
              <Td>{s.enrolments.map((e) => <div key={e.id}>{e.track}, {e.cohort}</div>)}</Td>
              <Td><Badge tone={STATUS_TONE[s.status]}>{s.status === "INVITED" ? "Awaiting activation" : s.status === "ACTIVE" ? "Active" : "Deactivated"}</Badge></Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {s.status === "INVITED" && <Button variant="quiet" onClick={() => resend(s)} aria-label={`Resend invite to ${s.name}`}>Resend invite</Button>}
                  <Button variant="quiet" onClick={() => openModal("email", s)} aria-label={`Correct email for ${s.name}`}>Correct email</Button>
                  {s.status === "DEACTIVATED" ? <Button variant="quiet" onClick={() => openModal("reactivate", s)} aria-label={`Reactivate ${s.name}`}>Reactivate</Button> : <Button variant="quiet" onClick={() => openModal("deactivate", s)} aria-label={`Deactivate ${s.name}`}>Deactivate</Button>}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <Modal open={modal === "add"} title="Add student" onClose={close}>
        <form onSubmit={add} className="space-y-4" noValidate>
          {err && <Alert>{err}</Alert>}
          <TextField label="Full name" value={form.name} error={fields.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField label="Email address" type="email" value={form.email} error={fields.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <SelectField label="Track" value={form.trackId} error={fields.trackId} onChange={(e) => setForm({ ...form, trackId: e.target.value, cohortId: "" })}>
            <option value="">Choose a track</option>{tracks.data?.tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </SelectField>
          <SelectField label="Cohort" value={form.cohortId} error={fields.cohortId} disabled={!form.trackId} onChange={(e) => setForm({ ...form, cohortId: e.target.value })}>
            <option value="">Choose a cohort</option>{cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectField>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={close}>Cancel</Button><Button type="submit" loading={busy}>Add and send invite</Button></div>
        </form>
      </Modal>

      <Modal open={modal === "csv"} title="Import students from CSV" onClose={close}>
        <div className="space-y-4">
          <p className="text-sm text-muted">Columns: <code>name, email, track, cohort</code>. If a row leaves track or cohort empty, the defaults below are used. Re-importing the same file never creates duplicates.</p>
          {err && <Alert>{err}</Alert>}
          <div className="space-y-1.5"><label htmlFor="csv-file" className="block text-sm font-semibold">CSV file</label><input id="csv-file" type="file" accept=".csv,text/csv" onChange={readFile} className="block w-full text-sm" /></div>
          <TextArea label="Or paste CSV text" value={csv} onChange={(e) => { setCsv(e.target.value); setPreview(null); }} rows={5} placeholder={"name,email,track,cohort\nAda Obi,ada@example.com,Graphic Design,Cohort 1"} />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Default track (optional)" value={form.trackId} onChange={(e) => { setForm({ ...form, trackId: e.target.value, cohortId: "" }); setPreview(null); }}>
              <option value="">None</option>{tracks.data?.tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </SelectField>
            <SelectField label="Default cohort (optional)" value={form.cohortId} disabled={!form.trackId} onChange={(e) => { setForm({ ...form, cohortId: e.target.value }); setPreview(null); }}>
              <option value="">None</option>{cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SelectField>
          </div>
          {!preview && <Button onClick={doPreview} loading={busy} disabled={!csv.trim()}>Preview import</Button>}
          {preview && (
            <div className="space-y-3">
              <p className="font-semibold" data-testid="csv-summary">
                {preview.counts.new_student + preview.counts.new_enrolment} to import · {preview.counts.already_enrolled + preview.counts.duplicate_in_file} skipped · {preview.counts.invalid} invalid
              </p>
              <div className="max-h-64 overflow-auto border border-line">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Import preview</caption>
                  <thead className="sticky top-0 bg-surface-2"><tr><th className="px-2 py-1.5">Line</th><th className="px-2 py-1.5">Email</th><th className="px-2 py-1.5">Result</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {preview.rows.map((r) => (
                      <tr key={r.line}><td className="px-2 py-1.5">{r.line}</td><td className="px-2 py-1.5">{r.email || r.name}</td><td className="px-2 py-1.5"><Badge tone={ROW_TONE[r.status]}>{ROW_LABEL[r.status]}</Badge>{r.reason && r.status === "invalid" && <div className="text-danger">{r.reason}</div>}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" onClick={() => setPreview(null)}>Edit file</Button>
                <Button onClick={doCommit} loading={busy} disabled={preview.counts.new_student + preview.counts.new_enrolment === 0}>Import {preview.counts.new_student + preview.counts.new_enrolment} and send invites</Button>
              </div>
            </div>
          )}
          {!preview && <div className="flex justify-end"><Button variant="secondary" onClick={close}>Close</Button></div>}
        </div>
      </Modal>

      <Modal open={modal === "email"} title={`Correct email for ${target?.name ?? ""}`} onClose={close}>
        <form onSubmit={changeEmail} className="space-y-4" noValidate>
          {err && <Alert>{err}</Alert>}
          <TextField label="New email address" type="email" value={newEmail} error={fields.email} onChange={(e) => setNewEmail(e.target.value)} />
          <p className="text-sm text-muted">{target?.status === "INVITED" ? "A new activation code is sent to the new address, and codes sent to the old address stop working." : "The student is signed out and must use the new address."}</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={close}>Cancel</Button><Button type="submit" loading={busy}>Update email</Button></div>
        </form>
      </Modal>

      <ConfirmModal open={modal === "deactivate"} title={`Deactivate ${target?.name ?? ""}?`} body={<p>They are signed out immediately and cannot sign in. Their results are kept. You can reactivate them later.</p>} confirmLabel="Deactivate" danger busy={busy} error={err ?? undefined} onConfirm={() => setActive(false)} onClose={close} />
      <ConfirmModal open={modal === "reactivate"} title={`Reactivate ${target?.name ?? ""}?`} body={<p>They will be able to sign in again.</p>} confirmLabel="Reactivate" busy={busy} error={err ?? undefined} onConfirm={() => setActive(true)} onClose={close} />
    </div>
  );
}
