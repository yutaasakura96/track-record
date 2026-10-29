/**
 * The parts of a proposal drafted for the author (`docs/06`, 2026-10-26).
 *
 * A tailored 履歴書's 志望動機 and 本人希望欄 say why the author wants this job
 * and what they ask of it. The record states neither, so the model drafts
 * both and the author makes them their own here: each is confirmed as it
 * stands or edited, one at a time, and the proposal cannot be accepted until
 * none is left. The rest of the review is still all-or-nothing.
 */
import { useId, useState } from "react";
import { failureText, useConfirmDraft, type ProposalDraft } from "../api";
import { CONTROL } from "./application-chrome";
import { Button } from "./ui";

/** The 履歴書's names for its two cells, as the form prints them. */
const CELL_NAME: Record<string, string> = {
  motivation: "志望動機・特技・アピールポイントなど",
  kibou: "本人希望欄",
};

export function DraftedParts({ proposalId, drafts }: { proposalId: string; drafts: ProposalDraft[] }) {
  if (drafts.length === 0) return null;
  return (
    <section
      aria-label="Drafted for you"
      className="shrink-0 max-h-rail overflow-y-auto grid gap-10 content-start px-20 py-12 bg-surface-raised border-t border-border"
    >
      <div className="grid gap-4">
        <h2 className="text-row font-medium text-text-strong">
          Drafted for you: {drafts.length === 1 ? "1 part" : `${drafts.length} parts`} to confirm
        </h2>
        <p className="text-small text-text-muted">
          Your record does not say why you want this job or what you would ask for, so these were drafted from the
          posting, your record and any notes you wrote on the application. Confirm each one as it is, or change it to
          what you would say. It is your 履歴書: accepting waits until every part is yours.
        </p>
      </div>
      {drafts.map((draft) => (
        <DraftedPart key={draft.blockId} proposalId={proposalId} draft={draft} />
      ))}
    </section>
  );
}

function DraftedPart({ proposalId, draft }: { proposalId: string; draft: ProposalDraft }) {
  const confirm = useConfirmDraft(proposalId);
  const [text, setText] = useState(draft.text);
  const id = useId();
  const edited = text.trim() !== draft.text;
  const empty = text.trim() === "";

  return (
    <form
      aria-label={`Drafted: ${CELL_NAME[draft.sectionKey] ?? draft.heading}`}
      className="grid gap-6 bg-card border border-dashed border-border-dashed rounded-control px-12 py-10"
      onSubmit={(event) => {
        event.preventDefault();
        confirm.mutate({ blockId: draft.blockId, text: text.trim() });
      }}
    >
      <label htmlFor={id} className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <span lang="ja" className="text-small font-medium text-text-strong">
          {CELL_NAME[draft.sectionKey] ?? draft.heading}
        </span>
        <span className="text-smaller text-text-dim">Draft · not confirmed</span>
      </label>
      <textarea
        id={id}
        lang="ja"
        rows={draft.sectionKey === "kibou" ? 2 : 5}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className={`${CONTROL} resize-y tracking-ja`}
      />
      {confirm.isError ? (
        <p role="alert" className="text-smaller text-removed">
          {failureText(confirm.error)}
        </p>
      ) : null}
      <span className="flex flex-wrap items-center gap-8">
        <Button
          type="submit"
          variant={edited ? "primary" : "secondary"}
          disabled={confirm.isPending || empty}
          disabledReason={confirm.isPending ? "Saving…" : "Write what this part should say first."}
        >
          {edited ? "Save my wording" : "Confirm as written"}
        </Button>
        {edited ? (
          <Button type="button" variant="bare" onClick={() => setText(draft.text)}>
            Put the draft back
          </Button>
        ) : null}
        <span className="text-smaller text-text-dimmer font-mono">{[...text.trim()].length} characters</span>
      </span>
    </form>
  );
}
