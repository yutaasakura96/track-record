/**
 * The MCP server (`docs/specs/mcp-spike.md`), driven through a real MCP client
 * over an in-memory transport. The record is seeded through the HTTP routes the
 * app uses, so what the tools read is what the screens wrote.
 *
 * Every value is INVENTED.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { and, eq } from "drizzle-orm";
import { harness, settle, stubModel, type Client, type StubModel } from "./helpers/harness";
import { EMPLOYER_FIXTURE, PROFILE_FIXTURE, ROLE_FIXTURE, seedAllowedUser, uploadForm } from "./helpers/seed";
import { createTrackRecordServer } from "~/mcp/server";
import { buildGenerationPrompt } from "~/model/generate";
import { factFlags, facts, renderProposals } from "~/server/db/schema";
import type { Db } from "~/server/db/client";

const SOURCE = [
  "Nightly batch runtime fell from 6 hours to 90 minutes.",
  "The team adopted trunk-based development that quarter.",
  "Latency on the public tracking route dropped after the rewrite.",
  "The ledger schema for the client was named acme_settlement_v2.",
  "Deploy frequency rose from monthly to twice a week after the pipeline rebuild.",
].join("\n\n");

interface Fact {
  id: string;
  claim: string;
}

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

let model: StubModel;
let client: Client;
let db: Db;
let userId: string;
let mcp: McpClient;

async function connect(forUser: string): Promise<McpClient> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createTrackRecordServer(db, forUser).connect(serverSide);
  const c = new McpClient({ name: "test", version: "0" });
  await c.connect(clientSide);
  return c;
}

async function call(name: string, args: Record<string, unknown> = {}, as = mcp) {
  const result = (await as.callTool({ name, arguments: args })) as ToolResult;
  const text = result.content[0]?.text ?? "";
  return {
    isError: result.isError === true,
    text,
    json: <T>() => JSON.parse(text) as T,
  };
}

beforeEach(async () => {
  model = stubModel();
  const h = harness(model);
  db = h.db;
  const user = await seedAllowedUser();
  userId = user.id;
  client = h.as(user);
  await client.put("/api/profile", PROFILE_FIXTURE);
  mcp = await connect(userId);
});

/**
 * Four accepted facts, one per gate: Measured/Public and Attested/Restricted
 * render, Generated/Public and Measured/Private do not.
 */
async function seedRecord() {
  const employer = (await (await client.post("/api/employers", EMPLOYER_FIXTURE)).json()) as { id: string };
  // An English résumé's job header needs a title, so the job holds a role.
  await client.post("/api/roles", { ...ROLE_FIXTURE, employerId: employer.id });
  model.extractions = [
    [
      { claim: "Cut nightly batch runtime from 6 hours to 90 minutes", quote: "Nightly batch runtime fell from 6 hours to 90 minutes.", technologies: ["Airflow"] },
      { claim: "Introduced trunk-based development", quote: "The team adopted trunk-based development that quarter.", technologies: [] },
      { claim: "Improved public route latency", quote: "Latency on the public tracking route dropped after the rewrite.", technologies: [] },
      { claim: "Owned the client settlement ledger schema", quote: "The ledger schema for the client was named acme_settlement_v2.", technologies: ["PostgreSQL"] },
    ],
  ];
  const created = (await (
    await client.request("/api/imports", { method: "POST", body: uploadForm(SOURCE) })
  ).json()) as { importId: string };
  await settle();

  const { items } = await client.json<{ items: Fact[] }>(`/api/facts?importId=${created.importId}`);
  const byClaim = (fragment: string) => items.find((f) => f.claim.includes(fragment))!;
  const measuredPublic = byClaim("nightly batch");
  const attestedRestricted = byClaim("trunk-based");
  const generatedPublic = byClaim("route latency");
  const measuredPrivate = byClaim("settlement ledger");

  await client.patch(`/api/facts/${measuredPublic.id}`, { provenance: "measured", disclosure: "public" });
  await client.patch(`/api/facts/${attestedRestricted.id}`, { provenance: "attested", disclosure: "restricted" });
  await client.patch(`/api/facts/${generatedPublic.id}`, { disclosure: "public" });
  await client.patch(`/api/facts/${measuredPrivate.id}`, { provenance: "measured", disclosure: "private" });
  for (const fact of [measuredPublic, attestedRestricted, generatedPublic, measuredPrivate]) {
    await client.post(`/api/facts/${fact.id}/accept`);
  }

  const sources = await call("list_sources");
  const sourceDocumentId = sources.json<{ items: { id: string }[] }>().items[0]!.id;
  return { measuredPublic, attestedRestricted, generatedPublic, measuredPrivate, sourceDocumentId };
}

/** The shape `tests/renders.test.ts` generates a résumé in. */
const resume = (blocks: { text: string; factIds: string[] }[]) => ({
  sections: [{ key: "projects", heading: "Projects", blocks: blocks.map((b) => ({ kind: "bullet", ...b })) }],
});

describe("tools", () => {
  it("lists every tool", async () => {
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "add_application", "add_fact", "capture_facts", "explain_flag", "get_instructions", "get_record",
        "get_source", "grade_facts", "list_applications", "list_flags", "list_sources", "list_waiting_facts",
        "save_render", "story_part", "tailor_document",
      ].sort(),
    );
  });
});

describe("get_record", () => {
  it("returns render-eligible facts only, and counts what it withheld", async () => {
    const seeded = await seedRecord();
    const result = await call("get_record", { document: "english_resume" });
    expect(result.isError).toBe(false);

    const record = result.json<{
      facts: { id: string }[];
      spec: { subjectName: string; employers: { name: string }[] };
      withheld: { private: number; generated: number };
    }>();
    const ids = record.facts.map((f) => f.id).sort();
    expect(ids).toEqual([seeded.measuredPublic.id, seeded.attestedRestricted.id].sort());
    expect(record.withheld).toEqual({ private: 1, generated: 1, overBudget: 0 });
    expect(record.spec.subjectName).toBe(PROFILE_FIXTURE.nameLatin);
    // The generator's own brief, not a paraphrase of it.
    expect(result.json<{ instructions: string }>().instructions).toBe(buildGenerationPrompt(record.spec as never));

    // The Private fact's claim is nowhere in the payload, not merely unlisted.
    expect(result.text).not.toContain("settlement ledger");
    expect(result.text).not.toContain("route latency");
    // Restricted profile PII is never selected into the spec.
    expect(result.text).not.toContain(PROFILE_FIXTURE.address);
    expect(result.text).not.toContain(PROFILE_FIXTURE.phone);
  });

  it("is refused without the profile fields the document needs", async () => {
    const bare = await seedAllowedUser();
    const result = await call("get_record", { document: "english_resume" }, await connect(bare.id));
    expect(result.isError).toBe(true);
  });
});

describe("add_fact", () => {
  it("accepts a verbatim-quoted fact with its grade, anchored to its line, never Public", async () => {
    const { sourceDocumentId } = await seedRecord();
    const quote = "Deploy frequency rose from monthly to twice a week after the pipeline rebuild.";
    const result = await call("add_fact", {
      claim: "Raised deploy frequency from monthly to twice weekly",
      quote,
      source_document_id: sourceDocumentId,
      technologies: ["GitHub Actions"],
      grade: { provenance: "measured" },
    });
    expect(result.isError).toBe(false);
    const added = result.json<{ id: string; lineNumber: number }>();
    expect(added.lineNumber).toBe(9);

    const [row] = await db
      .select()
      .from(facts)
      .where(and(eq(facts.userId, userId), eq(facts.id, added.id)));
    // The importer's rule (`docs/06`, 2026-10-08): accepted with its grade, Restricted at most.
    expect(row).toMatchObject({ status: "accepted", provenance: "measured", disclosure: "restricted", quote });
    expect(SOURCE.slice(row!.quoteStart!, row!.quoteEnd!)).toBe(quote);

    // Usable by the next document without having been opened.
    const record = (await call("get_record", { document: "english_resume" })).json<{ facts: { id: string }[] }>();
    expect(record.facts.map((f) => f.id)).toContain(added.id);
  });

  it("keeps an ungraded fact Generated and flags it, and a confidential one Private", async () => {
    const { sourceDocumentId } = await seedRecord();
    const ungraded = (await call("add_fact", {
      claim: "Rebuilt the deploy pipeline",
      quote: "Deploy frequency rose from monthly to twice a week after the pipeline rebuild.",
      source_document_id: sourceDocumentId,
    })).json<{ id: string; provenance: string; flags: string[] }>();
    expect(ungraded.provenance).toBe("generated");
    expect(ungraded.flags).toContain("unsure");
    const stored = await db
      .select({ kind: factFlags.kind })
      .from(factFlags)
      .where(and(eq(factFlags.userId, userId), eq(factFlags.factId, ungraded.id)));
    expect(stored.map((f) => f.kind)).toContain("unsure");

    const confidential = (await call("add_fact", {
      claim: "Owned the settlement ledger",
      quote: "The ledger schema for the client was named acme_settlement_v2.",
      source_document_id: sourceDocumentId,
      grade: { provenance: "measured", confidential: true },
    })).json<{ disclosure: string }>();
    expect(confidential.disclosure).toBe("private");
  });

  it("refuses a quote that is not verbatim and stores nothing", async () => {
    const { sourceDocumentId } = await seedRecord();
    const before = await db.select({ id: facts.id }).from(facts).where(eq(facts.userId, userId));

    // One character off: "twice-a-week" for "twice a week".
    const result = await call("add_fact", {
      claim: "Raised deploy frequency",
      quote: "Deploy frequency rose from monthly to twice-a-week after the pipeline rebuild.",
      source_document_id: sourceDocumentId,
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/does not appear verbatim/);

    const after = await db.select({ id: facts.id }).from(facts).where(eq(facts.userId, userId));
    expect(after).toHaveLength(before.length);
  });

  it("refuses a fact that repeats one already in the record", async () => {
    const { sourceDocumentId, measuredPublic } = await seedRecord();
    // Different whitespace and case: the dedupe normalisation is forgiving.
    const result = await call("add_fact", {
      claim: "  cut nightly batch runtime from 6 hours to 90 minutes ",
      quote: "Nightly batch runtime fell from 6 hours to 90 minutes.",
      source_document_id: sourceDocumentId,
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain(measuredPublic.id);
  });

  it("cannot reach another user's source document", async () => {
    const { sourceDocumentId } = await seedRecord();
    const other = await connect((await seedAllowedUser()).id);
    for (const [tool, args] of [
      ["get_source", { source_document_id: sourceDocumentId }],
      [
        "add_fact",
        {
          claim: "Anything",
          quote: "Nightly batch runtime fell from 6 hours to 90 minutes.",
          source_document_id: sourceDocumentId,
        },
      ],
    ] as const) {
      const result = await call(tool, args, other);
      expect(result.isError).toBe(true);
      expect(result.text).toMatch(/not found/);
    }
  });
});

describe("save_render", () => {
  it("lands a proposal the author accepts through the app's own route", async () => {
    const seeded = await seedRecord();
    const result = await call("save_render", {
      document: "english_resume",
      content: resume([
        { text: "Cut nightly batch runtime from 6 hours to 90 minutes.", factIds: [seeded.measuredPublic.id] },
        { text: "Introduced trunk-based development.", factIds: [seeded.attestedRestricted.id] },
      ]),
    });
    expect(result.isError).toBe(false);
    const { proposalId } = result.json<{ proposalId: string }>();

    const accepted = await client.post(`/api/proposals/${proposalId}/accept`);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ renderKind: "english_resume", newVersionNo: 1 });

    const { items } = await client.json<{ items: { kind: string; status: string }[] }>("/api/renders");
    expect(items.find((r) => r.kind === "english_resume")?.status).toBe("up_to_date");
  });

  it.each(["measuredPrivate", "generatedPublic"] as const)(
    "refuses content citing the %s fact and stores nothing",
    async (which) => {
      const seeded = await seedRecord();
      const result = await call("save_render", {
        document: "english_resume",
        content: resume([
          { text: "Cut nightly batch runtime.", factIds: [seeded.measuredPublic.id] },
          { text: "A withheld line.", factIds: [seeded[which].id] },
        ]),
      });
      expect(result.isError).toBe(true);
      expect(result.text).toContain(seeded[which].id);

      const proposals = await db
        .select({ id: renderProposals.id })
        .from(renderProposals)
        .where(eq(renderProposals.userId, userId));
      expect(proposals).toHaveLength(0);
    },
  );

  it("holds the content to the generator's own checks", async () => {
    const seeded = await seedRecord();
    // An English résumé written in Japanese is the generator's `japanese` defect (issue #104).
    const result = await call("save_render", {
      document: "english_resume",
      content: resume([{ text: "夜間バッチの実行時間を6時間から90分に短縮した。", factIds: [seeded.measuredPublic.id] }]),
    });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Nothing was stored/);
  });

  it("refuses citing a fact the document was not given", async () => {
    await seedRecord();
    const result = await call("save_render", {
      document: "english_resume",
      content: resume([{ text: "Did something.", factIds: ["fct_not_in_this_record"] }]),
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("fct_not_in_this_record");
  });

  it("refuses a second proposal while one is waiting", async () => {
    const seeded = await seedRecord();
    const content = resume([{ text: "Cut nightly batch runtime.", factIds: [seeded.measuredPublic.id] }]);
    expect((await call("save_render", { document: "english_resume", content })).isError).toBe(false);
    const second = await call("save_render", { document: "english_resume", content });
    expect(second.isError).toBe(true);
    expect(second.text).toMatch(/proposal waiting/);
  });
});

describe("story_part", () => {
  /** A part with one block per chapter it asks for, citing the first fact it may use. */
  const writePart = (next: { chapters: string[]; facts: { id: string }[] }, names: Map<string, string> = new Map()) => ({
    sections: next.chapters.map((key) => ({
      key,
      // An employer chapter is headed with the employer's name as the record holds it.
      heading: names.get(key.replace(/^employer:/, "")) ?? key,
      blocks: [
        {
          kind: key === "anchors" || key === "routing" ? "row" : "paragraph",
          text: `Invented text for ${key}.`,
          factIds: next.facts.slice(0, 1).map((f) => f.id),
        },
      ],
    })),
  });

  interface Step {
    complete: boolean;
    next: { chapters: string[]; facts: { id: string }[]; instructions: string } | string;
    story_so_far: { sections: { key: string; blocks: { id: string }[] }[] };
  }

  it("walks the generator's parts in order, then saves the whole story as a proposal", async () => {
    await seedRecord();
    const record = (await call("get_record", { document: "career_story_en" })).json<{
      writeInParts: boolean;
      spec: { employers: { id: string; name: string }[] };
    }>();
    expect(record.writeInParts).toBe(true);
    const names = new Map(record.spec.employers.map((e) => [e.id, e.name]));

    let step = (await call("story_part", { document: "career_story_en" })).json<Step>();
    const asked: string[][] = [];
    while (!step.complete) {
      const next = step.next as Exclude<Step["next"], string>;
      expect(next.instructions).toContain("This story is written in parts");
      asked.push(next.chapters);
      const result = await call("story_part", { document: "career_story_en", story_so_far: step.story_so_far, part: writePart(next, names) });
      expect(result.isError, result.text).toBe(false);
      step = result.json<Step>();
    }

    // Employer chapters first, the closing tables last, as `writeStoryRound` orders them.
    expect(asked[0]!.every((key) => key.startsWith("employer:"))).toBe(true);
    expect(asked.at(-1)).toEqual(["anchors", "routing"]);
    const ids = step.story_so_far.sections.flatMap((s) => s.blocks.map((b) => b.id));
    expect(new Set(ids).size).toBe(ids.length);

    const saved = await call("save_render", { document: "career_story_en", content: step.story_so_far });
    expect(saved.isError, saved.text).toBe(false);
  });

  it("refuses a part with the wrong chapters, or citing a fact not given for it, and keeps the story as it was", async () => {
    await seedRecord();
    const first = (await call("story_part", { document: "career_story_en" })).json<Step>();
    const next = first.next as Exclude<Step["next"], string>;

    const wrong = await call("story_part", {
      document: "career_story_en",
      part: { sections: [{ key: "anchors", heading: "Anchors", blocks: [{ kind: "row", text: "x", factIds: [] }] }] },
    });
    expect(wrong.isError).toBe(true);
    expect(wrong.text).toContain("Write this part again");

    const part = writePart(next);
    part.sections[0]!.blocks[0]!.factIds = ["fct_not_given"];
    const stray = await call("story_part", { document: "career_story_en", part });
    expect(stray.isError).toBe(true);
    expect(stray.text).toContain("fct_not_given");
  });

  it("is refused for a document that is not a story", async () => {
    await seedRecord();
    const result = await call("story_part", { document: "english_resume" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("not a career story");
  });
});
