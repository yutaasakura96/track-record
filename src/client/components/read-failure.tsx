/**
 * A read that failed, on the screens that cannot show anything without it:
 * Documents, the Overview and Skills.
 *
 * Every other failure state in `docs/10` carries its way out, and a failed read
 * carried none: the line said to try again with nothing to press but a reload.
 * **Retry** reads again. The line is the alert and the button sits beside it,
 * so the alert says what went wrong and nothing else.
 *
 * Retry needs no disabled state. A read that has never returned data goes back
 * to pending when it is fetched again, error cleared, so the screen shows its
 * loading state and this control is not on screen to be pressed twice.
 */
import { readFailureText } from "../api";
import { Button } from "./ui";

export interface FailedRead {
  error: unknown;
  refetch: () => unknown;
}

export function ReadFailure({ query, className = "" }: { query: FailedRead; className?: string }) {
  return (
    <div className={`flex items-center gap-12 ${className}`}>
      <p role="alert" className="text-small text-text-secondary">
        {readFailureText(query.error)}
      </p>
      <Button variant="ghost" onClick={() => void query.refetch()}>
        Retry
      </Button>
    </div>
  );
}

export interface FailedRefresh extends FailedRead {
  isFetching: boolean;
}

/**
 * A later read that failed, on the same three screens. The content it would have
 * replaced stays on screen, so this says only that it may be out of date.
 *
 * A status, not an alert: nothing the author did failed. Unlike a first read, a
 * query that has data keeps its error while it reads again (`fetchState` in
 * `@tanstack/query-core`), so this line and its Retry stay on screen while Retry
 * reads, and Retry is disabled until the read settles.
 */
export function RefreshFailure({ query, className = "" }: { query: FailedRefresh; className?: string }) {
  return (
    <div className={`flex items-center gap-12 ${className}`}>
      <p role="status" className="text-smaller text-text-dim">
        Could not refresh: {readFailureText(query.error)} What is shown may be out of date.
      </p>
      <Button
        variant="ghost"
        onClick={() => void query.refetch()}
        disabled={query.isFetching}
        disabledReason={query.isFetching ? "Retrying…" : undefined}
      >
        Retry
      </Button>
    </div>
  );
}
