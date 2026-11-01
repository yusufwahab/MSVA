/*
  Warnings:

  - You are about to drop the column `eligibleAt` on the `Certificate` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Certificate" DROP COLUMN "eligibleAt";

-- AlterTable
ALTER TABLE "QuizAttempt" ADD COLUMN     "returnedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CertificateEligibility" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "eligibleAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertificateEligibility_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CertificateEligibility_userId_trackId_key" ON "CertificateEligibility"("userId", "trackId");

-- AddForeignKey
ALTER TABLE "CertificateEligibility" ADD CONSTRAINT "CertificateEligibility_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateEligibility" ADD CONSTRAINT "CertificateEligibility_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
