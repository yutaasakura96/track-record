/**
 * Connect an app: the consent screen Better Auth's OAuth provider sends the
 * author to when a client such as claude.ai asks to connect (decision log
 * 2026-11-17). The query it arrives with is signed by the provider and is sent
 * back unchanged; this screen adds only the author's answer.
 *
 * Allowing it lets the app read the record and write to it through the MCP
 * tools, as the author could from Claude Desktop: facts added are graded and
 * flagged as an import's are, and a document arrives as a version to review.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui";

interface PublicClient {
  client_id: string;
  client_name?: string;
  client_uri?: string;
}

/** What each scope the provider can ask for means here, in the author's terms. */
const SCOPE_WORDS: Record<string, string> = {
  record: "Read your record and documents, add facts to it, and send new versions for you to review",
  openid: "Know that it is you",
  profile: "Your name",
  email: "Your email address",
  offline_access: "Stay connected until you disconnect it",
};

export function ConsentScreen() {
  const query = new URLSearchParams(window.location.search);
  const clientId = query.get("client_id") ?? "";
  const scopes = (query.get("scope") ?? "").split(" ").filter(Boolean);
  const [answering, setAnswering] = useState<boolean | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const client = useQuery({
    queryKey: ["oauth-client", clientId],
    queryFn: () => api<PublicClient>(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`),
    enabled: clientId !== "",
    retry: false,
  });

  async function answer(accept: boolean) {
    setAnswering(accept);
    setFailure(null);
    try {
      const { url } = await api<{ url: string }>("/api/auth/oauth2/consent", {
        method: "POST",
        body: JSON.stringify({ accept, oauth_query: query.toString() }),
      });
      window.location.href = url;
    } catch {
      setAnswering(null);
      setFailure("Your answer could not be sent. Start connecting again from the app.");
    }
  }

  const name = client.data?.client_name ?? "An app";
  const invalid = clientId === "" || !query.has("sig") || client.isError;

  return (
    <main className="min-h-screen grid place-items-center px-20">
      <div className="w-measure max-w-full">
        <div className="app-mark mb-20 size-16 rounded-chip" aria-hidden />
        {invalid ? (
          <>
            <h1 className="text-page font-semibold tracking-tight text-text-bright">This link has expired</h1>
            <p className="mt-8 text-ui text-text-dim">Start connecting again from the app that sent you here.</p>
          </>
        ) : (
          <>
            <h1 className="text-page font-semibold tracking-tight text-text-bright">
              {client.isPending ? "Connect an app" : `Connect ${name} to Track Record`}
            </h1>
            {client.data?.client_uri ? (
              <p className="mt-4 text-small text-text-muted">{client.data.client_uri}</p>
            ) : null}
            <p className="mt-16 text-ui text-text-dim">It is asking to:</p>
            <ul className="mt-8 flex flex-col gap-6 text-ui text-text-body">
              {scopes.map((scope) => (
                <li key={scope}>• {SCOPE_WORDS[scope] ?? scope}</li>
              ))}
            </ul>
            <p className="mt-16 text-small text-text-muted">
              Private facts, and facts nobody has graded past Generated, stay out of every document, as they
              do here. Nothing it writes becomes a version of a document until you accept it.
            </p>
            <div className="mt-26 flex gap-12">
              <Button
                type="button"
                variant="primary"
                className="px-16 py-8"
                disabled={answering !== null || client.isPending}
                disabledReason={client.isPending ? "Reading which app this is…" : answering === true ? "Connecting…" : "Sending your answer…"}
                onClick={() => void answer(true)}
              >
                Allow
              </Button>
              <Button
                type="button"
                className="px-16 py-8"
                disabled={answering !== null}
                disabledReason={answering === false ? "Sending your answer…" : "Connecting…"}
                onClick={() => void answer(false)}
              >
                Don't allow
              </Button>
            </div>
          </>
        )}
        {failure ? <p className="mt-16 text-small text-text-muted">{failure}</p> : null}
      </div>
    </main>
  );
}
