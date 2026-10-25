/**
 * What a 職務経歴書 generation is sent, and what it stores (issue #117).
 *
 * The prompt-side rules are asserted on hand-built specs in
 * `shokumu-record.test.ts`. This is the route end: that the collector reads
 * the new columns, that a lapsed certification never reaches a Japanese
 * prompt, and that the stored proposal carries the record's 保有資格 and 学歴
 * rather than whatever the model wrote under those keys.
 *
 * Every fixture here is INVENTED. Nothing is sampled from `local/`.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { harness, settle, stubModel, type Client, type Harness, type StubModel } from "./helpers/harness";
import {
  CERTIFICATION_FIXTURE,
  EDUCATION_FIXTURE,
  EMPLOYER_FIXTURE,
  PROFILE_FIXTURE,
  seedAllowedUser,
  uploadForm,
} from "./helpers/seed";
import { renderProposals } from "~/server/db/schema";
import type { RenderContent, RenderKind } from "~/shared/render-content";

const QUOTE = "The nightly batch fell from six hours to ninety minutes.";

const PROJECT = {
  name: "Ledger rebuild",
  nameJa: "台帳の再構築",
  summary: "Rebuilt an update-in-place balance table as an append-only ledger.",
};

let model: StubModel;
let app: Harness;
let userId: string;
let client: Client;
let employerId: string;

beforeEach(async () => {
  model = stubModel();
  app = harness(model);
  const user = await seedAllowedUser();
  userId = user.id;
  client = app.as(user);
  await client.put("/api/profile", PROFILE_FIXTURE);
  ({ id: employerId } = (await (
    await client.post("/api/employers", { ...EMPLOYER_FIXTURE, employmentType: "dispatch" })
  ).json()) as { id: string });
  await client.post("/api/educations", EDUCATION_FIXTURE);
  await client.post("/api/certifications", CERTIFICATION_FIXTURE);
  await client.post("/api/certifications", {
    ...CERTIFICATION_FIXTURE,
    name: "Fictional Cloud Associate",
    nameJa: "架空クラウド認定アソシエイト",
    issuedOn: "2019-03-01",
    expiresOn: "2022-03-01",
  });

  // A generation refuses a record with no usable fact.
  model.extractions = [[{ claim: "Cut the nightly batch from 6 hours to 90 minutes", quote: QUOTE, technologies: [] }]];
  await client.request("/api/imports", { method: "POST", body: uploadForm(QUOTE, "batch.md") });
  await settle();
  const { items } = await client.json<{ items: { id: string }[] }>("/api/facts");
  for (const fact of items) {
    await client.patch(`/api/facts/${fact.id}`, { provenance: "measured", disclosure: "public" });
    await client.post(`/api/facts/${fact.id}/accept`);
  }
});

async function generate(kind: RenderKind, content: RenderContent = { sections: [] }) {
  model.generations = [content];
  const response = await client.post(`/api/renders/${kind}/generate`);
  expect(response.status).toBe(202);
  const { proposalId } = (await response.json()) as { proposalId: string };
  await settle();
  const [row] = await app.db
    .select()
    .from(renderProposals)
    .where(and(eq(renderProposals.userId, userId), eq(renderProposals.id, proposalId)));
  const proposal = { generationStatus: row!.generationStatus, content: row!.content as RenderContent | null };
  await client.post(`/api/proposals/${proposalId}/dismiss`);
  return { spec: model.generationInputs.at(-1)!.spec, proposal };
}

describe("the spec a 職務経歴書 is written from", () => {
  it("carries each employer's 雇用形態", async () => {
    const { spec } = await generate("shokumu_keirekisho");
    expect(spec.employers.map((e) => [e.id, e.employmentType])).toEqual([[employerId, "dispatch"]]);
  });

  it("takes a project's Japanese summary, and the English one only where there is none", async () => {
    const { id } = (await (await client.post("/api/projects", { ...PROJECT, employerId })).json()) as { id: string };
    expect((await generate("shokumu_keirekisho")).spec.projects[0]).toMatchObject({ summary: PROJECT.summary, summaryJa: null });

    const patched = await client.patch(`/api/projects/${id}`, { summaryJa: "残高更新型のテーブルを追記型の台帳に作り直した" });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { summaryJa: string }).summaryJa).toBe("残高更新型のテーブルを追記型の台帳に作り直した");
    expect((await generate("shokumu_keirekisho")).spec.projects[0]!.summaryJa).toBe("残高更新型のテーブルを追記型の台帳に作り直した");
    // An English render keeps the English summary.
    expect((await generate("career_story_en")).spec.projects[0]).toMatchObject({ summary: PROJECT.summary, summaryJa: null });
  });

  it("leaves a lapsed certification out of a Japanese prompt, and in an English one", async () => {
    const ja = (await generate("shokumu_keirekisho")).spec.certifications.map((c) => c.name);
    expect(ja).toEqual([CERTIFICATION_FIXTURE.nameJa]);
    const en = (await generate("career_story_en")).spec.certifications.map((c) => c.name);
    expect(en).toContain("Fictional Cloud Associate");
  });
});

describe("the 職務経歴書 a generation stores", () => {
  it("carries the record's 保有資格 and 学歴, not the model's", async () => {
    const { proposal } = await generate("shokumu_keirekisho", {
      sections: [
        { key: "summary", heading: "経歴要約", blocks: [{ id: "x", kind: "paragraph", text: "要約です。", factIds: [] }] },
        {
          key: "certifications",
          heading: "保有資格",
          blocks: [{ id: "y", kind: "row", text: "応用情報技術者試験 合格（2019年6月取得）", factIds: [] }],
        },
      ],
    });
    expect(proposal.generationStatus).toBe("ready");
    const sections = proposal.content!.sections;
    expect(sections.map((s) => s.key)).toEqual(["summary", "certifications", "education"]);
    expect(sections[1]!.blocks.map((b) => b.text)).toEqual(["2019年6月　応用情報技術者試験　合格"]);
    expect(sections[2]!.blocks.map((b) => b.text)).toEqual([
      "2017年3月　緑川工科大学　情報工学部　卒業",
      "2013年4月　緑川工科大学　情報工学部　入学",
    ]);
  });

  it("leaves every other render's content as the model wrote it", async () => {
    const written: RenderContent = {
      sections: [{ key: "motivation", heading: "志望動機", blocks: [{ id: "x", kind: "paragraph", text: "特技です。", factIds: [] }] }],
    };
    const { proposal } = await generate("rirekisho", written);
    expect(proposal.content!.sections.map((s) => s.key)).toEqual(["motivation"]);
  });
});
