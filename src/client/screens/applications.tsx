/**
 * Applications, the list (`docs/10-screen-specifications.md`, issue #70).
 *
 * Every job the author is looking at or has applied for, newest activity
 * first, with a status filter and the gone-quiet mark. It replaces the
 * Tailored résumés screen: each of those is here as an application.
 *
 * Gone quiet is said in words and a count, never in a colour, and nothing is
 * emailed: the mark is read when the author opens this screen.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useApplications, type ApplicationRow } from "../api";
import { ApplicationsFrame, QuietChip, StatusLine, days } from "../components/application-chrome";
import { ReadFailure, RefreshFailure } from "../components/read-failure";
import { ScreenIntro } from "../components/screen-intro";
import { FilterPill } from "../components/ui";
import { QUIET_DAYS, bucketOf, type StatusBucket } from "~/shared/application";
import { nameVersion } from "~/shared/application-documents";

/** `Button`'s primary, for a control that is a link and so cannot be a `Button`. */
const PRIMARY =
  "motion-surface whitespace-nowrap inline-flex items-center justify-center max-phone:min-h-control bg-accent text-on-accent px-12 py-6 rounded-control text-button font-medium hover:bg-accent-hover";

const FILTERS: [StatusBucket, string][] = [
  ["not_applied", "Not applied"],
  ["applied", "Applied"],
  ["resume_passed", "Résumé passed"],
  ["interviews", "Interviews"],
  ["offer", "Offer"],
  ["rejected", "Rejected"],
  ["withdrawn", "Withdrawn"],
];

const WHAT =
  "Every job you are looking at or have applied for. Each one keeps its job description and where it stands, with the date of every step.";

const ago = (n: number) => (n <= 0 ? "today" : `${days(n)} ago`);

export function ApplicationsScreen() {
  const applications = useApplications();
  const [filter, setFilter] = useState<StatusBucket | "all">("all");
  const [quietOnly, setQuietOnly] = useState(false);

  const all = applications.data?.items;
  const quiet = all?.filter((row) => row.quietDays !== null) ?? [];
  const shown = all?.filter(
    (row) => (filter === "all" || bucketOf(row) === filter) && (!quietOnly || row.quietDays !== null),
  );
  const showAll = () => {
    setFilter("all");
    setQuietOnly(false);
  };

  return (
    <ApplicationsFrame
      title="Applications"
      note="Jobs you are looking at, and where each one stands"
      action={
        <Link to="/applications/new" className={PRIMARY}>
          Add a job
        </Link>
      }
    >
      <ScreenIntro
        next={
          !all
            ? undefined
            : all.length === 0
              ? "add the first job you are looking at."
              : quiet.length > 0
                ? `${quiet.length === 1 ? "1 application has" : `${quiet.length} applications have`} gone quiet. Follow up, or close them as rejected or withdrawn.`
                : "nothing is waiting here. Add a job, or open one to move it to its next step."
        }
      >
        {WHAT}
      </ScreenIntro>

      {all && applications.isError ? <RefreshFailure query={applications} /> : null}
      {!all && applications.isError ? (
        <ReadFailure query={applications} />
      ) : !all || !shown ? (
        <p className="text-smaller text-text-dim">Loading your applications…</p>
      ) : all.length === 0 ? (
        <div className="border border-dashed border-border-dashed rounded-panel px-20 py-40 grid gap-12 justify-items-center text-center">
          <h2 className="text-page font-semibold tracking-tight text-text-bright">No applications yet</h2>
          <p className="max-w-measure text-ui text-text-secondary">
            Paste a job description to start. The company, the position and the key requirements are read out
            of it for you to check. After that the application holds the résumé you send, each step and its
            date, and a note of every interview.
          </p>
          <Link to="/applications/new" className={PRIMARY}>
            Add a job
          </Link>
          <p className="max-w-measure text-small text-text-muted">
            A job description is kept with its application. It is never a source of facts about you.
          </p>
        </div>
      ) : (
        <>
          <div role="group" aria-label="Show" className="flex flex-wrap items-center gap-4">
            <FilterPill active={filter === "all"} onClick={showAll}>
              All {all.length}
            </FilterPill>
            {FILTERS.map(([bucket, label]) => (
              <FilterPill key={bucket} active={filter === bucket} onClick={() => setFilter(bucket)}>
                {label} {all.filter((row) => bucketOf(row) === bucket).length}
              </FilterPill>
            ))}
            <span className="mx-6 w-px h-16 bg-border" aria-hidden />
            <FilterPill active={quietOnly} onClick={() => setQuietOnly(!quietOnly)}>
              Gone quiet {quiet.length}
            </FilterPill>
          </div>

          {/* A panel with the rows' own padding: a row is a link, and its hover fills to the edge. */}
          <section className="bg-surface-raised border border-border rounded-panel p-6">
            {shown.length === 0 ? (
              <p className="px-10 py-12 text-small text-text-muted">
                No application matches.{" "}
                <button
                  type="button"
                  onClick={showAll}
                  className="text-accent-link hover:text-accent-link-hover motion-tone"
                >
                  Show all
                </button>
              </p>
            ) : (
              <ul>
                {shown.map((row) => (
                  <Row key={row.id} row={row} />
                ))}
              </ul>
            )}
          </section>

          <p className="text-smaller text-text-muted">
            Newest activity first. Gone quiet means nothing has changed for {QUIET_DAYS} days while you are
            waiting to hear back. Nothing is emailed and nothing is sent to anyone.
          </p>
        </>
      )}
    </ApplicationsFrame>
  );
}

function Row({ row }: { row: ApplicationRow }) {
  const closed = row.closedAs !== null;
  const since = closed
    ? []
    : [
        row.daysSinceResumePassed !== null ? `${days(row.daysSinceResumePassed)} since the résumé passed` : null,
        row.daysSinceFirstInterview !== null
          ? `${days(row.daysSinceFirstInterview)} since the first interview`
          : null,
      ].filter((line) => line !== null);

  return (
    <li className="border-b border-border-inner last:border-b-0">
      <Link
        to="/applications/$applicationId"
        params={{ applicationId: row.id }}
        aria-label={`Open ${row.company}`}
        className="flex items-center gap-12 max-phone:flex-col max-phone:items-stretch max-phone:gap-6 px-10 py-12 rounded-control hover:bg-hover motion-surface"
      >
        <span className="min-w-0 flex-1 grid gap-2">
          <span className={`text-row font-medium ${closed ? "text-text-muted" : "text-text-strong"}`}>
            {row.company}
          </span>
          <span className="text-small text-text-muted">{row.position || "Position not filled in"}</span>
          <span className="flex flex-wrap items-center gap-x-12 gap-y-4 text-small text-text-muted">
            <span>{resumeLine(row)}</span>
            {since.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </span>
        </span>
        <span className="ml-auto max-phone:ml-0 shrink-0 grid gap-4 justify-items-end max-phone:justify-items-start">
          <StatusLine standing={row} />
          {row.quietDays !== null ? (
            <QuietChip quietDays={row.quietDays} />
          ) : (
            <span className="text-smaller text-text-muted">Last change {ago(row.daysSinceLastActivity)}</span>
          )}
        </span>
      </Link>
    </li>
  );
}

/** The latest sent copy of each document, or what is chosen and not sent yet. */
function resumeLine(row: ApplicationRow): string {
  const { documents, sent } = row.resume;
  if (documents.length === 0) return "No résumé yet";
  const named = documents.map(nameVersion).join(" + ");
  return sent ? named : `${named}, not sent`;
}
