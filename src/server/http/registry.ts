/**
 * The project's own route registry.
 *
 * `docs/08-auth-and-permissions.md` §4: route protection is verified against
 * THIS array, not against Hono's `app.routes` — which is not part of Hono's
 * documented API surface, and a security guarantee resting on an undocumented
 * property quietly becomes decorative after a minor upgrade.
 *
 * Every route is registered through {@link routes}, which records it here as a
 * side effect. Registering a route by calling `app.get(...)` directly is
 * therefore a reviewable mistake rather than an invisible one: the enumeration
 * test never sees it, and `assertEveryRouteIsRegistered` fails the build.
 */
import type { Context, Hono } from "hono";
import type { AppEnv } from "../env";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "ALL";

export interface RegisteredRoute {
  method: HttpMethod;
  /** The full path as mounted, e.g. `/api/facts/:id/accept`. */
  path: string;
  /**
   * `true` only for the auth callbacks. Everything else is protected because it
   * exists, not because someone remembered.
   */
  isPublic: boolean;
}

const registry: RegisteredRoute[] = [];

export function registeredRoutes(): readonly RegisteredRoute[] {
  return registry;
}

/** The exemption list, stated once (`docs/08` §4). */
export const PUBLIC_PATH_PREFIXES = ["/api/auth/"] as const;

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function record(method: HttpMethod, path: string) {
  if (!path.startsWith("/api/")) {
    throw new Error(`Route ${method} ${path} is outside /api — the Worker serves nothing else.`);
  }
  const isPublic = isPublicPath(path);
  const already = registry.some((r) => r.method === method && r.path === path);
  // Registration runs once per module import, but a test suite may build the app
  // more than once in a process. Recording is idempotent so the enumeration test
  // sees each route exactly once.
  if (!already) registry.push({ method, path, isPublic });
}

/**
 * Handlers are typed loosely on purpose. The wrapper's job is to RECORD the
 * route; Hono still type-checks the handler at the call site.
 */
type Handler = (c: Context<AppEnv>) => Response | Promise<Response>;

/**
 * The registration wrapper. Paths are absolute and complete — sub-routers with
 * their own base path are deliberately not used, because then the registry would
 * hold fragments and the enumeration test could not call them.
 */
export function routes(app: Hono<AppEnv>) {
  const bind = (method: HttpMethod) => (path: string, ...handlers: Handler[]) => {
    record(method, path);
    const key = method === "ALL" ? "all" : (method.toLowerCase() as "get");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (app[key] as any)(path, ...handlers);
    return api;
  };
  const api = {
    get: bind("GET"),
    post: bind("POST"),
    put: bind("PUT"),
    patch: bind("PATCH"),
    delete: bind("DELETE"),
    all: bind("ALL"),
  };
  return api;
}
