"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, Loading, PageHeader, Table, Td, TextField } from "@/components/ui";
import { api, ApiError, errMsg, fmtDate } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface Links { communityUrl: string; whatsappUrl: string; websiteUrl: string }
interface Job { id: string; kind: string; status: string; attempts: number; lastError: string | null; createdAt: string }

export default function Page() {
  const settings = useLoad<{ links: Links }>("/api/admin/settings");
  const jobs = useLoad<{ enabled: boolean; jobs: Job[] }>("/api/admin/sync-jobs");
  const [form, setForm] = useState<Links>({ communityUrl: "", whatsappUrl: "", websiteUrl: "" });
  const [loaded, setLoaded] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data && !loaded) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(settings.data.links);
      setLoaded(true);
    }
  }, [settings.data, loaded]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy("save");
    setFields({});
    setMsg(null);
    try {
      await api("/api/admin/settings", { method: "PUT", body: form });
      setMsg({ tone: "success", text: "Links saved." });
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setMsg({ tone: "error", text: errMsg(err) });
    }
    setBusy(null);
  }

  async function runSync() {
    setBusy("sync");
    try {
      const r = await api<{ done: number; retried: number; failed: number }>("/api/admin/sync-jobs/run", { body: {} });
      setMsg({ tone: "success", text: `Sync run: ${r.done} sent, ${r.retried} will retry, ${r.failed} failed.` });
      await jobs.reload();
    } catch (e) {
      setMsg({ tone: "error", text: errMsg(e) });
    }
    setBusy(null);
  }

  if (settings.loading || jobs.loading) return <Loading />;
  if (settings.error) return <Alert>{settings.error}</Alert>;

  return (
    <div className="space-y-8">
      <PageHeader title="Settings and sync" />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <Card>
        <h2 className="text-2xl">Student links</h2>
        <p className="mt-1 text-muted">Shown on student dashboards and the public footer. Leave a field empty to hide that link.</p>
        <form onSubmit={save} className="mt-4 space-y-4" noValidate>
          <TextField label="Community link" type="url" value={form.communityUrl} error={fields.communityUrl} onChange={(e) => setForm({ ...form, communityUrl: e.target.value })} />
          <TextField label="WhatsApp support link" type="url" value={form.whatsappUrl} error={fields.whatsappUrl} onChange={(e) => setForm({ ...form, whatsappUrl: e.target.value })} />
          <TextField label="Academy website" type="url" value={form.websiteUrl} error={fields.websiteUrl} onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })} />
          <Button type="submit" loading={busy === "save"}>Save links</Button>
        </form>
      </Card>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl">Google Sheets sync</h2>
            <p className="text-muted">One-way: the database stays the source of truth. A Sheets outage never blocks onboarding or quizzes.</p>
          </div>
          <Button variant="secondary" onClick={runSync} loading={busy === "sync"} disabled={!jobs.data?.enabled}>Run sync now</Button>
        </div>
        {!jobs.data?.enabled && <Alert tone="info">Sheets sync is switched off on the server (SHEETS_ADAPTER=none). Nothing is queued.</Alert>}
        {jobs.data && jobs.data.jobs.length > 0 && (
          <Table head={["Type", "Status", "Attempts", "Last error", "Queued"]} caption="Sync jobs">
            {jobs.data.jobs.map((j) => (
              <tr key={j.id}><Td>{j.kind}</Td><Td><Badge tone={j.status === "DONE" ? "ok" : j.status === "FAILED" ? "bad" : "warn"}>{j.status}</Badge></Td><Td>{j.attempts}</Td><Td>{j.lastError ?? "—"}</Td><Td>{fmtDate(j.createdAt)}</Td></tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}
