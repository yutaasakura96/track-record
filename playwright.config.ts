/**
 * The browser half of the end-to-end smoke test (`docs/11-testing-plan.md` §2.9,
 * issue #33). One test, one happy path.
 *
 * It runs against the BUILT SPA served by the Worker's `ASSETS` binding — `vite
 * build` first (`npm run test:e2e`), then `wrangler dev` on the test entry — and
 * never the Vite dev server, so "static assets not served" is covered.
 *
 * The database is its own, `track_record_e2e`, which `global-setup.ts` drops and
 * rebuilds. `E2E_DATABASE_URL` overrides it, and the same guards that keep the
 * suite off the dev database apply.
 */
import { defineConfig, devices } from "@playwright/test";
import { E2E_DATABASE_URL, E2E_ORIGIN, E2E_PORT, E2E_SECRET, workerVars } from "./tests/e2e/env";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "*.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  // One test, one database: nothing here is safe to run in parallel.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 90_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: E2E_ORIGIN,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: [
      "npx wrangler dev",
      "--config tests/e2e/wrangler.toml",
      `--port ${E2E_PORT}`,
      "--ip localhost",
      "--local",
      ...workerVars(E2E_DATABASE_URL, E2E_SECRET).map((v) => `--var ${v}`),
    ].join(" "),
    url: E2E_ORIGIN,
    // A worker already on this port is somebody else's, aimed at some other database.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
