import type { Config } from "../lib/config.js";
import type { Db } from "../lib/db.js";
import { hashPassword, verifyPassword } from "../lib/security.js";

/**
 * Keeps one admin account in step with ADMIN_EMAIL / ADMIN_PASSWORD (and optionally ADMIN_NAME).
 * Change the values, restart the server, and the sign-in changes. Changing the email or password signs that admin
 * out everywhere. Other admins are never touched. Does nothing when the variables are not set.
 */
export async function syncEnvAdmin(db: Db, config: Config): Promise<"unchanged" | "created" | "updated"> {
  if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) return "unchanged";
  const email = config.ADMIN_EMAIL.trim().toLowerCase();
  const name = config.ADMIN_NAME.trim();

  const managed = await db.user.findFirst({ where: { role: "ADMIN", envManaged: true } });
  const holder = await db.user.findUnique({ where: { email } });
  if (holder && holder.id !== managed?.id) {
    if (holder.role !== "ADMIN") throw new Error(`ADMIN_EMAIL ${email} already belongs to a non-admin account.`);
    if (managed) throw new Error(`ADMIN_EMAIL ${email} already belongs to a different admin account.`);
  }
  const target = managed ?? holder;

  if (!target) {
    await db.user.create({
      data: {
        email,
        name: name || "Administrator",
        role: "ADMIN",
        status: "ACTIVE",
        envManaged: true,
        passwordHash: await hashPassword(config.ADMIN_PASSWORD),
        activatedAt: new Date(),
      },
    });
    return "created";
  }

  const samePassword = await verifyPassword(config.ADMIN_PASSWORD, target.passwordHash);
  const credentialsChanged = target.email !== email || !samePassword;
  const nameChanged = name !== "" && target.name !== name;
  if (!credentialsChanged && !nameChanged && target.envManaged && target.status === "ACTIVE") return "unchanged";

  await db.user.update({
    where: { id: target.id },
    data: {
      email,
      ...(name ? { name } : {}),
      status: "ACTIVE",
      envManaged: true,
      activatedAt: target.activatedAt ?? new Date(),
      ...(samePassword ? {} : { passwordHash: await hashPassword(config.ADMIN_PASSWORD) }),
    },
  });
  if (credentialsChanged) await db.session.deleteMany({ where: { userId: target.id } });
  return "updated";
}
