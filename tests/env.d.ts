/**
 * `cloudflare:test` is provided by the Workers pool at runtime; this is where
 * its types come from.
 */
declare module "cloudflare:test" {
  interface ProvidedEnv extends Record<string, unknown> {}
  export const env: ProvidedEnv;
}
