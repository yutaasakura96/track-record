/**
 * Extraction progress (`docs/10` Shared chrome, `docs/05` §7).
 *
 * Wherever the author waits on an import, this block says three things: that
 * work is under way, how far along it is, and that they can carry on. Reading
 * one portfolio took 150 sections, and the only sign of it used to be a 96px
 * bar on one row of one screen (issue #56).
 *
 * The percentage counts sections read. It is not a confidence in anything
 * (`docs/05` §9, rule 12).
 */
import type { ImportStatus } from "../api";
import { ProgressBar } from "./ui";

export function ExtractionProgress({
  status,
  chunksDone,
  chunksTotal,
  meanwhile,
  className = "",
}: {
  status: ImportStatus["status"];
  chunksDone: number;
  chunksTotal: number;
  /** What the author can do on this surface while they wait, as one sentence. */
  meanwhile: string;
  className?: string;
}) {
  // `queued`, or extracting before the document has been split: there is no
  // total to be a fraction of yet, and 0% of nothing is not a fact.
  const counted = status === "extracting" && chunksTotal > 0;
  const percent = counted ? Math.min(99, Math.floor((chunksDone / chunksTotal) * 100)) : null;
  const title = counted ? "Reading the document" : "Getting ready to read this document";

  return (
    <div className={`bg-surface-raised border border-border-control rounded-tile px-14 py-12 grid gap-8 ${className}`}>
      <div className="flex items-center gap-8">
        <span className="size-6 rounded-full bg-accent motion-working shrink-0" aria-hidden />
        <span className="text-row font-medium text-text-strong">{title}</span>
        {percent !== null ? (
          <span className="ml-auto text-row font-semibold text-text-bright tabular-nums">{percent}%</span>
        ) : null}
      </div>
      <div
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <ProgressBar size="block" value={percent === null ? 0 : percent / 100} />
      </div>
      <p aria-live="polite" className="text-small text-text-secondary">
        {counted
          ? `${chunksDone} of ${chunksTotal} sections read. Still working, please wait: a long document takes several minutes. ${meanwhile}`
          : "Still working, please wait. This page updates on its own."}
      </p>
    </div>
  );
}
