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
      gaps: [{ after: "2017-03", before: "2022-04", months: 60 }],
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
    expect(await timeline()).toEqual({ employers: [], projects: [], gaps: [] });
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
