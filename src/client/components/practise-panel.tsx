/**
 * Practise for this job, the last panel of one application
 * (`docs/10-screen-specifications.md`, Screen 13; issue #77).
 *
 * Two things the author carries to Suburi by hand: the job description as a
 * text file, and the questions asked, copied one a line. Nothing is sent from
 * here; both are made in the browser from the application already on screen.
 */
import { useState } from "react";
import type { Application } from "../api";
import { useFlashStore } from "../stores/flash";
import { jobDescriptionFile, questionsAsked, questionsText } from "~/shared/handoff";
import { Button, Panel } from "./ui";

export function PractisePanel({ application }: { application: Application }) {
  const flash = useFlashStore((state) => state.show);
  const [failure, setFailure] = useState<string | null>(null);
  const questions = questionsAsked(application.interviews);
  const n = questions.length;

  const download = () => {
    const file = jobDescriptionFile(application);
    const objectUrl = URL.createObjectURL(new Blob([file.text], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = file.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const copy = async () => {
    setFailure(null);
    try {
      await navigator.clipboard.writeText(questionsText(questions));
      flash(n === 1 ? "Copied the question." : `Copied the ${n} questions.`);
    } catch {
      setFailure("The questions could not be copied. The browser did not allow it; try again.");
    }
  };

  return (
    <Panel heading="Practise for this job">
      <p className="text-small text-text-muted">
        Suburi, your interview practice app, can take a job description as the role for a practice round. Nothing is
        sent to it from here: you carry the file or the text across yourself.
      </p>
      <div className="mt-12 flex flex-wrap items-center gap-8">
        <Button variant="ghost" onClick={download}>
          Download the job description (.txt)
        </Button>
        {n > 0 ? (
          <Button variant="ghost" onClick={() => void copy()}>
            {n === 1 ? "Copy the 1 question asked" : `Copy the ${n} questions asked`}
          </Button>
        ) : (
          <span className="text-small text-text-muted">Questions asked show up here once an interview has some.</span>
        )}
      </div>
      {failure ? (
        <p role="alert" className="mt-10 text-smaller text-removed">
          {failure}
        </p>
      ) : null}
    </Panel>
  );
}
