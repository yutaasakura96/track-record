/**
 * Server-side tests run INSIDE the Workers runtime via Miniflare, against a real
 * Postgres behind the Neon HTTP proxy, with the model seam stubbed
 * (`docs/11-testing-plan.md` §1).
 *
 * No test ever calls Anthropic.
 */
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { fileURLToPath, URL } from "node:url";
import { TEST_DATABASE_URL } from "./tests/global-setup.ts";

export default defineConfig({
  plugins: [
    cloudflareTest({
      miniflare: {
        compatibilityDate: "2026-08-12",
        compatibilityFlags: ["nodejs_compat"],
        bindings: {
          DATABASE_URL: TEST_DATABASE_URL,
          // Present so the environment resolves. Never reached: every test
          // supplies a stubbed model seam.
          ANTHROPIC_API_KEY: "test-key-never-used",
          ANTHROPIC_MODEL: "claude-opus-5",
          BETTER_AUTH_SECRET: "test-secret-not-a-real-one",
          BETTER_AUTH_URL: "http://localhost:8787",
          GOOGLE_CLIENT_ID: "test-client",
          GOOGLE_CLIENT_SECRET: "test-secret",
          ALLOWED_SIGNUP_EMAILS: "author@example.invalid,second@example.invalid",
        },
      },
    }),
  ],
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    globalSetup: ["./tests/global-setup.ts"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
