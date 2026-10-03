/**
 * Importing a NEW document: the file picker, its project and employer
 * confirmation row, and the empty-state drop target.
 *
 * Shared by Screen 3 and Screen 8 (`docs/10`) as one component rather than two
 * copies, so the types the drop target names cannot drift between them.
 */
import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { failureText, useEntitiesOnDemand, useStartImport, type Employer, type Project } from "../api";
import { Button, Chip } from "./ui";

/** The types that import today (`docs/07` §5). */
export const IMPORT_ACCEPT = ".md,.markdown,.txt";

/**
 * Matches the entity forms on Screen 4. Exported because Screen 8's refile row
 * asks the same question with the same control, and two copies of a control
 * class drift.
 */
export const SELECT_CONTROL =
  "min-h-control bg-surface-raised border border-border-control rounded-control px-10 py-8 text-ui text-text-strong outline-none focus:shadow-ring";

/** An employer as Screen 1's employer picker names it. */
export const employerLabel = (employer: Employer) => employer.nameLatin ?? employer.nameJa;

/**
 * The review screen opens IMMEDIATELY on upload, so the document can be read
 * while extraction is still running.
 *
 * A record with at least one project or employer gets a confirmation row
 * first, to file the document under them. `POST /api/imports` takes
 * `projectId` and `employerId`; Screen 8's refile row is what changes them
 * afterwards (`docs/06`, 2026-09-21 and 2026-09-28). The employer is how a
 * per-employer portfolio is filed once rather than fact by fact. A record with
 * neither imports on the file choice alone, and a select is left out of the
 * row when its only option would be the default: a question with one answer is
 * not a question.
 */
export function useImportPicker() {
  const input = useRef<HTMLInputElement>(null);
  const start = useStartImport();
  const navigate = useNavigate();
  const readProjects = useEntitiesOnDemand<Project>("projects");
  const readEmployers = useEntitiesOnDemand<Employer>("employers");
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<{ file: File; projects: Project[]; employers: Employer[] } | null>(
    null,
  );
  const [projectId, setProjectId] = useState("");
  const [employerId, setEmployerId] = useState("");

  const send = async (file: File, filing: { projectId?: string; employerId?: string } = {}) => {
    try {
      const created = await start.mutateAsync({ file, ...filing });
      setChosen(null);
      await navigate({ to: "/imports/$importId", params: { importId: created.importId } });
    } catch (caught) {
      setChosen(null);
      setError(failureText(caught));
    }
  };

  const control = (
    <input
      ref={input}
      type="file"
      accept={IMPORT_ACCEPT}
      className="hidden"
      onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        setError(null);
        // Asked for, not read off the render: the row is offered or skipped on
        // what the server actually holds, never on a query mid-flight.
        let projects: Project[];
        let employers: Employer[];
        try {
          [projects, employers] = await Promise.all([
            readProjects().then((read) => read.items),
            readEmployers().then((read) => read.items),
          ]);
        } catch {
          // Importing anyway would file the document under nothing with no sign
          // that a choice was skipped. A blocked import costs one retry; a
          // wrongly filed one costs a trip to Screen 8 to refile it.
          setError(
            "Your projects and employers could not be read, so this document was not imported. Try again.",
          );
          return;
        }
        if (projects.length === 0 && employers.length === 0) return send(file);
        setProjectId("");
        setEmployerId("");
        setChosen({ file, projects, employers });
      }}
    />
  );

  const confirmation = chosen ? (
    <div className="flex items-center gap-12 border border-border-control rounded-control px-14 py-10">
      <Chip>{chosen.file.name}</Chip>
      {chosen.projects.length > 0 ? (
        <label className="flex items-center gap-8 text-smaller text-text-dim">
          File it under
          <select
            className={SELECT_CONTROL}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">No project</option>
            {chosen.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {chosen.employers.length > 0 ? (
        <label className="flex items-center gap-8 text-smaller text-text-dim">
          Employer
          <select
            className={SELECT_CONTROL}
            value={employerId}
            onChange={(event) => setEmployerId(event.target.value)}
          >
            <option value="">No employer</option>
            {chosen.employers.map((employer) => (
              <option key={employer.id} value={employer.id}>
                {employerLabel(employer)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <span className="ml-auto flex items-center gap-8">
        <Button variant="bare" onClick={() => setChosen(null)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() =>
            void send(chosen.file, { projectId: projectId || undefined, employerId: employerId || undefined })
          }
          disabled={start.isPending}
          disabledReason={start.isPending ? "Importing…" : undefined}
        >
          Import
        </Button>
      </span>
    </div>
  ) : null;

  return { control, confirmation, error, choose: () => input.current?.click() };
}

export function ImportDropTarget({ className = "" }: { className?: string }) {
  const importFile = useImportPicker();
  return (
    <div className={`border border-dashed border-border-dashed rounded-panel px-20 py-32 text-center ${className}`}>
      <div className="mx-auto size-32 rounded-tile bg-chip" aria-hidden />
      <p className="mt-14 text-row font-medium text-text-strong">Import your first document</p>
      <p className="mt-6 text-smaller text-text-dim">Choose a Markdown or plain text file.</p>
      {importFile.control}
      <div className="mt-16">
        <Button variant="primary" onClick={importFile.choose} className="px-16 py-8">
          Choose a file
        </Button>
      </div>
      {importFile.confirmation ? <div className="mt-16 text-left">{importFile.confirmation}</div> : null}
      {importFile.error ? (
        <p role="alert" className="mt-14 text-small text-text-secondary">
          {importFile.error}
        </p>
      ) : null}
    </div>
  );
}
