/**
 * The English résumé's PDF as a file (issue #109): what a reader gets when they
 * select and copy it, and where it sits on the page. Run inside workerd, the
 * runtime the download is served from. Every entry is INVENTED.
 */
import { describe, expect, it } from "vitest";
import { extractText, extractTextItems, getDocumentProxy } from "unpdf";
import { resumePdf } from "~/render/resume-pdf";
import type { ResumeDocument } from "~/render/resume";

const METADATA = { title: "Zoë Łukasiewicz-Ångström – Résumé", author: "Zoë Łukasiewicz-Ångström" };

const LONG =
  "Rebuilt the efficient offline-first fulfilment workflow for the office fleet, cutting the official " +
  "reconciliation run from four hours to twenty minutes across three warehouses and two carriers.";

function documentWith(jobs: number): ResumeDocument {
  return {
    name: "Zoë Łukasiewicz-Ångström",
    headline: "Staff Engineer, Logistics Platforms",
    contact: ["Kraków, Poland", "zoe@example.invalid", "github.com/zoe-example"],
    sections: [
      { key: "summary", heading: "Summary", blocks: [{ kind: "paragraph", text: "Platform engineer for freight." }] },
      {
        key: "skills",
        heading: "Skills",
        blocks: [{ kind: "labelled", label: "Languages", text: "TypeScript, Go, SQL" }],
      },
      {
        key: "experience",
        heading: "Experience",
        blocks: Array.from({ length: jobs }, (_, job) => [
          { kind: "entry" as const, lead: `Employer ${job + 1} Sp. z o.o.`, detail: "Wrocław", dates: "Jan 2020 – Present" },
          { kind: "subtitle" as const, text: "Senior Engineer (Jan 2020 – Present)" },
          ...Array.from({ length: 5 }, (_, n) => ({ kind: "bullet" as const, text: `${job + 1}.${n + 1} ${LONG}` })),
        ]).flat(),
      },
    ],
  };
}

const textOf = async (bytes: Uint8Array) =>
  (await extractText(bytes.slice(), { mergePages: true })).text.replace(/\s+/g, " ");

describe("the résumé PDF", () => {
  it("copies back letter for letter: accents, and the words a ligature would have swallowed", async () => {
    const text = await textOf(await resumePdf(documentWith(1), "a4", METADATA));
    expect(text).toContain("Zoë Łukasiewicz-Ångström");
    expect(text).toContain("Kraków, Poland · zoe@example.invalid · github.com/zoe-example");
    expect(text).toContain("Employer 1 Sp. z o.o. · Wrocław");
    // `ffi`, `fi`, `fl` and `ff`: Carlito sets each as one glyph unless told not to.
    expect(text).toContain(`1.1 ${LONG}`);
    expect(text).toContain("Languages: TypeScript, Go, SQL");
  });

  it("runs onto further pages in reading order, inside the margins", async () => {
    const bytes = await resumePdf(documentWith(4), "letter", METADATA);
    const { totalPages, items } = await extractTextItems(bytes.slice());
    expect(totalPages).toBeGreaterThan(1);

    const text = await textOf(bytes);
    const bullets = [...text.matchAll(/(\d)\.(\d) Rebuilt/g)].map((m) => `${m[1]}.${m[2]}`);
    expect(bullets).toEqual(Array.from({ length: 20 }, (_, i) => `${Math.floor(i / 5) + 1}.${(i % 5) + 1}`));

    // 15.5 mm margins on Letter (612 × 792 pt), with a point of slack for glyph overhang.
    const margin = 879 / 20;
    for (const item of items.flat().filter((i) => i.str.trim() !== "")) {
      expect(item.x).toBeGreaterThanOrEqual(margin - 1);
      expect(item.x + item.width).toBeLessThanOrEqual(612 - margin + 1);
      expect(item.y).toBeGreaterThanOrEqual(margin - 1);
      expect(item.y).toBeLessThanOrEqual(792 - margin);
    }
  });

  it("never leaves a job's header at the foot of a page without its first line", async () => {
    const { items } = await extractTextItems((await resumePdf(documentWith(6), "a4", METADATA)).slice());
    for (const page of items) {
      const printed = page.filter((i) => i.str.trim() !== "");
      const foot = Math.min(...printed.map((i) => i.y));
      for (const item of printed.filter((i) => Math.abs(i.y - foot) < 1)) {
        expect(item.str).not.toMatch(/^Employer \d|^Senior Engineer|^E|^Jan 2020/);
      }
    }
  });

  it("keeps headings and entry–subtitle chains with their short following blocks", async () => {
    const doc: ResumeDocument = {
      name: "Ada Example",
      headline: null,
      contact: [],
      sections: [
        ...Array.from({ length: 14 }, (_, index) => ({
          key: `section-${index}`,
          heading: `Section ${String(index).padStart(2, "0")}`,
          blocks: [{ kind: "paragraph" as const, text: `Start${index} ${LONG} ${LONG.slice(0, 70)} End${index}` }],
        })),
        {
          key: "experience",
          heading: "Experience",
          blocks: Array.from({ length: 14 }, (_, index) => [
            { kind: "entry" as const, lead: `Employer${String(index).padStart(2, "0")}`, detail: null, dates: "Jan 2020 – Present" },
            { kind: "subtitle" as const, text: `Role${index}` },
            { kind: "bullet" as const, text: `Outcome${index} ${LONG} ${LONG.slice(0, 70)}` },
          ]).flat(),
        },
      ],
    };
    const { totalPages, items } = await extractTextItems((await resumePdf(doc, "a4", METADATA)).slice());
    expect(totalPages).toBeGreaterThan(2);
    const pages = items.map((page) => page.map((item) => item.str).join("").replace(/\s/g, ""));
    for (let index = 0; index < 14; index++) {
      const headingPage = pages.findIndex((text) => text.includes(`SECTION${String(index).padStart(2, "0")}`));
      expect(headingPage).toBeGreaterThanOrEqual(0);
      expect(pages[headingPage]).toContain(`End${index}`);

      const entryPage = pages.findIndex((text) => text.includes(`Employer${String(index).padStart(2, "0")}`));
      expect(entryPage).toBeGreaterThanOrEqual(0);
      expect(pages[entryPage]).toContain(`Role${index}`);
      expect(pages[entryPage]).toContain(`Outcome${index}`);
    }
  });

  it("wraps an oversized URL without losing characters or crossing the margins", async () => {
    const url = `https://example.invalid/portfolio/${"abcdefghij".repeat(90)}`;
    const doc = documentWith(1);
    doc.contact = [url];
    const bytes = await resumePdf(doc, "letter", METADATA);
    const copied = (await extractText(bytes.slice(), { mergePages: true })).text;
    expect(copied.replace(/\s/g, "")).toContain(url);

    const { items } = await extractTextItems(bytes.slice());
    const margin = 879 / 20;
    for (const item of items.flat().filter((item) => item.str.trim() !== "")) {
      expect(item.x).toBeGreaterThanOrEqual(margin - 1);
      expect(item.x + item.width).toBeLessThanOrEqual(612 - margin + 1);
    }
  });

  it("is tagged, so a reader that goes by position still reads a job's dates with its header", async () => {
    const pdf = await getDocumentProxy((await resumePdf(documentWith(1), "a4", METADATA)).slice());
    expect((await pdf.getMarkInfo())?.Marked).toBe(true);

    interface Node { role?: string; type?: string; children?: Node[] }
    const roles = (node: Node): string[] =>
      (node.children ?? []).flatMap((child) => (child.role ? [child.role, ...roles(child)] : []));
    const tree = (await (await pdf.getPage(1)).getStructTree()) as Node;
    const document = tree.children![0]!;
    expect(document.role).toBe("Document");
    // Name, headline, contact; then each heading and what is under it, in order.
    expect(roles(document).slice(0, 12)).toEqual(["H1", "P", "P", "H2", "P", "H2", "P", "H2", "P", "P", "L", "LI"]);
    expect(roles(document).filter((role) => role === "LBody")).toHaveLength(5);
  });
});
