import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

export type Db = PrismaClient;

export function createPrisma(url: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

export type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;
