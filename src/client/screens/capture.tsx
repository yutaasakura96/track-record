/**
 * Quick capture (`docs/09` Flow 6, `docs/10` Quick capture, issue #95): work
 * that left no document, typed in a sentence or two.
 *
 * Two steps on one screen, as Add a job is. What was typed is split into
 * claims worded like imported ones, with the month and the employer or project
 * filled in where the text says them, and the check step asks only for what
 * it does not say. The author confirms or corrects each claim and saves, and
 * the facts go **straight into the record**: accepted, Attested, graded by the
 * author. Each keeps a card here, to change or reject it afterwards.
 *
 * **Adding never depends on the model.** When the reading fails or finds
 * nothing, the plain form opens with the typed text kept in it.
 *
 * **The draft survives leaving the screen.** It is kept in this browser until
 * it is saved or discarded, and nothing is created on the server before save.
 *
 * Works at phone width, like Applications (`docs/10` Responsive behaviour).
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearch } from "@tanstack/react-router";
import {
  failureText,
  useCapturedFacts,
  useEntities,
  useFactAction,
  useReadCapture,
  useSaveCapture,
  type CaptureQuestion,
  type CaptureSave,
  type CapturedClaim,
  type Employer,
  type Fact,
  type Project,
} from "../api";
import { CONTROL, PhoneFrame } from "../components/application-chrome";
import { FlagLine } from "../components/flags";
import { ScreenIntro } from "../components/screen-intro";
import { Button, Mono, Panel } from "../components/ui";
import { useFlashStore } from "../stores/flash";
import { ClaimEditor, WhoControl, WorthControl } from "./fact-review";
import { CAPTURE_TEXT_MAX, CAPTURED_CLAIMS_MAX, CLAIM_MAX } from "~/shared/capture";

const DRAFT_KEY = "track-record:capture-draft";

/** One claim on the check step: what was read, and what the author has made of it. */
interface DraftClaim {
  claim: string;
  /** `YYYY-MM`, or empty. */
  month: string;
  /** `employer:<id>`, `project:<id>`, `none` for a chosen `No employer`, or empty for not said. */
  filed: string;
  technologies: string[];
  /** What the text did not say, which is what the step asks for. */
  missing: CaptureQuestion[];
}

interface Draft {
  step: "text" | "check";
  text: string;
  claims: DraftClaim[];
  /** How the reading went: what the check step says above the claims. */
  reading: "read" | "failed" | "empty" | "plain";
}

const EMPTY: Draft = { step: "text", text: "", claims: [], reading: "read" };

/** Storage can be refused outright, or hold something older than this screen. Either is no draft. */
function storedDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return EMPTY;
    const draft = JSON.parse(raw) as Draft;
    if (typeof draft.text !== "string" || !Array.isArray(draft.claims)) return EMPTY;
    return { ...EMPTY, ...draft };
  } catch {
    return EMPTY;
  }
}

function keep(draft: Draft) {
  try {
    if (draft.text === "" && draft.claims.length === 0) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // The draft then lasts as long as the page, which is all a refused storage allows.
  }
}

/** The author's own month, so "last month" is read where they are. */
const thisMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

const filedOf = (claim: CapturedClaim) =>
  claim.projectId ? `project:${claim.projectId}` : claim.employerId ? `employer:${claim.employerId}` : "";

/** The plain form's one claim: the typed text, kept, and everything else to fill in. */
const plainClaim = (text: string): DraftClaim => ({
  claim: text.trim(),
  month: "",
  filed: "",
  technologies: [],
  missing: ["when", "employer"],
});

function toSave(claim: DraftClaim): CaptureSave {
  const [kind, id] = claim.filed.split(":");
  return {
    claim: claim.claim.trim(),
    month: claim.month || null,
    ...(kind === "employer" ? { employerId: id } : kind === "project" ? { projectId: id } : kind === "none" ? { employerId: null } : {}),
    technologies: claim.technologies,
  };
}

const QUESTION_TEXT: Record<"change" | "proof", string> = {
  change: "What changed as a result? Say it in the claim.",
  proof: "What shows it happened: a number, a before and after, someone who saw it? Add it to the claim if you can.",
};

const READING_NOTE: Record<Exclude<Draft["reading"], "read">, string> = {
  failed: "What you typed could not be read just now. Fill the claim in yourself; your text is kept.",
  empty: "No claim could be found in what you typed. Fill it in yourself; your text is kept.",
  plain: "Fill the claim in yourself: what you did, and what changed.",
};

export function CaptureScreen() {
  const read = useReadCapture();
  const save = useSaveCapture();
  const flash = useFlashStore((state) => state.show);
  const [draft, setDraft] = useState<Draft>(storedDraft);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => keep(draft), [draft]);

  const update = (next: Partial<Draft>) => {
    setFailure(null);
    setDraft((current) => ({ ...current, ...next }));
  };

  // Each step opens with the keyboard where the work is: the text, then the first claim.
  const textArea = useRef<HTMLTextAreaElement>(null);
  const checkForm = useRef<HTMLFormElement>(null);
  const arrived = useRef(false);
  useEffect(() => {
    if (!arrived.current) {
      arrived.current = true;
      return;
    }
    if (draft.step === "text") textArea.current?.focus();
    else checkForm.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  }, [draft.step]);

  const readIt = async (event: FormEvent) => {
    event.preventDefault();
    if (read.isPending) return;
    const text = draft.text.trim();
    if (text === "") return setFailure("Type what you did first. A sentence or two is enough.");
    if (text.length > CAPTURE_TEXT_MAX) {
      return setFailure(
        `What you type can be at most ${CAPTURE_TEXT_MAX.toLocaleString("en-US")} characters. This is ${text.length.toLocaleString("en-US")}.`,
      );
    }
    setFailure(null);
    // Every reading replaces the claims: what is checked is never an earlier text's reading.
    try {
      const { claims } = await read.mutateAsync({ text, today: thisMonth() });
      if (claims.length === 0) {
        update({ step: "check", claims: [plainClaim(text)], reading: "empty" });
      } else {
        update({
          step: "check",
          reading: "read",
          claims: claims.map((claim) => ({
            claim: claim.claim,
            month: claim.month ?? "",
            filed: filedOf(claim),
            technologies: claim.technologies,
            missing: claim.missing,
          })),
        });
      }
    } catch {
      update({ step: "check", claims: [plainClaim(text)], reading: "failed" });
    }
  };

  const saveIt = async (event: FormEvent) => {
    event.preventDefault();
    if (save.isPending) return;
    if (draft.claims.some((claim) => claim.claim.trim() === "")) {
      return setFailure("A claim cannot be empty. Fill it in, or remove it.");
    }
    setFailure(null);
    try {
      const { items } = await save.mutateAsync(draft.claims.map(toSave));
      setDraft(EMPTY);
      flash(items.length === 1 ? "Saved 1 fact into your record." : `Saved ${items.length} facts into your record.`);
    } catch (error) {
      setFailure(failureText(error));
    }
  };

  const setClaim = (index: number, next: Partial<DraftClaim>) =>
    update({ claims: draft.claims.map((claim, i) => (i === index ? { ...claim, ...next } : claim)) });

  const alert = failure ? (
    <p role="alert" className="text-smaller text-removed">
      {failure}
    </p>
  ) : null;

  return (
    <PhoneFrame title="Quick capture" back={{ to: "/", label: "Home" }}>
      {draft.step === "text" ? (
        <>
          <ScreenIntro next="type what you did, then press Read it.">
            Write down work that left no document, in a sentence or two. It is split into facts worded like the
            ones read from your documents, and you check each one before it is saved.
          </ScreenIntro>
          <Panel heading="What did you do?">
            <form onSubmit={(event) => void readIt(event)} noValidate className="grid gap-12">
              <label className="grid gap-4 min-w-0">
                <span className="text-small text-text-secondary">In your own words</span>
                <textarea
                  ref={textArea}
                  name="text"
                  value={draft.text}
                  rows={5}
                  maxLength={CAPTURE_TEXT_MAX}
                  placeholder="Last month I moved the nightly export onto a queue. The morning report now arrives by 7."
                  readOnly={read.isPending}
                  onChange={(event) => update({ text: event.target.value })}
                  className={`${CONTROL} resize-y`}
                />
              </label>
              {read.isPending ? (
                <p
                  role="status"
                  className="flex items-center gap-8 border border-border-control bg-surface-raised rounded-control px-10 py-8 text-small text-text-secondary"
                >
                  <span className="size-6 rounded-full bg-accent motion-working shrink-0" aria-hidden />
                  Reading what you typed. This takes a few seconds.
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-8">
                  <span className="flex-1 text-smaller text-text-muted">Nothing is saved until you save it.</span>
                  <Button
                    type="button"
                    variant="bare"
                    onClick={() => update({ step: "check", claims: [plainClaim(draft.text)], reading: "plain" })}
                  >
                    Fill it in yourself
                  </Button>
                  <Button type="submit" variant="primary">
                    Read it
                  </Button>
                </div>
              )}
              {alert}
            </form>
          </Panel>
        </>
      ) : (
        <>
          <ScreenIntro
            next={
              draft.reading === "read"
                ? "check each claim, answer what it asks, then save."
                : "fill in the claim, when it was and where, then save."
            }
          >
            {draft.reading === "read"
              ? "This is what was read from what you typed. Correct anything that is wrong, then save."
              : "Saving puts the fact straight into your record."}
          </ScreenIntro>
          <Panel
            heading={draft.claims.length === 1 ? "Check the claim" : `Check the ${draft.claims.length} claims`}
            action={
              <Button type="button" variant="bare" onClick={() => update({ step: "text" })}>
                Back to the text
              </Button>
            }
          >
            <form ref={checkForm} onSubmit={(event) => void saveIt(event)} noValidate className="grid gap-16">
              {draft.reading === "read" ? null : (
                <p role="status" className="text-small text-text-secondary">
                  {READING_NOTE[draft.reading]}
                </p>
              )}
              {draft.claims.map((claim, index) => (
                <ClaimFields
                  // Keyed by place: a claim on this step has no identity but its position.
                  key={index}
                  index={index}
                  count={draft.claims.length}
                  claim={claim}
                  onChange={(next) => setClaim(index, next)}
                  onRemove={() => update({ claims: draft.claims.filter((_, i) => i !== index) })}
                />
              ))}
              {draft.claims.length < CAPTURED_CLAIMS_MAX ? (
                <div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => update({ claims: [...draft.claims, { ...plainClaim(""), missing: [] }] })}
                  >
                    Add a claim
                  </Button>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-8">
                <span className="flex-1 min-w-0 text-smaller text-text-muted">
                  Saved into your record as Attested, by you. You can change or reject each one below afterwards.
                </span>
                <Button type="button" variant="bare" onClick={() => setDraft(EMPTY)}>
                  Discard
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={save.isPending || draft.claims.length === 0}
                  disabledReason={save.isPending ? "Saving…" : "There is no claim to save."}
                >
                  {save.isPending ? "Saving…" : draft.claims.length === 1 ? "Save the fact" : `Save ${draft.claims.length} facts`}
                </Button>
              </div>
              {alert}
            </form>
          </Panel>
        </>
      )}
      <CapturedFacts />
    </PhoneFrame>
  );
}

/** Where a claim is filed: an employer, a project, `No employer`, or not said. */
function FiledUnder({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const employers = useEntities<Employer>("employers").data?.items ?? [];
  const projects = useEntities<Project>("projects").data?.items ?? [];
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className={CONTROL}>
      <option value="">Not said</option>
      {employers.length > 0 ? (
        <optgroup label="Employers">
          {employers.map((employer) => (
            <option key={employer.id} value={`employer:${employer.id}`}>
              {employer.nameLatin ?? employer.nameJa}
            </option>
          ))}
        </optgroup>
      ) : null}
      {projects.length > 0 ? (
        <optgroup label="Projects">
          {projects.map((project) => (
            <option key={project.id} value={`project:${project.id}`}>
              {project.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      <option value="none">No employer</option>
    </select>
  );
}

function ClaimFields({
  index,
  count,
  claim,
  onChange,
  onRemove,
}: {
  index: number;
  count: number;
  claim: DraftClaim;
  onChange: (next: Partial<DraftClaim>) => void;
  onRemove: () => void;
}) {
  const asks = (question: CaptureQuestion) => claim.missing.includes(question);
  const label = count === 1 ? "Claim" : `Claim ${index + 1}`;
  return (
    <fieldset className="grid gap-10 min-w-0 border-t border-border-subtle pt-12 first-of-type:border-t-0 first-of-type:pt-0">
      <legend className="sr-only">{label}</legend>
      <div className="flex items-center gap-8">
        <span aria-hidden className="text-small font-medium text-text-strong">
          {label}
        </span>
        {count > 1 ? (
          <Button type="button" variant="bare" className="ml-auto" onClick={onRemove}>
            Remove
          </Button>
        ) : null}
      </div>
      <label className="grid gap-4 min-w-0">
        <span className="sr-only">{label}</span>
        <textarea
          aria-label={label}
          value={claim.claim}
          rows={2}
          maxLength={CLAIM_MAX}
          onChange={(event) => onChange({ claim: event.target.value })}
          className={`${CONTROL} resize-y`}
        />
      </label>
      {(["change", "proof"] as const).filter(asks).map((question) => (
        <p key={question} className="text-small text-text-secondary">
          {QUESTION_TEXT[question]}
        </p>
      ))}
      <div className="grid grid-cols-2 max-phone:grid-cols-1 gap-12">
        <label className="grid gap-4 min-w-0">
          <span className="text-small text-text-secondary">{asks("when") ? "When was this?" : "When"}</span>
          <input
            type="month"
            aria-label={`${label}: month`}
            value={claim.month}
            onChange={(event) => onChange({ month: event.target.value })}
            className={CONTROL}
          />
        </label>
        <label className="grid gap-4 min-w-0">
          <span className="text-small text-text-secondary">
            {asks("employer") ? "Which employer, or which project?" : "Employer or project"}
          </span>
          <FiledUnder label={`${label}: employer or project`} value={claim.filed} onChange={(filed) => onChange({ filed })} />
        </label>
      </div>
    </fieldset>
  );
}

/**
 * The facts saved here, each on a card to change or reject it (S2). A captured
 * fact has no document, so this is the card the master document and the
 * Flagged list open it on.
 */
function CapturedFacts() {
  const captured = useCapturedFacts();
  const { fact: asked } = useSearch({ from: "/capture" });
  const items = [...(captured.data?.items ?? [])].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
  );
  if (items.length === 0) return null;
  return (
    <Panel heading="Captured facts">
      <p className="mb-12 text-small text-text-muted">
        The facts you saved here, newest first. They are in your record; open one to change or reject it.
      </p>
      <ul className="grid gap-10">
        {items.map((fact) => (
          <CapturedCard key={fact.id} fact={fact} opened={fact.id === asked} />
        ))}
      </ul>
    </Panel>
  );
}

function CapturedCard({ fact, opened }: { fact: Fact; opened: boolean }) {
  // Only the fact writes, which name no import; the key is the list they refresh under.
  const { patch, resolve, regrade } = useFactAction("captured");
  const [changing, setChanging] = useState(opened);
  const card = useRef<HTMLLIElement>(null);
  const employers = useEntities<Employer>("employers").data?.items ?? [];
  const projects = useEntities<Project>("projects").data?.items ?? [];

  useEffect(() => {
    // Optional: jsdom has no layout, and so no `scrollIntoView`.
    if (opened) card.current?.scrollIntoView?.({ block: "center" });
  }, [opened]);

  const failure = patch.error ?? resolve.error ?? regrade.error;
  const edit = (body: Parameters<typeof patch.mutate>[0]["body"]) => {
    resolve.reset();
    regrade.reset();
    patch.mutate({ id: fact.id, body });
  };
  const decide = (action: "reject" | "undo") => {
    patch.reset();
    regrade.reset();
    resolve.mutate({ id: fact.id, action });
  };

  const project = projects.find((item) => item.id === fact.projectId);
  const employer = employers.find((item) => item.id === fact.employerId);
  const where = project ? project.name : employer ? (employer.nameLatin ?? employer.nameJa) : null;
  const rejected = fact.status === "rejected";
  const filed = fact.projectId ? `project:${fact.projectId}` : fact.employerId ? `employer:${fact.employerId}` : fact.employerSetByHand ? "none" : "";

  return (
    <li
      ref={card}
      aria-current={opened || undefined}
      className={`bg-card-recessed border rounded-tile px-12 py-10 ${opened ? "border-border-control" : "border-border-subtle"}`}
    >
      <p className={`text-claim ${rejected ? "text-text-dim line-through" : "text-text-strong"}`}>{fact.claim}</p>
      <div className="mt-8 flex flex-wrap items-center gap-x-10 gap-y-4">
        <Mono className="text-text-faint">
          {fact.status} · {fact.provenance} · {fact.disclosure}
        </Mono>
        {fact.month ? <Mono className="text-text-faint">{fact.month}</Mono> : null}
        {where ? <span className="min-w-0 text-smaller text-text-muted break-words">{where}</span> : null}
        {rejected ? (
          <button type="button" className="ml-auto text-smaller text-text-dim hover:text-text-secondary" onClick={() => decide("undo")}>
            Undo
          </button>
        ) : (
          <button
            type="button"
            aria-expanded={changing}
            className="ml-auto text-smaller text-text-dim hover:text-text-secondary"
            onClick={() => setChanging(!changing)}
          >
            {changing ? "Close" : "Change"}
          </button>
        )}
      </div>
      {fact.flags.filter((flag) => !flag.checked).length > 0 ? (
        <section aria-label="Flagged" className="mt-8 grid gap-8">
          {fact.flags.filter((flag) => !flag.checked).map((flag) => (
            <FlagLine key={flag.id} flag={flag} />
          ))}
        </section>
      ) : null}
      {changing && !rejected ? (
        <section aria-label="Change this fact" className="mt-10 grid gap-10 min-w-0">
          <ClaimEditor claim={fact.claim} onChange={(claim) => edit({ claim })} />
          <WorthControl
            value={fact.provenance}
            onChange={(provenance) => {
              patch.reset();
              resolve.reset();
              regrade.mutate({ id: fact.id, provenance });
            }}
          />
          <WhoControl value={fact.disclosure} onChange={(disclosure) => edit({ disclosure })} />
          <div className="grid grid-cols-2 max-phone:grid-cols-1 gap-12">
            <label className="grid gap-4 min-w-0">
              <span className="text-small text-text-secondary">When</span>
              <input
                type="month"
                value={fact.month ?? ""}
                onChange={(event) => edit({ month: event.target.value || null })}
                className={CONTROL}
              />
            </label>
            <label className="grid gap-4 min-w-0">
              <span className="text-small text-text-secondary">Employer</span>
              {/* The card files by employer, as every fact card does. A project is chosen when it is captured. */}
              <FiledEmployer
                value={filed.startsWith("project:") ? "" : filed}
                disabled={filed.startsWith("project:")}
                onChange={(value) => edit({ employerId: value === "none" ? null : value.replace("employer:", "") })}
              />
            </label>
          </div>
          <div>
            <Button variant="ghost" onClick={() => decide("reject")}>
              Reject
            </Button>
          </div>
        </section>
      ) : null}
      {failure ? (
        <p role="alert" className="mt-8 text-smaller text-removed">
          {failureText(failure)}
        </p>
      ) : null}
    </li>
  );
}

function FiledEmployer({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const employers = useEntities<Employer>("employers").data?.items ?? [];
  if (disabled) return <p className="text-small text-text-muted">Filed through its project.</p>;
  return (
    <select aria-label="Employer" value={value} onChange={(event) => onChange(event.target.value)} className={CONTROL}>
      {value === "" ? <option value="">Unfiled</option> : null}
      {employers.map((employer) => (
        <option key={employer.id} value={`employer:${employer.id}`}>
          {employer.nameLatin ?? employer.nameJa}
        </option>
      ))}
      <option value="none">No employer</option>
    </select>
  );
}

