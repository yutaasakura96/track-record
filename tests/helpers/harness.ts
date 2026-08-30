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
import type { CandidateFact, ModelSeam, RenderFact, RenderSpec } from "~/model/types";
import type { RenderContent } from "~/shared/render-content";

const bindings = env as unknown as Bindings;

/** Which user a request is from. A real deployment reads a Better Auth cookie. */
const TEST_USER_HEADER = "x-test-user";

export interface StubModel extends ModelSeam {
  /** Queued responses, one per `extractFacts` call. */
  extractions: (CandidateFact[] | Error)[];
  generations: (RenderContent | Error)[];
  /** Every set of facts generation was actually given. */
  generationInputs: { facts: RenderFact[]; spec: RenderSpec }[];
  extractCalls: string[];
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
      if (next instanceof Error) throw next;
      for (const candidate of next) ctx.onCandidate?.(candidate);
      return next;
    },
    async generateRender(facts, spec) {
      stub.generationInputs.push({ facts, spec });
      const next = stub.generations.shift();
      if (next instanceof Error) throw next;
      return next ?? { sections: [] };
    },
  };
  return stub;
}

export interface Harness {
  model: StubModel;
  db: ReturnType<typeof createDb>;
  /** Signed in as this user unless a request overrides it. */
  as(user: SeededUser): Client;
  anonymous(): Client;
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
  json<T = unknown>(path: string): Promise<T>;
}

export function harness(model: StubModel = stubModel()): Harness {
  const app = createApp({
    model: () => model,
    // The seam Better Auth normally fills. `docs/11` §4 puts Better Auth's own
    // implementation deliberately out of scope; OUR middleware and OUR
    // allowlist are what these tests assert.
    sessions: async (request) => {
      const header = request.headers.get(TEST_USER_HEADER);
      if (!header) return null;
      const [id, email, name] = header.split("|");
      if (!id || !email) return null;
      return { id, email, name: name ?? email } satisfies SessionUser;
    },
  });

  const client = (headers: Record<string, string>): Client => {
    const request = async (path: string, init: RequestInit = {}) => {
      const merged = new Headers(init.headers);
      for (const [key, value] of Object.entries(headers)) merged.set(key, value);
      return app.fetch(
        new Request(`https://track-record.test${path}`, { ...init, headers: merged }),
        bindings,
        createExecutionContext(),
      );
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
      json: async <T>(path: string) => (await request(path)).json() as Promise<T>,
    };
  };

  return {
    model,
    db: createDb(bindings.DATABASE_URL),
    as: (user) => client({ [TEST_USER_HEADER]: `${user.id}|${user.email}|${user.name}` }),
    anonymous: () => client({}),
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
