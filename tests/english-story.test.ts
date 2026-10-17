/**
 * The English career story, from a record that is partly Japanese (issue #104).
 *
 * The record an author keeps beside a 職務経歴書 holds its business
 * descriptions and industries in Japanese, and some of its documents too. The
 * first two English stories generated from such a record came back in
 * Japanese — the whole of one, every heading of the other — with three record
 * names respelt, and both were offered for review. This is that record, as a
 * regression fixture: Japanese business descriptions on every employer, one
 * Japanese source document, and one employer with no Latin name at all.
 *
 * The model is scripted. What is asserted is everything around it: what the
 * prompt says and carries, and what happens to a story that comes back in the
 * wrong language.
 *
 * Every fixture here is INVENTED. Nothing is sampled from `local/`.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { harness, settle, stubModel, type Client, type StubModel } from "./helpers/harness";
import { PROFILE_FIXTURE, seedAllowedUser, uploadForm } from "./helpers/seed";
import { buildGenerationPrompt, chaptersOf } from "~/model/generate";
import { employerIdOfChapter } from "~/render/chapters";
import { JAPANESE_ONLY_LABEL, MAX_JAPANESE_SHARE, japaneseShare } from "~/render/language";
import type { RenderSpec } from "~/model/types";
import type { RenderContent } from "~/shared/render-content";

const EMPLOYERS = [
  {
    nameJa: "株式会社ハヤブサ計算機",
    nameLatin: "Hayabusa Computing Co., Ltd.",
    industryJa: "情報通信業（受託開発）",
    businessDescription: "金融機関向けの基幹システムを受託開発する架空の独立系SIer。",
    capitalYen: 300_000_000,
    headcount: 450,
    employmentType: "full_time" as const,
    startedOn: "2014-04-01",
    endedOn: "2018-03-01",
  },
  {
    // The name that exists only in Japanese. It is written as the record
    // writes it, and it is the one Japanese the check does not count.
    nameJa: "有限会社つばめ工房",
    industryJa: "製造業",
    businessDescription: "架空の町工場向けに生産管理システムを開発する小さな会社。",
    employmentType: "full_time" as const,
    startedOn: "2018-04-01",
    endedOn: "2020-03-01",
  },
  {
    nameJa: "株式会社カワセミペイ",
    nameLatin: "Kawasemi Pay Inc.",
    industryJa: "金融業（決済代行）",
    businessDescription: "中小のEC事業者向けに決済サービスを提供する架空のフィンテック企業。",
    capitalYen: 1_200_000_000,
    headcount: 180,
    employmentType: "full_time" as const,
    startedOn: "2020-04-01",
    endedOn: null,
  },
];

const PROJECT = { name: "Settlement ledger rebuild", nameJa: "決済元帳の再構築", summary: "決済元帳を作り直した架空のプロジェクト。" };
const SCHOOL = {
  institution: "Shirasagi University of Engineering",
  institutionJa: "白鷺工業大学",
  faculty: "工学部",
  degree: "B.Eng.",
  fieldOfStudy: "Information Engineering",
  startedOn: "2010-04-01",
  endedOn: "2014-03-01",
  outcome: "graduated" as const,
  level: "tertiary" as const,
};

/** The one Japanese source document, filed to the oldest employer. */
const JAPANESE_DOCUMENT = [
  "夜間バッチの処理時間を6時間から90分に短縮した。",
  "勘定系の移行で3,000本のジョブを棚卸しした。",
].join("\n\n");

const ENGLISH_DOCUMENT = [
  "The settlement ledger was rebuilt on PostgreSQL over nine months.",
  "Reconciliation breaks fell from 40 a week to 2.",
].join("\n\n");

let model: StubModel;
let client: Client;
let employerIds: string[];

beforeEach(async () => {
  model = stubModel();
  client = harness(model).as(await seedAllowedUser());
  await client.put("/api/profile", PROFILE_FIXTURE);
  employerIds = [];
  for (const employer of EMPLOYERS) {
    const created = (await (await client.post("/api/employers", employer)).json()) as { id: string };
    employerIds.push(created.id);
  }
  await client.post("/api/projects", { ...PROJECT, employerId: employerIds[2] });
  await client.post("/api/educations", SCHOOL);

  await importFiled(JAPANESE_DOCUMENT, "hayabusa-batch.md", employerIds[0]!, [
    {
      claim: "夜間バッチの処理時間を6時間から90分に短縮した",
      quote: "夜間バッチの処理時間を6時間から90分に短縮した。",
      technologies: [],
    },
    {
      claim: "勘定系の移行で3,000本のジョブを棚卸しした",
      quote: "勘定系の移行で3,000本のジョブを棚卸しした。",
      technologies: [],
    },
  ]);
  await importFiled(ENGLISH_DOCUMENT, "kawasemi-ledger.md", employerIds[2]!, [
    {
      claim: "Rebuilt the settlement ledger on PostgreSQL over nine months",
      quote: "The settlement ledger was rebuilt on PostgreSQL over nine months.",
      technologies: ["PostgreSQL"],
    },
    {
      claim: "Cut reconciliation breaks from 40 a week to 2",
      quote: "Reconciliation breaks fell from 40 a week to 2.",
      technologies: [],
    },
  ]);
  const { items } = await client.json<{ items: { id: string }[] }>("/api/facts");
  for (const fact of items) {
    await client.patch(`/api/facts/${fact.id}`, { provenance: "attested", disclosure: "public" });
    await client.post(`/api/facts/${fact.id}/accept`);
  }
  // Two imports and a review per test: past the default hook timeout on a busy
  // local proxy, as `tests/isolation.test.ts` found for its own record.
}, 60_000);

async function importFiled(
  text: string,
  filename: string,
  employerId: string,
  candidates: { claim: string; quote: string; technologies: string[] }[],
) {
  model.extractions.push(candidates);
  const form = uploadForm(text, filename);
  form.set("employerId", employerId);
  const response = await client.request("/api/imports", { method: "POST", body: form });
  expect(response.status).toBe(202);
  await settle();
}

/**
 * A story to the plan, written in the given voice. Every employer chapter names
 * its employer as the spec does, unless `name` says otherwise.
 */
function story(
  spec: RenderSpec,
  voice: { heading: (key: string) => string; text: string; name?: (name: string) => string },
): RenderContent {
  const nameOf = new Map(spec.employers.map((e) => [e.id, e.name]));
  return {
    sections: chaptersOf(spec).map((chapter, i) => {
      const employerId = employerIdOfChapter(chapter.key);
      const name = employerId ? nameOf.get(employerId)! : null;
      const said = name ? `${(voice.name ?? ((n) => n))(name)}: ${voice.text}` : voice.text;
      return {
        key: chapter.key,
        heading: voice.heading(chapter.key),
        blocks: [{ id: `blk_${i + 1}`, kind: chapter.key === "anchors" || chapter.key === "routing" ? "row" : "paragraph", text: said, factIds: [] }],
      };
    }),
  };
}

const ENGLISH = {
  heading: (key: string) => `The chapter keyed ${key}`,
  text: "I joined, cut the nightly batch from 6 hours to 90 minutes, and left when the migration ended.",
};
const JAPANESE = {
  heading: () => "情報工学から、壊れると困るものを作る側へ",
  text: "私は夜間バッチの処理時間を6時間から90分に短縮し、移行が終わったところで退職しました。",
};
/** The second failure: English prose under Japanese headings. */
const JAPANESE_HEADINGS = { ...ENGLISH, heading: JAPANESE.heading };

/** Reads the spec the route builds, by letting one generation run unscripted. */
async function specOfStory(): Promise<RenderSpec> {
  model.generations = [{ sections: [] }];
  await client.post("/api/renders/career_story_en/generate");
  await settle();
  const sent = model.generationInputs.at(-1)!.spec;
  // Dismiss it, so the next generation is not refused as a second waiting proposal.
  const { items } = await client.json<{ items: { id: string; status: string }[] }>("/api/proposals?kind=career_story_en");
  for (const p of items) await client.post(`/api/proposals/${p.id}/dismiss`);
  model.generationInputs = [];
  return sent;
}

async function generateStory(...attempts: RenderContent[]) {
  model.generations = attempts;
  const response = await client.post("/api/renders/career_story_en/generate");
  expect(response.status).toBe(202);
  const { proposalId } = (await response.json()) as { proposalId: string };
  await settle();
  const proposal = await client.json<{ generationStatus: string; error: { message: string } | null }>(
    `/api/proposals/${proposalId}`,
  );
  return { proposalId, proposal };
}

describe("the prompt an English story is written from", () => {
  it("states its language inside its register, not only below it", async () => {
    const spec = await specOfStory();
    expect(spec.register).toMatch(/^Write a long-form career story in English/);
    expect(spec.register).toContain("Every heading, paragraph, bullet and row is written in English.");
  });

  it("labels every Japanese-only field, and the register says to write it in English or leave it out", async () => {
    const spec = await specOfStory();
    const prompt = buildGenerationPrompt(spec);
    for (const e of EMPLOYERS) {
      expect(prompt).toContain(`${JAPANESE_ONLY_LABEL} ${e.businessDescription}`);
      expect(prompt).toContain(`(${JAPANESE_ONLY_LABEL} ${e.industryJa})`);
    }
    expect(prompt).toContain(`${JAPANESE_ONLY_LABEL} ${PROJECT.summary}`);
    expect(prompt).toContain(`${JAPANESE_ONLY_LABEL} ${SCHOOL.faculty}`);
    expect(spec.register).toContain(`opens with ${JAPANESE_ONLY_LABEL} is held only in Japanese. Write what it says in English, or leave it out.`);
  });

  it("carries English company figures and no 資本金 or 従業員数", async () => {
    const prompt = buildGenerationPrompt(await specOfStory());
    expect(prompt).toContain("capital 300,000,000 yen · 450 employees");
    expect(prompt).not.toContain("資本金");
    expect(prompt).not.toContain("従業員数");
  });

  it("sends the Japanese document's facts, but not a Japanese industry repeated on every fact", async () => {
    model.generations = [{ sections: [] }];
    await client.post("/api/renders/career_story_en/generate");
    await settle();
    const { facts } = model.generationInputs.at(-1)!;
    expect(facts.some((f) => f.claim.startsWith("夜間バッチ"))).toBe(true);
    for (const fact of facts) {
      expect(fact.employer?.industry ?? null).toBeNull();
      expect(fact.project?.summary ?? null).toBeNull();
    }
  });
});

describe("the record's names", () => {
  it("reach the prompt exactly as the record writes them, unlabelled, in the script it holds them in", async () => {
    const spec = await specOfStory();
    const prompt = buildGenerationPrompt(spec);
    const expected = {
      employers: ["Hayabusa Computing Co., Ltd.", "有限会社つばめ工房", "Kawasemi Pay Inc."],
      projects: [PROJECT.name],
      schools: [SCHOOL.institution],
    };
    expect(spec.employers.map((e) => e.name)).toEqual(expected.employers);
    expect(spec.projects.map((p) => p.name)).toEqual(expected.projects);
    expect(spec.educations.map((e) => e.institution)).toEqual(expected.schools);
    for (const name of [...expected.employers, ...expected.projects, ...expected.schools]) {
      expect(prompt).toContain(`· ${name}`);
      expect(prompt).not.toContain(`${JAPANESE_ONLY_LABEL} ${name}`);
    }
  });

  it("are the same names on the facts that carry them", async () => {
    model.generations = [{ sections: [] }];
    await client.post("/api/renders/career_story_en/generate");
    await settle();
    const { facts, spec } = model.generationInputs.at(-1)!;
    const names = new Set(spec.employers.map((e) => e.name));
    const filed = facts.filter((f) => f.employer);
    expect(filed.length).toBeGreaterThan(0);
    for (const fact of filed) expect(names.has(fact.employer!.name)).toBe(true);
  });

  it("refuse a story that respells an employer in its own chapter, after one retry", async () => {
    const spec = await specOfStory();
    const respelt = story(spec, { ...ENGLISH, name: (n) => n.replace("Hayabusa", "Hayabsa") });
    const { proposal } = await generateStory(respelt, respelt);
    expect(model.generationInputs).toHaveLength(2);
    expect(proposal.generationStatus).toBe("failed");
    expect(proposal.error!.message).toMatch(/did not name every employer the way your record writes it/);
  });
});

describe("a story that comes back in Japanese", () => {
  it("is retried once, and the English one that follows is the proposal", async () => {
    const spec = await specOfStory();
    const { proposalId, proposal } = await generateStory(story(spec, JAPANESE), story(spec, ENGLISH));
    expect(model.generationInputs).toHaveLength(2);
    expect(proposal.generationStatus).toBe("ready");

    await client.post(`/api/proposals/${proposalId}/accept`);
    const md = await (await client.get("/api/renders/career_story_en/download?format=md")).text();
    expect(japaneseShare([md], ["有限会社つばめ工房"])).toBeLessThan(MAX_JAPANESE_SHARE);
    for (const name of spec.employers.map((e) => e.name)) expect(md).toContain(name);
  });

  it("is retried when only its headings are Japanese, which a share of the whole document would miss", async () => {
    const spec = await specOfStory();
    const { proposal } = await generateStory(story(spec, JAPANESE_HEADINGS), story(spec, ENGLISH));
    expect(model.generationInputs).toHaveLength(2);
    expect(proposal.generationStatus).toBe("ready");
  });

  it("is marked failed with a plain reason when the retry is Japanese too, and is never offered for review", async () => {
    const spec = await specOfStory();
    const { proposalId, proposal } = await generateStory(story(spec, JAPANESE), story(spec, JAPANESE));
    expect(model.generationInputs).toHaveLength(2);
    expect(proposal.generationStatus).toBe("failed");
    expect(proposal.error!.message).toMatch(/headings in Japanese, twice, so it was not offered for review/);

    expect((await client.request(`/api/proposals/${proposalId}/diff`)).status).toBe(409);
    const { items } = await client.json<{ items: { kind: string; status: string }[] }>("/api/renders");
    expect(items.find((r) => r.kind === "career_story_en")!.status).toBe("never_generated");
  });

  it("is not retried when it is English to begin with", async () => {
    const spec = await specOfStory();
    const { proposal } = await generateStory(story(spec, ENGLISH));
    expect(model.generationInputs).toHaveLength(1);
    expect(proposal.generationStatus).toBe("ready");
  });
});

describe("the Japanese story", () => {
  it("is not held to the English check", async () => {
    model.generations = [{ sections: [] }];
    await client.post("/api/renders/career_story_ja/generate");
    await settle();
    const spec = model.generationInputs.at(-1)!.spec;
    const { items } = await client.json<{ items: { id: string }[] }>("/api/proposals?kind=career_story_ja");
    for (const p of items) await client.post(`/api/proposals/${p.id}/dismiss`);
    model.generationInputs = [];

    model.generations = [story(spec, JAPANESE)];
    const response = await client.post("/api/renders/career_story_ja/generate");
    await settle();
    const { proposalId } = (await response.json()) as { proposalId: string };
    expect(model.generationInputs).toHaveLength(1);
    expect((await client.json<{ generationStatus: string }>(`/api/proposals/${proposalId}`)).generationStatus).toBe("ready");
  });

  it("is given its Japanese fields unlabelled, and its 資本金 in the form its register copies", async () => {
    model.generations = [{ sections: [] }];
    await client.post("/api/renders/career_story_ja/generate");
    await settle();
    const prompt = buildGenerationPrompt(model.generationInputs.at(-1)!.spec);
    expect(prompt).not.toContain(JAPANESE_ONLY_LABEL);
    expect(prompt).toContain("資本金 3億円");
  });
});
