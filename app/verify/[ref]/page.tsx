"use client";

import { useParams } from "next/navigation";
import { AuthPage } from "@/components/Public";
import { Alert, Loading } from "@/components/ui";
import { fmtDate } from "@/lib/api";
import { useLoad } from "@/lib/useLoad";

export default function Page() {
  const { ref } = useParams<{ ref: string }>();
  const { data, error, loading } = useLoad<{ name: string; studentCode: string; track: string; issuedAt: string; reference: string }>(`/api/public/verify/${encodeURIComponent(ref)}`);
  return (
    <AuthPage title="Certificate verification">
      {loading && <Loading label="Checking the reference…" />}
      {!loading && error && <Alert>No issued certificate matches this reference. Check that it was copied exactly.</Alert>}
      {data && (
        <div className="space-y-4">
          <Alert tone="success" title="This certificate is genuine.">
            It was issued by MS Virtual Academy.
          </Alert>
          <dl className="space-y-2 border border-line bg-surface p-4">
            <div><dt className="text-sm font-semibold">Awarded to</dt><dd>{data.name}</dd></div>
            <div><dt className="text-sm font-semibold">Student ID</dt><dd>{data.studentCode}</dd></div>
            <div><dt className="text-sm font-semibold">Track</dt><dd>{data.track}</dd></div>
            <div><dt className="text-sm font-semibold">Issued</dt><dd>{fmtDate(data.issuedAt, false)}</dd></div>
            <div><dt className="text-sm font-semibold">Reference</dt><dd>{data.reference}</dd></div>
          </dl>
        </div>
      )}
    </AuthPage>
  );
}
