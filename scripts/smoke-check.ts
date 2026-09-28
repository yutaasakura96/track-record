/**
 * The post-deploy smoke check (`docs/12` §3 step 6).
 *
 *   npx tsx scripts/smoke-check.ts --wrangler-output <file>  # the Worker a deploy went to
 *   npx tsx scripts/smoke-check.ts --origin <url>            # the Worker at a known origin
 *   npx tsx scripts/smoke-check.ts --built <file>            # a built shell, before deploying
 *
 * Against the deployed Worker it requests the real page, the module script that
 * page loads, and `PROBE_ROUTE` without a session, and exits non-zero unless all
 * three are right. The origin is the one `wrangler deploy` reported in the file
 * `WRANGLER_OUTPUT_FILE_PATH` named, or `--origin`. The expected build is
 * `buildSha()`; `--sha` overrides it.
 *
 * It retries until `--timeout` seconds pass (default 300), because a new
 * version takes a moment to reach every edge location, and a Worker's first
 * workers.dev address can take a while to answer at all. Only the last
 * attempt's problems are printed, and a problem never carries a response body.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildSha } from "./build-sha";
import {
  PROBE_ROUTE,
  checkApi,
  checkAsset,
  checkShell,
  deployedOrigin,
  entryScript,
  type Answer,
} from "./smoke-check-core";

const { values } = parseArgs({
  options: {
    built: { type: "string" },
    "wrangler-output": { type: "string" },
    origin: { type: "string" },
    sha: { type: "string" },
    timeout: { type: "string", default: "300" },
  },
});

const expectedSha = values.sha ?? buildSha();

function report(problems: string[], passed: string): never {
  if (problems.length === 0) {
    console.log(passed);
    process.exit(0);
  }
  for (const problem of problems) console.error(`smoke check: ${problem}`);
  process.exit(1);
}

if (values.built) {
  const body = readFileSync(values.built, "utf8");
  const problems = checkShell({ status: 200, contentType: "text/html", body }, expectedSha);
  report(problems, `smoke check: ${values.built} carries build ${expectedSha}`);
}

const origin =
  values.origin ??
  (values["wrangler-output"] ? deployedOrigin(readFileSync(values["wrangler-output"], "utf8")) : null) ??
  report(["No origin: pass --origin, or --wrangler-output naming a file a deploy wrote to."], "");

async function get(path: string): Promise<Answer> {
  const response = await fetch(new URL(path, origin), {
    redirect: "manual",
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(15_000),
  });
  return { status: response.status, contentType: response.headers.get("content-type"), body: await response.text() };
}

async function attempt(): Promise<string[]> {
  try {
    const shell = await get("/");
    const problems = checkShell(shell, expectedSha);
    const script = entryScript(shell.body);
    if (script) problems.push(...checkAsset(script, await get(script)));
    problems.push(...checkApi(await get(PROBE_ROUTE)));
    return problems;
  } catch (error) {
    return [`${origin} did not answer (${error instanceof Error ? error.name : "unknown error"}).`];
  }
}

const deadline = Date.now() + Number(values.timeout) * 1000;
let problems = await attempt();
while (problems.length > 0 && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  problems = await attempt();
}
report(problems, `smoke check: ${origin} serves build ${expectedSha}, and ${PROBE_ROUTE} answers 401`);
