import { defineConfig } from "drizzle-kit";

const url =
  process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || "";

export default defineConfig({
  schema: "./shared/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url },
});
