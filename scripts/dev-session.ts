/**
 * `npm run dev:session` — a signed-in browser session for the local app
 * (`docs/06`, 2026-09-25).
 *
 * The application has no sign-in shortcut and gains none here (`docs/06`,
 * 2026-08-30 and 2026-09-02). This script signs a local test user in the way the
 * suite does: Better Auth's own sign-in path, run in this process against the
 * development database, with the suite's OIDC issuer standing in for Google.
 * The cookie Better Auth sets is written where a browser tool can load it.
 *
 * It refuses, before writing anything, unless `.dev.vars` describes this
 * machine: a local database, a local `BETTER_AUTH_URL`, and not `NODE_ENV=production`.
 *
 * Run under Node through `tsx`, not in the Workers runtime, and against the auth
 * surface rather than the whole app: the app imports the 履歴書 template as a
 * `.docx` Data module, which only wrangler and Vite know how to load. The auth
 * surface is what `/api/auth/*` hands every request to (`src/server/routes/auth.ts`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createAuth } from "~/server/auth";
import { createDb } from "~/server/db/client";
import type { Bindings } from "~/server/env";
import {
  DEV_SESSION_CLIENT,
  appUrl,
  checkLocalOnly,
  createDevSession,
  documentCookieScript,
  storageState,
} from "./dev-session-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEV_VARS = join(root, ".dev.vars");
/** Gitignored. Holds a live session token for the local database. */
const STORAGE_STATE = join(root, ".dev-session", "storage-state.json");

async function main(): Promise<number> {
  const guard = checkLocalOnly(
    existsSync(DEV_VARS) ? readFileSync(DEV_VARS, "utf8") : null,
    process.env.NODE_ENV,
  );
  if (!guard.ok) {
    console.error("dev:session refused — nothing was written:");
    for (const reason of guard.refusals) console.error(`  - ${reason}`);
    return 1;
  }
  const { config } = guard;

  const bindings = {
    DATABASE_URL: config.databaseUrl,
    BETTER_AUTH_SECRET: config.secret,
    BETTER_AUTH_URL: config.origin,
    ALLOWED_SIGNUP_EMAILS: config.allowlist,
    GOOGLE_CLIENT_ID: DEV_SESSION_CLIENT.clientId,
    GOOGLE_CLIENT_SECRET: DEV_SESSION_CLIENT.clientSecret,
  } as Bindings;
  const db = createDb(config.databaseUrl);
  const { session, cookies, user } = await createDevSession(
    (request) => createAuth(bindings, db).handler(request),
    config.origin,
  );

  const state = storageState(cookies, config.origin);
  mkdirSync(dirname(STORAGE_STATE), { recursive: true });
  writeFileSync(STORAGE_STATE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });

  const url = appUrl(config.origin);
  const worker = await probeWorker(config.origin, `${session.name}=${session.value}`);
  console.log(
    [
      `Signed in ${user.email} (${user.id}) against the local database.`,
      "",
      `open     ${url}`,
      `cookie   name=${session.name}`,
      `         value=${session.value}`,
      `         domain=${new URL(config.origin).hostname} path=${attributeOr(session.attributes.path, "/")}`,
      `state    ${relative(process.cwd(), STORAGE_STATE)}  (Playwright storageState)`,
      `script   ${documentCookieScript(session)}`,
      `pw       await page.context().addCookies(${JSON.stringify(state.cookies)})`,
      `worker   ${worker}`,
      "",
      "chrome-devtools-axi: `open` the URL, `eval` the script line, then `open` the URL again.",
      "Playwright MCP: run the pw line with browser_run_code, then navigate to the URL;",
      "  or launch the MCP server with --storage-state set to the state file.",
    ].join("\n"),
  );
  return 0;
}

/** Whether the running dev worker accepts the cookie. Informational: the session exists either way. */
async function probeWorker(origin: string, cookie: string): Promise<string> {
  try {
    const response = await fetch(`${origin}/api/auth/session`, {
      headers: { cookie },
      signal: AbortSignal.timeout(3_000),
    });
    if (response.ok) return `${origin} accepts the session.`;
    return `${origin} answered ${response.status}. Is it running with this .dev.vars?`;
  } catch {
    return `${origin} is not reachable. Start it with \`npm run dev:worker\`; the session will work once it is up.`;
  }
}

function attributeOr(value: string | true | undefined, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`dev:session failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
