/**
 * The 職務経歴書's technology lists, bounded in code whatever the model wrote
 * (`src/render/skill-lists.ts`). Pure: no database and no model.
 */
import { describe, expect, it } from "vitest";
import { boundShokumuLists, TECH_STACK_CAP } from "~/render/skill-lists";
import type { RenderContent } from "~/shared/render-content";

const row = (id: string, text: string) => ({ id, kind: "row" as const, text, factIds: [] });
const paragraph = (id: string, text: string) => ({ id, kind: "paragraph" as const, text, factIds: ["f1"] });

const TOOLS = Array.from({ length: 30 }, (_, i) => `Tool${i}`);
const FACTS = [{ technologies: ["Java", "zod", "Zod", "S3", "AWS S3", "Kubernetes", "要件定義", ...TOOLS] }];
const SPEC = { curatedSkills: null, skillShortlist: null, certifications: [] };

const skillsOf = (content: RenderContent) => content.sections.find((s) => s.key === "skills")!.blocks.map((b) => b.text);
const stackOf = (content: RenderContent) => content.sections.find((s) => s.key === "experience")!.blocks.map((b) => b.text);

describe("the skills section", () => {
  it("names each technology once, across every group, however it is spelled", () => {
    const content = { sections: [{ key: "skills", heading: "活かせるスキル・経験", blocks: [
      row("r1", "バックエンド"),
      paragraph("p1", "Java、zod、Zod、AWS S3を用いたAPI設計・開発。"),
      row("r2", "クラウド"),
      paragraph("p2", "S3、Kubernetes、Java。"),
    ] }] };
    expect(skillsOf(boundShokumuLists(content, SPEC, FACTS))).toEqual([
      "バックエンド",
      "Java、zod、AWS S3を用いたAPI設計・開発。",
      "クラウド",
      "S3、Kubernetes。",
    ]);
  });

  it("stops at twenty technologies with nothing curated, and keeps the prose around them", () => {
    const content = { sections: [{ key: "skills", heading: "活かせるスキル・経験", blocks: [
      paragraph("p1", `${TOOLS.join("、")}による業務自動化`),
    ] }] };
    const [text] = skillsOf(boundShokumuLists(content, SPEC, FACTS));
    // The last item is a phrase that contains a technology, not a technology, and stays.
    expect(text).toBe(`${TOOLS.slice(0, 20).join("、")}、Tool29による業務自動化`);
  });

  it("names nothing off the shortlist, but keeps a Japanese skill the record files as a technology", () => {
    const content = { sections: [{ key: "skills", heading: "活かせるスキル・経験", blocks: [
      paragraph("p1", "Java、Kubernetes、要件定義、Tool1。"),
    ] }] };
    const bounded = boundShokumuLists(content, { ...SPEC, skillShortlist: ["Java", "Kubernetes"] }, FACTS);
    expect(skillsOf(bounded)).toEqual(["Java、Kubernetes、要件定義。"]);
  });

  it("never cuts an author's curation, and drops a group it empties along with its label", () => {
    const curated = [{ name: "Tools", nameJa: "ツール", skills: TOOLS }];
    const content = { sections: [{ key: "skills", heading: "活かせるスキル・経験", blocks: [
      row("r1", "ツール"),
      paragraph("p1", TOOLS.join("、")),
      row("r2", "重複"),
      paragraph("p2", "Tool0、Tool1"),
    ] }] };
    expect(skillsOf(boundShokumuLists(content, { ...SPEC, curatedSkills: curated }, FACTS))).toEqual(["ツール", TOOLS.join("、")]);
  });
});

describe("each 技術スタック row", () => {
  it("names each technology once and stops at the cap, keeping its label", () => {
    const content = { sections: [{ key: "experience", heading: "職務経歴", blocks: [
      paragraph("e1", "Harbourline Systems"),
      row("t1", `技術スタック：Java, zod, Zod, S3, AWS S3, ${TOOLS.join(", ")}`),
      row("t2", "事業内容：物流"),
    ] }] };
    const [, stack, business] = stackOf(boundShokumuLists(content, SPEC, FACTS));
    expect(stack).toBe(`技術スタック：${["Java", "zod", "S3", ...TOOLS.slice(0, TECH_STACK_CAP - 3)].join(", ")}`);
    expect(business).toBe("事業内容：物流");
  });

  it("is bounded on its own: a technology in another employer's row is not a repeat", () => {
    const content = { sections: [{ key: "experience", heading: "職務経歴", blocks: [
      row("t1", "技術スタック：Java、Kubernetes"),
      row("t2", "技術スタック：Java、Zod"),
    ] }] };
    expect(stackOf(boundShokumuLists(content, SPEC, FACTS))).toEqual(["技術スタック：Java、Kubernetes", "技術スタック：Java、Zod"]);
  });
});
