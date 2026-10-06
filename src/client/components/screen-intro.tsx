/**
 * The screen intro (`docs/10` Shared chrome).
 *
 * Two lines at the top of a sidebar screen: what the screen is for, and the one
 * thing to do now. The author's first pass through Documents and Review was not
 * self-explanatory (issue #56), and nothing on either said what it was.
 *
 * Not dismissible. A tour teaches the first visit and abandons the second; a
 * `Next:` computed from the screen's state is still true on the hundredth.
 */
import type { ReactNode } from "react";

export function ScreenIntro({
  children,
  next,
  legend,
}: {
  /** What the screen is for, in one or two plain sentences. */
  children: ReactNode;
  /** The one thing to do now. "Nothing is waiting" is an answer too. */
  next?: ReactNode;
  /** What the counts on this screen mean, where it shows any. */
  legend?: ReactNode;
}) {
  return (
    <section aria-label="About this screen" className="grid gap-6">
      <p className="text-ui text-text-secondary">{children}</p>
      {next ? <NextStep>{next}</NextStep> : null}
      {legend ? <p className="text-smaller text-text-dim">{legend}</p> : null}
    </section>
  );
}

/** The `Next:` line on its own, for the focused screens that say it in place. */
export function NextStep({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-ui text-text-strong ${className}`}>
      <span className="font-semibold">Next:</span> {children}
    </p>
  );
}
