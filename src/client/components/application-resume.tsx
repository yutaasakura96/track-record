/**
 * Résumé for this job (`docs/10` Screen 14, issue #71).
 *
 * Two halves that must not be read as one. Above the rule are the documents
 * the application is using: pointers to the same documents as on Home, which
 * move on when those do. Under it is what was sent: files, each taken once.
 * Nothing here says whether a document has changed since it was sent, because
 * nothing works that out.
 *
 * Before Applied the documents are chosen. From Applied onward they are only
 * recorded: `Record another sent copy` freezes whatever is ticked, always.
 *
 * A tailored 履歴書 is made here too (`docs/06`, 2026-10-26), with the author's
 * two optional notes: their reason for applying and their request. Before
 * Applied an application sends one 履歴書, so making the tailored one takes the
 * main one off, and the tick card holds the main one back while it is on.
 *
 * Making a tailored document, writing or reviewing a version and its history
 * open screens that ask for a wider window, so in a narrow one they are held
 * back and the panel says why (issue #75). Choosing, recording, taking off,
 * writing the notes, reading what was sent and downloading all work at any
 * width.
 */
import { useId, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  downloadSentCopy,
  failureText,
  useApplicationActions,
  useGenerate,
  useProfile,
  type Application,
  type ApplicationDocument,
  type ApplicationNotes,
  type DocumentChange,
  type DocumentChoice,
  type SentCopy,
} from "../api";
import { CONTROL } from "./application-chrome";
import { GapNotices } from "./gap-notices";
import { useFlashStore } from "../stores/flash";
import { DownloadButton } from "./download-button";
import { generateFailure } from "./generate-failure";
import { useWideEnough } from "./too-narrow";
import { QUIET, SECONDARY } from "./document-row";
import { Button, Chip, Panel } from "./ui";
import { isSendableKind, nameVersions, type TailoredKind } from "~/shared/application-documents";
import { APPLICATION_NOTE_MAX } from "~/shared/application";
import { PHOTO_NOTICE } from "~/shared/photo";

const CARD = "min-w-0 bg-card border border-border rounded-tile px-14 py-12 grid gap-8 content-start";
const ROW =
  "flex flex-wrap items-center gap-x-12 gap-y-8 max-phone:flex-col max-phone:items-stretch max-phone:gap-6 px-10 py-12 border-b border-border-inner last:border-b-0";
/** Why the controls that open a desktop screen are not here, in a window too narrow for one. */
export const HELD_BACK =
  "Making a tailored document, writing or reviewing a version and its history need a wider window, so they are not shown here.";

/** A row's links: beside its text, and under it, from the left, at phone width. */
const LINKS = "ml-auto max-phone:ml-0 flex flex-wrap items-center justify-end max-phone:justify-start gap-16 max-phone:gap-12";

export function ResumePanel({
  application,
  onChanged,
}: {
  application: Application;
  /** A change here is the last change now, so the Undo of an earlier one goes. */
  onChanged: () => void;
}) {
  const { documents: act, edit } = useApplicationActions(application.id);
  const profile = useProfile();
  const generate = useGenerate();
  const navigate = useNavigate();
  const flash = useFlashStore((state) => state.show);
  const [picking, setPicking] = useState(false);
  const [makingRirekisho, setMakingRirekisho] = useState(false);
  const [failure, setFailure] = useState<ReactNode>(null);

  const { documents, choices, sentCopies } = application;
  const applied = application.step !== "not_applied";
  const busy = act.isPending || generate.isPending || edit.isPending;
  const hasTailored = (kind: TailoredKind) => documents.some((document) => document.tailored && document.kind === kind);
  const wide = useWideEnough();

  const run = async (action: DocumentChange) => {
    setFailure(null);
    try {
      const next = await act.mutateAsync(action);
      onChanged();
      return next;
    } catch (error) {
      setFailure(generateFailure(error));
      return null;
    }
  };

  /** Asks for a version and opens its review. A refusal is said here, and the résumé stays. */
  const write = async (ref: string) => {
    setFailure(null);
    try {
      const made = await generate.mutateAsync(ref);
      await navigate({ to: "/proposals/$proposalId", params: { proposalId: made.proposalId } });
    } catch (error) {
      setFailure(generateFailure(error));
    }
  };

  const tailor = async (kind: TailoredKind, notes?: ApplicationNotes) => {
    if (notes && (notes.motivationNote !== application.motivationNote || notes.kibouNote !== application.kibouNote)) {
      setFailure(null);
      try {
        await edit.mutateAsync(notes);
      } catch (error) {
        setFailure(failureText(error));
        return;
      }
    }
    const next = (await run({ change: "tailor", kind })) as (Application & { replaced?: string[] }) | null;
    if (!next) return;
    setMakingRirekisho(false);
    if (next.replaced?.length) flash(`${next.replaced.join(" and ")} is off this application now: it has its own 履歴書.`);
    const made = next.documents.find((document) => document.tailored && document.kind === kind);
    if (made && made.currentVersionId === null && made.pendingProposalId === null) await write(made.ref);
  };

  const use = async (refs: string[]) => {
    const next = await run(
      applied ? { change: "record", refs } : { change: "choose", kinds: refs.filter(isSendableKind) },
    );
    if (!next) return;
    setPicking(false);
    if (applied && next.frozen?.length) flash(`${nameVersions(next.frozen)} frozen as sent today.`);
  };

  const card = (
    <TickCard
      // Keyed, so a card opened again starts from the application as it is now.
      key={`${applied}-${documents.map((document) => document.ref).join()}`}
      choices={applied ? [...choices.filter((choice) => !choice.tailored), ...choices.filter((choice) => choice.tailored)] : choices.filter((choice) => !choice.tailored)}
      recording={applied}
      busy={busy}
      onUse={(refs) => void use(refs)}
      onCancel={picking ? () => setPicking(false) : undefined}
    />
  );

  const makeTailored = (variant: "primary" | "ghost") => (
    <Button variant={variant} onClick={() => void tailor("english_resume")} disabled={busy} disabledReason="Working…">
      Make a tailored résumé
    </Button>
  );

  const rirekishoCard = (
    <div className={CARD}>
      <h3 className="text-row font-medium text-text-strong">Make a tailored 履歴書</h3>
      <p className="text-small text-text-muted">
        The same form as your main 履歴書, from the same record, with a 志望動機 written to this company. Your
        reason for applying and your request are drafted from the posting and your record unless you write your own
        below, and you confirm or edit each before it becomes a version.
        {applied ? null : " It replaces the main 履歴書 on this application."}
      </p>
      <NotesForm
        application={application}
        busy={busy}
        submitLabel={wide ? "Make a tailored 履歴書" : null}
        onSubmit={(notes) =>
          wide
            ? void tailor("rirekisho", notes)
            : void edit.mutateAsync(notes).then(
                () => flash("Your notes are saved. Make the 履歴書 from a wider window."),
                (error: unknown) => setFailure(failureText(error)),
              )
        }
        onCancel={documents.length > 0 ? () => setMakingRirekisho(false) : undefined}
      />
      {wide ? null : (
        <p className="text-small text-text-muted">
          Making it opens its review, which needs a wider window. Your notes are kept for then.
        </p>
      )}
    </div>
  );

  return (
    <Panel heading="Résumé for this job">
      {documents.length === 0 && !applied ? (
        <div className="grid grid-cols-2 max-phone:grid-cols-1 gap-12">
          <div className={CARD}>
            <h3 className="text-row font-medium text-text-strong">Make a tailored résumé</h3>
            <p className="text-small text-text-muted">
              Written for this job from the same facts as your main résumé. The job description decides what
              leads and what is left out; it never adds a claim that is not in your record. You read it as a
              set of changes before it becomes a version.
            </p>
            {wide ? <div>{makeTailored("primary")}</div> : <p className="text-small text-text-muted">{HELD_BACK}</p>}
          </div>
          {rirekishoCard}
          {card}
        </div>
      ) : (
        <>
          {documents.length > 0 ? (
            <ul>
              {documents.map((document) => (
                <DocumentLine
                  key={document.ref}
                  document={document}
                  canGenerate={application.canGenerate}
                  canOpen={wide}
                  canTakeOff={!applied}
                  busy={busy}
                  onWrite={() => void write(document.ref)}
                  onTakeOff={() => void run({ change: "take-off", ref: document.ref })}
                  notes={
                    document.tailored && document.kind === "rirekisho" ? (
                      <NotesToggle application={application} busy={busy} onSave={(notes) => edit.mutateAsync(notes)} />
                    ) : null
                  }
                  missingPhoto={profile.data?.hasPhoto === false}
                />
              ))}
            </ul>
          ) : (
            <p className="text-small text-text-muted">No résumé is recorded for this application.</p>
          )}
          <div className="mt-10 flex flex-wrap items-center gap-8">
            {hasTailored("english_resume") || !wide ? null : makeTailored("ghost")}
            {hasTailored("rirekisho") || makingRirekisho ? null : (
              <Button variant="ghost" onClick={() => setMakingRirekisho(true)} disabled={busy} disabledReason="Working…">
                {wide ? "Make a tailored 履歴書" : "Notes for a tailored 履歴書"}
              </Button>
            )}
            {picking ? null : (
              <Button variant="ghost" onClick={() => setPicking(true)}>
                {applied ? "Record another sent copy" : "Add a document you already have"}
              </Button>
            )}
          </div>
          {makingRirekisho ? <div className="mt-10">{rirekishoCard}</div> : null}
          {picking ? <div className="mt-10">{card}</div> : null}
          {wide ? null : <p className="mt-10 text-small text-text-muted">{HELD_BACK}</p>}
        </>
      )}

      {!application.canGenerate && documents.some((document) => document.tailored && !document.currentVersionId) ? (
        <p className="mt-10 text-small text-text-muted">
          Your record holds no fact a document may use yet, so there is nothing to write a tailored document
          from.
          {wide ? (
            <>
              {" "}
              <Link to="/documents" className={QUIET}>
                Import a document
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {failure ? (
        <p role="alert" className="mt-10 text-small text-removed">
          {failure}
        </p>
      ) : null}

      {sentCopies.length > 0 ? (
        <div className="mt-14 pt-12 border-t border-border-inner">
          <h3 className="text-panel font-semibold tracking-snug text-text-strong">What you sent</h3>
          <p className="mt-4 mb-6 text-small text-text-muted">
            A frozen copy is the file exactly as it was on the day. It does not change when the résumé or your
            record changes later.
          </p>
          <ul>
            {sentCopies.map((copy) => (
              <SentLine key={copy.id} applicationId={application.id} copy={copy} />
            ))}
          </ul>
        </div>
      ) : applied ? (
        <p className="mt-10 text-small text-text-muted">
          No sent copy is recorded. Use “Record another sent copy” to add one.
        </p>
      ) : null}
    </Panel>
  );
}

/** One document the application is using: the same one as on Home, with what can be done to it from here. */
function DocumentLine({
  document,
  canGenerate,
  canOpen,
  canTakeOff,
  busy,
  onWrite,
  onTakeOff,
  notes,
  missingPhoto,
}: {
  document: ApplicationDocument;
  canGenerate: boolean;
  /** The window is wide enough for the screens History, Generate and Review changes open. */
  canOpen: boolean;
  canTakeOff: boolean;
  busy: boolean;
  onWrite: () => void;
  onTakeOff: () => void;
  /** A tailored 履歴書's notes, under its line. */
  notes?: ReactNode;
  missingPhoto: boolean;
}) {
  const version = document.currentVersionNo === null ? "No version yet" : `Version ${document.currentVersionNo}`;
  return (
    <li className={ROW}>
      <div className="min-w-0 flex-1">
        <div className="text-row font-medium text-text-strong">{document.title}</div>
        <div className="text-small text-text-muted">
          {version} · {document.tailored ? "written for this job" : "the same document as on Home"}
        </div>
        {/* The gaps its 学歴・職歴 table has now, as View says them (issue #117, G1). */}
        {document.kind === "rirekisho" ? (
          <div className="mt-6">
            <GapNotices compact />
            {document.tailored && missingPhoto ? (
              <p lang="ja" className="text-smaller text-text-secondary">
                {PHOTO_NOTICE}{" "}
                <Link to="/profile" className={QUIET}>Add a photo</Link>
              </p>
            ) : null}
          </div>
        ) : null}
        {notes}
      </div>
      <div className={LINKS}>
        {document.currentVersionId ? (
          <>
            {/* Reading opens at any width (issue #106), so it is not held back. */}
            <Link to="/renders/$ref/view" params={{ ref: document.ref }} className={QUIET}>
              View
            </Link>
            {canOpen ? (
              <Link to="/renders/$ref/history" params={{ ref: document.ref }} className={QUIET}>
                History
              </Link>
            ) : null}
            <DownloadButton kind={document.kind} docRef={document.ref} label="Download" className={QUIET} />
          </>
        ) : null}
        {document.tailored && canOpen ? (
          <TailoredAction document={document} canGenerate={canGenerate} busy={busy} onWrite={onWrite} />
        ) : null}
        {canTakeOff ? (
          <Button
            variant="bare"
            aria-label={`Take off ${document.title}`}
            onClick={onTakeOff}
            disabled={busy}
            disabledReason="Working…"
          >
            Take off
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** A tailored document is written from here: its review when one is waiting, or a new version. */
function TailoredAction({
  document,
  canGenerate,
  busy,
  onWrite,
}: {
  document: ApplicationDocument;
  canGenerate: boolean;
  busy: boolean;
  onWrite: () => void;
}) {
  if (document.pendingProposalId) {
    return (
      <Link to="/proposals/$proposalId" params={{ proposalId: document.pendingProposalId }} className={SECONDARY}>
        {document.status === "proposal_generating" ? "Open it" : "Review changes"}
      </Link>
    );
  }
  // Not offered rather than disabled: the line under the rows says why.
  if (!canGenerate) return null;
  return (
    <Button
      variant={document.currentVersionId ? "ghost" : "secondary"}
      onClick={onWrite}
      disabled={busy}
      disabledReason="Working…"
    >
      {document.currentVersionId ? "Regenerate" : "Generate"}
    </Button>
  );
}

/**
 * The ticks. Before Applied they say which of the three the application uses,
 * and the ones on it start ticked. From Applied onward they say what was sent
 * just now, so none starts ticked: a tick there always freezes a copy.
 */
function TickCard({
  choices,
  recording,
  busy,
  onUse,
  onCancel,
}: {
  choices: DocumentChoice[];
  recording: boolean;
  busy: boolean;
  onUse: (refs: string[]) => void;
  onCancel?: () => void;
}) {
  const [ticked, setTicked] = useState<string[]>(() =>
    recording ? [] : choices.filter((choice) => choice.onApplication).map((choice) => choice.ref),
  );
  const toggle = (ref: string) =>
    setTicked((now) => (now.includes(ref) ? now.filter((item) => item !== ref) : [...now, ref]));
  const nothing = recording && ticked.length === 0;

  return (
    <div className={CARD}>
      <h3 className="text-row font-medium text-text-strong">
        {recording ? "Record another sent copy" : "Use a document you already have"}
      </h3>
      <p className="text-small text-text-muted">
        {recording
          ? "Tick what you sent. Each one is frozen as it is today, as a further copy, whether or not it was sent before."
          : "Tick the ones you are sending. A Japanese application usually sends 履歴書 and 職務経歴書 together."}
      </p>
      {choices.map((choice) => {
        const ready = choice.currentVersionNo !== null;
        const held = choice.heldBy !== null && !recording;
        return (
          <label
            key={choice.ref}
            className="flex items-start gap-8 px-10 py-8 bg-card border border-border-control rounded-control"
          >
            <input
              type="checkbox"
              className="mt-2 accent-accent"
              checked={ticked.includes(choice.ref)}
              disabled={!ready || held}
              onChange={() => toggle(choice.ref)}
            />
            <span className="min-w-0">
              <span className="block text-row font-medium text-text-strong">{choice.title}</span>
              <span className="block text-small text-text-muted">
                {held
                  ? choice.heldBy
                  : ready
                  ? `${choice.language === "ja" ? "日本語" : "English"} · version ${choice.currentVersionNo}, the one current today`
                  : choice.tailored
                    ? "No version yet. Generate it above first."
                    : "No version yet. Generate it from Home first."}
              </span>
            </span>
          </label>
        );
      })}
      <div className="flex flex-wrap items-center gap-8">
        <Button
          variant="secondary"
          onClick={() => onUse(orderOf(choices, ticked))}
          disabled={busy || nothing}
          disabledReason={busy ? "Working…" : "Tick at least one document."}
        >
          {recording ? "Record the ticked documents" : "Use the ticked documents"}
        </Button>
        {onCancel ? (
          <Button variant="bare" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The ticked refs in the order the card lists them, whatever order they were ticked in. */
const orderOf = (choices: DocumentChoice[], ticked: string[]) =>
  choices.map((choice) => choice.ref).filter((ref) => ticked.includes(ref));

function SentLine({ applicationId, copy }: { applicationId: string; copy: SentCopy }) {
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setFailure(null);
    setBusy(true);
    try {
      await downloadSentCopy(applicationId, copy.id);
    } catch (error) {
      setFailure(failureText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={ROW}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-6 text-row font-medium text-text-strong">
          {copy.title} <Chip>v{copy.versionNo} · frozen</Chip>
        </div>
        <div className="text-small text-text-muted">
          Sent <span className="font-mono">{copy.sentOn}</span>
        </div>
        {failure ? (
          <p role="alert" className="text-small text-removed">
            {failure}
          </p>
        ) : null}
      </div>
      <div className={LINKS}>
        <Link
          to="/applications/$applicationId/sent/$copyId"
          params={{ applicationId, copyId: copy.id }}
          aria-label={`Read ${copy.title} v${copy.versionNo}, sent ${copy.sentOn}`}
          className={QUIET}
        >
          Read it
        </Link>
        <button
          type="button"
          className={QUIET}
          aria-label={`Download ${copy.title} v${copy.versionNo}, sent ${copy.sentOn}`}
          disabled={busy}
          onClick={() => void download()}
        >
          {busy ? "Preparing…" : "Download"}
        </button>
      </div>
    </li>
  );
}

/**
 * The author's two notes for a tailored 履歴書. Both optional: an empty one is
 * drafted for them from the posting and the record, and confirmed on the
 * review either way. Saved with the application, never as facts.
 */
function NotesForm({
  application,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  application: Pick<Application, "motivationNote" | "kibouNote">;
  busy: boolean;
  /** `null` saves the notes alone, in a window too narrow to open the review. */
  submitLabel: string | null;
  onSubmit: (notes: ApplicationNotes) => void;
  onCancel?: () => void;
}) {
  const [motivation, setMotivation] = useState(application.motivationNote ?? "");
  const [kibou, setKibou] = useState(application.kibouNote ?? "");
  const motivationId = useId();
  const kibouId = useId();
  const notes = (): ApplicationNotes => ({
    motivationNote: motivation.trim() || null,
    kibouNote: kibou.trim() || null,
  });

  return (
    <form
      className="grid gap-8"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(notes());
      }}
    >
      <label htmlFor={motivationId} className="grid gap-4 min-w-0">
        <span className="text-small text-text-secondary">Why you are applying, in your own words (optional)</span>
        <textarea
          id={motivationId}
          lang="ja"
          rows={3}
          maxLength={APPLICATION_NOTE_MAX}
          value={motivation}
          onChange={(event) => setMotivation(event.target.value)}
          className={`${CONTROL} resize-y`}
        />
        <span className="text-smaller text-text-dim">
          It leads the 志望動機. Left empty, a reason is drafted from the posting and your record for you to confirm.
        </span>
      </label>
      <label htmlFor={kibouId} className="grid gap-4 min-w-0">
        <span className="text-small text-text-secondary">What you would ask for in 本人希望欄 (optional)</span>
        <textarea
          id={kibouId}
          lang="ja"
          rows={2}
          maxLength={APPLICATION_NOTE_MAX}
          value={kibou}
          onChange={(event) => setKibou(event.target.value)}
          className={`${CONTROL} resize-y`}
        />
        <span className="text-smaller text-text-dim">
          The role as the posting names it, or a condition you need. Left empty, one is drafted for you to confirm.
        </span>
      </label>
      <span className="flex flex-wrap items-center gap-8">
        <Button type="submit" variant="primary" disabled={busy} disabledReason="Working…">
          {submitLabel ?? "Save your notes"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="bare" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </span>
    </form>
  );
}

/** A tailored 履歴書's notes, opened under its line and saved without regenerating. */
function NotesToggle({
  application,
  busy,
  onSave,
}: {
  application: Pick<Application, "motivationNote" | "kibouNote">;
  busy: boolean;
  onSave: (notes: ApplicationNotes) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const written = [application.motivationNote, application.kibouNote].filter(Boolean).length;
  if (!open) {
    return (
      <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-4 text-smaller text-text-dim">
        <span>
          {written === 0
            ? "No notes of yours: its reason and request are drafted for you."
            : written === 1
              ? "One note of yours leads its draft."
              : "Your two notes lead its drafts."}
        </span>
        <Button variant="bare" className="-ml-6" onClick={() => setOpen(true)}>
          Your notes
        </Button>
      </div>
    );
  }
  return (
    <div className="mt-8 grid gap-6">
      <NotesForm
        application={application}
        busy={busy}
        submitLabel="Save your notes"
        onCancel={() => setOpen(false)}
        onSubmit={(notes) => {
          setFailure(null);
          onSave(notes).then(
            () => setOpen(false),
            (error: unknown) => setFailure(failureText(error)),
          );
        }}
      />
      <p className="text-smaller text-text-dim">Saved notes are used the next time you regenerate it.</p>
      {failure ? (
        <p role="alert" className="text-smaller text-removed">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
