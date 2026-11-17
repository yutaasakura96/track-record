/**
 * The model seam's other jobs, done by the caller (`docs/specs/mcp-spike.md`).
 *
 * The app calls a model for seven things. `get_record` and `save_render` cover
 * writing a document, and `add_fact` covers reading a source. These tools
 * cover the rest the author starts by hand: reading a job posting, capturing
 * a typed note, explaining a flag, and grading facts imported before the
 * importer graded. Shortening a résumé's long lines needs no tool:
 * `save_render` refuses them and Claude rewrites its own.
 *
 * Each job's rules are the app's own system prompt, given by
 * `get_instructions`, so Claude is held to what the model is. Every store goes
 * through the function its route uses, with the route's own schema, so a value
 * the screen would refuse is refused here in the same words.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "~/server/db/client";
import { applications, employers, factFlags, facts, projects, renders } from "~/server/db/schema";
import { createApplication, createBody } from "~/server/routes/applications";
import { addTailored } from "~/server/routes/application-documents";
import { saveCaptured, saveBody } from "~/server/routes/capture";
import { applyGrades, SORT_BATCH } from "~/server/routes/facts";
import { factOfFlag, requireFlag, storeExplanation } from "~/server/routes/flags";
import { EXTRACTION_SYSTEM_PROMPT } from "~/model/extract";
import { READ_POSTING_SYSTEM_PROMPT } from "~/model/posting";
import { CAPTURE_SYSTEM_PROMPT } from "~/model/capture";
import { EXPLAIN_SYSTEM_PROMPT } from "~/model/explain";
import { GRADING_SYSTEM_PROMPT } from "~/model/grade";
import type { FactGrade } from "~/model";
import { Refused, guarded, ok } from "./result";

/**
 * Each job: the app's prompt, and how its answer reaches the record here. The
 * prompts were written for the app's internal tools and a model that answers
 * once; `then` names the tool that replaces that answer, and says when the
 * author confirms first, as the screen has them do.
 */
const JOBS = {
  extract: {
    instructions: EXTRACTION_SYSTEM_PROMPT,
    then:
      "Read the source with get_source. Where these instructions say to call extract_fact, call add_fact " +
      "instead, with source_document_id and the grade (provenance, confidential, unsure, note).",
  },
  read_posting: {
    instructions: READ_POSTING_SYSTEM_PROMPT,
    then:
      "Where these instructions say to call record_posting, show the author the company, position and " +
      "requirements you read instead, and when they confirm or correct them, call add_application with " +
      "those and the posting's full text. Then tailor_document makes the résumé for it.",
  },
  capture: {
    instructions: CAPTURE_SYSTEM_PROMPT,
    then:
      "Where these instructions say to call record_claims, show the author each claim with its month and " +
      "employer or project instead, and say what it is missing. Call capture_facts only with the claims the " +
      "author confirms: they are saved as Attested, the author's own word. `employers` and `projects` are " +
      "the lists to match names against.",
  },
  explain_flag: {
    instructions: EXPLAIN_SYSTEM_PROMPT,
    then:
      "list_flags gives each open flag with its fact. Write the explanation to the author, and store it " +
      "with explain_flag so the Flagged screen shows it.",
  },
  grade: {
    instructions: GRADING_SYSTEM_PROMPT,
    then:
      "list_waiting_facts gives the facts. Where these instructions say to call grade_fact, call " +
      "grade_facts once with a grade for every fact you were given.",
  },
} as const;

const JOB_NAMES = Object.keys(JOBS) as [keyof typeof JOBS, ...(keyof typeof JOBS)[]];

const gradeSchema = z.object({
  id: z.string(),
  provenance: z.enum(["measured", "attested", "generated"]),
  confidential: z.boolean(),
  unsure: z.boolean(),
  note: z.string().max(500).default(""),
});

const EXPLANATION_MAX = 2000;

export function registerJobTools(server: McpServer, db: Db, userId: string) {
  server.registerTool(
    "get_instructions",
    {
      title: "Get a job's instructions",
      description:
        "Track Record's own system prompt for one job, with how its answer is saved here. Call it before " +
        "the job and follow it exactly. Jobs: extract (read a source into facts), read_posting (read a job " +
        "posting into an application), capture (turn what the author typed into facts), explain_flag " +
        "(explain why a fact was flagged), grade (grade facts waiting from before the importer graded).",
      inputSchema: { job: z.enum(JOB_NAMES) },
    },
    ({ job }) =>
      guarded("get_instructions", async () => {
        if (job !== "capture") return ok({ job, ...JOBS[job] });
        const [employerRows, projectRows] = await Promise.all([
          db.select({ id: employers.id, nameJa: employers.nameJa, nameLatin: employers.nameLatin }).from(employers)
            .where(eq(employers.userId, userId)).orderBy(asc(employers.startedOn)),
          db.select({ id: projects.id, name: projects.name, nameJa: projects.nameJa }).from(projects)
            .where(eq(projects.userId, userId)).orderBy(asc(projects.name)),
        ]);
        // Both of a name's forms, as `POST /api/capture/read` gives them.
        const both = (first: string, second: string | null) => (second && second !== first ? `${first} / ${second}` : first);
        return ok({
          job,
          ...JOBS.capture,
          today: new Date().toISOString().slice(0, 7),
          employers: employerRows.map((row) => ({ id: row.id, name: both(row.nameJa, row.nameLatin) })),
          projects: projectRows.map((row) => ({ id: row.id, name: both(row.name, row.nameJa) })),
        });
      }),
  );

  server.registerTool(
    "list_applications",
    {
      title: "List job applications",
      description:
        "The author's job applications, newest first, with the tailored documents each has. A tailored " +
        "document's id is the `document` get_record and save_render take.",
      inputSchema: {},
    },
    () =>
      guarded("list_applications", async () => {
        const [rows, tailored] = await db.batch([
          db.select({ id: applications.id, company: applications.company, position: applications.position, createdAt: applications.createdAt })
            .from(applications).where(eq(applications.userId, userId)).orderBy(sql`${applications.createdAt} desc`),
          db.select({ id: renders.id, kind: renders.kind, applicationId: renders.applicationId })
            .from(renders).where(and(eq(renders.userId, userId), sql`${renders.applicationId} is not null`)),
        ]);
        return ok({
          applications: rows.map((row) => ({
            id: row.id,
            company: row.company,
            position: row.position,
            tailored: tailored.filter((doc) => doc.applicationId === row.id).map((doc) => ({ document: doc.id, kind: doc.kind })),
          })),
        });
      }),
  );

  server.registerTool(
    "add_application",
    {
      title: "Add a job application",
      description:
        "Adds a job at Not applied, as the Applications screen does. Read the posting with " +
        "get_instructions('read_posting') first and have the author confirm what you read. job_description " +
        "is the posting's full text, which a tailored document is written toward.",
      inputSchema: {
        company: z.string(),
        position: z.string(),
        job_description: z.string(),
        posting_url: z.string().optional(),
        requirements: z.array(z.string()).optional(),
      },
    },
    ({ company, position, job_description, posting_url, requirements }) =>
      guarded("add_application", async () => {
        const body = createBody.parse({ company, position, jobDescription: job_description, postingUrl: posting_url, requirements });
        const id = await createApplication(db, userId, body);
        return ok({ application_id: id, next: "tailor_document makes a résumé or 履歴書 written toward it." });
      }),
  );

  server.registerTool(
    "tailor_document",
    {
      title: "Tailor a document to an application",
      description:
        "Gives an application its own English résumé or 履歴書, written toward its posting, and puts it on " +
        "the application. Generates nothing: pass the returned `document` to get_record, write it, and " +
        "save_render it. Asked again, it returns the one the application has.",
      inputSchema: {
        application_id: z.string(),
        kind: z.enum(["english_resume", "rirekisho"]),
      },
    },
    ({ application_id, kind }) =>
      guarded("tailor_document", async () => {
        const { renderId, created, replaced } = await addTailored(db, userId, application_id, kind);
        return ok({ document: renderId, created, replaced });
      }),
  );

  server.registerTool(
    "capture_facts",
    {
      title: "Save facts the author typed",
      description:
        "Saves claims about the author's work that left no document behind: accepted and Attested, with no " +
        "source and no quote. Follow get_instructions('capture') and save only the claims the author " +
        "confirmed. month is YYYY-MM; give employer_id or project_id, not both, from that job's lists.",
      inputSchema: {
        claims: z.array(
          z.object({
            claim: z.string(),
            month: z.string().optional(),
            employer_id: z.string().optional(),
            project_id: z.string().optional(),
            technologies: z.array(z.string()).optional(),
          }),
        ),
      },
    },
    ({ claims }) =>
      guarded("capture_facts", async () => {
        const body = saveBody.parse({
          claims: claims.map((claim) => ({
            claim: claim.claim,
            month: claim.month,
            employerId: claim.employer_id,
            projectId: claim.project_id,
            technologies: claim.technologies,
          })),
        });
        const { saved, flags } = await saveCaptured(db, userId, body);
        return ok({
          saved: saved.map((fact) => ({
            id: fact.id,
            disclosure: fact.disclosure,
            flags: (flags.get(fact.id) ?? []).map((flag) => flag.kind),
          })),
        });
      }),
  );

  server.registerTool(
    "list_flags",
    {
      title: "List open flags",
      description:
        "Flags the author has not marked checked, each with its fact (claim, quote, worth, disclosure) and " +
        "any explanation already stored. Explain one with get_instructions('explain_flag').",
      inputSchema: {},
    },
    () =>
      guarded("list_flags", async () => {
        const rows = await db
          .select({
            id: factFlags.id,
            kind: factFlags.kind,
            reason: factFlags.reason,
            explanation: factFlags.explanation,
            factId: facts.id,
            claim: facts.claim,
            quote: facts.quote,
            provenance: facts.provenance,
            disclosure: facts.disclosure,
          })
          .from(factFlags)
          .innerJoin(facts, factOfFlag(userId))
          .where(and(eq(factFlags.userId, userId), ne(facts.status, "rejected"), isNull(factFlags.checkedAt)))
          .orderBy(asc(factFlags.createdAt), asc(factFlags.id));
        return ok({
          flags: rows.map((row) => ({
            id: row.id,
            kind: row.kind,
            reason: row.reason,
            explanation: row.explanation,
            fact: { id: row.factId, claim: row.claim, quote: row.quote, provenance: row.provenance, disclosure: row.disclosure },
          })),
        });
      }),
  );

  server.registerTool(
    "explain_flag",
    {
      title: "Store a flag's explanation",
      description:
        "Stores the explanation you wrote for one flag, following get_instructions('explain_flag'), where the " +
        "Flagged screen shows it under Explain this. A flag already explained keeps its explanation.",
      inputSchema: { flag_id: z.string(), explanation: z.string() },
    },
    ({ flag_id, explanation }) =>
      guarded("explain_flag", async () => {
        const text = explanation.trim();
        if (text === "") throw new Refused("An explanation cannot be empty. Nothing was stored.");
        if (text.length > EXPLANATION_MAX) {
          throw new Refused(`Keep an explanation under ${EXPLANATION_MAX} characters. Nothing was stored.`);
        }
        const { flag } = await requireFlag(db, userId, flag_id);
        if (flag.explanation !== null) {
          throw new Refused(`${flag.id} is already explained, and keeps that explanation. Nothing was stored.`);
        }
        const stored = await storeExplanation(db, userId, flag, text, null);
        return ok({ flag: stored.id, stored: true });
      }),
  );

  server.registerTool(
    "list_waiting_facts",
    {
      title: "List facts waiting to be graded",
      description:
        `Facts imported before the importer graded on its own, still waiting: up to ${SORT_BATCH} at a time, ` +
        "each with its claim and the quote it was read from, and how many wait in all. Grade them with " +
        "get_instructions('grade') and grade_facts.",
      inputSchema: {},
    },
    () =>
      guarded("list_waiting_facts", async () => {
        const waiting = and(eq(facts.userId, userId), eq(facts.status, "candidate"));
        const [batch, [count]] = await db.batch([
          db.select({ id: facts.id, claim: facts.claim, quote: facts.quote }).from(facts).where(waiting).orderBy(asc(facts.id)).limit(SORT_BATCH),
          db.select({ waiting: sql<number>`count(*)::int` }).from(facts).where(waiting),
        ]);
        return ok({ facts: batch, waiting: count?.waiting ?? 0 });
      }),
  );

  server.registerTool(
    "grade_facts",
    {
      title: "Grade waiting facts",
      description:
        "Accepts waiting facts with the grades you give, as Sort does with the model's: a fact is kept " +
        "Private when confidential, Measured only with a passage that proves it, and flagged for the author " +
        "where it is worth a look. Give a grade for every fact list_waiting_facts returned.",
      inputSchema: { grades: z.array(gradeSchema).min(1).max(SORT_BATCH) },
    },
    ({ grades }) =>
      guarded("grade_facts", async () => {
        const ids = [...new Set(grades.map((grade) => grade.id))];
        const batch = await db
          .select()
          .from(facts)
          .where(and(eq(facts.userId, userId), eq(facts.status, "candidate"), inArray(facts.id, ids)))
          .orderBy(asc(facts.id));
        const unknown = ids.filter((id) => !batch.some((fact) => fact.id === id));
        if (unknown.length > 0) {
          throw new Refused(`${unknown.join(", ")} ${unknown.length === 1 ? "is" : "are"} not waiting to be graded. Nothing was stored.`);
        }
        const byId = new Map<string, FactGrade>(
          grades.map(({ id, ...grade }) => [id, { ...grade, note: grade.note ?? "" }]),
        );
        const { sortedIds, flagged } = await applyGrades(db, userId, batch, byId);
        const [count] = await db
          .select({ waiting: sql<number>`count(*)::int` })
          .from(facts)
          .where(and(eq(facts.userId, userId), eq(facts.status, "candidate")));
        // Counts only. No claim, no quote, no note.
        console.error(JSON.stringify({ event: "mcp_facts_graded", sorted: sortedIds.length, flagged }));
        return ok({ graded: sortedIds.length, flagged, waiting: count?.waiting ?? 0 });
      }),
  );
}
