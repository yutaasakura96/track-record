/**
 * Seeds an INVENTED record into a local demo database, so the MCP server can be
 * tried without the author's data (`docs/specs/mcp-spike.md`).
 *
 *   npx tsx scripts/mcp/seed-demo.ts postgresql://postgres:postgres@localhost:5432/track_record_mcp_demo?sslmode=disable
 *
 * Refuses any database whose name does not end in `_demo`: this writes rows,
 * and the dev database holds a real record. Re-running adds nothing — the demo
 * user is found by email and left as it is.
 */
import { eq } from "drizzle-orm";
import { anchorQuote } from "~/pipeline/quote";
import { dedupeHash } from "~/pipeline/dedupe";
import { createDb } from "~/server/db/client";
import {
  employers,
  facts,
  profiles,
  roles,
  sourceDocumentVersions,
  sourceDocuments,
  users,
} from "~/server/db/schema";
import { databaseTarget } from "../../tests/database-guard";

const DEMO_EMAIL = "mcp-demo@example.invalid";

const SOURCE = [
  "# Harbourline routing rewrite",
  "",
  "The dispatch planner recomputed every route on each order change.",
  "Route planning time fell from 40 seconds to 3 seconds after the incremental rewrite.",
  "",
  "The team moved from weekly releases to deploying on every merge.",
  "",
  "The rewrite also covered the client's internal fleet tracker, codenamed blue_heron.",
  "",
  "On-call pages for the planner dropped noticeably in the following quarter.",
].join("\n");

const FACTS = [
  {
    claim: "Cut route planning time from 40 seconds to 3 seconds with an incremental planner",
    quote: "Route planning time fell from 40 seconds to 3 seconds after the incremental rewrite.",
    provenance: "measured",
    disclosure: "public",
    technologies: ["Go", "PostgreSQL"],
  },
  {
    claim: "Moved the team from weekly releases to continuous deployment",
    quote: "The team moved from weekly releases to deploying on every merge.",
    provenance: "attested",
    disclosure: "restricted",
    technologies: ["GitHub Actions"],
  },
  {
    claim: "Rebuilt the client's internal fleet tracker",
    quote: "The rewrite also covered the client's internal fleet tracker, codenamed blue_heron.",
    provenance: "measured",
    disclosure: "private",
    technologies: [],
  },
  {
    claim: "Reduced planner on-call pages by half",
    quote: "On-call pages for the planner dropped noticeably in the following quarter.",
    provenance: "generated",
    disclosure: "public",
    technologies: [],
  },
] as const;

async function main() {
  const url = process.argv[2] ?? "";
  const target = url === "" ? null : databaseTarget(url);
  if (!target || !target.database.endsWith("_demo")) {
    console.error("seed-demo refused: pass a local connection string whose database name ends in _demo.");
    process.exit(1);
  }
  const db = createDb(url);

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_EMAIL));
  if (existing) {
    console.log(`Demo user already present (${existing.id}). Nothing added.`);
    return;
  }

  const userId = "usr_mcp_demo";
  await db.insert(users).values({ id: userId, email: DEMO_EMAIL, name: "Mika Demo", emailVerified: true });
  await db.insert(profiles).values({
    id: "prf_mcp_demo",
    userId,
    familyNameKanji: "見本",
    givenNameKanji: "美香",
    familyNameKana: "みほん",
    givenNameKana: "みか",
    nameLatin: "Mika Mihon",
    dateOfBirth: "1990-01-01",
    phone: "000-0000-0000",
    email: DEMO_EMAIL,
    postalCode: "000-0000",
    address: "東京都架空区見本町0-0-0",
    addressKana: "とうきょうと かくうく みほんちょう",
  });
  await db.insert(employers).values({
    id: "emp_mcp_demo",
    userId,
    nameJa: "株式会社ハーバーライン",
    nameLatin: "Harbourline K.K.",
    city: "Yokohama",
    industryJa: "運輸業",
    employmentType: "full_time",
    startedOn: "2021-04-01",
  });
  await db.insert(roles).values({
    id: "rol_mcp_demo",
    userId,
    employerId: "emp_mcp_demo",
    titleLatin: "Software Engineer",
    titleJa: "ソフトウェアエンジニア",
    startedOn: "2021-04-01",
  });
  await db.insert(sourceDocuments).values({
    id: "doc_mcp_demo",
    userId,
    filename: "harbourline-routing.md",
    mimeType: "text/markdown",
  });
  const bytes = new TextEncoder().encode(SOURCE);
  await db.insert(sourceDocumentVersions).values({
    id: "sdv_mcp_demo",
    userId,
    sourceDocumentId: "doc_mcp_demo",
    versionNo: 1,
    originalBytes: Buffer.from(bytes),
    extractedText: SOURCE,
    extractorVersion: "demo",
    byteSize: bytes.byteLength,
    wordCount: SOURCE.split(/\s+/u).length,
    importStatus: "ready",
  });

  let n = 0;
  for (const fact of FACTS) {
    // The same anchor every fact passes. A fixture that could not pass it would
    // be demonstrating a record this application cannot hold.
    const anchor = anchorQuote(SOURCE, fact.quote);
    if (!anchor) throw new Error("A demo quote is not verbatim in the demo source.");
    await db.insert(facts).values({
      id: `fct_mcp_demo_${++n}`,
      userId,
      employerId: "emp_mcp_demo",
      claim: fact.claim,
      provenance: fact.provenance,
      disclosure: fact.disclosure,
      status: "accepted",
      resolvedAt: new Date(),
      sourceDocumentVersionId: "sdv_mcp_demo",
      quote: anchor.quote,
      quoteStart: anchor.quoteStart,
      quoteEnd: anchor.quoteEnd,
      lineNumber: anchor.lineNumber,
      dedupeHash: await dedupeHash(anchor.quote, fact.claim),
      technologies: [...fact.technologies],
    });
  }
  console.log(`Seeded ${DEMO_EMAIL} (${userId}) with ${FACTS.length} accepted facts.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "seed-demo failed.");
  process.exit(1);
});
