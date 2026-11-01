"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Alert, Loading, PageHeader, buttonClass } from "@/components/ui";
import { api, errMsg } from "@/lib/api";

function Callback() {
  const params = useSearchParams();
  const reference = params.get("reference") ?? params.get("trxref");
  const [status, setStatus] = useState<"checking" | "SUCCESS" | "PENDING" | "FAILED" | "error">(reference ? "checking" : "error");
  const [msg, setMsg] = useState(reference ? "" : "No payment reference was provided.");

  useEffect(() => {
    if (!reference) return;
    let tries = 0;
    const check = () =>
      api<{ status: "SUCCESS" | "PENDING" | "FAILED" }>("/api/student/payments/verify", { body: { reference } })
        .then((r) => {
          setStatus(r.status);
          if (r.status === "PENDING" && ++tries < 5) setTimeout(check, 3000);
        })
        .catch((e) => {
          setStatus("error");
          setMsg(errMsg(e));
        });
    void check();
  }, [reference]);

  return (
    <div className="space-y-4">
      <PageHeader title="Payment" />
      {status === "checking" && <Loading label="Confirming your payment with Paystack…" />}
      {status === "SUCCESS" && <Alert tone="success" title="Payment confirmed">Your course is now unlocked.</Alert>}
      {status === "PENDING" && <Alert tone="warn" title="Still confirming">We have not received confirmation yet. Your course unlocks automatically when it arrives.</Alert>}
      {status === "FAILED" && <Alert title="Payment not confirmed">The payment was not successful, or its details did not match what we expected, so access was not unlocked. If you were charged, contact the academy with your payment reference.</Alert>}
      {status === "error" && <Alert>{msg}</Alert>}
      <Link href="/dashboard" className={buttonClass("primary")}>Go to dashboard</Link>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <Callback />
    </Suspense>
  );
}
