/**
 * Applications, Add a job (`docs/10-screen-specifications.md`, issue #70).
 *
 * The job is typed in by hand: company, position, the job description and an
 * optional link to the posting. It is saved as Not applied, with today as the
 * day it was added, and its page opens.
 *
 * The job description is somebody else's text. It is kept with the
 * application and is never read as a source of facts about the author.
 */
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { failureText, useCreateApplication, type ApplicationFields } from "../api";
import { ApplicationsFrame, CONTROL, JobFields } from "../components/application-chrome";
import { ScreenIntro } from "../components/screen-intro";
import { Button, Panel } from "../components/ui";
import { useFlashStore } from "../stores/flash";

/** The server's own limit, said before the request rather than after it. */
const JOB_DESCRIPTION_MAX = 20_000;

export function NewApplicationScreen() {
  const create = useCreateApplication();
  const navigate = useNavigate();
  const flash = useFlashStore((state) => state.show);

  const [fields, setFields] = useState<ApplicationFields>({
    company: "",
    position: "",
    postingUrl: "",
    requirements: [],
  });
  const [jobDescription, setJobDescription] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  const tooLong = jobDescription.trim().length > JOB_DESCRIPTION_MAX;
  const incomplete =
    fields.company.trim() === "" || fields.position.trim() === "" || jobDescription.trim() === "";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    try {
      const made = await create.mutateAsync({ ...fields, jobDescription });
      flash("Saved as Not applied.");
      await navigate({ to: "/applications/$applicationId", params: { applicationId: made.id } });
    } catch (error) {
      setFailure(failureText(error));
    }
  };

  return (
    <ApplicationsFrame title="Add a job" crumb>
      <ScreenIntro next="type in the company, the position and the job description, then save.">
        Add a job you are looking at or have applied for. It is saved as Not applied, and you move it through
        its steps from its own page.
      </ScreenIntro>

      <Panel heading="New application">
        <form onSubmit={(event) => void submit(event)} className="grid gap-12">
          <JobFields value={fields} onChange={setFields} />
          <label className="grid gap-4 min-w-0">
            <span className="text-small text-text-secondary">Job description</span>
            <textarea
              name="jobDescription"
              value={jobDescription}
              rows={12}
              placeholder="Paste the posting here."
              onChange={(event) => setJobDescription(event.target.value)}
              className={`${CONTROL} resize-y`}
            />
          </label>
          <div className="flex flex-wrap items-center gap-8">
            <span className="flex-1 text-smaller text-text-muted">
              The job description is kept with this application and is never a source of facts about you.
            </span>
            <Link
              to="/applications"
              className="text-text-dim px-6 py-4 rounded-chip text-smaller hover:bg-border hover:text-text-secondary"
            >
              Cancel
            </Link>
            <Button
              type="submit"
              variant="primary"
              disabled={create.isPending || tooLong || incomplete}
              disabledReason={
                create.isPending
                  ? "Saving…"
                  : tooLong
                    ? `A job description can be at most ${JOB_DESCRIPTION_MAX.toLocaleString("en-US")} characters.`
                    : "Give it a company, a position and a job description first."
              }
            >
              {create.isPending ? "Saving…" : "Save application"}
            </Button>
          </div>
          {failure ? (
            <p role="alert" className="text-smaller text-removed">
              {failure}
            </p>
          ) : null}
        </form>
      </Panel>
    </ApplicationsFrame>
  );
}
