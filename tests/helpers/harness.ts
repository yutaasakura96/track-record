/**
 * The test harness.
 *
 * Every functional test goes through **the Hono application, over HTTP** — the
 * highest seam that can observe the behaviour. A test that reaches past the API
 * to inspect a table, or that asserts on a function the feature happens to be
 * implemented with, fails when the implementation improves and passes when the
 * behaviour breaks (`docs/11-testing-plan.md` §2).
 *
 * All fixtures are INVENTED. Nothing is sampled from `local/`.
 */
import { env } from "cloudflare:test";
import { createApp } from "~/server/app";
import { createDb } from "~/server/db/client";
import type { Bindings, SessionUser } from "~/server/env";
import type { CandidateFact, ModelSeam, ModelUsage, RenderFact, RenderSpec } from "~/model/types";
import type { RenderContent } from "~/shared/render-content";
import type { FixtureIssuer, OidcIdentity } from "./oidc";
import { CookieJar, walkSignIn, type SignInResult } from "./sign-in";

const bindings = env as unknown as Bindings;

/** Which user a request is from. A real deployment reads a Better Auth cookie. */
const TEST_USER_HEADER = "x-test-user";

/**
 * The origin every request is made to. It is READ FROM `BETTER_AUTH_URL` rather
 * than restated, because Better Auth builds the OAuth `redirect_uri` from that
 * value and the sign-in walk has to come back to the same application.
 */
const ORIGIN = new URL(bindings.BETTER_AUTH_URL).origin;

export interface StubModel extends ModelSeam {
  /** Queued responses, one per `extractFacts` call. */
  extractions: (CandidateFact[] | Error)[];
  generations: (RenderContent | Error)[];
  /** Every set of facts generation was actually given. */
  generationInputs: { facts: RenderFact[]; spec: RenderSpec }[];
  extractCalls: string[];
  /**
   * Reported through `onUsage` on every call, extraction and generation alike.
   * Left unset to model a provider that reports nothing, which is what the
   * columns' nullability exists for.
   */
  usage?: ModelUsage;
}

export function stubModel(): StubModel {
  const stub: StubModel = {
    extractions: [],
    generations: [],
    generationInputs: [],
    extractCalls: [],
    async extractFacts(sourceText, ctx) {
      stub.extractCalls.push(sourceText);
      const next = stub.extractions.shift() ?? [];
      // Thrown BEFORE any usage is reported: a call that fails reports nothing,
      // which is what the real seam does.
      if (next instanceof Error) throw next;
      for (const candidate of next) ctx.onCandidate?.(candidate);
      if (stub.usage) ctx.onUsage?.(stub.usage);
      return next;
    },
    async generateRender(facts, spec, ctx) {
      stub.generationInputs.push({ facts, spec });
      const next = stub.generations.shift();
      if (next instanceof Error) throw next;
      if (stub.usage) ctx?.onUsage?.(stub.usage);
      return next ?? { sections: [] };
    },
  };
  return stub;
}

export interface HarnessOptions {
  /**
   * Resolve sessions the way the deployment does — through Better Auth, from a
   * cookie. Requires the OIDC fixture to be installed, because the only way to
   * get such a cookie is to sign in (`tests/helpers/oidc.ts`, issue #3).
   */
  realSessions?: boolean;
}

export interface Harness {
  model: StubModel;
  db: ReturnType<typeof createDb>;
  /** Signed in as this user unless a request overrides it. */
  as(user: SeededUser): Client;
  anonymous(): Client;
  /**
   * The whole sign-in path: `POST /sign-in/social` → the issuer → the callback
   * → a session cookie. Only on a `realSessions` harness.
   */
  signIn(issuer: FixtureIssuer, identity: OidcIdentity): Promise<SignInWalk>;
}

export interface SignInWalk extends SignInResult {
  /** Carries whatever cookies the walk ended with — a session, or nothing. */
  client: Client;
}

export interface SeededUser {
  id: string;
  email: string;
  name: string;
}

export interface Client {
  request(path: string, init?: RequestInit): Promise<Response>;
  get(path: string): Promise<Response>;
  post(path: string, body?: unknown): Promise<Response>;
  patch(path: string, body: unknown): Promise<Response>;
  put(path: string, body: unknown): Promise<Response>;
  delete(path: string): Promise<Response>;
  json<T = unknown>(path: string): Promise<T>;
}

export function harness(model: StubModel = stubModel(), options: HarnessOptions = {}): Harness {
  const app = createApp({
    model: () => model,
    // The seam Better Auth normally fills. `docs/11` §4 puts Better Auth's own
    // implementation deliberately out of scope; OUR middleware and OUR
    // allowlist are what these tests assert. A `realSessions` harness omits the
    // override entirely and runs the deployed resolver.
    ...(options.realSessions
      ? {}
      : {
          sessions: async (request: Request) => {
            const header = request.headers.get(TEST_USER_HEADER);
            if (!header) return null;
            const [id, email, name] = header.split("|");
            if (!id || !email) return null;
            return { id, email, name: name ?? email } satisfies SessionUser;
          },
        }),
  });

  const client = (headers: Record<string, string>, jar?: CookieJar): Client => {
    const request = async (path: string, init: RequestInit = {}) => {
      const merged = new Headers(init.headers);
      for (const [key, value] of Object.entries(headers)) merged.set(key, value);
      const cookies = jar?.header();
      if (cookies) merged.set("cookie", cookies);
      const response = await app.fetch(
        new Request(`${ORIGIN}${path}`, { ...init, headers: merged }),
        bindings,
        createExecutionContext(),
      );
      jar?.capture(response);
      return response;
    };
    const send = (method: string) => async (path: string, body?: unknown) =>
      request(path, {
        method,
        ...(body === undefined
          ? {}
          : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
      });
    return {
      request,
      get: (path) => request(path),
      post: send("POST"),
      patch: send("PATCH") as Client["patch"],
      put: send("PUT") as Client["put"],
      delete: (path) => request(path, { method: "DELETE" }),
      json: async <T>(path: string) => (await request(path)).json() as Promise<T>,
    };
  };

  return {
    model,
    db: createDb(bindings.DATABASE_URL),
    as: (user) => client({ [TEST_USER_HEADER]: `${user.id}|${user.email}|${user.name}` }),
    anonymous: () => client({}),
    signIn: async (issuer, identity) => {
      if (!options.realSessions) {
        throw new Error("signIn() needs harness(model, { realSessions: true }).");
      }
      const browser = client({}, new CookieJar());
      return { client: browser, ...(await walkSignIn(browser.request, issuer, identity)) };
    },
  };
}

/**
 * `waitUntil` work is what makes the import and generation routes return
 * immediately. Tests need those promises to settle, so the harness collects
 * them and `settle()` awaits them.
 */
const pending: Promise<unknown>[] = [];

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
}

export async function settle() {
  while (pending.length > 0) {
    const batch = pending.splice(0, pending.length);
    await Promise.allSettled(batch);
  }
}
