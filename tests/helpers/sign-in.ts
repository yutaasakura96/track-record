/**
 * The sign-in walk and the cookie jar it fills (issue #3).
 *
 * Runtime-agnostic, like `./oidc-issuer.ts`: the suite walks it through the Hono
 * app inside the Workers runtime (`./harness.ts`), and `scripts/dev-session.ts`
 * walks it under Node to hand a local browser a session. Both get the cookie
 * from Better Auth's own callback; neither signs one.
 */
import type { AuthorizationRequest, FixtureIssuer, OidcIdentity } from "./oidc-issuer";

/** A request to the application, by path, carrying the jar's cookies. */
export type Send = (path: string, init?: RequestInit) => Promise<Response>;

export interface SignInResult {
  /** The callback's own response. A redirect, either way. */
  callback: Response;
  /** Where the callback sent the browser: the app, or the error page. */
  location: string;
  /** What the application asked the issuer for, as the issuer received it. */
  authorization: AuthorizationRequest;
}

/**
 * The whole sign-in path: `POST /sign-in/social` → the issuer → the callback.
 * `send` must keep cookies between requests, or the callback's state check
 * fails — which is the point of it.
 */
export async function walkSignIn(
  send: Send,
  issuer: FixtureIssuer,
  identity: OidcIdentity,
): Promise<SignInResult> {
  const started = await send("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "google", callbackURL: "/", errorCallbackURL: "/sign-in" }),
  });
  if (started.status !== 200) {
    throw new Error(`sign-in/social answered ${started.status}: ${await started.text()}`);
  }
  const { url } = (await started.json()) as { url?: string };
  if (!url) throw new Error("sign-in/social returned no authorization URL.");

  const { callbackUrl, request: authorization } = issuer.authorize(url, identity);
  const callback = new URL(callbackUrl);
  const response = await send(`${callback.pathname}${callback.search}`);
  return { callback: response, location: response.headers.get("location") ?? "", authorization };
}

/** A cookie as the jar holds it: the pair, and the attributes it was set with. */
export interface StoredCookie {
  name: string;
  value: string;
  /** Attribute names lower-cased; a flag such as `HttpOnly` maps to `true`. */
  attributes: Record<string, string | true>;
}

/**
 * A browser's cookie store, which is the only thing standing between the
 * `Set-Cookie` the callback writes and the `Cookie` the next request sends.
 * Attributes other than expiry are kept but never asserted on: asserting on
 * `Secure` and `SameSite` would be testing Better Auth's own behaviour
 * (`docs/11` §4). The dev-session script reads them to describe the cookie to a
 * browser.
 */
export class CookieJar {
  readonly #cookies = new Map<string, StoredCookie>();

  capture(response: Response): void {
    for (const raw of setCookieHeaders(response)) {
      const [pair = "", ...rest] = raw.split(";");
      const equals = pair.indexOf("=");
      if (equals === -1) continue;
      const name = pair.slice(0, equals).trim();
      const value = pair.slice(equals + 1).trim();
      const attributes: Record<string, string | true> = {};
      for (const part of rest) {
        const separator = part.indexOf("=");
        if (separator === -1) {
          const flag = part.trim().toLowerCase();
          if (flag) attributes[flag] = true;
          continue;
        }
        attributes[part.slice(0, separator).trim().toLowerCase()] = part.slice(separator + 1).trim();
      }
      // Better Auth clears the OAuth state cookie on the callback. A jar that
      // kept it would let a replayed state look valid.
      if (value === "" || attributes["max-age"] === "0") {
        this.#cookies.delete(name);
        continue;
      }
      this.#cookies.set(name, { name, value, attributes });
    }
  }

  header(): string {
    return [...this.#cookies.values()].map(({ name, value }) => `${name}=${value}`).join("; ");
  }

  cookies(): StoredCookie[] {
    return [...this.#cookies.values()];
  }
}

function setCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}
