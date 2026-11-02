"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, ConfirmModal, Loading, PageHeader, TextArea, TextField, buttonClass } from "@/components/ui";
import { api, ApiError, errMsg, fmtDate, toLocalInput } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface ClassDetail {
  id: string; title: string; description: string; status: "DRAFT" | "PUBLISHED"; state: string; releaseAt: string | null;
  youtubeUrl: string; youtubeId: string; quizId: string; quizTitle: string; multiplayerUrl: string;
  track: { name: string }; cohort: { name: string }; module: { title: string };
}
interface Overview { quizAuthoringUrl: string | null; watchThreshold: number }

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const cls = useLoad<{ class: ClassDetail }>(`/api/tutor/classes/${id}`);
  const overview = useLoad<Overview>("/api/tutor/overview");

  const [form, setForm] = useState({ title: "", description: "", releaseAt: "", youtubeUrl: "", quizId: "", multiplayerUrl: "" });
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"publish" | "unpublish" | "delete" | null>(null);
  const [quizCheck, setQuizCheck] = useState<{ valid: boolean; message?: string; title?: string; quizId?: string } | null>(null);

  useEffect(() => {
    const c = cls.data?.class;
    if (!c || loaded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm({ title: c.title, description: c.description, releaseAt: toLocalInput(c.releaseAt), youtubeUrl: c.youtubeUrl, quizId: c.quizId, multiplayerUrl: c.multiplayerUrl });
    setLoaded(true);
  }, [cls.data, loaded]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setDirty(true);
    setMsg(null);
    if (k === "quizId" || k === "multiplayerUrl") setQuizCheck(null);
  };

  async function save(): Promise<boolean> {
    setFieldErr({});
    setMsg(null);
    try {
      await api(`/api/tutor/classes/${id}`, {
        method: "PATCH",
        body: { ...form, releaseAt: form.releaseAt ? new Date(form.releaseAt).toISOString() : null },
      });
      setDirty(false);
      await cls.reload();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFieldErr(e.fields);
      setMsg({ tone: "error", text: errMsg(e) });
      return false;
    }
  }

  async function onSave(e?: FormEvent) {
    e?.preventDefault();
    setBusy("save");
    if (await save()) setMsg({ tone: "success", text: "Saved." });
    setBusy(null);
  }

  async function createInClueQuest() {
    const url = overview.data?.quizAuthoringUrl;
    if (!url) return;
    setBusy("authoring");
    // Keep the draft safe before the tutor leaves for ClueQuest; they return to this same tab.
    const ok = dirty ? await save() : true;
    setBusy(null);
    if (!ok) return;
    window.open(url, "_blank", "noopener,noreferrer");
    setMsg({ tone: "info", text: "ClueQuest opened in a new tab. Create and publish the quiz there, tick “Let connected learning platforms assign this quiz” on its Use page, then paste the quiz ID into the field below." });
  }

  async function checkQuiz() {
    if (!form.quizId.trim()) return setQuizCheck({ valid: false, message: "Enter the quiz ID first." });
    setBusy("check");
    try {
      setQuizCheck(await api("/api/tutor/quiz/validate", { body: { quiz: form.quizId } }));
    } catch (e) {
      setQuizCheck({ valid: false, message: errMsg(e) });
    }
    setBusy(null);
  }

  async function act(kind: "publish" | "unpublish" | "delete") {
    setBusy(kind);
    try {
      if (dirty && kind !== "delete" && !(await save())) {
        setConfirm(null);
        setBusy(null);
        return;
      }
      if (kind === "delete") {
        await api(`/api/tutor/classes/${id}`, { method: "DELETE" });
        setDirty(false);
        router.replace("/tutor");
        return;
      }
      await api(`/api/tutor/classes/${id}/${kind}`, { body: {} });
      await cls.reload();
      setMsg({ tone: "success", text: kind === "publish" ? "Published. Students in this cohort will see it from the release time." : "Moved back to draft." });
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFieldErr(e.fields);
      setMsg({ tone: "error", text: errMsg(e) });
    }
    setConfirm(null);
    setBusy(null);
  }

  if (cls.loading || overview.loading) return <Loading />;
  if (cls.error || !cls.data) return <Alert>{cls.error ?? "Class not found."}</Alert>;
  const c = cls.data.class;
  const published = c.status === "PUBLISHED";
  const attached = !dirty && c.quizId ? c : null;
  const checks: [boolean, string][] = [
    [Boolean(form.title.trim()), "Title"],
    [Boolean(form.releaseAt), "Release date and time"],
    [Boolean(form.youtubeUrl.trim()), "YouTube video"],
    [Boolean(form.quizId.trim()), "ClueQuest quiz"],
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={c.title || "Untitled class"} lead={`${c.track.name} · ${c.cohort.name} · ${c.module.title}`}>
        <Badge tone={published ? "ok" : "neutral"}>{c.state}</Badge>
      </PageHeader>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <form id="class-form" onSubmit={onSave} className="space-y-6" noValidate>
        <Card className="space-y-5">
          <TextField label="Class title" value={form.title} error={fieldErr.title} onChange={set("title")} maxLength={150} />
          <TextArea label="Description" value={form.description} error={fieldErr.description} onChange={set("description")} hint="Shown to students beneath the video." />
          <TextField label="Release date and time" type="datetime-local" value={form.releaseAt} error={fieldErr.releaseAt} onChange={set("releaseAt")} hint="Students see the class only from this moment, in your local time." />
        </Card>

        <Card className="space-y-5">
          <h2 className="text-xl">Video</h2>
          <TextField label="YouTube video link" type="url" inputMode="url" value={form.youtubeUrl} error={fieldErr.youtubeUrl} onChange={set("youtubeUrl")} placeholder="https://www.youtube.com/watch?v=…" hint="Required to publish." />
        </Card>

        <Card className="space-y-5">
          <h2 className="text-xl">Individual quiz</h2>
          <p className="text-muted">Every class needs its own individual ClueQuest quiz. Students take it after the video, and the result returns here automatically.</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <TextField label="ClueQuest quiz ID" autoComplete="off" spellCheck={false} value={form.quizId} error={fieldErr.quizId} onChange={set("quizId")} hint="Required to publish. Copy the quiz ID from the quiz’s Use page in ClueQuest. The quiz must be published and shared with learning platforms." />
            </div>
            <Button type="button" variant="secondary" onClick={createInClueQuest} loading={busy === "authoring"} disabled={!overview.data?.quizAuthoringUrl}>Create quiz in ClueQuest</Button>
          </div>
          {!overview.data?.quizAuthoringUrl && <p className="text-sm text-muted">The ClueQuest authoring page has not been configured yet, so you can only enter an existing quiz ID.</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="quiet" onClick={checkQuiz} loading={busy === "check"}>Check quiz</Button>
            {quizCheck?.valid && <span className="font-semibold text-ok">Quiz found{quizCheck.title ? `: ${quizCheck.title}` : ""}</span>}
            {quizCheck && !quizCheck.valid && <span role="alert" className="font-semibold text-danger">{quizCheck.message}</span>}
          </div>
          <div data-testid="quiz-status" className="rounded-xl border border-line bg-surface-2 px-4 py-3">
            {attached ? <p><strong>Quiz attached:</strong> {attached.quizTitle || "Individual quiz"} <span className="break-all text-muted">({attached.quizId})</span></p> : <p className="text-muted">{form.quizId ? "Save to attach this quiz to the class." : "No quiz attached yet."}</p>}
          </div>
          <TextField label="Optional live game link" type="url" inputMode="url" value={form.multiplayerUrl} error={fieldErr.multiplayerUrl} onChange={set("multiplayerUrl")} hint="Students see a separate “Join live game” button. It never replaces the individual quiz." />
        </Card>
      </form>

      <aside className="space-y-4 lg:sticky lg:top-24">
        <Card>
          <h2 className="text-lg">Ready to publish?</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {checks.map(([ok, label]) => (
              <li key={label} className="flex items-center gap-3">
                <span aria-hidden="true" className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${ok ? "bg-accent-bright text-on-accent" : "border border-line-strong text-transparent"}`}>✓</span>
                <span className={ok ? "text-ink" : "text-muted"}>{label}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-col gap-2">
            <Button type="submit" form="class-form" loading={busy === "save"}>Save{published ? " changes" : " draft"}</Button>
            <Link href={`/tutor/classes/${id}/preview`} className={buttonClass("secondary")} onClick={(e) => { if (dirty && !confirmLeave()) e.preventDefault(); }}>Preview as student</Link>
            {!published && <Button type="button" variant="primary" onClick={() => setConfirm("publish")}>Publish</Button>}
            {published && <Button type="button" variant="secondary" onClick={() => setConfirm("unpublish")}>Move back to draft</Button>}
            {published && <Link href={`/tutor/classes/${id}/results`} className={buttonClass("secondary")}>View results</Link>}
            {!published && <Button type="button" variant="danger" onClick={() => setConfirm("delete")}>Delete draft</Button>}
          </div>
        </Card>
      </aside>
      </div>

      <ConfirmModal
        open={confirm === "publish"}
        title="Publish this class?"
        body={<p>{form.releaseAt ? `Students in ${c.cohort.name} will see it from ${fmtDate(new Date(form.releaseAt).toISOString())}.` : "Choose a release date first."} Both the video and the individual quiz are required.</p>}
        confirmLabel="Publish class"
        busy={busy === "publish"}
        onConfirm={() => act("publish")}
        onClose={() => setConfirm(null)}
      />
      <ConfirmModal open={confirm === "unpublish"} title="Move back to draft?" body={<p>Students will no longer see this class. This is only possible while no student has started it.</p>} confirmLabel="Move to draft" busy={busy === "unpublish"} onConfirm={() => act("unpublish")} onClose={() => setConfirm(null)} />
      <ConfirmModal open={confirm === "delete"} title="Delete this draft?" body={<p>This cannot be undone.</p>} confirmLabel="Delete draft" danger busy={busy === "delete"} onConfirm={() => act("delete")} onClose={() => setConfirm(null)} />
    </div>
  );
}

function confirmLeave() {
  return window.confirm("You have unsaved changes. Leave without saving?");
}
