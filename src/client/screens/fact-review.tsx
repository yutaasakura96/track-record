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
 */
import { useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  useFactAction,
  useFacts,
  useImportStatus,
  useSourceText,
  type Fact,
  type ImportStatus,
} from "../api";
import { Button, Chip, FilterPill, Mono, Notice, ProgressBar, SegmentedControl } from "../components/ui";
import { useReviewStore, type FactFilter } from "../stores/review";
import { relative } from "./overview";

export function FactReview() {
  const { importId } = useParams({ from: "/imports/$importId" });
  const status = useImportStatus(importId);
  const facts = useFacts(importId, {
    // Cards appear incrementally as extraction progresses, rather than after
    // one long silence.
    refetchInterval:
      status.data?.status === "queued" || status.data?.status === "extracting" ? 1500 : false,
  });
  const source = useSourceText(status.data?.sourceDocumentId ?? "", status.data?.versionNo ?? 1);
  const select = useReviewStore((s) => s.select);

  useEffect(() => () => select(null), [select]);

  if (!status.data) {
    return <div className="min-h-screen grid place-items-center text-small text-text-dim">Opening the document…</div>;
  }

  const items = facts.data?.items ?? [];
  const resolved = items.filter((f) => f.status !== "candidate");

  return (
    <div className="h-screen flex flex-col">
      <Header
        filename={source.data?.filename ?? "…"}
        importId={importId}
        resolvedCount={resolved.length}
        total={items.length}
      />
      <div className="flex-1 min-h-0 flex">
        <SourcePane status={status.data} text={source.data?.text ?? ""} facts={items} />
        <FactRail importId={importId} status={status.data} facts={items} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ header */

function Header({
  filename,
  importId,
  resolvedCount,
  total,
}: {
  filename: string;
  importId: string;
  resolvedCount: number;
  total: number;
}) {
  const navigate = useNavigate();
  const { finish } = useFactAction(importId);
  const allResolved = total > 0 && resolvedCount === total;

  return (
    <header className="h-header shrink-0 flex items-center gap-10 px-20 bg-surface border-b border-border">
      <span className="text-panel font-semibold tracking-snug text-text-strong">Imports</span>
      <span className="text-text-faint">/</span>
      <Chip>{filename}</Chip>

      <div className="ml-auto flex items-center gap-14">
        <span className="text-smaller text-text-dimmer">
          {resolvedCount} of {total} reviewed
        </span>
        <ProgressBar className="w-progress" value={total === 0 ? 0 : resolvedCount / total} />
        {/* One action, two affordances — the footer button is the same call. */}
        <Button
          variant={allResolved ? "primary" : "secondary"}
          onClick={async () => {
            await finish.mutateAsync();
            await navigate({ to: "/" });
          }}
        >
          Finish review
        </Button>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------- source pane */

function SourcePane({
  status,
  text,
  facts,
}: {
  status: ImportStatus;
  text: string;
  facts: Fact[];
}) {
  const selectedFactId = useReviewStore((s) => s.selectedFactId);
  const select = useReviewStore((s) => s.select);
  const pane = useRef<HTMLDivElement>(null);

  const marked = useMemo(() => markUp(text, facts), [text, facts]);

  // Selecting a card scrolls the document so the mark sits ~34% from the top.
  useEffect(() => {
    if (!selectedFactId || !pane.current) return;
    const mark = pane.current.querySelector(`[data-fact="${selectedFactId}"]`);
    if (!(mark instanceof HTMLElement)) return;
    const offset = mark.offsetTop - pane.current.clientHeight * 0.34;
    pane.current.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
  }, [selectedFactId]);

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="h-strip shrink-0 flex items-center gap-8 px-20 border-b border-border-subtle">
        <span className="text-smaller text-text-dim">Source document</span>
        <Mono className="text-text-dimmer">{status.wordCount} words</Mono>
        <span className="text-smaller text-text-dimmer">imported {relative(new Date().toISOString())}</span>
        <Mono className="ml-auto text-text-dimmer">{facts.length} passages marked</Mono>
      </div>

      <div ref={pane} className="flex-1 overflow-y-auto px-20 py-40">
        <article className="mx-auto w-measure max-w-full text-doc-body text-text-body whitespace-pre-wrap">
          {marked.map((piece, index) =>
            piece.fact ? (
              <mark
                key={`${piece.fact.id}-${index}`}
                data-fact={piece.fact.id}
                onClick={() => select(piece.fact!.id)}
                className={`mark-base ${markClass(piece.fact, piece.fact.id === selectedFactId)}`}
              >
                {piece.text}
              </mark>
            ) : (
              <span key={`t-${index}`}>{piece.text}</span>
            ),
          )}
        </article>
      </div>
    </div>
  );
}

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
  fact: Fact | null;
}

/** Splits the document into plain runs and marked spans, in document order. */
function markUp(text: string, facts: Fact[]): Piece[] {
  const spans = facts
    .filter((f) => f.evidence !== null)
    .map((f) => ({ fact: f, start: f.evidence!.quoteStart, end: f.evidence!.quoteEnd }))
    .sort((a, b) => a.start - b.start);

  const pieces: Piece[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue; // overlapping marks: the first one wins
    if (span.start > cursor) pieces.push({ text: text.slice(cursor, span.start), fact: null });
    pieces.push({ text: text.slice(span.start, span.end), fact: span.fact });
    cursor = span.end;
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor), fact: null });
  return pieces;
}

/* ---------------------------------------------------------------- fact rail */

function FactRail({
  importId,
  status,
  facts,
}: {
  importId: string;
  status: ImportStatus;
  facts: Fact[];
}) {
  const filter = useReviewStore((s) => s.filter);
  const setFilter = useReviewStore((s) => s.setFilter);
  const { finish, retry } = useFactAction(importId);
  const navigate = useNavigate();

  const open = facts.filter((f) => f.status === "candidate");
  const resolved = facts.filter((f) => f.status !== "candidate");
  const accepted = facts.filter((f) => f.status === "accepted");
  const visible = filter === "open" ? open : filter === "resolved" ? resolved : facts;

  const shareable = accepted.filter((f) => f.disclosure !== "private" && f.provenance !== "generated").length;
  const priv = accepted.filter((f) => f.disclosure === "private").length;
  const needsPromotion = accepted.filter((f) => f.provenance === "generated").length;

  const filters: [FactFilter, string][] = [
    ["all", `All ${facts.length}`],
    ["open", `Open ${open.length}`],
    ["resolved", `Resolved ${resolved.length}`],
  ];

  return (
    <aside className="w-rail shrink-0 bg-surface border-l border-border flex flex-col">
      <div className="px-16 py-14 border-b border-border-subtle">
        <div className="flex items-center justify-between">
          <h2 className="text-panel font-semibold tracking-snug text-text-strong">Candidate facts</h2>
          <Mono className="text-text-dimmer">{status.candidatesExtracted} extracted</Mono>
        </div>
        <p className="mt-6 text-smaller text-text-dim">
          Each card shows a claim beside the passage that proves it. Set what it is worth and who may
          see it, then accept or reject.
        </p>
        {status.candidatesDiscarded > 0 ? (
          <p className="mt-8 text-smaller text-text-faint">
            {status.candidatesDiscarded} candidate{status.candidatesDiscarded === 1 ? "" : "s"} did
            not quote the document exactly and {status.candidatesDiscarded === 1 ? "was" : "were"}{" "}
            discarded.
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

      <div className="flex-1 overflow-y-auto px-16 py-14 grid gap-8 content-start">
        {status.status === "failed" ? (
          <FailedState status={status} onRetry={() => retry.mutate()} busy={retry.isPending} />
        ) : null}

        {status.status === "extracting" || status.status === "queued" ? (
          <div className="grid gap-8">
            <ProgressBar value={status.chunksTotal ? status.chunksDone / status.chunksTotal : 0} />
            <p className="text-smaller text-text-dim">
              Reading the document — {status.chunksDone} of {status.chunksTotal || "…"} sections
              done. Cards appear as they are found.
            </p>
          </div>
        ) : null}

        {visible.map((fact) => (
          <FactCard key={fact.id} importId={importId} fact={fact} />
        ))}
      </div>

      <div className="px-16 py-14 border-t border-border-subtle">
        <p className="flex items-center gap-12 text-smaller mb-10">
          <span className="text-measured-text">{shareable} shareable</span>
          <span className="text-private">{priv} private</span>
          <span className="text-generated-text">{needsPromotion} need promotion</span>
        </p>
        <Button
          variant="primary"
          className="w-full"
          disabled={accepted.length === 0}
          disabledReason="Nothing accepted yet"
          onClick={async () => {
            await finish.mutateAsync();
            await navigate({ to: "/" });
          }}
        >
          {accepted.length === 0 ? "Nothing accepted yet" : `Add ${accepted.length} facts to record`}
        </Button>
      </div>
    </aside>
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

function FactCard({ importId, fact }: { importId: string; fact: Fact }) {
  const { patch, resolve } = useFactAction(importId);
  const selectedFactId = useReviewStore((s) => s.selectedFactId);
  const select = useReviewStore((s) => s.select);
  const selected = fact.id === selectedFactId;
  const claim = useRef<HTMLDivElement>(null);

  if (fact.status !== "candidate") {
    return (
      <article
        className={`bg-card-recessed border border-border-subtle rounded-tile px-12 py-10 ${
          fact.status === "accepted" ? "opacity-80" : "opacity-50"
        }`}
      >
        <p className={`text-claim text-text-strong ${fact.status === "rejected" ? "line-through" : ""}`}>
          {fact.claim}
        </p>
        <div className="mt-8 flex items-center gap-10">
          <Mono className="text-text-faint">
            {fact.status} · {fact.provenance} · {fact.disclosure}
          </Mono>
          <button
            type="button"
            className="ml-auto text-smaller text-text-dim hover:text-text-secondary"
            onClick={() => resolve.mutate({ id: fact.id, action: "undo" })}
          >
            Undo
          </button>
        </div>
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
      onClick={() => select(fact.id)}
      className={`border rounded-tile px-14 py-12 motion-elevation ${surface} ${lift} ${
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
          if (next && next !== fact.claim) patch.mutate({ id: fact.id, body: { claim: next } });
        }}
        className={`mt-8 -ml-4 px-4 py-2 rounded-control text-claim cursor-text outline-none focus:bg-private-mark focus:shadow-ring ${
          isGenerated ? "italic text-generated-claim" : "text-text-strong"
        }`}
      >
        {fact.claim}
      </div>

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
          onChange={(provenance) => patch.mutate({ id: fact.id, body: { provenance } })}
          segments={[
            { value: "measured", label: "Measured", tone: "measured" },
            { value: "attested", label: "Attested", tone: "accent" },
            { value: "generated", label: "Generated", tone: "generated" },
          ]}
        />
        <SegmentedControl
          label="Who"
          value={fact.disclosure}
          onChange={(disclosure) => patch.mutate({ id: fact.id, body: { disclosure } })}
          segments={[
            { value: "public", label: "Public", tone: "measured" },
            { value: "restricted", label: "Restricted", tone: "restricted" },
            { value: "private", label: "Private", tone: "private" },
          ]}
        />
      </div>

      {patch.error ? (
        <p role="alert" className="mt-10 text-smaller text-removed">
          {patch.error.message}
        </p>
      ) : null}

      {isPrivate ? (
        <p className="mt-10 text-smaller text-text-faint">
          Private facts stay in your record and never appear in any document you generate.
        </p>
      ) : null}

      <div className="mt-12 flex items-center gap-10">
        <Button variant="ghost" onClick={() => resolve.mutate({ id: fact.id, action: "reject" })}>
          Reject
        </Button>
        {isGenerated ? (
          <span className="text-smaller text-generated-text">Kept out of documents until promoted</span>
        ) : null}
        <Button
          variant="primary"
          className="ml-auto"
          onClick={() => resolve.mutate({ id: fact.id, action: "accept" })}
        >
          {isPrivate ? "Accept · private" : "Accept"}
        </Button>
      </div>
    </article>
  );
}
