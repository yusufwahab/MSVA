import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";
if (existsSync(".env")) process.loadEnvFile(".env");


export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // DIRECT_URL (Supabase direct connection) is used for migrations; falls back to DATABASE_URL locally.
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
