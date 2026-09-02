/**
 * A local OpenID Connect issuer, run as a test fixture (issue #3).
 *
 * `docs/06`, 2026-08-30 decided against a test-only authentication path: a
 * sign-in bypass that exists in shippable code is a worse risk than the wiring
 * bug it catches, and it is exactly the shape of thing that survives into
 * production because it is only used in CI. The alternative it named — and
 * this is it — is to run the identity provider as a fixture, so Better Auth's
 * own sign-in path executes end to end and **`src/server` contains no code
 * path that exists only for tests**.
 *
 * **Why a `fetch` interception and not an issuer URL.** Better Auth 1.7.1's
 * Google provider hardcodes Google's three endpoints (`google.mjs`): the
 * authorization endpoint is overridable through `ProviderOptions`, the token
 * endpoint and the JWKS endpoint are not. So the fixture claims those origins
 * inside the test isolate instead. Every request the issuer does not own falls
 * through to the real `fetch` — the Neon HTTP proxy the suite talks to is on
 * the other side of it.
 *
 * **The deployed configuration cannot reach this.** There is no URL, no port
 * and no binding: the issuer is an object that lives for the length of one test
 * file, and installing it is a test-side call. A deployed Worker reaches
 * Google, because Google is what the provider names.
 *
 * The private key is generated per run and never leaves the process.
 */

import { env } from "cloudflare:test";
import type { Bindings } from "~/server/env";

const ISSUER = "https://accounts.google.com";
const AUTHORIZATION_ENDPOINT = `${ISSUER}/o/oauth2/v2/auth`;
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWKS_ENDPOINT = "https://www.googleapis.com/oauth2/v3/certs";

/** The origins the fixture answers for. Anything else is passed through. */
const CLAIMED_ORIGINS = new Set([
  new URL(ISSUER).origin,
  new URL(TOKEN_ENDPOINT).origin,
  new URL(JWKS_ENDPOINT).origin,
]);

const KEY_ID = "track-record-oidc-fixture";
const ID_TOKEN_LIFETIME_SECONDS = 600;

/** A Google identity, as the issuer would assert it. */
export interface OidcIdentity {
  /** The `sub` claim — the stable provider subject. */
  sub: string;
  email: string;
  name: string;
}

/** What the application asked the issuer for, as the issuer received it. */
export interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  state: string;
  /** De-duplicated, because the provider sends its defaults and ours. */
  scopes: string[];
  codeChallenge: string;
  codeChallengeMethod: string;
  nonce: string | null;
}

export interface FixtureIssuer {
  /** Claim Google's origins for the length of the test file. */
  install(): void;
  uninstall(): void;
  /**
   * The browser's half of the redirect: consume the authorization URL the
   * application produced, sign the user in, and say where the browser is sent
   * back to. Nothing is minted until this is called, so an unfinished sign-in
   * cannot be completed by a later token request.
   */
  authorize(
    authorizationUrl: string,
    identity: OidcIdentity,
  ): { callbackUrl: string; request: AuthorizationRequest };
  /** How many times the token endpoint was actually reached. */
  tokenRequests: number;
}

interface PendingCode {
  identity: OidcIdentity;
  request: AuthorizationRequest;
}

export interface IssuerCredentials {
  clientId: string;
  clientSecret: string;
}

export async function createIssuer(credentials: IssuerCredentials): Promise<FixtureIssuer> {
  const keys = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;

  const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const jwks = {
    keys: [
      {
        kty: publicJwk.kty,
        n: publicJwk.n,
        e: publicJwk.e,
        alg: "RS256",
        use: "sig",
        kid: KEY_ID,
      },
    ],
  };

  const codes = new Map<string, PendingCode>();
  let issued = 0;
  let originalFetch: typeof fetch | null = null;

  const issuer: FixtureIssuer = {
    tokenRequests: 0,

    install() {
      if (originalFetch) throw new Error("The OIDC fixture is already installed.");
      originalFetch = globalThis.fetch;
      const passThrough = originalFetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input);
        if (!CLAIMED_ORIGINS.has(new URL(url).origin)) return passThrough(input, init);
        return handle(url, methodOf(input, init), await bodyOf(input, init));
      }) as typeof fetch;
    },

    uninstall() {
      if (!originalFetch) return;
      globalThis.fetch = originalFetch;
      originalFetch = null;
    },

    authorize(authorizationUrl, identity) {
      const url = new URL(authorizationUrl);
      if (`${url.origin}${url.pathname}` !== AUTHORIZATION_ENDPOINT) {
        throw new Error(`Not an authorization request: ${url.origin}${url.pathname}`);
      }
      const request = readAuthorizationRequest(url);
      if (request.clientId !== credentials.clientId) {
        throw new Error(`Unknown client_id: ${request.clientId}`);
      }
      if (request.codeChallengeMethod !== "S256") {
        throw new Error(`The issuer requires PKCE S256, got: ${request.codeChallengeMethod}`);
      }
      const code = `fixture_code_${++issued}`;
      codes.set(code, { identity, request });
      const callback = new URL(request.redirectUri);
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", request.state);
      return { callbackUrl: callback.toString(), request };
    },
  };

  async function handle(url: string, method: string, body: string): Promise<Response> {
    const { origin, pathname } = new URL(url);
    const endpoint = `${origin}${pathname}`;

    if (endpoint === JWKS_ENDPOINT && method === "GET") return json(jwks);
    if (endpoint === TOKEN_ENDPOINT && method === "POST") return token(body);

    // Loud rather than silent: a request to a Google endpoint the fixture does
    // not serve means the provider changed, not that the network is down.
    return json({ error: "not_found", endpoint, method }, 404);
  }

  async function token(body: string): Promise<Response> {
    issuer.tokenRequests += 1;
    const form = new URLSearchParams(body);

    if (form.get("grant_type") !== "authorization_code") {
      return json({ error: "unsupported_grant_type" }, 400);
    }
    if (
      form.get("client_id") !== credentials.clientId ||
      form.get("client_secret") !== credentials.clientSecret
    ) {
      return json({ error: "invalid_client" }, 401);
    }

    const code = form.get("code") ?? "";
    const pending = codes.get(code);
    // Single use, as a real issuer treats it.
    codes.delete(code);
    if (!pending) return json({ error: "invalid_grant" }, 400);

    if (form.get("redirect_uri") !== pending.request.redirectUri) {
      return json({ error: "invalid_grant", error_description: "redirect_uri mismatch" }, 400);
    }
    const verifier = form.get("code_verifier") ?? "";
    if ((await codeChallengeFor(verifier)) !== pending.request.codeChallenge) {
      return json({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
    }

    const now = Math.floor(Date.now() / 1000);
    const { identity } = pending;
    const idToken = await sign({
      iss: ISSUER,
      aud: pending.request.clientId,
      azp: pending.request.clientId,
      sub: identity.sub,
      email: identity.email,
      email_verified: true,
      name: identity.name,
      picture: `${ISSUER}/fixture/${identity.sub}.png`,
      iat: now,
      nbf: now,
      exp: now + ID_TOKEN_LIFETIME_SECONDS,
      ...(pending.request.nonce ? { nonce: pending.request.nonce } : {}),
    });

    return json({
      access_token: `fixture_access_${issued}`,
      expires_in: 3600,
      id_token: idToken,
      scope: pending.request.scopes.join(" "),
      token_type: "Bearer",
    });
  }

  async function sign(claims: Record<string, unknown>): Promise<string> {
    const header = { alg: "RS256", kid: KEY_ID, typ: "JWT" };
    const input = `${base64url(utf8(JSON.stringify(header)))}.${base64url(utf8(JSON.stringify(claims)))}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keys.privateKey,
      utf8(input),
    );
    return `${input}.${base64url(new Uint8Array(signature))}`;
  }

  return issuer;
}

function readAuthorizationRequest(url: URL): AuthorizationRequest {
  const required = (name: string) => {
    const value = url.searchParams.get(name);
    if (!value) throw new Error(`Authorization request is missing ${name}`);
    return value;
  };
  if (url.searchParams.get("response_type") !== "code") {
    throw new Error("The issuer supports the authorization code flow only.");
  }
  return {
    clientId: required("client_id"),
    redirectUri: required("redirect_uri"),
    state: required("state"),
    scopes: [...new Set(required("scope").split(" ").filter(Boolean))],
    codeChallenge: required("code_challenge"),
    codeChallengeMethod: required("code_challenge_method"),
    nonce: url.searchParams.get("nonce"),
  };
}

async function codeChallengeFor(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(verifier))));
}

const utf8 = (value: string) => new TextEncoder().encode(value);

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  return method.toUpperCase();
}

async function bodyOf(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  const body = init?.body;
  if (body === undefined || body === null) {
    return input instanceof Request ? await input.clone().text() : "";
  }
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  return new Response(body as BodyInit).text();
}

/**
 * The whole fixture, wired to the test bindings and torn down after the file.
 * Every sign-in test needs exactly this, so it is written once.
 */
export async function installIssuer(): Promise<FixtureIssuer> {
  const bindings = env as unknown as Bindings;
  const issuer = await createIssuer({
    clientId: bindings.GOOGLE_CLIENT_ID,
    clientSecret: bindings.GOOGLE_CLIENT_SECRET,
  });
  issuer.install();
  return issuer;
}
