"use client";

import { useState } from "react";
import { api, errMsg } from "@/lib/api";
import { Alert, Button } from "./ui";

/** Sends the student straight to their individual quiz on ClueQuest in the same tab. */
export function LaunchButton({ classId, label, variant = "primary", endpoint }: { classId: string; label: string; variant?: "primary" | "secondary"; endpoint?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ launchUrl: string }>(endpoint ?? `/api/student/classes/${classId}/quiz/launch`, { body: {} });
      window.location.assign(r.launchUrl);
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button variant={variant} loading={busy} onClick={go}>
        {label}
      </Button>
      {error && <Alert>{error}</Alert>}
    </div>
  );
}
