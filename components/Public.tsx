"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { Logo, ThemeToggle } from "./Brand";
import { buttonClass } from "./styles";

const NAV = [
  { href: "/#how", label: "How it works" },
  { href: "/#features", label: "What you get" },
  { href: "/#invited", label: "Getting access" },
];

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-8 lg:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-[0.95rem] font-medium text-ink/90 hover:text-accent-ink">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle />
          <div className="hidden items-center gap-3 sm:flex">
            <Link href="/sign-in" className={buttonClass("secondary")}>
              Sign in
            </Link>
            <Link href="/activate" className={buttonClass("primary")}>
              Activate account <span aria-hidden="true">→</span>
            </Link>
          </div>
          <button
            type="button"
            className="inline-flex h-11 items-center rounded-full border border-line-strong px-4 text-sm font-semibold lg:hidden"
            aria-expanded={open}
            aria-controls="public-menu"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>
      {open && (
        <nav id="public-menu" aria-label="Menu" className="border-t border-line bg-canvas px-4 py-4 lg:hidden">
          <ul className="space-y-1">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link href={n.href} onClick={() => setOpen(false)} className="block rounded-xl px-3 py-3 font-medium hover:bg-surface-2">
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:hidden">
            <Link href="/sign-in" className={buttonClass("secondary")} onClick={() => setOpen(false)}>
              Sign in
            </Link>
            <Link href="/activate" className={buttonClass("primary")} onClick={() => setOpen(false)}>
              Activate account
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}

export function PublicFooter() {
  const [links, setLinks] = useState<{ communityUrl: string; whatsappUrl: string; websiteUrl: string } | null>(null);
  useEffect(() => {
    api<{ links: { communityUrl: string; whatsappUrl: string; websiteUrl: string } }>("/api/public/config")
      .then((r) => setLinks(r.links))
      .catch(() => undefined);
  }, []);
  const items = [
    { label: "Academy website", href: links?.websiteUrl },
    { label: "Community", href: links?.communityUrl },
    { label: "WhatsApp support", href: links?.whatsappUrl },
  ].filter((i) => i.href);
  return (
    <footer className="mt-auto border-t border-line bg-surface">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-10 sm:px-8 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <Logo />
          <p className="max-w-sm text-sm text-muted">MS Virtual Academy is an invite-only learning portal.</p>
        </div>
        {items.length > 0 && (
          <ul className="flex flex-wrap gap-x-6 gap-y-1">
            {items.map((i) => (
              <li key={i.label}>
                <a href={i.href} target="_blank" rel="noopener noreferrer" className="inline-block min-h-11 py-2.5 text-sm font-semibold text-accent-ink hover:underline">
                  {i.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </footer>
  );
}

/** The student photo from the landing hero. It was exported on pure black, so "lighten" blends it into the dark panel. */
export function HeroPhoto({ className = "", priority = false }: { className?: string; priority?: boolean }) {
  return (
    <Image
      src="/hero-student.webp"
      alt=""
      width={1400}
      height={1009}
      priority={priority}
      sizes="(min-width: 1024px) 46vw, 92vw"
      className={`h-auto w-full mix-blend-lighten ${className}`}
    />
  );
}

/** Split layout for sign-in, activation and reset: the form on one side, the brand panel on large screens. */
export function AuthPage({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto grid w-full max-w-7xl flex-1 gap-8 px-4 py-8 sm:px-8 sm:py-12 lg:grid-cols-2 lg:items-center lg:gap-14">
        <div className="mx-auto w-full max-w-md">
          <h1 className="text-3xl sm:text-4xl">{title}</h1>
          {lead && <p className="mt-2 text-muted">{lead}</p>}
          <div className="mt-7 rounded-[1.25rem] border border-line bg-surface p-5 shadow-card sm:p-7">{children}</div>
        </div>
        <aside aria-hidden="true" className="relative hidden overflow-hidden rounded-[2rem] border border-line bg-hero p-10 text-white lg:block">
          <p className="max-w-xs text-3xl font-extrabold leading-tight">
            Classes, quizzes and your certificate in <span className="text-accent-bright">one place.</span>
          </p>
          <HeroPhoto className="mt-6" />
        </aside>
      </main>
      <PublicFooter />
    </>
  );
}
