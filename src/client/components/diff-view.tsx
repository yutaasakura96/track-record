/**
 * The split view, shared by the two screens that compare two documents.
 *
 * Screen 2 compares the current version with a proposal. Screen 5's restore
 * preview compares the current version with the one about to be restored, and
 * `docs/10` Screen 5 says it **borrows Screen 2 whole** — so the toolbar, the
 * per-change navigation, the two columns and the rationale bar live here rather
 * than being reimplemented beside a different footer. What differs between the
 * two screens is the column headings and what the footer commits, and those are
 * the only things this takes as props.
 */
import { useEffect } from "react";
import type { ReactNode } from "react";
import type { DiffChange } from "../api";
import { Button, Dot } from "./ui";
import { useDiffStore } from "../stores/review";

export interface PaneHeading {
  title: string;
  badge: ReactNode;
}

export function DiffPanes({
  before,
  after,
  changes,
  additions,
  removals,
}: {
  before: PaneHeading;
  after: PaneHeading;
  changes: DiffChange[];
  additions: number;
  removals: number;
}) {
  const selectedChangeId = useDiffStore((s) => s.selectedChangeId);
  const select = useDiffStore((s) => s.select);

  // A screen that opens on nothing selected has an empty rationale bar, which
  // `docs/10` calls a defect rather than a gap.
  useEffect(() => {
    select(changes[0]?.changeId ?? null);
  }, [changes, select]);

  const index = Math.max(0, changes.findIndex((c) => c.changeId === selectedChangeId));
  const selected = changes[index];
  const step = (delta: number) => {
    const next = changes[(index + delta + changes.length) % changes.length];
    if (next) select(next.changeId);
  };

  return (
    <>
      <div className="h-toolbar shrink-0 flex items-center gap-14 px-20 border-b border-border-subtle">
        <span className="flex items-center gap-6 text-smaller text-measured-text">
          <Dot tone="measured" /> {additions} additions
        </span>
        <span className="flex items-center gap-6 text-smaller text-removed">
          <Dot tone="removed" /> {removals} removals
        </span>
        <div className="ml-auto flex items-center gap-8">
          <span className="text-smaller text-text-dimmer">
            Change {changes.length === 0 ? 0 : index + 1} of {changes.length}
          </span>
          <Button variant="bare" onClick={() => step(-1)} aria-label="Previous change">
            ←
          </Button>
          <Button variant="bare" onClick={() => step(1)} aria-label="Next change">
            →
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-2">
        <Column
          title={before.title}
          badge={before.badge}
          side="current"
          changes={changes}
          selectedChangeId={selected?.changeId ?? null}
          onSelect={select}
        />
        <Column
          title={after.title}
          badge={after.badge}
          side="proposed"
          changes={changes}
          selectedChangeId={selected?.changeId ?? null}
          onSelect={select}
        />
      </div>

      {/* The rationale bar is required, not decorative. */}
      <div className="shrink-0 flex items-center gap-8 px-20 py-10 border-t border-border-subtle">
        <Dot tone={selected?.rationale.kind.startsWith("removed") ? "removed" : "measured"} />
        <span className="text-smaller text-text-dim">
          {selected?.rationale.text ?? "Select a change to see where it came from."}
        </span>
      </div>
    </>
  );
}

/**
 * One side of the split view. Unchanged content renders identically in both
 * columns at full opacity — this is a document being read, not a patch being
 * applied.
 */
function Column({
  title,
  badge,
  side,
  changes,
  selectedChangeId,
  onSelect,
}: {
  title: string;
  badge: ReactNode;
  side: "current" | "proposed";
  changes: DiffChange[];
  selectedChangeId: string | null;
  onSelect: (id: string) => void;
}) {
  const keep = side === "current" ? "remove" : "add";

  return (
    <section className="min-w-0 flex flex-col border-r border-border last:border-r-0">
      <header className="h-strip shrink-0 flex items-center gap-8 px-20 border-b border-border-subtle">
        <span className="text-panel font-semibold tracking-snug text-text-strong">{title}</span>
        {badge}
      </header>
      <div className="flex-1 overflow-y-auto px-20 py-32">
        <div className="mx-auto w-measure max-w-full grid gap-14">
          {changes.map((change) => {
            const absent = side === "current" ? change.currentBlockId === null : change.proposedBlockId === null;
            const selected = change.changeId === selectedChangeId;
            if (absent) {
              return (
                <p
                  key={change.changeId}
                  onClick={() => onSelect(change.changeId)}
                  className="text-render-body text-text-ghost border border-dashed border-border-dashed rounded-control px-12 py-10"
                >
                  {side === "current" ? "no matching line" : "removed"}
                </p>
              );
            }
            return (
              <p
                key={change.changeId}
                onClick={() => onSelect(change.changeId)}
                className={`text-render-body text-text-body px-12 py-10 rounded-control cursor-pointer ${
                  side === "current" ? "bg-remove-row" : "bg-add-row"
                } ${selected ? "shadow-ring" : ""}`}
              >
                {change.tokens
                  .filter((token) => token.op === "equal" || token.op === keep)
                  .map((token, i) =>
                    token.op === "equal" ? (
                      <span key={i}>{token.text}</span>
                    ) : (
                      <mark
                        key={i}
                        className={`mark-base ${
                          token.op === "add"
                            ? selected
                              ? "bg-add-selected text-text-bright"
                              : "bg-add-idle"
                            : selected
                              ? "bg-remove-selected text-text-bright line-through"
                              : "bg-remove-idle line-through"
                        }`}
                      >
                        {token.text}
                      </mark>
                    ),
                  )}
              </p>
            );
          })}
          {changes.length === 0 ? (
            <p className="text-render-body text-text-dim">No changes.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
