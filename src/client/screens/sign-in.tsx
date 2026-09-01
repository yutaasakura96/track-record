/**
 * Sign-in.
 *
 * Google is the sole provider and there are no passwords in this system. An
 * identity outside the allowlist completes the Google flow and is then rejected
 * — the app is publicly reachable, sign-up is not
 * (`docs/08-auth-and-permissions.md` §1–2).
 */
import { useState } from "react";
import { api, type ApiError } from "../api";
import { Button } from "../components/ui";

export function SignIn({ reason }: { reason?: ApiError }) {
  const rejected = reason?.status === 403;
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * A POST, not a link. Better Auth exposes social sign-in only as
   * `POST /sign-in/social`, which answers with the Google authorization URL
   * rather than redirecting — there is no `GET /sign-in/{provider}` to point a
   * plain form at. The redirect is therefore ours to perform.
   */
  async function startGoogleSignIn() {
    setStarting(true);
    setFailed(false);
    try {
      const { url } = await api<{ url: string }>("/api/auth/sign-in/social", {
        method: "POST",
        body: JSON.stringify({ provider: "google", callbackURL: "/" }),
      });
      window.location.href = url;
    } catch {
      setStarting(false);
      setFailed(true);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center px-20">
      <div className="w-measure max-w-full text-center">
        <div className="app-mark mx-auto mb-20 size-16 rounded-chip" aria-hidden />
        <h1 className="text-page font-semibold tracking-tight text-text-bright">Track Record</h1>
        <p className="mt-8 text-ui text-text-dim">
          A structured record of one career, and every career document generated from it.
        </p>

        {rejected ? (
          <p className="mt-20 mx-auto max-w-measure border border-border-control rounded-control px-14 py-12 text-small text-text-muted">
            {reason.message} Sign-up here is by invitation, and it is not open.
          </p>
        ) : null}

        <div className="mt-26">
          <Button
            type="button"
            variant="primary"
            className="px-16 py-8"
            disabled={starting}
            disabledReason={starting ? "Opening Google…" : undefined}
            onClick={startGoogleSignIn}
          >
            Continue with Google
          </Button>
        </div>

        {failed ? (
          <p className="mt-16 text-small text-text-muted">
            Could not reach Google. Check your connection and try again.
          </p>
        ) : null}

        <p className="mt-16 text-smaller text-text-faint">
          Requests your name and email address, and nothing else. Never your mail, your files or
          your calendar.
        </p>
      </div>
    </main>
  );
}
