/**
 * Logs never contain record content (`docs/11-testing-plan.md` §2.8).
 *
 * Otherwise the logs become a second, un-governed copy of NDA-bound client
 * material sitting in Cloudflare's log retention. Log IDs and counts only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harness, settle, stubModel, type Client, type StubModel } from "./helpers/harness";
import { PROFILE_FIXTURE, seedAllowedUser, uploadForm } from "./helpers/seed";
import { ModelUnavailableError } from "~/model/types";

/** Invented, and each string distinctive enough to find in a log line. */
const SOURCE = [
  "The overnight reconciliation job at Meridian Freight took eight hours.",
  "The internal host was fileshare-hq-07 at 10.24.6.19.",
].join("\n\n");

const CLAIM = "Cut the overnight reconciliation job from eight hours to fifty minutes";
const RENDER_TEXT = "Cut overnight reconciliation from eight hours to fifty minutes";

let model: StubModel;
let client: Client;
let captured: string[];

beforeEach(async () => {
  captured = [];
  for (const method of ["log", "error", "warn", "info", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      captured.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
  model = stubModel();
  client = harness(model).as(await seedAllowedUser());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a run that imports, generates and fails a model call", () => {
  it("writes no source text, fact claim, quote or render content to the log", async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);

    model.extractions = [
      [
        {
          claim: CLAIM,
          quote: "The overnight reconciliation job at Meridian Freight took eight hours.",
          technologies: ["PostgreSQL"],
        },
        // Discarded: not verbatim. Its content must not reach the log either.
        {
          claim: "Ran the estate on fileshare-hq-07",
          quote: "The internal host was fileshare-hq-07 at 10.24.6.20.",
          technologies: [],
        },
      ],
    ];

    const imported = (await (
      await client.request("/api/imports", { method: "POST", body: uploadForm(SOURCE) })
    ).json()) as { importId: string };
    await settle();

    const { items } = await client.json<{ items: { id: string }[] }>(
      `/api/facts?importId=${imported.importId}`,
    );
    await client.patch(`/api/facts/${items[0]!.id}`, {
      provenance: "measured",
      disclosure: "public",
    });
    await client.post(`/api/facts/${items[0]!.id}/accept`);

    // A generation that succeeds…
    model.generations = [
      {
        sections: [
          {
            key: "experience",
            heading: "Experience",
            blocks: [{ id: "blk_1", kind: "bullet", text: RENDER_TEXT, factIds: [items[0]!.id] }],
          },
        ],
      },
    ];
    const proposal = (await (
      await client.post("/api/renders/english_resume/generate")
    ).json()) as { proposalId: string };
    await settle();
    await client.post(`/api/proposals/${proposal.proposalId}/accept`);
    await client.get("/api/renders/english_resume/download?format=docx");

    // …and one that fails.
    model.generations = [new ModelUnavailableError("The model service returned 529.")];
    await client.post("/api/renders/english_resume/generate");
    await settle();

    // And an import whose model call fails outright.
    model.extractions = [new ModelUnavailableError("The model service returned 529.")];
    await client.request("/api/imports", {
      method: "POST",
      body: uploadForm(SOURCE, "second.md"),
    });
    await settle();

    expect(captured.length).toBeGreaterThan(0);
    const log = captured.join("\n");

    const forbidden = [
      "Meridian Freight", // source text, and a client name
      "fileshare-hq-07", // an internal host, in a discarded candidate
      "10.24.6", // an internal network address
      "overnight reconciliation", // the fact claim and the render content
      "eight hours", // a figure from the source
      "Yosuke Aoki", // the author's own PII
      "東京都渋谷区", // ditto
    ];
    for (const needle of forbidden) {
      expect(log, `a log line contained "${needle}"`).not.toContain(needle);
    }
  });

  it("logs ids and counts, so a failure is still diagnosable", async () => {
    model.extractions = [
      [
        {
          claim: CLAIM,
          quote: "The overnight reconciliation job at Meridian Freight took eight hours.",
          technologies: [],
        },
      ],
    ];
    await client.request("/api/imports", { method: "POST", body: uploadForm(SOURCE) });
    await settle();

    const log = captured.join("\n");
    expect(log).toContain("import_planned");
    expect(log).toContain("import_chunk_done");
    expect(log).toMatch(/"versionId":"sdv_/);
    expect(log).toMatch(/"kept":\d+/);
    expect(log).toMatch(/"discarded":\d+/);
  });
});
