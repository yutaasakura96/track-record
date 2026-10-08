/**
 * Screen 11 — Tailored résumés (`docs/10-screen-specifications.md`, issue #57).
 *
 * One résumé per job. The author pastes a job description (or reads one in from
 * a text file) and gets a résumé written toward it from the same record, by
 * the same rules: only facts the main résumé may use, read as a diff before it
 * becomes a version, with its own history and its own download. Any number.
 *
 * The job description decides what leads and what is left out. It is never a
 * source of facts.
 */
import { useRef, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  failureText,
  useCreateTailoredResume,
  useGenerate,
  useProfile,
  useTailoredResumes,
} from "../api";
import { DocumentRow } from "../components/document-row";
import { ReadFailure, RefreshFailure } from "../components/read-failure";
import { ScreenIntro } from "../components/screen-intro";
import { Sidebar } from "../components/sidebar";
import { Button, Panel } from "../components/ui";
import { relative } from "../format";

const CONTROL =
  "min-h-control bg-surface-raised border border-border-control rounded-control px-10 py-8 text-ui text-text-strong outline-none focus:shadow-ring";

/** The server's own limit, said before the request rather than after it. */
const JOB_DESCRIPTION_MAX = 20_000;

export function TailoredScreen() {
  const profile = useProfile();
  const tailored = useTailoredResumes();
  const create = useCreateTailoredResume();
  const generate = useGenerate();
  const navigate = useNavigate();
  const file = useRef<HTMLInputElement>(null);

  const [label, setLabel] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [failure, setFailure] = useState<{ at: "form" | "list"; text: string } | null>(null);

  const data = tailored.data;
  const canGenerate = data?.canGenerate ?? false;
  const busy = create.isPending || generate.isPending;
  const tooLong = jobDescription.trim().length > JOB_DESCRIPTION_MAX;

  const open = async (ref: string, at: "form" | "list") => {
    try {
      const made = await generate.mutateAsync(ref);
      await navigate({ to: "/proposals/$proposalId", params: { proposalId: made.proposalId } });
    } catch (error) {
      setFailure({ at, text: failureText(error) });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    let ref: string;
    try {
      ref = (await create.mutateAsync({ label, jobDescription })).ref;
    } catch (error) {
      setFailure({ at: "form", text: failureText(error) });
      return;
    }
    // Stored. Whatever Generate says next, the résumé is on the list below.
    setLabel("");
    setJobDescription("");
    if (canGenerate) await open(ref, "form");
  };

  const readFile = async (chosen: File | undefined) => {
    if (!chosen) return;
    setFailure(null);
    try {
      setJobDescription(await chosen.text());
      if (label.trim() === "") setLabel(chosen.name.replace(/\.[^.]+$/, ""));
    } catch {
      setFailure({ at: "form", text: "That file could not be read. Paste the text instead." });
    }
  };

  return (
    <div className="min-h-screen flex">
      <Sidebar name={profile.data?.nameLatin ?? ""} />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-header shrink-0 flex items-center gap-12 px-20 bg-surface border-b border-border">
          <h1 className="text-panel font-semibold tracking-snug text-text-strong">Tailored résumés</h1>
          <span className="text-smaller text-text-dimmer">One résumé per job, written from the same record</span>
        </header>

        <div className="flex-1 overflow-y-auto px-20 py-26 grid gap-20 content-start">
          <ScreenIntro
            next={
              !data
                ? undefined
                : !canGenerate
                  ? "your record holds no fact a document may use yet. Import a document first."
                  : data.items.length === 0
                    ? "paste a job description below to make the first one."
                    : "nothing is waiting here. Make another, or update one below."
            }
          >
            Paste a job description and get a résumé written for that job. It is written from the
            same facts as your main résumé, and you read it as a set of changes before it becomes a
            version. The job description decides what leads and what is left out; it never adds a
            skill or a claim that is not in your record.
          </ScreenIntro>

          <Panel heading="New tailored résumé">
            <form onSubmit={(event) => void submit(event)} className="grid gap-12">
              <label className="grid gap-4">
                <span className="text-small text-text-secondary">Name, for you to tell it apart</span>
                <input
                  name="label"
                  aria-label="Name"
                  value={label}
                  maxLength={120}
                  placeholder="The company and the role"
                  onChange={(event) => setLabel(event.target.value)}
                  className={CONTROL}
                />
              </label>
              <label className="grid gap-4">
                <span className="text-small text-text-secondary">Job description</span>
                <textarea
                  name="jobDescription"
                  aria-label="Job description"
                  value={jobDescription}
                  rows={10}
                  placeholder="Paste the posting here."
                  onChange={(event) => setJobDescription(event.target.value)}
                  className={`${CONTROL} resize-y`}
                />
              </label>
              <div className="flex flex-wrap items-center gap-12">
                <input
                  ref={file}
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  aria-label="Job description file"
                  className="hidden"
                  onChange={(event) => {
                    void readFile(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                <Button type="button" variant="ghost" onClick={() => file.current?.click()}>
                  Read it from a text file
                </Button>
                <span className="text-smaller text-text-dim">
                  A .txt or .md file. It is kept with this résumé and is not imported as a source of facts.
                </span>
                <Button
                  type="submit"
                  variant="primary"
                  className="ml-auto"
                  disabled={busy || tooLong || label.trim() === "" || jobDescription.trim() === ""}
                  disabledReason={
                    busy
                      ? "Working…"
                      : tooLong
                        ? `A job description can be at most ${JOB_DESCRIPTION_MAX.toLocaleString("en-US")} characters.`
                        : "Give it a name and a job description first."
                  }
                >
                  {create.isPending ? "Saving…" : generate.isPending ? "Generating…" : canGenerate ? "Generate résumé" : "Save"}
                </Button>
              </div>
              {failure?.at === "form" ? (
                <p role="alert" className="text-smaller text-removed">
                  {failure.text}
                </p>
              ) : null}
            </form>
          </Panel>

          {data && tailored.isError ? <RefreshFailure query={tailored} /> : null}
          {!data && tailored.isError ? (
            <ReadFailure query={tailored} />
          ) : !data ? (
            <p className="text-smaller text-text-dim">Loading your tailored résumés…</p>
          ) : (
            <Panel heading="Your tailored résumés">
              {failure?.at === "list" ? (
                <p role="alert" className="mb-6 text-small text-text-secondary">
                  {failure.text}
                </p>
              ) : null}
              {data.items.length === 0 ? (
                <p className="text-smaller text-text-dim">
                  None yet. Your main résumé is on Home; a tailored one is a variant of it for one job.
                </p>
              ) : (
                <ul>
                  {data.items.map((row) => (
                    <DocumentRow
                      key={row.ref}
                      row={row}
                      title={row.tailored?.label ?? row.title}
                      note={row.tailored ? `Made ${relative(row.tailored.createdAt)}` : undefined}
                      canGenerate={canGenerate}
                      busy={busy}
                      onGenerate={() => {
                        setFailure(null);
                        void open(row.ref, "list");
                      }}
                    />
                  ))}
                </ul>
              )}
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
