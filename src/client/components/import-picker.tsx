/**
 * Importing a NEW document: the file picker and the empty-state drop target.
 *
 * Shared by Screen 3 and Screen 8 (`docs/10`) as one component rather than two
 * copies, so the types the drop target names cannot drift between them.
 */
import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ApiError, useStartImport } from "../api";
import { Button } from "./ui";

/** The types that import today (`docs/07` §5). */
export const IMPORT_ACCEPT = ".md,.markdown,.txt";

/**
 * The review screen opens IMMEDIATELY on upload, so the document can be read
 * while extraction is still running.
 */
export function useImportPicker() {
  const input = useRef<HTMLInputElement>(null);
  const start = useStartImport();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

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
        try {
          const created = await start.mutateAsync({ file });
          await navigate({ to: "/imports/$importId", params: { importId: created.importId } });
        } catch (caught) {
          setError(caught instanceof ApiError ? caught.message : "That file could not be imported.");
        }
      }}
    />
  );

  return { control, error, choose: () => input.current?.click() };
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
      {importFile.error ? (
        <p role="alert" className="mt-14 text-small text-text-secondary">
          {importFile.error}
        </p>
      ) : null}
    </div>
  );
}
