import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./src/server/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  // Migrations are committed as readable SQL and reviewed before they run.
  // See docs/12-deployment-devops.md §3.
  verbose: true,
  strict: true,
});
