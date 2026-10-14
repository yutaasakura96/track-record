/**
 * Applications, one application (`docs/10-screen-specifications.md`, issue #70).
 *
 * Where it stands: the seven steps with a date under each one reached, three
 * figures counted from those dates, and the controls that move it. Setting a
 * step saves today's date; every date is a control that corrects it, and a
 * step passed over has no date until one is added. The figures follow the
 * dates, so a correction is all it takes to put one right.
 *
 * Every change is one write, and the screen draws what the server answers
 * with. Undo sends back the standing from before the last change.
 *
 * Under it, the interview entries (issue #72). Saving one for a later round is
 * a change to where it stands too, and so is correcting the day of one (issue
 * #81); both are said and undone here like the rest.
 *
 * Moving out of Not applied also freezes the documents on the application as
 * sent (issue #71). The panel that chooses them is `../components/application-resume`.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "@tanstack/react-router";
import {
  ApiError,
  failureText,
  useApplication,
  useApplicationActions,
  type Application,
  type ApplicationFields,
} from "../api";
import { ResumePanel } from "../components/application-resume";
import {
  ApplicationsFrame,
  CONTROL_INLINE,
  JobFields,
  QuietChip,
  StatusLine,
  days,
} from "../components/application-chrome";
import { QUIET } from "../components/document-row";
import { InterviewsPanel, type StandingChange } from "../components/interviews-panel";
import { ReadFailure, RefreshFailure } from "../components/read-failure";
import { NextStep } from "../components/screen-intro";
import { Button, Panel } from "../components/ui";
import { useFlashStore } from "../stores/flash";
import {
  APPLICATION_STEPS,
  QUIET_DAYS,
  STATUS_LABEL,
  isStep,
  isWaiting,
  setDate,
  stepIndex,
  type ApplicationStatus,
  type ApplicationStep,
  type Standing,
} from "~/shared/application";
import { nameVersions } from "~/shared/application-documents";

export function ApplicationScreen() {
  const { applicationId } = useParams({ from: "/applications/$applicationId" });
  const application = useApplication(applicationId);
  const data = application.data;

  if (!data) {
    const missing = application.error instanceof ApiError && application.error.status === 404;
    return (
      <ApplicationsFrame title={missing ? "Not found" : "Application"} crumb>
        {application.isError && !missing ? (
          <ReadFailure query={application} />
        ) : (
          <p className="text-ui text-text-dim">
            {missing ? "That application was not found." : "Opening the application…"}
          </p>
        )}
      </ApplicationsFrame>
    );
  }

  return (
    <ApplicationsFrame title={data.company} crumb>
      {application.isError ? <RefreshFailure query={application} /> : null}
      {/* Keyed, so what is open on one application is not open on the next. */}
      <Body key={data.id} application={data} />
    </ApplicationsFrame>
  );
}

/** `standing` with the date corrected, or unchanged where that step was not reached in it. */
function withDate(standing: Standing, status: ApplicationStatus, date: string): Standing {
  try {
    return setDate(standing, status, date);
  } catch {
    return standing;
  }
}

/** The last change to where it stands, for the line that confirms it and for Undo. */
interface Moved {
  before: Standing;
  /** `Moved to Applied.` The date is read from the application, so a correction shows in it. */
  text: string;
  /** The status whose date the change saved. Null when it saved none. */
  dated: ApplicationStatus | null;
  /** Made from another panel, so the line that says it may be off the screen. */
  elsewhere?: boolean;
  /** ` 履歴書 v4 was frozen as sent.` when the move froze documents, said after the date. */
  frozen: string;
}

/** What a change froze, as the sentence that follows its confirmation. Empty when it froze nothing. */
const frozenText = (frozen: Application["frozen"] = []) =>
  frozen.length > 0 ? ` ${nameVersions(frozen)} ${frozen.length === 1 ? "was" : "were"} frozen as sent.` : "";

function Body({ application }: { application: Application }) {
  const { edit, stand } = useApplicationActions(application.id);
  const flash = useFlashStore((state) => state.show);
  const [moved, setMoved] = useState<Moved | null>(null);
  /** Which date is open for correction. */
  const [dating, setDating] = useState<ApplicationStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const notice = useRef<HTMLDivElement>(null);
  // A move made by saving an interview is said up here, where its Undo is, and the author is looking further down.
  useEffect(() => {
    if (moved?.elsewhere) notice.current?.scrollIntoView?.({ block: "nearest" });
  }, [moved]);

  const standing: Standing = { step: application.step, closedAs: application.closedAs, dates: application.dates };
  const busy = stand.isPending;

  /** One change to where it stands. Null when it was refused, which is said under the controls. */
  const change = async (action: Parameters<typeof stand.mutateAsync>[0]) => {
    setFailure(null);
    try {
      return await stand.mutateAsync(action);
    } catch (error) {
      setFailure(failureText(error));
      return null;
    }
  };

  const set = async (status: ApplicationStatus) => {
    const next = await change({ change: "set", status });
    if (!next) return;
    setDating(null);
    setMoved({
      before: standing,
      text: isStep(status) ? `Moved to ${STATUS_LABEL[status]}.` : `Marked as ${STATUS_LABEL[status].toLowerCase()}.`,
      dated: status === "not_applied" ? null : status,
      frozen: frozenText(next.frozen),
    });
  };

  const saveDate = async (status: ApplicationStatus, date: string) => {
    if (date === application.dates[status]) return setDating(null);
    if (!(await change({ change: "date", status, date }))) return;
    setDating(null);
    // Undo takes back the last move, not a date corrected since: the correction goes into what Undo restores.
    if (moved && status !== moved.dated) setMoved({ ...moved, elsewhere: false, before: withDate(moved.before, status, date) });
    flash("Date corrected. The day counts follow it.");
  };

  const undo = async () => {
    if (!moved) return;
    const next = await change({ change: "restore", standing: moved.before });
    if (!next) return;
    setMoved(null);
    setDating(null);
    flash(`Undone.${frozenText(next.frozen)}`);
  };

  const standingChangedByInterview = (
    before: Standing,
    step: ApplicationStep,
    change: StandingChange,
    frozen: Application["frozen"],
  ) => {
    setFailure(null);
    setDating(null);
    setMoved({
      before,
      text:
        change === "moved"
          ? `Interview saved, and the status moved to ${STATUS_LABEL[step]} to match.`
          : change === "added"
            ? `Interview saved, and the ${STATUS_LABEL[step]} date was added.`
            : `Interview saved, and the ${STATUS_LABEL[step]} date was changed to match.`,
      dated: step,
      elsewhere: true,
      frozen: frozenText(frozen),
    });
  };

  const reopen = async () => {
    if (!(await change({ change: "reopen" }))) return;
    setMoved(null);
    flash(`Reopened at ${STATUS_LABEL[application.step]}.`);
  };

  const dateControl = (status: ApplicationStatus, lead = "") => {
    const date = application.dates[status];
    if (dating === status) {
      return (
        <DateEditor
          value={date ?? application.today}
          max={application.today}
          busy={busy}
          onSave={(next) => void saveDate(status, next)}
          onCancel={() => setDating(null)}
        />
      );
    }
    if (!date) {
      return (
        <>
          <span className="text-text-muted">skipped</span>{" "}
          <Button variant="bare" onClick={() => setDating(status)}>
            add a date
          </Button>
        </>
      );
    }
    return (
      <>
        {lead}
        <button
          type="button"
          title="Correct this date"
          aria-label={`${STATUS_LABEL[status]}, ${date}. Correct this date`}
          onClick={() => setDating(status)}
          className="font-mono text-smaller text-text-muted border-b border-dotted border-border-active hover:text-accent-link motion-tone"
        >
          {date}
        </button>
      </>
    );
  };

  const current = stepIndex(application.step);
  const next = APPLICATION_STEPS[current + 1];
  /** What a move out of Not applied would freeze: on the application, with a version, never sent. */
  const unsent =
    application.step === "not_applied"
      ? application.documents.filter(
          (document) =>
            document.currentVersionNo !== null && !application.sentCopies.some((copy) => copy.ref === document.ref),
        ).map((document) => ({ title: document.title, versionNo: document.currentVersionNo }))
      : [];

  return (
    <>
      <div className="grid gap-4">
        <h2 className="text-page font-semibold tracking-tight text-text-bright">{application.company}</h2>
        <p className="text-ui text-text-secondary">{application.position || "Position not filled in"}</p>
        <div className="mt-4 flex flex-wrap items-center gap-8">
          <StatusLine standing={application} />
          {application.quietDays !== null ? <QuietChip quietDays={application.quietDays} /> : null}
          {application.postingUrl ? (
            <a href={application.postingUrl} target="_blank" rel="noopener noreferrer" className={QUIET}>
              Open the posting
            </a>
          ) : null}
        </div>
      </div>

      <NextStep>{nextLine(application)}</NextStep>

      <Panel heading="Where it stands">
        <div className="grid gap-14">
          <ol className="grid grid-cols-7 max-phone:grid-cols-1">
            {APPLICATION_STEPS.map((step, index) => (
              <StepColumn
                key={step}
                step={step}
                state={index === current && !application.closedAs ? "now" : index <= current ? "done" : "ahead"}
                last={index === APPLICATION_STEPS.length - 1}
              >
                {index <= current ? dateControl(step, step === "not_applied" ? "added " : "") : null}
              </StepColumn>
            ))}
          </ol>

          {moved ? (
            <div
              ref={notice}
              role="status"
              className="flex flex-wrap items-center gap-x-12 gap-y-8 border border-border-control bg-surface-raised rounded-control px-10 py-8 text-small text-text-secondary"
            >
              <span>
                {moved.text}
                {moved.dated && application.dates[moved.dated]
                  ? ` Date saved as ${application.dates[moved.dated]}.`
                  : ""}
                {moved.frozen}
              </span>
              <span className="ml-auto flex gap-8">
                {moved.dated ? (
                  <Button variant="bare" onClick={() => setDating(moved.dated)}>
                    Change the date
                  </Button>
                ) : null}
                <Button variant="bare" onClick={() => void undo()} disabled={busy} disabledReason="Saving…">
                  Undo
                </Button>
              </span>
            </div>
          ) : null}

          <div className="grid grid-cols-3 max-phone:grid-cols-1 gap-8">
            <Figure
              value={application.daysSinceResumePassed}
              label="since the résumé passed"
              missing="since the résumé passed: not reached, or no date"
            />
            <Figure
              value={application.daysSinceFirstInterview}
              label="since the first interview"
              missing="since the first interview: not reached, or no date"
            />
            <Figure
              value={application.daysSinceClosed ?? application.daysSinceLastActivity}
              label={
                application.closedAs
                  ? "since it was closed"
                  : `since the last change${isWaiting(application.step) ? `. Gone quiet at ${QUIET_DAYS}` : ""}`
              }
            />
          </div>

          {application.closedAs ? (
            <div className="flex flex-wrap items-center gap-x-12 gap-y-8 border border-border-control bg-surface-raised rounded-control px-10 py-8 text-small text-text-secondary">
              <span>
                {STATUS_LABEL[application.closedAs]} on {dateControl(application.closedAs)}, after{" "}
                {STATUS_LABEL[application.step]}.
              </span>
              <span className="ml-auto">
                <Button variant="ghost" onClick={() => void reopen()} disabled={busy} disabledReason="Saving…">
                  Reopen
                </Button>
              </span>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-8">
                {next ? (
                  <Button variant="primary" onClick={() => void set(next)} disabled={busy} disabledReason="Saving…">
                    Move to {STATUS_LABEL[next]}
                  </Button>
                ) : null}
                <label className="inline-flex items-center gap-6 text-small text-text-muted">
                  or set
                  <select
                    aria-label="Set another step"
                    value=""
                    disabled={busy}
                    onChange={(event) => {
                      if (isStep(event.target.value)) void set(event.target.value);
                    }}
                    className={CONTROL_INLINE}
                  >
                    <option value="">another step…</option>
                    {APPLICATION_STEPS.filter((_, index) => index !== current && index !== current + 1).map((step) => (
                      <option key={step} value={step}>
                        {STATUS_LABEL[step]}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="ml-auto flex gap-8">
                  <Button variant="ghost" onClick={() => void set("rejected")} disabled={busy} disabledReason="Saving…">
                    Mark as rejected
                  </Button>
                  <Button variant="ghost" onClick={() => void set("withdrawn")} disabled={busy} disabledReason="Saving…">
                    Withdraw
                  </Button>
                </span>
              </div>
              <p className="text-smaller text-text-muted">
                A step saves today's date when you set it, and you can correct the date afterwards. A step you
                never went through can be skipped.
                {unsent.length > 0 ? ` It also freezes ${nameVersions(unsent)} as sent.` : ""}
              </p>
            </>
          )}

          {failure ? (
            <p role="alert" className="text-smaller text-removed">
              {failure}
            </p>
          ) : null}
        </div>
      </Panel>

      <ResumePanel application={application} onChanged={() => setMoved(null)} />

      <InterviewsPanel application={application} onStandingChanged={standingChangedByInterview} />

      <Panel
        heading="The job"
        action={
          editing ? null : (
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )
        }
      >
        {editing ? (
          <EditJob
            application={application}
            saving={edit.isPending}
            onSave={(fields) => edit.mutateAsync(fields).then(() => setEditing(false))}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <dl className="grid gap-6 text-ui">
            <Pair term="Company">{application.company}</Pair>
            <Pair term="Position">
              {application.position || <span className="text-text-muted">Not filled in</span>}
            </Pair>
            {application.postingUrl ? <Pair term="Posting">{application.postingUrl}</Pair> : null}
            <Pair term="Key requirements">
              {application.requirements.length > 0 ? (
                <ul className="grid gap-4 pl-20 list-disc text-text-body">
                  {application.requirements.map((requirement, index) => (
                    <li key={index}>{requirement}</li>
                  ))}
                </ul>
              ) : (
                <span className="text-text-muted">None noted</span>
              )}
            </Pair>
          </dl>
        )}
        <details className="mt-10">
          <summary className="cursor-pointer text-small text-accent-link">
            The full job description, as you pasted it
          </summary>
          <div className="mt-10 pt-10 border-t border-border-inner text-doc-compact text-text-body whitespace-pre-wrap">
            {application.jobDescription}
          </div>
        </details>
      </Panel>
    </>
  );
}

/** The one thing to do now, from where the application stands. */
function nextLine(application: Application): string {
  if (application.position === "") return "add the position, and check that the company is right, under The job below.";
  if (application.closedAs) return "this application is closed. Reopen it if that changes.";
  if (application.quietDays !== null) {
    return `nothing has changed for ${days(application.quietDays)}. Follow up, or close it as rejected or withdrawn.`;
  }
  if (application.step === "not_applied") {
    return application.documents.length === 0
      ? "choose the résumé for this job: make a tailored one, or use a document you already have."
      : "when you have sent it, move this to Applied. The résumé is frozen as sent at that moment.";
  }
  if (application.step === "offer") return "nothing is waiting here.";
  if (application.step.startsWith("interview")) {
    return "after the next interview, add how it went while you still remember it.";
  }
  return "wait to hear back. When you do, move it to the next step.";
}

function StepColumn({
  step,
  state,
  last,
  children,
}: {
  step: ApplicationStep;
  state: "done" | "now" | "ahead";
  last: boolean;
  children: ReactNode;
}) {
  const node =
    state === "done"
      ? "bg-accent border-accent"
      : state === "now"
        ? "bg-bg border-accent shadow-selected"
        : "bg-bg border-border-active";
  const name =
    state === "now" ? "text-text-bright font-semibold" : state === "done" ? "text-text-secondary" : "text-text-dim";
  // At phone width the steps are a vertical list: the node and its line down the left, the name and date beside them.
  return (
    <li
      aria-current={state === "now" ? "step" : undefined}
      className="min-w-0 pr-8 grid gap-4 content-start max-phone:flex max-phone:gap-10 max-phone:pr-0 max-phone:pb-12 max-phone:last:pb-0"
    >
      <div className="h-14 flex items-center max-phone:w-14 max-phone:h-auto max-phone:shrink-0 max-phone:flex-col max-phone:pt-2" aria-hidden>
        <span className={`size-10 shrink-0 rounded-full border-2 ${node}`} />
        {last ? null : (
          <span
            className={`flex-1 h-2 max-phone:w-2 max-phone:h-auto max-phone:min-h-12 ${state === "done" ? "bg-accent" : "bg-border-control"}`}
          />
        )}
      </div>
      <div className="min-w-0 grid gap-4">
        <div className={`text-small ${name}`}>{STATUS_LABEL[step]}</div>
        <div className="text-smaller text-text-muted">{children}</div>
      </div>
    </li>
  );
}

function DateEditor({
  value,
  max,
  busy,
  onSave,
  onCancel,
}: {
  value: string;
  max: string;
  busy: boolean;
  onSave: (date: string) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(value);
  return (
    <span className="inline-flex flex-wrap items-center gap-4">
      <input
        type="date"
        aria-label="Date"
        autoFocus
        value={date}
        max={max}
        onChange={(event) => setDate(event.target.value)}
        className={CONTROL_INLINE}
      />
      <Button
        variant="ghost"
        onClick={() => onSave(date)}
        disabled={busy || date === ""}
        disabledReason={busy ? "Saving…" : "Choose a date first."}
      >
        Save
      </Button>
      <Button variant="bare" onClick={onCancel}>
        Cancel
      </Button>
    </span>
  );
}

/** A count of days, or a dash where the step it counts from has no date. */
function Figure({ value, label, missing }: { value: number | null; label: string; missing?: string }) {
  return (
    <div className="min-w-0 bg-card border border-border rounded-tile px-14 py-12 grid gap-4">
      <div
        className={`text-stat font-medium tracking-tight tabular-nums ${value === null ? "text-text-ghost" : "text-text-bright"}`}
      >
        {value === null ? (
          "–"
        ) : (
          <>
            {value.toLocaleString("en-US")}{" "}
            <span className="text-ui font-normal text-text-muted">{value === 1 ? "day" : "days"}</span>
          </>
        )}
      </div>
      <div className="text-small text-text-muted">{value === null ? missing : label}</div>
    </div>
  );
}

function Pair({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex gap-12 max-phone:flex-col max-phone:gap-2">
      <dt className="w-label max-phone:w-auto shrink-0 pt-2 text-small text-text-muted">{term}</dt>
      <dd className="min-w-0 flex-1 text-text-strong wrap-anywhere max-phone:mb-6">{children}</dd>
    </div>
  );
}

function EditJob({
  application,
  saving,
  onSave,
  onCancel,
}: {
  application: Application;
  saving: boolean;
  onSave: (fields: ApplicationFields) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState<ApplicationFields>({
    company: application.company,
    position: application.position,
    postingUrl: application.postingUrl ?? "",
    requirements: application.requirements,
  });
  const [failure, setFailure] = useState<string | null>(null);
  const incomplete = fields.company.trim() === "" || fields.position.trim() === "";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    try {
      await onSave(fields);
    } catch (error) {
      setFailure(failureText(error));
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-12">
      <JobFields value={fields} onChange={setFields} />
      <div className="flex flex-wrap items-center justify-end gap-8">
        <Button type="button" variant="bare" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={saving || incomplete}
          disabledReason={saving ? "Saving…" : "Give it a company and a position first."}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      {failure ? (
        <p role="alert" className="text-smaller text-removed">
          {failure}
        </p>
      ) : null}
    </form>
  );
}
