/**
 * The career timeline's counts, through the API (`docs/07` §4, issue #113).
 *
 * Counts and months only, built on the read. What is pinned here: a count is
 * of accepted facts, an employer counts what resolves to it however it got
 * there, the gaps are the 履歴書's own with its exclusions applied, and nothing
 * of another user's record is counted. Every entry here is INVENTED.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { harness, settle, stubModel, type Client, type Harness, type SeededUser, type StubModel } from "./helpers/harness";
import { EDUCATION_FIXTURE, EMPLOYER_FIXTURE, PROFILE_FIXTURE, SECOND_EMAIL, seedAllowedUser, uploadForm } from "./helpers/seed";
import type { CandidateFact } from "~/model/types";
import type { CareerTimeline } from "~/shared/career-timeline";
import { GAP_NOTE_MAX } from "~/shared/career-gap";

const fact = (claim: string): CandidateFact => ({
  claim,
  quote: `${claim}, as the notes record it.`,
  technologies: [],
  provenance: "attested",
});

let model: StubModel;
let app: Harness;
let author: SeededUser;
let client: Client;

beforeEach(async () => {
  model = stubModel();
  app = harness(model);
  author = await seedAllowedUser();
  client = app.as(author);
});

const created = async (path: string, body: unknown, as: Client = client) =>
  ((await (await as.post(path, body)).json()) as { id: string }).id;

async function imported(candidates: CandidateFact[], filename: string, filed: Record<string, string>, as: Client = client) {
  model.extractions = [candidates];
  const form = uploadForm(`# Notes\n\n${candidates.map((c) => c.quote).join("\n\n")}\n`, filename);
  for (const [key, value] of Object.entries(filed)) form.set(key, value);
  const { importId } = (await (await as.request("/api/imports", { method: "POST", body: form })).json()) as {
    importId: string;
  };
  await settle();
  return importId;
}

const timeline = (as: Client = client) => as.json<CareerTimeline>("/api/career-timeline");

/**
 * One employer with a project. Two documents: three facts filed under the
 * project, one of them then rejected, and one filed under the employer alone.
 * Then one quick capture under the employer, and an education five years
 * before the job.
 */
async function seedRecord(as: Client = client) {
  await as.put("/api/profile", PROFILE_FIXTURE);
  const employerId = await created("/api/employers", EMPLOYER_FIXTURE, as);
  const projectId = await created("/api/projects", { name: "Route planner", employerId }, as);
  const educationId = await created("/api/educations", EDUCATION_FIXTURE, as);

  const importId = await imported(
    [fact("Planned the depot routes"), fact("Moved the planner to a queue"), fact("Attended the weekly sync")],
    "planner-notes.md",
    { projectId },
    as,
  );
  const { items } = await as.json<{ items: { id: string; claim: string }[] }>(`/api/facts?importId=${importId}`);
  await as.post(`/api/facts/${items.find((f) => f.claim === "Attended the weekly sync")!.id}/reject`);
  await imported([fact("Ran the on-call rota")], "rota-notes.md", { employerId }, as);
  await as.post("/api/capture", { claims: [{ claim: "Mentored two new hires", month: "2023-05", employerId }] });
  return { employerId, projectId, educationId };
}

describe("the career timeline", () => {
  it("counts the accepted facts under each employer and project, and where they came from", async () => {
    const { employerId, projectId } = await seedRecord();

    expect(await timeline()).toEqual({
      employers: [{ id: employerId, achievements: 4, unfiled: 2, documents: 2 }],
      projects: [{ id: projectId, achievements: 2 }],
      gaps: [{ after: "2017-03", before: "2022-04", from: "2017-04", to: "2022-03", months: 60 }],
      explained: [],
      staleNotes: [],
    });
  });

  it("counts a fact under the employer its project belongs to, with no employer set on it", async () => {
    const employerId = await created("/api/employers", EMPLOYER_FIXTURE);
    const projectId = await created("/api/projects", { name: "Route planner", employerId });
    await imported([fact("Planned the depot routes")], "planner-notes.md", { projectId });

    const { employers } = await timeline();
    expect(employers).toEqual([{ id: employerId, achievements: 1, unfiled: 0, documents: 1 }]);
  });

  it("drops a gap once the row that bounds it is left out of the 履歴書", async () => {
    const { educationId } = await seedRecord();

    await client.put("/api/render-inclusions", {
      entityType: "education",
      entityId: educationId,
      kind: "rirekisho",
      included: false,
    });

    expect((await timeline()).gaps).toEqual([]);
  });

  it("answers an empty record with nothing to count", async () => {
    expect(await timeline()).toEqual({ employers: [], projects: [], gaps: [], explained: [], staleNotes: [] });
  });

  it("counts nothing of another user's record", async () => {
    const other = app.as(await seedAllowedUser(SECOND_EMAIL));
    const theirs = await seedRecord(other);
    const { employerId } = await seedRecord();

    const mine = await timeline();
    expect(mine.employers.map((e) => e.id)).toEqual([employerId]);
    expect(JSON.stringify(mine)).not.toContain(theirs.employerId);
    expect(JSON.stringify(mine)).not.toContain(theirs.projectId);
  });
});

/**
 * Answering a gap (issue #117, review §5 G2): the author's ※ row, stored on the
 * record against the months it explains. The months are the gap's, never typed.
 */
describe("an explanation of a gap", () => {
  const GAP = { fromOn: "2017-04-01", toOn: "2022-03-01" };
  const explain = (text: string, as: Client = client, months = GAP) => as.post("/api/gap-notes", { ...months, text });

  it("is stored on the record, and the gap it explains no longer warns", async () => {
    await seedRecord();
    const response = await explain("資格取得のため学習");
    expect(response.status).toBe(201);
    const note = (await response.json()) as { id: string };

    const after = await timeline();
    expect(after.gaps).toEqual([]);
    expect(after.explained).toEqual([
      {
        gap: { after: "2017-03", before: "2022-04", from: "2017-04", to: "2022-03", months: 60 },
        note: { id: note.id, ...GAP, text: "資格取得のため学習" },
      },
    ]);
    expect(after.staleNotes).toEqual([]);
  });

  it("is replaced, not doubled, when the same months are explained again", async () => {
    await seedRecord();
    await explain("資格取得のため学習");
    await explain("家業の手伝い");

    const { explained } = await timeline();
    expect(explained.map((e) => e.note.text)).toEqual(["家業の手伝い"]);
  });

  it("warns again once it is removed", async () => {
    await seedRecord();
    const note = (await (await explain("資格取得のため学習")).json()) as { id: string };

    expect((await client.delete(`/api/gap-notes/${note.id}`)).status).toBe(204);
    const after = await timeline();
    expect(after.gaps.map((g) => g.from)).toEqual(["2017-04"]);
    expect(after.explained).toEqual([]);
  });

  it("is kept, and explains nothing, once its gap has moved", async () => {
    const { educationId } = await seedRecord();
    const note = (await (await explain("資格取得のため学習")).json()) as { id: string };

    // A later graduation moves the gap's first month, so the note's months
    // would no longer be true on the 履歴書.
    await client.patch(`/api/educations/${educationId}`, { ...EDUCATION_FIXTURE, endedOn: "2018-03-01" });

    const after = await timeline();
    expect(after.gaps.map((g) => [g.from, g.to])).toEqual([["2018-04", "2022-03"]]);
    expect(after.explained).toEqual([]);
    expect(after.staleNotes.map((n) => n.id)).toEqual([note.id]);
  });

  it("refuses an empty note, a note too long for its row, and months that run backwards", async () => {
    expect((await explain("   ")).status).toBe(422);
    expect((await explain("あ".repeat(GAP_NOTE_MAX + 1))).status).toBe(422);
    expect((await explain("資格取得のため学習", client, { fromOn: "2022-03-01", toOn: "2017-04-01" })).status).toBe(422);
    expect((await explain("資格取得のため学習", client, { fromOn: "2017-04-15", toOn: "2022-03-01" })).status).toBe(422);
  });

  it("is the author's own: another user can neither see nor remove it", async () => {
    await seedRecord();
    const note = (await (await explain("資格取得のため学習")).json()) as { id: string };
    const other = app.as(await seedAllowedUser(SECOND_EMAIL));

    expect(JSON.stringify(await timeline(other))).not.toContain("資格取得");
    const refused = await other.delete(`/api/gap-notes/${note.id}`);
    expect(refused.status).toBe(404);
    expect((await timeline()).explained).toHaveLength(1);
  });
});
