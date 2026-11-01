-- Quiz provider is now ClueQuest: quizzes are identified by id, results carry ClueQuest's attempt id,
-- and MSVA (not the provider) owns the retake rule.
ALTER TABLE "Class" RENAME COLUMN "quizUrl" TO "quizId";
ALTER TABLE "QuizAttempt" RENAME COLUMN "quizUrl" TO "quizId";
ALTER TABLE "QuizAttempt" RENAME COLUMN "elimAttemptId" TO "providerAttemptId";
ALTER INDEX "QuizAttempt_elimAttemptId_key" RENAME TO "QuizAttempt_providerAttemptId_key";
ALTER TABLE "QuizAttempt" DROP COLUMN "retakeAllowed";

-- Invitation and reset links are replaced by one-time codes sent by Supabase Auth.
DROP TABLE "AuthToken";
DROP TYPE "TokenType";

-- Used only by the local test mailer; Supabase Auth stores its own codes.
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OtpCode_email_idx" ON "OtpCode"("email");
