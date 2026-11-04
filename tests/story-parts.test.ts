/**
 * A career story written in parts (`docs/06`, 2026-11-04).
 *
 * A story written in one call from a real record ran past the output limit,
 * and the cut-off tool call arrived with no input: the proposal said "unusable
 * shape" after eleven minutes, twice. Each part is now one call — one employer
 * each, then the chapters that belong to no employer written around them, then
 * the two tables written from what the others wrote — and the parts are put
 * back together and held to the whole plan as a story written in one call was.
 *
 * The provider is exercised over a stubbed `fetch` that answers in the API's
 * streaming shape; nothing here reaches the network. Every fixture is invented.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GENERATION_MAX_TOKENS,
  OUTPUT_LIMIT_REASON,
  STORY_CHARACTERS,
  buildGenerationPrompt,
  chaptersOf,
  closingCall,
  employerParts,
  framingCall,
  isStoryComplete,
  writeStoryRound,
} from "~/model/generate";
import { chapterPlan } from "~/render/chapters";
import { createAnthropicSeam } from "~/model/providers/anthropic";
import { ModelUnavailableError, type RenderFact, type RenderSpec } from "~/model/types";
import type { RenderContent } from "~/shared/render-content";

const EMP_A = "emp_kakuu_shouji";
const EMP_B = "emp_kakuu_denki";

const spec = (over: Partial<RenderSpec> = {}): RenderSpec => ({
  kind: "career_story_en",
  language: "en",
  curatedSkills: null,
  jobDescription: null,
  subjectName: "Taro Yamada",
  register: "REGISTER",
  employers: [
    { id: EMP_A, name: "Kakuu Trading Co., Ltd." },
    { id: EMP_B, name: "Kakuu Electric Co., Ltd." },
  ].map((e) => ({
    ...e,
    industry: null,
    startedOn: "2020-04-01",
    endedOn: null,
    businessDescription: null,
    employmentType: "full_time" as const,
    capitalYen: null,
    headcount: null,
    roles: [],
    city: null,
  })),
  projects: [],
  workOutsideEmployment: true,
  desiredRoleNote: null,
  careerGaps: [{ from: "2019-04", to: "2019-09", months: 6, explanation: null }],
  educations: [],
  certifications: [],
  ...over,
});

const fact = (id: string, employerId: string | null): RenderFact => ({
  id,
  claim: `Invented claim ${id}`,
  provenance: "attested",
  disclosure: "public",
  technologies: [],
  ...(employerId ? { employer: { id: employerId, name: employerId, startedOn: "2020-04-01", endedOn: null, industry: null } } : {}),
});

// Employer A is the thick one, B the thin one, and two facts are filed under none.
const FACTS: RenderFact[] = [
  ...Array.from({ length: 12 }, (_, i) => fact(`fct_a${i}`, EMP_A)),
  fact("fct_b0", EMP_B),
  fact("fct_n0", null),
  fact("fct_n1", null),
];

/** What a well-behaved part returns: its own chapters, each citing its own facts. */
function answer(partFacts: RenderFact[], partSpec: RenderSpec): { sections: unknown[] } {
  return {
    sections: chaptersOf(partSpec).map((chapter) => ({
      key: chapter.key,
      heading: `Heading of ${chapter.key}`,
      blocks: [
        {
          kind: ["anchors", "routing"].includes(chapter.key) ? "row" : "paragraph",
          text: `Text of ${chapter.key}`,
          factIds: partFacts
            .filter((f) => (chapter.employerId === null ? true : f.employer?.id === chapter.employerId))
            .slice(0, 2)
            .map((f) => f.id),
        },
      ],
    })),
  };
}

/** Employer chapters as written: A's cites two of its facts, B's its one. */
const EMPLOYER_CHAPTERS: RenderContent = {
  sections: [
    { key: `employer:${EMP_A}`, heading: "At the trading house", blocks: [{ id: "blk_a", kind: "paragraph", text: "Trading text.", factIds: ["fct_a0", "fct_a1"] }] },
    { key: `employer:${EMP_B}`, heading: "At the electric company", blocks: [{ id: "blk_b", kind: "paragraph", text: "Electric text.", factIds: ["fct_b0"] }] },
  ],
};

describe("the parts of a story", () => {
  const parts = employerParts(FACTS, spec());
  const framing = framingCall(FACTS, spec(), EMPLOYER_CHAPTERS)!;

  it("writes each employer alone, and the chapters of no employer together", () => {
    expect(parts.map((p) => p.spec.part!.chapters)).toEqual([[`employer:${EMP_A}`], [`employer:${EMP_B}`]]);
    expect(framing.spec.part!.chapters).toEqual(["opening", "independent", "ahead"]);
  });

  it("sends each employer part only its employer's facts", () => {
    expect(parts[0]!.facts.every((f) => f.employer?.id === EMP_A)).toBe(true);
    expect(parts[0]!.facts).toHaveLength(12);
    expect(parts[1]!.facts.map((f) => f.id)).toEqual(["fct_b0"]);
  });

  it("sends the chapters of no employer the unfiled facts and the employer facts the employer chapters cite, with those chapters", () => {
    expect(framing.facts.map((f) => f.id)).toEqual(["fct_a0", "fct_a1", "fct_b0", "fct_n0", "fct_n1"]);
    expect(framing.spec.part!.written).toEqual(EMPLOYER_CHAPTERS);
  });

  it("still gives the chapters of no employer evidence when nothing is filed under none", () => {
    const filed = FACTS.filter((f) => f.employer);
    const call = framingCall(filed, spec({ workOutsideEmployment: false }), EMPLOYER_CHAPTERS)!;
    expect(call.spec.part!.chapters).toEqual(["opening", "ahead"]);
    expect(call.facts.map((f) => f.id)).toEqual(["fct_a0", "fct_a1", "fct_b0"]);
  });

  it("shares the register's length among the parts, more to the employer with more facts", () => {
    const characters = [...parts, framing].map((p) => p.spec.part!.characters!);
    expect(Math.abs(characters.reduce((a, b) => a + b, 0) - STORY_CHARACTERS.en)).toBeLessThanOrEqual(characters.length);
    expect(characters[0]!).toBeGreaterThan(characters[1]!);
    const ja = spec({ kind: "career_story_ja", language: "ja" });
    const jaParts = [...employerParts(FACTS, ja), framingCall(FACTS, ja, EMPLOYER_CHAPTERS)!];
    expect(jaParts.reduce((sum, p) => sum + p.spec.part!.characters!, 0)).toBeCloseTo(STORY_CHARACTERS.ja, -1);
  });
});

describe("a part's prompt", () => {
  const [thick] = employerParts(FACTS, spec());
  const framing = framingCall(FACTS, spec(), EMPLOYER_CHAPTERS)!;

  it("shows the whole plan, then asks for this part's chapters alone, at this part's length", () => {
    const prompt = buildGenerationPrompt(thick!.spec);
    const whole = prompt.slice(prompt.indexOf("The whole story's chapters"), prompt.indexOf("Chapters this call writes"));
    for (const chapter of chapterPlan("career_story_en", thick!.spec.employers, true)) {
      expect(whole).toContain(`key "${chapter.key}"`);
    }
    const asked = prompt.slice(prompt.indexOf("Chapters this call writes"));
    expect(asked.match(/key "[^"]+"/g)).toEqual([`key "employer:${EMP_A}"`]);
    expect(prompt).toContain(`about ${thick!.spec.part!.characters} characters`);
    expect(prompt).not.toContain("already written");
  });

  it("gives the chapters of no employer the employer chapters as written", () => {
    const prompt = buildGenerationPrompt(framing.spec);
    expect(prompt).toContain("## At the trading house");
    expect(prompt).toContain("Trading text. [fct_a0, fct_a1]");
    expect(prompt).not.toContain("The two tables are written from these chapters");
  });

  it("names the gaps only to the call that writes the routing table", () => {
    const written: RenderContent = { sections: [{ key: "opening", heading: "Where it began", blocks: [{ id: "blk_1", kind: "paragraph", text: "Opening text.", factIds: ["fct_n0"] }] }] };
    expect(buildGenerationPrompt(framing.spec)).not.toContain("Gaps in the 履歴書");
    expect(buildGenerationPrompt(thick!.spec)).not.toContain("Gaps in the 履歴書");
    expect(buildGenerationPrompt(closingCall(FACTS, spec(), written).spec)).toContain("Gaps in the 履歴書");
  });

  it("gives the tables the chapters as written, with the facts they cite and no others", () => {
    const written: RenderContent = {
      sections: [{ key: "opening", heading: "Where it began", blocks: [{ id: "blk_1", kind: "paragraph", text: "Opening text.", factIds: ["fct_n0"] }] }],
    };
    const closing = closingCall(FACTS, spec(), written);
    expect(closing.spec.part!.chapters).toEqual(["anchors", "routing"]);
    expect(closing.facts.map((f) => f.id)).toEqual(["fct_n0"]);
    const prompt = buildGenerationPrompt(closing.spec);
    expect(prompt).toContain("## Where it began");
    expect(prompt).toContain("Opening text. [fct_n0]");
    expect(prompt).toContain("The two tables are written from these chapters");
  });

  it("leaves a story written whole, and every other render, as it was", () => {
    expect(buildGenerationPrompt(spec())).not.toContain("written in parts");
    expect(buildGenerationPrompt(spec())).toContain("Gaps in the 履歴書");
  });
});

describe("writing a story a round at a time", () => {
  it("writes the employers, then the chapters of no employer, then the tables, and the whole passes the plan's check", async () => {
    const rounds: string[][][] = [];
    let story: RenderContent = { sections: [] };
    for (let round = 0; round < 3; round++) {
      const calls: RenderSpec[] = [];
      expect(isStoryComplete(story, spec())).toBe(false);
      story = await writeStoryRound(FACTS, { ...spec(), storySoFar: story }, async (partFacts, partSpec) => {
        calls.push(partSpec);
        return answer(partFacts, partSpec);
      });
      rounds.push(calls.map((c) => c.part!.chapters));
      // The chapters of no employer are written from the employer chapters.
      if (round === 1) expect(calls[0]!.part!.written!.sections.map((s) => s.key)).toEqual([`employer:${EMP_A}`, `employer:${EMP_B}`]);
    }
    expect(rounds).toEqual([
      [[`employer:${EMP_A}`], [`employer:${EMP_B}`]],
      [["opening", "independent", "ahead"]],
      [["anchors", "routing"]],
    ]);
    expect(isStoryComplete(story, spec())).toBe(true);
    expect(story.sections.map((s) => s.key)).toEqual(chapterPlan("career_story_en", spec().employers, true).map((c) => c.key));
    expect(new Set(story.sections.flatMap((s) => s.blocks.map((b) => b.id))).size).toBe(story.sections.length);
  });

  it("refuses a part that returns chapters it was not asked for, and aborts the parts still running", async () => {
    const signals: AbortSignal[] = [];
    const attempt = writeStoryRound(FACTS, spec(), async (_facts, partSpec, signal) => {
      signals.push(signal);
      if (partSpec.part!.chapters[0] === `employer:${EMP_B}`) return { sections: [] };
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    });
    await expect(attempt).rejects.toBeInstanceOf(ModelUnavailableError);
    expect(signals.every((s) => s.aborted)).toBe(true);
  });
});

/* ------------------------------------------------- the provider, over fetch */

/** The API's streaming answer for one forced `emit_render` call. */
function streamed(input: unknown, stopReason: "tool_use" | "max_tokens"): Response {
  const json = input === null ? "" : JSON.stringify(input);
  const events = [
    ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "stub-model", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "emit_render", input: {} } }],
    ...(json ? [["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: json } }]] : []),
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 5 } }],
    ["message_stop", { type: "message_stop" }],
  ] as const;
  const body = events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** The keys a part's prompt asks for, read back out of the request the provider sent. */
function askedKeys(system: string): string[] {
  const asked = system.includes("Chapters this call writes") ? system.slice(system.indexOf("Chapters this call writes")) : system;
  return [...asked.matchAll(/key "([^"]+)"/g)].map((m) => m[1]!);
}

describe("the provider", () => {
  afterEach(() => vi.unstubAllGlobals());

  function answering(respond: (body: { system: { text: string }[]; max_tokens: number; messages: { content: string }[] }) => Response) {
    const requests: { max_tokens: number }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        requests.push(body);
        return respond(body);
      }),
    );
    return { seam: createAnthropicSeam({ apiKey: "test-key-not-real", model: "stub-model" }), requests };
  }

  it("writes a story one round of calls per generateRender, and returns it whole after the last", async () => {
    const { seam, requests } = answering((body) => {
      const keys = askedKeys(body.system[0]!.text);
      const facts = (JSON.parse(body.messages[0]!.content) as { facts: RenderFact[] }).facts;
      return streamed(answer(facts, { ...spec(), part: { chapters: keys, characters: null, written: null } }), "tool_use");
    });
    const sent: number[] = [];
    let content: RenderContent = { sections: [] };
    while (!isStoryComplete(content, spec())) {
      content = await seam.generateRender(FACTS, { ...spec(), storySoFar: content });
      sent.push(requests.length);
    }
    expect(sent).toEqual([2, 3, 4]);
    expect(requests.every((r) => r.max_tokens === GENERATION_MAX_TOKENS)).toBe(true);
    expect(content.sections.map((s) => s.key)).toEqual(chapterPlan("career_story_en", spec().employers, true).map((c) => c.key));
  });

  it("says a document ran out of room, not that it came back in an unusable shape", async () => {
    // The cut-off call: a tool call opened, no input streamed, stopped at the limit.
    const { seam } = answering(() => streamed(null, "max_tokens"));
    const shokumu = spec({ kind: "shokumu_keirekisho", language: "ja", careerGaps: [] });
    await expect(seam.generateRender(FACTS, shokumu)).rejects.toThrow(OUTPUT_LIMIT_REASON);
    await expect(seam.generateRender(FACTS, spec())).rejects.toThrow(OUTPUT_LIMIT_REASON);
  });
});
