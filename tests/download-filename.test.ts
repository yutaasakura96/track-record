/**
 * One file-name pattern for every download: the person's name, the document,
 * the day (`src/render/filename.ts`). Fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { downloadFilename } from "~/render/docx";
import { documentFilename } from "~/render/filename";
import { asciiFilename } from "~/render/japanese";
import { resumeFilename } from "~/render/resume";

const NAME = "Hanako Kakuu";
const DAY = new Date("2026-10-27T03:00:00Z");

describe("a download's name", () => {
  it("carries the person's name on every kind, English or Japanese, in one pattern", () => {
    expect([
      resumeFilename(NAME, "pdf", DAY),
      downloadFilename("career_story_en", NAME, "md", DAY),
      asciiFilename("rirekisho", NAME, "2026-10-27", "pdf"),
      asciiFilename("shokumu_keirekisho", NAME, "2026-10-27", "docx"),
      asciiFilename("career_story_ja", NAME, "2026-10-27", "md"),
    ]).toEqual([
      "Hanako-Kakuu-Resume-2026-10-27.pdf",
      "Hanako-Kakuu-Career-Story-EN-2026-10-27.md",
      "Hanako-Kakuu-Rirekisho-2026-10-27.pdf",
      "Hanako-Kakuu-Shokumu-Keirekisho-2026-10-27.docx",
      "Hanako-Kakuu-Career-Story-JA-2026-10-27.md",
    ]);
  });

  it("dates a résumé and a story by the same day in Tokyo", () => {
    const evening = new Date("2026-10-27T22:30:00Z");
    expect([resumeFilename(NAME, "docx", evening), downloadFilename("career_story_en", NAME, "md", evening)]).toEqual([
      "Hanako-Kakuu-Resume-2026-10-28.docx",
      "Hanako-Kakuu-Career-Story-EN-2026-10-28.md",
    ]);
  });

  it("folds accents, drops what ASCII cannot hold, and leaves the name out when none is left", () => {
    expect(documentFilename("Resume", "Zoë  O'Brien-Smith", "2026-10-10", "md")).toBe("Zoe-OBrien-Smith-Resume-2026-10-10.md");
    expect(documentFilename("Resume", "田辺", "2026-10-10", "docx")).toBe("Resume-2026-10-10.docx");
  });
});
