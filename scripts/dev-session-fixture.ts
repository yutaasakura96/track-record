/**
 * The invented identity and client `npm run dev:session` signs in with, apart
 * from `./dev-session-core.ts` so a reader of the values loads no server code.
 */
import type { IssuerCredentials, OidcIdentity } from "../tests/helpers/oidc-issuer";

/**
 * The local test user. Invented, like every fixture here, and the same on every
 * run: Better Auth finds the account by provider subject, so a second run signs
 * the same user in again rather than creating another one.
 */
export const DEV_SESSION_IDENTITY: OidcIdentity = {
  sub: "dev-session-local",
  email: "dev-session@example.invalid",
  name: "Dev Session",
};

/**
 * What the in-process Better Auth and the fixture issuer agree on. Not a Google
 * client: the script never reads `GOOGLE_CLIENT_*` from `.dev.vars`, because the
 * session cookie does not depend on them and the real ones have no business here.
 */
export const DEV_SESSION_CLIENT: IssuerCredentials = {
  clientId: "dev-session-fixture-client",
  clientSecret: "dev-session-fixture-secret",
};
