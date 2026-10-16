/**
 * Importing NEW documents: the file picker, its confirmation list of one row
 * per file with that file's project and employer, and the empty-state drop
 * target.
 *
 * Shared by Screen 3 and Screen 8 (`docs/10`) as one component rather than two
 * copies, so the types the drop target names cannot drift between them.
 */
import { useRef, useState, type DragEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  failureText,
  useEntitiesOnDemand,
  useImportStatus,
  useStartImport,
  type Employer,
  type Project,
} from "../api";
import { IMPORT_ACCEPT, importRefusal } from "~/shared/import-file";
import { Button, Chip, Dot } from "./ui";

export { IMPORT_ACCEPT };

/**
 * Matches the entity forms on Screen 4. Exported because Screen 8's refile row
 * asks the same question with the same control, and two copies of a control
 * class drift.
 */
export const SELECT_CONTROL =
  "min-h-control bg-surface-raised border border-border-control rounded-control px-10 py-8 text-ui text-text-strong outline-none focus:shadow-ring";

/** An employer as Screen 1's employer picker names it. */
export const employerLabel = (employer: Employer) => employer.nameLatin ?? employer.nameJa;

/** One chosen file, from the moment it is chosen to the moment it is read. */
interface Row {
  key: number;
  file: File;
  projectId: string;
  employerId: string;
  /** Why it is not sent, said before anything is: its type or its size. Or the server's reason. */
  refusal: string | null;
  /** Set once `POST /api/imports` has answered for it. */
  importId: string | null;
  sending: boolean;
}

interface Chosen {
  rows: Row[];
  projects: Project[];
  employers: Employer[];
  /** `Import` was pressed: the rows now say where each import stands. */
  sent: boolean;
}

let nextKey = 0;

/**
 * Several files may be chosen at once, and each becomes its own import (`docs/09`
 * Flow 8, #93). The server reads them one at a time, in the order they are
 * sent, which is the order they are listed.
 *
 * A record with at least one project or employer gets a confirmation list
 * first, one row per file, to file each under them. `POST /api/imports` takes
 * `projectId` and `employerId`; Screen 8's refile row is what changes them
 * afterwards (`docs/06`, 2026-09-21 and 2026-09-28). Each file's employer is
 * its own, because the portfolios sit in several employers' folders. A select
 * is left out when its only option would be the default: a question with one
 * answer is not a question.
 *
 * One file, with nothing to file it under, imports on the choice alone, and the
 * review screen opens IMMEDIATELY on upload so the document can be read while
 * extraction is still running.
 */
export function useImportPicker() {
  const input = useRef<HTMLInputElement>(null);
  const start = useStartImport();
  const navigate = useNavigate();
  const readProjects = useEntitiesOnDemand<Project>("projects");
  const readEmployers = useEntitiesOnDemand<Employer>("employers");
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);

  const update = (key: number, change: Partial<Row>) =>
    setChosen((current) =>
      current ? { ...current, rows: current.rows.map((row) => (row.key === key ? { ...row, ...change } : row)) } : null,
    );

  const open = async (files: File[]) => {
    if (files.length === 0) return;
    setError(null);
    const rows: Row[] = files.map((file) => ({
      key: nextKey++,
      file,
      projectId: "",
      employerId: "",
      // Refused here, on its own row, before anything is sent. The others go ahead.
      refusal: importRefusal(file),
      importId: null,
      sending: false,
    }));
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
        files.length === 1
          ? "Your projects and employers could not be read, so this document was not imported. Try again."
          : "Your projects and employers could not be read, so these documents were not imported. Try again.",
      );
      return;
    }
    const only = rows.length === 1 ? rows[0]! : null;
    if (only && projects.length === 0 && employers.length === 0) {
      if (only.refusal) return setError(only.refusal);
      return void sendOne(only.file);
    }
    setChosen({ rows, projects, employers, sent: false });
  };

  /** The single file: Fact Review opens on it, as it always has. */
  const sendOne = async (file: File, filing: { projectId?: string; employerId?: string } = {}) => {
    try {
      const created = await start.mutateAsync({ file, ...filing });
      setChosen(null);
      await navigate({ to: "/imports/$importId", params: { importId: created.importId } });
    } catch (caught) {
      setChosen(null);
      setError(failureText(caught));
    }
  };

  const filing = (row: Row) => ({
    projectId: row.projectId || undefined,
    employerId: row.employerId || undefined,
  });

  // One at a time and in the listed order: the server reads them in the order
  // they arrive. A file the server refuses says so on its row and stops none
  // of the others.
  const sendAll = async (rows: Row[]) => {
    const going = rows.filter((row) => !row.refusal);
    if (rows.length === 1 && going.length === 1) return sendOne(going[0]!.file, filing(going[0]!));
    setChosen((current) => (current ? { ...current, sent: true } : null));
    for (const row of going) {
      update(row.key, { sending: true });
      try {
        const created = await start.mutateAsync({ file: row.file, ...filing(row) });
        update(row.key, { sending: false, importId: created.importId });
      } catch (caught) {
        update(row.key, { sending: false, refusal: failureText(caught) });
      }
    }
  };

  const control = (
    <input
      ref={input}
      type="file"
      multiple
      accept={IMPORT_ACCEPT}
      className="hidden"
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        void open(files);
      }}
    />
  );

  const confirmation = chosen ? (
    <ImportList
      chosen={chosen}
      busy={chosen.rows.some((row) => row.sending)}
      onChange={update}
      onRemove={(key) =>
        setChosen((current) => {
          const rows = current?.rows.filter((row) => row.key !== key) ?? [];
          return current && rows.length > 0 ? { ...current, rows } : null;
        })
      }
      onCancel={() => setChosen(null)}
      onImport={() => void sendAll(chosen.rows)}
    />
  ) : null;

  return { control, confirmation, error, choose: () => input.current?.click(), drop: open };
}

function ImportList({
  chosen,
  busy,
  onChange,
  onRemove,
  onCancel,
  onImport,
}: {
  chosen: Chosen;
  busy: boolean;
  onChange: (key: number, change: Partial<Row>) => void;
  onRemove: (key: number) => void;
  onCancel: () => void;
  onImport: () => void;
}) {
  const { rows, projects, employers, sent } = chosen;
  const going = rows.filter((row) => !row.refusal).length;
  return (
    <section
      aria-label={rows.length === 1 ? "Import a document" : "Import documents"}
      className="border border-border-control rounded-control"
    >
      <ul>
        {rows.map((row) => (
          <li
            key={row.key}
            aria-label={row.file.name}
            className="flex flex-wrap items-center gap-12 px-14 py-10 border-b border-border-inner"
          >
            <Chip>{row.file.name}</Chip>
            {sent ? (
              <span className="ml-auto">
                <Standing row={row} />
              </span>
            ) : row.refusal ? (
              <p className="text-smaller text-removed">{row.refusal}</p>
            ) : (
              <>
                {projects.length > 0 ? (
                  <label className="flex items-center gap-8 text-smaller text-text-dim">
                    File it under
                    <select
                      className={SELECT_CONTROL}
                      value={row.projectId}
                      onChange={(event) => onChange(row.key, { projectId: event.target.value })}
                    >
                      <option value="">No project</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {employers.length > 0 ? (
                  <label className="flex items-center gap-8 text-smaller text-text-dim">
                    Employer
                    <select
                      className={SELECT_CONTROL}
                      value={row.employerId}
                      onChange={(event) => onChange(row.key, { employerId: event.target.value })}
                    >
                      <option value="">No employer</option>
                      {employers.map((employer) => (
                        <option key={employer.id} value={employer.id}>
                          {employerLabel(employer)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </>
            )}
            {/* One file is the whole list: `Cancel` already takes it out. */}
            {!sent && rows.length > 1 ? (
              <Button
                variant="bare"
                className="ml-auto"
                aria-label={`Remove ${row.file.name}`}
                onClick={() => onRemove(row.key)}
              >
                Remove
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-8 px-14 py-10">
        {sent ? (
          <>
            <p className="text-smaller text-text-dim">
              Read one at a time, in this order. You can leave this page and it carries on.
            </p>
            <Button
              variant="bare"
              className="ml-auto"
              onClick={onCancel}
              disabled={busy}
              disabledReason={busy ? "Still sending the files." : undefined}
            >
              Close
            </Button>
          </>
        ) : (
          <span className="ml-auto flex items-center gap-8">
            <Button variant="bare" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={onImport}
              disabled={busy || going === 0}
              disabledReason={busy ? "Importing…" : going === 0 ? "None of these files can be imported." : undefined}
            >
              Import
            </Button>
          </span>
        )}
      </div>
    </section>
  );
}

/** Where one sent file stands: refused, being sent, waiting, reading, done or failed. */
function Standing({ row }: { row: Row }) {
  const line = "flex items-center gap-6 text-small whitespace-nowrap";
  if (row.refusal) return <span className="text-smaller text-removed">{row.refusal}</span>;
  if (!row.importId) {
    return (
      <span className={`${line} text-text-muted`}>
        <Dot tone="muted" /> {row.sending ? "Sending…" : "Waiting to be sent"}
      </span>
    );
  }
  return <ImportStanding importId={row.importId} />;
}

function ImportStanding({ importId }: { importId: string }) {
  const status = useImportStatus(importId);
  const line = "flex items-center gap-6 text-small whitespace-nowrap";
  const data = status.data;
  if (!data || data.status === "queued") {
    return (
      <span className={`${line} text-text-muted`}>
        <Dot tone="muted" /> Waiting
      </span>
    );
  }
  if (data.status === "extracting") {
    const percent =
      data.chunksTotal > 0 ? Math.min(99, Math.floor((data.chunksDone / data.chunksTotal) * 100)) : null;
    return (
      <span className={`${line} text-accent-text`}>
        <Dot tone="accent" /> Reading{percent === null ? "" : ` · ${percent}%`}
      </span>
    );
  }
  if (data.status === "failed") {
    return (
      <span className="flex items-center gap-6 text-smaller text-removed">
        <Dot tone="removed" /> Failed · {data.error?.message ?? "This import could not be completed."} Retry it
        from Documents.
      </span>
    );
  }
  const n = data.candidatesExtracted;
  return (
    <span className="flex items-center gap-12">
      <span className={`${line} text-measured-text`}>
        <Dot tone="measured" /> Done · {n} {n === 1 ? "fact" : "facts"}
      </span>
      <Link
        to="/imports/$importId"
        params={{ importId }}
        className="text-small text-accent-link hover:text-accent-link-hover motion-tone whitespace-nowrap"
      >
        Review
      </Link>
    </span>
  );
}

export function ImportDropTarget({ className = "" }: { className?: string }) {
  const importFile = useImportPicker();
  const [over, setOver] = useState(false);
  const files = (event: DragEvent) => Array.from(event.dataTransfer?.files ?? []);
  return (
    <div
      className={`border border-dashed rounded-panel px-20 py-32 text-center ${over ? "border-accent bg-hover" : "border-border-dashed"} ${className}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        void importFile.drop(files(event));
      }}
    >
      <div className="mx-auto size-32 rounded-tile bg-chip" aria-hidden />
      <p className="mt-14 text-row font-medium text-text-strong">Import your first document</p>
      <p className="mt-6 text-smaller text-text-dim">
        Choose a Markdown or plain text file, or several, or drop them here.
      </p>
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
