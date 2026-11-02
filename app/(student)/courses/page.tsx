"use client";

import { useState } from "react";
import { Alert, Badge, Button, Card, Empty, Loading, PageHeader } from "@/components/ui";
import { api, errMsg } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface Course { id: string; name: string; description: string; price: number; currency: string; owned: boolean; pending: boolean }

export default function Page() {
  const { data, error, loading } = useLoad<{ courses: Course[] }>("/api/student/courses");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function buy(id: string) {
    setBusy(id);
    setErr(null);
    try {
      const r = await api<{ authorizationUrl: string; reference: string }>(`/api/student/courses/${id}/checkout`, { body: {} });
      window.location.assign(r.authorizationUrl);
    } catch (e) {
      setErr(errMsg(e));
      setBusy(null);
    }
  }

  if (loading) return <Loading />;
  if (error || !data) return <Alert>{error ?? "Courses could not be loaded."}</Alert>;
  const money = (c: Course) => new Intl.NumberFormat("en-NG", { style: "currency", currency: c.currency, maximumFractionDigits: 0 }).format(c.price);

  return (
    <div className="space-y-6">
      <PageHeader title="Premium courses" lead="Optional courses you can add to your studies. Access unlocks after your payment is confirmed." />
      {err && <Alert>{err}</Alert>}
      {data.courses.length === 0 ? (
        <Empty title="No premium courses are available right now" />
      ) : (
        <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {data.courses.map((c) => (
            <li key={c.id}>
              <Card className="flex h-full flex-col">
                <h2 className="text-2xl">{c.name}</h2>
                <p className="mt-2 text-muted">{c.description || "A premium course from the academy."}</p>
                <p className="mt-4 text-3xl font-extrabold text-accent-ink">{money(c)}</p>
                <div className="mt-auto pt-5">
                  {c.owned ? <Badge tone="ok">You have access</Badge> : <Button loading={busy === c.id} onClick={() => buy(c.id)}>{c.pending ? "Continue payment" : "Buy access"}</Button>}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted">Payments are processed by Paystack. The academy never sees your card details.</p>
    </div>
  );
}
