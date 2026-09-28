/**
 * The runtime-agnostic half of the post-deploy smoke check (`docs/12` §3 step 6,
 * `docs/06`, 2026-09-28 "The deploy check reads the build from the SPA shell").
 *
 * Pure functions over what a response carried, so the suite can prove them
 * inside the Workers runtime against the real Hono app. `./smoke-check.ts` does
 * the fetching. Nothing under `src/` imports this file.
 *
 * Every problem is a sentence about status, headers or shape, never a body: the
 * shell is not record content, but a check that echoes bodies is one careless
 * route away from logging some (`AGENTS.md`).
 */

/** The `<meta name>` the build writes the commit SHA into (`vite.config.ts`). */
export const BUILD_SHA_META = "build-sha";

/**
 * The `/api/*` route the check expects a `401` from. Any route behind the
 * session middleware would do; this one is a plain GET that every signed-in
 * screen already calls first.
 */
export const PROBE_ROUTE = "/api/overview";

/**
 * The origin a deploy went to, from the output file Wrangler appends to when
 * `WRANGLER_OUTPUT_FILE_PATH` is set: one JSON object per line, and a
 * `deploy` entry lists the URLs the Worker now answers on as `targets`. Read
 * from the deploy rather than written down, because the workers.dev address
 * carries the account's subdomain, which lives in Cloudflare and not here.
 */
export function deployedOrigin(wranglerOutput: string): string | null {
  const deploys = wranglerOutput
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as { type?: unknown; targets?: unknown }];
      } catch {
        return [];
      }
    })
    .filter((entry) => entry.type === "deploy");
  const targets = deploys.at(-1)?.targets;
  if (!Array.isArray(targets)) return null;
  const url = targets.find((t): t is string => typeof t === "string" && t.startsWith("https://"));
  return url ? new URL(url).origin : null;
}

/** The SHA a built shell carries, or null when it carries none. */
export function shellSha(html: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!new RegExp(`\\bname="${BUILD_SHA_META}"`).test(tag)) continue;
    return tag.match(/\bcontent="([^"]*)"/)?.[1] ?? null;
  }
  return null;
}

/** The entry module the shell loads, so the check can prove assets are served. */
export function entryScript(html: string): string | null {
  return html.match(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/i)?.[1] ?? null;
}

export interface Answer {
  status: number;
  contentType: string | null;
  body: string;
}

/** `GET /`: the SPA shell, built from the commit the job deployed. */
export function checkShell(answer: Answer, expectedSha: string): string[] {
  if (answer.status !== 200) return [`GET / answered ${answer.status}, not 200.`];
  if (!answer.contentType?.startsWith("text/html")) {
    return [`GET / answered ${answer.contentType ?? "no content type"}, not text/html.`];
  }
  const problems: string[] = [];
  const sha = shellSha(answer.body);
  if (sha === null) problems.push(`GET / carries no <meta name="${BUILD_SHA_META}">.`);
  else if (sha !== expectedSha) problems.push(`GET / is build ${sha}, not ${expectedSha}.`);
  if (!answer.body.includes('<div id="root">')) problems.push("GET / has no mount point.");
  if (entryScript(answer.body) === null) problems.push("GET / loads no module script.");
  return problems;
}

/** The entry module: served as JavaScript, not the SPA fallback. */
export function checkAsset(path: string, answer: Answer): string[] {
  if (answer.status !== 200) return [`GET ${path} answered ${answer.status}, not 200.`];
  if (!answer.contentType?.includes("javascript")) {
    return [`GET ${path} answered ${answer.contentType ?? "no content type"}, not JavaScript.`];
  }
  return [];
}

/**
 * The probe route without a session: the Worker and the auth middleware answer
 * with the API's own error shape (`docs/07` §2). A `401` from anything else — an
 * edge error page, the SPA shell — is not the application saying no.
 */
export function checkApi(answer: Answer): string[] {
  const route = `GET ${PROBE_ROUTE}`;
  if (answer.status !== 401) return [`${route} answered ${answer.status}, not 401.`];
  if (!answer.contentType?.startsWith("application/json")) {
    return [`${route} answered ${answer.contentType ?? "no content type"}, not JSON.`];
  }
  let code: unknown;
  try {
    code = (JSON.parse(answer.body) as { error?: { code?: unknown } }).error?.code;
  } catch {
    return [`${route} answered a body that is not JSON.`];
  }
  return code === "unauthenticated" ? [] : [`${route} answered 401 without the API's error shape.`];
}
