/**
 * The app itself, in this process, signed in as the user being reset.
 *
 * What the author would do on a screen — generate a document and accept it,
 * mark a flag checked, add a photo, explain a gap, attach documents to an
 * application and move it on — the seed does through the same routes, so the
 * record it leaves is one the app wrote. Nothing listens on a port: each call
 * is `app.fetch` with the user's session already resolved, and the work a
 * route hands to `waitUntil` (generation) is awaited before the call returns.
 */
import { createApp } from "~/server/app";
import type { ModelSeam } from "~/model/types";
import type { Bindings, SessionUser } from "~/server/env";

export type DemoCall = <T = unknown>(method: string, path: string, body?: unknown) => Promise<T>;

export function demoApp(databaseUrl: string, user: SessionUser, model: ModelSeam): DemoCall {
  const app = createApp({ model: () => model, sessions: async () => user });
  // The two bindings these routes read. The allowlist is the one user, as a deployment's is.
  const env = { DATABASE_URL: databaseUrl, ALLOWED_SIGNUP_EMAILS: user.email } as Bindings;

  return async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const pending: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: (work: Promise<unknown>) => void pending.push(work),
      passThroughOnException: () => {},
      props: {},
    } as unknown as ExecutionContext;
    const init: RequestInit =
      body === undefined
        ? { method }
        : body instanceof Uint8Array
          ? { method, body: body as unknown as BodyInit, headers: { "content-type": "application/octet-stream" } }
          : { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } };
    const response = await app.fetch(new Request(`http://demo.invalid${path}`, init), env, ctx);
    await Promise.all(pending);
    // The API's own error, which names the refusal and never carries record text.
    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${await response.text()}`);
    return (await response.json()) as T;
  };
}
