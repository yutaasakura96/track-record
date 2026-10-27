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
 * Then the record is finished the way the author would finish it, through the
 * app's own routes (`./app.ts`): the flags looked at, the two figures the model
 * invented ruled out, the photo added, the gap explained, every document
 * generated and accepted, and each application given the documents it sends.
 * Generation runs the real route with a scripted seam too (`./renders.ts`), so
 * every check a document meets on generation runs here. Nothing is left
 * waiting for the owner.
 *
 * The user row, its sessions and its Google account link are kept, so the
 * person stays signed in. Everything the user owns is deleted first, children
 * before parents (see RESET_ORDER; the order is the foreign keys', `docs/12` §5a).
 */
import { and, eq, sql } from "drizzle-orm";
import { createDb, type Db } from "~/server/db/client";
import * as s from "~/server/db/schema";
import { newId } from "~/server/http/ids";
import { extractUpload } from "~/pipeline/text";
import { runImport } from "~/pipeline/import";
import { ModelUnavailableError, type CandidateFact, type ModelSeam } from "~/model/types";
import { settleRepeats } from "~/server/services/repeats";
import { classifyClaim } from "~/pipeline/flags";
import { RENDER_KINDS } from "~/shared/render-content";
import { assertRecordingsGone } from "./guard";
import {
  APPLICATIONS,
  CAPTURED,
  CERTIFICATIONS,
  EDUCATIONS,
  EMPLOYERS,
  GAP_NOTE,
  INDEPENDENT_PROJECTS,
  PROFILE,
  SKILL_GROUPS,
  type DemoApplication,
} from "./fixture";
import { DOCUMENTS } from "./documents";
import { demoApp, type DemoCall } from "./app";
import { demoPhoto } from "./photo";
import { generateDemoRender } from "./renders";

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
  s.capturePromptDismissals,
  s.careerGapNotes,
  s.certifications,
  s.educations,
  s.projects,
  s.roles,
  s.employers,
  s.profiles,
] as const;

const month = (value: string | null) => (value ? `${value}-01` : null);

/**
 * A model that reads nothing: it returns the candidates written beside the
 * document, and the documents written in `./renders.ts`.
 */
function scriptedSeam(candidates: CandidateFact[]): ModelSeam {
  const refuse = async (): Promise<never> => {
    throw new ModelUnavailableError("The demo seed has no model.");
  };
  return {
    extractFacts: async (body) => candidates.filter((candidate) => body.includes(candidate.quote)),
    generateRender: async (facts, spec) => generateDemoRender(facts, spec),
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
  /** Accepted document versions: the five documents and Northwind's two tailored ones. */
  renderVersions: number;
  applications: number;
  /** The documents the applications past Not applied were sent with. */
  sentCopies: number;
  interviews: number;
}

/** Resets `userId` to the demo record and returns what it now holds. */
export async function seedDemo(databaseUrl: string, userId: string, flags: readonly string[] = []): Promise<DemoCounts> {
  assertQuotesVerbatim();
  const db = createDb(databaseUrl);
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
      city: employer.city,
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
        summaryJa: project.summaryJa,
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
      summaryJa: project.summaryJa,
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
        groupNameJa: group.nameJa,
        sortOrder: order++,
      });
    }
  }

  const [user] = await db
    .select({ id: s.users.id, email: s.users.email, name: s.users.name })
    .from(s.users)
    .where(eq(s.users.id, userId));
  const call = demoApp(databaseUrl, user!, scriptedSeam([]));
  await finishRecord(call);
  for (const kind of RENDER_KINDS) await generateAndAccept(call, kind);
  for (const application of APPLICATIONS) await addApplication(db, call, userId, application, now);

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
    renderVersions: await count(s.renderVersions),
    applications: await count(s.applications),
    sentCopies: await count(s.applicationSentCopies),
    interviews: await count(s.interviews),
  };
}

/**
 * What the author does with what the import left. A figure the model wrote
 * that no passage states (a Generated fact) is ruled out; every other flag was
 * looked at and the fact stands as it is, Private where it names a client, a
 * person or an address. Then the 履歴書 photo, and the note on the gap.
 */
async function finishRecord(call: DemoCall): Promise<void> {
  type Flags = { items: { id: string; fact: { id: string; provenance: string } }[] };
  const flagged = await call<Flags>("GET", "/api/flags");
  const invented = new Set(flagged.items.filter((flag) => flag.fact.provenance === "generated").map((flag) => flag.fact.id));
  for (const id of invented) await call("POST", `/api/facts/${id}/reject`);
  for (const flag of (await call<Flags>("GET", "/api/flags")).items) await call("POST", `/api/flags/${flag.id}/check`);
  await call("PUT", "/api/profile/photo", demoPhoto());
  await call("POST", "/api/gap-notes", { fromOn: month(GAP_NOTE.fromOn), toOn: month(GAP_NOTE.toOn), text: GAP_NOTE.text });
}

/** Generate, then accept: a document with a first version, as Home's Generate and Diff Review leave it. */
async function generateAndAccept(call: DemoCall, ref: string): Promise<void> {
  const { proposalId } = await call<{ proposalId: string }>("POST", `/api/renders/${ref}/generate`);
  const proposal = await call<{ generationStatus: string; error: unknown }>("GET", `/api/proposals/${proposalId}`);
  if (proposal.generationStatus !== "ready") {
    throw new Error(`${ref} was not generated: ${JSON.stringify(proposal.error)}`);
  }
  await call("POST", `/api/proposals/${proposalId}/accept`);
}

const isClosed = (status: string) => status === "rejected" || status === "withdrawn";

/**
 * One application as the screens build it: pasted, its documents chosen (and
 * its own documents written, where it has them), then moved to Applied on its own,
 * which freezes those documents as sent that day, then on to where it stands.
 * The routes date what they write today, so the times a list is ordered and
 * `gone quiet` is counted by are set back to the fixture's days afterwards.
 */
async function addApplication(db: Db, call: DemoCall, userId: string, application: DemoApplication, now: Date): Promise<void> {
  const ago = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const day = (days: number) => new Date(ago(days).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);

  const { id } = await call<{ id: string }>("POST", "/api/applications", {
    company: application.company,
    position: application.position,
    jobDescription: application.jobDescription,
    postingUrl: application.postingUrl,
    requirements: application.requirements,
  });
  if (application.tailoredResume) {
    const detail = await call<{ documents: { ref: string; kind: string; tailored: boolean }[] }>("POST", `/api/applications/${id}/tailored/english_resume`);
    await generateAndAccept(call, detail.documents.find((document) => document.tailored && document.kind === "english_resume")!.ref);
  }
  await call("PUT", `/api/applications/${id}/documents`, { documents: application.documents });
  if (application.tailoredRirekisho) {
    await call("PATCH", `/api/applications/${id}`, application.tailoredRirekisho);
    const detail = await call<{ documents: { ref: string; kind: string; tailored: boolean }[] }>("POST", `/api/applications/${id}/tailored/rirekisho`);
    const ref = detail.documents.find((document) => document.tailored && document.kind === "rirekisho")!.ref;
    const { proposalId } = await call<{ proposalId: string }>("POST", `/api/renders/${ref}/generate`);
    const proposal = await call<{ generationStatus: string; error: unknown; drafts: { blockId: string; sectionKey: string; text: string }[] }>("GET", `/api/proposals/${proposalId}`);
    if (proposal.generationStatus !== "ready") throw new Error(`${ref} was not generated: ${JSON.stringify(proposal.error)}`);
    for (const sectionKey of ["motivation", "kibou"]) {
      const draft = proposal.drafts.find((item) => item.sectionKey === sectionKey);
      if (!draft) throw new Error(`${ref} has no ${sectionKey} draft to confirm.`);
      await call("POST", `/api/proposals/${proposalId}/drafts/${draft.blockId}`, { text: draft.text });
    }
    await call("POST", `/api/proposals/${proposalId}/accept`);
  }

  const dates: Record<string, string> = { not_applied: day(application.addedDaysAgo) };
  const [applied, ...later] = application.steps;
  if (applied) {
    if (applied.status !== "applied") throw new Error(`${application.company}: the first step is Applied.`);
    dates.applied = day(applied.daysAgo);
    await call("PUT", `/api/applications/${id}/standing`, { step: "applied", closedAs: null, dates });
  }
  if (later.length > 0) {
    for (const step of later) dates[step.status] = day(step.daysAgo);
    const closed = later.find((step) => isClosed(step.status));
    const reached = application.steps.filter((step) => !isClosed(step.status)).at(-1)!;
    await call("PUT", `/api/applications/${id}/standing`, { step: reached.status, closedAs: closed?.status ?? null, dates });
  }

  for (const interview of application.interviews) {
    const interviewId = newId("interview");
    await db.insert(s.interviews).values({
      id: interviewId,
      userId,
      applicationId: id,
      happenedOn: day(interview.daysAgo),
      round: interview.round,
      who: interview.who,
      howItWent: interview.howItWent,
    });
    for (const [position, text] of interview.questions.entries()) {
      await db.insert(s.interviewQuestions).values({ id: newId("interviewQuestion"), userId, interviewId, position, text });
    }
  }

  const lastActivityDaysAgo = Math.min(
    application.addedDaysAgo,
    ...application.steps.map((step) => step.daysAgo),
    ...application.interviews.map((interview) => interview.daysAgo),
  );
  await db.batch([
    db
      .update(s.applications)
      .set({ createdAt: ago(application.addedDaysAgo), lastActivityAt: ago(lastActivityDaysAgo) })
      .where(and(eq(s.applications.userId, userId), eq(s.applications.id, id))),
    db
      .update(s.applicationSentCopies)
      .set({ recordedAt: ago(applied?.daysAgo ?? application.addedDaysAgo) })
      .where(and(eq(s.applicationSentCopies.userId, userId), eq(s.applicationSentCopies.applicationId, id))),
  ]);
}
