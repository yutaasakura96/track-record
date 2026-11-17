/**
 * The MCP server's tools for the model seam's other jobs (`src/mcp/jobs.ts`):
 * each stores through the function its route uses, and none calls the model.
 * Driven through a real MCP client over an in-memory transport.
 *
 * Every value is INVENTED.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { and, eq } from "drizzle-orm";
import { harness, settle, stubModel, type Client, type StubModel } from "./helpers/harness";
import { asCandidates, EMPLOYER_FIXTURE, PROFILE_FIXTURE, SECOND_EMAIL, seedAllowedUser, uploadForm } from "./helpers/seed";
import { createTrackRecordServer } from "~/mcp/server";
import { CAPTURE_SYSTEM_PROMPT } from "~/model/capture";
import { EXPLAIN_SYSTEM_PROMPT } from "~/model/explain";
import { EXTRACTION_SYSTEM_PROMPT } from "~/model/extract";
import { GRADING_SYSTEM_PROMPT } from "~/model/grade";
import { READ_POSTING_SYSTEM_PROMPT } from "~/model/posting";
import { applications, factFlags, facts } from "~/server/db/schema";
import type { Db } from "~/server/db/client";

const POSTING = [
  "Kestrel Freight K.K. is hiring a Senior Platform Engineer.",
  "Required: five years running Kubernetes in production; Terraform; on-call experience.",
].join("\n");

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

let model: StubModel;
let app: ReturnType<typeof harness>;
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
  return { isError: result.isError === true, text, json: <T>() => JSON.parse(text) as T };
}

beforeEach(async () => {
  model = stubModel();
  app = harness(model);
  db = app.db;
  const user = await seedAllowedUser();
  userId = user.id;
  client = app.as(user);
  await client.put("/api/profile", PROFILE_FIXTURE);
  mcp = await connect(userId);
});

afterEach(() => {
  // Every job here is done by the caller. None of them is a model call.
  expect(model.postingCalls).toEqual([]);
  expect(model.captureCalls).toEqual([]);
  expect(model.explainCalls).toEqual([]);
  expect(model.gradeCalls).toEqual([]);
});

/** One imported source with the given passages, each read as a fact. */
async function imported(passages: { claim: string; quote: string }[]) {
  model.extractions = [passages.map((p) => ({ ...p, technologies: [] }))];
  const text = `# Notes\n\n${passages.map((p) => p.quote).join("\n\n")}\n`;
  const { importId } = (await (
    await client.request("/api/imports", { method: "POST", body: uploadForm(text, "kestrel-notes.md") })
  ).json()) as { importId: string };
  await settle();
  return importId;
}

describe("get_instructions", () => {
  it("gives each job the app's own system prompt", async () => {
    const prompts = {
      extract: EXTRACTION_SYSTEM_PROMPT,
      read_posting: READ_POSTING_SYSTEM_PROMPT,
      capture: CAPTURE_SYSTEM_PROMPT,
      explain_flag: EXPLAIN_SYSTEM_PROMPT,
      grade: GRADING_SYSTEM_PROMPT,
    };
    for (const [job, prompt] of Object.entries(prompts)) {
      const result = await call("get_instructions", { job });
      expect(result.isError).toBe(false);
      const body = result.json<{ instructions: string; then: string }>();
      expect(body.instructions).toBe(prompt);
      expect(body.then.length).toBeGreaterThan(0);
    }
  });

  it("gives capture the employers to match names against, by id", async () => {
    const employer = (await (await client.post("/api/employers", EMPLOYER_FIXTURE)).json()) as { id: string };
    const body = (await call("get_instructions", { job: "capture" })).json<{ employers: { id: string; name: string }[]; today: string }>();
    expect(body.employers).toEqual([{ id: employer.id, name: `${EMPLOYER_FIXTURE.nameJa} / ${EMPLOYER_FIXTURE.nameLatin}` }]);
    expect(body.today).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("a posting read into an application and a tailored résumé", () => {
  it("adds the application, tailors a résumé toward it, and hands get_record its posting", async () => {
    const added = await call("add_application", {
      company: "Kestrel Freight K.K.",
      position: "Senior Platform Engineer",
      job_description: POSTING,
      requirements: ["Five years running Kubernetes in production", "Terraform"],
    });
    expect(added.isError).toBe(false);
    const { application_id } = added.json<{ application_id: string }>();

    const detail = await client.json<{ company: string; requirements: string[] }>(`/api/applications/${application_id}`);
    expect(detail.company).toBe("Kestrel Freight K.K.");
    expect(detail.requirements).toHaveLength(2);

    const tailored = await call("tailor_document", { application_id, kind: "english_resume" });
    expect(tailored.isError).toBe(false);
    const { document, created } = tailored.json<{ document: string; created: boolean }>();
    expect(created).toBe(true);

    const again = (await call("tailor_document", { application_id, kind: "english_resume" })).json<{ document: string; created: boolean }>();
    expect(again).toMatchObject({ document, created: false });

    const listed = (await call("list_applications")).json<{ applications: { id: string; tailored: { document: string }[] }[] }>();
    expect(listed.applications).toEqual([
      expect.objectContaining({ id: application_id, tailored: [{ document, kind: "english_resume" }] }),
    ]);

    const record = await call("get_record", { document });
    expect(record.isError).toBe(false);
    expect(record.text).toContain("Kestrel Freight K.K.");
  });

  it("refuses what the screen refuses, in the route's words, and stores nothing", async () => {
    const empty = await call("add_application", { company: " ", position: "Engineer", job_description: POSTING });
    expect(empty.isError).toBe(true);
    expect(empty.text).toContain("Give it a company.");

    const link = await call("add_application", { company: "Kestrel", position: "Engineer", job_description: POSTING, posting_url: "ftp://x" });
    expect(link.isError).toBe(true);
    expect(link.text).toContain("https://");

    expect(await db.select().from(applications).where(eq(applications.userId, userId))).toEqual([]);
  });

  it("does not tailor another user's application", async () => {
    const other = app.as(await seedAllowedUser(SECOND_EMAIL));
    const theirs = (await (
      await other.post("/api/applications", { company: "Kestrel", position: "Engineer", jobDescription: POSTING })
    ).json()) as { id: string };

    const result = await call("tailor_document", { application_id: theirs.id, kind: "english_resume" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not found/i);
  });
});

describe("capture_facts", () => {
  it("saves the confirmed claims as accepted, Attested facts with their month and employer", async () => {
    const employer = (await (await client.post("/api/employers", EMPLOYER_FIXTURE)).json()) as { id: string };
    const result = await call("capture_facts", {
      claims: [{ claim: "Ran the on-call rotation for the routing team", month: "2026-03", employer_id: employer.id }],
    });
    expect(result.isError).toBe(false);
    const [saved] = result.json<{ saved: { id: string }[] }>().saved;

    const [row] = await db.select().from(facts).where(and(eq(facts.userId, userId), eq(facts.id, saved!.id)));
    expect(row).toMatchObject({
      status: "accepted",
      provenance: "attested",
      quote: null,
      occurredOn: "2026-03-01",
      employerId: employer.id,
    });
    expect(row!.gradedAt).not.toBeNull();
  });

  it("refuses another user's employer and stores nothing", async () => {
    const other = app.as(await seedAllowedUser(SECOND_EMAIL));
    const theirs = (await (await other.post("/api/employers", EMPLOYER_FIXTURE)).json()) as { id: string };

    const result = await call("capture_facts", { claims: [{ claim: "Ran the on-call rotation", employer_id: theirs.id }] });
    expect(result.isError).toBe(true);
    expect(await db.select().from(facts).where(eq(facts.userId, userId))).toEqual([]);
  });
});

describe("flags", () => {
  it("lists an open flag with its fact, and stores the explanation Claude wrote once", async () => {
    await imported([{ claim: "Improved route latency", quote: "Latency on the tracking route dropped after the rewrite." }]);
    const { flags } = (await call("list_flags")).json<{ flags: { id: string; kind: string; explanation: string | null; fact: { quote: string } }[] }>();
    expect(flags.length).toBeGreaterThan(0);
    const flag = flags[0]!;
    expect(flag.explanation).toBeNull();
    expect(flag.fact.quote).toBe("Latency on the tracking route dropped after the rewrite.");

    const explained = await call("explain_flag", { flag_id: flag.id, explanation: "The importer was unsure the claim is yours." });
    expect(explained.isError).toBe(false);

    const listing = await client.json<{ items: { id: string; explanation: string | null }[] }>("/api/flags");
    expect(listing.items.find((item) => item.id === flag.id)?.explanation).toBe("The importer was unsure the claim is yours.");

    const twice = await call("explain_flag", { flag_id: flag.id, explanation: "Something else." });
    expect(twice.isError).toBe(true);
    expect(twice.text).toContain("already explained");
  });

  it("does not explain another user's flag", async () => {
    const otherUser = await seedAllowedUser(SECOND_EMAIL);
    const other = app.as(otherUser);
    model.extractions = [[{ claim: "Improved route latency", quote: "Latency dropped.", technologies: [] }]];
    await other.request("/api/imports", { method: "POST", body: uploadForm("# Notes\n\nLatency dropped.\n", "n.md") });
    await settle();
    const [theirs] = await db.select({ id: factFlags.id }).from(factFlags).where(eq(factFlags.userId, otherUser.id));

    const result = await call("explain_flag", { flag_id: theirs!.id, explanation: "Mine now." });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not found/i);
  });
});

describe("grading the facts that were waiting", () => {
  it("accepts every waiting fact with the grade given, kept Private when confidential", async () => {
    const importId = await imported([
      { claim: "Cut batch runtime from 6 hours to 90 minutes", quote: "Batch runtime fell from 6 hours to 90 minutes." },
      { claim: "Owned the client ledger schema", quote: "The client ledger schema was ours." },
    ]);
    await asCandidates(importId);

    const listed = (await call("list_waiting_facts")).json<{ facts: { id: string; claim: string }[]; waiting: number }>();
    expect(listed.waiting).toBe(2);
    const id = (fragment: string) => listed.facts.find((f) => f.claim.includes(fragment))!.id;

    const result = await call("grade_facts", {
      grades: [
        { id: id("batch runtime"), provenance: "measured", confidential: false, unsure: false },
        { id: id("ledger"), provenance: "attested", confidential: true, unsure: false, note: "It names a client." },
      ],
    });
    expect(result.isError).toBe(false);
    expect(result.json()).toMatchObject({ graded: 2, waiting: 0 });

    const rows = await db.select().from(facts).where(eq(facts.userId, userId));
    const row = (fragment: string) => rows.find((r) => r.claim.includes(fragment))!;
    expect(row("batch runtime")).toMatchObject({ status: "accepted", provenance: "measured" });
    expect(row("ledger")).toMatchObject({ status: "accepted", provenance: "attested", disclosure: "private" });
  });

  it("refuses a fact that is not waiting, and grades nothing", async () => {
    const importId = await imported([{ claim: "Cut batch runtime", quote: "Batch runtime fell." }]);
    const [accepted] = await db.select({ id: facts.id }).from(facts).where(eq(facts.sourceDocumentVersionId, importId));

    const result = await call("grade_facts", { grades: [{ id: accepted!.id, provenance: "measured", confidential: false, unsure: false }] });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("not waiting");
  });
});
