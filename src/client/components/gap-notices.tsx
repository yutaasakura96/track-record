/**
 * The 履歴書's gaps, said wherever the 履歴書 is, and answerable there (issue
 * #117, review §5 G1–G3).
 *
 * The warning used to live in the review footer alone, and was gone once the
 * document was accepted, though the gap was still in the table being sent.
 * It is now read from the record, as the table is, by View, Home and the
 * career timeline alike. Each gap offers "Add an explanation", which writes
 * doda's ※ row under the 退社 line; an explained gap no longer warns.
 *
 * The words are the shared ones (`~/shared/career-gap`): Japanese first, for
 * the reader of the 履歴書, then English, for the reader of the interface.
 */
import { useId, useState, type FormEvent } from "react";
import { failureText, useCareerTimeline, useGapNoteActions } from "../api";
import { Button } from "./ui";
import {
  GAP_NOTE_MAX,
  gapLabelEn,
  gapNoteRow,
  gapWarningEn,
  gapWarningJa,
  type CareerGap,
} from "~/shared/career-gap";
import type { TimelineGapNote } from "~/shared/career-timeline";

const CONTROL =
  "min-h-control bg-surface-raised border border-border-control rounded-control px-10 py-8 text-ui text-text-strong outline-none focus:shadow-ring";

/** `YYYY-MM` → the `YYYY-MM-01` every month column is sent as. */
const monthDate = (month: string) => `${month}-01`;

/**
 * The gaps nobody has explained, for a page about the 履歴書. Nothing at all
 * when there are none, or until the record is read: a page that says "no gaps"
 * for a moment over a record with one is worse than a blank.
 */
export function GapNotices({ compact = false }: { compact?: boolean }) {
  const timeline = useCareerTimeline();
  const gaps = timeline.data?.gaps ?? [];
  if (gaps.length === 0) return null;
  return (
    <ul aria-label="Gaps in 学歴・職歴" className="grid gap-6">
      {gaps.map((gap) => (
        <li
          key={gap.from}
          className={compact ? "" : "border border-dashed border-border-dashed rounded-control px-10 py-8"}
        >
          <GapNotice gap={gap} />
        </li>
      ))}
    </ul>
  );
}

/** One unexplained gap: what it is, in both languages, and the way to answer it. */
export function GapNotice({ gap }: { gap: CareerGap }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-4 text-smaller">
      <p lang="ja" className="text-text-secondary">
        {gapWarningJa(gap)}
      </p>
      <p className="text-text-dim">{gapWarningEn(gap)}</p>
      {open ? (
        <GapNoteForm gap={gap} note={null} onDone={() => setOpen(false)} />
      ) : (
        <span>
          <Button variant="bare" className="-ml-6" onClick={() => setOpen(true)}>
            Add an explanation
          </Button>
        </span>
      )}
    </div>
  );
}

/** An explained gap: its ※ row as the 履歴書 prints it, and the way to change or take it back. */
export function ExplainedGap({ gap, note }: { gap: CareerGap; note: TimelineGapNote }) {
  const [editing, setEditing] = useState(false);
  const { remove } = useGapNoteActions();
  if (editing) {
    return (
      <div className="grid gap-4 text-smaller">
        <p className="text-text-dim">{`${gapLabelEn(gap)}. Change what the 履歴書 says about it.`}</p>
        <GapNoteForm gap={gap} note={note} onDone={() => setEditing(false)} />
      </div>
    );
  }
  return (
    <div className="grid gap-4 text-smaller">
      <p lang="ja" className="text-text-secondary">
        {gapNoteRow(note)}
      </p>
      <p className="text-text-dim">
        {`${gapLabelEn(gap)}, explained. The 履歴書 prints this under the row the gap follows, and does not warn about it.`}
      </p>
      <span className="flex flex-wrap items-center gap-x-4 -ml-6">
        <Button variant="bare" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          variant="bare"
          onClick={() => remove.mutate(note.id)}
          disabled={remove.isPending}
          disabledReason="Removing…"
          aria-label={`Remove the explanation of ${gapLabelEn(gap)}`}
        >
          Remove
        </Button>
        {remove.isError ? (
          <span role="alert" className="text-removed">
            {failureText(remove.error)}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * An explanation whose gap has moved or closed since it was written. Kept, so
 * the words are not lost to an edit of a date, and printed nowhere: its months
 * are no longer the gap's.
 */
export function StaleGapNote({ note }: { note: TimelineGapNote }) {
  const { remove } = useGapNoteActions();
  return (
    <div className="grid gap-4 text-smaller">
      <p lang="ja" className="text-text-secondary">
        {gapNoteRow(note)}
      </p>
      <p className="text-text-dim">
        These months are no longer a gap in your record, so the 履歴書 does not print this.
      </p>
      <span className="flex flex-wrap items-center gap-x-4 -ml-6">
        <Button
          variant="bare"
          onClick={() => remove.mutate(note.id)}
          disabled={remove.isPending}
          disabledReason="Removing…"
        >
          Remove
        </Button>
        {remove.isError ? (
          <span role="alert" className="text-removed">
            {failureText(remove.error)}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * The ※ row, written. One line of text, shown as the row it becomes while it
 * is typed: the months are the gap's and are not typed at all.
 */
function GapNoteForm({ gap, note, onDone }: { gap: CareerGap; note: TimelineGapNote | null; onDone: () => void }) {
  const { save } = useGapNoteActions();
  const [text, setText] = useState(note?.text ?? "");
  const id = useId();
  const fromOn = monthDate(gap.from);
  const toOn = monthDate(gap.to);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({ fromOn, toOn, text }, { onSuccess: onDone });
  };

  return (
    <form aria-label={`Explain ${gapLabelEn(gap)}`} onSubmit={submit} className="grid gap-6 pt-4">
      <label htmlFor={id} className="text-text-dim">
        What you were doing, as the 履歴書 should say it — for example 資格取得のため学習
      </label>
      <input
        id={id}
        lang="ja"
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={GAP_NOTE_MAX}
        autoFocus
        className={`${CONTROL} min-w-0`}
      />
      {text.trim() ? (
        <p className="text-text-dim">
          Printed under the row the gap follows:{" "}
          <span lang="ja" className="text-text-secondary">
            {gapNoteRow({ fromOn, toOn, text })}
          </span>
        </p>
      ) : null}
      {save.isError ? (
        <p role="alert" className="text-removed">
          {failureText(save.error)}
        </p>
      ) : null}
      <span className="flex flex-wrap items-center gap-8">
        <Button
          type="submit"
          variant="primary"
          disabled={save.isPending || !text.trim()}
          disabledReason={save.isPending ? "Saving…" : "Write what you were doing first."}
        >
          Save
        </Button>
        <Button type="button" variant="bare" onClick={onDone}>
          Cancel
        </Button>
      </span>
    </form>
  );
}
