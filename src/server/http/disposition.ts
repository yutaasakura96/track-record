/**
 * The `content-disposition` of a download (RFC 6266).
 *
 * A header carries only ASCII as it stands, so a name with anything else in
 * it — a recording the author named, or a Japanese document's
 * `履歴書_森山健二_20261023.pdf` (issue #117) — travels as `filename*`, UTF-8
 * and percent-encoded as RFC 8187's attr-char allows, with an ASCII
 * `filename` beside it for a client that cannot read the other (RFC 6266
 * §4.3). Browsers take `filename*` when both are present.
 */

const isPlain = (value: string) => /^[\x20-\x7e]*$/.test(value) && !/["\\]/.test(value);

/** Both names, always; `plain` defaults to the name with every other character replaced. */
export function dispositionOf(
  kind: "inline" | "attachment",
  fileName: string,
  // eslint-disable-next-line no-control-regex
  plain = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_"),
): string {
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${plain}"; filename*=UTF-8''${encoded}`;
}

/**
 * A generated document's download: an ASCII name as it always was, and a
 * Japanese one with the ASCII name the document gives for it
 * (`rirekisho_Kenji-Moriyama_20261023.pdf`).
 */
export function attachment(filename: string, asciiFallback: string): string {
  if (isPlain(filename)) return `attachment; filename="${filename}"`;
  return dispositionOf("attachment", filename, isPlain(asciiFallback) && asciiFallback ? asciiFallback : undefined);
}
