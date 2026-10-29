/**
 * A tailored 履歴書, through the API (`docs/06`, 2026-10-26).
 *
 * What is pinned here: an application makes one of its own beside its
 * tailored résumé, and before Applied it is the application's one 履歴書; its
 * 志望動機 and 本人希望欄 are drafts the author confirms or edits before the
 * proposal can be accepted; and apart from those two cells it is the main
 * 履歴書, from the same facts onto the same tables. Every entry here is
 * INVENTED.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { harness, settle, stubModel, type Client, type Harness, type SeededUser, type StubModel } from "./helpers/harness";
import { EDUCATION_FIXTURE, PROFILE_FIXTURE, postJob, SECOND_EMAIL, seedAllowedUser, uploadForm } from "./helpers/seed";
import { renderVersions, renders } from "~/server/db/schema";
import { MOTIVATION_NOTICE, TAILORED_MOTIVATION_NOTICE } from "~/render/rirekisho";
import { MAIN_RIREKISHO_HELD } from "~/shared/application-documents";
import type { CandidateFact } from "~/model/types";
import type { Sheet } from "~/render/sheet";
import type { RenderContent } from "~/shared/render-content";
import { buildGenerationPrompt } from "~/model/generate";
import { employerChapterKey } from "~/render/chapters";

interface Document {
  ref: string;
  kind: string;
  tailored: boolean;
  title: string;
  currentVersionNo: number | null;
}
interface Detail {
  id: string;
  lastActivityAt: string;
  motivationNote: string | null;
  kibouNote: string | null;
  documents: Document[];
  choices: (Document & { onApplication: boolean; heldBy: string | null })[];
  sentCopies: { id: string; ref: string; title: string }[];
  replaced?: string[];
}
interface Draft {
  blockId: string;
  sectionKey: string;
  heading: string;
  text: string;
}
interface Proposal {
  id: string;
  title: string;
  warnings: string[];
  drafts: Draft[];
}

const POSTING = "Harrowgate Signals は潮位計テレメトリのバックエンドエンジニアを募集しています。";
const JOB = { company: "Harrowgate Signals", position: "バックエンドエンジニア", jobDescription: POSTING, requirements: ["Go での API 開発"] };

const USABLE: CandidateFact = {
  claim: "Cut the nightly settlement run from 6 hours to 90 minutes",
  quote: "The nightly settlement run fell from 6 hours to 90 minutes.",
  technologies: ["Airflow"],
  provenance: "measured",
};

const DAY_ONE = new Date("2026-03-02T03:00:00.000Z");

let model: StubModel;
let app: Harness;
let user: SeededUser;
let client: Client;
let factId: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(DAY_ONE);
  model = stubModel();
  app = harness(model);
  user = await seedAllowedUser();
  client = app.as(user);
  factId = await seedRecord(client);
});

afterEach(() => {
  vi.useRealTimers();
});

async function seedRecord(as: Client): Promise<string> {
  await as.put("/api/profile", PROFILE_FIXTURE);
  await postJob(as);
  await as.post("/api/educations", EDUCATION_FIXTURE);
  model.extractions = [[USABLE]];
  await as.request("/api/imports", { method: "POST", body: uploadForm(`# Notes\n\n${USABLE.quote}\n`) });
  await settle();
  const { items } = await as.json<{ items: { id: string }[] }>("/api/facts");
  return items[0]!.id;
}

/**
 * The two cells as a model returns them: the 志望動機 marked a draft, the
 * アピールポイント written from a fact, and the 本人希望欄 left unmarked, which
 * the server marks anyway.
 */
const tailoredContent = (cites = factId): RenderContent => ({
  sections: [
    {
      key: "motivation",
      heading: "志望動機・特技・アピールポイントなど",
      blocks: [
        { id: "blk_1", kind: "paragraph", text: "貴社の潮位計テレメトリ基盤に、夜間バッチ改善の経験を活かせると考え志望しました。", factIds: [cites], drafted: true },
        { id: "blk_2", kind: "paragraph", text: "夜間の精算処理を6時間から90分に短縮しました。", factIds: [cites] },
      ],
    },
    {
      key: "kibou",
      heading: "本人希望欄",
      blocks: [{ id: "blk_3", kind: "paragraph", text: "バックエンドエンジニア職を希望いたします。その他は貴社規定に従います。", factIds: [] }],
    },
  ],
});

/** The main 履歴書's cells, which hold no draft. */
const mainContent = (): RenderContent => ({
  sections: [
    {
      key: "motivation",
      heading: "志望動機・特技・アピールポイントなど",
      blocks: [{ id: "blk_1", kind: "paragraph", text: "夜間の精算処理を6時間から90分に短縮しました。", factIds: [factId], drafted: true }],
    },
    { key: "kibou", heading: "本人希望欄", blocks: [{ id: "blk_2", kind: "paragraph", text: "貴社規定に従います。", factIds: [] }] },
  ],
});

const add = async (as: Client = client) => (await (await as.post("/api/applications", JOB)).json()) as Detail;
const read = (id: string, as: Client = client) => as.json<Detail>(`/api/applications/${id}`);
const tailor = (id: string, kind = "rirekisho", as: Client = client) => as.post(`/api/applications/${id}/tailored/${kind}`);
const choose = (id: string, documents: string[]) => client.put(`/api/applications/${id}/documents`, { documents });
const own = (detail: Detail, kind = "rirekisho") => detail.documents.find((document) => document.tailored && document.kind === kind)!;

async function generate(ref: string, body: RenderContent, as: Client = client) {
  model.generations = [body];
  const response = await as.post(`/api/renders/${ref}/generate`);
  await settle();
  const { proposalId, warnings } = (await response.json()) as { proposalId: string; warnings: string[] };
  return { proposalId, warnings, proposal: await as.json<Proposal>(`/api/proposals/${proposalId}`) };
}

const confirmDraft = (proposalId: string, blockId: string, text: string, as: Client = client) =>
  as.post(`/api/proposals/${proposalId}/drafts/${blockId}`, { text });

/** Generates the main 履歴書 and accepts it. */
async function acceptMain() {
  const { proposalId } = await generate("rirekisho", mainContent());
  expect((await client.post(`/api/proposals/${proposalId}/accept`)).status).toBe(200);
}

/** Generates a tailored 履歴書, confirms every draft as written, and accepts it. */
async function acceptTailored(ref: string, body = tailoredContent()) {
  const { proposalId, proposal } = await generate(ref, body);
  for (const draft of proposal.drafts) expect((await confirmDraft(proposalId, draft.blockId, draft.text)).status).toBe(200);
  expect((await client.post(`/api/proposals/${proposalId}/accept`)).status).toBe(200);
  return proposalId;
}

describe("making a tailored 履歴書 from an application", () => {
  it("is stored from the job description and put on the application, beside its tailored résumé", async () => {
    const made = await add();
    expect((await tailor(made.id, "english_resume")).status).toBe(201);

    const response = await tailor(made.id);
    expect(response.status).toBe(201);
    const body = (await response.json()) as Detail;
    expect(body.documents.map((document) => [document.kind, document.title, document.tailored])).toEqual([
      ["english_resume", "Tailored résumé for Harrowgate Signals", true],
      ["rirekisho", "Tailored 履歴書 for Harrowgate Signals", true],
    ]);
    expect(own(body).ref).toMatch(/^rnd_/);
    expect(own(body).ref).not.toBe(own(body, "english_resume").ref);
  });

  it("is the one an application has: asked again it is the same, put back if it was taken off", async () => {
    const made = await add();
    const ref = own((await (await tailor(made.id)).json()) as Detail).ref;

    const again = await tailor(made.id);
    expect(again.status).toBe(200);
    expect(own((await again.json()) as Detail).ref).toBe(ref);

    await client.delete(`/api/applications/${made.id}/documents/${ref}`);
    expect((await read(made.id)).documents).toEqual([]);
    expect(own((await (await tailor(made.id)).json()) as Detail).ref).toBe(ref);
  });

  it("is refused for any kind but a résumé and a 履歴書", async () => {
    const made = await add();
    for (const kind of ["shokumu_keirekisho", "career_story_ja", "nonsense"]) {
      expect((await tailor(made.id, kind)).status, kind).toBe(422);
    }
    expect((await client.post(`/api/applications/${made.id}/tailored-resume`)).status).toBe(404);
  });

  it("is one of each per application, held by the index", async () => {
    const made = await add();
    await tailor(made.id);
    const [row] = await app.db.select().from(renders).where(and(eq(renders.userId, user.id), eq(renders.applicationId, made.id)));
    await expect(
      app.db.insert(renders).values({ id: "rnd_test_second", userId: user.id, kind: "rirekisho", label: "x", jobDescription: "x", applicationId: made.id }),
    ).rejects.toThrow();
    expect(row!.kind).toBe("rirekisho");
  });

  it("is another user's 404 on every route", async () => {
    const made = await add();
    const ref = own((await (await tailor(made.id)).json()) as Detail).ref;
    const { proposalId } = await generate(ref, tailoredContent());

    const other = app.as(await seedAllowedUser(SECOND_EMAIL));
    for (const [method, path] of [
      ["POST", `/api/applications/${made.id}/tailored/rirekisho`],
      ["POST", `/api/renders/${ref}/generate`],
      ["GET", `/api/renders/${ref}/versions`],
      ["GET", `/api/renders/${ref}/page`],
      ["GET", `/api/renders/${ref}/download`],
      ["GET", `/api/proposals/${proposalId}`],
      ["POST", `/api/proposals/${proposalId}/accept`],
    ] as const) {
      expect((await other.request(path, { method })).status, `${method} ${path}`).toBe(404);
    }
    expect((await confirmDraft(proposalId, "blk_1", "乗っ取り", other)).status).toBe(404);
  });

  it("uses a corrected company for live titles and keeps sent-copy titles frozen", async () => {
    const made = await add();
    const japanese = own((await (await tailor(made.id)).json()) as Detail).ref;
    const english = own((await (await tailor(made.id, "english_resume")).json()) as Detail, "english_resume").ref;
    await client.delete(`/api/applications/${made.id}/documents/${english}`);
    await acceptTailored(japanese);
    expect((await client.post(`/api/applications/${made.id}/steps`, { status: "applied" })).status).toBe(200);
    expect((await client.patch(`/api/applications/${made.id}`, { company: "Harrowgate Marine" })).status).toBe(200);

    const application = await read(made.id);
    expect(application.documents.find((document) => document.ref === japanese)!.title).toBe("Tailored 履歴書 for Harrowgate Marine");
    expect(application.sentCopies[0]!.title).toBe("Tailored 履歴書 for Harrowgate Signals");
    const page = await client.json<{ title: string; document: { title: string } }>(`/api/renders/${japanese}/page`);
    expect(page.title).toBe("Tailored 履歴書 for Harrowgate Marine");
    expect(page.document.title).toBe(page.title);
    const japaneseHistory = await client.json<{ title: string }>(`/api/renders/${japanese}/versions`);
    const englishHistory = await client.json<{ title: string }>(`/api/renders/${english}/versions`);
    expect(japaneseHistory.title).toBe("Tailored 履歴書 for Harrowgate Marine");
    expect(englishHistory.title).toBe("Tailored résumé for Harrowgate Marine");
    const { proposal } = await generate(japanese, tailoredContent());
    expect(proposal.title).toBe("Tailored 履歴書 for Harrowgate Marine");
    // A first version's diff carries a preview, which refuses experience
    // bullets that name no employer, so they sit under the employer's chapter,
    // whose heading names it.
    const [employer] = (await client.json<{ items: { id: string; nameLatin: string }[] }>("/api/employers")).items;
    const englishContent: RenderContent = {
      sections: [{
        key: employerChapterKey(employer!.id), heading: employer!.nameLatin,
        blocks: [{ id: "blk_en", kind: "bullet", text: "Cut the nightly settlement run from six hours to ninety minutes.", factIds: [factId] }],
      }],
    };
    const englishProposal = await generate(english, englishContent);
    expect(englishProposal.proposal.title).toBe("Tailored résumé for Harrowgate Marine");
    const diff = await client.json<{ preview: { title: string } }>(`/api/proposals/${englishProposal.proposalId}/diff`);
    expect(diff.preview.title).toBe("Tailored résumé for Harrowgate Marine");
    // Two tailored documents, an acceptance and three generations: past the
    // default test timeout on a busy local proxy.
  }, 60_000);
});

describe("one 履歴書 an application, until Applied", () => {
  it("takes the main 履歴書 off when the tailored one goes on, and says so", async () => {
    await acceptMain();
    const made = await add();
    await choose(made.id, ["rirekisho"]);

    const body = (await (await tailor(made.id)).json()) as Detail;
    expect(body.replaced).toEqual(["履歴書"]);
    expect(body.documents.map((document) => document.title)).toEqual(["Tailored 履歴書 for Harrowgate Signals"]);
    // The main 履歴書 is untouched, and held back on the tick card with the reason.
    const main = body.choices.find((choice) => choice.ref === "rirekisho")!;
    expect(main).toMatchObject({ onApplication: false, heldBy: MAIN_RIREKISHO_HELD, currentVersionNo: 1 });
  });

  it("refuses the main 履歴書 while the tailored one is on, and takes it once that one is off", async () => {
    await acceptMain();
    const made = await add();
    const ref = own((await (await tailor(made.id)).json()) as Detail).ref;

    const refused = await choose(made.id, ["rirekisho"]);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toBe(MAIN_RIREKISHO_HELD);

    await client.delete(`/api/applications/${made.id}/documents/${ref}`);
    expect((await choose(made.id, ["rirekisho"])).status).toBe(200);
    expect((await read(made.id)).choices.find((choice) => choice.ref === "rirekisho")!.heldBy).toBeNull();
  });

  it("keeps one 履歴書 when choosing main and tailored in concurrent requests", async () => {
    await acceptMain();
    const made = await add();
    const [main, tailored] = await Promise.all([choose(made.id, ["rirekisho"]), tailor(made.id)]);
    expect(tailored.status).toBe(201);
    expect([200, 409]).toContain(main.status);
    if (main.status === 409) {
      expect(((await main.json()) as { error: { message: string } }).error.message).toBe(MAIN_RIREKISHO_HELD);
    }
    const selected = (await read(made.id)).documents.filter((document) => document.kind === "rirekisho");
    expect(selected).toHaveLength(1);
    expect(selected[0]!.tailored).toBe(true);
  });

  it("freezes on leaving Not applied, and from Applied onward records either as sent", async () => {
    await acceptMain();
    const made = await add();
    const ref = own((await (await tailor(made.id)).json()) as Detail).ref;
    await acceptTailored(ref);

    expect((await client.post(`/api/applications/${made.id}/steps`, { status: "applied" })).status).toBe(200);
    const applied = await read(made.id);
    expect(applied.sentCopies.map((copy) => [copy.ref, copy.title])).toEqual([[ref, "Tailored 履歴書 for Harrowgate Signals"]]);

    // Nothing is chosen any more, only recorded: the main 履歴書 can be recorded beside it.
    expect(applied.choices.find((choice) => choice.ref === "rirekisho")!.heldBy).toBeNull();
    const recorded = await client.post(`/api/applications/${made.id}/sent-copies`, { documents: ["rirekisho", ref] });
    expect(recorded.status).toBe(201);
    expect(((await recorded.json()) as Detail).sentCopies).toHaveLength(3);

    // The file is named as the main 履歴書's is: no company.
    const copy = applied.sentCopies[0]!;
    const file = await client.get(`/api/applications/${made.id}/sent-copies/${copy.id}/download`);
    expect(decodeURIComponent(file.headers.get("content-disposition") ?? "")).toMatch(/履歴書_[^_]+_\d{8}\.docx/);
    expect(decodeURIComponent(file.headers.get("content-disposition") ?? "")).not.toContain("Harrowgate");
  });

  it("refuses both step and Undo returns to Not applied with two 履歴書 attached", async () => {
    await acceptMain();
    const made = await add();
    const before = await client.json<{ step: string; closedAs: null; dates: Record<string, string> }>(`/api/applications/${made.id}`);
    const ref = own((await (await tailor(made.id)).json()) as Detail).ref;
    await acceptTailored(ref);
    expect((await client.post(`/api/applications/${made.id}/steps`, { status: "applied" })).status).toBe(200);
    expect((await client.post(`/api/applications/${made.id}/sent-copies`, { documents: ["rirekisho"] })).status).toBe(201);

    const step = await client.post(`/api/applications/${made.id}/steps`, { status: "not_applied" });
    expect(step.status).toBe(409);
    expect(((await step.json()) as { error: { message: string } }).error.message).toContain("Take one 履歴書 off");
    const undo = await client.put(`/api/applications/${made.id}/standing`, {
      step: before.step, closedAs: before.closedAs, dates: before.dates,
    });
    expect(undo.status).toBe(409);
    expect(((await undo.json()) as { error: { message: string } }).error.message).toContain("Take one 履歴書 off");
    expect((await client.json<{ step: string }>(`/api/applications/${made.id}`)).step).toBe("applied");
  });
});

describe("the drafts", () => {
  it("are the 志望動機 and the 本人希望欄, and accepting waits until each is confirmed or edited", async () => {
    const made = await add();
    const ref = own((await (await tailor(made.id)).json()) as Detail).ref;
    const { proposalId, proposal } = await generate(ref, tailoredContent());

    expect(proposal.title).toBe("Tailored 履歴書 for Harrowgate Signals");
    // The アピールポイント, written from a fact and unmarked, is not a draft.
    expect(proposal.drafts.map((draft) => [draft.sectionKey, draft.blockId])).toEqual([
      ["motivation", "blk_1"],
      ["kibou", "blk_3"],
    ]);

    const refused = await client.post(`/api/proposals/${proposalId}/accept`);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toBe(
      "2 parts were drafted for you and are not confirmed yet. Confirm or edit each before accepting.",
    );

    // One confirmed as written, one edited.
    const confirmed = await confirmDraft(proposalId, "blk_1", proposal.drafts[0]!.text);
    expect(confirmed.status).toBe(200);
    const afterOne = (await confirmed.json()) as Proposal;
    expect(afterOne.drafts.map((draft) => draft.blockId)).toEqual(["blk_3"]);
    // The notice says the 志望動機 is drafted: it stays while a part waits, and goes with the last.
    expect(afterOne.warnings).toContain(TAILORED_MOTIVATION_NOTICE);
    const edited = (await (await confirmDraft(proposalId, "blk_3", "  貴社規定に従います。  ")).json()) as Proposal;
    expect(edited.drafts).toEqual([]);
    expect(edited.warnings).not.toContain(TAILORED_MOTIVATION_NOTICE);

    expect((await client.post(`/api/proposals/${proposalId}/accept`)).status).toBe(200);
    const [version] = await app.db.select().from(renderVersions).where(eq(renderVersions.userId, user.id));
    const stored = version!.content as RenderContent;
    expect(stored.sections.flatMap((section) => section.blocks).some((block) => "drafted" in block)).toBe(false);
    expect(stored.sections[1]!.blocks[0]!.text).toBe("貴社規定に従います。");
    // The confirmed draft keeps the facts it was written from.
    expect(stored.sections[0]!.blocks[0]!.factIds).toEqual([factId]);
  });

  it("marks an uncited 志望動機 paragraph and the 本人希望欄 a draft even when the model did not", async () => {
    const made = await add();
    const ref = own((await (await tailor(made.id)).json()) as Detail).ref;
    const unmarked = tailoredContent();
    unmarked.sections[0]!.blocks[0] = { id: "blk_1", kind: "paragraph", text: "貴社の事業に関心を持ち志望しました。", factIds: [] };
    const { proposal } = await generate(ref, unmarked);
    expect(proposal.drafts.map((draft) => draft.blockId)).toEqual(["blk_1", "blk_3"]);
  });

  it("requires confirmation even when the first 志望動機 cites a fact but the model left it unmarked", async () => {
    const made = await add();
    const ref = own((await (await tailor(made.id)).json()) as Detail).ref;
    const unmarked = tailoredContent();
    delete unmarked.sections[0]!.blocks[0]!.drafted;
    const { proposalId, proposal } = await generate(ref, unmarked);
    expect(proposal.drafts.map((draft) => draft.blockId)).toContain("blk_1");
    expect((await client.post(`/api/proposals/${proposalId}/accept`)).status).toBe(409);
  });

  it("refuses a tailored proposal without a first 志望動機 paragraph", async () => {
    const made = await add();
    const ref = own((await (await tailor(made.id)).json()) as Detail).ref;
    const empty = tailoredContent();
    empty.sections = empty.sections.filter((section) => section.key !== "motivation");
    const { proposalId } = await generate(ref, empty);
    const proposal = await client.json<{ generationStatus: string }>(`/api/proposals/${proposalId}`);
    expect(proposal.generationStatus).toBe("failed");
    expect((await client.post(`/api/proposals/${proposalId}/accept`)).status).toBe(409);
  });

  it("refuses an empty first 志望動機 even when a duplicate section has a paragraph", async () => {
    const made = await add();
    const ref = own((await (await tailor(made.id)).json()) as Detail).ref;
    const duplicate = tailoredContent();
    duplicate.sections.unshift({ key: "motivation", heading: "志望動機・特技・アピールポイントなど", blocks: [] });
    const { proposalId } = await generate(ref, duplicate);
    expect((await client.json<{ generationStatus: string }>(`/api/proposals/${proposalId}`)).generationStatus).toBe("failed");
  });

  it("marks the first rendered 志望動機 draft when the model repeats its section", async () => {
    const made = await add();
    const ref = own((await (await tailor(made.id)).json()) as Detail).ref;
    const duplicate = tailoredContent();
    delete duplicate.sections[0]!.blocks[0]!.drafted;
    duplicate.sections.splice(1, 0, {
      key: "motivation", heading: "志望動機・特技・アピールポイントなど",
      blocks: [{ id: "blk_extra", kind: "paragraph", text: "後の節です。", factIds: [factId] }],
    });
    const { proposal } = await generate(ref, duplicate);
    expect(proposal.drafts.map((draft) => draft.blockId)).toEqual(["blk_1", "blk_3"]);
  });

  it.each([
    ["application", "応募先の勤務条件を希望します。", null, "応募先の勤務条件を希望します。"],
    ["profile", null, "週4日の勤務を希望します。", "週4日の勤務を希望します。"],
    ["convention", null, null, "貴社規定に従います。"],
    ["invalid application", "I want a remote role.", "週4日の勤務を希望します。", "週4日の勤務を希望します。"],
    ["invalid profile", null, "I want a remote role.", "貴社規定に従います。"],
  ])("drafts a missing 本人希望欄 from the %s fallback", async (_source, applicationNote, profileNote, expected) => {
    if (profileNote) await client.put("/api/profile", { ...PROFILE_FIXTURE, desiredRoleNote: profileNote });
    const made = await add();
    if (applicationNote) await client.patch(`/api/applications/${made.id}`, { kibouNote: applicationNote });
    const ref = own((await (await tailor(made.id)).json()) as Detail).ref;
    const withoutKibou = tailoredContent();
    withoutKibou.sections = withoutKibou.sections.filter((section) => section.key !== "kibou");
    const { proposalId, proposal } = await generate(ref, withoutKibou);
    const request = proposal.drafts.find((draft) => draft.sectionKey === "kibou")!;
    expect(request.text).toBe(expected);
    expect((await client.post(`/api/proposals/${proposalId}/accept`)).status).toBe(409);
    for (const draft of proposal.drafts) {
      expect((await confirmDraft(proposalId, draft.blockId, draft.text)).status).toBe(200);
    }
    expect((await client.post(`/api/proposals/${proposalId}/accept`)).status).toBe(200);
    const page = await client.json<{ page: { sheet: Sheet } }>(`/api/renders/${ref}/page`);
    expect(JSON.stringify(page.page.sheet)).toContain(expected);
  });

  it("are refused empty, with 御社, on a block that is not one, and once decided", async () => {
    const made = await add();
    const ref = own((await (await tailor(made.id)).json()) as Detail).ref;
    const { proposalId, proposal } = await generate(ref, tailoredContent());

    expect((await confirmDraft(proposalId, "blk_1", "   ")).status).toBe(422);
    expect((await confirmDraft(proposalId, "blk_1", "御社に貢献します。")).status).toBe(422);
    const english = await confirmDraft(proposalId, "blk_1", "I want this role at your company.");
    expect(english.status).toBe(422);
    expect(((await english.json()) as { error: { message: string } }).error.message).toContain("Japanese");
    expect((await confirmDraft(proposalId, "blk_2", "夜間処理を短縮しました。")).status).toBe(404);
    expect((await confirmDraft(proposalId, "blk_1", "あ".repeat(1201))).status).toBe(422);

    await client.post(`/api/proposals/${proposalId}/dismiss`);
    expect((await confirmDraft(proposalId, "blk_1", proposal.drafts[0]!.text)).status).toBe(409);
  });

  it("never reach the main 履歴書, whatever the model marked", async () => {
    const { proposalId, proposal } = await generate("rirekisho", mainContent());
    expect(proposal.drafts).toEqual([]);
    expect((await client.post(`/api/proposals/${proposalId}/accept`)).status).toBe(200);
  });
});

describe("what a tailored 履歴書 is written from", () => {
  it("is the main 履歴書's facts and tables, with the posting, the confirmed fields and the notes beside them", async () => {
    await acceptMain();
    const main = model.generationInputs.at(-1)!;
    const made = await add();
    await client.patch(`/api/applications/${made.id}`, { motivationNote: "潮位の観測に関わりたいからです。", kibouNote: null });
    const ref = own((await (await tailor(made.id)).json()) as Detail).ref;
    // Its drafts confirmed with the main 履歴書's own wording, so the two forms can be compared whole.
    const twoDrafts = tailoredContent();
    twoDrafts.sections[0]!.blocks.splice(1, 1);
    const { proposalId, proposal } = await generate(ref, twoDrafts);
    const tailored = model.generationInputs.at(-1)!;
    const mainPrompt = buildGenerationPrompt(main.spec);
    const tailoredPrompt = buildGenerationPrompt(tailored.spec);
    expect(mainPrompt).toContain("do not write a 志望動機");
    expect(tailoredPrompt).toContain("The FIRST paragraph is the 志望動機, and it is a draft");
    expect(tailoredPrompt).toContain("Never its name, and never 御社");
    expect(tailoredPrompt).toContain("claim no requirement the facts do not support");
    expect(tailoredPrompt).toContain("Do not quote the posting");
    expect(tailoredPrompt).toContain("the cell is exactly 貴社規定に従います。");
    expect(tailoredPrompt).not.toContain("do not write a 志望動機");
    await confirmDraft(proposalId, "blk_1", "夜間の精算処理を6時間から90分に短縮しました。");
    await confirmDraft(proposalId, "blk_3", "貴社規定に従います。");
    expect(proposal.drafts).toHaveLength(2);
    expect((await client.post(`/api/proposals/${proposalId}/accept`)).status).toBe(200);

    expect(tailored.facts).toEqual(main.facts);
    const { register, jobDescription, application, ...rest } = tailored.spec;
    const { register: mainRegister, jobDescription: none, application: noApplication, ...mainRest } = main.spec;
    expect(rest).toEqual(mainRest);
    expect(register).not.toBe(mainRegister);
    expect(none).toBeNull();
    expect(noApplication).toBeNull();
    expect(jobDescription).toBe(POSTING);
    expect(application).toEqual({
      company: JOB.company,
      position: JOB.position,
      requirements: JOB.requirements,
      motivationNote: "潮位の観測に関わりたいからです。",
      kibouNote: null,
    });

    const versions = await app.db.select({ renderId: renderVersions.renderId, usableFactIds: renderVersions.usableFactIds }).from(renderVersions).where(eq(renderVersions.userId, user.id));
    expect(new Set(versions.map((version) => JSON.stringify(version.usableFactIds))).size).toBe(1);

    // Two forms whose two cells say the same thing are the same form.
    const pageOf = async (r: string) => (await client.json<{ page: { sheet: Sheet } }>(`/api/renders/${r}/page`)).page.sheet;
    expect(await pageOf(ref)).toEqual(await pageOf("rirekisho"));
  });

  it("says the 志望動機 is drafted only when the application holds no reason of the author's", async () => {
    const made = await add();
    const ref = own((await (await tailor(made.id)).json()) as Detail).ref;
    const without = await generate(ref, tailoredContent());
    expect(without.warnings).toContain(TAILORED_MOTIVATION_NOTICE);
    expect(without.proposal.warnings).toContain(TAILORED_MOTIVATION_NOTICE);
    expect(without.proposal.warnings).not.toContain(MOTIVATION_NOTICE);
    // 貴社 in its 志望動機 is where it belongs, and is not an advisory.
    expect(without.proposal.warnings.some((warning) => warning.startsWith("貴社 appears"))).toBe(false);
    await client.post(`/api/proposals/${without.proposalId}/dismiss`);

    await client.patch(`/api/applications/${made.id}`, { motivationNote: "潮位の観測に関わりたいからです。" });
    const withNote = await generate(ref, tailoredContent());
    expect(withNote.warnings).not.toContain(TAILORED_MOTIVATION_NOTICE);
    expect(withNote.proposal.warnings).not.toContain(TAILORED_MOTIVATION_NOTICE);
  });

  it("names the company's name in a cell without quoting it", async () => {
    const made = await add();
    const ref = own((await (await tailor(made.id)).json()) as Detail).ref;
    const named = tailoredContent();
    named.sections[0]!.blocks[0]!.text = "Harrowgate Signals の潮位計基盤に関わりたいと考えました。";
    const { proposal } = await generate(ref, named);
    expect(proposal.warnings).toContain(
      "The company's name appears in 志望動機・特技・アピールポイントなど. A 履歴書 calls the company it is sent to 貴社; check the wording before accepting.",
    );
  });
});

describe("the author's notes", () => {
  it("are saved on the application, bounded, empty as none, and are not activity", async () => {
    const made = await add();
    vi.setSystemTime(new Date(DAY_ONE.getTime() + 86_400_000));
    const saved = await client.patch(`/api/applications/${made.id}`, { motivationNote: "  理由です。 ", kibouNote: "" });
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as Detail;
    expect(body).toMatchObject({ motivationNote: "理由です。", kibouNote: null, lastActivityAt: made.lastActivityAt });

    expect((await client.patch(`/api/applications/${made.id}`, { kibouNote: "あ".repeat(401) })).status).toBe(422);
    expect((await read(made.id)).kibouNote).toBeNull();

    const exported = await client.json<{ applications: { id: string; motivationNote: string | null }[] }>("/api/export");
    expect(exported.applications.find((application) => application.id === made.id)!.motivationNote).toBe("理由です。");
  });

  it("never reach a log line", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    const made = await add();
    await client.patch(`/api/applications/${made.id}`, { motivationNote: "潮位の観測に関わりたいからです。" });
    const ref = own((await (await tailor(made.id)).json()) as Detail).ref;
    const { proposalId } = await generate(ref, tailoredContent());
    await confirmDraft(proposalId, "blk_1", "私だけの言葉で書いた理由です。");
    spy.mockRestore();
    const logged = lines.join("\n");
    for (const text of ["潮位の観測", "私だけの言葉", "Harrowgate", "潮位計テレメトリ"]) expect(logged).not.toContain(text);
    expect(logged).toContain("proposal_draft_confirmed");
  });
});
