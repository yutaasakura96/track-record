/**
 * The post-deploy smoke check (`docs/12` §3 step 6, issue #34).
 *
 * The checks are pure functions over what a response carried. The API half is
 * proved against the real Hono app, so the probe route and the error shape the
 * check expects cannot drift from what the Worker actually answers.
 */
import { describe, expect, it } from "vitest";
import {
  PROBE_ROUTE,
  checkApi,
  checkAsset,
  checkShell,
  entryScript,
  productionOrigin,
  shellSha,
  type Answer,
} from "../scripts/smoke-check-core";
import { harness } from "./helpers/harness";

const SHA = "0123456789abcdef0123456789abcdef01234567";

const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Track Record</title>
    <script type="module" crossorigin src="/assets/index-Ab12Cd34.js"></script>
    <meta name="build-sha" content="${SHA}">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

const html = (body: string, status = 200): Answer => ({ status, contentType: "text/html; charset=utf-8", body });

async function answer(response: Response): Promise<Answer> {
  return { status: response.status, contentType: response.headers.get("content-type"), body: await response.text() };
}

describe("the production origin", () => {
  it("is read from the custom-domain route", () => {
    const toml = `name = "track-record"\nworkers_dev = false\n\n[[routes]]\npattern = "app.example.invalid"\ncustom_domain = true\n\n[assets]\ndirectory = "./dist/client"\n`;
    expect(productionOrigin(toml)).toBe("https://app.example.invalid");
  });

  it("is not read from a zone route, and is absent without one", () => {
    const zoneRoute = `[[routes]]\npattern = "app.example.invalid/*"\nzone_name = "example.invalid"\n`;
    expect(productionOrigin(zoneRoute)).toBeNull();
    expect(productionOrigin(`name = "track-record"\n`)).toBeNull();
  });
});

describe("the shell", () => {
  it("passes when it carries the deployed build and loads its entry module", () => {
    expect(shellSha(SHELL)).toBe(SHA);
    expect(entryScript(SHELL)).toBe("/assets/index-Ab12Cd34.js");
    expect(checkShell(html(SHELL), SHA)).toEqual([]);
  });

  it("fails on a different build — the previous version still being served", () => {
    expect(checkShell(html(SHELL), "f".repeat(40))).toEqual([`GET / is build ${SHA}, not ${"f".repeat(40)}.`]);
  });

  it("fails without the meta tag, the mount point or a module script", () => {
    expect(checkShell(html("<html><head></head><body></body></html>"), SHA)).toEqual([
      'GET / carries no <meta name="build-sha">.',
      "GET / has no mount point.",
      "GET / loads no module script.",
    ]);
  });

  it("fails on an error status or a non-HTML answer", () => {
    expect(checkShell(html(SHELL, 522), SHA)).toEqual(["GET / answered 522, not 200."]);
    expect(checkShell({ status: 200, contentType: "application/json", body: "{}" }, SHA)).toEqual([
      "GET / answered application/json, not text/html.",
    ]);
  });
});

describe("the entry module", () => {
  const path = "/assets/index-Ab12Cd34.js";

  it("passes when served as JavaScript", () => {
    expect(checkAsset(path, { status: 200, contentType: "text/javascript", body: "" })).toEqual([]);
  });

  it("fails when the SPA fallback answers in its place", () => {
    expect(checkAsset(path, html(SHELL))).toEqual([`GET ${path} answered text/html; charset=utf-8, not JavaScript.`]);
  });
});

describe("the API without a session", () => {
  it("passes on the application's own 401", async () => {
    const response = await harness().anonymous().get(PROBE_ROUTE);
    expect(checkApi(await answer(response))).toEqual([]);
  });

  it("fails on a 401 the application did not write", () => {
    expect(checkApi(html(SHELL, 401))).toEqual([`GET ${PROBE_ROUTE} answered text/html; charset=utf-8, not JSON.`]);
    expect(checkApi({ status: 401, contentType: "application/json", body: '{"message":"nope"}' })).toEqual([
      `GET ${PROBE_ROUTE} answered 401 without the API's error shape.`,
    ]);
  });

  it("fails when the route answers anything but 401", () => {
    expect(checkApi({ status: 500, contentType: "application/json", body: "{}" })).toEqual([
      `GET ${PROBE_ROUTE} answered 500, not 401.`,
    ]);
    expect(checkApi(html(SHELL))).toEqual([`GET ${PROBE_ROUTE} answered 200, not 401.`]);
  });
});
