"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { Loading } from "./ui";

export type Role = "ADMIN" | "TUTOR" | "STUDENT";
export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
  studentCode: string | null;
}

export const HOME: Record<Role, string> = { ADMIN: "/admin", TUTOR: "/tutor", STUDENT: "/dashboard" };

const NAV: Record<Role, { href: string; label: string }[]> = {
  STUDENT: [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/progress", label: "Results and certificate" },
    { href: "/courses", label: "Premium courses" },
  ],
  TUTOR: [{ href: "/tutor", label: "My classes" }],
  ADMIN: [
    { href: "/admin", label: "Overview" },
    { href: "/admin/tracks", label: "Tracks and cohorts" },
    { href: "/admin/students", label: "Students" },
    { href: "/admin/tutors", label: "Tutors" },
    { href: "/admin/reports", label: "Reports" },
    { href: "/admin/certificates", label: "Certificates" },
    { href: "/admin/payments", label: "Payments" },
    { href: "/admin/settings", label: "Settings and sync" },
  ],
};

function AppShellInner({ role, children }: { role: Role; children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [menu, setMenu] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    api<{ user: Me }>("/api/auth/me")
      .then((r) => {
        if (r.user.role !== role) router.replace(HOME[r.user.role]);
        else setMe(r.user);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) router.replace(`/sign-in?next=${encodeURIComponent(path)}`);
      });
  }, [role, router, path]);

  async function signOut() {
    setSigningOut(true);
    await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
    router.replace("/");
  }

  if (!me) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4">
        <Loading label="Checking your session…" />
      </div>
    );
  }

  const items = NAV[role];
  const isActive = (href: string) => (href === HOME[role] ? path === href : path === href || path.startsWith(`${href}/`));

  return (
    <>
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href={HOME[role]} className="font-serif text-xl font-semibold text-navy">
            MS Virtual Academy
          </Link>
          <button
            type="button"
            className="min-h-11 border-2 border-navy px-4 text-sm font-semibold text-navy lg:hidden"
            aria-expanded={menu}
            aria-controls="main-nav"
            onClick={() => setMenu((v) => !v)}
          >
            {menu ? "Close menu" : "Menu"}
          </button>
          <nav id="main-nav" aria-label="Main" className={`${menu ? "flex" : "hidden"} absolute left-0 right-0 top-[4.25rem] z-20 flex-col gap-1 border-b border-line bg-card p-4 lg:static lg:flex lg:flex-row lg:items-center lg:border-0 lg:p-0`}>
            {items.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                aria-current={isActive(i.href) ? "page" : undefined}
                onClick={() => setMenu(false)}
                className={`min-h-11 px-3 py-2.5 text-[0.95rem] font-medium lg:py-2 ${isActive(i.href) ? "border-b-4 border-navy font-semibold text-navy" : "text-ink hover:bg-sand"}`}
              >
                {i.label}
              </Link>
            ))}
            <div className="mt-2 flex items-center gap-3 border-t border-line pt-3 lg:ml-3 lg:mt-0 lg:border-0 lg:pt-0">
              <span className="text-sm text-muted">
                {me.name}
                {me.studentCode ? ` · ${me.studentCode}` : ""}
              </span>
              <button type="button" onClick={signOut} disabled={signingOut} className="min-h-11 px-3 text-sm font-semibold text-navy underline underline-offset-4">
                Sign out
              </button>
            </div>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
    </>
  );
}

export function AppShell({ role, children }: { role: Role; children: ReactNode }) {
  return (
    <Suspense fallback={<Loading label="Loading…" />}>
      <AppShellInner role={role}>{children}</AppShellInner>
    </Suspense>
  );
}
