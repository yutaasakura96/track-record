/**
 * Importing a NEW document: the file picker, its project confirmation row, and
 * the empty-state drop target.
 *
 * Shared by Screen 3 and Screen 8 (`docs/10`) as one component rather than two
 * copies, so the types the drop target names cannot drift between them.
 */
import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { failureText, useEntitiesOnDemand, useStartImport, type Project } from "../api";
import { Button, Chip } from "./ui";

/** The types that import today (`docs/07` §5). */
export const IMPORT_ACCEPT = ".md,.markdown,.txt";

/**
 * Matches the entity forms on Screen 4. Exported because Screen 8's refile row
 * asks the same question with the same control, and two copies of a control
 * class drift.
 */
export const SELECT_CONTROL =
  "bg-surface-raised border border-border-control rounded-control px-10 py-8 text-ui text-text-strong outline-none focus:shadow-ring";

/**
 * The review screen opens IMMEDIATELY on upload, so the document can be read
 * while extraction is still running.
 *
 * A record with at least one project gets a confirmation row first, to file the
 * document under one. `POST /api/imports` takes `projectId`; Screen 8's refile
 * row is what changes it afterwards (`docs/06`, 2026-09-21). A record with none
 * imports on the file choice alone, because a select offering `No project` and
 * nothing else is a question with one answer.
 */
export function useImportPicker() {
  const input = useRef<HTMLInputElement>(null);
  const start = useStartImport();
  const navigate = useNavigate();
  const readProjects = useEntitiesOnDemand<Project>("projects");
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<{ file: File; projects: Project[] } | null>(null);
  const [projectId, setProjectId] = useState("");

  const send = async (file: File, projectId?: string) => {
    try {
      const created = await start.mutateAsync({ file, projectId });
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
        try {
          projects = (await readProjects()).items;
        } catch {
          // Importing anyway would file the document under nothing with no sign
          // that a choice was skipped. A blocked import costs one retry; a
          // wrongly filed one costs a trip to Screen 8 to refile it.
          setError("Your projects could not be read, so this document was not imported. Try again.");
          return;
        }
        if (projects.length === 0) return send(file);
        setProjectId("");
        setChosen({ file, projects });
      }}
    />
  );

  const confirmation = chosen ? (
    <div className="flex items-center gap-12 border border-border-control rounded-control px-14 py-10">
      <Chip>{chosen.file.name}</Chip>
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
      <span className="ml-auto flex items-center gap-8">
        <Button variant="bare" onClick={() => setChosen(null)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => void send(chosen.file, projectId || undefined)}
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
