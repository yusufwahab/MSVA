"use client";

import Link from "next/link";
import { Alert, Loading, PageHeader } from "@/components/ui";
import { useLoad } from "@/lib/useLoad";

interface Overview {
  students: number; activeStudents: number; invited: number; tutors: number; tracks: number; published: number;
  passedAttempts: number; certs: number; pendingJobs: number; failedJobs: number; failedCerts: number;
}

export default function Page() {
  const { data, error, loading } = useLoad<Overview>("/api/admin/overview");
  if (loading) return <Loading />;
  if (error || !data) return <Alert>{error ?? "Overview unavailable."}</Alert>;
  const stats: [string, number, string][] = [
    ["Active students", data.activeStudents, "/admin/students"],
    ["Awaiting activation", data.invited, "/admin/students"],
    ["Tutors", data.tutors, "/admin/tutors"],
    ["Tracks", data.tracks, "/admin/tracks"],
    ["Published classes", data.published, "/admin/reports"],
    ["Quizzes passed", data.passedAttempts, "/admin/reports"],
    ["Certificates issued", data.certs, "/admin/certificates"],
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Academy overview" lead="Where things stand right now." />
      {(data.failedCerts > 0 || data.failedJobs > 0) && (
        <Alert tone="warn" title="Needs attention">
          {data.failedCerts > 0 && <p>{data.failedCerts} certificate(s) failed to generate. <Link className="font-semibold underline" href="/admin/certificates">Retry them</Link>.</p>}
          {data.failedJobs > 0 && <p>{data.failedJobs} Google Sheets sync job(s) failed. <Link className="font-semibold underline" href="/admin/settings">Review sync</Link>.</p>}
        </Alert>
      )}
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(([k, v, href], i) => (
          <div key={k} className={`flex flex-col justify-between rounded-[1.25rem] border p-6 shadow-card ${i === 0 ? "border-accent/50 bg-accent-soft sm:col-span-2" : "border-line bg-surface"}`}>
            <div>
              <dt className="text-sm font-semibold text-muted">{k}</dt>
              <dd className={`mt-1 font-extrabold tracking-tight ${i === 0 ? "text-6xl" : "text-4xl"}`}>{v}</dd>
            </div>
            <Link href={href} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-accent-ink underline-offset-4 hover:underline">View details →</Link>
          </div>
        ))}
      </dl>
    </div>
  );
}
