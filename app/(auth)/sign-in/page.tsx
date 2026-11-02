"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { HOME, type Role } from "@/components/AppShell";
import { AuthPage } from "@/components/Public";
import { Alert, Button, TextField, buttonClass } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

const GOOGLE_ERRORS: Record<string, string> = {
  google_not_invited: "That Google account has not been invited. Use the email address the academy has on file.",
  google_unverified: "Google could not verify that email address.",
  inactive: "This account is not active. Contact the academy.",
  google_state: "The Google sign-in expired. Please try again.",
  google_failed: "Google sign-in did not complete. Please try again.",
};

function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [google, setGoogle] = useState(false);
  const oauthError = params.get("error");

  useEffect(() => {
    api<{ googleEnabled: boolean }>("/api/public/config").then((c) => setGoogle(c.googleEnabled)).catch(() => undefined);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: { role: Role } }>("/api/auth/login", { body: { email, password } });
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : HOME[r.user.role]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <AuthPage title="Student sign in" lead="Tutors and administrators sign in here too.">
      <form onSubmit={submit} className="space-y-5" noValidate>
        {oauthError && <Alert>{GOOGLE_ERRORS[oauthError] ?? "Sign-in did not complete."}</Alert>}
        {error && <Alert>{error}</Alert>}
        <TextField label="Email address" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextField label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" loading={busy} className="w-full">
          Sign in
        </Button>
        {google && (
          <a href="/api/auth/google/start" className={buttonClass("secondary", "w-full")}>
            Sign in with Google
          </a>
        )}
        <p className="text-sm">
          <Link href="/forgot-password" className="font-semibold text-accent-ink underline underline-offset-4">
            Forgot your password?
          </Link>
        </p>
        <p className="text-sm text-muted">
          First time here? Activate your account with the code in your invitation email, or{" "}
          <Link href="/activate" className="font-semibold text-accent-ink underline underline-offset-4">
            find out how to activate
          </Link>
          .
        </p>
      </form>
    </AuthPage>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
