/**
 * One document on a list: what it is, where it stands, and its one action
 * (`docs/10` Screen 3). Home lists the five main documents with it and the
 * Tailored résumés screen lists its own, so a tailored résumé reads and
 * behaves exactly as the document it is a variant of.
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { RenderRow } from "../api";
import type { RenderKind } from "~/shared/render-content";
import { relative } from "../format";
import { DownloadButton } from "./download-button";
import { Button, Dot } from "./ui";

const number = (n: number) => n.toLocaleString("en-US");

/** A text link inside a row: quieter than a button, for what is not the row's one action. */
export const QUIET = "text-small text-accent-link hover:text-accent-link-hover motion-tone whitespace-nowrap";
/** `Button`'s secondary, for a control that is a link and so cannot be a `Button`. */
export const SECONDARY =
  "motion-surface whitespace-nowrap inline-flex items-center justify-center max-phone:min-h-control border border-border-strong text-text-secondary px-14 py-8 rounded-control text-micro font-medium hover:bg-hover";

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
            {/* Read in the app, as the download would hold it (issue #106). */}
            <Link to="/renders/$ref/view" params={{ ref: row.ref }} className={QUIET}>
              View
            </Link>
            <Link to="/renders/$ref/history" params={{ ref: row.ref }} className={QUIET}>
              History
            </Link>
            <EditLink row={row} />
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

/** `Button`'s ghost, for a control that is a link and so cannot be a `Button`. */
const GHOST =
  "motion-surface whitespace-nowrap inline-flex items-center justify-center max-phone:min-h-control border border-border-strong text-text-muted px-10 py-6 rounded-control text-small font-medium hover:bg-hover hover:text-text-secondary";

/**
 * The row's ONE button. View, History and Download are links beside it.
 * `quiet` sets it a step down, where View leads (Home's document cards, #111).
 */
export function Action({
  row,
  canGenerate,
  busy,
  onGenerate,
  quiet = false,
}: {
  row: RenderRow;
  canGenerate: boolean;
  busy: boolean;
  onGenerate: () => void;
  quiet?: boolean;
}) {
  if (!row.buildable) return null;
  if (row.pendingProposalId) {
    return (
      <Link to="/proposals/$proposalId" params={{ proposalId: row.pendingProposalId }} className={quiet ? GHOST : SECONDARY}>
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
      variant={quiet || row.status === "up_to_date" ? "ghost" : "secondary"}
      onClick={onGenerate}
      disabled={busy}
      disabledReason={busy ? "Generating…" : undefined}
    >
      {label}
    </Button>
  );
}

/**
 * `Edit` wherever a document is listed or read (`docs/06`, 2026-11-04): a
 * small fix is a hand edit, not a paid regeneration. It opens what can be
 * edited NOW. While a draft waits, editing the current version is refused
 * (a later accept would discard the edit), so it opens the draft instead;
 * while one is being written, there is nothing to open and it is absent.
 */
export function EditLink({
  row,
  className = QUIET,
}: {
  row: Pick<RenderRow, "ref" | "status" | "currentVersionId" | "pendingProposalId">;
  className?: string;
}) {
  if (row.status === "proposal_generating") return null;
  if (row.status === "proposal_pending" && row.pendingProposalId) {
    return (
      <Link
        to="/proposals/$proposalId/edit"
        params={{ proposalId: row.pendingProposalId }}
        className={className}
      >
        Edit draft
      </Link>
    );
  }
  if (!row.currentVersionId) return null;
  return (
    <Link to="/renders/$ref/edit" params={{ ref: row.ref }} className={className}>
      Edit
    </Link>
  );
}

/**
 * What each document takes from the record at every download rather than from
 * its stored text — so what changing it there spares a regeneration of. Only
 * what is true of that document: a career story prints a name and contact
 * details and nothing from the timeline.
 */
const FILLED_FROM_RECORD: Record<RenderKind, { profile: string; timeline: string | null }> = {
  english_resume: { profile: "name and contact details", timeline: "each job's employer, title and dates" },
  rirekisho: {
    profile: "name, contact details and photo",
    timeline: "the education, employment and qualification tables",
  },
  shokumu_keirekisho: {
    profile: "name and contact details",
    timeline: "each employer's period, employment type and roles",
  },
  career_story_en: { profile: "name and contact details", timeline: null },
  career_story_ja: { profile: "name and contact details", timeline: null },
};

/**
 * The one line beside Generate again (`docs/10` Screen 3, Screen 17): names,
 * contact details, the photo and dates are not the generated text, and fixing
 * them needs no regeneration. Without `kind` it speaks for every document.
 */
export function FilledFromRecord({
  kind,
  compact = false,
  className = "",
}: {
  kind?: RenderKind;
  /** At the smaller role, for a footer already set in it. */
  compact?: boolean;
  className?: string;
}) {
  const filled = kind
    ? FILLED_FROM_RECORD[kind]
    : { profile: "name, contact details and photo", timeline: "the job and school rows with their dates" };
  return (
    <p className={`${compact ? "text-smaller" : "text-small"} text-text-muted ${className}`}>
      Your {filled.profile} come from your{" "}
      <Link to="/profile" className={QUIET}>
        Profile
      </Link>
      {filled.timeline ? (
        <>
          , and {filled.timeline} from your{" "}
          <Link to="/record" className={QUIET}>
            Career timeline
          </Link>
        </>
      ) : null}
      . Every download reads them again, so changing them there needs no regenerating. To change a sentence, edit it.
    </p>
  );
}
