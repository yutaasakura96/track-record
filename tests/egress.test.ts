/**
 * What each screen and job reads from the database, at the size the real
 * record reached (`tests/helpers/volume.ts`).
 *
 * Every byte the database sends counts against the plan's network allowance,
 * and the free plan's is 5 GB a month. In November 2026 the app sent 4.97 GB of
 * it in four days, against a record of about 50 MB: routes that are polled
 * every 1.5 s were each re-reading things they did not need — the import's
 * original file bytes, every usable fact id once per document, whole fact rows
 * where a column or a count would do (`docs/06`, 2026-11-04).
 *
 * Each budget is a ceiling on the response bytes one use of a path receives
 * from the database. It sits above what the path reads now and below what it
 * read before, so a path that goes back to reading whole rows or the whole
 * record fails here rather than on the next month's bill. The figures are printed as one
 * JSON line per path: ids and numbers, never record content.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { harness, settle, stubModel, type Client, type StubModel } from "./helpers/harness";
import { seedAllowedUser } from "./helpers/seed";
import { metered, type Egress } from "./helpers/egress";
import { REAL_RECORD, seedVolume, type SeededVolume } from "./helpers/volume";
import { createDb } from "~/server/db/client";
import { applicationDocuments, applications, renderProposals, renderVersions, renders, sourceDocumentVersions } from "~/server/db/schema";
import { env } from "cloudflare:test";
import { and, eq, sql } from "drizzle-orm";
import type { Bindings } from "~/server/env";

const KB = 1024;

/**
 * The ceiling on one use of each path, in response bytes from the database.
 * Beside each, what the path read before 2026-11-04 and what it reads now, on
 * this volume.
 */
const BUDGET: Record<string, number> = {
  // Polled every 1.5 s while an import runs.
  "GET /api/imports/:id": 16 * KB, // 326 KB → 2 KB: the row held the uploaded file and its text
  "GET /api/overview (import running)": 64 * KB, // 1.2 MB → 13 KB
  "GET /api/facts?importId (all pages)": 256 * KB, // 338 KB → 193 KB
  // Fact Review on an import some of whose facts may repeat one in the record:
  // each page holding one reads the pool they are matched against.
  "GET /api/facts?importId (all pages, repeat flags)": 3_400 * KB, // 3.0 MB → 3.0 MB
  "GET /api/imports/summary": 8 * KB, // 1 KB → 1 KB
  "GET /api/imports": 32 * KB, // 11 KB → 11 KB
  // Polled every 1.5 s while a document is written.
  "GET /api/overview": 64 * KB, // 880 KB → 11 KB: every usable fact id, once per document
  "GET /api/renders/:ref/page": 96 * KB, // 1.67 MB → 39 KB
  "GET /api/renders/english_resume/page": 96 * KB, // 840 KB → 55 KB: every accepted fact, read for the skills line
  "GET /api/proposals/:id (generating)": 16 * KB, // 1.94 MB → 4 KB: every usable fact and its claim, on each poll
  "GET /api/applications/:id": 48 * KB, // 881 KB → 12 KB
  "GET /api/renders": 32 * KB, // 872 KB → 4 KB
  // Read on a visit. The flagged list and the master document show every
  // fact they hold, so what they read is what they show.
  "GET /api/flags": 1_000 * KB, // 1.2 MB → 864 KB
  "GET /api/master-document": 3_200 * KB, // 2.7 MB → 2.7 MB
  "GET /api/master-document/preview": 16 * KB, // Home's card read the whole document, 2.7 MB → 4 KB
  "GET /api/applications": 16 * KB, // 56 KB → 5 KB: each tailored résumé's posting, on every sidebar screen
  "GET /api/skills/curation": 700 * KB, // 6.6 MB → 1.4 MB → 573 KB
  "GET /api/career-timeline": 32 * KB, // 9 KB → 9 KB
  "GET /api/source-documents/:id/versions/:n/text": 128 * KB, // 83 KB → 83 KB: the text is the answer
  // One click.
  "POST /api/facts/:id/accept": 2_600 * KB, // 3.1 MB → 2.2 MB
  "PATCH /api/facts/:id (employer)": 2_600 * KB, // 5.0 MB → 2.3 MB
  "POST /api/flags/:id/check": 32 * KB, // 8 KB → 8 KB
  // Jobs.
  "generation (english_resume)": 2_200 * KB, // 19.2 MB → 2.6 MB → 1.8 MB
  "import (40 KB document)": 2_800 * KB, // 3.3 MB → 2.3 MB
};

/** The export reads the whole record because it is the backup (`docs/03` §12). */
const UNBUDGETED = new Set(["GET /api/export"]);
const measuredPaths: string[] = [];

let model: StubModel;
let client: Client;
let volume: SeededVolume;
let userId: string;
const db = () => createDb((env as unknown as Bindings).DATABASE_URL);

beforeAll(async () => {
  model = stubModel();
  const user = await seedAllowedUser();
  userId = user.id;
  client = harness(model).as(user);
  volume = await seedVolume(user);
}, 180_000);

const report = (path: string, use: Egress) =>
  console.log(JSON.stringify({ event: "egress", path, requests: use.requests, rows: use.rows, bytes: use.bytes }));

async function measure(path: string, work: () => Promise<unknown>): Promise<Egress> {
  const use = await metered(work);
  report(path, use);
  measuredPaths.push(path);
  const budget = BUDGET[path];
  if (budget !== undefined) expect(use.bytes, `${path} read ${use.bytes} bytes`).toBeLessThanOrEqual(budget);
  return use;
}

const ok = async (response: Promise<Response>) => {
  const answered = await response;
  expect(answered.status, await answered.clone().text().then((t) => t.slice(0, 200))).toBeLessThan(300);
  return answered.json();
};

/** Every page of a fact listing, as Fact Review's rail reads one. */
async function allPages(query: string) {
  let cursor: string | null = null;
  do {
    const page = (await ok(client.get(`/api/facts?${query}${cursor ? `&cursor=${cursor}` : ""}`))) as { nextCursor: string | null };
    cursor = page.nextCursor;
  } while (cursor);
}

describe("database egress at the real record's size", () => {
  it(`seeds ${REAL_RECORD.facts} facts`, () => {
    expect(volume.factIds).toHaveLength(REAL_RECORD.facts);
  });

  describe("polled while an import runs", () => {
    it("the import's own status", async () => {
      await measure("GET /api/imports/:id", () => ok(client.get(`/api/imports/${volume.importIds[0]}`)));
    });

    it("the home screen, with an import being read", async () => {
      const db = createDb((env as unknown as Bindings).DATABASE_URL);
      const running = volume.importIds[volume.importIds.length - 1]!;
      await db.update(sourceDocumentVersions).set({ importStatus: "extracting" })
        .where(eq(sourceDocumentVersions.id, running));
      try {
        await measure("GET /api/overview (import running)", () => ok(client.get("/api/overview")));
      } finally {
        await db.update(sourceDocumentVersions).set({ importStatus: "ready" }).where(eq(sourceDocumentVersions.id, running));
      }
    });

    it("Fact Review's rail: every page of one import's facts", async () => {
      await measure("GET /api/facts?importId (all pages)", () => allPages(`importId=${volume.importIds[0]}`));
    });

    it("Fact Review's rail on an import whose facts may repeat others", async () => {
      // The volume flags a repeat on every fortieth accepted fact; the second
      // document's facts include some.
      await measure("GET /api/facts?importId (all pages, repeat flags)", () => allPages(`importId=${volume.importIds[1]}`));
    });

    it("the sidebar badge", async () => {
      await measure("GET /api/imports/summary", () => ok(client.get("/api/imports/summary")));
    });

    it("the documents listing", async () => {
      await measure("GET /api/imports", () => ok(client.get("/api/imports")));
    });
  });

  describe("polled while a document is generated", () => {
    it("the home screen", async () => {
      await measure("GET /api/overview", () => ok(client.get("/api/overview")));
    });

    it("the document's page", async () => {
      await measure("GET /api/renders/:ref/page", () => ok(client.get("/api/renders/career_story_en/page")));
    });

    it("the English résumé's page, which Home's card reads too", async () => {
      await measure("GET /api/renders/english_resume/page", () => ok(client.get("/api/renders/english_resume/page")));
    });

    it("the proposal the author waits on while it is written", async () => {
      const id = `rp_${userId.slice(-8)}_writing`;
      await db().insert(renderProposals).values({
        id,
        userId,
        renderId: volume.renderIds.career_story_ja,
        content: { sections: [] },
        status: "pending",
        generationStatus: "generating",
        usableFactIds: volume.usableFactIds,
      });
      try {
        const read = await measure("GET /api/proposals/:id (generating)", () => ok(client.get(`/api/proposals/${id}`)));
        expect(read.requests).toBeGreaterThan(0);
      } finally {
        await db().update(renderProposals).set({ generationStatus: "failed", generationError: "Measured." })
          .where(and(eq(renderProposals.userId, userId), eq(renderProposals.id, id)));
      }
    });

    it("the application", async () => {
      await measure("GET /api/applications/:id", () => ok(client.get(`/api/applications/${volume.applicationId}`)));
    });

    it("the documents' states", async () => {
      await measure("GET /api/renders", () => ok(client.get("/api/renders")));
    });
  });

  describe("read on a visit", () => {
    it("the flagged list", async () => {
      await measure("GET /api/flags", () => ok(client.get("/api/flags")));
    });

    it("Home's picture of the master document", async () => {
      await measure("GET /api/master-document/preview", () => ok(client.get("/api/master-document/preview")));
    });

    it("the applications, which the sidebar reads on every screen", async () => {
      // Ten more applications, each with a tailored résumé and its posting.
      const tag = userId.slice(-8);
      const posting = "An invented posting with its requirements set out at length. ".repeat(80);
      for (let a = 0; a < 10; a++) {
        await db().insert(applications).values({ id: `app_${tag}_${a}`, userId, company: `Invented Co ${a}`, position: "Engineer", jobDescription: posting });
        await db().insert(renders).values({ id: `rnd_${tag}_app${a}`, userId, kind: "english_resume", label: `Invented Co ${a}`, jobDescription: posting, applicationId: `app_${tag}_${a}` });
        await db().insert(applicationDocuments).values({ id: `apd_${tag}_${a}`, userId, applicationId: `app_${tag}_${a}`, renderId: `rnd_${tag}_app${a}` });
      }
      await measure("GET /api/applications", () => ok(client.get("/api/applications")));
    });

    it("the master document", async () => {
      await measure("GET /api/master-document", () => ok(client.get("/api/master-document")));
    });

    it("the skills curation", async () => {
      await measure("GET /api/skills/curation", () => ok(client.get("/api/skills/curation")));
    });

    it("the career timeline", async () => {
      await measure("GET /api/career-timeline", () => ok(client.get("/api/career-timeline")));
    });

    it("the source pane", async () => {
      await measure("GET /api/source-documents/:id/versions/:n/text", () =>
        ok(client.get(`/api/source-documents/${volume.documentIds[0]}/versions/1/text`)));
    });
  });

  describe("one click", () => {
    it("accepting a candidate", async () => {
      await measure("POST /api/facts/:id/accept", () => ok(client.post(`/api/facts/${volume.candidateId}/accept`)));
    });

    it("refiling a fact under another employer", async () => {
      await measure("PATCH /api/facts/:id (employer)", () =>
        ok(client.patch(`/api/facts/${volume.repeatFlaggedId}`, { employerId: volume.employerIds[1] })));
    });

    it("marking a flag checked", async () => {
      await measure("POST /api/flags/:id/check", () => ok(client.post(`/api/flags/${volume.openFlagId}/check`)));
    });
  });

  describe("jobs", () => {
    it("generating a document, start to proposal", async () => {
      const cited = volume.usableFactIds.slice(0, 6);
      model.generations = [{
        sections: [{
          key: "projects",
          heading: "Projects",
          blocks: cited.map((factId, i) => ({ id: `blk_${i + 1}`, kind: "bullet" as const, text: `Rebuilt the batch ${i}.`, factIds: [factId] })),
        }],
      }];
      await measure("generation (english_resume)", async () => {
        const response = await client.post("/api/renders/english_resume/generate");
        expect(response.status).toBeLessThan(300);
        await settle();
      });
    });

    it("importing a 40 KB document", async () => {
      const paragraphs = Array.from({ length: 160 }, (_, p) =>
        `Paragraph ${p} of the invented import: the team moved the ${p}th job onto the shared scheduler and cut its runtime by ${p % 40} minutes.`);
      const text = `# Invented import\n\n${paragraphs.join("\n\n")}\n`;
      const chunks = Math.ceil(text.length / 2000) + 2;
      model.extractions = Array.from({ length: chunks }, (_, c) =>
        paragraphs.slice(c * 8, c * 8 + 8).map((quote) => ({ claim: `Claimed: ${quote}`, quote, technologies: ["Airflow"], provenance: "attested" as const })));
      const form = new FormData();
      form.set("file", new File([text], "invented-import.md", { type: "text/markdown" }));
      await measure("import (40 KB document)", async () => {
        const response = await client.request("/api/imports", { method: "POST", body: form });
        expect(response.status).toBeLessThan(300);
        await settle();
      });
    });

    it("the export, for scale: the whole record by design", async () => {
      await measure("GET /api/export", async () => {
        const response = await client.get("/api/export");
        expect(response.status).toBe(200);
        await response.arrayBuffer();
      });
    });
  });

  describe("the export at a size one read cannot carry", () => {
    it("pages the document history, and reads no photo", async () => {
      // A hundred more versions of one document, each carrying every usable
      // fact's id: past the 10 MiB one HTTP response may hold on the local proxy.
      const renderId = volume.renderIds.career_story_en;
      const [{ content }] = (await db().select({ content: renderVersions.content }).from(renderVersions)
        .where(eq(renderVersions.renderId, renderId)).limit(1)) as [{ content: unknown }];
      for (let v = 100; v < 200; v += 20) {
        await db().insert(renderVersions).values(Array.from({ length: 20 }, (_, i) => ({
          id: `rv_${userId.slice(-8)}_history_${v + i}`,
          userId,
          renderId,
          versionNo: v + i,
          content,
          factCountAt: volume.usableFactIds.length,
          usableFactIds: volume.usableFactIds,
        })));
      }
      const [{ ids, versions }] = (await db().select({
        ids: sql<number>`sum(length(${renderVersions.usableFactIds}::text))::int`,
        versions: sql<number>`count(*)::int`,
      }).from(renderVersions).where(eq(renderVersions.userId, userId))) as [{ ids: number; versions: number }];
      expect(ids).toBeGreaterThan(10 * 1024 * 1024);

      const response = await client.get("/api/export");
      expect(response.status, await response.clone().text().then((t) => t.slice(0, 200))).toBe(200);
      const backup = (await response.json()) as {
        profile: Record<string, unknown>[];
        renderVersions: { id: string; usableFactIds: string[] }[];
        renderProposals: unknown[];
      };
      expect(backup.renderVersions).toHaveLength(versions);
      expect(new Set(backup.renderVersions.map((version) => version.id)).size).toBe(versions);
      expect(backup.renderVersions.every((version) => version.usableFactIds.length === volume.usableFactIds.length)).toBe(true);
      expect(backup.renderProposals.length).toBeGreaterThan(0);
      expect(backup.profile).toHaveLength(1);
      expect(backup.profile[0]).toMatchObject({ hasPhoto: true });
      expect(backup.profile[0]).not.toHaveProperty("photo");
      expect(backup.profile[0]).not.toHaveProperty("userId");
    }, 120_000);
  });

  it("budgets every path but the export", () => {
    expect(measuredPaths.filter((path) => !UNBUDGETED.has(path) && BUDGET[path] === undefined)).toEqual([]);
    expect(Object.keys(BUDGET).filter((path) => !measuredPaths.includes(path))).toEqual([]);
  });
});
