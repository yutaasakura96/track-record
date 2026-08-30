/**
 * Sign-in.
 *
 * Google is the sole provider and there are no passwords in this system. An
 * identity outside the allowlist completes the Google flow and is then rejected
 * — the app is publicly reachable, sign-up is not
 * (`docs/08-auth-and-permissions.md` §1–2).
 */
import type { ApiError } from "../api";
import { Button } from "../components/ui";

export function SignIn({ reason }: { reason?: ApiError }) {
  const rejected = reason?.status === 403;

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

        <form method="get" action="/api/auth/sign-in/google" className="mt-26">
          <Button type="submit" variant="primary" className="px-16 py-8">
            Continue with Google
          </Button>
        </form>

        <p className="mt-16 text-smaller text-text-faint">
          Requests your name and email address, and nothing else. Never your mail, your files or
          your calendar.
        </p>
      </div>
    </main>
  );
}
