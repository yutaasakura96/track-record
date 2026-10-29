/**
 * What a downloaded file is called: `Kenji-Moriyama-Resume-2026-10-27.pdf`.
 *
 * One ASCII pattern for every download — the person's name, what the document
 * is, the day it is dated, then the extension — so a folder of them sorts by
 * person and reads as what each file is. ASCII only: the name goes in a
 * `content-disposition` header, so accents are folded and anything else
 * outside it is dropped. A Japanese document's own name is Japanese
 * (`japaneseFilename` in `./japanese.ts`) and travels with this one beside it.
 */

/** `Kenji-Moriyama` for `Kenji Moriyama`; empty when the name has no ASCII letters left. */
export function asciiNamePart(nameLatin: string): string {
  return nameLatin
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[\s-]+/)
    .map((part) => part.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean)
    .join("-");
}

/** What a render kind is called in a file name: `Career-Story-EN` for `career_story_en`, `Rirekisho` for `rirekisho`. */
export const kindLabel = (kind: string): string =>
  kind
    .split("_")
    .map((part) => (part === "en" || part === "ja" ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("-");

/** `Kenji-Moriyama-Resume-2026-10-27.pdf`; the name is left out when the profile has none. */
export function documentFilename(label: string, nameLatin: string, date: string, extension: string): string {
  const name = asciiNamePart(nameLatin);
  return `${name ? `${name}-` : ""}${label}-${date}.${extension}`;
}

/** The day in Tokyo, `2026-10-27`, for an instant. */
export const tokyoDay = (at: Date): string => new Date(at.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
