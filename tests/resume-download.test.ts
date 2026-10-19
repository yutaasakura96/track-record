/**
 * The English résumé's file, through the API (issue #107): the version's
 * summary and bullets, set into job headers, skills, education, certifications
 * and languages read from the record at download time. Every entry is INVENTED.
 */
import { beforeEach, describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { harness, settle, stubModel, type Client, type SeededUser, type StubModel } from "./helpers/harness";
import {
  CERTIFICATION_FIXTURE,
  EDUCATION_FIXTURE,
  EMPLOYER_FIXTURE,
  PROFILE_FIXTURE,
  ROLE_FIXTURE,
  seedAllowedUser,
  seedTailoredResume,
  uploadForm,
} from "./helpers/seed";
import type { CandidateFact } from "~/model/types";
import type { RenderContent } from "~/shared/render-content";

const USABLE: CandidateFact = {
  claim: "Cut the nightly settlement run from 6 hours to 90 minutes",
  quote: "The nightly settlement run fell from 6 hours to 90 minutes.",
  technologies: ["Airflow"],
  provenance: "measured",
};

let model: StubModel;
let client: Client;
let user: SeededUser;

beforeEach(async () => {
  model = stubModel();
  user = await seedAllowedUser();
  client = harness(model).as(user);
});

async function seedRecord() {
  await client.put("/api/profile", PROFILE_FIXTURE);
  const employer = (await (await client.post("/api/employers", { ...EMPLOYER_FIXTURE, city: "Yokohama" })).json()) as { id: string };
  await client.post("/api/roles", { ...ROLE_FIXTURE, employerId: employer.id });
  await client.post("/api/roles", {
    ...ROLE_FIXTURE,
    titleLatin: "Senior Backend Engineer",
    startedOn: "2023-10-01",
    endedOn: "2024-09-01",
    employerId: employer.id,
  });
  await client.post("/api/educations", EDUCATION_FIXTURE);
  await client.post("/api/certifications", { ...CERTIFICATION_FIXTURE, kind: "technical" });
  await client.post("/api/certifications", {
    ...CERTIFICATION_FIXTURE,
    name: "Expired Cloud Associate",
    issuedOn: "2018-03-01",
    expiresOn: "2021-03-01",
  });
  await client.post("/api/certifications", {
    ...CERTIFICATION_FIXTURE,
    name: "TOEIC Listening & Reading 880",
    issuingOrganization: "IIBC",
    issuedOn: "2020-11-01",
    kind: "language",
    technologies: [],
  });
  await client.post("/api/certifications", {
    ...CERTIFICATION_FIXTURE,
    name: "Ordinary driving licence",
    kind: "other",
    technologies: [],
  });
  model.extractions = [[USABLE]];
  await client.request("/api/imports", { method: "POST", body: uploadForm(`# Notes\n\n${USABLE.quote}\n`) });
  await settle();
  const { items } = await client.json<{ items: { id: string }[] }>("/api/facts");
  await client.patch(`/api/facts/${items[0]!.id}`, { employerId: employer.id });
  return { employerId: employer.id, factId: items[0]!.id };
}

async function accepted(ref: string, content: RenderContent) {
  model.generations = [content];
  const { proposalId } = (await (await client.post(`/api/renders/${ref}/generate`)).json()) as { proposalId: string };
  await settle();
  await client.post(`/api/proposals/${proposalId}/accept`);
}

const contentFor = (employerId: string, factId: string): RenderContent => ({
  sections: [
    { key: "summary", heading: "Summary", blocks: [{ id: "blk_1", kind: "paragraph", text: "Backend engineer for logistics.", factIds: [factId] }] },
    {
      key: `employer:${employerId}`,
      heading: "Aozora Logistics K.K.",
      blocks: [{ id: "blk_2", kind: "bullet", text: "Cut the nightly settlement run from 6 hours to 90 minutes.", factIds: [factId] }],
    },
  ],
});

describe("the English résumé download", () => {
  it("lays out the version's bullets under job headers read from the record, in §4.3's order", async () => {
    const { employerId, factId } = await seedRecord();
    await accepted("english_resume", contentFor(employerId, factId));

    const response = await client.get("/api/renders/english_resume/download?format=md");
    expect(response.headers.get("content-disposition")).toMatch(/filename="Yosuke-Aoki-Resume-\d{4}-\d{2}\.md"/);
    const markdown = await response.text();

    expect(markdown.startsWith("# Yosuke Aoki\n")).toBe(true);
    expect(markdown).toContain("**Aozora Logistics K.K.** · Yokohama — Apr 2022 – Sep 2024");
    expect(markdown).toContain("*Senior Backend Engineer (Oct 2023 – Sep 2024) · Backend Engineer (Apr 2022 – Sep 2023)*");
    expect(markdown).toContain("**Midorikawa Institute of Technology** · B.Eng., Information Engineering — 2017");
    expect(markdown).toContain("Applied Information Technology Engineer, 2019");
    expect(markdown).toContain("TOEIC Listening & Reading 880 (2020)");
    expect(markdown).not.toMatch(/Expired Cloud Associate|driving licence|情報工学部|緑川/);

    const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual(["Summary", "Skills", "Experience", "Education", "Certifications", "Languages"]);
  });

  it("is laid out on the paper the profile names", async () => {
    const { employerId, factId } = await seedRecord();
    await accepted("english_resume", contentFor(employerId, factId));

    const pageSize = async () => {
      const bytes = await (await client.get("/api/renders/english_resume/download")).arrayBuffer();
      return /<w:pgSz w:w="(\d+)"/.exec(new PizZip(bytes).file("word/document.xml")!.asText())![1];
    };
    expect(await pageSize()).toBe("11906");
    await client.put("/api/profile", { ...PROFILE_FIXTURE, paperSize: "letter" });
    expect(await pageSize()).toBe("12240");
    // A save that says nothing about the paper leaves it as it was.
    await client.put("/api/profile", PROFILE_FIXTURE);
    expect(await pageSize()).toBe("12240");
  });

  it("gives a tailored résumé the same layout and the same name", async () => {
    const { employerId, factId } = await seedRecord();
    const tailored = await seedTailoredResume(user, "Kestrel, platform engineer", "Platform engineer for a marketplace.");
    await accepted(tailored.id, contentFor(employerId, factId));

    const response = await client.get(`/api/renders/${tailored.id}/download?format=md`);
    expect(response.headers.get("content-disposition")).toMatch(/filename="Yosuke-Aoki-Resume-\d{4}-\d{2}\.md"/);
    expect(await response.text()).toContain("**Aozora Logistics K.K.** · Yokohama — Apr 2022 – Sep 2024");
  });

  it("refuses a hand edit that changes a résumé bullet into a paragraph", async () => {
    const { employerId, factId } = await seedRecord();
    await accepted("english_resume", contentFor(employerId, factId));
    const { items } = await client.json<{ items: { kind: string; currentVersionId: string }[] }>("/api/renders");
    const versionId = items.find((item) => item.kind === "english_resume")!.currentVersionId;
    const version = await client.json<{ content: RenderContent }>(`/api/renders/english_resume/versions/${versionId}`);
    const content = {
      sections: version.content.sections.map((section) => section.key === `employer:${employerId}`
        ? { ...section, blocks: section.blocks.map((block) => ({ ...block, kind: "paragraph" as const })) }
        : section),
    };
    const response = await client.post("/api/renders/english_resume/versions", { basedOnVersionId: versionId, content });
    expect(response.status).toBe(422);
    const after = await client.json<{ items: { kind: string; currentVersionId: string }[] }>("/api/renders");
    expect(after.items.find((item) => item.kind === "english_resume")!.currentVersionId).toBe(versionId);
  });
});
