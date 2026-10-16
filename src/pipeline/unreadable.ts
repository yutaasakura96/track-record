/**
 * A file of a type that imports, which could not be read as one: a damaged
 * `.docx`, a PDF that will not open, a scan with no text. Its message names
 * the reason and is shown to the author as it is (`docs/07` §5).
 */
export class UnreadableDocument extends Error {}
