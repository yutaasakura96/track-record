/**
 * Connected apps, on the profile (decision log 2026-11-21).
 *
 * The clients the author allowed on the consent screen — claude.ai, in
 * practice — each with where it sends the author back to, when it was allowed
 * and when it last signed in. Disconnect ends it at once: its next call is
 * refused, and connecting again goes through sign-in and Allow. Nothing in the
 * record changes either way.
 */
import { failureText, useConnections, useDisconnect, type Connection } from "../api";
import { absolute, relative } from "../format";
import { Button, Panel } from "./ui";

const label = (connection: Connection) => connection.name ?? connection.host ?? "An unnamed app";

export function ConnectedApps() {
  const connections = useConnections();
  const disconnect = useDisconnect();

  const items = connections.data ?? [];
  return (
    <Panel heading="Connected apps">
      <p className="text-small text-text-dim">
        Apps you allowed to read your record and save drafts to it. Disconnecting one stops it at once; connecting
        again asks you to sign in and allow it.
      </p>
      {connections.isPending ? (
        <p className="mt-14 text-small text-text-dim">Loading…</p>
      ) : connections.isError ? (
        <p role="alert" className="mt-14 text-smaller text-removed">
          {failureText(connections.error)}
        </p>
      ) : items.length === 0 ? (
        <p className="mt-14 text-small text-text-faint">No app is connected.</p>
      ) : (
        <ul className="mt-14 grid">
          {items.map((connection) => {
            const ending = disconnect.isPending && disconnect.variables === connection.clientId;
            return (
              <li
                key={connection.clientId}
                className="flex flex-wrap items-center gap-12 border-t border-border-inner py-12 first:border-t-0 first:pt-0"
              >
                <div className="mr-auto grid gap-2">
                  <span className="text-ui text-text-strong">{label(connection)}</span>
                  <span className="text-smaller text-text-faint">
                    {connection.host ? `Sends you back to ${connection.host} · ` : ""}
                    Allowed {absolute(connection.connectedAt)}
                    {connection.lastUsedAt ? ` · Last signed in ${relative(connection.lastUsedAt)}` : ""}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  aria-label={`Disconnect ${label(connection)}`}
                  disabled={disconnect.isPending}
                  disabledReason="Waiting for the server to end a connection."
                  onClick={() => disconnect.mutate(connection.clientId)}
                >
                  {ending ? "Disconnecting…" : "Disconnect"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {disconnect.isError ? (
        <p role="alert" className="mt-8 text-smaller text-removed">
          {failureText(disconnect.error)} The app is still connected.
        </p>
      ) : null}
    </Panel>
  );
}
