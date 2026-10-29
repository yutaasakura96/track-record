/**
 * The master document (`docs/07-api-design.md` §9, issue #57): everything in
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
 *
 * **`?language=ja` is the 日本語 one** (issue #59): the same facts under the
 * same headings, with the record named as a Japanese document names it. The
 * rule is the renders' own, `nameInLanguage`. No claim is translated.
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
  renderVersions,
  renders,
  roles,
  sourceDocumentVersions,
  sourceDocuments,
} from "../db/schema";
import { routes } from "../http/registry";
import { effectiveEmployerId } from "../services/employer";
import { nameInLanguage } from "../services/render";
import { documentFilename, tokyoDay } from "~/render/filename";
import { masterMarkdown } from "~/render/master-document";
import type { RenderContent } from "~/shared/render-content";
import {
  MASTER_WORDS,
  keptOut,
  masterLanguage,
  type MasterDocument,
  type MasterFact,
  type MasterLanguage,
  type MasterProject,
} from "~/shared/master-document";
import type { AppEnv } from "../env";
import type { Db } from "../db/client";

export function registerMasterRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  api.get("/api/master-document", async (c) =>
    c.json(await buildMasterDocument(c.get("db"), c.get("user").id, masterLanguage(c.req.query("language")))),
  );

  api.get("/api/master-document/download", async (c) => {
    const doc = await buildMasterDocument(c.get("db"), c.get("user").id, masterLanguage(c.req.query("language")));
    // The user id, the language and counts. No claim.
    console.log(
      JSON.stringify({
        event: "master_document_downloaded",
        userId: c.get("user").id,
        language: doc.language,
        facts: doc.counts.facts,
      }),
    );
    const [profile] = await c
      .get("db")
      .select({ nameLatin: profiles.nameLatin })
      .from(profiles)
      .where(eq(profiles.userId, c.get("user").id))
      .limit(1);
    const filename = documentFilename(`Career-Record-${doc.language.toUpperCase()}`, profile?.nameLatin ?? "", tokyoDay(new Date(doc.builtAt)), "md");
    return new Response(masterMarkdown(doc), {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  });
}

export async function buildMasterDocument(
  db: Db,
  userId: string,
  language: MasterLanguage = "en",
): Promise<MasterDocument> {
  const [
    profileRows,
    employerRows,
    roleRows,
    projectRows,
    factRows,
    flagRows,
    educationRows,
    certificationRows,
    [waiting],
    currentVersions,
  ] = await db.batch([
      db
        .select({
          nameLatin: profiles.nameLatin,
          familyNameKanji: profiles.familyNameKanji,
          givenNameKanji: profiles.givenNameKanji,
        })
        .from(profiles)
        .where(eq(profiles.userId, userId))
        .limit(1),
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
      // What every document cites now, tailored résumés included: a fact none
      // of them cites is one the author has not used yet (issue #112).
      db
        .select({ content: renderVersions.content })
        .from(renders)
        .innerJoin(
          renderVersions,
          and(eq(renderVersions.id, renders.currentVersionId), eq(renderVersions.userId, userId)),
        )
        .where(eq(renders.userId, userId)),
    ]);

  const cited = new Set<string>();
  for (const { content } of currentVersions)
    for (const section of (content as RenderContent).sections)
      for (const block of section.blocks) for (const factId of block.factIds) cited.add(factId);

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
        used: cited.has(row.id),
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
        name: nameInLanguage(language, project.nameJa, project.name),
        summary: project.summary,
        facts: byProject?.get(project.id) ?? [],
      }));
  };

  const profile = profileRows[0];
  // 姓 and 名 apart by a full-width space, as the 履歴書 writes them.
  const nameKanji = profile ? `${profile.familyNameKanji}　${profile.givenNameKanji}`.trim() : "";

  const builtAt = new Date().toISOString();
  return {
    language,
    builtAt,
    subjectName: profile ? (language === "ja" && nameKanji ? nameKanji : profile.nameLatin) : null,
    counts: {
      facts: factRows.length,
      usable: factRows.filter((f) => !keptOut(f)).length,
      private: factRows.filter((f) => f.disclosure === "private").length,
      generated: factRows.filter((f) => f.provenance === "generated" && f.disclosure !== "private").length,
      keptOut: factRows.filter((f) => keptOut(f)).length,
      // Every open flag, as the sidebar counts them, not the facts carrying one.
      flags: flagRows.length,
      waiting: waiting?.n ?? 0,
      years: yearsCovered([...employerRows, ...projectRows], builtAt),
    },
    employers: employerRows.map((employer) => ({
      id: employer.id,
      name: nameInLanguage(language, employer.nameJa, employer.nameLatin),
      // Both names where the record holds both: the same employer is on a
      // résumé under one and on a 職務経歴書 under the other.
      alternateName: employer.nameLatin ? (language === "ja" ? employer.nameLatin : employer.nameJa) : null,
      industry: employer.industryJa,
      startedOn: employer.startedOn,
      endedOn: employer.endedOn,
      roles: roleRows
        .filter((role) => role.employerId === employer.id)
        .map((role) => ({
          title:
            (language === "ja"
              ? (role.titleJa ?? role.shokushuJa ?? role.titleLatin)
              : (role.titleLatin ?? role.titleJa ?? role.shokushuJa)) ?? MASTER_WORDS[language].role,
          startedOn: role.startedOn,
          endedOn: role.endedOn,
        })),
      projects: projectsUnder(employer.id),
      facts: placed.get(employer.id)?.get(NONE) ?? [],
    })),
    independent: { projects: projectsUnder(NONE), facts: placed.get(NONE)?.get(NONE) ?? [] },
    educations: educationRows.map((education) => ({
      id: education.id,
      institution: language === "ja" ? (education.institutionJa ?? education.institution) : education.institution,
      detail:
        [education.faculty, education.degree, education.fieldOfStudy].filter(Boolean).join(language === "ja" ? "、" : ", ") ||
        null,
      startedOn: education.startedOn,
      endedOn: education.endedOn,
      outcome: education.outcome,
    })),
    certifications: certificationRows.map((certification) => ({
      id: certification.id,
      name: language === "ja" ? (certification.nameJa ?? certification.name) : certification.name,
      issuingOrganization: certification.issuingOrganization,
      issuedOn: certification.issuedOn,
      expiresOn: certification.expiresOn,
    })),
  };
}

/**
 * Whole years from the first start to the last end, or to today while anything
 * is still open: the `across 11 years` of the count line. Month precision, as
 * every calendar column is.
 */
function yearsCovered(spans: { startedOn: string | null; endedOn: string | null }[], today: string): number | null {
  const dated = spans.filter((span) => span.startedOn !== null);
  if (dated.length === 0) return null;
  const months = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
  const first = Math.min(...dated.map((span) => months(span.startedOn!)));
  const last = Math.max(...dated.map((span) => months(span.endedOn ?? today)));
  return Math.floor((last - first + 1) / 12);
}
