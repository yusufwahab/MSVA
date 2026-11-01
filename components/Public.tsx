"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { buttonClass } from "./ui";

export function PublicHeader() {
  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <Link href="/" className="font-serif text-xl font-semibold text-navy sm:text-2xl">
          MS Virtual Academy
        </Link>
        <nav aria-label="Account" className="flex flex-wrap items-center gap-2">
          <Link href="/activate" className="min-h-11 px-3 py-2.5 text-[0.95rem] font-semibold text-navy underline underline-offset-4">
            Activate account
          </Link>
          <Link href="/sign-in" className={buttonClass("primary")}>
            Student sign in
          </Link>
        </nav>
      </div>
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
    <footer className="mt-auto border-t border-line bg-sand">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted">MS Virtual Academy is an invite-only learning portal.</p>
        {items.length > 0 && (
          <ul className="flex flex-wrap gap-x-5 gap-y-1">
            {items.map((i) => (
              <li key={i.label}>
                <a href={i.href} target="_blank" rel="noopener noreferrer" className="inline-block min-h-11 py-2.5 font-semibold text-navy underline underline-offset-4">
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

export function AuthPage({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <>
      <PublicHeader />
      <main id="main" className="mx-auto w-full max-w-md flex-1 px-4 py-10 sm:py-16">
        <h1 className="text-3xl sm:text-4xl">{title}</h1>
        {lead && <p className="mt-2 text-muted">{lead}</p>}
        <div className="mt-6">{children}</div>
      </main>
      <PublicFooter />
    </>
  );
}
