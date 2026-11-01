"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthPage } from "@/components/Public";
import { Alert, Button, TextField } from "@/components/ui";
import { api, errMsg } from "@/lib/api";

export default function Page() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/otp/request", { body: { email: email.trim(), purpose: "reset" } });
      // The reply is the same whether or not the address has an account, so the next step is always shown.
      router.push(`/reset-password?email=${encodeURIComponent(email.trim())}`);
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  return (
    <AuthPage title="Reset your password" lead="Enter the email address you use for the academy. We will email you a code.">
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && <Alert>{error}</Alert>}
        <TextField label="Email address" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button type="submit" loading={busy} className="w-full">
          Send code
        </Button>
      </form>
    </AuthPage>
  );
}
