/**
 * Mounts the real application at one path, over a stubbed `fetch`.
 *
 * The whole tree renders — the width gate, the session and profile gates, the
 * router and the screen — so a test sees what the author sees. Only the network
 * is replaced. `fetch` is answered from a table keyed `"METHOD /path?query"`, and
 * every request is recorded, so a test states exactly which writes a click made.
 * A wrong id, a second write, or a write in the wrong order all look fine on
 * screen, and that is the failure these tests are for (`docs/11` intro).
 *
 * An unlisted GET answers 404 and an unlisted write answers 501. Neither throws:
 * the test asserts the recorded writes, so an unexpected one fails there.
 */
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { createMemoryHistory } from "@tanstack/history";
import { vi } from "vitest";
import { createAppRouter } from "~/client/router";

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** A non-2xx answer in the application's error shape. */
export class Refusal {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly message: string,
    /** `error.details`: which proposal or which facts are in the way. */
    readonly details?: Record<string, unknown>,
  ) {}
}

type Answer = unknown;
export type Routes = Record<string, Answer | ((call: Call) => Answer | Promise<Answer>)>;

const SIGNED_IN: Routes = {
  "GET /api/auth/session": { user: { id: "user-test-1", email: "author@example.invalid", name: "Test Author" } },
  // Any object will do: the gate asks only whether a profile exists.
  "GET /api/profile": { id: "profile-test-1" },
};

const reply = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function stubFetch(routes: Routes) {
  const calls: Call[] = [];

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname + url.search;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const call = { method, path, body };
    calls.push(call);

    const key = `${method} ${path}`;
    if (!(key in routes)) {
      return method === "GET"
        ? reply(404, { error: { code: "not_found", message: `Unstubbed: ${key}` } })
        : reply(501, { error: { code: "unstubbed", message: `Unstubbed: ${key}` } });
    }
    const route = routes[key];
    const answer = typeof route === "function" ? await route(call) : route;
    if (answer instanceof Refusal) {
      const { status, code, message, details } = answer;
      return reply(status, { error: { code, message, ...(details ? { details } : {}) } });
    }
    return answer === undefined ? new Response(null, { status: 204 }) : reply(200, answer);
  });

  return {
    calls,
    /** Every request that was not a GET, as `"METHOD /path"`, in the order made. */
    writes: () => calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`),
    /** The JSON body of the one write made to `path`. */
    bodyOf: (method: string, path: string) => {
      const matching = calls.filter((c) => c.method === method && c.path === path);
      if (matching.length !== 1) throw new Error(`Expected one ${method} ${path}, saw ${matching.length}.`);
      return matching[0]!.body;
    },
  };
}

export function mount(path: string, routes: Routes) {
  const api = stubFetch({ ...SIGNED_IN, ...routes });
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return {
    api,
    user: userEvent.setup(),
    /** Where the router is now. */
    pathname: () => router.state.location.pathname,
  };
}
