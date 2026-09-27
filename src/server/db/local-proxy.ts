/**
 * Where a local connection string's queries go.
 *
 * Plain Postgres does not speak Neon's HTTP protocol, so locally and in CI the
 * Neon HTTP proxy from docker-compose.yml sits in front of it. A connection
 * string can name a proxy other than the default one with `proxyPort`, which is
 * how a second stack on other ports is reached.
 *
 * One place, because two readers of it must agree: `createDb` sends every test's
 * queries here, and `tests/global-setup.ts` sends the schema drop and the
 * migrations here. When they disagreed, a URL with `proxyPort` ran the tests
 * against one proxy and rebuilt the schema behind another.
 *
 * No imports, deliberately: `vitest.config.ts` imports global setup, so this is
 * part of the Vite config graph.
 */

/** The port docker-compose.yml publishes the proxy on. */
export const DEFAULT_PROXY_PORT = "4444";

export function localProxyEndpoint(url: URL): string {
  const proxyPort = url.searchParams.get("proxyPort") ?? DEFAULT_PROXY_PORT;
  return `http://${url.hostname}:${proxyPort}/sql`;
}
