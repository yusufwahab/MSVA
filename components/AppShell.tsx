"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { Logo, ThemeToggle } from "./Brand";
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

const ROLE_LABEL: Record<Role, string> = { ADMIN: "Administrator", TUTOR: "Tutor", STUDENT: "Student" };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

function UserChip({ me }: { me: Me }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-bright text-sm font-extrabold text-on-accent">
        {initials(me.name)}
      </span>
      <div className="min-w-0 text-left leading-tight">
        <p className="truncate text-sm font-semibold">{me.name}</p>
        <p className="truncate text-xs text-muted">{me.studentCode ? `${ROLE_LABEL[me.role]} · ${me.studentCode}` : ROLE_LABEL[me.role]}</p>
      </div>
    </div>
  );
}

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
  const sidebar = role === "ADMIN";

  const links = (vertical: boolean) =>
    items.map((i) => {
      const on = isActive(i.href);
      return (
        <Link
          key={i.href}
          href={i.href}
          aria-current={on ? "page" : undefined}
          onClick={() => setMenu(false)}
          className={
            vertical
              ? `flex min-h-11 items-center rounded-xl px-4 py-2.5 text-[0.95rem] font-medium ${on ? "bg-accent-soft font-semibold text-accent-ink" : "text-ink/85 hover:bg-surface-2"}`
              : `flex min-h-11 items-center rounded-full px-4 py-2 text-[0.95rem] font-medium ${on ? "bg-accent-soft font-semibold text-accent-ink" : "text-ink/85 hover:bg-surface-2"}`
          }
        >
          {i.label}
        </Link>
      );
    });

  const signOutButton = (
    <button type="button" onClick={signOut} disabled={signingOut} className="inline-flex min-h-11 items-center rounded-full border border-line-strong px-4 text-sm font-semibold hover:border-accent-bright hover:text-accent-ink">
      Sign out
    </button>
  );

  if (sidebar) {
    return (
      <div className="flex-1 lg:grid lg:grid-cols-[17rem_1fr]">
        <aside className="hidden border-r border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:p-5">
          <Logo href={HOME[role]} className="px-2 py-2" />
          <nav aria-label="Main" className="mt-8 flex flex-1 flex-col gap-1 overflow-y-auto">
            {links(true)}
          </nav>
          <div className="mt-4 space-y-4 border-t border-line pt-4">
            <UserChip me={me} />
            <div className="flex items-center gap-2">
              {signOutButton}
              <ThemeToggle />
            </div>
          </div>
        </aside>
        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-canvas/95 px-4 py-3 backdrop-blur lg:hidden">
            <Logo href={HOME[role]} />
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <button type="button" className="inline-flex h-11 items-center rounded-full border border-line-strong px-4 text-sm font-semibold" aria-expanded={menu} aria-controls="main-nav" onClick={() => setMenu((v) => !v)}>
                {menu ? "Close menu" : "Menu"}
              </button>
            </div>
          </header>
          {menu && (
            <nav id="main-nav" aria-label="Main" className="space-y-1 border-b border-line bg-surface p-4 lg:hidden">
              {links(true)}
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
                <UserChip me={me} />
                {signOutButton}
              </div>
            </nav>
          )}
          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-8 sm:py-10">
            {children}
          </main>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-8">
          <Logo href={HOME[role]} />
          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {links(false)}
          </nav>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="hidden xl:block">
              <UserChip me={me} />
            </div>
            <ThemeToggle />
            <span className="hidden lg:inline-flex">{signOutButton}</span>
            <button type="button" className="inline-flex h-11 items-center rounded-full border border-line-strong px-4 text-sm font-semibold lg:hidden" aria-expanded={menu} aria-controls="main-nav" onClick={() => setMenu((v) => !v)}>
              {menu ? "Close menu" : "Menu"}
            </button>
          </div>
        </div>
        {menu && (
          <nav id="main-nav" aria-label="Main" className="space-y-1 border-t border-line bg-surface p-4 lg:hidden">
            {links(true)}
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
              <UserChip me={me} />
              {signOutButton}
            </div>
          </nav>
        )}
      </header>
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-8 sm:py-10">
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
