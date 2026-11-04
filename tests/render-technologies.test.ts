/**
 * The résumé's skills read as technology sets (`technologiesOnly`, `docs/06`
 * 2026-11-04): the same line, the same curation and the same flags as reading
 * every usable fact one row at a time, whatever the record leaves out. Every
 * value here is INVENTED.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb } from "~/server/db/client";
import { employers, facts, projects, renderInclusions, skillCurations, sourceDocumentVersions, sourceDocuments } from "~/server/db/schema";
import { collectRenderInputs } from "~/server/services/render";
import { collectResumeRecord, resumeSkillPool } from "~/server/services/resume";
import { rankedSkills } from "~/render/resume";
import type { Bindings } from "~/server/env";
import { CERTIFICATION_FIXTURE, seedAllowedUser } from "./helpers/seed";
import { harness, type SeededUser } from "./helpers/harness";
import type { RenderKind } from "~/shared/render-content";

const db = createDb((env as unknown as Bindings).DATABASE_URL);
let user: SeededUser;

const TECH = [["Zod", "TypeScript"], ["zod", "TypeScript", "TypeScript"], ["Kafka", " "], ["Postgres", "PostgreSQL"], [], ["Azure", "Terraform", "Kafka"], ["Spring Boot"]];

/** Three employers, one left out of the résumé; four projects, one left out; facts of every grade. */
async function seedRecord() {
  const tag = user.id.slice(-8);
  const employerIds = [0, 1, 2].map((e) => `emp_${tag}_${e}`);
  await db.insert(employers).values(employerIds.map((id, e) => ({
    id, userId: user.id, nameJa: `株式会社テスト${e}`, nameLatin: `Test ${e} K.K.`, city: "Tokyo",
    employmentType: "full_time" as const, startedOn: `${2014 + e * 3}-04-01`, endedOn: e === 2 ? null : `${2017 + e * 3}-03-01`,
  })));
  const projectIds = [0, 1, 2, 3].map((p) => `prj_${tag}_${p}`);
  await db.insert(projects).values(projectIds.map((id, p) => ({ id, userId: user.id, employerId: employerIds[p % 3]!, name: `Project ${p}` })));
  // A document filed under the second employer: its facts resolve there unless set by hand.
  await db.insert(sourceDocuments).values({ id: `doc_${tag}`, userId: user.id, employerId: employerIds[1]!, filename: "notes.md", mimeType: "text/markdown" });
  await db.insert(sourceDocumentVersions).values({
    id: `sdv_${tag}`, userId: user.id, sourceDocumentId: `doc_${tag}`, versionNo: 1, originalBytes: Buffer.from("x"),
    extractedText: "x", extractorVersion: "md-1", byteSize: 1, wordCount: 1, importStatus: "ready",
  });
  const rows = Array.from({ length: 70 }, (_, i) => ({
    id: `fct_${tag}_${String(i).padStart(3, "0")}`,
    userId: user.id,
    claim: `Invented claim ${i}`,
    provenance: (i % 9 === 0 ? "generated" : i % 3 === 0 ? "measured" : "attested") as "generated" | "measured" | "attested",
    disclosure: (i % 11 === 0 ? "private" : "public") as "private" | "public",
    status: (i % 13 === 0 ? "rejected" : i % 17 === 0 ? "candidate" : "accepted") as "rejected" | "candidate" | "accepted",
    // By hand, by project, by document, or by none at all.
    employerId: i % 4 === 0 ? employerIds[i % 3]! : null,
    projectId: i % 4 === 1 ? projectIds[i % 4]! : i % 5 === 2 ? projectIds[3]! : null,
    sourceDocumentVersionId: i % 4 === 2 ? `sdv_${tag}` : null,
    technologies: TECH[i % TECH.length]!,
  }));
  await db.insert(facts).values(rows);
  return { employerIds, projectIds };
}

async function leaveOut(kind: RenderKind, entityType: "employer" | "project", entityId: string) {
  await db.insert(renderInclusions).values({ userId: user.id, kind, entityType, entityId, included: false });
}

beforeEach(async () => {
  user = await seedAllowedUser();
  await harness().as(user).post("/api/certifications", { ...CERTIFICATION_FIXTURE, technologies: ["Azure", "Bicep"] });
});

describe("technologies read as sets", () => {
  it("rank, flag and fill the résumé's skills exactly as every usable fact read one by one does", async () => {
    const { employerIds, projectIds } = await seedRecord();
    const compare = async () => {
      const full = await collectRenderInputs(db, user.id, "english_resume", "");
      const sets = await collectRenderInputs(db, user.id, "english_resume", "", null, { technologiesOnly: true });
      expect(sets.technologySets.reduce((sum, set) => sum + set.count, 0)).toBe(full.facts.length);
      expect(rankedSkills([...sets.technologySets, ...sets.spec.certifications]))
        .toEqual(rankedSkills([...full.facts, ...full.spec.certifications]));
      expect(sets.spec.skillShortlist).toEqual(full.spec.skillShortlist);
      expect(sets.spec.curatedSkills).toEqual(full.spec.curatedSkills);
      expect(sets.spec.workOutsideEmployment).toBe(full.spec.workOutsideEmployment);
      expect({ ...sets.spec, skillShortlist: null, curatedSkills: null }).toEqual({ ...full.spec, skillShortlist: null, curatedSkills: null });
      expect([sets.privateFactCount, sets.generatedFactCount, sets.acceptedFactCount])
        .toEqual([full.privateFactCount, full.generatedFactCount, full.acceptedFactCount]);
      return full;
    };

    const all = await compare();
    expect(all.facts.length).toBeGreaterThan(20);
    expect((await resumeSkillPool(db, user.id)).length).toBeGreaterThan(5);

    await leaveOut("english_resume", "employer", employerIds[1]!);
    await leaveOut("english_resume", "project", projectIds[3]!);
    const narrowed = await compare();
    expect(narrowed.facts.length).toBeLessThan(all.facts.length);

    // A curation, which the sets narrow as the facts did.
    await db.insert(skillCurations).values(["Zod", "Kafka", "Bicep", "Cobol"].map((skillName, i) => ({
      id: `skc_${user.id.slice(-8)}_${i}`, userId: user.id, skillName, groupName: "Tools", sortOrder: i,
    })));
    await compare();
    expect((await collectResumeRecord(db, user.id)).skills.length).toBeGreaterThan(0);
  });
});
