import pkg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

const { Pool } = pkg;

const connectionString =
  process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "NEON_DATABASE_URL (or DATABASE_URL) is required to connect to Postgres",
  );
}

export const pool = new Pool({
  connectionString,
  ssl: connectionString.includes("sslmode=require")
    ? { rejectUnauthorized: false }
    : undefined,
});

export const db = drizzle(pool, { schema });
