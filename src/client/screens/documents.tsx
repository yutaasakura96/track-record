/**
 * Screen 8 — Documents (`docs/10-screen-specifications.md`).
 *
 * Every file the record's facts are quoted from, with every version of it. This
 * is where a re-import starts (Flow 4) and where an import the author walked
 * away from is found again. Names, dates and counts only: source text never
 * appears here.
 *
 * Review state is derived, never stored. `N open` is the count of a version's
 * facts still `candidate`, so an abandoned review and an open one read the same.
 */
import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  failureText,
  isImportRunning,
  useDocuments,
  useEntitiesOnDemand,
  useProfile,
  useRefileDocument,
  useRetryImport,
  useStartImport,
  type DocumentVersion,
  type Project,
  type SourceDocumentRow,
} from "../api";
import { Button, Chip, Mono, ProgressBar } from "../components/ui";
import { Sidebar } from "../components/sidebar";
import {
  IMPORT_ACCEPT,
  ImportDropTarget,
  SELECT_CONTROL,
  useImportPicker,
} from "../components/import-picker";
import { absolute, relative } from "../format";

export function DocumentsScreen() {
  const profile = useProfile();
  const listing = useDocuments();
  // Always a NEW document. A re-import starts only from a document's row.
  const importFile = useImportPicker();

  return (
    <div className="min-h-screen flex">
      <Sidebar name={profile.data?.nameLatin ?? ""} />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-header shrink-0 flex items-center gap-12 px-20 bg-surface border-b border-border">
          <h1 className="text-panel font-semibold tracking-snug text-text-strong">Documents</h1>
          <span className="text-smaller text-text-dimmer">The files your facts are quoted from</span>
          <div className="ml-auto">
            {importFile.control}
            <Button variant="primary" onClick={importFile.choose}>
              Import a document
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-20 py-26">
          <div className="mx-auto w-content max-w-full grid gap-20">
            {importFile.confirmation}
            {importFile.error ? (
              <p role="alert" className="border border-border-control rounded-control px-14 py-12 text-small text-text-secondary">
                {importFile.error}
              </p>
            ) : null}
            <Body listing={listing} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Body({ listing }: { listing: ReturnType<typeof useDocuments> }) {
  if (listing.isError) {
    return (
      <p role="alert" className="text-small text-text-secondary">
        {failureText(listing.error)}
      </p>
    );
  }
  if (!listing.data) return <Skeleton />;
  // Screen 3's drop target, the same component, so the types it names cannot drift.
  if (listing.data.documents.length === 0) return <ImportDropTarget className="mx-auto w-measure max-w-full" />;
  return (
    <>
      {listing.data.documents.map((document) => (
        <DocumentBlock key={document.sourceDocumentId} document={document} />
      ))}
    </>
  );
}

/* ---------------------------------------------------------------- document */

function DocumentBlock({ document }: { document: SourceDocumentRow }) {
  const navigate = useNavigate();
  const start = useStartImport();
  const refile = useRefileDocument();
  const readProjects = useEntitiesOnDemand<Project>("projects");
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<File | null>(null);
  const [refiling, setRefiling] = useState<Project[] | null>(null);
  const [filedUnder, setFiledUnder] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);

  const newest = document.versions[0];
  const count = document.versions.length;

  // Asked for at the moment the row opens, not read off the listing: a select
  // built from a query still in flight would offer `No project` and nothing
  // else, which reads as a record with no projects in it.
  const openRefile = async () => {
    setRefusal(null);
    let projects: Project[];
    try {
      projects = (await readProjects()).items;
    } catch {
      setRefusal("Your projects could not be read. Try again.");
      return;
    }
    if (projects.length === 0 && !document.project) {
      setRefusal("There are no projects to file this document under.");
      return;
    }
    setFiledUnder(document.project?.id ?? "");
    setRefiling(projects);
  };

  const confirmRefile = async () => {
    setRefusal(null);
    try {
      await refile.mutateAsync({
        sourceDocumentId: document.sourceDocumentId,
        projectId: filedUnder || null,
      });
      setRefiling(null);
    } catch (caught) {
      setRefiling(null);
      setRefusal(failureText(caught));
    }
  };

  const confirm = async () => {
    if (!chosen) return;
    setRefusal(null);
    try {
      const created = await start.mutateAsync({ file: chosen, sourceDocumentId: document.sourceDocumentId });
      await navigate({ to: "/imports/$importId", params: { importId: created.importId } });
    } catch (caught) {
      setChosen(null);
      setRefusal(failureText(caught));
    }
  };

  return (
    <section className="bg-surface-raised border border-border rounded-panel">
      <div className="flex items-center gap-12 px-16 py-12 border-b border-border-inner">
        <Chip>{document.filename}</Chip>
        {/*
          The project is the only thing about a document that changes after
          import, so it is the label itself that opens the row rather than a
          sixth control competing with `Re-import` on the right.
        */}
        {document.reimportable ? (
          <Button
            variant="bare"
            className={document.project ? "text-smaller text-text-dim" : "text-smaller text-text-dimmer"}
            aria-label={`File ${document.filename} under a different project`}
            onClick={() => void openRefile()}
          >
            {document.project ? document.project.name : "No project"}
          </Button>
        ) : (
          <span className={document.project ? "text-smaller text-text-dim" : "text-smaller text-text-dimmer"}>
            {document.project?.name ?? "No project"}
          </span>
        )}
        <Mono className="text-text-dimmer">
          {count} {count === 1 ? "version" : "versions"}
        </Mono>
        <span className="text-smaller text-text-dimmer">last imported {relative(document.lastImportedAt)}</span>
        {document.openCandidates > 0 ? (
          <Mono className="text-generated-text">{document.openCandidates} open</Mono>
        ) : null}
        <span className="ml-auto">
          {/* Choosing a file does not upload it: the confirmation line comes first. */}
          <input
            ref={input}
            type="file"
            accept={IMPORT_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setRefusal(null);
              setChosen(file);
            }}
          />
          {document.reimportable || !newest ? (
            <Button variant="ghost" onClick={() => input.current?.click()}>
              Re-import
            </Button>
          ) : (
            <Button disabled disabledReason={`Wait for v${newest.versionNo} to finish extracting.`}>
              Re-import
            </Button>
          )}
        </span>
      </div>

      {refiling ? (
        <div className="flex items-center gap-12 px-16 py-10 border-b border-border-inner">
          <label className="flex items-center gap-8 text-smaller text-text-dim">
            File it under
            <select
              className={SELECT_CONTROL}
              value={filedUnder}
              onChange={(event) => setFiledUnder(event.target.value)}
            >
              <option value="">No project</option>
              {refiling.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-smaller text-text-dimmer">Its facts move with it.</p>
          <span className="ml-auto flex items-center gap-8">
            <Button variant="bare" onClick={() => setRefiling(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void confirmRefile()}
              disabled={refile.isPending || filedUnder === (document.project?.id ?? "")}
              disabledReason={
                refile.isPending
                  ? "Refiling…"
                  : filedUnder === (document.project?.id ?? "")
                    ? "This document is already filed there."
                    : undefined
              }
            >
              Refile
            </Button>
          </span>
        </div>
      ) : null}

      {chosen ? (
        <div className="flex items-center gap-12 px-16 py-10 border-b border-border-inner">
          <div className="min-w-0">
            <p className="text-small text-text-strong">
              This becomes v{(newest?.versionNo ?? 0) + 1} of {document.filename}
            </p>
            {chosen.name !== document.filename ? (
              <p className="mt-4 text-smaller text-text-dim">
                The file is named {chosen.name}. The document keeps its name.
              </p>
            ) : null}
          </div>
          <span className="ml-auto flex items-center gap-8">
            <Button variant="bare" onClick={() => setChosen(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void confirm()}
              disabled={start.isPending}
              disabledReason={start.isPending ? "Importing…" : undefined}
            >
              Import
            </Button>
          </span>
        </div>
      ) : null}

      {refusal ? (
        <p role="alert" className="px-16 py-10 border-b border-border-inner text-smaller text-removed">
          {refusal}
        </p>
      ) : null}

      <ul>
        {document.versions.map((version) => (
          <VersionRow key={version.importId} version={version} />
        ))}
      </ul>
    </section>
  );
}

/* ----------------------------------------------------------------- version */

function VersionRow({ version }: { version: DocumentVersion }) {
  const navigate = useNavigate();
  const retry = useRetryImport();
  const [refusal, setRefusal] = useState<string | null>(null);

  const review = () => void navigate({ to: "/imports/$importId", params: { importId: version.importId } });
  const unchanged = version.status === "ready" && version.changedRegionShare === 0;

  const onRetry = async () => {
    setRefusal(null);
    try {
      await retry.mutateAsync(version.importId);
    } catch (caught) {
      setRefusal(failureText(caught));
    }
  };

  return (
    <li className="border-b border-border-inner last:border-b-0">
      <div className="flex items-center gap-12 pl-40 pr-16 py-10">
        <Mono className="text-text-dim">v{version.versionNo}</Mono>
        <span className="text-smaller text-text-dimmer">imported {absolute(version.importedAt)}</span>
        <Mono className="text-text-dimmer">{version.wordCount} words</Mono>
        <span className="text-smaller text-text-dimmer">
          {changeLabel(version.changedRegionShare)}
        </span>

        <span className="ml-auto flex items-center gap-12">
          <Outcome version={version} unchanged={unchanged} />
          <Action
            version={version}
            unchanged={unchanged}
            retrying={retry.isPending}
            onRetry={() => void onRetry()}
            onReview={review}
          />
        </span>
      </div>
      {refusal ? (
        <p role="alert" className="pl-40 pr-16 pb-10 text-smaller text-removed">
          {refusal}
        </p>
      ) : null}
    </li>
  );
}

/**
 * A share rounded to `0%` would read like `No changes` while still offering
 * `Review`, so anything above zero says so.
 */
function changeLabel(share: number | null) {
  if (share === null) return "first import";
  if (share > 0 && share < 0.005) return "<1% changed";
  return `${Math.round(share * 100)}% changed`;
}

function Action({
  version,
  unchanged,
  retrying,
  onRetry,
  onReview,
}: {
  version: DocumentVersion;
  unchanged: boolean;
  retrying: boolean;
  onRetry: () => void;
  onReview: () => void;
}) {
  if (version.status === "failed") {
    return (
      <Button variant="ghost" onClick={onRetry} disabled={retrying} disabledReason={retrying ? "Retrying…" : undefined}>
        Retry
      </Button>
    );
  }
  if (unchanged) return null;
  return (
    <Button variant="ghost" onClick={onReview}>
      Review
    </Button>
  );
}

function Outcome({ version, unchanged }: { version: DocumentVersion; unchanged: boolean }) {
  if (isImportRunning(version.status)) {
    return (
      <span className="flex items-center gap-8">
        <ProgressBar
          className="w-progress"
          value={version.chunksTotal ? version.chunksDone / version.chunksTotal : 0}
        />
        <Mono className="text-text-dimmer">
          {version.chunksDone} of {version.chunksTotal} chunks
        </Mono>
      </span>
    );
  }
  if (version.status === "failed") {
    return <span className="text-smaller text-removed">{version.error?.message}</span>;
  }
  if (unchanged) {
    return <span className="text-smaller text-text-dim">No changes · nothing to review</span>;
  }
  const { accepted, rejected, open } = version.facts;
  return (
    <Mono className="text-text-dimmer">
      {accepted} accepted · {rejected} rejected ·{" "}
      <span className={open > 0 ? "text-generated-text" : ""}>{open} open</span>
    </Mono>
  );
}

/* ------------------------------------------------------------------ states */

const Skeleton = () => (
  <div aria-busy="true" aria-label="Loading your documents" className="grid gap-20">
    {[0, 1].map((n) => (
      <section key={n} className="bg-surface-raised border border-border rounded-panel px-16 py-14 grid gap-10">
        <span className="h-12 w-label bg-chip rounded-mark" aria-hidden />
        <span className="h-12 w-full bg-chip rounded-mark" aria-hidden />
      </section>
    ))}
  </div>
);
