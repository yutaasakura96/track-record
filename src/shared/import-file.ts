/**
 * Which files import (`docs/07` §5, `docs/03` §5.1).
 *
 * Read by `POST /api/imports`, which refuses a file before storage and before
 * a single model token is spent, and by the import picker, which refuses the
 * same file on its own row before anything is sent (#93). One rule in one
 * place, so the browser refuses what the server would, in the same words.
 */

/** 2 MiB. The author's whole corpus is ~2.4 MB; one case study is far smaller. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const MAX_BATCH_BYTES = 95_000_000;

/** The types that import today, as the file picker's `accept` names them. */
export const IMPORT_ACCEPT = ".md,.markdown,.txt";

const ACCEPTED = new Map<string, string>([
  [".md", "text/markdown"],
  [".markdown", "text/markdown"],
  [".txt", "text/plain"],
]);

/** Refused before any work starts, naming the reason (`docs/07` §5). */
const KNOWN_BUT_UNSUPPORTED = new Set([".docx", ".pdf"]);

const extensionOf = (filename: string) => {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
};

/** The stored type of a file that imports, or `null` for one that does not. */
export const importMimeType = (filename: string) => ACCEPTED.get(extensionOf(filename)) ?? null;

/**
 * Why a file cannot be imported, or `null` when it can be sent. Text that is
 * only whitespace is the server's to find: the browser does not read the file.
 */
export function importRefusal(file: { name: string; size: number }): string | null {
  const ext = extensionOf(file.name);
  if (!ACCEPTED.has(ext)) {
    return KNOWN_BUT_UNSUPPORTED.has(ext)
      ? `${ext} import is not built yet. Markdown and plain text are supported.`
      : "That file type cannot be imported. Markdown and plain text are supported.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `That file is larger than the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit.`;
  }
  if (file.size === 0) return "That file is empty.";
  return null;
}
