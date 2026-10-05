/**
 * Screen 1 — Fact Review (`docs/10-screen-specifications.md`).
 *
 * Turn one imported document into accepted facts. The most-used screen in the
 * product and the one M1 is judged on.
 *
 * Three rules this screen exists to hold:
 *   - **A Generated fact CAN be accepted.** It is accepted, flagged, and
 *     excluded when a document is produced. Accept stays enabled.
 *   - **Private facts are accepted normally**, with the action labelled.
 *   - **No confidence score.** Provenance is the only trust signal.
 *
 * **The keyboard surface is the rail** (issue #8, and `docs/06` 2026-09-03).
 * Choosing which passage to look at is a traversal of the fact list, and the
 * fact list is the rail; the document is the evidence view and follows. So the
 * *card* is the focusable unit — one roving tab stop for the whole rail, arrows
 * to move fact to fact, and selection follows focus wherever it lands inside a
 * card. The marks stay a pointer shortcut and add no tab stops: making all 11
 * of them focusable would double the cost of reaching the same 11 facts.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import type { Root } from "mdast";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  failureText,
  isImportRunning,
  POLL_MS,
  useEntities,
  useFactAction,
  useFacts,
  useImportStatus,
  useSourceText,
  type Employer,
  type Fact,
  type ImportStatus,
  type LikelyMatch,
  type SourceText,
} from "../api";
import { Button, Chip, FilterPill, Mono, MonoId, Notice, ProgressBar, SegmentedControl } from "../components/ui";
import { ExtractionProgress } from "../components/extraction-progress";
import { NextStep } from "../components/screen-intro";
import { MarkdownDocument, quoteExcerpt } from "../markdown/document";
import { contents, isMarkdownFile, parseMarkdown, type ContentsEntry } from "../markdown/parse";
import { resolveRanges, type MarkRange } from "../markdown/ranges";
import { useReviewStore, type FactFilter, type SourceView } from "../stores/review";
import { revealInBand, scrollToBand } from "../scroll";
import { relative } from "../format";

export function FactReview() {
  const { importId } = useParams({ from: "/imports/$importId" });
  const status = useImportStatus(importId);
  const facts = useFacts(importId, {
    // Cards appear incrementally as extraction progresses, rather than after
    // one long silence.
    refetchInterval: isImportRunning(status.data?.status) ? POLL_MS : false,
  });
  const source = useSourceText(status.data?.sourceDocumentId ?? "", status.data?.versionNo ?? 1);
  const select = useReviewStore((s) => s.select);
  const finish = useFinish(importId);

  useEffect(() => () => select(null), [select]);

  // Parsed once, here, because both halves read it: the source pane renders it
  // and the selected card cuts its quoted passage out of it. `null` for a
  // plain-text document, which is shown as stored (`docs/10` Screen 1).
  const filename = source.data?.filename ?? "";
  const text = source.data?.text ?? "";
  const tree = useMemo(() => (isMarkdownFile(filename) ? parseMarkdown(text) : null), [filename, text]);

  if (!status.data) {
    return <div className="min-h-screen grid place-items-center text-small text-text-dim">Opening the document…</div>;
  }

  const items = facts.data?.items ?? [];
  const resolved = items.filter((f) => f.status !== "candidate");

  return (
    <div className="h-screen flex flex-col">
      <Header
        filename={source.data?.filename ?? "…"}
        project={source.data?.project?.name ?? null}
        finish={finish}
        resolvedCount={resolved.length}
        total={items.length}
      />
      <div className="flex-1 min-h-0 flex">
        <SourcePane status={status.data} source={source.data} tree={tree} facts={items} />
        <FactRail
          importId={importId}
          status={status.data}
          facts={items}
          finish={finish}
          source={source.data}
          tree={tree}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ header */

function Header({
  filename,
  project,
  finish,
  resolvedCount,
  total,
}: {
  filename: string;
  /** Left out of the breadcrumb, not labelled, when the document has no project. */
  project: string | null;
  finish: Finish;
  resolvedCount: number;
  total: number;
}) {
  const failure = finish.failureAt("header");
  const allResolved = total > 0 && resolvedCount === total;

  return (
    <header className="h-header shrink-0 flex items-center gap-10 px-20 bg-surface border-b border-border">
      <Link to="/documents" className="text-panel font-semibold tracking-snug text-text-strong hover:text-text-bright">
        Documents
      </Link>
      <span className="text-text-faint">/</span>
      {project && (
        <>
          <span className="text-smaller text-text-dim">{project}</span>
          <span className="text-text-faint">·</span>
        </>
      )}
      <Chip>{filename}</Chip>

      <div className="ml-auto flex items-center gap-14">
        {failure ? (
          <span role="alert" className="text-smaller text-removed">
            {failure}
          </span>
        ) : null}
        <span className="text-smaller text-text-dimmer">
          {resolvedCount} of {total} reviewed
        </span>
        <ProgressBar className="w-progress" value={total === 0 ? 0 : resolvedCount / total} />
        {/* One action, two affordances — the footer button is the same call. */}
        <Button variant={allResolved ? "primary" : "secondary"} onClick={() => void finish.run("header")}>
          Finish review
        </Button>
      </div>
    </header>
  );
}

type FinishButton = "header" | "rail";
type Finish = ReturnType<typeof useFinish>;

/**
 * Finish, then go home. A refusal is said beside the button that was pressed;
 * it used to reject into nothing, leaving the author on a screen that looked
 * exactly as it did before the click. One refusal for both buttons: with one
 * each, a press of the second left the first's older reason on screen.
 */
function useFinish(importId: string) {
  const { finish } = useFactAction(importId);
  const navigate = useNavigate();
  const [failure, setFailure] = useState<{ at: FinishButton; text: string } | null>(null);
  const run = async (at: FinishButton) => {
    setFailure(null);
    try {
      await finish.mutateAsync();
    } catch (error) {
      setFailure({ at, text: failureText(error) });
      return;
    }
    await navigate({ to: "/" });
  };
  const failureAt = (at: FinishButton) => (failure?.at === at ? failure.text : null);
  return { run, failureAt };
}

/* -------------------------------------------------------------- source pane */

function SourcePane({
  status,
  source,
  tree,
  facts,
}: {
  status: ImportStatus;
  source: SourceText | undefined;
  /** The parsed document, or `null` when it is plain text and is shown as stored. */
  tree: Root | null;
  facts: Fact[];
}) {
  const text = source?.text ?? "";
  const selectedFactId = useReviewStore((s) => s.selectedFactId);
  const origin = useReviewStore((s) => s.selectionOrigin);
  const select = useReviewStore((s) => s.select);
  const chosenView = useReviewStore((s) => s.view);
  const setView = useReviewStore((s) => s.setView);
  const contentsOpen = useReviewStore((s) => s.contentsOpen);
  const setContentsOpen = useReviewStore((s) => s.setContentsOpen);
  const pane = useRef<HTMLDivElement>(null);
  // Where the reader was, as a share of the document, when they switched view.
  const held = useRef<number | null>(null);

  const view: SourceView = tree ? chosenView : "source";
  const ranges = useMemo(
    () =>
      resolveRanges(
        facts
          .filter((fact) => fact.evidence !== null)
          .map((fact) => ({
            id: fact.id,
            start: fact.evidence!.quoteStart,
            end: fact.evidence!.quoteEnd,
            className: markClass(fact, fact.id === selectedFactId),
          })),
      ),
    [facts, selectedFactId],
  );
  const entries = useMemo(() => (tree ? contents(tree) : []), [tree]);
  // One heading is a title, not a table of contents.
  const hasContents = view === "rendered" && entries.length >= 2;
  const onMark = useMemo(() => (id: string) => select(id, "document"), [select]);

  // Selecting a card scrolls the document so the mark sits ~34% from the top —
  // but not when the selection came from a click in this pane, which would move
  // the passage out from under the pointer that chose it (issue #6).
  useEffect(() => {
    if (!selectedFactId || !pane.current || origin === "document") return;
    const mark = pane.current.querySelector(`[data-fact="${selectedFactId}"]`);
    if (mark instanceof HTMLElement) scrollToBand(pane.current, mark);
  }, [selectedFactId, origin]);

  // Switching view keeps the reader's place: the selected passage if there is
  // one, and otherwise the same share of the way down. The two views are
  // different heights, so the scroll position itself means nothing across them.
  useLayoutEffect(() => {
    const element = pane.current;
    const share = held.current;
    held.current = null;
    if (!element || share === null) return;
    const mark = selectedFactId ? element.querySelector(`[data-fact="${selectedFactId}"]`) : null;
    if (mark instanceof HTMLElement) scrollToBand(element, mark, undefined, "auto");
    else element.scrollTop = share * Math.max(0, element.scrollHeight - element.clientHeight);
    // Only a change of view moves the pane here; selection has its own effect above.
  }, [view]);

  const changeView = (next: SourceView) => {
    const element = pane.current;
    held.current = element ? element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight) : 0;
    setView(next);
  };

  const active = useActiveHeading(pane, hasContents ? entries : NO_ENTRIES);

  const jump = (id: string) => {
    const heading = pane.current?.querySelector(`[data-heading="${id}"]`);
    if (pane.current && heading instanceof HTMLElement) scrollToBand(pane.current, heading, HEADING_BAND);
  };

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="h-strip shrink-0 flex items-center gap-8 px-20 border-b border-border-subtle">
        <span className="text-smaller text-text-dim">Source document</span>
        <Mono className="text-text-dimmer">{status.wordCount} words</Mono>
        {source ? (
          <span className="text-smaller text-text-dimmer">imported {relative(source.importedAt)}</span>
        ) : null}
        <span className="ml-auto flex items-center gap-10">
          {hasContents && !contentsOpen ? (
            <Button variant="ghost" onClick={() => setContentsOpen(true)}>
              Contents
            </Button>
          ) : null}
          {tree ? (
            <SegmentedControl
              label="Document view"
              showLabel={false}
              value={view}
              onChange={changeView}
              segments={[
                { value: "rendered", label: "Rendered", tone: "neutral", hint: "Read it as a document." },
                {
                  value: "source",
                  label: "Source",
                  tone: "neutral",
                  hint: "The stored text, exactly. A quote is checked against these characters.",
                },
              ]}
            />
          ) : null}
          <Mono className="text-text-dimmer">{facts.length} passages marked</Mono>
        </span>
      </div>

      <div className="flex-1 min-h-0 flex">
        {hasContents && contentsOpen ? (
          <Contents entries={entries} active={active} onJump={jump} onHide={() => setContentsOpen(false)} />
        ) : null}
        <div ref={pane} className="flex-1 min-w-0 overflow-y-auto px-20 py-40">
          {view === "rendered" && tree ? (
            <MarkdownDocument
              tree={tree}
              source={text}
              ranges={ranges}
              onMark={onMark}
              className="mx-auto w-measure max-w-full"
            />
          ) : (
            <article className="mx-auto w-measure max-w-full text-doc-body text-text-body whitespace-pre-wrap">
              {markUp(text, ranges).map((piece, index) =>
                piece.range ? (
                  <mark
                    key={`${piece.range.id}-${index}`}
                    data-fact={piece.range.id}
                    onClick={() => onMark(piece.range!.id)}
                    className={`mark-base ${piece.range.className}`}
                  >
                    {piece.text}
                  </mark>
                ) : (
                  <span key={`t-${index}`}>{piece.text}</span>
                ),
              )}
            </article>
          )}
        </div>
      </div>
    </div>
  );
}

const NO_ENTRIES: ContentsEntry[] = [];

/** A jumped-to heading sits just under the top of the pane, not against it. */
const HEADING_BAND = 0.03;
/** A heading this near the top of the pane is the section being read. */
const READING_LINE = 60;

/**
 * Which section is being read: the last listed heading at or above the top of
 * the pane (`docs/10` Screen 1, "Contents"). Before the first heading it is the
 * first, so the column always says where the reader is.
 */
function useActiveHeading(pane: RefObject<HTMLDivElement | null>, entries: ContentsEntry[]) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const element = pane.current;
    if (!element || entries.length === 0) {
      setActive(null);
      return;
    }
    const listed = new Set(entries.map((entry) => entry.id));
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = element.getBoundingClientRect().top;
      let current = entries[0]!.id;
      for (const heading of element.querySelectorAll<HTMLElement>("[data-heading]")) {
        const id = heading.dataset.heading!;
        if (!listed.has(id)) continue;
        if (heading.getBoundingClientRect().top - top > READING_LINE) break;
        current = id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      element.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pane, entries]);

  return active;
}

/**
 * The contents of a rendered document: its headings, as links that jump to each
 * section (issue #56). A portfolio is long enough that scrolling to find a
 * section is the slow part of reviewing it.
 */
function Contents({
  entries,
  active,
  onJump,
  onHide,
}: {
  entries: ContentsEntry[];
  active: string | null;
  onJump: (id: string) => void;
  onHide: () => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const top = Math.min(...entries.map((entry) => entry.depth));

  // The column scrolls on its own, so the section being read is kept in it.
  useEffect(() => {
    const current = list.current?.querySelector('[aria-current="true"]');
    if (current instanceof HTMLElement && typeof current.scrollIntoView === "function") {
      current.scrollIntoView({ block: "nearest" });
    }
  }, [active]);

  return (
    <nav aria-label="Contents" className="w-sidebar shrink-0 min-h-0 flex flex-col bg-surface border-r border-border-subtle">
      <div className="shrink-0 flex items-center justify-between pl-14 pr-8 py-8 border-b border-border-subtle">
        <Mono className="text-text-dim">Contents</Mono>
        <Button variant="bare" onClick={onHide}>
          Hide
        </Button>
      </div>
      <ul ref={list} className="flex-1 overflow-y-auto p-8 grid gap-2 content-start">
        {entries.map((entry) => {
          const current = entry.id === active;
          return (
            <li key={entry.id}>
              <button
                type="button"
                aria-current={current ? "true" : undefined}
                onClick={() => onJump(entry.id)}
                className={`w-full text-left rounded-control py-4 pr-8 text-small motion-tone ${INDENT[entry.depth - top] ?? INDENT[2]} ${
                  current ? "bg-hover text-text-strong font-medium" : "text-text-dim hover:bg-hover hover:text-text-secondary"
                }`}
              >
                {entry.text}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** 12px per level below the first, from the scale: 8, 20, 32. */
const INDENT = ["pl-8", "pl-20", "pl-32"] as const;

/**
 * Border style carries meaning and must not be restyled: solid = normal,
 * dashed = Generated, dotted = Private, strikethrough = rejected, green
 * underline = accepted.
 */
function markClass(fact: Fact, selected: boolean): string {
  if (selected) return "mark-selected";
  if (fact.status === "rejected") return "mark-rejected";
  if (fact.status === "accepted") return "mark-accepted";
  if (fact.disclosure === "private") return "mark-private";
  if (fact.provenance === "generated") return "mark-generated";
  return "mark-normal";
}

interface Piece {
  text: string;
  range: MarkRange | null;
}

/** Splits the stored text into plain runs and marked spans, in document order. */
function markUp(text: string, ranges: MarkRange[]): Piece[] {
  const out: Piece[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) out.push({ text: text.slice(cursor, range.start), range: null });
    out.push({ text: text.slice(range.start, range.end), range });
    cursor = range.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), range: null });
  return out;
}

/* ---------------------------------------------------------------- fact rail */

function FactRail({
  importId,
  status,
  facts,
  finish,
  source,
  tree,
}: {
  importId: string;
  status: ImportStatus;
  facts: Fact[];
  finish: Finish;
  source: SourceText | undefined;
  tree: Root | null;
}) {
  const filter = useReviewStore((s) => s.filter);
  const setFilter = useReviewStore((s) => s.setFilter);
  const selectedFactId = useReviewStore((s) => s.selectedFactId);
  const origin = useReviewStore((s) => s.selectionOrigin);
  const select = useReviewStore((s) => s.select);
  const { retry } = useFactAction(importId);
  const failure = finish.failureAt("rail");
  const list = useRef<HTMLDivElement>(null);
  const running = isImportRunning(status.status);

  const open = facts.filter((f) => f.status === "candidate");
  const resolved = facts.filter((f) => f.status !== "candidate");
  const accepted = facts.filter((f) => f.status === "accepted");
  // The listing the facts no portfolio matched are graded from (issue #37).
  const ungraded = accepted.filter((f) => !f.graded);
  const visible =
    filter === "open" ? open : filter === "resolved" ? resolved : filter === "regrade" ? ungraded : facts;

  const shareable = accepted.filter((f) => f.disclosure !== "private" && f.provenance !== "generated").length;
  const priv = accepted.filter((f) => f.disclosure === "private").length;
  const needsPromotion = accepted.filter((f) => f.provenance === "generated").length;

  const filters: [FactFilter, string][] = [
    ["all", `All ${facts.length}`],
    // Plain words: a fact is waiting `to review` or it is `reviewed`. The filter
    // values keep the pipeline's names; the labels do not (`docs/10` Shared chrome).
    ["open", `To review ${open.length}`],
    ["resolved", `Reviewed ${resolved.length}`],
    // Only while there is something to re-grade, or while it is the filter in
    // use, so the last grade does not pull the pill out from under the pointer.
    ...(ungraded.length > 0 || filter === "regrade"
      ? ([["regrade", `To re-grade ${ungraded.length}`]] as [FactFilter, string][])
      : []),
  ];

  // The direction that did not exist (issue #6): clicking a passage never
  // brought its card into view, on a rail showing 622px of 2663. `revealInBand`
  // leaves an already-visible card where it is, so this cannot fight a reader
  // scrolling the rail; and it stays out of the way entirely when the selection
  // came from the rail, where the keyboard handler below does its own reveal.
  useEffect(() => {
    if (!selectedFactId || !list.current || origin === "rail") return;
    const card = list.current.querySelector(`[data-fact-card="${selectedFactId}"]`);
    if (card instanceof HTMLElement) revealInBand(list.current, card);
  }, [selectedFactId, origin]);

  /**
   * One roving tab stop for the whole rail; arrows move fact to fact. Only when
   * the card ITSELF holds focus — inside the claim editor the arrows move the
   * caret, and inside a segmented control they belong to the radio group.
   */
  const moveCard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLElement) || !event.target.dataset.factCard) return;
    const cards = [...(list.current?.querySelectorAll<HTMLElement>("[data-fact-card]") ?? [])];
    const at = cards.indexOf(event.target);
    const next =
      event.key === "ArrowDown"
        ? Math.min(cards.length - 1, at + 1)
        : event.key === "ArrowUp"
          ? Math.max(0, at - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? cards.length - 1
              : null;
    if (next === null || next === at) return;
    event.preventDefault();
    // `preventScroll` and an explicit reveal, so the rail uses the same band as
    // the document instead of the browser's own idea of "into view".
    cards[next]!.focus({ preventScroll: true });
    if (list.current) revealInBand(list.current, cards[next]!);
  };

  // Which card is tabbable. The selected one, or the first, so the rail is
  // always reachable in one Tab from the filter pills.
  const tabbable = visible.some((f) => f.id === selectedFactId) ? selectedFactId : (visible[0]?.id ?? null);

  return (
    <aside className="w-rail shrink-0 bg-surface border-l border-border flex flex-col">
      <div className="px-16 py-14 border-b border-border-subtle">
        <div className="flex items-center justify-between">
          <h2 className="text-panel font-semibold tracking-snug text-text-strong">Candidate facts</h2>
          <Mono className="text-text-dimmer">{status.candidatesExtracted} extracted</Mono>
        </div>
        <NextStep className="mt-6">
          {running && facts.length === 0
            ? "wait for the first facts. They appear here as they are found."
            : running
              ? "review the facts found so far while the rest of the document is read."
              : facts.length === 0
                ? "nothing was found to review."
                : open.length === 0
                  ? "everything here is reviewed. Press Finish review."
                  : `${open.length} fact${open.length === 1 ? "" : "s"} left to review.`}
        </NextStep>
        {status.candidatesDiscarded > 0 ? (
          <p className="mt-8 text-smaller text-text-faint">
            {status.candidatesDiscarded} candidate{status.candidatesDiscarded === 1 ? "" : "s"} did
            not quote the document exactly and {status.candidatesDiscarded === 1 ? "was" : "were"}{" "}
            discarded.
          </p>
        ) : null}
        {status.candidatesSuppressed > 0 ? (
          <p className="mt-8 text-smaller text-text-faint">
            {status.candidatesSuppressed} candidate{status.candidatesSuppressed === 1 ? "" : "s"}{" "}
            repeated facts already in your record and{" "}
            {status.candidatesSuppressed === 1 ? "was" : "were"} not offered again.
          </p>
        ) : null}
        <div className="mt-10 flex gap-4">
          {filters.map(([value, label]) => (
            <FilterPill key={value} active={filter === value} onClick={() => setFilter(value)}>
              {label}
            </FilterPill>
          ))}
        </div>
      </div>

      {/* Pinned, not in the list: scrolling the cards never scrolls the wait away. */}
      {running ? (
        <div className="shrink-0 px-16 pt-14">
          <ExtractionProgress
            status={status.status}
            chunksDone={status.chunksDone}
            chunksTotal={status.chunksTotal}
            meanwhile="You can review the facts already found."
          />
        </div>
      ) : null}

      <div
        ref={list}
        onKeyDown={moveCard}
        className="flex-1 overflow-y-auto px-16 py-14 grid gap-8 content-start"
      >
        <HowToReview />

        {status.status === "failed" ? (
          <FailedState status={status} onRetry={() => retry.mutate()} busy={retry.isPending} />
        ) : null}

        {isNothingNew(status) ? <NothingNewState status={status} /> : null}

        {visible.map((fact) => (
          <FactCard
            key={fact.id}
            importId={importId}
            fact={fact}
            tabbable={fact.id === tabbable}
            onSelect={() => select(fact.id, "rail")}
            source={source}
            tree={tree}
          />
        ))}
      </div>

      <div className="px-16 py-14 border-t border-border-subtle">
        <p className="flex items-center gap-12 text-smaller mb-10">
          <span className="text-measured-text" title="Accepted facts a document may use.">
            {shareable} shareable
          </span>
          <span className="text-private" title="Accepted facts kept in your record and never put in a document.">
            {priv} private
          </span>
          <span
            className="text-generated-text"
            title="Accepted facts still graded Generated. They stay out of every document until you grade them Measured or Attested."
          >
            {needsPromotion} need promotion
          </span>
        </p>
        {failure ? (
          <p role="alert" className="text-smaller text-removed mb-10">
            {failure}
          </p>
        ) : null}
        <Button
          variant="primary"
          className="w-full"
          disabled={accepted.length === 0}
          disabledReason="Nothing accepted yet"
          onClick={() => void finish.run("rail")}
        >
          {accepted.length === 0 ? "Nothing accepted yet" : `Add ${accepted.length} facts to record`}
        </Button>
      </div>
    </aside>
  );
}

/**
 * A re-import that is `ready` with zero candidates. The pipeline marks that a
 * success, not a failure, and the rail says so rather than sitting empty. Either
 * nothing changed (zero chunks; not "no changes", because a version that only
 * removes text lands here too), or the changed text only repeated the record
 * and the dedupe hash dropped every candidate.
 */
const isNothingNew = (status: ImportStatus) =>
  status.status === "ready" && status.candidatesExtracted === 0 && status.versionNo > 1;

function NothingNewState({ status }: { status: ImportStatus }) {
  const { versionNo, chunksTotal, candidatesSuppressed } = status;
  return (
    <div className="border border-border-control rounded-panel px-14 py-12">
      <p className="text-row font-medium text-text-strong">Nothing new to review</p>
      <p className="mt-6 text-smaller text-text-dim">
        {chunksTotal === 0
          ? `v${versionNo} adds no new or changed passages since v${versionNo - 1}, so there was nothing to extract.`
          : `Everything in the changed passages of v${versionNo} is already in your record (${candidatesSuppressed} fact${candidatesSuppressed === 1 ? "" : "s"}), so there is nothing new to review.`}{" "}
        Your record is unchanged.
      </p>
    </div>
  );
}

function FailedState({ status, onRetry, busy }: { status: ImportStatus; onRetry: () => void; busy: boolean }) {
  return (
    <div className="border border-border-control rounded-panel px-14 py-12">
      <p className="text-row font-medium text-text-strong">
        {status.error?.code === "no_facts_extracted"
          ? "No facts could be extracted from this document."
          : "This import stopped before it finished."}
      </p>
      <p className="mt-6 text-smaller text-text-dim">
        {status.error?.message}{" "}
        {status.failedAtChunk !== null
          ? `Retrying picks up at section ${status.failedAtChunk + 1}; everything before it is kept.`
          : "The document is kept, so you do not have to upload it again."}
      </p>
      <div className="mt-12">
        <Button onClick={onRetry} disabled={busy} disabledReason={busy ? "Retrying…" : undefined}>
          Retry
        </Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- fact card */

function FactCard({
  importId,
  fact,
  tabbable,
  onSelect,
  source,
  tree,
}: {
  importId: string;
  fact: Fact;
  tabbable: boolean;
  onSelect: () => void;
  source: SourceText | undefined;
  tree: Root | null;
}) {
  const { patch, resolve } = useFactAction(importId);
  // One line of failure per card, for whichever write the author made last: a
  // refused decision is cleared by the edit that fixes it, and the reverse.
  const edit = (body: Parameters<typeof patch.mutate>[0]["body"]) => {
    resolve.reset();
    patch.mutate({ id: fact.id, body });
  };
  const decide = (action: "accept" | "reject" | "undo") => {
    patch.reset();
    resolve.mutate({ id: fact.id, action });
  };
  const failure = patch.error ?? resolve.error;
  const selectedFactId = useReviewStore((s) => s.selectedFactId);
  const selected = fact.id === selectedFactId;
  const claim = useRef<HTMLDivElement>(null);

  /**
   * What makes the card the focusable unit (issue #8). `onFocusCapture` rather
   * than `onFocus` so that focus landing on any control *inside* the card
   * selects it too — Tab walks the controls and the source pane keeps up,
   * where before only a click on the article itself ever set the selection.
   */
  const handle = {
    "data-fact-card": fact.id,
    tabIndex: tabbable ? 0 : -1,
    "aria-current": selected,
    onClick: onSelect,
    onFocusCapture: onSelect,
  } as const;

  if (fact.status !== "candidate") {
    return (
      <article
        {...handle}
        className={`bg-card-recessed border rounded-tile px-12 py-10 outline-none focus-visible:shadow-ring ${
          selected ? "border-border-control" : "border-border-subtle"
        }`}
      >
        {/* Carried by the surface, the text token and the strikethrough. Dimming
            a card with opacity takes its text under the contrast floor (`docs/05` §1). */}
        <p className={`text-claim ${fact.status === "rejected" ? "text-text-dim line-through" : "text-text-strong"}`}>
          {fact.claim}
        </p>
        <div className="mt-8 flex items-center gap-10">
          <Mono className="text-text-faint">
            {fact.status} · {fact.provenance} · {fact.disclosure}
          </Mono>
          <button
            type="button"
            className="ml-auto text-smaller text-text-dim hover:text-text-secondary"
            onClick={() => decide("undo")}
          >
            Undo
          </button>
        </div>
        {/*
          An accepted fact can still be filed. This is the surface the 112 facts
          of the first real import are linked through: re-importing to gain the
          foreign key would create a new source version and orphan every accept
          decision made against the old one (issue #14).
        */}
        <div className="mt-8">
          <EmployerPicker
            value={fact.employerId}
            onChange={(employerId) => edit({ employerId })}
          />
        </div>
        {fact.status === "accepted" && !fact.graded ? (
          <RegradeLine importId={importId} id={fact.id} provenance={fact.provenance} />
        ) : null}
        {failure ? (
          <p role="alert" className="mt-8 text-smaller text-removed">
            {failureText(failure)}
          </p>
        ) : null}
      </article>
    );
  }

  const isGenerated = fact.provenance === "generated";
  const isPrivate = fact.disclosure === "private";
  const surface = isPrivate
    ? "bg-card-recessed border-border-subtle"
    : isGenerated
      ? "bg-card border-generated-rule border-dashed"
      : "bg-card border-border-control";
  const lift = selected
    ? isGenerated
      ? "shadow-lifted-generated"
      : isPrivate
        ? "shadow-lifted-private"
        : "shadow-lifted"
    : "";

  return (
    <article
      {...handle}
      className={`border rounded-tile px-14 py-12 motion-elevation outline-none focus-visible:shadow-ring ${surface} ${lift} ${
        selected ? "bg-card-selected" : ""
      }`}
    >
      <div className="flex items-center gap-8">
        {fact.evidence ? <Mono className="text-text-dimmer">L{fact.evidence.lineNumber}</Mono> : null}
        {isGenerated ? (
          <Mono className="text-generated-text">Draft · not usable</Mono>
        ) : null}
        {isPrivate ? <Mono className="text-private">Private · never shared</Mono> : null}
      </div>

      {/* Inline editable, commits on blur — the record carries your phrasing. */}
      <div
        ref={claim}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Fact claim"
        onBlur={(event) => {
          const next = event.currentTarget.textContent?.trim() ?? "";
          if (next && next !== fact.claim) edit({ claim: next });
        }}
        className={`mt-8 -ml-4 px-4 py-2 rounded-control text-claim cursor-text outline-none focus:bg-private-mark focus:shadow-ring ${
          isGenerated ? "italic text-generated-claim" : "text-text-strong"
        }`}
      >
        {fact.claim}
      </div>

      {source ? <QuotedPassage fact={fact} source={source} tree={tree} /> : null}

      {fact.likelyMatches.length > 0 ? (
        <LikelyMatches importId={importId} matches={fact.likelyMatches} />
      ) : null}

      {isGenerated ? (
        <div className="mt-10">
          <Notice tone="generated">
            Inferred by the importer — this is not stated in the source. Promote it to Attested or
            Measured before it can appear in a document.
          </Notice>
        </div>
      ) : null}

      <div className="mt-12 grid gap-8">
        <SegmentedControl
          label="Worth"
          value={fact.provenance}
          onChange={(provenance) => edit({ provenance })}
          segments={[
            { value: "measured", label: "Measured", tone: "measured", hint: WORTH.measured },
            { value: "attested", label: "Attested", tone: "accent", hint: WORTH.attested },
            { value: "generated", label: "Generated", tone: "generated", hint: WORTH.generated },
          ]}
        />
        <SegmentedControl
          label="Who"
          value={fact.disclosure}
          onChange={(disclosure) => edit({ disclosure })}
          segments={[
            { value: "public", label: "Public", tone: "measured", hint: WHO.public },
            { value: "restricted", label: "Restricted", tone: "restricted", hint: WHO.restricted },
            { value: "private", label: "Private", tone: "private", hint: WHO.private },
          ]}
        />
        <EmployerPicker
          value={fact.employerId}
          onChange={(employerId) => edit({ employerId })}
        />
      </div>

      {failure ? (
        <p role="alert" className="mt-10 text-smaller text-removed">
          {failureText(failure)}
        </p>
      ) : null}

      {isPrivate ? (
        <p className="mt-10 text-smaller text-text-faint">
          Private facts stay in your record and never appear in any document you generate.
        </p>
      ) : null}

      <div className="mt-12 flex items-center gap-10">
        <Button variant="ghost" onClick={() => decide("reject")}>
          Reject
        </Button>
        {isGenerated ? (
          <span className="text-smaller text-generated-text">Kept out of documents until promoted</span>
        ) : null}
        <Button
          variant="primary"
          className="ml-auto"
          onClick={() => decide("accept")}
        >
          {isPrivate ? "Accept · private" : "Accept"}
        </Button>
      </div>
    </article>
  );
}

/**
 * What the three controls on a card ask, in the author's words rather than the
 * schema's (`docs/10` Screen 1, "How to review"; PRD §5). Said once in the guide
 * and again on hover over each value, so the two cannot drift.
 */
const WORTH = {
  measured: "A number the passage states.",
  attested: "True and yours, but not a number.",
  generated: "The importer's guess. It stays out of every document until you change it.",
} as const;

const WHO = {
  public: "Can go to any employer.",
  restricted: "Used only in general terms, with the client unnamed.",
  private: "Stays in your record and is never put in a document.",
} as const;

const GUIDE_KEY = "track-record:review-guide";

/** Whether the guide was hidden in this browser. Storage can be refused; then it is simply shown. */
function guideHidden(): boolean {
  try {
    return localStorage.getItem(GUIDE_KEY) === "hidden";
  } catch {
    return false;
  }
}

/**
 * This screen's intro (issue #56). The first pass through review was not
 * self-explanatory: nothing said what the screen expects, or what `Worth`,
 * `Who` and `Where` ask. It explains the controls and changes nothing about
 * them. It scrolls with the cards and can be hidden, because it is a dozen
 * lines on the most-used screen.
 */
function HowToReview() {
  const [hidden, setHidden] = useState(guideHidden);
  const toggle = () => {
    const next = !hidden;
    setHidden(next);
    try {
      if (next) localStorage.setItem(GUIDE_KEY, "hidden");
      else localStorage.removeItem(GUIDE_KEY);
    } catch {
      // Not remembered, but done.
    }
  };

  return (
    <section
      aria-label="How to review"
      className="bg-surface-raised border border-border-control rounded-tile px-14 py-10"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-row font-medium text-text-strong">How to review</h3>
        <Button variant="bare" aria-expanded={!hidden} onClick={toggle}>
          {hidden ? "Show" : "Hide"}
        </Button>
      </div>
      {hidden ? null : (
        <div className="mt-8 grid gap-10 text-small text-text-secondary">
          <ol className="grid gap-4 list-decimal pl-16">
            <li>Read the highlighted passage on the left. It is the evidence.</li>
            <li>Check that the claim on its card says what the passage says. Click the claim to reword it.</li>
            <li>Accept it into your record, or reject it. Either can be undone.</li>
          </ol>
          <dl className="grid gap-6">
            <GuideTerm term="Worth" meaning="how you know it.">
              <b className="font-medium text-text-strong">Measured</b>: {lower(WORTH.measured)}{" "}
              <b className="font-medium text-text-strong">Attested</b>: {lower(WORTH.attested)}{" "}
              <b className="font-medium text-text-strong">Generated</b>: {lower(WORTH.generated)}
            </GuideTerm>
            <GuideTerm term="Who" meaning="who may read it.">
              <b className="font-medium text-text-strong">Public</b>: {lower(WHO.public)}{" "}
              <b className="font-medium text-text-strong">Restricted</b>: {lower(WHO.restricted)}{" "}
              <b className="font-medium text-text-strong">Private</b>: {lower(WHO.private)}
            </GuideTerm>
            <GuideTerm term="Where" meaning="the employer it happened at." />
          </dl>
        </div>
      )}
    </section>
  );
}

/** A definition reads on after a colon, so its sentence starts lower-case there. */
const lower = (sentence: string) => sentence.charAt(0).toLowerCase() + sentence.slice(1);

function GuideTerm({
  term,
  meaning,
  children,
}: {
  term: string;
  meaning: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <dt>
        <span className="font-semibold text-text-strong">{term}</span>, {meaning}
      </dt>
      {children ? <dd className="mt-2">{children}</dd> : null}
    </div>
  );
}

/**
 * The passage a card quotes, on the card (`docs/10` Screen 1, issue #56), so
 * the evidence and the decision are in one place. Rendered for a Markdown
 * document, with the stored characters one press away: a quote is verified
 * against those, not against what they render as.
 *
 * EVERY OPEN CARD SHOWS IT, NOT ONLY THE SELECTED ONE. A press on an unselected
 * card selects it at mousedown; a passage that mounted then would move the
 * control out from under the press, and the click would be lost.
 */
function QuotedPassage({ fact, source, tree }: { fact: Fact; source: SourceText; tree: Root | null }) {
  const [exact, setExact] = useState(false);
  // An offset means something only in the version it was measured in.
  if (!fact.evidence || fact.evidence.sourceDocumentVersionId !== source.sourceDocumentVersionId) return null;
  const { quoteStart, quoteEnd } = fact.evidence;
  const stored = source.text.slice(quoteStart, quoteEnd);
  if (stored === "") return null;
  // `null` for a quote that is markup and nothing else: there is no rendered
  // form of it, so the stored characters are all there is to show.
  const rendered = tree ? quoteExcerpt(tree, source.text, quoteStart, quoteEnd) : null;

  return (
    <section aria-label="Quoted passage" className="mt-10 border-l border-border-strong pl-10 grid gap-4">
      <div className="flex items-center gap-8">
        <Mono className="text-text-faint">Quoted passage</Mono>
        {rendered ? (
          <Button variant="bare" className="ml-auto" aria-pressed={exact} onClick={() => setExact(!exact)}>
            {exact ? "Rendered" : "Exact text"}
          </Button>
        ) : null}
      </div>
      {rendered && !exact ? (
        <p className="text-small text-text-secondary">{rendered}</p>
      ) : (
        <p className="text-small text-text-secondary whitespace-pre-wrap">{stored}</p>
      )}
    </section>
  );
}

/**
 * Overlap on the card (`docs/10` Screen 1, issue #36): the accepted facts at the
 * same employer this candidate likely restates, directly under its claim so the
 * two read as a pair.
 *
 * Advisory. It changes nothing about Accept or Reject, which are how it is
 * settled — the document link goes to where the other fact is rejected. A
 * conflict takes no semantic colour: green, amber and red already mean
 * Measured, Generated and removed, and a conflict is none of them. No score is
 * shown because none is sent; order is the only sign of which is closer.
 */
function LikelyMatches({ importId, matches }: { importId: string; matches: LikelyMatch[] }) {
  return (
    <section
      aria-label="Likely already in your record"
      className="mt-10 border-l border-border-strong pl-10 grid gap-8"
    >
      <Mono className="text-text-faint">Likely already in your record</Mono>
      {matches.map((match) => (
        <div key={match.id} className="grid gap-2">
          {match.conflict ? (
            <Mono className="font-medium text-text-bright">Conflict · number differs</Mono>
          ) : null}
          <p className="text-small text-text-secondary">{match.claim}</p>
          {match.document ? (
            <Link
              to="/imports/$importId"
              params={{ importId: match.document.importId }}
              className="justify-self-start text-text-dimmer hover:text-text-secondary"
            >
              <MonoId>
                {match.document.filename}
                {match.document.versionNo > 1 ? ` · v${match.document.versionNo}` : ""}
              </MonoId>
            </Link>
          ) : null}
          {match.graded ? null : (
            <RegradeLine importId={importId} id={match.id} provenance={match.provenance} />
          )}
        </div>
      ))}
    </section>
  );
}

const GRADES: { value: Fact["provenance"]; label: string }[] = [
  { value: "measured", label: "Measured" },
  { value: "attested", label: "Attested" },
  { value: "generated", label: "Generated" },
];

/**
 * The re-grade of an accepted fact whose provenance is not the author's — the
 * 112 of the 2026-09-04 import (`docs/10` Screen 1, issue #37). On the overlap
 * card it sits under a likely match, so a narrative fact is graded beside the
 * portfolio fact that decides it; on its own import's card it is the listing.
 *
 * Buttons, not the card's radio group: a radio group selects on arrow keys, and
 * each choice here is a write. None is marked as chosen, so confirming the
 * default takes a press like changing it does. `Reject` is the portfolio
 * winning, settled where the two claims are side by side.
 */
function RegradeLine({
  importId,
  id,
  provenance,
}: {
  importId: string;
  id: string;
  provenance: Fact["provenance"];
}) {
  const { regrade, resolve } = useFactAction(importId);
  const busy = regrade.isPending || resolve.isPending;
  const failure = regrade.error ?? resolve.error;

  return (
    <div className="mt-6 grid gap-6">
      <Mono className="text-text-faint">Graded by default · {provenance}</Mono>
      <div role="group" aria-label="Re-grade" className="flex flex-wrap items-center gap-4">
        {GRADES.map((grade) => (
          <Button
            key={grade.value}
            disabled={busy}
            disabledReason={busy ? "Saving…" : undefined}
            onClick={() => {
              resolve.reset();
              regrade.mutate({ id, provenance: grade.value });
            }}
          >
            {grade.label}
          </Button>
        ))}
        <Button
          variant="ghost"
          className="ml-auto"
          disabled={busy}
          disabledReason={busy ? "Saving…" : undefined}
          onClick={() => {
            regrade.reset();
            resolve.mutate({ id, action: "reject" });
          }}
        >
          Reject
        </Button>
      </div>
      {failure ? (
        <p role="alert" className="text-smaller text-removed">
          {failureText(failure)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Which employer a fact belongs to.
 *
 * A plain select rather than a segmented control: employers are data and there
 * may be any number of them, where provenance and disclosure are fixed vocabularies.
 *
 * With no employers recorded the control states that rather than offering an
 * empty list — the record screen is where they are entered, and a fact filed
 * under nothing is what the résumé's employer sections used to be inferred from.
 */
function EmployerPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (employerId: string | null) => void;
}) {
  const employers = useEntities<Employer>("employers");
  const items = employers.data?.items ?? [];

  return (
    <div className="flex items-center gap-8">
      <span className="text-mono-label font-mono uppercase tracking-mono text-text-faint w-60 shrink-0">
        Where
      </span>
      {items.length === 0 ? (
        <span className="text-smaller text-text-faint">
          No employers recorded — add one under Record.
        </span>
      ) : (
        <select
          aria-label="Employer"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value || null)}
          className="min-h-control-inline bg-surface-raised border border-border-control rounded-control px-8 py-4 text-smaller text-text-secondary outline-none focus:shadow-ring"
        >
          <option value="">Unfiled</option>
          {items.map((employer) => (
            <option key={employer.id} value={employer.id}>
              {employer.nameLatin ?? employer.nameJa}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
