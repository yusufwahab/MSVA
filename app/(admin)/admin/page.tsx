"use client";

import Link from "next/link";
import { Alert, Card, Loading, PageHeader } from "@/components/ui";
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
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(([k, v, href]) => (
          <Card key={k}>
            <dt className="text-sm font-semibold text-muted">{k}</dt>
            <dd className="font-serif text-4xl">{v}</dd>
            <Link href={href} className="inline-block min-h-11 py-2.5 text-sm font-semibold text-navy underline underline-offset-4">View</Link>
          </Card>
        ))}
      </dl>
    </div>
  );
}
