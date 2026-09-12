/**
 * Screen 6 — Edit a version (`docs/10-screen-specifications.md`, issue #18).
 *
 * The hand-edit route (S16) landed on 2026-09-11 with no surface, and Screen 5
 * deliberately refused to host one. This is the surface it was waiting for: the
 * only place in the app where the author's own sentence enters a render, and
 * the only place a block citing a fact that can no longer be rendered can be
 * edited out.
 *
 * Four rules it holds, all of them from the spec:
 *   - **It always edits the current version.** The route refuses an edit made
 *     against any other, so the screen never asks which one.
 *   - **Citations are removed, never added.** Removal is the way out of a
 *     version citing a fact that has since gone Private; adding is a fact
 *     picker S16 does not ask for, and an empty `factIds` list is legal by
 *     construction. A hand-typed block cites nothing.
 *   - **A block does not move between sections.** Moving it changes which
 *     employer heading it sits under, and so what the document claims about
 *     whose work it was.
 *   - **The saved state is where the route's attribution warnings land.** They
 *     arrive with the `201` and have nowhere else to go — which is the whole
 *     reason this is a screen rather than a textarea on Screen 5.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  ApiError,
  useEditVersion,
  useStoredVersion,
  useVersionHistory,
  type EditResult,
} from "../api";
import { Button, Mono, MonoId, Notice, Panel } from "../components/ui";
import { DownloadButton, WithheldFacts, withheldFacts } from "../components/download-button";
import { sameContent } from "~/render/edit";
import {
  RENDER_KINDS,
  RENDER_TITLE,
  type Block,
  type BlockKind,
  type RenderContent,
  type RenderKind,
} from "~/shared/render-content";

export function VersionEditScreen() {
  const { kind } = useParams({ from: "/renders/$kind/edit" });
  const known = (RENDER_KINDS as readonly string[]).includes(kind);

  // No sidebar: this is a focused task. There is unsaved work on this screen,
  // and a nav row that discards it on a click is the failure mode.
  return known ? (
    <Editor kind={kind as RenderKind} />
  ) : (
    <main className="min-h-screen grid place-items-center px-20">
      <p className="text-ui text-text-dim">That document was not found.</p>
    </main>
  );
}

/* ------------------------------------------------------------------- draft */

/**
 * A block id is a handle on that block's history — the diff addresses blocks by
 * it — so a client never mints one. A block typed here carries a local key the
 * server discards and replaces (`src/render/edit.ts`). The prefix cannot
 * collide with a real id, which is always `blk_<n>`.
 */
let localKeys = 0;
const localKey = () => `draft_${++localKeys}`;

const newBlock = (kind: BlockKind): Block => ({ id: localKey(), kind, text: "", factIds: [] });

/** A section edit, applied to one section and leaving the rest identical. */
function editSection(
  content: RenderContent,
  sectionKey: string,
  change: (blocks: Block[]) => Block[],
): RenderContent {
  return {
    sections: content.sections.map((section) =>
      section.key === sectionKey ? { ...section, blocks: change(section.blocks) } : section,
    ),
  };
}

const moved = (blocks: Block[], index: number, by: -1 | 1): Block[] => {
  const next = [...blocks];
  const [block] = next.splice(index, 1);
  next.splice(index + by, 0, block!);
  return next;
};

/**
 * An empty block is dropped rather than sent. The route refuses a block with no
 * text, and refusing an author for a block they added and then thought better
 * of would be a refusal about nothing.
 */
const submittable = (content: RenderContent): RenderContent => ({
  sections: content.sections.map((section) => ({
    ...section,
    blocks: section.blocks.filter((block) => block.text.trim() !== ""),
  })),
});

const isEmpty = (content: RenderContent) =>
  content.sections.every((section) => section.blocks.length === 0);

/* ------------------------------------------------------------------ screen */

function Editor({ kind }: { kind: RenderKind }) {
  const navigate = useNavigate();
  const history = useVersionHistory(kind);
  const currentVersionId = history.data?.currentVersionId ?? null;
  const version = useStoredVersion(kind, currentVersionId);
  const save = useEditVersion(kind);

  const [draft, setDraft] = useState<RenderContent | null>(null);
  const [refusal, setRefusal] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState<EditResult | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  /** The block whose text should take focus once it exists in the DOM. */
  const [focusBlock, setFocusBlock] = useState<string | null>(null);

  // The loaded version is immutable, so this runs once per version id rather
  // than on every render of the query.
  const loaded = version.data;
  useEffect(() => {
    if (loaded) setDraft(loaded.content);
  }, [loaded?.id]);

  const versionNo = loaded?.versionNo ?? null;
  const nextVersionNo = versionNo === null ? null : versionNo + 1;
  const proposed = draft ? submittable(draft) : null;
  const changed = proposed !== null && loaded !== undefined && !sameContent(proposed, loaded.content);
  const emptied = proposed !== null && isEmpty(proposed);

  const leave = () => void navigate({ to: "/renders/$kind/history", params: { kind } });

  const commit = async () => {
    if (!proposed || !loaded) return;
    setRefusal(null);
    try {
      const result = await save.mutateAsync({
        basedOnVersionId: loaded.id,
        content: proposed,
      });
      // No warnings means the work is done and there is nothing to say. The
      // history is where an edit is read back, and the new version is at the
      // top of it marked `Current`.
      if (result.warnings.length === 0) leave();
      else setSaved(result);
    } catch (error) {
      if (error instanceof ApiError) setRefusal(error);
      else throw error;
    }
  };

  if (history.isPending || (currentVersionId !== null && version.isPending)) {
    return (
      <Frame kind={kind} note="">
        <Panel>
          <p className="text-smaller text-text-dim">Reading the current version…</p>
        </Panel>
      </Frame>
    );
  }

  // Reaching the editor for a render with no current version is the same
  // nothing Screen 5 reports, and it gets the same sentence.
  if (currentVersionId === null || !loaded) return <NotGeneratedYet kind={kind} />;

  if (saved) {
    return (
      <SavedPanel kind={kind} result={saved} onLeave={leave} />
    );
  }

  const withheld = refusal ? withheldFacts(refusal) : [];
  const refusedFactIds = new Set(withheld.map((fact) => fact.factId));

  return (
    <Frame
      kind={kind}
      note={`Saving creates v${nextVersionNo}. v${versionNo} stays readable and downloadable.`}
      title={`editing v${versionNo}`}
      actions={
        <>
          <Button onClick={() => (changed ? setConfirmingCancel(true) : leave())}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!changed || emptied || save.isPending}
            disabledReason={
              save.isPending
                ? "Saving…"
                : emptied
                  ? "An edit cannot empty the document."
                  : "Nothing has changed yet."
            }
            onClick={commit}
          >
            Save as v{nextVersionNo}
          </Button>
        </>
      }
    >
      {/* The Screen 5 caveat, for the same reason: without it the screen
          promises a document it does not produce. */}
      {kind === "rirekisho" ? (
        <p className="mb-14 text-smaller text-text-dim">
          Editing changes the summary text only — the education, employment and qualification
          tables always reflect your record as it is now.
        </p>
      ) : null}

      <div className="grid gap-14">
        {draft?.sections.map((section) => (
          <Panel key={section.key}>
            {/* The section KEY is never shown and never editable: it is how the
                builder finds a section, and an author cannot be asked to
                preserve a value they are not shown. */}
            <input
              value={section.heading}
              aria-label="Section heading"
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? {
                        sections: current.sections.map((s) =>
                          s.key === section.key ? { ...s, heading: event.target.value } : s,
                        ),
                      }
                    : current,
                )
              }
              className="w-full bg-transparent border-0 -ml-4 px-4 py-2 rounded-control text-render-heading font-semibold uppercase tracking-heading text-text-strong outline-none focus:bg-private-mark focus:shadow-ring"
            />

            <ul className="mt-10 grid gap-6">
              {section.blocks.map((block, index) => (
                <BlockRow
                  key={block.id}
                  block={block}
                  refused={block.factIds.some((id) => refusedFactIds.has(id))}
                  focus={focusBlock === block.id}
                  onFocused={() => setFocusBlock(null)}
                  canMoveUp={index > 0}
                  canMoveDown={index < section.blocks.length - 1}
                  onText={(text) =>
                    setDraft((current) =>
                      current
                        ? editSection(current, section.key, (blocks) =>
                            blocks.map((b) => (b.id === block.id ? { ...b, text } : b)),
                          )
                        : current,
                    )
                  }
                  onMove={(by) =>
                    setDraft((current) =>
                      current
                        ? editSection(current, section.key, (blocks) => moved(blocks, index, by))
                        : current,
                    )
                  }
                  onDelete={() =>
                    setDraft((current) =>
                      current
                        ? editSection(current, section.key, (blocks) =>
                            blocks.filter((b) => b.id !== block.id),
                          )
                        : current,
                    )
                  }
                  onUncite={(factId) =>
                    setDraft((current) =>
                      current
                        ? editSection(current, section.key, (blocks) =>
                            blocks.map((b) =>
                              b.id === block.id
                                ? { ...b, factIds: b.factIds.filter((f) => f !== factId) }
                                : b,
                            ),
                          )
                        : current,
                    )
                  }
                />
              ))}
            </ul>

            {/* Both builders skip a section with no blocks, so emptying one is
                a legal way to drop it from the output without losing the
                heading. Said where it happens, rather than leaving a heading
                that looks broken. */}
            {section.blocks.length === 0 ? (
              <p className="mt-8 text-smaller text-text-dimmer">
                This section is empty and will not appear in the document.
              </p>
            ) : null}

            <div className="mt-10 flex items-center gap-6">
              {(["paragraph", "bullet"] as const).map((blockKind) => (
                <button
                  key={blockKind}
                  type="button"
                  onClick={() => {
                    const block = newBlock(blockKind);
                    setDraft((current) =>
                      current
                        ? editSection(current, section.key, (blocks) => [...blocks, block])
                        : current,
                    );
                    setFocusBlock(block.id);
                  }}
                  className="text-text-dim px-6 py-4 rounded-chip text-smaller hover:bg-border hover:text-text-secondary"
                >
                  Add {blockKind}
                </button>
              ))}
            </div>
          </Panel>
        ))}
      </div>

      {refusal ? <Refusal error={refusal} withheld={withheld} /> : null}

      {confirmingCancel ? (
        <ConfirmDiscard onDiscard={leave} onKeepEditing={() => setConfirmingCancel(false)} />
      ) : null}
    </Frame>
  );
}

/* -------------------------------------------------------------------- frame */

function Frame({
  kind,
  note,
  title,
  actions,
  children,
}: {
  kind: RenderKind;
  note: string;
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="h-header shrink-0 flex items-center gap-12 px-20 bg-surface border-b border-border">
        <h1 className="text-panel font-semibold tracking-snug text-text-strong">
          {RENDER_TITLE[kind]}
          {/* The header waits for the version number rather than rendering v0. */}
          {title ? ` · ${title}` : ""}
        </h1>
        {note ? <span className="text-smaller text-text-dimmer">{note}</span> : null}
        {actions ? <div className="ml-auto flex items-center gap-10">{actions}</div> : null}
      </header>
      <div className="flex-1 overflow-y-auto px-20 py-26">
        <div className="mx-auto w-content max-w-full">{children}</div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------- row */

function BlockRow({
  block,
  refused,
  focus,
  onFocused,
  canMoveUp,
  canMoveDown,
  onText,
  onMove,
  onDelete,
  onUncite,
}: {
  block: Block;
  refused: boolean;
  focus: boolean;
  onFocused: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onText: (text: string) => void;
  onMove: (by: -1 | 1) => void;
  onDelete: () => void;
  onUncite: (factId: string) => void;
}) {
  const text = useRef<HTMLDivElement>(null);
  /** The text as it was when focus entered — what `Escape` restores. */
  const entered = useRef(block.text);

  useEffect(() => {
    if (!focus) return;
    text.current?.focus();
    onFocused();
  }, [focus]);

  return (
    <li
      className={`flex items-start gap-10 px-8 py-6 rounded-control ${
        // Amber is "not usable yet" (`docs/05` §1), which is exactly what a
        // block citing an unrenderable fact is. It is not a generic warning.
        refused ? "bg-generated-mark border border-dashed border-generated-rule" : ""
      }`}
    >
      <div className="min-w-0">
        <div className="flex gap-6">
          {block.kind === "bullet" ? (
            <span className="text-text-dim select-none pt-2" aria-hidden>
              •
            </span>
          ) : null}
          {/* Inline contenteditable, not a boxed input — the fact-claim control
              of `docs/05` §7, at the render body size. Commits on blur. */}
          <div
            ref={text}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-label={block.kind === "bullet" ? "Bullet text" : "Paragraph text"}
            onFocus={(event) => {
              entered.current = event.currentTarget.textContent ?? "";
            }}
            onKeyDown={(event) => {
              // Every other screen commits on blur with no way back. Here a
              // block is the unit of work and it needs one.
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.currentTarget.textContent = entered.current;
              event.currentTarget.blur();
            }}
            onBlur={(event) => {
              const next = event.currentTarget.textContent?.trim() ?? "";
              if (next !== block.text) onText(next);
            }}
            className="flex-1 min-w-0 max-w-measure min-h-20 -ml-4 px-4 py-2 rounded-control text-render-body text-text-body cursor-text outline-none focus:bg-private-mark focus:shadow-ring"
          >
            {block.text}
          </div>
        </div>

        {/* Citations are shown to be REMOVED. Adding one is a fact picker S16
            does not ask for; a block that cites nothing is legal, and a
            hand-typed sentence is the author's, not a fact's. */}
        {block.factIds.length > 0 ? (
          <div className="mt-4 ml-2 flex flex-wrap items-center gap-8">
            {block.factIds.map((factId) => (
              <span key={factId} className="flex items-center gap-4">
                <MonoId className="text-text-dimmer">{factId}</MonoId>
                <button
                  type="button"
                  aria-label={`Remove citation ${factId}`}
                  title="Remove citation"
                  onClick={() => onUncite(factId)}
                  className="text-text-ghost px-4 rounded-chip text-smaller hover:bg-border hover:text-text-secondary"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Absent, not disabled, where it cannot apply: the first block of a
          section has no `Move up`. */}
      <div className="flex items-center gap-2 shrink-0">
        {canMoveUp ? <Bare label="Move up" onClick={() => onMove(-1)} /> : null}
        {canMoveDown ? <Bare label="Move down" onClick={() => onMove(1)} /> : null}
        <Bare label="Delete" onClick={onDelete} />
      </div>
    </li>
  );
}

const Bare = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="text-text-dim px-6 py-4 rounded-chip text-smaller hover:bg-border hover:text-text-secondary"
  >
    {label}
  </button>
);

/* ---------------------------------------------------------------- refusals */

/**
 * The server's refusal, stated in place. Every one of them is a dead end with a
 * route out, and none is stated as something to retry.
 *
 * The draft is KEPT in every case the draft can still apply to. Discarding the
 * author's typing in order to report someone else's pending proposal would be
 * the second loss of the same minute.
 */
function Refusal({ error, withheld }: { error: ApiError; withheld: { factId: string; problem: string }[] }) {
  const stale = error.code === "conflict" && typeof error.details.currentVersionId === "string";

  return (
    <div className="mt-14">
      <Notice tone={withheld.length > 0 ? "generated" : "neutral"}>
        <span role="alert">{error.message}</span>
        <WithheldFacts facts={withheld} className="" />
        {withheld.length > 0 ? (
          <span className="block mt-4">
            Remove the citation, or delete the block, and save again.
          </span>
        ) : null}
        {stale ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="block mt-6 text-accent-link underline hover:text-accent-link-hover"
          >
            Reload and edit again
          </button>
        ) : null}
      </Notice>
    </div>
  );
}

function ConfirmDiscard({
  onDiscard,
  onKeepEditing,
}: {
  onDiscard: () => void;
  onKeepEditing: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onKeepEditing();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKeepEditing]);

  return (
    <div
      className="fixed inset-0 bg-bg/80 flex items-center justify-center p-20"
      role="dialog"
      aria-modal="true"
      onClick={onKeepEditing}
    >
      <div
        className="bg-surface border border-border rounded-panel p-20 w-content max-w-full flex flex-col gap-14"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-ui text-text-secondary">Discard your changes?</p>
        <p className="text-smaller text-text-dimmer">
          Nothing has been saved yet. The version you were editing is unchanged either way.
        </p>
        <div className="ml-auto flex items-center gap-10">
          <Button onClick={onKeepEditing} autoFocus>
            Keep editing
          </Button>
          <Button variant="ghost" onClick={onDiscard}>
            Discard
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- saved */

/**
 * Where the route's attribution warnings land, and the reason this is a screen.
 *
 * They are advisory and never refusals — an author restructuring a section by
 * hand may be right where the checker is wrong (`docs/07` §7). The version is
 * already saved and nothing here can undo it: the panel informs, it does not
 * ask.
 */
function SavedPanel({
  kind,
  result,
  onLeave,
}: {
  kind: RenderKind;
  result: EditResult;
  onLeave: () => void;
}) {
  return (
    <Frame kind={kind} note="" title={`saved as v${result.newVersionNo}`}>
      <Panel heading={`Saved as v${result.newVersionNo}.`}>
        <p className="text-smaller text-text-dim">Worth checking:</p>
        <ul className="mt-8 grid gap-6">
          {result.warnings.map((warning) => (
            <li key={warning} className="text-smaller text-text-secondary">
              {warning}
            </li>
          ))}
        </ul>
        <div className="mt-14 flex items-center gap-10">
          <Mono className="text-text-dimmer">EDITED BY HAND</Mono>
          <div className="ml-auto flex items-center gap-10">
            {/* No `versionId`: the version just saved IS the current one, and
                the server's own default is the control that says so. */}
            <DownloadButton kind={kind} label={`Download v${result.newVersionNo}`} />
            <Button variant="primary" onClick={onLeave}>
              Back to version history
            </Button>
          </div>
        </div>
      </Panel>
    </Frame>
  );
}

/* ------------------------------------------------------------------ states */

/**
 * There is nothing to edit. The sentence is Screen 5's, and so is the action:
 * `Generate` lives there, on the screen that reads what generation produced,
 * and a second copy of it here would be a second place to keep it right.
 */
function NotGeneratedYet({ kind }: { kind: RenderKind }) {
  const navigate = useNavigate();

  return (
    <Frame kind={kind} note="">
      <Panel>
        <div className="flex items-center gap-12">
          <p className="text-ui text-text-dim">This document has not been generated yet.</p>
          <div className="ml-auto shrink-0">
            <Button
              onClick={() => void navigate({ to: "/renders/$kind/history", params: { kind } })}
            >
              Go to version history
            </Button>
          </div>
        </div>
      </Panel>
    </Frame>
  );
}
