/**
 * The Interviews panel of one application (`docs/10-screen-specifications.md`,
 * Screen 13; issue #72).
 *
 * One card an interview entry, newest day first, and a form that adds one. The
 * questions asked are separate items in the order given: typed one at a time,
 * or pasted as several lines and split. A card ends with the entry's
 * recordings (`./interview-recordings`, issue #74).
 *
 * A changed standing is said in Where it stands, with its Undo, so this panel
 * hands the change up rather than confirming it here.
 */
import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { failureText, useAddInterview, type Application } from "../api";
import { useFlashStore } from "../stores/flash";
import type { ApplicationStep, Standing } from "~/shared/application";
import {
  EMPTY_ENTRY,
  HOW_IT_WENT_MAX,
  INTERVIEW_ROUNDS,
  ROUND_LABEL,
  WHO_MAX,
  defaultRound,
  questionsIn,
  type Interview,
  type InterviewRound,
} from "~/shared/interview";
import { CONTROL } from "./application-chrome";
import { InterviewRecordings } from "./interview-recordings";
import { Button, Mono, Panel } from "./ui";

export function InterviewsPanel({
  application,
  onStandingChanged,
}: {
  application: Application;
  onStandingChanged: (before: Standing, step: ApplicationStep, moved: boolean) => void;
}) {
  const [adding, setAdding] = useState(false);
  const flash = useFlashStore((state) => state.show);
  const entries = application.interviews;

  const saved = (next: Application, round: InterviewRound) => {
    setAdding(false);
    if (round === "other") return flash("Interview saved.");
    const moved = next.step !== application.step;
    const dated = next.dates[round] !== application.dates[round];
    if (!moved && !dated) return flash("Interview saved.");
    onStandingChanged(
      { step: application.step, closedAs: application.closedAs, dates: application.dates },
      moved ? next.step : round,
      moved,
    );
  };

  return (
    <Panel
      heading="Interviews"
      action={
        adding ? null : (
          <Button variant="ghost" onClick={() => setAdding(true)}>
            Add an interview
          </Button>
        )
      }
    >
      {adding ? <NewInterview application={application} onSaved={saved} onCancel={() => setAdding(false)} /> : null}
      {entries.length === 0 ? (
        adding ? null : (
          <p className="text-small text-text-muted">
            None yet. After each one, note the date, who you spoke with, how it went and the questions they asked.
          </p>
        )
      ) : (
        <ul className={`grid gap-8 ${adding ? "mt-10" : ""}`}>
          {entries.map((entry) => (
            <InterviewCard key={entry.id} applicationId={application.id} entry={entry} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function InterviewCard({ applicationId, entry }: { applicationId: string; entry: Interview }) {
  return (
    <li className="min-w-0 bg-card border border-border rounded-tile px-14 py-12 grid gap-10">
      <div className="flex flex-wrap items-baseline gap-x-12 gap-y-6">
        <h3 className="text-row font-medium text-text-strong">{ROUND_LABEL[entry.round]}</h3>
        <Mono className="text-text-muted">{entry.date}</Mono>
        {entry.who ? <span className="text-small text-text-muted">with {entry.who}</span> : null}
      </div>
      {entry.howItWent ? (
        <p className="text-claim text-text-body whitespace-pre-wrap break-words">{entry.howItWent}</p>
      ) : null}
      {entry.questions.length > 0 ? (
        <div>
          <div className="mb-4 text-small text-text-muted">Questions asked</div>
          <ol className="grid gap-4 pl-20 list-decimal text-claim text-text-body">
            {entry.questions.map((question) => (
              <li key={question.id} className="break-words">
                {question.text}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <InterviewRecordings applicationId={applicationId} entry={entry} />
    </li>
  );
}

function NewInterview({
  application,
  onSaved,
  onCancel,
}: {
  application: Application;
  onSaved: (next: Application, round: InterviewRound) => void;
  onCancel: () => void;
}) {
  const add = useAddInterview(application.id);
  const [date, setDate] = useState(application.today);
  const [round, setRound] = useState<InterviewRound>(() =>
    defaultRound(
      application.step,
      application.interviews.map((entry) => entry.round),
    ),
  );
  const [who, setWho] = useState("");
  const [howItWent, setHowItWent] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  const addQuestions = (text: string) => {
    setQuestions((list) => [...list, ...questionsIn(text)]);
    setFailure(null);
    field.current?.focus();
  };
  const addDraft = () => {
    addQuestions(draft);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Not while an input method is composing: that Enter confirms a conversion, not the question.
    // Safari sends it after composition ends, `isComposing` false, with keyCode 229.
    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    event.preventDefault();
    addDraft();
  };

  /**
   * A single-line field drops the line breaks of a pasted list, so several
   * lines are split here instead.
   */
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text");
    if (!/[\r\n]/.test(text)) return;
    event.preventDefault();
    addQuestions(`${draft}\n${text}`);
    setDraft("");
  };

  const save = async () => {
    // What is still in the field is a question too.
    const all = [...questions, ...questionsIn(draft)];
    if (!date) return setFailure("Give the interview a date.");
    if (howItWent.trim() === "" && all.length === 0) return setFailure(EMPTY_ENTRY);
    setFailure(null);
    try {
      onSaved(await add.mutateAsync({ date, round, who, howItWent, questions: all }), round);
    } catch (error) {
      setFailure(failureText(error));
    }
  };

  return (
    <div className="min-w-0 bg-card border border-border rounded-tile px-14 py-12 grid gap-12">
      <h3 className="text-row font-medium text-text-strong">New interview</h3>
      <div className="grid grid-cols-2 gap-12">
        <label className="grid gap-4 min-w-0">
          <span className="text-small text-text-secondary">Date</span>
          <input
            type="date"
            name="date"
            value={date}
            max={application.today}
            onChange={(event) => setDate(event.target.value)}
            className={CONTROL}
          />
        </label>
        <label className="grid gap-4 min-w-0">
          <span className="text-small text-text-secondary">Round</span>
          <select name="round" value={round} onChange={(event) => setRound(event.target.value as InterviewRound)} className={CONTROL}>
            {INTERVIEW_ROUNDS.map((value) => (
              <option key={value} value={value}>
                {ROUND_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-4 min-w-0">
        <span className="text-small text-text-secondary">Who you spoke with</span>
        <input
          name="who"
          value={who}
          maxLength={WHO_MAX}
          placeholder="Names or roles. Kept only here."
          onChange={(event) => setWho(event.target.value)}
          className={CONTROL}
        />
      </label>
      <label className="grid gap-4 min-w-0">
        <span className="text-small text-text-secondary">How it went</span>
        <textarea
          name="howItWent"
          rows={4}
          value={howItWent}
          maxLength={HOW_IT_WENT_MAX}
          placeholder="What it was like, what landed, what you would answer differently."
          onChange={(event) => setHowItWent(event.target.value)}
          className={`${CONTROL} resize-y`}
        />
      </label>
      <div className="grid gap-4 min-w-0">
        <span className="text-small text-text-secondary">Questions asked</span>
        {questions.length > 0 ? (
          <ol className="grid gap-4 pl-20 list-decimal text-claim text-text-body">
            {questions.map((question, index) => (
              // Keyed by place: until it is saved, a question has no identity but its position in the list.
              <li key={index} className="break-words">
                {question}{" "}
                <Button
                  variant="bare"
                  aria-label={`Remove question ${index + 1}`}
                  onClick={() => setQuestions((list) => list.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ol>
        ) : null}
        <div className="flex items-center gap-6">
          <input
            ref={field}
            name="question"
            aria-label="A question they asked"
            placeholder="One question, then Enter"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            className={CONTROL}
          />
          <Button variant="ghost" onClick={addDraft}>
            Add
          </Button>
        </div>
        <span className="text-small text-text-muted">Pasting several lines adds them all at once.</span>
      </div>
      <p className="text-small text-text-muted">
        A recording is attached after you save, from the interview's own card.
      </p>
      <div className="flex flex-wrap items-center gap-8">
        <Button variant="primary" onClick={() => void save()} disabled={add.isPending} disabledReason="Saving…">
          {add.isPending ? "Saving…" : "Save interview"}
        </Button>
        <Button variant="bare" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {failure ? (
        <p role="alert" className="text-smaller text-removed">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
