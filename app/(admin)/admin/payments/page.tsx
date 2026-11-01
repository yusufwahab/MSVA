"use client";

import { Alert, Badge, Empty, Loading, PageHeader, Table, Td } from "@/components/ui";
import { fmtDate } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

interface P { id: string; reference: string; studentCode: string; name: string; course: string; amount: number; currency: string; status: string; paidAt: string | null; createdAt: string; note: string | null }

export default function Page() {
  const { data, error, loading } = useLoad<{ payments: P[] }>("/api/admin/payments");
  if (loading) return <Loading />;
  if (error || !data) return <Alert>{error ?? "Payments unavailable."}</Alert>;
  return (
    <div className="space-y-6">
      <PageHeader title="Payments" lead="Premium course purchases. Access is granted only after the payment is verified with Paystack." />
      {data.payments.length === 0 ? <Empty title="No payments yet" /> : (
        <Table head={["Reference", "Student", "Course", "Amount", "Status", "Date"]} caption="Payments">
          {data.payments.map((p) => (
            <tr key={p.id}>
              <Td>{p.reference}</Td><Td>{p.name}<div className="text-muted">{p.studentCode}</div></Td><Td>{p.course}</Td>
              <Td>{p.currency} {p.amount.toLocaleString()}</Td>
              <Td><Badge tone={p.status === "SUCCESS" ? "ok" : p.status === "FAILED" ? "bad" : "warn"}>{p.status}</Badge>{p.note && <div className="mt-1 text-xs text-muted">{p.note}</div>}</Td>
              <Td>{fmtDate(p.paidAt ?? p.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
