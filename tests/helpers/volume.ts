/**
 * A record at the size the author's real one reached: about nine thousand
 * facts across a few employers, a couple of dozen imported documents, the
 * flags the importer leaves, and every main document generated against them.
 *
 * It exists for one question — how much a screen or a job reads from the
 * database — so its proportions matter and its words do not. Every value is
 * INVENTED (`CLAUDE.md`); nothing is sampled from `local/`.
 *
 * Written straight to the tables, in batches: building nine thousand facts
 * through the import route would take the model seam and minutes, and it is
 * the reads after it that are measured, not the writes.
 */
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { createDb } from "~/server/db/client";
import {
  applicationDocuments,
  applicationSteps,
  applications,
  employers,
  factFlags,
  facts,
  profiles,
  projects,
  renderProposals,
  renderVersions,
  renders,
  roles,
  sourceDocumentVersions,
  sourceDocuments,
} from "~/server/db/schema";
import { RENDER_KINDS, type RenderContent, type RenderKind } from "~/shared/render-content";
import type { Bindings } from "~/server/env";
import type { SeededUser } from "./harness";
import { PROFILE_FIXTURE } from "./seed";

const bindings = env as unknown as Bindings;

export interface VolumeShape {
  facts: number;
  documents: number;
  employers: number;
}

export const REAL_RECORD: VolumeShape = { facts: 9_000, documents: 24, employers: 3 };

export interface SeededVolume {
  employerIds: string[];
  /** Each document's newest version: what an import id names. */
  importIds: string[];
  documentIds: string[];
  factIds: string[];
  /** Facts every document may use: accepted, neither Private nor Generated. */
  usableFactIds: string[];
  /** One candidate, one fact carrying an open `repeat` flag, one open flag. */
  candidateId: string;
  repeatFlaggedId: string;
  openFlagId: string;
  renderIds: Record<RenderKind, string>;
  /** A tailored résumé's application, with a document on it. */
  applicationId: string;
}

const TECH = ["Java", "Spring Boot", "PostgreSQL", "TypeScript", "React", "Azure", "Terraform", "Kafka", "Python", "Snowflake"];
const VERBS = ["Rebuilt", "Migrated", "Designed", "Automated", "Shortened", "Introduced", "Consolidated", "Replaced"];
const OBJECTS = ["the nightly settlement batch", "the order intake API", "the warehouse sync job", "the billing ledger", "the release pipeline", "the reporting views"];

/** A sentence of about the length the importer's claims run to. */
const claimFor = (i: number) =>
  `${VERBS[i % VERBS.length]} ${OBJECTS[i % OBJECTS.length]} for the regional operations team, cutting the run from ${40 + (i % 50)} to ${5 + (i % 9)} minutes and removing a manual reconciliation step (item ${i}).`;

/** A document's text: numbered paragraphs, each the passage one fact quotes. */
const documentText = (doc: number, paragraphs: number) =>
  Array.from({ length: paragraphs }, (_, p) =>
    `## Note ${doc}.${p}\n\nDuring the quarter the team ${VERBS[p % VERBS.length]!.toLowerCase()} ${OBJECTS[(p + doc) % OBJECTS.length]}; the measured outcome was a reduction from ${40 + (p % 50)} to ${5 + (p % 9)} minutes per run, confirmed against the operations log for paragraph ${p} of document ${doc}.`,
  ).join("\n\n");

async function inBatches<T>(rows: T[], size: number, write: (part: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await write(rows.slice(i, i + size));
}

export async function seedVolume(user: SeededUser, shape: VolumeShape = REAL_RECORD): Promise<SeededVolume> {
  const db = createDb(bindings.DATABASE_URL);
  const userId = user.id;
  const tag = userId.slice(-8);
  const now = new Date();

  await db.insert(profiles).values({
    id: `prf_${tag}`,
    userId,
    ...PROFILE_FIXTURE,
    resumeCity: "Tokyo",
    resumeCountry: "Japan",
    resumeHeadline: "Backend engineer",
    // A photo the size a phone camera's crop comes to: the 履歴書 reads it.
    photo: Buffer.alloc(120_000, 7),
  });

  const employerIds = Array.from({ length: shape.employers }, (_, e) => `emp_${tag}_${e}`);
  await db.insert(employers).values(employerIds.map((id, e) => ({
    id,
    userId,
    nameJa: `株式会社サンプル${e}`,
    nameLatin: `Sample ${e} K.K.`,
    city: "Tokyo",
    businessDescription: "国内向けの業務システムを開発する事業者。",
    employmentType: "full_time" as const,
    startedOn: `${2014 + e * 4}-04-01`,
    endedOn: e === shape.employers - 1 ? null : `${2018 + e * 4}-03-01`,
  })));
  await db.insert(roles).values(employerIds.map((employerId, e) => ({
    id: `rol_${tag}_${e}`,
    userId,
    employerId,
    titleLatin: "Backend Engineer",
    titleJa: "バックエンドエンジニア",
    startedOn: `${2014 + e * 4}-04-01`,
    endedOn: e === shape.employers - 1 ? null : `${2018 + e * 4}-03-01`,
  })));
  const projectIds = employerIds.flatMap((_, e) => [0, 1, 2, 3].map((p) => `prj_${tag}_${e}_${p}`));
  await db.insert(projects).values(projectIds.map((id, i) => ({
    id,
    userId,
    employerId: employerIds[Math.floor(i / 4)]!,
    name: `Project ${i}`,
    summary: "An invented project.",
  })));

  const perDocument = Math.ceil(shape.facts / shape.documents);
  const documentIds: string[] = [];
  const importIds: string[] = [];
  const texts: string[] = [];
  for (let d = 0; d < shape.documents; d++) {
    const text = documentText(d, perDocument);
    texts.push(text);
    const documentId = `doc_${tag}_${d}`;
    const versionId = `sdv_${tag}_${d}`;
    documentIds.push(documentId);
    importIds.push(versionId);
    await db.insert(sourceDocuments).values({
      id: documentId,
      userId,
      projectId: projectIds[d % projectIds.length]!,
      employerId: employerIds[d % employerIds.length]!,
      filename: `notes-${d}.docx`,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    await db.insert(sourceDocumentVersions).values({
      id: versionId,
      userId,
      sourceDocumentId: documentId,
      versionNo: 1,
      // A .docx is larger than the text it holds.
      originalBytes: Buffer.alloc(Math.round(text.length * 1.5), 1),
      extractedText: text,
      extractorVersion: "docx-1",
      byteSize: Math.round(text.length * 1.5),
      wordCount: Math.round(text.length / 6),
      importStatus: "ready",
      chunksTotal: Math.ceil(text.length / 2400),
      chunksDone: Math.ceil(text.length / 2400),
      importedAt: new Date(now.getTime() - (shape.documents - d) * 60_000),
    });
  }

  const factRows: (typeof facts.$inferInsert)[] = [];
  const flagRows: (typeof factFlags.$inferInsert)[] = [];
  for (let i = 0; i < shape.facts; i++) {
    const d = i % shape.documents;
    const p = Math.floor(i / shape.documents);
    const text = texts[d]!;
    const heading = `## Note ${d}.${p}\n\n`;
    const start = text.indexOf(heading) + heading.length;
    const end = text.indexOf("\n\n", start) === -1 ? text.length : text.indexOf("\n\n", start);
    const id = `fct_${tag}_${String(i).padStart(5, "0")}`;
    const status = i % 50 === 7 ? "candidate" : i % 50 === 13 ? "rejected" : "accepted";
    const provenance = i % 20 < 6 ? "measured" : i % 20 < 17 ? "attested" : "generated";
    const disclosure = i % 7 === 0 ? "private" : "public";
    factRows.push({
      id,
      userId,
      claim: claimFor(i),
      provenance,
      disclosure,
      status,
      autoAcceptedAt: status === "accepted" ? now : null,
      resolvedAt: status === "candidate" ? null : now,
      sourceDocumentVersionId: importIds[d]!,
      quote: text.slice(start, end),
      quoteStart: start,
      quoteEnd: end,
      lineNumber: text.slice(0, start).split("\n").length,
      dedupeHash: `hash_${id}`,
      technologies: [TECH[i % TECH.length]!, TECH[(i + 3) % TECH.length]!, TECH[(i + 7) % TECH.length]!],
    });
    if (status === "accepted" && provenance === "measured") {
      flagRows.push({ id: `flg_${id}_n`, userId, factId: id, kind: "number", reason: "It carries a number. Check it against the source.", checkedAt: i % 3 === 0 ? now : null });
    }
    if (disclosure === "private") {
      flagRows.push({ id: `flg_${id}_c`, userId, factId: id, kind: "confidential", reason: "It may name a client.", checkedAt: i % 2 === 0 ? now : null });
    }
    if (status === "accepted" && i % 40 === 1) {
      flagRows.push({ id: `flg_${id}_r`, userId, factId: id, kind: "repeat", reason: "It may restate a fact already in the record." });
    }
  }
  await inBatches(factRows, 500, (part) => db.insert(facts).values(part));
  await inBatches(flagRows, 1000, (part) => db.insert(factFlags).values(part));

  const factIds = factRows.map((row) => row.id!);
  const usableFactIds = factRows
    .filter((row) => row.status === "accepted" && row.disclosure !== "private" && row.provenance !== "generated")
    .map((row) => row.id!);
  const candidateId = factRows.find((row) => row.status === "candidate")!.id!;
  const repeatFlaggedId = flagRows.find((row) => row.kind === "repeat")!.factId;
  const openFlagId = flagRows.find((row) => row.checkedAt === null && row.kind === "number")!.id!;

  // Every main document generated once against the usable facts, as the record
  // stood after the author generated each: a version citing a slice of them.
  const contentFor = (kind: RenderKind): RenderContent => ({
    sections: employerIds.map((employerId, e) => ({
      key: `employer:${employerId}`,
      heading: `Sample ${e} K.K.`,
      blocks: usableFactIds.slice(e * 12, e * 12 + 12).map((factId, b) => ({
        id: `${kind}-${e}-${b}`,
        kind: "bullet" as const,
        text: `${claimFor(b)}`,
        factIds: [factId],
      })),
    })),
  });
  const renderIds = {} as Record<RenderKind, string>;
  for (const kind of RENDER_KINDS) {
    const renderId = `rnd_${tag}_${kind}`;
    const versionId = `rv_${tag}_${kind}`;
    renderIds[kind] = renderId;
    await db.insert(renders).values({ id: renderId, userId, kind });
    await db.insert(renderVersions).values({
      id: versionId,
      userId,
      renderId,
      versionNo: 1,
      content: contentFor(kind),
      factCountAt: usableFactIds.length,
      usableFactIds,
    });
    await db.update(renders).set({ currentVersionId: versionId }).where(eq(renders.id, renderId));
  }

  // A tailored résumé on an application, generated once too.
  const applicationId = `app_${tag}`;
  const tailoredId = `rnd_${tag}_tailored`;
  await db.insert(applications).values({ id: applicationId, userId, company: "Example Corp", position: "Engineer", jobDescription: "An invented posting. ".repeat(80) });
  await db.insert(applicationSteps).values({ id: `aps_${tag}`, userId, applicationId, status: "not_applied", happenedOn: "2026-10-01" });
  await db.insert(renders).values({ id: tailoredId, userId, kind: "english_resume", label: "Example Corp", jobDescription: "An invented posting. ".repeat(80), applicationId });
  await db.insert(renderVersions).values({ id: `rv_${tag}_tailored`, userId, renderId: tailoredId, versionNo: 1, content: contentFor("english_resume"), factCountAt: usableFactIds.length, usableFactIds });
  await db.update(renders).set({ currentVersionId: `rv_${tag}_tailored` }).where(eq(renders.id, tailoredId));
  await db.insert(applicationDocuments).values({ id: `apd_${tag}`, userId, applicationId, renderId: tailoredId });

  // An older proposal, decided, as every accepted version leaves behind.
  await db.insert(renderProposals).values({
    id: `rp_${tag}_old`,
    userId,
    renderId: renderIds.career_story_en,
    content: contentFor("career_story_en"),
    status: "accepted",
    generationStatus: "ready",
    usableFactIds,
    decidedAt: now,
  });

  return {
    employerIds,
    importIds,
    documentIds,
    factIds,
    usableFactIds,
    candidateId,
    repeatFlaggedId,
    openFlagId,
    renderIds,
    applicationId,
  };
}
