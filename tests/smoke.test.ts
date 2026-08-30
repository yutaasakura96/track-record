/**
 * The critical path, end to end (`docs/11-testing-plan.md` §2.9).
 *
 * It exists to catch WIRING BREAKAGE, which every other test is blind to: a
 * route not mounted, the auth middleware misconfigured, the download endpoint
 * returning JSON instead of a file.
 *
 * **What this is not.** §2.9 specifies Playwright, driving the built SPA against
 * a running Worker with a stubbed OIDC provider. That is not built here — see
 * `docs/06`, 2026-08-30. This runs the same path through the real Hono app,
 * with only the session resolver and the model seam stubbed, so it covers every
 * listed failure except the two that need a browser: static assets not being
 * served, and the SPA failing to mount.
 */
import { describe, expect, it } from "vitest";
import { harness, settle, stubModel } from "./helpers/harness";
import { EMPLOYER_FIXTURE, PROFILE_FIXTURE, seedAllowedUser, uploadForm } from "./helpers/seed";

const CASE_STUDY = `# Meridian nightly settlement

The overnight settlement job had grown to eight hours and regularly overran into
the business day.

Rewriting the row-by-row loop as a set-based update cut the overnight settlement
job from eight hours to fifty minutes.
`;

const QUOTE = "cut the overnight settlement\njob from eight hours to fifty minutes.";

describe("sign-in through an accepted résumé version", () => {
  it("walks the whole path and downloads a .docx", async () => {
    const model = stubModel();
    const app = harness(model);
    const user = await seedAllowedUser();

    // 1 · Signed out, the API says so and nothing else is reachable.
    expect((await app.anonymous().get("/api/overview")).status).toBe(401);
    expect((await app.anonymous().get("/api/auth/session")).status).toBe(401);

    // 2 · Signed in, and the session probe agrees.
    const client = app.as(user);
    const session = await client.get("/api/auth/session");
    expect(session.status).toBe(200);

    // 3 · No profile yet — the 404 is what sends the client to the form.
    expect((await client.get("/api/profile")).status).toBe(404);
    expect((await client.put("/api/profile", PROFILE_FIXTURE)).status).toBe(200);

    // 4 · An empty record explains itself, with import as the only action.
    const empty = await client.json<{ isEmpty: boolean; documents: { status: string }[] }>(
      "/api/overview",
    );
    expect(empty.isEmpty).toBe(true);
    expect(empty.documents.every((d) => d.status === "never_generated")).toBe(true);

    await client.post("/api/employers", EMPLOYER_FIXTURE);

    // 5 · Import one case study.
    model.extractions = [
      [
        {
          claim: "Cut the overnight settlement job from eight hours to fifty minutes",
          quote: QUOTE,
          technologies: ["PostgreSQL"],
        },
      ],
    ];
    const started = await client.request("/api/imports", {
      method: "POST",
      body: uploadForm(CASE_STUDY, "meridian-settlement.md"),
    });
    expect(started.status).toBe(202);
    const { importId } = (await started.json()) as { importId: string };
    await settle();

    const status = await client.json<{ status: string; candidatesExtracted: number }>(
      `/api/imports/${importId}`,
    );
    expect(status.status).toBe("ready");
    expect(status.candidatesExtracted).toBe(1);

    // 6 · Review it: promote, disclose, accept.
    const { items } = await client.json<{ items: { id: string }[] }>(
      `/api/facts?importId=${importId}`,
    );
    const fact = items[0]!;
    await client.patch(`/api/facts/${fact.id}`, { provenance: "measured", disclosure: "public" });
    expect((await client.post(`/api/facts/${fact.id}/accept`)).status).toBe(200);
    expect(
      ((await (await client.post(`/api/imports/${importId}/finish`)).json()) as {
        acceptedFacts: number;
      }).acceptedFacts,
    ).toBe(1);

    // 7 · Generate the English résumé from the accepted facts alone.
    model.generations = [
      {
        sections: [
          {
            key: "experience",
            heading: "Experience",
            blocks: [
              {
                id: "blk_1",
                kind: "bullet",
                text: "Cut overnight settlement runtime from eight hours to fifty minutes",
                factIds: [fact.id],
              },
            ],
          },
        ],
      },
    ];
    const generation = await client.post("/api/renders/english_resume/generate");
    expect(generation.status).toBe(202);
    const { proposalId } = (await generation.json()) as { proposalId: string };
    await settle();

    // 8 · Read it as a diff against nothing, with a rationale on every change.
    const proposal = await client.json<{ generationStatus: string; unchanged: boolean }>(
      `/api/proposals/${proposalId}`,
    );
    expect(proposal.generationStatus).toBe("ready");
    expect(proposal.unchanged).toBe(false);

    const diff = await client.json<{
      additions: number;
      changes: { rationale: { text: string; factIds: string[] } }[];
    }>(`/api/proposals/${proposalId}/diff`);
    expect(diff.additions).toBe(1);
    expect(diff.changes[0]!.rationale.factIds).toContain(fact.id);

    // 9 · Accept it.
    const accepted = (await (
      await client.post(`/api/proposals/${proposalId}/accept`)
    ).json()) as { newVersionNo: number };
    expect(accepted.newVersionNo).toBe(1);

    // 10 · Download the .docx. A real zip, with the Word MIME type, of a
    //      non-trivial length — the assertion §2.9 names.
    const download = await client.get("/api/renders/english_resume/download?format=docx");
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const bytes = new Uint8Array(await download.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(1000);
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    // And the overview now reports a document that is up to date.
    const finished = await client.json<{ documents: { kind: string; status: string }[] }>(
      "/api/overview",
    );
    expect(finished.documents.find((d) => d.kind === "english_resume")!.status).toBe("up_to_date");
  });
});
