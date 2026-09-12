/**
 * Screen 2 — Diff Review (`docs/10-screen-specifications.md`).
 *
 * Decide whether a regenerated document replaces the current one. The gate that
 * makes generation safe.
 *
 * Two rules this screen holds:
 *   - **Accept is all-or-nothing.** There is no per-change accept. If a
 *     proposed line is wrong, the fix is the underlying fact.
 *   - **Every change carries a rationale.** A change with no explanation is a
 *     defect, not a tolerable gap.
 */
import { useMemo } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  downloadUrl,
  useDecideProposal,
  useDiff,
  useProposal,
  type DiffChange,
  type Proposal,
} from "../api";
import { Button, Chip, Dot, Mono } from "../components/ui";
import { DiffPanes } from "../components/diff-view";
import { RENDER_TITLE } from "~/shared/render-content";

export function DiffReview() {
  const { proposalId } = useParams({ from: "/proposals/$proposalId" });
  const proposal = useProposal(proposalId);
  const ready = proposal.data?.generationStatus === "ready";
  const diff = useDiff(proposalId, ready);
  const changes = useMemo(() => diff.data?.changes ?? [], [diff.data]);

  if (!proposal.data) {
    return <div className="min-h-screen grid place-items-center text-small text-text-dim">Loading the proposal…</div>;
  }

  return (
    <div className="h-screen flex flex-col">
      <Header proposal={proposal.data} />
      {proposal.data.generationStatus === "generating" ? (
        <Generating proposal={proposal.data} />
      ) : proposal.data.generationStatus === "failed" ? (
        <Failed proposal={proposal.data} />
      ) : proposal.data.status !== "pending" ? (
        <Decided proposal={proposal.data} />
      ) : proposal.data.unchanged ? (
        <Unchanged proposalId={proposalId} />
      ) : (
        <Review proposalId={proposalId} proposal={proposal.data} changes={changes} additions={diff.data?.additions ?? 0} removals={diff.data?.removals ?? 0} />
      )}
    </div>
  );
}

function Header({ proposal }: { proposal: Proposal }) {
  return (
    <header className="h-header shrink-0 flex items-center gap-10 px-20 bg-surface border-b border-border">
      <span className="text-panel font-semibold tracking-snug text-text-strong">Outputs</span>
      <span className="text-text-faint">/</span>
      {/* The proposal's own kind. This said "Résumé (English)" while only one
          render could generate, and would have put that title over a 履歴書. */}
      <span className="text-panel font-semibold tracking-snug text-text-strong">
        {RENDER_TITLE[proposal.renderKind]}
      </span>
      <Chip className="ml-4">proposed v{proposal.proposedVersionNo}</Chip>
      <div className="ml-auto flex items-center gap-10">
        {proposal.reason ? (
          <span className="text-smaller text-text-dimmer">{proposal.reason}</span>
        ) : null}
        {/* Specced in this header since `docs/10` Screen 2 and only now
            navigable: the screen it points at exists (Screen 5). */}
        <Link
          to="/renders/$kind/history"
          params={{ kind: proposal.renderKind }}
          className="border border-border-strong text-text-muted px-10 py-6 rounded-control text-smaller font-medium hover:bg-hover hover:text-text-secondary"
        >
          Version history
        </Link>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ states */

/**
 * The current version stays fully readable throughout — never a blank screen.
 *
 * On a FIRST generation there is no current version to reassure anyone about:
 * `basedOnVersionNo` is null, the header reads v0, and promising a download that
 * does not exist is worst at the one moment the author knows least about what
 * the application is doing (issue #12).
 */
const Generating = ({ proposal }: { proposal: Proposal }) => (
  <main className="flex-1 grid place-items-center px-20">
    <p className="text-ui text-text-dim">
      {proposal.basedOnVersionNo === null
        ? "Writing the first version. Nothing is saved until you accept it."
        : "Writing the proposed version. Your current version is untouched and still downloadable."}
    </p>
  </main>
);

/**
 * The same first-generation branch `Generating` carries (issue #12), for the
 * same reason and on the same discriminator — filed separately as #13 because
 * it was outside that issue's scope. On a first generation there is no current
 * version: "unchanged and still readable" reassures the reader about a document
 * that does not exist, and **Download the current version** offers an accepted
 * version that was never created. A failure screen is the worst place to
 * describe a state the author does not have.
 */
function Failed({ proposal }: { proposal: Proposal }) {
  const navigate = useNavigate();
  const first = proposal.basedOnVersionNo === null;
  return (
    <main className="flex-1 grid place-items-center px-20">
      <div className="w-measure max-w-full text-center">
        <p className="text-row font-medium text-text-strong">This document could not be generated.</p>
        <p className="mt-8 text-ui text-text-dim">
          {proposal.error?.message}{" "}
          {first
            ? "Nothing was saved, and your record is unchanged."
            : "Your current version is unchanged and still readable."}
        </p>
        <div className="mt-20 flex items-center justify-center gap-10">
          {first ? null : (
            <a
              href={downloadUrl(proposal.renderKind, "docx")}
              className="border border-border-strong text-text-secondary px-14 py-8 rounded-control text-micro font-medium hover:bg-hover"
            >
              Download the current version
            </a>
          )}
          <Button variant="primary" onClick={() => void navigate({ to: "/" })}>
            Back to your record
          </Button>
        </div>
      </div>
    </main>
  );
}

function Unchanged({ proposalId }: { proposalId: string }) {
  const { dismiss } = useDecideProposal(proposalId);
  const navigate = useNavigate();
  return (
    <main className="flex-1 grid place-items-center px-20">
      <div className="w-measure max-w-full text-center">
        <p className="text-row font-medium text-text-strong">Already up to date with your record.</p>
        <p className="mt-8 text-ui text-text-dim">
          Regenerating produced the same document. There is nothing to review.
        </p>
        <div className="mt-20">
          <Button
            variant="primary"
            onClick={async () => {
              await dismiss.mutateAsync();
              await navigate({ to: "/" });
            }}
          >
            Back to your record
          </Button>
        </div>
      </div>
    </main>
  );
}

function Decided({ proposal }: { proposal: Proposal }) {
  const navigate = useNavigate();
  const accepted = proposal.status === "accepted";
  return (
    <main className="flex-1 grid place-items-center px-20">
      <div className="w-measure max-w-full text-center">
        <p className="flex items-center justify-center gap-8 text-row font-medium text-text-strong">
          <Dot tone={accepted ? "measured" : "muted"} />
          {accepted
            ? `Proposal accepted — saved as v${proposal.proposedVersionNo}`
            : `Proposal dismissed — v${proposal.basedOnVersionNo ?? 1} kept`}
        </p>
        <p className="mt-8 text-ui text-text-dim">
          {accepted
            ? "Every earlier version is retained."
            : "Your stored version is exactly as it was. The dismissed proposal is retained."}
        </p>
        <div className="mt-20">
          <Button variant="primary" onClick={() => void navigate({ to: "/" })}>
            Back to your record
          </Button>
        </div>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ review */

function Review({
  proposalId,
  proposal,
  changes,
  additions,
  removals,
}: {
  proposalId: string;
  proposal: Proposal;
  changes: DiffChange[];
  additions: number;
  removals: number;
}) {
  const { accept, dismiss } = useDecideProposal(proposalId);
  const navigate = useNavigate();

  return (
    <>
      <DiffPanes
        before={{
          title: "Current",
          badge: <Mono className="text-text-dimmer">v{proposal.basedOnVersionNo ?? 0}</Mono>,
        }}
        after={{
          title: "Proposed",
          badge: <Chip className="text-accent-text">v{proposal.proposedVersionNo} draft</Chip>,
        }}
        changes={changes}
        additions={additions}
        removals={removals}
      />

      <footer className="shrink-0 flex items-center gap-14 px-20 py-14 bg-surface border-t border-border">
        <div className="min-w-0">
          <p className="text-smaller text-text-secondary">
            Accepting replaces your {RENDER_TITLE[proposal.renderKind]} with v{proposal.proposedVersionNo}.
          </p>
          {/* Advisory findings about the record — an unexplained gap in the
              学歴・職歴 table, or the half of a cell the register refuses to
              write. Never blocking, and never silent. */}
          {proposal.warnings.map((warning) => (
            <p key={warning} className="text-smaller text-text-secondary">
              {warning}
            </p>
          ))}
          <p className="text-smaller text-text-dimmer">
            v{proposal.basedOnVersionNo ?? 0} and every earlier version stay restorable.
            {proposal.withheld.privateFactCount > 0
              ? ` ${proposal.withheld.privateFactCount} private fact${proposal.withheld.privateFactCount === 1 ? "" : "s"} in your record ${proposal.withheld.privateFactCount === 1 ? "was" : "were"} not used.`
              : ""}
            {proposal.withheld.generatedFactCount > 0
              ? ` ${proposal.withheld.generatedFactCount} unverified fact${proposal.withheld.generatedFactCount === 1 ? "" : "s"} ${proposal.withheld.generatedFactCount === 1 ? "was" : "were"} left out until promoted.`
              : ""}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-10">
          <Button
            onClick={async () => {
              await dismiss.mutateAsync();
              await navigate({ to: "/" });
            }}
          >
            Keep current version
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              await accept.mutateAsync();
              await navigate({ to: "/" });
            }}
          >
            Accept proposed version
          </Button>
        </div>
      </footer>
    </>
  );
}
