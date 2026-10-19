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
 */
import { useState } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { ApiError, failureText, useGenerate, useRenderPage, type RenderPage } from "../api";
import { PhoneFrame } from "../components/application-chrome";
import { DocumentPage } from "../components/document-page";
import { DownloadButton, WithheldFacts, withheldFacts } from "../components/download-button";
import { QUIET, SECONDARY } from "../components/document-row";
import { ReadFailure } from "../components/read-failure";
import { Button, Chip, Dot } from "../components/ui";
import { absolute } from "../format";

export function DocumentViewScreen() {
  const { ref } = useParams({ from: "/renders/$ref/view" });
  const { version } = useSearch({ from: "/renders/$ref/view" });
  const read = useRenderPage(ref, version);
  const data = read.data;

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
      <div className="bg-card border border-border rounded-tile px-20 max-phone:px-12">
        <DocumentPage page={data.page} language={data.language} />
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
  const [failure, setFailure] = useState<string | null>(null);
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
      setFailure(failureText(error));
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
      </p>
      <WithheldFacts facts={withheldFacts(error)} />
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
    </div>
  );
}
