"use client";

import { useMemo, useState } from "react";
import { Alert, Badge, Button, ConfirmModal, Empty, Loading, PageHeader, SelectField, Table, Td } from "@/components/ui";
import { api, errMsg, fmtDate } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

type Kind = "PARTICIPATION" | "COMPLETION";
interface Row {
  eligibilityId: string; kind: Kind; studentCode: string; name: string; track: string; userId: string; trackId: string; eligibleAt: string;
  unlocked: boolean; unlockedAt: string | null; status: string; verificationRef: string | null; issuedAt: string | null; attempts: number; lastError: string | null;
}

const kindLabel = (k: Kind) => (k === "PARTICIPATION" ? "Participation" : "Completion");
const ref = (r: Row) => ({ userId: r.userId, trackId: r.trackId, kind: r.kind });

export default function Page() {
  const { data, error, loading, reload } = useLoad<{ certificates: Row[] }>("/api/admin/certificates");
  const [kind, setKind] = useState<"" | Kind>("");
  const [show, setShow] = useState<"" | "locked" | "unlocked" | "failed">("locked");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [relock, setRelock] = useState<Row | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const rows = useMemo(
    () =>
      (data?.certificates ?? []).filter(
        (r) =>
          (!kind || r.kind === kind) &&
          (show === "" || (show === "locked" && !r.unlocked) || (show === "unlocked" && r.unlocked) || (show === "failed" && r.unlocked && r.status !== "ISSUED")),
      ),
    [data, kind, show],
  );
  const lockedRows = rows.filter((r) => !r.unlocked);
  const selected = lockedRows.filter((r) => picked.has(r.eligibilityId));

  async function run<T>(key: string, work: () => Promise<T>, done: (r: T) => string) {
    setBusy(key);
    setMsg(null);
    try {
      setMsg({ tone: "success", text: done(await work()) });
      setPicked(new Set());
    } catch (e) {
      setMsg({ tone: "error", text: errMsg(e) });
    }
    setBusy(null);
    await reload();
  }

  const unlock = (items: Row[]) =>
    run(
      items.length === 1 ? items[0]!.eligibilityId : "bulk",
      () => api<{ results: { ok: boolean; status: string; name?: string }[] }>("/api/admin/certificates/unlock", { body: { items: items.map(ref) } }),
      (r) => {
        const failed = r.results.filter((x) => !x.ok).length;
        const ok = r.results.length - failed;
        return failed ? `Unlocked ${ok}. ${failed} could not be generated yet: use Retry on those rows.` : `Unlocked ${ok} certificate${ok === 1 ? "" : "s"}. Students can download them now.`;
      },
    );

  const retry = (r: Row) => run(r.eligibilityId, () => api("/api/admin/certificates/retry", { body: ref(r) }), () => `Certificate issued for ${r.name}.`);

  if (loading) return <Loading />;
  if (error || !data) return <Alert>{error ?? "Certificates unavailable."}</Alert>;
  const allPicked = lockedRows.length > 0 && selected.length === lockedRows.length;

  return (
    <div className="space-y-6">
      <PageHeader title="Certificates" lead="Students become eligible for a participation certificate when they pay for a course, and for a completion certificate when they pass every class. Nobody can download until you unlock it." />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <div className="flex flex-wrap items-end gap-4">
        <SelectField label="Certificate" value={kind} onChange={(e) => setKind(e.target.value as "" | Kind)}>
          <option value="">All kinds</option>
          <option value="PARTICIPATION">Participation</option>
          <option value="COMPLETION">Completion</option>
        </SelectField>
        <SelectField label="Show" value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
          <option value="locked">Waiting to be unlocked</option>
          <option value="unlocked">Unlocked</option>
          <option value="failed">Unlocked, PDF failed</option>
          <option value="">Everything</option>
        </SelectField>
        {lockedRows.length > 0 && (
          <Button loading={busy === "bulk"} disabled={selected.length === 0} onClick={() => unlock(selected)}>
            Unlock selected ({selected.length})
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <Empty title={show === "locked" ? "Nothing is waiting to be unlocked" : "No certificates match"} />
      ) : (
        <Table head={["Select", "Student ID", "Name", "Certificate", "Course", "Eligible since", "Status", "Reference", "Action"]} caption="Certificates">
          {rows.map((r) => (
            <tr key={r.eligibilityId}>
              <Td>
                {!r.unlocked && (
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-accent-bright"
                    aria-label={`Select ${kindLabel(r.kind)} certificate for ${r.name}`}
                    checked={picked.has(r.eligibilityId)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(r.eligibilityId);
                      else next.delete(r.eligibilityId);
                      setPicked(next);
                    }}
                  />
                )}
              </Td>
              <Td>{r.studentCode}</Td>
              <Td>{r.name}</Td>
              <Td>{kindLabel(r.kind)}</Td>
              <Td>{r.track}</Td>
              <Td>{fmtDate(r.eligibleAt, false)}</Td>
              <Td>
                {!r.unlocked ? (
                  <Badge tone="warn">Locked</Badge>
                ) : r.status === "ISSUED" ? (
                  <Badge tone="ok">Unlocked</Badge>
                ) : (
                  <Badge tone="bad">PDF failed</Badge>
                )}
                {r.unlocked && r.unlockedAt && <div className="mt-1 text-xs text-muted">{fmtDate(r.unlockedAt, false)}</div>}
                {r.lastError && r.status !== "ISSUED" && <div className="mt-1 text-xs text-danger">{r.lastError}</div>}
              </Td>
              <Td>{r.verificationRef ?? "—"}</Td>
              <Td>
                <div className="flex flex-wrap gap-2">
                  {!r.unlocked && (
                    <Button loading={busy === r.eligibilityId} onClick={() => unlock([r])} aria-label={`Unlock ${kindLabel(r.kind)} certificate for ${r.name}`}>
                      Unlock
                    </Button>
                  )}
                  {r.unlocked && r.status !== "ISSUED" && (
                    <Button variant="secondary" loading={busy === r.eligibilityId} onClick={() => retry(r)} aria-label={`Retry certificate for ${r.name}`}>
                      Retry
                    </Button>
                  )}
                  {r.unlocked && (
                    <Button variant="secondary" onClick={() => setRelock(r)} aria-label={`Lock ${kindLabel(r.kind)} certificate for ${r.name}`}>
                      Lock
                    </Button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {lockedRows.length > 1 && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5 accent-accent-bright"
            checked={allPicked}
            onChange={(e) => setPicked(e.target.checked ? new Set(lockedRows.map((r) => r.eligibilityId)) : new Set())}
          />
          Select all {lockedRows.length} locked certificates shown
        </label>
      )}

      <ConfirmModal
        open={relock !== null}
        title="Lock this certificate?"
        body={relock && <>{relock.name} will no longer be able to download their {kindLabel(relock.kind).toLowerCase()} certificate, and its verification page will stop confirming it. You can unlock it again later.</>}
        confirmLabel="Lock certificate"
        danger
        busy={relock !== null && busy === relock.eligibilityId}
        onClose={() => setRelock(null)}
        onConfirm={async () => {
          const r = relock!;
          setRelock(null);
          await run(r.eligibilityId, () => api("/api/admin/certificates/lock", { body: ref(r) }), () => `Locked the ${kindLabel(r.kind).toLowerCase()} certificate for ${r.name}.`);
        }}
      />
    </div>
  );
}
