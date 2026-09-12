/**
 * The download control, on all four screens that offer one.
 *
 * It is a button rather than a link because the route can refuse. Every
 * download re-checks the facts its stored content cites, and a version citing
 * a fact set Private after it was accepted comes back `409` with the ids
 * (issue #17, `docs/06` 2026-09-12). A link would put that JSON in a browser
 * tab; a fetch puts it in front of the author where the download was asked for.
 *
 * The refusal states the way out. It is a dead end only in the sense that this
 * version will not download again — the record is what changed, and the fix is
 * in the record or in a new version that does not carry the block.
 */
import { useEffect, useState } from "react";
import { ApiError, downloadRender } from "../api";
import { MonoId } from "./ui";
import type { RenderKind } from "~/shared/render-content";

/** What a refusal says per id, in the author's words rather than the column's. */
export const CITATION_PROBLEM: Record<string, string> = {
  unknown: "is not in your record",
  "not-accepted": "has not been accepted",
  private: "is Private",
  generated: "is Generated provenance",
};

export interface WithheldFact {
  factId: string;
  problem: string;
}

/** The ids a citation refusal named, or an empty list for any other failure. */
export const withheldFacts = (error: ApiError): WithheldFact[] =>
  (error.details.facts ?? []) as WithheldFact[];

/**
 * The ids under the refusal, on all three surfaces that state one: this dialog,
 * the restore footer and the editor.
 *
 * **It renders nothing for a single fact.** The server's own sentence already
 * names that one (`<id> is Private and never reaches a document`), and a list
 * under it repeats the id to say the same thing twice. From two facts up the
 * message names only the first plus `(and N others)`, so the list becomes the
 * only place the rest are said, and it earns its space.
 */
export function WithheldFacts({
  facts,
  className = "text-smaller text-text-dimmer",
}: {
  facts: readonly WithheldFact[];
  className?: string;
}) {
  if (facts.length < 2) return null;
  return (
    <>
      {facts.map((fact) => (
        <span key={fact.factId} className={`block mt-4 ${className}`}>
          <MonoId>{fact.factId}</MonoId> {CITATION_PROBLEM[fact.problem] ?? "cannot be rendered"}.
        </span>
      ))}
    </>
  );
}

export function DownloadButton({
  kind,
  versionId,
  label = "Download .docx",
  className = "border border-border-strong text-text-muted px-10 py-6 rounded-control text-smaller font-medium hover:bg-hover hover:text-text-secondary",
}: {
  kind: RenderKind;
  versionId?: string;
  label?: string;
  className?: string;
}) {
  const [refusal, setRefusal] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={async () => {
          setRefusal(null);
          setBusy(true);
          try {
            await downloadRender(kind, "docx", versionId);
          } catch (error) {
            if (error instanceof ApiError) setRefusal(error);
            else throw error;
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Preparing…" : label}
      </button>
      {refusal ? <Refusal error={refusal} onClose={() => setRefusal(null)} /> : null}
    </>
  );
}

/**
 * Stated over the screen rather than inline: three of the four call sites sit
 * in a row of controls with no room for a paragraph, and a refusal that has to
 * fit beside a button is a refusal that gets truncated.
 */
function Refusal({ error, onClose }: { error: ApiError; onClose: () => void }) {
  const facts = withheldFacts(error);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-bg/80 flex items-center justify-center p-20"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-panel p-20 w-content max-w-full flex flex-col gap-10"
        onClick={(event) => event.stopPropagation()}
      >
        <p role="alert" className="text-smaller text-text-secondary">
          {error.message}
        </p>
        <WithheldFacts facts={facts} />
        {facts.length > 0 ? (
          <p className="text-smaller text-text-dimmer">
            A document obeys your record as it is today, not as it was when this version was
            accepted. Change the fact in your record, or edit the block out into a new version.
          </p>
        ) : null}
        <button
          type="button"
          className="ml-auto border border-border-strong text-text-muted px-10 py-6 rounded-control text-smaller font-medium hover:bg-hover hover:text-text-secondary"
          onClick={onClose}
          autoFocus
        >
          Close
        </button>
      </div>
    </div>
  );
}
