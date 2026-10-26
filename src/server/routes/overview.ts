/**
 * The overview and the export (`docs/07-api-design.md` §8).
 *
 * `GET /api/export` was promoted out of M3 into M1: Neon's free plan retains a
 * SIX-HOUR restore window, so the export is the disaster-recovery mechanism
 * rather than a convenience (`docs/03` §12).
 */
import type { Hono } from "hono";
import { and, asc, desc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import {
  applicationDocuments,
  applicationSentCopies,
  applicationSteps,
  applications,
  capturePromptDismissals,
  careerGapNotes,
  certifications,
  educations,
  employers,
  factFlags,
  facts,
  interviewQuestions,
  interviews,
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
import { renderState, usableFacts } from "./renders";
import { importStart, importStatus, startImport } from "./imports";
import { provenanceCounts } from "./facts";
import { factOfFlag, openFlags } from "./flags";
import type { AppEnv } from "../env";

/** A sent copy as a backup holds it: every column but the file, which is bytes, and the owner. */
const { file: _file, userId: _userId, ...sentCopyColumns } = getTableColumns(applicationSentCopies);

export function registerOverviewRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  /**
   * One request backs the whole home screen, and it waits on the database for
   * ONE round trip: its own batch and the renders' batch go out side by side.
   *
   * It was up to seventeen queries, most of them awaited in turn. Each is its
   * own HTTPS request to Neon (`../db/client.ts`), so the home screen stood on
   * `Loading your record…` for as long as they took one after the other
   * (issue #58). A batch is one request and one transaction, so the counts in
   * it are all true at the same instant.
   */
  api.get("/api/overview", async (c) => {
    if (c.env.IMPORT_WORKFLOW) await startImport(importStart(c));
    const userId = c.get("user").id;
    const db = c.get("db");
    const count = sql<number>`count(*)::int`;
    const acceptedFacts = and(eq(facts.userId, userId), eq(facts.status, "accepted"));
    // A fact's document, through its version. Both joins carry the user.
    const versionOfFact = and(
      eq(sourceDocumentVersions.id, facts.sourceDocumentVersionId),
      eq(sourceDocumentVersions.userId, userId),
    );
    const documentOfVersion = and(
      eq(sourceDocuments.id, sourceDocumentVersions.sourceDocumentId),
      eq(sourceDocuments.userId, userId),
    );

    const [
      [
        employerRows,
        [projectCount],
        [roleCount],
        [educationCount],
        [certificationCount],
        [provenance = { measured: 0, attested: 0, generated: 0 }],
        [latestImport],
        inQueue,
        latestSet,
        [measured],
        [usable],
        waiting,
        [unconfirmed],
        [flagged],
        [newestFact],
        [dismissal],
      ],
      documents,
    ] = await Promise.all([
      db.batch([
        db
          .select({
            id: employers.id,
            nameJa: employers.nameJa,
            nameLatin: employers.nameLatin,
            startedOn: employers.startedOn,
            endedOn: employers.endedOn,
          })
          .from(employers)
          .where(eq(employers.userId, userId)),
        db.select({ n: count }).from(projects).where(eq(projects.userId, userId)),
        db.select({ n: count }).from(roles).where(eq(roles.userId, userId)),
        db.select({ n: count }).from(educations).where(eq(educations.userId, userId)),
        db.select({ n: count }).from(certifications).where(eq(certifications.userId, userId)),
        provenanceCounts(db, userId),
        // The newest version: when the header says the last import was.
        db
          .select({ importedAt: sourceDocumentVersions.importedAt, batchId: sourceDocumentVersions.batchId })
          .from(sourceDocumentVersions)
          .where(eq(sourceDocumentVersions.userId, userId))
          .orderBy(desc(sourceDocumentVersions.importedAt))
          .limit(1),
        // The import queue (#93): the version being read, then the ones waiting,
        // in the order they will be read (`~/pipeline/queue.ts`), each with the
        // document it is a version of. The progress panel names them, which
        // `importStatus` does not.
        db
          .select({ id: sourceDocumentVersions.id, filename: sourceDocuments.filename })
          .from(sourceDocumentVersions)
          .innerJoin(sourceDocuments, documentOfVersion)
          .where(
            and(
              eq(sourceDocumentVersions.userId, userId),
              inArray(sourceDocumentVersions.importStatus, ["queued", "extracting"]),
            ),
          )
          .orderBy(
            sql`${sourceDocumentVersions.importStatus} = 'extracting' desc`,
            asc(sourceDocumentVersions.importedAt),
            asc(sourceDocumentVersions.batchOrder),
            asc(sourceDocumentVersions.id),
          ),
        db
          .select({
            importId: sourceDocumentVersions.id,
            filename: sourceDocuments.filename,
            status: sourceDocumentVersions.importStatus,
            chunksTotal: sourceDocumentVersions.chunksTotal,
            chunksDone: sourceDocumentVersions.chunksDone,
            error: sourceDocumentVersions.importError,
          })
          .from(sourceDocumentVersions)
          .innerJoin(sourceDocuments, documentOfVersion)
          .where(and(
            eq(sourceDocumentVersions.userId, userId),
            eq(sql`coalesce(${sourceDocumentVersions.batchId}, ${sourceDocumentVersions.id})`, sql`(select coalesce(batch_id, id) from source_document_versions
              where user_id = ${userId} order by imported_at desc, id desc limit 1)`),
          ))
          .orderBy(asc(sourceDocumentVersions.batchOrder)),
        db
          .select({ n: sql<number>`count(distinct ${facts.projectId})::int` })
          .from(facts)
          .where(and(acceptedFacts, eq(facts.provenance, "measured"))),
        // What generation would actually be given. The client offers no Generate
        // without it rather than enabling one into a 428.
        db
          .select({ n: count })
          .from(facts)
          .where(usableFacts(userId)),
        // Candidates waiting, per version, newest first: the Next step opens the
        // first and says how many documents the rest sit in.
        db
          .select({
            importId: sourceDocumentVersions.id,
            sourceDocumentId: sourceDocumentVersions.sourceDocumentId,
            filename: sourceDocuments.filename,
            open: count,
          })
          .from(facts)
          .innerJoin(sourceDocumentVersions, versionOfFact)
          .innerJoin(sourceDocuments, documentOfVersion)
          .where(and(eq(facts.userId, userId), eq(facts.status, "candidate")))
          .groupBy(
            sourceDocumentVersions.id,
            sourceDocumentVersions.sourceDocumentId,
            sourceDocumentVersions.importedAt,
            sourceDocuments.filename,
          )
          .orderBy(desc(sourceDocumentVersions.importedAt)),
        // Accepted by the author on a card while still Generated. A fact the
        // importer accepted as Generated is not counted: it is flagged, and a
        // flag is advice rather than a step (issue #57).
        db
          .select({
            importId: sourceDocumentVersions.id,
            count,
            total: sql<number>`(sum(count(*)) over ())::int`,
          })
          .from(facts)
          .innerJoin(sourceDocumentVersions, versionOfFact)
          .where(and(acceptedFacts, eq(facts.provenance, "generated"), isNull(facts.autoAcceptedAt)))
          .groupBy(sourceDocumentVersions.id, sourceDocumentVersions.importedAt)
          .orderBy(desc(sourceDocumentVersions.importedAt))
          .limit(1),
        db.select({ n: count }).from(factFlags).innerJoin(facts, factOfFlag(userId)).where(openFlags(userId)),
        // When the record last gained a fact, by any road and in any state: the
        // monthly capture prompt asks only after a month without one (issue #116).
        db
          .select({ createdAt: facts.createdAt })
          .from(facts)
          .where(eq(facts.userId, userId))
          .orderBy(desc(facts.createdAt))
          .limit(1),
        db
          .select({ dismissedOn: capturePromptDismissals.dismissedOn })
          .from(capturePromptDismissals)
          .where(eq(capturePromptDismissals.userId, userId)),
      ]),
      renderState(db, userId),
    ]);

    // Read only while an import runs, so the usual visit stays at one round trip.
    // The one being read, or, between two, the next to be.
    const [first, ...behind] = inQueue;
    const running = first ? await importStatus(db, userId, first.id) : null;
    const active = running && first ? { ...running, filename: first.filename } : null;

    const current = employerRows.filter((e) => e.endedOn === null);
    const currentEmployers = current.length;
    // The current employer is the one not left; of two held at once, the one joined last.
    const [employer] = current.sort((a, b) => b.startedOn.localeCompare(a.startedOn));
    const measuredProjects = measured?.n ?? 0;
    const totalFacts = provenance.measured + provenance.attested + provenance.generated;
    const newestWaiting = waiting[0];

    return c.json({
      lastImportAt: latestImport?.importedAt.toISOString() ?? null,
      activeImport: active,
      waitingImports: behind.map((row) => ({ importId: row.id, filename: row.filename })),
      latestImportSet: latestSet,
      tiles: {
        employers: {
          count: employerRows.length,
          note: employerRows.length
            ? `${currentEmployers} current, ${employerRows.length - currentEmployers} past`
            : null,
        },
        roles: { count: roleCount?.n ?? 0, note: null },
        projects: {
          count: projectCount?.n ?? 0,
          note: measuredProjects ? `${measuredProjects} with measured outcomes` : null,
        },
        // Educations and certifications together — the split is storage, not
        // interface.
        credentials: { count: (educationCount?.n ?? 0) + (certificationCount?.n ?? 0), note: null },
      },
      factsByProvenance: provenance,
      /** Flags the author has not marked checked (issue #57). Advice, never a block. */
      flagged: flagged?.n ?? 0,
      /**
       * Facts still waiting from before the importer accepted on its own, and
       * where reading them starts. `null` at none, which is every record whose
       * imports all ran after that.
       */
      review: newestWaiting
        ? {
            openCandidates: waiting.reduce((sum, row) => sum + row.open, 0),
            documents: new Set(waiting.map((row) => row.sourceDocumentId)).size,
            importId: newestWaiting.importId,
            filename: newestWaiting.filename,
          }
        : null,
      /**
       * Where the facts the author accepted while still Generated are confirmed:
       * the newest version holding any, how many it holds, and how many there
       * are in all. `null` when no version holds one.
       */
      unconfirmed: unconfirmed ?? null,
      /**
       * What the monthly capture prompt is decided from (issue #116). The
       * month it is in is the author's, so the client decides; the server
       * says when the last fact arrived, where the author works now, and
       * which month the prompt was put away for.
       */
      capturePrompt: {
        lastFactAt: newestFact?.createdAt.toISOString() ?? null,
        employer: employer ? { id: employer.id, name: employer.nameLatin ?? employer.nameJa } : null,
        dismissedOn: dismissal?.dismissedOn ?? null,
      },
      documents: documents.documents,
      canGenerate: (usable?.n ?? 0) > 0,
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
   *
   * **Interview recordings are absent too**, a link to one included (S24,
   * decision log 2026-10-11): `interview_recordings` is not read here.
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
      flagRows,
      applicationRows,
      applicationStepRows,
      interviewRows,
      interviewQuestionRows,
      applicationDocumentRows,
      sentCopyRows,
      gapNoteRows,
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
      db.select().from(factFlags).where(eq(factFlags.userId, userId)),
      db.select().from(applications).where(eq(applications.userId, userId)),
      // Superseded rows too: a backup holds what the database holds.
      db.select().from(applicationSteps).where(eq(applicationSteps.userId, userId)),
      db.select().from(interviews).where(eq(interviews.userId, userId)),
      db.select().from(interviewQuestions).where(eq(interviewQuestions.userId, userId)),
      // Taken-off documents and undone copies too, for the same reason.
      db.select().from(applicationDocuments).where(eq(applicationDocuments.userId, userId)),
      db.select(sentCopyColumns).from(applicationSentCopies).where(eq(applicationSentCopies.userId, userId)),
      db.select().from(careerGapNotes).where(eq(careerGapNotes.userId, userId)),
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
      factFlags: only(flagRows),
      educations: only(educationRows),
      certifications: only(certificationRows),
      // The ※ rows the 履歴書 prints under a gap: the author's own words (issue #117).
      careerGapNotes: only(gapNoteRows),
      sourceDocuments: only(documentRows),
      sourceDocumentVersions: versionRows,
      renders: only(renderRows),
      renderVersions: only(versionOfRenders),
      renderProposals: only(proposalRows),
      applications: only(applicationRows),
      applicationSteps: only(applicationStepRows),
      interviews: only(interviewRows),
      interviewQuestions: only(interviewQuestionRows),
      applicationDocuments: only(applicationDocumentRows),
      // A sent copy's file is bytes too, and is not read. Its page, what the file says, is here.
      applicationSentCopies: sentCopyRows,
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
