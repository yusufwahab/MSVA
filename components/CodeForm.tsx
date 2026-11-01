"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AuthPage } from "@/components/Public";
import { Alert, Button, TextField, buttonClass } from "@/components/ui";
import { api, ApiError, errMsg } from "@/lib/api";

/**
 * Account activation and password reset share one flow: MSVA emails a one-time code (through Brevo),
 * and the code plus the new password go to /api/auth/verify-otp together.
 */
export function CodeForm({ purpose }: { purpose: "activate" | "reset" }) {
  const router = useRouter();
  const params = useSearchParams();
  const activate = purpose === "activate";
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [google, setGoogle] = useState(false);

  useEffect(() => {
    if (!activate) return;
    api<{ googleEnabled: boolean }>("/api/public/config")
      .then((c) => setGoogle(c.googleEnabled))
      .catch(() => undefined);
  }, [activate]);

  async function resend() {
    setError(null);
    setNotice(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setFieldErr({ email: "Enter your email address first" });
    setFieldErr({});
    setResending(true);
    try {
      await api("/api/auth/otp/request", { body: { email: email.trim(), purpose } });
      setNotice(
        activate
          ? "If that address has a pending invitation, a new code is on its way. Only the newest code works."
          : "If an active account uses that address, a new code is on its way. Only the newest code works.",
      );
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setResending(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const errs: Record<string, string> = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errs.email = "Enter the email address from your invitation";
    if (!/^\d{4,12}$/.test(code.trim())) errs.code = "Enter the code from the email";
    if (password.length < 10) errs.password = "Use at least 10 characters";
    if (confirm !== password) errs.confirm = "The passwords do not match";
    setFieldErr(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const r = await api<{ redirectTo?: string }>("/api/auth/verify-otp", { body: { email: email.trim(), code: code.trim(), purpose, password } });
      if (activate && r.redirectTo) router.replace(r.redirectTo);
      else setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "INVALID_CODE") setFieldErr({ code: err.message });
      else {
        if (err instanceof ApiError && err.fields) setFieldErr(err.fields);
        setError(errMsg(err));
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthPage title="Password changed">
        <div className="space-y-4">
          <Alert tone="success">Your password has been updated. You have been signed out everywhere else.</Alert>
          <Link href="/sign-in" className={buttonClass("primary")}>
            Sign in
          </Link>
        </div>
      </AuthPage>
    );
  }

  return (
    <AuthPage
      title={activate ? "Activate your account" : "Choose a new password"}
      lead={activate ? "Enter the email address from your invitation and the code we sent to it." : "Enter the code we emailed you and choose a new password."}
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error && <Alert>{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}
        <TextField label="Email address" type="email" autoComplete="email" value={email} error={fieldErr.email} onChange={(e) => setEmail(e.target.value)} />
        <div className="space-y-2">
          <TextField
            label="Code from the email"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={12}
            value={code}
            error={fieldErr.code}
            hint="Check your spam folder if you cannot see it. Only the newest code works."
            onChange={(e) => setCode(e.target.value)}
          />
          <Button type="button" variant="quiet" onClick={resend} loading={resending}>
            Send me a new code
          </Button>
        </div>
        <TextField label={activate ? "Choose a password" : "New password"} type="password" autoComplete="new-password" hint="At least 10 characters." value={password} error={fieldErr.password} onChange={(e) => setPassword(e.target.value)} />
        <TextField label="Confirm password" type="password" autoComplete="new-password" value={confirm} error={fieldErr.confirm} onChange={(e) => setConfirm(e.target.value)} />
        <Button type="submit" loading={busy} className="w-full">
          {activate ? "Activate and go to my dashboard" : "Change password"}
        </Button>
        {activate && google && (
          <>
            <a href="/api/auth/google/start" className={buttonClass("secondary", "w-full")}>
              Activate with Google
            </a>
            <p className="text-sm text-muted">Google sign-in only works with the email address on your invitation.</p>
          </>
        )}
        {activate && (
          <p className="text-sm text-muted">
            Already activated?{" "}
            <Link href="/sign-in" className="font-semibold text-navy underline underline-offset-4">
              Sign in
            </Link>
          </p>
        )}
      </form>
    </AuthPage>
  );
}
