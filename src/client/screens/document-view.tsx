/**
 * Screen 17 — Reading a document (`docs/10-screen-specifications.md`, issue
 * #106).
 *
 * The sent-copy reader (Screen 15), for a version: the page its download would
 * hold today, read without downloading it. Read-only, so it opens at any width.
 *
 * The page is assembled by the server from the inputs the download uses, and
 * refused on the facts the download refuses. What is read here is what would
 * leave the tool, not the stored content as it was accepted.
 *
 * "Show where each line comes from" (issue #110, S6) turns each line into a
 * button that opens the facts it was written from, under it, with each fact's
 * passage and the way into Fact Review.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ApiError, useGenerate, useRenderPage, type RenderPage } from "../api";
import { PhoneFrame } from "../components/application-chrome";
import { DocumentPage, type Trace } from "../components/document-page";
import { generateFailure, JobHeaderLinks } from "../components/generate-failure";
import { DownloadButton, WithheldFacts, withheldFacts } from "../components/download-button";
import { QUIET, SECONDARY } from "../components/document-row";
import { ReadFailure } from "../components/read-failure";
import { Button, Chip, Dot } from "../components/ui";
import { absolute } from "../format";
import { BY_HAND, WORTH_WORDS, type FactEvidence } from "~/shared/evidence";

export function DocumentViewScreen() {
  const { ref } = useParams({ from: "/renders/$ref/view" });
  const { version } = useSearch({ from: "/renders/$ref/view" });
  const read = useRenderPage(ref, version);
  const data = read.data;
  const [tracing, setTracing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  // Another version is another page: the line chosen on the last one is not on it.
  const versionId = data?.version.id;
  useEffect(() => setSelected(null), [versionId]);

  if ((read.error instanceof ApiError && read.error.status === 409) || !data) {
    const status = read.error instanceof ApiError ? read.error.status : null;
    return (
      <PhoneFrame title={status === 404 ? "Not found" : "Document"} back={{ to: "/", label: "Home" }}>
        {status === 409 ? (
          <Withheld docRef={ref} current={version === undefined} error={read.error as ApiError} />
        ) : read.isError && status !== 404 ? (
          <ReadFailure query={read} />
        ) : (
          <p className="text-ui text-text-dim">
            {status === 404 ? "That document or version was not found." : "Opening the document…"}
          </p>
        )}
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame
      title={data.title}
      back={data.tailored ? { to: "/applications", label: "Applications" } : { to: "/", label: "Home" }}
    >
      <Notice view={data} />
      {/* A 履歴書 version stores two prose blocks, and its three tables are
          filled from the record when it is read, as Screen 5 says. */}
      {data.renderKind === "rirekisho" ? (
        <p className="text-smaller text-text-dim">
          The education, employment and qualification tables are filled from your record as it is now, as the
          download is.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-12 gap-y-6">
          <Button
            variant="ghost"
            aria-pressed={tracing}
            onClick={() => {
              setTracing(!tracing);
              setSelected(null);
            }}
            className={tracing ? "bg-hover text-text-secondary" : ""}
          >
            Show where each line comes from
          </Button>
          {tracing ? (
            <p className="text-small text-text-muted">Choose a line to see the facts behind it and where each is quoted from.</p>
          ) : null}
      </div>
      <div className="bg-card border border-border rounded-tile px-20 max-phone:px-12">
        <DocumentPage
          page={data.page}
          language={data.language}
          trace={tracing ? trace(data.evidence, selected, setSelected) : undefined}
        />
      </div>
    </PhoneFrame>
  );
}

const ORIGIN: Record<RenderPage["version"]["origin"], string> = {
  accepted: "Accepted",
  restored: "Restored",
  edited: "Edited by hand",
};

/** The version, its date, and what can be done with it. */
function Notice({ view }: { view: RenderPage }) {
  const { version, document } = view;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-x-12 gap-y-8 border border-border-control bg-surface-raised rounded-control px-10 py-8 text-small text-text-secondary">
        <Chip>v{version.versionNo}</Chip>
        {version.isCurrent ? (
          <span className="flex items-center gap-6 text-smaller text-measured-text">
            <Dot tone="measured" /> Current
          </span>
        ) : null}
        <span className="min-w-0 flex-1 max-phone:basis-full">
          {/* A system timestamp, absolute — month precision never applies here. */}
          {ORIGIN[version.origin]}{" "}
          <span className="font-mono">{absolute(version.acceptedAt)}</span>.{" "}
          {version.isCurrent
            ? "This is the document as its download holds it today."
            : "An earlier version, as its download holds it today."}
          {version.isCurrent ? null : (
            <>
              {" "}
              <Link to="/renders/$ref/view" params={{ ref: view.renderRef }} search={{}} className={QUIET}>
                Read the current version
              </Link>
            </>
          )}
        </span>
        <span className="ml-auto max-phone:ml-0 flex flex-wrap items-center gap-12">
          <DownloadButton kind={view.renderKind} docRef={view.renderRef} versionId={version.id} label="Download" className={QUIET} />
          <Link to="/renders/$ref/history" params={{ ref: view.renderRef }} className={QUIET}>
            History
          </Link>
          {version.isCurrent ? (
            <Link to="/renders/$ref/edit" params={{ ref: view.renderRef }} className={QUIET}>
              Edit
            </Link>
          ) : null}
          {version.isCurrent ? <NewVersion view={view} /> : null}
          {view.tailored && view.applicationId ? (
            <Link
              to="/applications/$applicationId"
              params={{ applicationId: view.applicationId }}
              className="text-text-dim px-6 py-4 rounded-chip text-smaller hover:bg-border hover:text-text-secondary motion-surface whitespace-nowrap"
            >
              Back to the application
            </Link>
          ) : null}
        </span>
      </div>
      {document.status === "proposal_pending" || document.status === "proposal_generating" ? (
        <p className="text-small text-text-muted">
          A new version is {document.status === "proposal_generating" ? "being written" : "waiting for you"}. This page
          stays as it is until you accept it.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The header's one button, as Home's row has it: the waiting proposal's
 * review, or a new version, worded by where the document stands.
 */
function NewVersion({ view }: { view: RenderPage }) {
  const generate = useGenerate();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<ReactNode>(null);
  const { document } = view;

  if (!document.buildable) return null;
  if (document.pendingProposalId) {
    return (
      <Link to="/proposals/$proposalId" params={{ proposalId: document.pendingProposalId }} className={SECONDARY}>
        {document.status === "proposal_generating" ? "Open it" : "Review changes"}
      </Link>
    );
  }
  // Not offered rather than disabled: there is no fact to write it from, and
  // Home says so once.
  if (!view.canGenerate) return null;

  const write = async () => {
    setFailure(null);
    try {
      const made = await generate.mutateAsync(view.renderRef);
      await navigate({ to: "/proposals/$proposalId", params: { proposalId: made.proposalId } });
    } catch (error) {
      setFailure(generateFailure(error));
    }
  };

  return (
    <>
      <Button
        variant={document.status === "stale" ? "secondary" : "ghost"}
        onClick={() => void write()}
        disabled={generate.isPending}
        disabledReason="Generating…"
      >
        {document.status === "stale" ? "Update" : "Regenerate"}
      </Button>
      {failure ? (
        <p role="alert" className="basis-full text-small text-removed">
          {failure}
        </p>
      ) : null}
    </>
  );
}

/**
 * The download's refusal, said where the page would be. The record changed
 * under the version, and the way out is the record or an edit, as the
 * download's dialog says.
 */
function Withheld({ docRef, current, error }: { docRef: string; current: boolean; error: ApiError }) {
  return (
    <div className="grid gap-6 text-small text-text-secondary">
      <p role="alert" className="text-removed">
        {error.message}
        <JobHeaderLinks error={error} />
      </p>
      <WithheldFacts facts={withheldFacts(error)} />
      {/* A job header's gap is closed by its links, in the record; no fact or edit closes it. */}
      {error.details.jobHeaders ? null : (
        <p>
          A document obeys your record as it is today, not as it was when this version was accepted. Change the
          fact in your record, or edit the block out into a new version.
          {/* An edit is made from the current version, so it is the way out only for that one. */}
          {current ? (
            <>
              {" "}
              <Link to="/renders/$ref/edit" params={{ ref: docRef }} className={QUIET}>
                Edit
              </Link>
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}

function trace(evidence: FactEvidence[], selected: string | null, onSelect: (key: string | null) => void): Trace {
  const byId = new Map(evidence.map((fact) => [fact.id, fact]));
  return { selected, onSelect, behind: (block) => <BehindLine factIds={block.factIds ?? []} byId={byId} /> };
}

/**
 * What stands behind one line: its facts, each with its worth, its employer
 * and its passage. Interface chrome, so English under a Japanese document too.
 */
function BehindLine({ factIds, byId }: { factIds: string[]; byId: Map<string, FactEvidence> }) {
  return (
    <section
      lang="en"
      aria-label="Behind this line"
      // The page's Japanese tracking is the document's, not the interface's:
      // back to the browser's own spacing, which no token names.
      style={{ letterSpacing: "normal" }}
      className="grid gap-8 bg-surface-raised border border-border rounded-tile px-12 py-10"
    >
      {factIds.length === 0 ? (
        <p className="text-small text-text-secondary">
          No fact behind this line. It is copied from your record as it stands, not written from a claim.
        </p>
      ) : (
        <>
          <p className="text-small text-text-secondary">
            {factIds.length === 1 ? "1 fact" : `${factIds.length} facts`} from your record.
          </p>
          <ul className="grid gap-8 list-none">
            {factIds.flatMap((id) => {
              const fact = byId.get(id);
              return fact ? [<EvidenceCard key={id} fact={fact} />] : [];
            })}
          </ul>
        </>
      )}
    </section>
  );
}

const WORTH_TONE: Record<FactEvidence["provenance"], string> = {
  measured: "bg-add-idle text-measured-text",
  attested: "bg-mark-selected text-accent-text",
};

const CHIP = "inline-flex items-center rounded-chip border border-transparent px-6 py-2 text-smaller";

function EvidenceCard({ fact }: { fact: FactEvidence }) {
  const { source } = fact;
  return (
    <li className="grid gap-6 bg-card border border-border rounded-control px-10 py-8">
      <p className="text-ui text-text-strong">{fact.claim}</p>
      <p className="flex flex-wrap gap-6">
        <span className={`${CHIP} ${WORTH_TONE[fact.provenance]}`}>{WORTH_WORDS[fact.provenance]}</span>
        {source === null ? <span className={`${CHIP} bg-chip border-border-control text-text-muted`}>{BY_HAND}</span> : null}
        <span className={`${CHIP} bg-chip border-border-control text-text-secondary`}>{fact.employer ?? "No employer"}</span>
      </p>
      {source ? (
        <>
          {fact.quote ? (
            <blockquote className="border-l border-border-strong pl-10 text-small text-text-secondary whitespace-pre-wrap break-words">
              {fact.quote}
            </blockquote>
          ) : <p className="text-smaller text-text-muted">No quoted passage was saved for this fact.</p>}
          <p className="flex flex-wrap items-center gap-x-8 gap-y-4 text-smaller text-text-muted">
            <span className="min-w-0 break-all">
              {source.filename}
              {source.lineNumber === null ? "" : `, line ${source.lineNumber}`}
            </span>
            <Link
              to="/imports/$importId"
              params={{ importId: source.importId }}
              search={{ fact: fact.id }}
              className="text-accent-link hover:text-accent-link-hover underline"
            >
              Open in source
            </Link>
          </p>
        </>
      ) : (
        <p className="text-smaller text-text-muted">
          Saved on Quick capture, so there is no passage to quote.{" "}
          <Link to="/capture" search={{ fact: fact.id }} className="text-accent-link hover:text-accent-link-hover underline">
            Open it in Quick capture
          </Link>
        </p>
      )}
    </li>
  );
}
