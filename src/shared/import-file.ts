/**
 * Which files import (`docs/07` §5, `docs/03` §5.1).
 *
 * Read by `POST /api/imports`, which refuses a file before storage and before
 * a single model token is spent, and by the import picker, which refuses the
 * same file on its own row before anything is sent (#93). One rule in one
 * place, so the browser refuses what the server would, in the same words, and
 * the copy that names the types is built from the list that accepts them.
 */

const MiB = 1024 * 1024;

/**
 * The formats that import, in the order the copy names them. A Word or PDF
 * file can carry images the import never reads, so its limit is the larger:
 * the text is what is read, the file is what is kept (`docs/07` §5).
 */
export const IMPORT_FORMATS = [
  { name: "Markdown", extensions: [".md", ".markdown"], mimeType: "text/markdown", maxBytes: 2 * MiB },
  { name: "plain text", extensions: [".txt"], mimeType: "text/plain", maxBytes: 2 * MiB },
  {
    name: "Word",
    extensions: [".docx"],
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    maxBytes: 10 * MiB,
  },
  { name: "PDF", extensions: [".pdf"], mimeType: "application/pdf", maxBytes: 10 * MiB },
] as const;

export type ImportFormat = (typeof IMPORT_FORMATS)[number];

/** The largest file of any type that imports. */
export const MAX_UPLOAD_BYTES = Math.max(...IMPORT_FORMATS.map((format) => format.maxBytes));

/**
 * A set sent together. Every file in it is written in one database request,
 * and that request carries each file twice over, once as hex and once as its
 * text, under Neon's 64 MB limit on a query over HTTP (`docs/07` §5).
 */
export const MAX_BATCH_BYTES = 20 * MiB;

/** The types that import, as the file picker's `accept` names them. */
export const IMPORT_ACCEPT = IMPORT_FORMATS.flatMap((format) => format.extensions).join(",");

const typeNames = (conjunction: "and" | "or") => {
  const names = IMPORT_FORMATS.map((format) => format.name);
  return `${names.slice(0, -1).join(", ")} ${conjunction} ${names.at(-1)}`;
};

/** `Markdown, plain text, Word and PDF`: the types that import, as copy names them. */
export const IMPORT_TYPES_LABEL = typeNames("and");

/** `Markdown, plain text, Word or PDF`: the same, as one to choose. */
export const IMPORT_TYPES_CHOICE = typeNames("or");

const extensionOf = (filename: string) => {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
};

/** The format a filename imports as, or `null` for one that does not. */
export const importFormat = (filename: string): ImportFormat | null => {
  const ext = extensionOf(filename);
  return IMPORT_FORMATS.find((format) => (format.extensions as readonly string[]).includes(ext)) ?? null;
};

const megabytes = (bytes: number) => `${Math.round(bytes / MiB)} MB`;

/**
 * Why a file cannot be imported, or `null` when it can be sent. What is inside
 * it is the server's to find: an empty text, a damaged `.docx`, a scanned PDF.
 * The browser does not read the file.
 */
export function importRefusal(file: { name: string; size: number }): string | null {
  const format = importFormat(file.name);
  if (!format) {
    const ext = extensionOf(file.name);
    // The one near miss worth naming: an older Word file is saved as .docx in one step.
    return ext === ".doc"
      ? `A .doc file cannot be imported. Save it as .docx first. ${IMPORT_TYPES_LABEL} files are supported.`
      : `That file type cannot be imported. ${IMPORT_TYPES_LABEL} files are supported.`;
  }
  if (file.size > format.maxBytes) {
    return `That file is larger than the ${megabytes(format.maxBytes)} limit for ${format.name} files.`;
  }
  if (file.size === 0) return "That file is empty.";
  return null;
}
