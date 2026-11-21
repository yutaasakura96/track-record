/**
 * Connected apps: the clients the author allowed on the consent screen, and the
 * way to end one (`docs/specs/mcp-spike.md`, decision log 2026-11-21).
 *
 * A connection is a consent row. Disconnecting deletes the author's consents
 * and refresh tokens for that client, and the access tokens issued from them
 * go with the refresh tokens by cascade. A JWT access token already out holds
 * for its hour on its own, so `/api/mcp` also asks for the consent row on every
 * request: with it gone, the next call is refused, and the client has to send
 * the author through sign-in and consent again.
 *
 * The client registration itself stays: it belongs to Claude, not to the author,
 * and connecting again reuses it.
 */
import type { Hono } from "hono";
import { and, desc, eq, max } from "drizzle-orm";
import { oauthClients, oauthConsents, oauthRefreshTokens } from "../db/schema";
import { notFound, pathParam } from "../http/errors";
import { routes } from "../http/registry";
import type { AppEnv } from "../env";

export interface Connection {
  clientId: string;
  /** The name the client registered with, or null when it gave none. */
  name: string | null;
  /** Where Allow sent the code: the host of its first redirect. */
  host: string | null;
  connectedAt: string;
  /** The last time it signed in or refreshed, or null when it never has since allowing. */
  lastUsedAt: string | null;
}

const hostOf = (uri: string | undefined): string | null => {
  if (!uri) return null;
  try {
    return new URL(uri).host;
  } catch {
    return null;
  }
};

const iso = (value: Date | string | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

export function registerConnectionRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  /** Every client the author allowed, newest first. */
  api.get("/api/connections", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const lastUsed = db
      .select({ clientId: oauthRefreshTokens.clientId, at: max(oauthRefreshTokens.createdAt).as("at") })
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.userId, user.id))
      .groupBy(oauthRefreshTokens.clientId)
      .as("last_used");
    const rows = await db
      .select({
        clientId: oauthConsents.clientId,
        name: oauthClients.name,
        redirectUris: oauthClients.redirectUris,
        connectedAt: oauthConsents.createdAt,
        lastUsedAt: lastUsed.at,
      })
      .from(oauthConsents)
      .innerJoin(oauthClients, eq(oauthClients.clientId, oauthConsents.clientId))
      .leftJoin(lastUsed, eq(lastUsed.clientId, oauthConsents.clientId))
      .where(eq(oauthConsents.userId, user.id))
      .orderBy(desc(oauthConsents.createdAt));

    const items: Connection[] = rows.map((row) => ({
      clientId: row.clientId,
      name: row.name,
      host: hostOf(row.redirectUris[0]),
      connectedAt: iso(row.connectedAt)!,
      lastUsedAt: iso(row.lastUsedAt),
    }));
    return c.json({ items });
  });

  /**
   * Ends a connection at once. `204`; `404` when the author has no consent for
   * that client, including a client another user allowed.
   */
  api.delete("/api/connections/:clientId", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const clientId = pathParam(c, "clientId");

    // One transaction (`db.batch`, as `db/client.ts` explains): the consent and
    // the refresh tokens go together or not at all.
    const [consents, tokens] = await db.batch([
      db
        .delete(oauthConsents)
        .where(and(eq(oauthConsents.userId, user.id), eq(oauthConsents.clientId, clientId)))
        .returning({ id: oauthConsents.id }),
      db
        .delete(oauthRefreshTokens)
        .where(and(eq(oauthRefreshTokens.userId, user.id), eq(oauthRefreshTokens.clientId, clientId)))
        .returning({ id: oauthRefreshTokens.id }),
    ]);
    if (consents.length === 0 && tokens.length === 0) throw notFound("That connection");

    console.log(JSON.stringify({ event: "connection_ended", clientId, refreshTokens: tokens.length }));
    return c.body(null, 204);
  });
}
