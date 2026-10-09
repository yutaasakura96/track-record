/**
 * The master document (`docs/07-api-design.md` §8, issue #57): everything in
 * the record in one readable piece, built on the read.
 *
 * No model call and nothing stored: the record is the one source of truth, and
 * this is a view of it. It lists what a résumé leaves out — Private facts,
 * Generated facts, facts no document uses — because its job is to hold
 * everything. Rejected facts are not in it: the author ruled those out.
 *
 * **The download carries Private facts** (`docs/06`, 2026-10-08), as
 * `GET /api/export` always has. It is the author's copy of their own record
 * and says so in its first lines. Source document text is in neither.
 */
import type { Hono } from "hono";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import {
  certifications,
  educations,
  employers,
  factFlags,
  facts,
  profiles,
  projects,
  roles,
  sourceDocumentVersions,
  sourceDocuments,
} from "../db/schema";
import { routes } from "../http/registry";
import { effectiveEmployerId } from "../services/employer";
import { masterMarkdown } from "~/render/master-document";
import type { MasterDocument, MasterFact, MasterProject } from "~/shared/master-document";
import type { AppEnv } from "../env";
import type { Db } from "../db/client";

export function registerMasterRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  api.get("/api/master-document", async (c) => c.json(await buildMasterDocument(c.get("db"), c.get("user").id)));

  api.get("/api/master-document/download", async (c) => {
    const doc = await buildMasterDocument(c.get("db"), c.get("user").id);
    // The user id and counts. No claim.
    console.log(JSON.stringify({ event: "master_document_downloaded", userId: c.get("user").id, facts: doc.counts.facts }));
    return new Response(masterMarkdown(doc), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="master-document-${doc.builtAt.slice(0, 10)}.md"`,
        "cache-control": "no-store",
      },
    });
  });
}

export async function buildMasterDocument(db: Db, userId: string): Promise<MasterDocument> {
  const [profileRows, employerRows, roleRows, projectRows, factRows, flagRows, educationRows, certificationRows, [waiting]] =
    await db.batch([
      db.select({ nameLatin: profiles.nameLatin }).from(profiles).where(eq(profiles.userId, userId)).limit(1),
      db.select().from(employers).where(eq(employers.userId, userId)).orderBy(desc(employers.startedOn), asc(employers.id)),
      db.select().from(roles).where(eq(roles.userId, userId)).orderBy(desc(roles.startedOn), asc(roles.id)),
      db
        .select()
        .from(projects)
        .where(eq(projects.userId, userId))
        .orderBy(sql`${projects.startedOn} desc nulls last`, asc(projects.name), asc(projects.id)),
      db
        .select({
          id: facts.id,
          claim: facts.claim,
          provenance: facts.provenance,
          disclosure: facts.disclosure,
          technologies: facts.technologies,
          projectId: facts.projectId,
          employerId: effectiveEmployerId,
          importId: facts.sourceDocumentVersionId,
          lineNumber: facts.lineNumber,
          filename: sourceDocuments.filename,
        })
        .from(facts)
        .leftJoin(
          sourceDocumentVersions,
          and(eq(sourceDocumentVersions.id, facts.sourceDocumentVersionId), eq(sourceDocumentVersions.userId, userId)),
        )
        .leftJoin(
          sourceDocuments,
          and(eq(sourceDocuments.id, sourceDocumentVersions.sourceDocumentId), eq(sourceDocuments.userId, userId)),
        )
        // Accepted, and nothing else is asked of a fact: Private and Generated
        // facts are exactly what this document exists to keep in view.
        .where(and(eq(facts.userId, userId), eq(facts.status, "accepted")))
        .orderBy(asc(sourceDocuments.filename), sql`${facts.lineNumber} asc nulls last`, asc(facts.id)),
      db
        .select({ factId: factFlags.factId, kind: factFlags.kind })
        .from(factFlags)
        .innerJoin(facts, and(eq(facts.id, factFlags.factId), eq(facts.userId, userId)))
        .where(and(eq(factFlags.userId, userId), isNull(factFlags.checkedAt), ne(facts.status, "rejected"))),
      db.select().from(educations).where(eq(educations.userId, userId)).orderBy(sql`${educations.endedOn} desc nulls first`, asc(educations.id)),
      db
        .select()
        .from(certifications)
        .where(eq(certifications.userId, userId))
        .orderBy(sql`${certifications.issuedOn} desc nulls last`, asc(certifications.name), asc(certifications.id)),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(facts)
        .where(and(eq(facts.userId, userId), eq(facts.status, "candidate"))),
    ]);

  const flagsByFact = new Map<string, MasterFact["flags"]>();
  for (const flag of flagRows) flagsByFact.set(flag.factId, [...(flagsByFact.get(flag.factId) ?? []), flag.kind]);

  const employerIds = new Set(employerRows.map((employer) => employer.id));
  const projectById = new Map(projectRows.map((project) => [project.id, project]));
  // Where each fact sits: under the employer it resolves to (`docs/04` §3.12),
  // then under its project. A fact whose employer is gone from the list is
  // shown with the work outside employment rather than not at all.
  const placed = new Map<string, Map<string, MasterFact[]>>();
  const NONE = "";
  for (const row of factRows) {
    const employerKey = row.employerId && employerIds.has(row.employerId) ? row.employerId : NONE;
    const projectKey = row.projectId && projectById.has(row.projectId) ? row.projectId : NONE;
    const byProject = placed.get(employerKey) ?? new Map<string, MasterFact[]>();
    placed.set(employerKey, byProject);
    byProject.set(projectKey, [
      ...(byProject.get(projectKey) ?? []),
      {
        id: row.id,
        claim: row.claim,
        provenance: row.provenance,
        disclosure: row.disclosure,
        technologies: row.technologies,
        flags: flagsByFact.get(row.id) ?? [],
        source:
          row.importId && row.filename
            ? { importId: row.importId, filename: row.filename, lineNumber: row.lineNumber }
            : null,
      },
    ]);
  }

  // A project is listed where it belongs, facts or none, and again wherever a
  // fact of it was filed under a different employer by hand.
  const projectsUnder = (employerKey: string): MasterProject[] => {
    const byProject = placed.get(employerKey);
    return projectRows
      .filter((project) => (project.employerId ?? NONE) === employerKey || byProject?.has(project.id))
      .map((project) => ({
        id: project.id,
        name: project.name,
        summary: project.summary,
        facts: byProject?.get(project.id) ?? [],
      }));
  };

  return {
    builtAt: new Date().toISOString(),
    subjectName: profileRows[0]?.nameLatin ?? null,
    counts: {
      facts: factRows.length,
      usable: factRows.filter((f) => f.disclosure !== "private" && f.provenance !== "generated").length,
      private: factRows.filter((f) => f.disclosure === "private").length,
      generated: factRows.filter((f) => f.provenance === "generated").length,
      flagged: flagsByFact.size,
      waiting: waiting?.n ?? 0,
    },
    employers: employerRows.map((employer) => ({
      id: employer.id,
      name: employer.nameLatin ?? employer.nameJa,
      nameJa: employer.nameLatin ? employer.nameJa : null,
      industry: employer.industryJa,
      startedOn: employer.startedOn,
      endedOn: employer.endedOn,
      roles: roleRows
        .filter((role) => role.employerId === employer.id)
        .map((role) => ({
          title: role.titleLatin ?? role.titleJa ?? role.shokushuJa ?? "Role",
          startedOn: role.startedOn,
          endedOn: role.endedOn,
        })),
      projects: projectsUnder(employer.id),
      facts: placed.get(employer.id)?.get(NONE) ?? [],
    })),
    independent: { projects: projectsUnder(NONE), facts: placed.get(NONE)?.get(NONE) ?? [] },
    educations: educationRows.map((education) => ({
      id: education.id,
      institution: education.institution,
      detail: [education.faculty, education.degree, education.fieldOfStudy].filter(Boolean).join(", ") || null,
      startedOn: education.startedOn,
      endedOn: education.endedOn,
      outcome: education.outcome,
    })),
    certifications: certificationRows.map((certification) => ({
      id: certification.id,
      name: certification.name,
      issuingOrganization: certification.issuingOrganization,
      issuedOn: certification.issuedOn,
      expiresOn: certification.expiresOn,
    })),
  };
}
