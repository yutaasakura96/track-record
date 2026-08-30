/**
 * The overview and the export (`docs/07-api-design.md` §8).
 *
 * `GET /api/export` was promoted out of M3 into M1: Neon's free plan retains a
 * SIX-HOUR restore window, so the export is the disaster-recovery mechanism
 * rather than a convenience (`docs/03` §12).
 */
import type { Hono } from "hono";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import {
  certifications,
  educations,
  employers,
  facts,
  profiles,
  projects,
  renderProposals,
  renderVersions,
  renders,
  roles,
  sourceDocumentVersions,
  sourceDocuments,
} from "../db/schema";
import { routes } from "../http/registry";
import { renderState } from "./renders";
import { importStatus } from "./imports";
import type { AppEnv } from "../env";

export function registerOverviewRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  /** One request backs the whole home screen. */
  api.get("/api/overview", async (c) => {
    const userId = c.get("user").id;
    const db = c.get("db");

    const [employerRows, projectRows, roleRows, educationRows, certificationRows] =
      await Promise.all([
        db.select().from(employers).where(eq(employers.userId, userId)),
        db.select().from(projects).where(eq(projects.userId, userId)),
        db.select({ id: roles.id }).from(roles).where(eq(roles.userId, userId)),
        db.select({ id: educations.id }).from(educations).where(eq(educations.userId, userId)),
        db
          .select({ id: certifications.id, expiresOn: certifications.expiresOn })
          .from(certifications)
          .where(eq(certifications.userId, userId)),
      ]);

    const [provenance = { measured: 0, attested: 0, generated: 0 }] = await db
      .select({
        measured: sql<number>`count(*) filter (where ${facts.provenance} = 'measured')::int`,
        attested: sql<number>`count(*) filter (where ${facts.provenance} = 'attested')::int`,
        generated: sql<number>`count(*) filter (where ${facts.provenance} = 'generated')::int`,
      })
      .from(facts)
      .where(and(eq(facts.userId, userId), eq(facts.status, "accepted")));

    // "Import in progress" is a row above At a glance, linking to fact review.
    const [latestImport] = await db
      .select({
        id: sourceDocumentVersions.id,
        importStatus: sourceDocumentVersions.importStatus,
        importedAt: sourceDocumentVersions.importedAt,
      })
      .from(sourceDocumentVersions)
      .where(eq(sourceDocumentVersions.userId, userId))
      .orderBy(desc(sourceDocumentVersions.importedAt))
      .limit(1);

    const active =
      latestImport && (latestImport.importStatus === "queued" || latestImport.importStatus === "extracting")
        ? await importStatus(db, userId, latestImport.id)
        : null;

    const currentEmployers = employerRows.filter((e) => e.endedOn === null).length;
    const projectsWithMeasured = await db
      .select({ projectId: facts.projectId })
      .from(facts)
      .where(
        and(
          eq(facts.userId, userId),
          eq(facts.status, "accepted"),
          eq(facts.provenance, "measured"),
        ),
      );
    const measuredProjects = new Set(
      projectsWithMeasured.map((f) => f.projectId).filter(Boolean),
    ).size;

    const documents = await renderState(db, userId);
    const totalFacts = provenance.measured + provenance.attested + provenance.generated;

    // What generation would actually be given. The client disables Generate with
    // this reason rather than enabling it into a 428 (`docs/05` §6: a disabled
    // control always states why).
    const [{ usable } = { usable: 0 }] = await db
      .select({ usable: sql<number>`count(*)::int` })
      .from(facts)
      .where(
        and(
          eq(facts.userId, userId),
          eq(facts.status, "accepted"),
          ne(facts.disclosure, "private"),
          ne(facts.provenance, "generated"),
        ),
      );

    return c.json({
      lastImportAt: latestImport?.importedAt.toISOString() ?? null,
      activeImport: active,
      tiles: {
        employers: {
          count: employerRows.length,
          note: employerRows.length
            ? `${currentEmployers} current, ${employerRows.length - currentEmployers} past`
            : null,
        },
        roles: { count: roleRows.length, note: null },
        projects: {
          count: projectRows.length,
          note: measuredProjects ? `${measuredProjects} with measured outcomes` : null,
        },
        // Educations and certifications together — the split is storage, not
        // interface.
        credentials: { count: educationRows.length + certificationRows.length, note: null },
      },
      factsByProvenance: provenance,
      documents,
      canGenerate: usable > 0,
      /** The empty state is a different screen, not a variant of this one. */
      isEmpty: totalFacts === 0 && employerRows.length === 0 && latestImport === undefined,
    });
  });

  /**
   * The whole record, in one action — every entity, every provenance and
   * disclosure value and every evidence pointer. A real backup, not a summary.
   *
   * **Source document TEXT is deliberately absent**: source documents never
   * render, export, or appear in any output. What is exported is the pointer —
   * the version id, the quote offsets and the line number — which is what makes
   * an imported fact's evidence restorable alongside the document it came from.
   */
  api.get("/api/export", async (c) => {
    const userId = c.get("user").id;
    const db = c.get("db");
    const only = <T extends { userId: string }>(rows: T[]) =>
      rows.map(({ userId: _ignored, ...rest }) => rest);

    const [
      profileRows,
      employerRows,
      roleRows,
      projectRows,
      factRows,
      educationRows,
      certificationRows,
      documentRows,
      versionRows,
      renderRows,
      versionOfRenders,
      proposalRows,
    ] = await Promise.all([
      db.select().from(profiles).where(eq(profiles.userId, userId)),
      db.select().from(employers).where(eq(employers.userId, userId)),
      db.select().from(roles).where(eq(roles.userId, userId)),
      db.select().from(projects).where(eq(projects.userId, userId)),
      db.select().from(facts).where(eq(facts.userId, userId)),
      db.select().from(educations).where(eq(educations.userId, userId)),
      db.select().from(certifications).where(eq(certifications.userId, userId)),
      db.select().from(sourceDocuments).where(eq(sourceDocuments.userId, userId)),
      db
        .select({
          id: sourceDocumentVersions.id,
          sourceDocumentId: sourceDocumentVersions.sourceDocumentId,
          versionNo: sourceDocumentVersions.versionNo,
          extractorVersion: sourceDocumentVersions.extractorVersion,
          byteSize: sourceDocumentVersions.byteSize,
          wordCount: sourceDocumentVersions.wordCount,
          importStatus: sourceDocumentVersions.importStatus,
          importedAt: sourceDocumentVersions.importedAt,
        })
        .from(sourceDocumentVersions)
        .where(eq(sourceDocumentVersions.userId, userId)),
      db.select().from(renders).where(eq(renders.userId, userId)),
      db.select().from(renderVersions).where(eq(renderVersions.userId, userId)),
      db.select().from(renderProposals).where(eq(renderProposals.userId, userId)),
    ]);

    const body = {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      // The author's photo is bytes and is not inlined into a JSON backup.
      profile: profileRows.map(({ userId: _u, photo, ...rest }) => ({
        ...rest,
        hasPhoto: photo !== null,
      })),
      employers: only(employerRows),
      roles: only(roleRows),
      projects: only(projectRows),
      facts: only(factRows),
      educations: only(educationRows),
      certifications: only(certificationRows),
      sourceDocuments: only(documentRows),
      sourceDocumentVersions: versionRows,
      renders: only(renderRows),
      renderVersions: only(versionOfRenders),
      renderProposals: only(proposalRows),
    };

    return new Response(JSON.stringify(body, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="track-record-${new Date()
          .toISOString()
          .slice(0, 10)}.json"`,
      },
    });
  });
}
