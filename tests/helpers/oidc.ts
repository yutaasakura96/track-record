/**
 * The local OIDC issuer (`./oidc-issuer.ts`), wired to the suite's bindings.
 *
 * Split from the issuer itself so that the issuer carries no `cloudflare:test`
 * import and `scripts/dev-session.ts` can run it under Node.
 */
import { env } from "cloudflare:test";
import type { Bindings } from "~/server/env";
import { createIssuer, type FixtureIssuer } from "./oidc-issuer";

export * from "./oidc-issuer";

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
