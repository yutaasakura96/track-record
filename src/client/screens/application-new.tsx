/**
 * Applications, Add a job (`docs/10-screen-specifications.md` Screen 13,
 * issues #70 and #73).
 *
 * Two steps on one screen. The job description is pasted and read, and what
 * was read (the company, the position and the key requirements) is put in
 * fields to check. **Nothing is saved until `Save application`**, and the
 * reading is only ever a proposal: every field it filled can be corrected.
 *
 * Adding a job never depends on the reading. When it fails, or finds nothing,
 * the same fields open empty to type in.
 *
 * The job description is somebody else's text. It is kept with the
 * application and is never read as a source of facts about the author.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { failureText, useCreateApplication, useReadPosting, type ApplicationFields } from "../api";
import { ApplicationsFrame, CONTROL, JobFields, POSTING_LINK_LABEL } from "../components/application-chrome";
import { ScreenIntro } from "../components/screen-intro";
import { Button, Panel } from "../components/ui";
import { useFlashStore } from "../stores/flash";
import { JOB_DESCRIPTION_MAX, JOB_DESCRIPTION_READ_MIN } from "~/shared/application";

const CANCEL = "text-text-dim px-6 py-4 rounded-chip text-smaller hover:bg-border hover:text-text-secondary";
const count = (n: number) => n.toLocaleString("en-US");

/** How the last reading went, which is what the check step's `Next:` line says. */
type Reading = { failed: true } | { failed: false; company: boolean; position: boolean };

function nextOf(reading: Reading | null) {
  if (!reading || reading.failed) return "type in the company and the position, then save.";
  if (reading.company && reading.position) return "check the three fields, then save the application.";
  const missing = reading.company ? "position" : reading.position ? "company" : null;
  return missing
    ? `the ${missing} could not be found in the text. Type it in, then save.`
    : "the company and the position could not be found in the text. Type them in, then save.";
}

export function NewApplicationScreen() {
  const create = useCreateApplication();
  const read = useReadPosting();
  const navigate = useNavigate();
  const flash = useFlashStore((state) => state.show);

  const [step, setStep] = useState<"text" | "check">("text");
  const [fields, setFields] = useState<ApplicationFields>({
    company: "",
    position: "",
    postingUrl: "",
    requirements: [],
  });
  const [jobDescription, setJobDescription] = useState("");
  /** The text the fields were last read from, so the same text is not read twice. */
  const [readText, setReadText] = useState<string | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // Each step opens with the keyboard where the work is: the text, then the
  // first field to check. Not on arrival, which is the router's to place.
  const textArea = useRef<HTMLTextAreaElement>(null);
  const checkForm = useRef<HTMLFormElement>(null);
  const arrived = useRef(false);
  useEffect(() => {
    if (!arrived.current) {
      arrived.current = true;
      return;
    }
    if (step === "text") textArea.current?.focus();
    else checkForm.current?.querySelector<HTMLInputElement>('input[name="company"]')?.focus();
  }, [step]);

  const link = (fields.postingUrl ?? "").trim();

  const readIt = async (event: FormEvent) => {
    event.preventDefault();
    const text = jobDescription.trim();
    if (text.length < JOB_DESCRIPTION_READ_MIN) {
      return setFailure("Paste the job description first. A few lines is enough.");
    }
    if (text.length > JOB_DESCRIPTION_MAX) {
      return setFailure(
        `A job description can be at most ${count(JOB_DESCRIPTION_MAX)} characters. This one is ${count(text.length)}.`,
      );
    }
    if (link !== "" && !/^https?:\/\/\S+$/i.test(link)) {
      return setFailure("A link to the posting starts with https://");
    }
    setFailure(null);

    // Back to the text and on again with nothing changed: what was read, and
    // whatever was corrected since, is still there.
    if (text !== readText) {
      try {
        const proposal = await read.mutateAsync(text);
        const nothing = proposal.company === "" && proposal.position === "" && proposal.requirements.length === 0;
        // Fields typed in after a failed reading are not emptied by a second
        // reading that found nothing either.
        if (!(reading?.failed && nothing)) setFields((current) => ({ ...current, ...proposal }));
        setReadText(text);
        setReading({ failed: false, company: proposal.company !== "", position: proposal.position !== "" });
      } catch {
        // Whatever went wrong, the fields are there to type in.
        setReading({ failed: true });
      }
    }
    setStep("check");
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (fields.company.trim() === "" || fields.position.trim() === "") {
      return setFailure("Give it a company and a position first.");
    }
    setFailure(null);
    try {
      const made = await create.mutateAsync({ ...fields, postingUrl: link, jobDescription });
      flash("Saved as Not applied.");
      await navigate({ to: "/applications/$applicationId", params: { applicationId: made.id } });
    } catch (error) {
      setFailure(failureText(error));
    }
  };

  const move = (to: "text" | "check") => {
    setFailure(null);
    setStep(to);
  };

  /** A refusal is about what was in the fields when it was made, so a change takes it down. */
  const edit = (next: ApplicationFields) => {
    setFailure(null);
    setFields(next);
  };

  const alert = failure ? (
    <p role="alert" className="text-smaller text-removed">
      {failure}
    </p>
  ) : null;

  if (step === "text") {
    return (
      <ApplicationsFrame title="Add a job" crumb>
        <ScreenIntro next="paste the text of the posting below.">
          Paste the job description. The company, the position and the key requirements are read out of it, and
          you check them before anything is saved.
        </ScreenIntro>

        <Panel heading="New application">
          <form onSubmit={(event) => void readIt(event)} noValidate className="grid gap-12">
            <label className="grid gap-4 min-w-0">
              <span className="text-small text-text-secondary">Job description</span>
              <textarea
                ref={textArea}
                name="jobDescription"
                value={jobDescription}
                rows={12}
                placeholder="Paste the posting here."
                readOnly={read.isPending}
                onChange={(event) => {
                  setFailure(null);
                  setJobDescription(event.target.value);
                }}
                className={`${CONTROL} resize-y`}
              />
            </label>
            <label className="grid gap-4 min-w-0">
              <span className="text-small text-text-secondary">{POSTING_LINK_LABEL}</span>
              <input
                name="postingUrl"
                type="url"
                inputMode="url"
                placeholder="https://"
                value={fields.postingUrl ?? ""}
                readOnly={read.isPending}
                onChange={(event) => edit({ ...fields, postingUrl: event.target.value })}
                className={CONTROL}
              />
            </label>
            {read.isPending ? (
              <p
                role="status"
                className="flex items-center gap-8 border border-border-control bg-surface-raised rounded-control px-10 py-8 text-small text-text-secondary"
              >
                <span className="size-6 rounded-full bg-accent motion-working shrink-0" aria-hidden />
                Reading the job description. This takes a few seconds.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-8">
                <span className="flex-1 text-smaller text-text-muted">
                  It is kept with this application and is never a source of facts about you.
                </span>
                <Link to="/applications" className={CANCEL}>
                  Cancel
                </Link>
                <Button type="submit" variant="primary">
                  Read it
                </Button>
              </div>
            )}
            {alert}
          </form>
        </Panel>
      </ApplicationsFrame>
    );
  }

  return (
    <ApplicationsFrame title="Add a job" crumb>
      <ScreenIntro next={nextOf(reading)}>
        This is what was read from the job description. Correct anything that is wrong, then save.
      </ScreenIntro>

      <Panel
        heading="Check what was read"
        action={
          <Button type="button" variant="bare" onClick={() => move("text")}>
            Back to the text
          </Button>
        }
      >
        <form ref={checkForm} onSubmit={(event) => void save(event)} className="grid gap-12">
          {reading?.failed ? (
            <p role="status" className="text-small text-text-secondary">
              The job description could not be read just now. Type the fields in; your text is kept.
            </p>
          ) : null}
          <JobFields value={fields} onChange={edit} read />
          {link ? <p className="text-small text-text-muted break-all">Link: {link}</p> : null}
          <div className="flex flex-wrap items-center gap-8">
            <span className="flex-1 text-smaller text-text-muted">
              Saved as Not applied. You choose its résumé next.
            </span>
            <Link to="/applications" className={CANCEL}>
              Cancel
            </Link>
            <Button type="submit" variant="primary" disabled={create.isPending} disabledReason="Saving…">
              {create.isPending ? "Saving…" : "Save application"}
            </Button>
          </div>
          {alert}
        </form>
      </Panel>
    </ApplicationsFrame>
  );
}
