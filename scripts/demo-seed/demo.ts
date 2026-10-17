/**
 * The demo record and the reset that installs it, apart from the command line
 * (`./seed.ts`) so the suite can run both against its own database.
 *
 * Documents go through the real import pipeline (`runImport`): chunking, quote
 * anchoring, the confidential-shape scrub, grading, flags and repeat detection
 * all run as they do for an upload. Only the model is replaced, by a scripted
 * seam that returns the candidates written beside each document. So a reset
 * costs nothing, needs no API key, and produces the same record every time.
 *
 * Renders are NOT seeded: a résumé is the model's work, and generating one is
 * the step a demo is for.
 *
 * The user row, its sessions and its Google account link are kept, so the
 * person stays signed in. Everything the user owns is deleted first, children
 * before parents (see RESET_ORDER; the order is the foreign keys', `docs/12` §5a).
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "~/server/db/client";
import * as s from "~/server/db/schema";
import { newId } from "~/server/http/ids";
import { extractUpload } from "~/pipeline/text";
import { runImport } from "~/pipeline/import";
import { ModelUnavailableError, type CandidateFact, type ModelSeam } from "~/model/types";
import { settleRepeats } from "~/server/services/repeats";
import { classifyClaim } from "~/pipeline/flags";
import { assertRecordingsGone } from "./guard";
import {
  APPLICATIONS,
  CAPTURED,
  CERTIFICATIONS,
  EDUCATIONS,
  EMPLOYERS,
  INDEPENDENT_PROJECTS,
  PROFILE,
  SKILL_GROUPS,
} from "./fixture";
import { DOCUMENTS } from "./documents";

/** Every table a user owns, children first. Users, sessions, accounts and verifications are kept. */
export const RESET_ORDER = [
  s.interviewRecordings,
  s.interviewQuestions,
  s.interviews,
  s.applicationSentCopies,
  s.applicationDocuments,
  s.applicationSteps,
  s.renderProposals,
  s.renderVersions,
  s.renders,
  s.applications,
  s.factFlags,
  s.facts,
  s.importChunks,
  s.sourceDocumentVersions,
  s.sourceDocuments,
  s.skillCurations,
  s.renderInclusions,
  s.certifications,
  s.educations,
  s.projects,
  s.roles,
  s.employers,
  s.profiles,
] as const;

const month = (value: string | null) => (value ? `${value}-01` : null);

/** A model that reads nothing: it returns the candidates written beside the document. */
function scriptedSeam(candidates: CandidateFact[]): ModelSeam {
  const refuse = async (): Promise<never> => {
    throw new ModelUnavailableError("The demo seed has no model.");
  };
  return {
    extractFacts: async (body) => candidates.filter((candidate) => body.includes(candidate.quote)),
    generateRender: refuse,
    gradeFacts: refuse,
    explainFlag: refuse,
    readPosting: refuse,
    captureClaims: refuse,
  };
}

/** Uploads still in R2: a removed recording's object is already gone. */
async function uploadedRecordings(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.interviewRecordings)
    .where(
      and(
        eq(s.interviewRecordings.userId, userId),
        eq(s.interviewRecordings.kind, "upload"),
        sql`${s.interviewRecordings.removedAt} is null`,
      ),
    );
  return row?.n ?? 0;
}

/** Every quote in the fixture must be verbatim in its document, or the pipeline would drop it silently. */
export function assertQuotesVerbatim(): void {
  for (const doc of DOCUMENTS) {
    for (const candidate of doc.candidates) {
      if (!doc.text.includes(candidate.quote)) {
        throw new Error(`${doc.filename}: a quote is not verbatim in the text: ${candidate.quote.slice(0, 60)}…`);
      }
    }
  }
}

export async function resetUser(db: Db, userId: string, flags: readonly string[]): Promise<void> {
  assertRecordingsGone(await uploadedRecordings(db, userId), userId, flags);
  // One transaction: a reset that stops halfway would leave a record nobody wrote.
  const [first, ...rest] = RESET_ORDER.map((table) => db.delete(table).where(eq(table.userId, userId)));
  await db.batch([first!, ...rest]);
}

export interface DemoCounts {
  user: string;
  employers: number;
  projects: number;
  documents: number;
  facts: number;
  flags: number;
  skills: number;
  applications: number;
  interviews: number;
}

/** Resets `userId` to the demo record and returns what it now holds. */
export async function seedDemo(db: Db, userId: string, flags: readonly string[] = []): Promise<DemoCounts> {
  assertQuotesVerbatim();
  await resetUser(db, userId, flags);

  await db.insert(s.profiles).values({
    id: newId("profile"),
    userId,
    ...PROFILE,
    dateOfBirth: month(PROFILE.dateOfBirth)!,
  });

  const employerIds = new Map<string, string>();
  const projectIds = new Map<string, string>();
  for (const [index, employer] of EMPLOYERS.entries()) {
    const id = newId("employer");
    employerIds.set(employer.key, id);
    await db.insert(s.employers).values({
      id,
      userId,
      nameJa: employer.nameJa,
      nameLatin: employer.nameLatin,
      businessDescription: employer.businessDescription,
      industryJa: employer.industryJa,
      capitalYen: employer.capitalYen,
      headcount: employer.headcount,
      employmentType: employer.employmentType,
      startedOn: month(employer.startedOn)!,
      endedOn: month(employer.endedOn),
      leavingReasonJa: employer.leavingReasonJa,
      sortOrder: index,
    });
    for (const role of employer.roles) {
      await db.insert(s.roles).values({
        id: newId("role"),
        userId,
        employerId: id,
        titleJa: role.titleJa,
        titleLatin: role.titleLatin,
        shokushuJa: role.shokushuJa,
        startedOn: month(role.startedOn)!,
        endedOn: month(role.endedOn),
      });
    }
    for (const project of employer.projects) {
      const projectId = newId("project");
      projectIds.set(project.key, projectId);
      await db.insert(s.projects).values({
        id: projectId,
        userId,
        employerId: id,
        name: project.name,
        nameJa: project.nameJa,
        summary: project.summary,
        startedOn: month(project.startedOn),
        endedOn: month(project.endedOn),
      });
    }
  }
  for (const project of INDEPENDENT_PROJECTS) {
    const projectId = newId("project");
    projectIds.set(project.key, projectId);
    await db.insert(s.projects).values({
      id: projectId,
      userId,
      employerId: null,
      name: project.name,
      nameJa: project.nameJa,
      summary: project.summary,
      startedOn: month(project.startedOn),
      endedOn: month(project.endedOn),
    });
  }

  for (const education of EDUCATIONS) {
    await db.insert(s.educations).values({
      id: newId("education"),
      userId,
      ...education,
      startedOn: month(education.startedOn),
      endedOn: month(education.endedOn),
    });
  }
  for (const certification of CERTIFICATIONS) {
    await db.insert(s.certifications).values({
      id: newId("certification"),
      userId,
      ...certification,
      issuedOn: month(certification.issuedOn),
      expiresOn: month(certification.expiresOn),
    });
  }

  // Each document through the real pipeline, one at a time, as the queue runs them.
  for (const doc of DOCUMENTS) {
    const upload = await extractUpload(new File([doc.text], doc.filename, { type: "text/markdown" }));
    const documentId = newId("sourceDocument");
    const versionId = newId("sourceDocumentVersion");
    await db.batch([
      db.insert(s.sourceDocuments).values({
        id: documentId,
        userId,
        projectId: doc.project ? projectIds.get(doc.project)! : null,
        employerId: doc.employer ? employerIds.get(doc.employer)! : null,
        filename: doc.filename,
        mimeType: upload.mimeType,
      }),
      db.insert(s.sourceDocumentVersions).values({
        id: versionId,
        userId,
        sourceDocumentId: documentId,
        versionNo: 1,
        originalBytes: Buffer.from(doc.text, "utf8"),
        extractedText: upload.text,
        extractorVersion: upload.extractorVersion,
        byteSize: upload.byteSize,
        wordCount: upload.wordCount,
        batchId: versionId,
        importStatus: "queued",
      }),
    ]);
    await runImport({ db, model: scriptedSeam(doc.candidates), userId, versionId });
    const [done] = await db
      .select({ status: s.sourceDocumentVersions.importStatus, error: s.sourceDocumentVersions.importError })
      .from(s.sourceDocumentVersions)
      .where(eq(s.sourceDocumentVersions.id, versionId));
    if (done?.status !== "ready") throw new Error(`${doc.filename} finished ${done?.status}: ${done?.error ?? ""}`);
  }

  // Quick capture's save, as `POST /api/capture` writes it.
  const now = new Date();
  for (const captured of CAPTURED) {
    const technologies = [...new Set(captured.technologies)];
    const { shape, flags } = classifyClaim({ claim: captured.claim, quote: null, technologies });
    const factId = newId("fact");
    await db.insert(s.facts).values({
      id: factId,
      userId,
      claim: captured.claim,
      occurredOn: month(captured.month),
      employerId: employerIds.get(captured.employer)!,
      employerSetAt: now,
      provenance: "attested",
      disclosure: shape ? "private" : "restricted",
      isClientIdentifying: shape !== null,
      status: "accepted",
      technologies,
      resolvedAt: now,
      gradedAt: now,
    });
    for (const flag of flags.filter((flag) => flag.kind === "confidential")) {
      await db.insert(s.factFlags).values({ id: newId("factFlag"), userId, factId, ...flag });
    }
  }
  await settleRepeats(db, userId);

  let order = 0;
  for (const group of SKILL_GROUPS) {
    for (const skill of group.skills) {
      await db.insert(s.skillCurations).values({
        id: newId("skillCuration"),
        userId,
        skillName: skill,
        groupName: group.name,
        sortOrder: order++,
      });
    }
  }

  const today = new Date();
  const ago = (days: number) => new Date(today.getTime() - days * 86_400_000);
  const dayInTokyo = (days: number) => new Date(ago(days).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  for (const application of APPLICATIONS) {
    const id = newId("application");
    const reached = application.steps.filter((step) => step.status !== "rejected" && step.status !== "withdrawn");
    const closed = application.steps.find((step) => step.status === "rejected" || step.status === "withdrawn");
    const lastActivityDaysAgo = Math.min(
      application.addedDaysAgo,
      ...application.steps.map((step) => step.daysAgo),
      ...application.interviews.map((interview) => interview.daysAgo),
    );
    await db.insert(s.applications).values({
      id,
      userId,
      company: application.company,
      position: application.position,
      postingUrl: application.postingUrl,
      jobDescription: application.jobDescription,
      requirements: application.requirements,
      currentStep: reached.at(-1)?.status ?? "not_applied",
      closedAs: closed?.status ?? null,
      lastActivityAt: ago(lastActivityDaysAgo),
      createdAt: ago(application.addedDaysAgo),
    });
    const steps = [{ status: "not_applied" as const, daysAgo: application.addedDaysAgo }, ...application.steps];
    for (const step of steps) {
      await db.insert(s.applicationSteps).values({
        id: newId("applicationStep"),
        userId,
        applicationId: id,
        status: step.status,
        happenedOn: dayInTokyo(step.daysAgo),
      });
    }
    for (const interview of application.interviews) {
      const interviewId = newId("interview");
      await db.insert(s.interviews).values({
        id: interviewId,
        userId,
        applicationId: id,
        happenedOn: dayInTokyo(interview.daysAgo),
        round: interview.round,
        who: interview.who,
        howItWent: interview.howItWent,
      });
      for (const [position, text] of interview.questions.entries()) {
        await db.insert(s.interviewQuestions).values({ id: newId("interviewQuestion"), userId, interviewId, position, text });
      }
    }
  }

  const count = async (table: (typeof RESET_ORDER)[number]) =>
    (await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.userId, userId)))[0]?.n ?? 0;
  return {
    user: userId,
    employers: await count(s.employers),
    projects: await count(s.projects),
    documents: await count(s.sourceDocuments),
    facts: await count(s.facts),
    flags: await count(s.factFlags),
    skills: await count(s.skillCurations),
    applications: await count(s.applications),
    interviews: await count(s.interviews),
  };
}
