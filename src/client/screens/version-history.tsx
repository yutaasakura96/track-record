/**
 * Screen 5 — Version history (`docs/10-screen-specifications.md`).
 *
 * Every version of one document, how each came to exist, and the way an earlier
 * one is put back. It is also where the two proposal outcomes stop being
 * invisible: an accepted proposal became a version, a dismissed one did not,
 * and both are retained.
 *
 * Three rules this screen holds:
 *   - **Restore is never a button on a row.** The action is `Compare`, which
 *     opens a read-only preview, and the commit lives there. Replacing a
 *     document with one the author may not remember, in one click, is the
 *     failure mode this screen exists to prevent.
 *   - **No editing here.** `Edit` is a link to Screen 6, which is where the
 *     route's attribution warnings land; nothing on this screen is typeable.
 *   - **Nothing on this screen deletes anything.** The never-delete rule is the
 *     product, and a control that appears to offer it is worse than its absence.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  ApiError,
  useGenerate,
  useProfile,
  useRenderProposals,
  useRenders,
  useRestoreVersion,
  useVersionDiff,
  useVersionHistory,
  type ProposalRow,
  type RenderVersion,
} from "../api";
import { Button, Chip, Dot, Mono, Panel } from "../components/ui";
import { DiffPanes } from "../components/diff-view";
import { Sidebar } from "../components/sidebar";
import { absolute } from "../format";
import { RENDER_KINDS, RENDER_TITLE, type RenderKind } from "~/shared/render-content";
import { DownloadButton, WithheldFacts } from "../components/download-button";

export function VersionHistoryScreen() {
  const { kind } = useParams({ from: "/renders/$kind/history" });
  const profile = useProfile();
  const known = (RENDER_KINDS as readonly string[]).includes(kind);

  return (
    <div className="min-h-screen flex">
      <Sidebar name={profile.data?.nameLatin ?? ""} />
      <div className="flex-1 min-w-0 flex flex-col">
        {known ? (
          <History kind={kind as RenderKind} />
        ) : (
          <main className="flex-1 grid place-items-center px-20">
            <p className="text-ui text-text-dim">That document was not found.</p>
          </main>
        )}
      </div>
    </div>
  );
}

/** What a row is: a version, or a proposal that never became one. */
type Entry =
  | { row: "version"; at: string; version: RenderVersion }
  | { row: "dismissed"; at: string; proposal: ProposalRow };

function History({ kind }: { kind: RenderKind }) {
  const history = useVersionHistory(kind);
  const proposals = useRenderProposals(kind);
  const [restoring, setRestoring] = useState<RenderVersion | null>(null);

  const versions = history.data?.items ?? [];
  const dismissed = (proposals.data?.items ?? []).filter((p) => p.status === "dismissed");
  // The merge lives here, in the one place that needs it — the two endpoints
  // stay separate (`docs/06`, 2026-09-12).
  const entries: Entry[] = [
    ...versions.map((version) => ({ row: "version" as const, at: version.acceptedAt, version })),
    ...dismissed.map((proposal) => ({
      row: "dismissed" as const,
      at: proposal.decidedAt ?? proposal.generatedAt,
      proposal,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const loading = history.isPending;
  const current = versions.find((v) => v.isCurrent) ?? null;
  // Versions are appended and the newest is always current, so the number a
  // restore would mint is one above the highest.
  const nextVersionNo = (versions[0]?.versionNo ?? 0) + 1;

  return (
    <>
      <header className="h-header shrink-0 flex items-center gap-12 px-20 bg-surface border-b border-border">
        {/* Japanese render names use the mixed font stack, as on Screen 3. */}
        <h1 className="text-panel font-semibold tracking-snug text-text-strong">
          {RENDER_TITLE[kind]} · version history
        </h1>
        {/* The count WAITS rather than rendering `0 versions` while loading. */}
        {loading ? null : (
          <span className="text-smaller text-text-dimmer">
            {versions.length} version{versions.length === 1 ? "" : "s"}
            {current ? ` · current v${current.versionNo}` : ""}
          </span>
        )}
        {current ? (
          <span className="ml-auto">
            <DownloadButton kind={kind} versionId={current.id} label="Download current" />
          </span>
        ) : null}
      </header>

      <div className="flex-1 overflow-y-auto px-20 py-26">
        <div className="mx-auto w-content max-w-full">
          {loading ? (
            <Skeleton />
          ) : versions.length === 0 ? (
            <NotGeneratedYet kind={kind} />
          ) : (
            <Panel>
              {/* A 履歴書 version stores two prose blocks; its three tables are
                  filled from the record at download time. Without this line the
                  screen promises a document it does not produce — which makes
                  the sentence a requirement rather than copy (`docs/10`). */}
              {kind === "rirekisho" ? (
                <p className="pb-12 border-b border-border-inner text-smaller text-text-dim">
                  Restoring changes the summary text only — the education, employment and
                  qualification tables always reflect your record as it is now.
                </p>
              ) : null}
              <ul>
                {entries.map((entry) =>
                  entry.row === "version" ? (
                    <VersionRow
                      key={entry.version.id}
                      kind={kind}
                      version={entry.version}
                      onCompare={() => setRestoring(entry.version)}
                    />
                  ) : (
                    <DismissedRow key={entry.proposal.id} proposal={entry.proposal} at={entry.at} />
                  ),
                )}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      {restoring && current ? (
        <RestorePreview
          kind={kind}
          current={current}
          target={restoring}
          nextVersionNo={nextVersionNo}
          onClose={() => setRestoring(null)}
        />
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------- rows */

const ROW = "flex items-center gap-12 px-10 py-12 border-b border-border-inner last:border-b-0";

/**
 * The kind of an entry is carried by the mono meta line, **never by colour
 * alone** — origin and a dismissal are facts about provenance, and the
 * palette's green, amber and red are already spoken for (`docs/05` §1).
 */
const ORIGIN_META: Record<RenderVersion["origin"], string> = {
  accepted: "ACCEPTED · from a proposal",
  restored: "RESTORED",
  edited: "EDITED BY HAND",
};

const ANCESTRY: Record<RenderVersion["origin"], string | null> = {
  accepted: null,
  restored: "Restored from",
  edited: "Edited from",
};

function VersionRow({
  kind,
  version,
  onCompare,
}: {
  kind: RenderKind;
  version: RenderVersion;
  onCompare: () => void;
}) {
  // `Compare` is absent on the current version, which has nothing to be
  // restored from — which is also why a history with only one version carries
  // no comparison affordance anywhere.
  const comparable = !version.isCurrent;
  const ancestry = ANCESTRY[version.origin];

  return (
    <li
      // Screens 1 and 2 both shipped without keyboard operability and both
      // needed a bug. A row with no Compare is not a tab stop: a focus that
      // does nothing is worse than no focus (issue #8).
      tabIndex={comparable ? 0 : undefined}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.target !== event.currentTarget) return;
        event.preventDefault();
        onCompare();
      }}
      aria-label={`v${version.versionNo}, ${ORIGIN_META[version.origin].toLowerCase()}`}
      className={`${ROW} rounded-control outline-none focus-visible:bg-hover focus-visible:shadow-ring`}
    >
      <Chip>v{version.versionNo}</Chip>
      {version.isCurrent ? (
        <span className="flex items-center gap-6 text-smaller text-measured-text">
          <Dot tone="measured" /> Current
        </span>
      ) : null}
      {/* A system timestamp, absolute — month precision never applies here. */}
      <span className="text-smaller text-text-dimmer">{absolute(version.acceptedAt)}</span>
      <div className="min-w-0">
        <Mono className="block text-text-dimmer">{ORIGIN_META[version.origin]}</Mono>
        {/* A history that shows the origin but not the parent says an edit
            happened without saying to what. */}
        {ancestry && version.sourceVersionNo !== null ? (
          <span className="block text-smaller text-text-dim">
            {ancestry} v{version.sourceVersionNo}
          </span>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-8">
        {/* `?versionId=` serves any version, and a 履歴書 is `.docx` only —
            the download rules are the ones that already exist. */}
        <DownloadButton kind={kind} versionId={version.id} label="Download" />
        {comparable ? (
          <Button variant="ghost" onClick={onCompare}>
            Compare
          </Button>
        ) : (
          // `Edit` is present ONLY on the current version: the route refuses an
          // edit made against any other, and a control that is refused is not
          // offered (`docs/10` Screen 6).
          <Link
            to="/renders/$kind/edit"
            params={{ kind }}
            className="border border-border-strong text-text-muted px-10 py-6 rounded-control text-smaller font-medium hover:bg-hover hover:text-text-secondary"
          >
            Edit
          </Link>
        )}
      </div>
    </li>
  );
}

/**
 * Dismissed proposals carry no version chip, because they never received a
 * version number, and their one action is the proposal diff that already
 * exists.
 */
function DismissedRow({ proposal, at }: { proposal: ProposalRow; at: string }) {
  return (
    <li className={`${ROW} bg-card-recessed rounded-control opacity-50`}>
      <div className="min-w-0">
        <Mono className="block text-text-dimmer">DISMISSED · not a version</Mono>
        {proposal.reason ? (
          <span className="block text-smaller text-text-dim">{proposal.reason}</span>
        ) : null}
      </div>
      <span className="text-smaller text-text-dimmer">{absolute(at)}</span>
      <div className="ml-auto">
        <Link
          to="/proposals/$proposalId"
          params={{ proposalId: proposal.id }}
          className="border border-border-strong text-text-muted px-10 py-6 rounded-control text-smaller font-medium hover:bg-hover hover:text-text-secondary"
        >
          View diff
        </Link>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ states */

const Skeleton = () => (
  <Panel>
    <ul aria-busy="true" aria-label="Loading the version history">
      {[0, 1, 2].map((n) => (
        <li key={n} className={ROW}>
          <span className="h-12 w-label bg-chip rounded-mark" aria-hidden />
          <span className="ml-auto h-12 w-label bg-chip rounded-mark" aria-hidden />
        </li>
      ))}
    </ul>
  </Panel>
);

/**
 * Not an error. The same sentence whether the generator for that kind is built
 * or not — what differs is whether the action can run, and a disabled control
 * says why (`docs/05` §6).
 */
function NotGeneratedYet({ kind }: { kind: RenderKind }) {
  const renders = useRenders();
  const generate = useGenerate();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<string | null>(null);
  const buildable = renders.data?.items.find((r) => r.kind === kind)?.buildable ?? false;

  return (
    <Panel>
      <div className="flex items-center gap-12">
        <p className="text-ui text-text-dim">This document has not been generated yet.</p>
        <div className="ml-auto shrink-0">
          {buildable ? (
            <Button
              variant="primary"
              disabled={generate.isPending}
              disabledReason={generate.isPending ? "Generating…" : undefined}
              onClick={async () => {
                setFailure(null);
                try {
                  const created = await generate.mutateAsync(kind);
                  await navigate({
                    to: "/proposals/$proposalId",
                    params: { proposalId: created.proposalId },
                  });
                } catch (error) {
                  setFailure(
                    error instanceof ApiError ? error.message : "Generation could not be started.",
                  );
                }
              }}
            >
              Generate
            </Button>
          ) : (
            <Button disabled disabledReason="This document is not built yet.">
              Generate
            </Button>
          )}
        </div>
      </div>
      {failure ? (
        <p role="alert" className="mt-12 text-small text-text-secondary">
          {failure}
        </p>
      ) : null}
    </Panel>
  );
}

/* ---------------------------------------------------------------- preview */

/**
 * The restore preview — Screen 2's split view, read-only, with the current
 * version as the LEFT column so the diff reads as the change the commit will
 * make rather than the one it will undo.
 *
 * **Nothing here writes to the proposal table.** This comparison is not a
 * proposal and must never create one; that table holds what a generation
 * produced (`docs/06`, 2026-09-12).
 */
function RestorePreview({
  kind,
  current,
  target,
  nextVersionNo,
  onClose,
}: {
  kind: RenderKind;
  current: RenderVersion;
  target: RenderVersion;
  nextVersionNo: number;
  onClose: () => void;
}) {
  const diff = useVersionDiff(kind, current.id, target.id);
  const restore = useRestoreVersion(kind);
  const [refusal, setRefusal] = useState<ApiError | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const facts = (refusal?.details.facts ?? []) as { factId: string; problem: string }[];
  const proposalId = refusal?.details.proposalId as string | undefined;

  return (
    <div className="fixed inset-0 bg-bg flex flex-col" role="dialog" aria-modal="true">
      <header className="h-header shrink-0 flex items-center gap-10 px-20 bg-surface border-b border-border">
        <span className="text-panel font-semibold tracking-snug text-text-strong">
          {RENDER_TITLE[kind]}
        </span>
        <Chip className="ml-4">restoring v{target.versionNo}</Chip>
        <span className="ml-auto text-smaller text-text-dimmer">
          Nothing is saved until you restore.
        </span>
      </header>

      <DiffPanes
        before={{
          title: "Current",
          badge: <Mono className="text-text-dimmer">v{current.versionNo}</Mono>,
        }}
        after={{
          title: "Restoring",
          badge: <Chip className="text-accent-text">v{target.versionNo}</Chip>,
        }}
        changes={diff.data?.changes ?? []}
        additions={diff.data?.additions ?? 0}
        removals={diff.data?.removals ?? 0}
      />

      <footer className="shrink-0 flex items-center gap-14 px-20 py-14 bg-surface border-t border-border">
        <div className="min-w-0">
          <p className="text-smaller text-text-secondary">
            Restoring v{target.versionNo} saves it as a new version v{nextVersionNo}. v
            {current.versionNo} stays readable and downloadable.
          </p>
          {/* The server's refusal, in place. Both are dead ends with a route
              out, and neither is stated as something to retry. */}
          {refusal ? (
            <p role="alert" className="text-smaller text-text-secondary">
              {refusal.message}{" "}
              {proposalId ? (
                <Link
                  to="/proposals/$proposalId"
                  params={{ proposalId }}
                  className="text-accent-text underline"
                >
                  Open the proposal
                </Link>
              ) : facts.length > 0 ? (
                "Change the fact in your record, or restore a different version."
              ) : null}
            </p>
          ) : null}
          <WithheldFacts facts={facts} />
        </div>
        <div className="ml-auto flex items-center gap-10">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={restore.isPending}
            disabledReason={restore.isPending ? "Restoring…" : undefined}
            onClick={async () => {
              setRefusal(null);
              try {
                await restore.mutateAsync(target.id);
                onClose();
              } catch (error) {
                if (error instanceof ApiError) setRefusal(error);
                else throw error;
              }
            }}
          >
            Restore v{target.versionNo}
          </Button>
        </div>
      </footer>
    </div>
  );
}
