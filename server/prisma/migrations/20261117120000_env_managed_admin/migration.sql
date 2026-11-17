-- Marks the admin whose email and password are kept in step with ADMIN_EMAIL / ADMIN_PASSWORD.
ALTER TABLE "User" ADD COLUMN "envManaged" BOOLEAN NOT NULL DEFAULT false;
