-- Two certificate kinds (participation, completion) and an admin unlock step before students can download.
CREATE TYPE "CertificateKind" AS ENUM ('PARTICIPATION', 'COMPLETION');

ALTER TABLE "CertificateEligibility"
  ADD COLUMN "kind" "CertificateKind" NOT NULL DEFAULT 'COMPLETION',
  ADD COLUMN "unlockedAt" TIMESTAMP(3),
  ADD COLUMN "unlockedById" TEXT;
ALTER TABLE "Certificate" ADD COLUMN "kind" "CertificateKind" NOT NULL DEFAULT 'COMPLETION';

DROP INDEX "CertificateEligibility_userId_trackId_key";
CREATE UNIQUE INDEX "CertificateEligibility_userId_trackId_kind_key" ON "CertificateEligibility"("userId", "trackId", "kind");
DROP INDEX "Certificate_userId_trackId_key";
CREATE UNIQUE INDEX "Certificate_userId_trackId_kind_key" ON "Certificate"("userId", "trackId", "kind");

-- Certificates that students could already download stay downloadable.
UPDATE "CertificateEligibility" e SET "unlockedAt" = now()
WHERE EXISTS (
  SELECT 1 FROM "Certificate" c
  WHERE c."userId" = e."userId" AND c."trackId" = e."trackId" AND c."status" = 'ISSUED'
);

-- Students who have already paid become eligible for a participation certificate (locked until an admin unlocks it).
INSERT INTO "CertificateEligibility" ("id", "userId", "trackId", "kind", "eligibleAt")
SELECT gen_random_uuid()::text, "userId", "trackId", 'PARTICIPATION', "createdAt" FROM "Entitlement"
ON CONFLICT DO NOTHING;
