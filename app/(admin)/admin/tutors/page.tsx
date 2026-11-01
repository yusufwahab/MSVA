"use client";

import { useState, type FormEvent } from "react";
import { Alert, Badge, Button, ConfirmModal, Empty, Loading, Modal, PageHeader, Table, Td, TextField } from "@/components/ui";
import { api, ApiError, errMsg } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface Tutor { id: string; name: string; email: string; status: "INVITED" | "ACTIVE" | "DEACTIVATED"; classCount: number; tracks: { id: string; name: string }[] }
interface Track { id: string; name: string }

const TONE = { ACTIVE: "ok", INVITED: "warn", DEACTIVATED: "bad" } as const;

export default function Page() {
  const list = useLoad<{ tutors: Tutor[] }>("/api/admin/tutors");
  const tracks = useLoad<{ tracks: Track[] }>("/api/admin/tracks");
  const [modal, setModal] = useState<null | "invite" | "tracks" | "remove" | "email">(null);
  const [target, setTarget] = useState<Tutor | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "warn" | "error"; text: string } | null>(null);

  function open(m: NonNullable<typeof modal>, t?: Tutor) {
    setModal(m); setTarget(t ?? null); setErr(null); setFields({});
    if (m === "invite") { setName(""); setEmail(""); setPicked([]); }
    if (m === "tracks" && t) setPicked(t.tracks.map((x) => x.id));
    if (m === "email" && t) setEmail(t.email);
  }
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const close = () => setModal(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { if (e instanceof ApiError && e.fields) setFields(e.fields); setErr(errMsg(e)); }
    setBusy(false);
  }

  const trackPicker = (
    <fieldset className="space-y-1">
      <legend className="text-sm font-semibold">Teaching tracks</legend>
      {tracks.data?.tracks.map((t) => (
        <label key={t.id} className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5" checked={picked.includes(t.id)} onChange={() => toggle(t.id)} />{t.name}</label>
      ))}
      {fields.trackIds && <p role="alert" className="text-sm font-medium text-danger">{fields.trackIds}</p>}
    </fieldset>
  );

  async function invite(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const r = await api<{ emailSent: boolean }>("/api/admin/tutors", { body: { name, email, trackIds: picked } });
      setNotice(r.emailSent ? { tone: "success", text: `Invitation sent to ${email}.` } : { tone: "warn", text: "Tutor created, but the email failed. Use Resend invite." });
      close(); await list.reload();
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Tutors" lead="Tutors only see the tracks you assign. Removing a tutor keeps their classes and all student results.">
        <Button onClick={() => open("invite")}>Invite tutor</Button>
      </PageHeader>
      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      {list.loading ? <Loading /> : list.error ? <Alert>{list.error}</Alert> : list.data!.tutors.length === 0 ? (
        <Empty title="No tutors yet">Invite a tutor and choose the tracks they teach.</Empty>
      ) : (
        <Table head={["Tutor", "Tracks", "Classes", "Status", "Actions"]} caption="Tutors">
          {list.data!.tutors.map((t) => (
            <tr key={t.id}>
              <Td><strong>{t.name}</strong><div className="text-muted">{t.email}</div></Td>
              <Td>{t.tracks.length ? t.tracks.map((x) => x.name).join(", ") : "None"}</Td>
              <Td>{t.classCount}</Td>
              <Td><Badge tone={TONE[t.status]}>{t.status === "INVITED" ? "Awaiting activation" : t.status === "ACTIVE" ? "Active" : "Removed"}</Badge></Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {t.status !== "DEACTIVATED" && <Button variant="quiet" onClick={() => open("tracks", t)} aria-label={`Change tracks for ${t.name}`}>Change tracks</Button>}
                  {t.status === "INVITED" && <Button variant="quiet" aria-label={`Resend invite to ${t.name}`} onClick={async () => { try { await api(`/api/admin/users/${t.id}/resend-invite`, { body: {} }); setNotice({ tone: "success", text: `New invitation sent to ${t.email}.` }); } catch (e) { setNotice({ tone: "error", text: errMsg(e) }); } }}>Resend invite</Button>}
                  <Button variant="quiet" onClick={() => open("email", t)} aria-label={`Correct email for ${t.name}`}>Correct email</Button>
                  {t.status === "DEACTIVATED" ? (
                    <Button variant="quiet" aria-label={`Reactivate ${t.name}`} onClick={async () => { await api(`/api/admin/users/${t.id}/reactivate`, { body: {} }); await list.reload(); setNotice({ tone: "success", text: "Reactivated. Assign tracks so they can see classes." }); }}>Reactivate</Button>
                  ) : (
                    <Button variant="quiet" onClick={() => open("remove", t)} aria-label={`Remove ${t.name}`}>Remove</Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <Modal open={modal === "invite"} title="Invite tutor" onClose={close}>
        <form onSubmit={invite} className="space-y-4" noValidate>
          {err && <Alert>{err}</Alert>}
          <TextField label="Full name" value={name} error={fields.name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Email address" type="email" value={email} error={fields.email} onChange={(e) => setEmail(e.target.value)} />
          {trackPicker}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={close}>Cancel</Button><Button type="submit" loading={busy}>Send invitation</Button></div>
        </form>
      </Modal>

      <Modal open={modal === "tracks"} title={`Tracks for ${target?.name ?? ""}`} onClose={close}>
        <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/admin/tutors/${target!.id}/tracks`, { method: "PUT", body: { trackIds: picked } }); setNotice({ tone: "success", text: "Tracks updated." }); close(); await list.reload(); }); }} className="space-y-4">
          {err && <Alert>{err}</Alert>}
          {trackPicker}
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={close}>Cancel</Button><Button type="submit" loading={busy}>Save tracks</Button></div>
        </form>
      </Modal>

      <Modal open={modal === "email"} title={`Correct email for ${target?.name ?? ""}`} onClose={close}>
        <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await api(`/api/admin/users/${target!.id}/email`, { method: "PATCH", body: { email } }); setNotice({ tone: "success", text: "Email updated." }); close(); await list.reload(); }); }} className="space-y-4" noValidate>
          {err && <Alert>{err}</Alert>}
          <TextField label="New email address" type="email" value={email} error={fields.email} onChange={(e) => setEmail(e.target.value)} />
          <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={close}>Cancel</Button><Button type="submit" loading={busy}>Update email</Button></div>
        </form>
      </Modal>

      <ConfirmModal open={modal === "remove"} title={`Remove ${target?.name ?? ""}?`} body={<p>They lose access immediately. Their published classes, quiz links and every student result stay exactly as they are.</p>} confirmLabel="Remove tutor" danger busy={busy} error={err ?? undefined}
        onConfirm={() => run(async () => { await api(`/api/admin/tutors/${target!.id}`, { method: "DELETE" }); setNotice({ tone: "success", text: "Tutor removed. Their classes and results are preserved." }); close(); await list.reload(); })} onClose={close} />
    </div>
  );
}
