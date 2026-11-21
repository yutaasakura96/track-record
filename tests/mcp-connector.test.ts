/**
 * The claude.ai connector (decision log 2026-11-17): discovery, dynamic client
 * registration, sign-in and consent, the token, `/api/mcp` behind it, and
 * ending a connection from the profile (decision log 2026-11-21).
 *
 * Walked the way claude.ai walks it, against the deployed Better Auth
 * configuration, with the suite's OIDC issuer standing in for Google. What is
 * asserted is OUR configuration and OUR route: that the documents point where
 * Claude looks, that the flow ends at a token for this resource, and that the
 * route takes nothing else. Every value is INVENTED.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker from "~/server/index";
import type { Bindings } from "~/server/env";
import { harness, stubModel, type Client } from "./helpers/harness";
import { installIssuer, type FixtureIssuer } from "./helpers/oidc";
import { AUTHOR_EMAIL, seedAllowedUser } from "./helpers/seed";

const bindings = env as unknown as Bindings;
const ORIGIN = new URL(bindings.BETTER_AUTH_URL).origin;
const RESOURCE = `${ORIGIN}/api/mcp`;
const ISSUER = `${ORIGIN}/api/auth`;
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const AUTHOR = { sub: "204718395527361904182", email: AUTHOR_EMAIL, name: "Invented Author" };

let issuer: FixtureIssuer;
beforeAll(async () => {
  issuer = await installIssuer();
});
afterAll(() => issuer.uninstall());

/** A request to the Worker's entry point, where the root discovery paths are served. */
const atRoot = (path: string) =>
  worker.fetch(new Request(`${ORIGIN}${path}`), bindings, { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext);

const base64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function pkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

/** What claude.ai sends to `/register`: a public client with its callback. */
async function register(client: Client) {
  const response = await client.request("/api/auth/oauth2/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Claude",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(response.status, await response.clone().text()).toBeLessThan(300);
  return ((await response.json()) as { client_id: string }).client_id;
}

const authorizePath = (clientId: string, challenge: string, scope: string) =>
  `/api/auth/oauth2/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope,
    state: "invented-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
  })}`;

/** Follows one redirect's `Location`, which is a path on this origin or an absolute URL. */
const locationOf = (response: Response) => new URL(response.headers.get("location") ?? "", ORIGIN);

/** The whole flow, from a signed-out browser to a token. */
async function connect(scope = "record offline_access") {
  const app = harness(stubModel(), { realSessions: true });
  const browser = app.browser();
  const clientId = await register(app.anonymous());
  const { verifier, challenge } = await pkce();

  // Signed out: the provider sends the browser to the login page with a signed query.
  const authorized = await browser.get(authorizePath(clientId, challenge, scope));
  expect(authorized.status).toBe(302);
  const login = locationOf(authorized);
  expect(login.pathname).toBe("/");
  expect(login.searchParams.has("sig")).toBe(true);

  // The sign-in screen passes that query back, and Google signs the author in.
  const started = await browser.request("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "google", callbackURL: "/", oauth_query: login.searchParams.toString() }),
  });
  const { url } = (await started.json()) as { url: string };
  const { callbackUrl } = issuer.authorize(url, AUTHOR);
  // A browser arrives at the callback by navigating, and the provider redirects only a navigation.
  const callback = await browser.request(`${new URL(callbackUrl).pathname}${new URL(callbackUrl).search}`, {
    headers: { "sec-fetch-mode": "navigate", accept: "text/html" },
  });

  // Signed in, the provider carries on to the consent screen.
  const consent = locationOf(callback);
  expect(consent.pathname).toBe("/consent");
  expect(consent.searchParams.get("client_id")).toBe(clientId);

  // The consent screen's own request, which a browser sends with its origin (Better Auth's CSRF check).
  const answered = await browser.request("/api/auth/oauth2/consent", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ accept: true, oauth_query: consent.searchParams.toString() }),
  });
  expect(answered.status, await answered.clone().text()).toBe(200);
  const back = new URL(((await answered.json()) as { url: string }).url);
  expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
  expect(back.searchParams.get("state")).toBe("invented-state");
  const code = back.searchParams.get("code")!;

  const token = await app.anonymous().request("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
      resource: RESOURCE,
    }).toString(),
  });
  expect(token.status, await token.clone().text()).toBe(200);
  const tokens = (await token.json()) as { access_token: string; refresh_token?: string; scope: string };
  return { app, browser, clientId, tokens };
}

/** One JSON-RPC call to `/api/mcp`, as a Streamable HTTP client sends it. */
async function rpc(app: ReturnType<typeof harness>, accessToken: string | null, method: string, params: unknown = {}) {
  return app.anonymous().request("/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

describe("discovery", () => {
  it("publishes the protected resource where Claude looks, naming this deployment's authorization server", async () => {
    for (const path of ["/.well-known/oauth-protected-resource/api/mcp", "/.well-known/oauth-protected-resource"]) {
      const response = await atRoot(path);
      expect(response.status, path).toBe(200);
      const metadata = (await response.json()) as { resource: string; authorization_servers: string[] };
      expect(metadata.resource).toBe(RESOURCE);
      expect(metadata.authorization_servers[0]).toBe(ISSUER);
    }
  });

  it("publishes the authorization server's metadata with registration and S256", async () => {
    const response = await atRoot("/.well-known/oauth-authorization-server/api/auth");
    expect(response.status).toBe(200);
    const metadata = (await response.json()) as {
      issuer: string;
      registration_endpoint: string;
      code_challenge_methods_supported: string[];
      token_endpoint_auth_methods_supported: string[];
    };
    expect(metadata.issuer).toBe(ISSUER);
    expect(metadata.registration_endpoint).toBe(`${ISSUER}/oauth2/register`);
    expect(metadata.code_challenge_methods_supported).toContain("S256");
    expect(metadata.token_endpoint_auth_methods_supported).toContain("none");
  });

  it("hands nothing else under /.well-known to the provider", async () => {
    // In production the static assets answer it (wrangler's `run_worker_first`
    // names only the three paths); here the app does, with its own 404.
    const response = await atRoot("/.well-known/openid-configuration");
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("issuer");
  });
});

describe("registration", () => {
  it("refuses a client naming any callback but Claude's", async () => {
    const app = harness(stubModel(), { realSessions: true });
    for (const redirect_uris of [["https://claude.ai.attacker.example/api/mcp/auth_callback"], [REDIRECT, "https://attacker.example/cb"], []]) {
      const response = await app.anonymous().request("/api/auth/oauth2/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "Claude", redirect_uris, token_endpoint_auth_method: "none" }),
      });
      expect(response.status, JSON.stringify(redirect_uris)).toBe(400);
      expect(await response.text()).toContain("invalid_redirect_uri");
    }
  });
});

describe("/api/mcp", () => {
  it("refuses a request with no token, pointing the client at the metadata", async () => {
    const app = harness(stubModel(), { realSessions: true });
    const response = await rpc(app, null, "tools/list");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`);
  });

  it("refuses a token that is not one this deployment issued", async () => {
    const app = harness(stubModel(), { realSessions: true });
    const forged = `${base64url(new TextEncoder().encode('{"alg":"EdDSA"}').buffer)}.${base64url(new TextEncoder().encode(`{"sub":"x","aud":"${RESOURCE}"}`).buffer)}.c2ln`;
    expect((await rpc(app, forged, "tools/list")).status).toBe(401);
  });

  it("is reached through the whole flow, and answers with the author's tools", async () => {
    const { app, tokens } = await connect();
    expect(tokens.scope.split(" ")).toContain("record");
    expect(tokens.refresh_token).toBeTruthy();

    const initialized = await rpc(app, tokens.access_token, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(initialized.status, await initialized.clone().text()).toBe(200);

    const listed = await rpc(app, tokens.access_token, "tools/list");
    expect(listed.status, await listed.clone().text()).toBe(200);
    const { result } = (await listed.json()) as { result: { tools: { name: string }[] } };
    expect(result.tools.map((tool) => tool.name)).toContain("get_record");

    const sources = await rpc(app, tokens.access_token, "tools/call", { name: "list_sources", arguments: {} });
    const body = (await sources.json()) as { result: { isError?: boolean } };
    expect(body.result.isError).not.toBe(true);
  });

  it("refuses a token without the record scope, naming the scope to ask for", async () => {
    const { app, tokens } = await connect("openid offline_access");
    const response = await rpc(app, tokens.access_token, "tools/list");
    expect(response.status).toBe(403);
    const challenge = response.headers.get("www-authenticate") ?? "";
    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain('scope="record"');
  });

  it("refuses a bearer token presented as DPoP, since it is bound to no key", async () => {
    const { app, tokens } = await connect();
    const response = await app.anonymous().request("/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `DPoP ${tokens.access_token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(response.status).toBe(401);
  });

  it("refuses a token that has been altered", async () => {
    const { app, tokens } = await connect();
    const [header, payload, signature] = tokens.access_token.split(".");
    const claims = JSON.parse(atob(payload!.replace(/-/g, "+").replace(/_/g, "/")));
    const altered = `${header}.${base64url(new TextEncoder().encode(JSON.stringify({ ...claims, sub: "usr_someone_else" })).buffer)}.${signature}`;
    expect((await rpc(app, altered, "tools/list")).status).toBe(401);
  });
});

describe("connected apps", () => {
  const refresh = (app: ReturnType<typeof harness>, clientId: string, refreshToken: string) =>
    app.anonymous().request("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, resource: RESOURCE }).toString(),
    });

  it("lists the client the author allowed, with where it sends them back to", async () => {
    const { browser, clientId } = await connect();
    const { items } = (await (await browser.get("/api/connections")).json()) as {
      items: { clientId: string; name: string | null; host: string | null; lastUsedAt: string | null }[];
    };
    const mine = items.find((item) => item.clientId === clientId);
    expect(mine).toMatchObject({ name: "Claude", host: "claude.ai" });
    expect(mine?.lastUsedAt).toBeTruthy();
  });

  it("ends a connection at once: the token still inside its hour is refused, and so is its refresh token", async () => {
    const { app, browser, clientId, tokens } = await connect();
    expect((await rpc(app, tokens.access_token, "tools/list")).status).toBe(200);

    const ended = await browser.delete(`/api/connections/${encodeURIComponent(clientId)}`);
    expect(ended.status).toBe(204);

    expect((await rpc(app, tokens.access_token, "tools/list")).status).toBe(401);
    expect((await refresh(app, clientId, tokens.refresh_token!)).status).toBeGreaterThanOrEqual(400);
    const { items } = (await (await browser.get("/api/connections")).json()) as { items: { clientId: string }[] };
    expect(items.some((item) => item.clientId === clientId)).toBe(false);
    expect((await browser.delete(`/api/connections/${encodeURIComponent(clientId)}`)).status).toBe(404);
  });

  it("neither lists nor ends another user's connection", async () => {
    const { app, clientId, tokens } = await connect();
    const someoneElse = harness().as(await seedAllowedUser());

    const { items } = await someoneElse.json<{ items: { clientId: string }[] }>("/api/connections");
    expect(items.some((item) => item.clientId === clientId)).toBe(false);
    expect((await someoneElse.delete(`/api/connections/${encodeURIComponent(clientId)}`)).status).toBe(404);
    expect((await rpc(app, tokens.access_token, "tools/list")).status).toBe(200);
  });
});
