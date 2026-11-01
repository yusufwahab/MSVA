/**
 * Secure first-admin setup.
 *   npm run setup:admin -- --email you@example.com --name "Your Name"
 * The password is read from the ADMIN_PASSWORD environment variable or typed at a hidden prompt.
 * It is never accepted as a command-line argument (which would land in shell history).
 * Refuses to run if an admin already exists, unless --additional is passed.
 */
import { createInterface } from "node:readline";
import { loadConfig } from "../lib/config.js";
import { createPrisma } from "../lib/db.js";
import { emailSchema, passwordSchema } from "../lib/http.js";
import { hashPassword } from "../lib/security.js";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const w = rl as unknown as { _writeToOutput: (s: string) => void };
    w._writeToOutput = (s: string) => {
      if (s.includes(question)) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const config = loadConfig();
  const db = createPrisma(config.DATABASE_URL);
  try {
    const email = emailSchema.parse(arg("email"));
    const name = (arg("name") ?? "").trim();
    if (name.length < 2) throw new Error("--name is required");
    const existing = await db.user.count({ where: { role: "ADMIN" } });
    if (existing > 0 && !process.argv.includes("--additional")) {
      throw new Error("An admin already exists. Pass --additional to create another one.");
    }
    const password = process.env.ADMIN_PASSWORD ?? (await askHidden("Admin password (min 10 characters): "));
    const pw = passwordSchema.parse(password);
    if (await db.user.findUnique({ where: { email } })) throw new Error("That email is already in use.");
    await db.user.create({
      data: { email, name, role: "ADMIN", status: "ACTIVE", passwordHash: await hashPassword(pw), activatedAt: new Date() },
    });
    console.log(`Admin ${email} created. Sign in at ${config.APP_URL}/sign-in`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
