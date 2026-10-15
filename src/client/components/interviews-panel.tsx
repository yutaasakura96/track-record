/**
 * The Interviews panel of one application (`docs/10-screen-specifications.md`,
 * Screen 13; issue #72).
 *
 * One card an interview entry, newest day first, and a form that adds one. The
 * questions asked are separate items in the order given: typed one at a time,
 * or pasted as several lines and split. A card ends with the entry's
 * recordings (`./interview-recordings`, issues #74 and #76).
 *
 * A saved entry is corrected in the same form, opened in place of its card,
 * and deleted after one question asked in the card (issue #81). In the form a
 * saved question is a field, so its words can be put right where it stands.
 *
 * A changed standing is said in Where it stands, with its Undo, so this panel
 * hands the change up rather than confirming it here.
 */
import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import {
  failureText,
  useAddInterview,
  useCorrectInterview,
  useDeleteInterview,
  type Application,
  type InterviewCorrection,
} from "../api";
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
import { QUIET } from "./document-row";
import { InterviewRecordings, ROW } from "./interview-recordings";
import { Button, Mono, Panel } from "./ui";

/** What saving an entry did to where the application stands: moved it, dated a step passed over, or put a date right. */
export type StandingChange = "moved" | "added" | "corrected";

export function InterviewsPanel({
  application,
  onStandingChanged,
}: {
  application: Application;
  onStandingChanged: (before: Standing, step: ApplicationStep, change: StandingChange, frozen: Application["frozen"]) => void;
}) {
  const [adding, setAdding] = useState(false);
  /** The entry open for correction, by id. */
  const [editing, setEditing] = useState<string | null>(null);
  const correct = useCorrectInterview(application.id);
  const flash = useFlashStore((state) => state.show);
  const entries = application.interviews;

  const saved = (next: Application, round: InterviewRound) => {
    if (round === "other") return flash("Interview saved.");
    const moved = next.step !== application.step;
    const was = application.dates[round];
    if (!moved && next.dates[round] === was) return flash("Interview saved.");
    onStandingChanged(
      { step: application.step, closedAs: application.closedAs, dates: application.dates },
      moved ? next.step : round,
      moved ? "moved" : was ? "corrected" : "added",
      next.frozen,
    );
  };
  const added = (next: Application, round: InterviewRound) => {
    setAdding(false);
    saved(next, round);
  };
  const corrected = (next: Application, round: InterviewRound) => {
    setEditing(null);
    saved(next, round);
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
      {adding ? <NewInterview application={application} onSaved={added} onCancel={() => setAdding(false)} /> : null}
      {entries.length === 0 ? (
        adding ? null : (
          <p className="text-small text-text-muted">
            None yet. After each one, note the date, who you spoke with, how it went and the questions they asked.
          </p>
        )
      ) : (
        <ul className={`grid gap-8 ${adding ? "mt-10" : ""}`}>
          {entries.map((entry) =>
            editing === entry.id ? (
              <li key={entry.id} className="min-w-0">
                <InterviewForm
                  application={application}
                  entry={entry}
                  pending={correct.isPending}
                  onSave={(fields) => correct.mutateAsync({ ...fields, interviewId: entry.id })}
                  onSaved={corrected}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <InterviewCard
                key={entry.id}
                applicationId={application.id}
                entry={entry}
                saving={correct.isPending}
                onEdit={() => setEditing(entry.id)}
              />
            ),
          )}
        </ul>
      )}
    </Panel>
  );
}

function InterviewCard({
  applicationId,
  entry,
  saving,
  onEdit,
}: {
  applicationId: string;
  entry: Interview;
  /** Another entry's correction is pending. */
  saving: boolean;
  onEdit: () => void;
}) {
  const remove = useDeleteInterview(applicationId, entry.id);
  const flash = useFlashStore((state) => state.show);
  const [deleting, setDeleting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const name = `the ${ROUND_LABEL[entry.round]} entry of ${entry.date}`;
  const linked = entry.recordings.some((recording) => recording.kind === "link");
  const uploaded = entry.recordings.some((recording) => recording.kind === "upload");

  const deleteIt = async () => {
    setFailure(null);
    try {
      await remove.mutateAsync();
      flash("Interview deleted.");
    } catch (error) {
      setFailure(failureText(error));
    }
  };

  return (
    <li className="min-w-0 bg-card border border-border rounded-tile px-14 py-12 grid gap-10">
      <div className="flex flex-wrap items-baseline gap-x-12 gap-y-6">
        <h3 className="text-row font-medium text-text-strong">{ROUND_LABEL[entry.round]}</h3>
        <Mono className="text-text-muted">{entry.date}</Mono>
        {entry.who ? <span className="text-small text-text-muted">with {entry.who}</span> : null}
        {deleting ? null : (
          <span className="ml-auto flex items-baseline gap-12">
            <button
              type="button"
              aria-label={`Edit ${name}`}
              onClick={onEdit}
              disabled={saving}
              title={saving ? "Saving…" : undefined}
              className={`${QUIET} disabled:text-text-faint disabled:hover:text-text-faint`}
            >
              Edit
            </button>
            <button type="button" aria-label={`Delete ${name}`} onClick={() => setDeleting(true)} className={QUIET}>
              Delete
            </button>
          </span>
        )}
      </div>
      {deleting ? (
        <div role="alertdialog" aria-label="Delete this interview" className={ROW}>
          <span className="basis-full text-small text-text-secondary break-words">
            Delete this entry? Its notes and questions are taken off this application, and there is no undo.
            {uploaded
              ? " Its recordings are removed with it, and their files are deleted from storage."
              : linked
                ? " Its recording links are removed with it."
                : ""}{" "}
            The status and its dates stay as they are.
          </span>
          <Button variant="secondary" onClick={() => void deleteIt()} disabled={remove.isPending} disabledReason="Deleting…">
            Delete it
          </Button>
          <Button
            variant="bare"
            autoFocus
            disabled={remove.isPending}
            disabledReason="Deleting…"
            onClick={() => {
              setDeleting(false);
              setFailure(null);
            }}
          >
            Keep it
          </Button>
          {failure ? (
            <p role="alert" className="basis-full text-smaller text-removed">
              {failure}
            </p>
          ) : null}
        </div>
      ) : null}
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
  return (
    <InterviewForm
      application={application}
      pending={add.isPending}
      onSave={({ questions, ...fields }) => add.mutateAsync({ ...fields, questions: questions.map((question) => question.text) })}
      onSaved={onSaved}
      onCancel={onCancel}
    />
  );
}

/** The one form an entry is written in. With `entry` it corrects that one; without, it adds one. */
function InterviewForm({
  application,
  entry,
  pending,
  onSave,
  onSaved,
  onCancel,
}: {
  application: Application;
  entry?: Interview;
  pending: boolean;
  onSave: (fields: InterviewCorrection) => Promise<Application>;
  onSaved: (next: Application, round: InterviewRound) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(entry?.date ?? application.today);
  const [round, setRound] = useState<InterviewRound>(
    () =>
      entry?.round ??
      defaultRound(
        application.step,
        application.interviews.map((noted) => noted.round),
      ),
  );
  const [who, setWho] = useState(entry?.who ?? "");
  const [howItWent, setHowItWent] = useState(entry?.howItWent ?? "");
  /** A saved question keeps its id, so that correcting the entry leaves it the question it was. */
  const [questions, setQuestions] = useState<InterviewCorrection["questions"]>(entry?.questions ?? []);
  const [draft, setDraft] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);

  const addQuestions = (text: string) => {
    setQuestions((list) => [...list, ...questionsIn(text).map((question) => ({ text: question }))]);
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
    // What is still in the field is a question too, and one emptied in its field is none.
    const all = [...questions, ...questionsIn(draft).map((text) => ({ text }))].filter((question) => question.text.trim() !== "");
    if (!date) return setFailure("Give the interview a date.");
    if (howItWent.trim() === "" && all.length === 0) return setFailure(EMPTY_ENTRY);
    setFailure(null);
    try {
      onSaved(await onSave({ date, round, who, howItWent, questions: all }), round);
    } catch (error) {
      setFailure(failureText(error));
    }
  };

  return (
    <div className="min-w-0 bg-card border border-border rounded-tile px-14 py-12 grid gap-12">
      <h3 className="text-row font-medium text-text-strong">{entry ? "Edit interview" : "New interview"}</h3>
      <div className="grid grid-cols-2 max-phone:grid-cols-1 gap-12">
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
            {questions.map((question, index) => {
              const removeIt = (
                <Button
                  variant="bare"
                  aria-label={`Remove question ${index + 1}`}
                  onClick={() => setQuestions((list) => list.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              );
              // Keyed by place unless it is saved: until then a question has no identity but its position in the list.
              return entry ? (
                <li key={question.id ?? index}>
                  <div className="flex min-w-0 items-center gap-6">
                    <input
                      name={`question${index + 1}`}
                      aria-label={`Question ${index + 1}`}
                      value={question.text}
                      onChange={(event) =>
                        setQuestions((list) => list.map((item, i) => (i === index ? { ...item, text: event.target.value } : item)))
                      }
                      className={CONTROL}
                    />
                    {removeIt}
                  </div>
                </li>
              ) : (
                <li key={index} className="break-words">
                  {question.text} {removeIt}
                </li>
              );
            })}
          </ol>
        ) : null}
        <div className="flex min-w-0 items-center gap-6">
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
      {entry ? null : (
        <p className="text-small text-text-muted">
          A recording is attached after you save, from the interview's own card.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-8">
        <Button variant="primary" onClick={() => void save()} disabled={pending} disabledReason="Saving…">
          {pending ? "Saving…" : entry ? "Save changes" : "Save interview"}
        </Button>
        <Button variant="bare" onClick={onCancel} disabled={pending} disabledReason="Saving…">
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
