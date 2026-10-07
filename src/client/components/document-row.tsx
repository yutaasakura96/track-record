/**
 * One document on a list: what it is, where it stands, and its one action
 * (`docs/10` Screen 3). Home lists the five main documents with it and the
 * Tailored résumés screen lists its own, so a tailored résumé reads and
 * behaves exactly as the document it is a variant of.
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { RenderRow } from "../api";
import { relative } from "../format";
import { DownloadButton } from "./download-button";
import { Button, Dot } from "./ui";

const number = (n: number) => n.toLocaleString("en-US");

/** A text link inside a row: quieter than a button, for what is not the row's one action. */
export const QUIET = "text-small text-accent-link hover:text-accent-link-hover motion-tone whitespace-nowrap";
/** `Button`'s secondary, for a control that is a link and so cannot be a `Button`. */
export const SECONDARY =
  "motion-surface whitespace-nowrap border border-border-strong text-text-secondary px-14 py-8 rounded-control text-micro font-medium hover:bg-hover";

export function DocumentRow({
  row,
  canGenerate,
  busy,
  onGenerate,
  title = row.title,
  note,
}: {
  row: RenderRow;
  canGenerate: boolean;
  busy: boolean;
  onGenerate: () => void;
  title?: string;
  /** Said under the title in place of the language, where the list is all one language. */
  note?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-12 px-10 py-12 border-b border-border-inner last:border-b-0">
      <div className="min-w-0">
        {/* Japanese titles render in the mixed stack — the body default. */}
        <div className="text-row font-medium text-text-strong">{title}</div>
        <div className="text-small text-text-muted">
          {note ?? (row.language === "ja" ? "Japanese" : "English")}
          {row.generatedAt ? ` · generated ${relative(row.generatedAt)}` : ""}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-16">
        <StatusText row={row} />
        {/* Offered only once there is something to read or to download:
            the row already says `Not generated yet`. */}
        {row.currentVersionId ? (
          <>
            <Link to="/renders/$ref/history" params={{ ref: row.ref }} className={QUIET}>
              History
            </Link>
            {/* One word on every row, so the rows line up: the file's type
                differs by document and is the document's own business. */}
            <DownloadButton kind={row.kind} docRef={row.ref} label="Download" className={QUIET} />
          </>
        ) : null}
        <Action row={row} canGenerate={canGenerate} busy={busy} onGenerate={onGenerate} />
      </div>
    </li>
  );
}

function StatusText({ row }: { row: RenderRow }) {
  const line = "flex items-center gap-6 text-small whitespace-nowrap";
  if (!row.buildable) {
    return (
      <span className={`${line} text-text-muted`}>
        <Dot tone="muted" /> Not available yet
      </span>
    );
  }
  if (row.status === "proposal_pending") {
    return (
      <span className={`${line} text-accent-text`}>
        <Dot tone="accent" /> New version waiting
      </span>
    );
  }
  if (row.status === "proposal_generating") {
    return (
      <span className={`${line} text-accent-text`}>
        <Dot tone="accent" /> Writing a new version
      </span>
    );
  }
  if (row.status === "never_generated") {
    return (
      <span className={`${line} text-text-muted`}>
        <Dot tone="muted" /> Not generated yet
      </span>
    );
  }
  if (row.status === "stale") {
    const n = row.newFactsSince ?? 0;
    const gone = row.withdrawnFactsSince ?? 0;
    const arrived = `${number(n)} new ${n === 1 ? "fact" : "facts"}`;
    return (
      <span className={`${line} text-accent-text`}>
        <Dot tone="accent" />{" "}
        {gone === 0
          ? arrived
          : n === 0
            ? `${number(gone)} ${gone === 1 ? "fact" : "facts"} no longer usable`
            : `${arrived}, ${number(gone)} no longer usable`}
      </span>
    );
  }
  return (
    <span className={`${line} text-measured-text`}>
      <Dot tone="measured" /> Up to date
    </span>
  );
}

/** The row's ONE button. History and Download are links beside it. */
function Action({
  row,
  canGenerate,
  busy,
  onGenerate,
}: {
  row: RenderRow;
  canGenerate: boolean;
  busy: boolean;
  onGenerate: () => void;
}) {
  if (!row.buildable) return null;
  if (row.pendingProposalId) {
    return (
      <Link to="/proposals/$proposalId" params={{ proposalId: row.pendingProposalId }} className={SECONDARY}>
        {row.status === "proposal_generating" ? "Open it" : "Review changes"}
      </Link>
    );
  }
  // Not offered at all rather than disabled five times over: the line above the
  // rows is the reason, said once.
  if (!canGenerate) return null;

  const label =
    row.status === "never_generated" ? "Generate" : row.status === "stale" ? "Update" : "Regenerate";
  return (
    <Button
      variant={row.status === "up_to_date" ? "ghost" : "secondary"}
      onClick={onGenerate}
      disabled={busy}
      disabledReason={busy ? "Generating…" : undefined}
    >
      {label}
    </Button>
  );
}
