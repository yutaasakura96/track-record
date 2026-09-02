/**
 * The critical path, end to end (`docs/11-testing-plan.md` §2.9).
 *
 * It exists to catch WIRING BREAKAGE, which every other test is blind to: a
 * route not mounted, the auth middleware misconfigured, the download endpoint
 * returning JSON instead of a file.
 *
 * **Sign-in is real** (issue #3). The session resolver is no longer stubbed:
 * the walk starts at `POST /api/auth/sign-in/social`, goes through a local OIDC
 * issuer run as a fixture, comes back through Better Auth's own callback, and
 * carries the session cookie the callback sets. The model seam is still stubbed
 * — no test calls Anthropic (`docs/11` §1).
 *
 * **What this is not.** §2.9 specifies Playwright, driving the built SPA against
 * a running Worker. That is not built here — see `docs/06`, 2026-08-30. This
 * runs the same path through the real Hono app, so it covers every listed
 * failure except the two that need a browser: static assets not being served,
 * and the SPA failing to mount.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { harness, settle, stubModel } from "./helpers/harness";
import { installIssuer, type FixtureIssuer } from "./helpers/oidc";
import { AUTHOR_EMAIL, EMPLOYER_FIXTURE, PROFILE_FIXTURE, uploadForm } from "./helpers/seed";

let issuer: FixtureIssuer;

beforeAll(async () => {
  issuer = await installIssuer();
});

afterAll(() => issuer.uninstall());

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
    const app = harness(model, { realSessions: true });

    // 1 · Signed out, the API says so and nothing else is reachable.
    expect((await app.anonymous().get("/api/overview")).status).toBe(401);
    expect((await app.anonymous().get("/api/auth/session")).status).toBe(401);

    // 2 · Sign in for real: the redirect out, the issuer, the callback back.
    const walk = await app.signIn(issuer, {
      sub: "104729183746501928374",
      email: AUTHOR_EMAIL,
      name: "Test Author",
    });
    expect(walk.callback.status).toBe(302);
    expect(walk.location).toBe("/");
    expect(issuer.tokenRequests).toBe(1);

    // EXACTLY THREE SCOPES, AND NEVER MORE (`src/server/auth.ts`). The issuer
    // is the only place this can be observed as the provider actually sent it.
    expect([...walk.authorization.scopes].sort()).toEqual(["email", "openid", "profile"]);

    // 3 · The session probe agrees, and the identity is the one that signed in.
    const client = walk.client;
    const session = await client.json<{ user: { email: string } }>("/api/auth/session");
    expect(session.user.email).toBe(AUTHOR_EMAIL);

    // 4 · No profile yet — the 404 is what sends the client to the form.
    expect((await client.get("/api/profile")).status).toBe(404);
    expect((await client.put("/api/profile", PROFILE_FIXTURE)).status).toBe(200);

    // 5 · An empty record explains itself, with import as the only action.
    const empty = await client.json<{ isEmpty: boolean; documents: { status: string }[] }>(
      "/api/overview",
    );
    expect(empty.isEmpty).toBe(true);
    expect(empty.documents.every((d) => d.status === "never_generated")).toBe(true);

    await client.post("/api/employers", EMPLOYER_FIXTURE);

    // 6 · Import one case study.
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

    // 7 · Review it: promote, disclose, accept.
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

    // 8 · Generate the English résumé from the accepted facts alone.
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

    // 9 · Read it as a diff against nothing, with a rationale on every change.
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

    // 10 · Accept it.
    const accepted = (await (
      await client.post(`/api/proposals/${proposalId}/accept`)
    ).json()) as { newVersionNo: number };
    expect(accepted.newVersionNo).toBe(1);

    // 11 · Download the .docx. A real zip, with the Word MIME type, of a
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
