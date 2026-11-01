import { execSync } from "node:child_process";

/** Applies the versioned migrations to the dedicated test database before any test runs. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://msva:msva_dev_pw@localhost:54329/msva_test";
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
}
