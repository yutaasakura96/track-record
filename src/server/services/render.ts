/**
 * Generation, and the two exclusions that are the whole point of it.
 *
 * **Enforcement point 2 — generation input.** Private facts are filtered out
 * BEFORE the request is built. They never leave the database, rather than being
 * filtered out of the response afterwards.
 *
 * **Enforcement point 3 — render output.** Generated-provenance facts are
 * excluded at render time. A Generated fact may be *accepted* into the record;
 * the block lives here, at the point where disclosure actually happens, and not
 * at review, which would depend on review having happened correctly.
 *
 * (`docs/03-technical-design.md` §7.)
 */
import { and, asc, desc, eq, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  applications,
  certifications,
  educations,
  employers,
  facts,
  profiles,
  projects,
  renderProposals,
  renders,
  roles,
} from "../db/schema";
import type { ModelSeam, RenderFact, RenderSpec } from "~/model/types";
import { isStoryComplete, linesToShorten, repairResumeBounds } from "~/model/generate";
import { ModelCreditsExhaustedError, ModelUnavailableError, type ModelUsage } from "~/model/types";
import { logCreditsExhausted } from "./model-credits";
import type { RenderContent, RenderKind } from "~/shared/render-content";
import { RENDER_DEFINITIONS, TAILORED_REGISTER, type RenderDefinition } from "~/render/spec";
import {
  ENGLISH_DEFECT_REASON,
  MIXED_ENGLISH_DEFECT_REASON,
  englishDefect,
  hasJapaneseScript,
  isEnglishOnly,
  type EnglishDefect,
} from "~/render/language";
import {
  JAPANESE_DEFECT_REASON,
  MIXED_JAPANESE_DEFECT_REASON,
  japaneseDefect,
  recordRowDefectReason,
  type JapaneseDefect,
} from "~/render/japanese";
import { bulletBudget, rankedSkills } from "~/render/resume";
import { boundShokumuLists } from "~/render/skill-lists";
import { PROSE_SECTION_KEYS, careerGaps, explainedGaps, tokyoToday } from "~/render/rirekisho";
import { isChapteredStory } from "~/render/chapters";
import { collectRirekishoRecord } from "./rirekisho";
import { isExpired } from "~/render/shikaku";
import { recordSections, withRecordSections } from "~/render/shokumu";
import { excludesProject, exclusionsFor } from "./inclusion";
import { effectiveEmployerId } from "./employer";
import { factsWithinBudget } from "./fact-budget";
import { curatedGroups } from "./skills";
import { autoCuratedSkills, curationForRender } from "~/shared/skills";

export interface RenderInputs {
  facts: RenderFact[];
  spec: RenderSpec;
  /** A COUNT and nothing else. The footer states that something was withheld. */
  privateFactCount: number;
  /** Accepted facts held back because their provenance is Generated. */
  generatedFactCount: number;
  /** Usable facts this document was not sent: over an employer's budget (`./fact-budget.ts`). */
  omittedFactCount: number;
  /** Every accepted fact, however excluded — what staleness is measured against. */
  acceptedFactCount: number;
  /**
   * Every fact a document may use, whatever THIS render leaves out, from the
   * same read `facts` came from. Staleness compares it with the same set later
   * (`docs/06`, 2026-10-08), and an inclusion is not part of that.
   */
  usableFactIds: string[];
}

type Chronology = NonNullable<RenderDefinition["chronology"]>;

/** What a tailored document is written toward: its posting, and what its application knows. */
export interface Tailoring {
  jobDescription: string;
  application: RenderSpec["application"];
}

/**
 * The tailoring of a stored row: `null` for a main document. A tailored row's
 * application is read for its confirmed fields and the author's notes; one
 * whose application is gone (`on delete set null`) is still tailored to its
 * posting, with nothing more.
 */
export async function tailoringOf(
  db: Db,
  userId: string,
  render: Pick<typeof renders.$inferSelect, "jobDescription" | "applicationId">,
): Promise<Tailoring | null> {
  if (render.jobDescription === null) return null;
  const [application] = render.applicationId
    ? await db
        .select({
          company: applications.company,
          position: applications.position,
          requirements: applications.requirements,
          motivationNote: applications.motivationNote,
          kibouNote: applications.kibouNote,
        })
        .from(applications)
        .where(and(eq(applications.userId, userId), eq(applications.id, render.applicationId)))
        .limit(1)
    : [];
  return { jobDescription: render.jobDescription, application: application ?? null };
}

/**
 * The name a document of this language calls for, falling back to the other so
 * that a record holding only one still names the thing.
 *
 * The overloads carry a schema guarantee the pair of arguments does not: an
 * employer's 日本語 name is NOT NULL and its Latin name optional, a project's
 * default name is NOT NULL and its 日本語 name optional. One side is always
 * there, so this always returns a name — and stating which side per call is
 * what keeps that out of a non-null assertion at four call sites.
 */
export function nameInLanguage(language: "en" | "ja", ja: string, latin: string | null): string;
export function nameInLanguage(language: "en" | "ja", ja: string | null, latin: string): string;
export function nameInLanguage(
  language: "en" | "ja",
  ja: string | null,
  latin: string | null,
): string | null {
  return language === "ja" ? (ja ?? latin) : (latin ?? ja);
}

/**
 * Turns a list's SQL order into the order the document reads in.
 *
 * The SQL order is canonical and load-bearing — `educations` orders on
 * `coalesce(started_on, ended_on)` precisely so a row carrying only a
 * graduation month does not sort last — so a document that reads the other way
 * is served by reversing here, never by reordering the query. Reversing keeps
 * the coalesce and inverts only the `id` tie-break, which orders nothing a
 * reader can see. A `null` chronology belongs to a kind that cannot generate;
 * it takes the query's order and reaches no document.
 *
 * `dateOf` is passed by the one list whose sort key can be null, and moves the
 * rows carrying no date to the end of THE DOCUMENT'S list — after the direction
 * is applied, never before. Null placement does not survive a reversal:
 * Postgres sorts nulls first in `desc` and last in `asc`, so a rule fixed in
 * the query reads correctly in one direction and backwards in the other
 * (`docs/06`, 2026-09-07).
 */
export function inDocumentOrder<T>(
  rows: T[],
  sqlOrder: Chronology,
  document: Chronology | null,
  dateOf?: (row: T) => string | null,
): T[] {
  const read = document === null || document === sqlOrder ? rows : [...rows].reverse();
  if (!dateOf) return read;
  return [...read.filter((r) => dateOf(r) !== null), ...read.filter((r) => dateOf(r) === null)];
}

/** The accepted facts no document may use, counted and never read: Private, then Generated. */
const withheldCountQuery = (db: Db, userId: string) =>
  db
    .select({
      accepted: sql<number>`count(*)::int`,
      private: sql<number>`(count(*) filter (where ${facts.disclosure} = 'private'))::int`,
      generated: sql<number>`(count(*) filter (where ${facts.disclosure} <> 'private' and ${facts.provenance} = 'generated'))::int`,
    })
    .from(facts)
    .where(and(eq(facts.userId, userId), eq(facts.status, "accepted")));

/**
 * The two counts the review footer states, without the facts behind them. A
 * proposal still being written is polled every 1.5 s and needs these and
 * nothing else from the record (`docs/06`, 2026-11-04).
 */
export async function withheldFactCounts(db: Db, userId: string): Promise<Pick<RenderInputs, "privateFactCount" | "generatedFactCount">> {
  const [counted] = await withheldCountQuery(db, userId);
  return { privateFactCount: counted?.private ?? 0, generatedFactCount: counted?.generated ?? 0 };
}

/** How many usable facts carry exactly this set of technologies, under this employer. */
export interface TechnologySet {
  technologies: string[];
  employerId: string | null;
  count: number;
}

/**
 * What `technologiesOnly` answers: the record's lists, and the usable facts'
 * technologies grouped into sets, instead of one row per fact.
 */
export type TechnologyInputs = Omit<RenderInputs, "facts" | "usableFactIds" | "omittedFactCount"> & {
  technologySets: TechnologySet[];
};

export async function collectRenderInputs(
  db: Db,
  userId: string,
  kind: RenderKind,
  subjectName: string,
  tailoring: Tailoring | null,
  options: { technologiesOnly: true },
): Promise<TechnologyInputs>;
export async function collectRenderInputs(
  db: Db,
  userId: string,
  kind: RenderKind,
  subjectName: string,
  tailoring?: Tailoring | null,
  options?: { forModel?: boolean; claims?: boolean },
): Promise<RenderInputs>;
export async function collectRenderInputs(
  db: Db,
  userId: string,
  kind: RenderKind,
  subjectName: string,
  /** Set for a tailored document. The facts it is given are the main document's. */
  tailoring: Tailoring | null = null,
  /**
   * `forModel` holds the facts to the budget (`./fact-budget.ts`), for the one
   * caller that sends them. Every other caller assembles a file or checks text
   * and reads every usable fact: a résumé's skills, for one, come from them.
   */
  options: {
    forModel?: boolean;
    /**
     * `false` for a caller that reads only the facts' technologies — the skills
     * curation and the résumé's skills line — so the claims are not read from
     * the database to be thrown away. Their facts carry an empty claim.
     */
    claims?: boolean;
    /**
     * For a caller that reads only the record's lists and the usable facts'
     * technologies — the résumé's file and page, and the Skills screen's pool.
     * The facts are not read one row per fact: their technologies come back
     * grouped into sets, counted in SQL, under the same filters (`docs/06`,
     * 2026-11-04). The answer carries no facts and no fact ids.
     */
    technologiesOnly?: boolean;
  } = {},
): Promise<RenderInputs | TechnologyInputs> {
  // `employerId` is the employer each fact RESOLVES to — its hand-set one, then
  // its document's, then its project's (`docs/04` §3.12) — so every exclusion,
  // filing and heading below reads the order Version Edit and the attribution
  // check read. It used to be the fact's own column, with the project passed
  // separately, and a fact filed only through its project or its document
  // reached the model as filed under nothing.
  //
  // The columns read below and no others. This read every column of every
  // accepted fact — the quote, the hashes, the timestamps — once per stage of a
  // generation and once more per skills or résumé read, about 6 MB each time on
  // a nine-thousand-fact record (`docs/06`, 2026-11-04). A claim is read only
  // for a fact a document may use, and a Private or Generated fact is not read
  // at all: it is counted, in SQL, and goes no further.
  const acceptedFact = and(eq(facts.userId, userId), eq(facts.status, "accepted"));
  const acceptedQuery = db
      .select({
        id: facts.id,
        // A run for the model reads the claims of the facts the budget keeps,
        // below, once it knows which: a few hundred, not every usable fact.
        claim: options.claims === false || options.forModel ? sql<string>`''` : facts.claim,
        provenance: facts.provenance,
        disclosure: facts.disclosure,
        technologies: facts.technologies,
        projectId: facts.projectId,
        sourceDocumentVersionId: facts.sourceDocumentVersionId,
        quoteStart: facts.quoteStart,
        employerId: effectiveEmployerId,
      })
      .from(facts)
      .where(and(acceptedFact, ne(facts.disclosure, "private"), ne(facts.provenance, "generated")));
  const [accepted, [counted]] = options.technologiesOnly
    ? [[] as Awaited<typeof acceptedQuery>, await withheldCountQuery(db, userId)]
    : await db.batch([acceptedQuery, withheldCountQuery(db, userId)]);

  const employerRows = await db
    .select()
    .from(employers)
    .where(eq(employers.userId, userId))
    .orderBy(desc(employers.startedOn));
  const projectRows = await db.select().from(projects).where(eq(projects.userId, userId));
  // One column, not the row: `profiles` carries the restricted PII the 履歴書
  // spec alone may read (`docs/04` §3.2), and this payload goes to a model.
  const [profileRow] = await db
    .select({ desiredRoleNote: profiles.desiredRoleNote })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  // Roles are what give an employer section its TITLE. Without them the model
  // had only the claim prose to take one from (`docs/06`, 2026-09-04).
  const roleRows = await db
    .select()
    .from(roles)
    .where(eq(roles.userId, userId))
    .orderBy(desc(roles.startedOn));
  // 学歴 and 免許・資格. Neither reached this spec until 2026-09-06, and the
  // consequence was not a thinner education section but no education section
  // at all: a career fact that happened at no employer and on no project had
  // nowhere in the register to land, so it left the document (`docs/06`).
  const educationRows = await db
    .select()
    .from(educations)
    .where(eq(educations.userId, userId))
    // Ascending is the canonical order, because that is the order 学歴 is read
    // in. A document that reads the other way reverses it at the boundary
    // below, never here. Ordered on the coalesce rather than on `started_on`,
    // because a row that carries only a graduation month has a null there and
    // Postgres sorts nulls LAST in ASC — which would put the author's oldest
    // schooling at the bottom of the list, in either direction.
    .orderBy(asc(sql`coalesce(${educations.startedOn}, ${educations.endedOn})`), asc(educations.id));
  // Nulls sort FIRST in `desc`, so this query leads with the undated rows. That
  // is not corrected here: where an undated certification belongs is a question
  // about the document, and the boundary below answers it in both directions.
  const certificationRows = await db
    .select()
    .from(certifications)
    .where(eq(certifications.userId, userId))
    .orderBy(desc(certifications.issuedOn), asc(certifications.id));
  const employerById = new Map(employerRows.map((e) => [e.id, e]));
  const projectById = new Map(projectRows.map((p) => [p.id, p]));
  const rolesByEmployer = new Map<string, typeof roleRows>();
  for (const role of roleRows) {
    const held = rolesByEmployer.get(role.employerId) ?? [];
    held.push(role);
    rolesByEmployer.set(role.employerId, held);
  }

  // S13. An entry left out of THIS render takes its facts with it: a fact filed
  // under an employer the document has no section for is a fact the model has
  // nowhere to put, and that is what `unfiled-fact` reports (`docs/06`,
  // 2026-09-13). A role follows its employer: roles are read only through the
  // employers that remain.
  const excluded = await exclusionsFor(db, userId, kind);
  const includedEmployers = employerRows.filter((e) => !excluded.employer.has(e.id));
  const includedProjects = projectRows.filter((p) => !excludesProject(excluded, p));
  const includedEducations = educationRows.filter((e) => !excluded.education.has(e.id));
  const excludedProjectIds = new Set(
    projectRows.filter((p) => excludesProject(excluded, p)).map((p) => p.id),
  );

  // The same four filters as `usable` below, applied in SQL.
  const technologySets = options.technologiesOnly
    ? await usableTechnologySets(db, userId, [...excluded.employer], [...excludedProjectIds])
    : null;

  // Every filter runs here, before the request is built. Nothing downstream can
  // reintroduce an excluded fact, because nothing downstream ever sees one.
  const usable = accepted.filter(
    (f) =>
      f.disclosure !== "private" &&
      f.provenance !== "generated" &&
      !(f.employerId !== null && excluded.employer.has(f.employerId)) &&
      !(f.projectId !== null && excludedProjectIds.has(f.projectId)),
  );
  // Last, so a fact excluded above never takes a place in the budget.
  const budgeted = options.forModel
    ? await factsWithinBudget(db, userId, usable)
    : usable;
  const sent = options.forModel && options.claims !== false
    ? await withClaims(db, userId, budgeted)
    : budgeted;

  // Bound before the facts are mapped, not after: the employer and project
  // names carried on a FACT follow the document's language for the same reason
  // the headings do, and a fact naming its employer in the other language would
  // leave the model reconciling two spellings before it could file anything.
  const definition = RENDER_DEFINITIONS[kind];
  const today = tokyoToday();
  // S9. Read only for a render with a skills section, and narrowed to what
  // THIS render is given: the technologies on the facts that survived every
  // filter above, and on the certifications, which no render leaves out. The
  // budget is not one of those filters: a skill the author curated stays on the
  // list when the fact naming it was not the one sent.
  const curation = definition.skillsSection ? await curatedGroups(db, userId) : [];
  // The 履歴書's gaps, for the stories alone (`RenderSpec.careerGaps`). Read
  // through the 履歴書's own record so they are the gaps its table shows,
  // after ITS exclusions rather than this render's.
  const gapRecord = isChapteredStory(kind) ? await collectRirekishoRecord(db, userId) : null;
  const explained = gapRecord ? explainedGaps(gapRecord) : [];
  const gaps = gapRecord
    ? careerGaps(gapRecord).map((gap) => ({
        from: gap.from,
        to: gap.to,
        months: gap.months,
        explanation: explained.find((e) => e.gap.from === gap.from)?.note.text ?? null,
      }))
    : [];
  const renderable = new Set([
    ...(technologySets ?? usable).flatMap((f) => f.technologies),
    ...certificationRows.flatMap((c) => c.technologies),
  ]);
  // A fact repeats its employer's industry and its project's summary, and an
  // English prompt can label neither inside the facts' JSON. Repeated once per
  // fact, an unlabelled Japanese industry was the commonest Japanese in the
  // prompt of the English story that came back in Japanese (issue #104). The
  // Employers and Projects lists still carry both, labelled. A Japanese prompt
  // drops an English-only one the same way (issue #117).
  const carried = (value: string | null) => {
    if (value === null) return null;
    if (definition.language === "en") return hasJapaneseScript(value) ? null : value;
    return isEnglishOnly(value) ? null : value;
  };
  const renderFacts: RenderFact[] = sent.map((f) => {
    const employer = f.employerId ? employerById.get(f.employerId) : undefined;
    const project = f.projectId ? projectById.get(f.projectId) : undefined;
    return {
      id: f.id,
      claim: f.claim,
      provenance: f.provenance as "measured" | "attested",
      disclosure: f.disclosure as "public" | "restricted",
      technologies: f.technologies,
      ...(employer
        ? {
            employer: {
              id: employer.id,
              name: nameInLanguage(definition.language, employer.nameJa, employer.nameLatin),
              startedOn: employer.startedOn,
              endedOn: employer.endedOn,
              industry: carried(employer.industryJa),
            },
          }
        : {}),
      ...(project
        ? {
            project: {
              name: nameInLanguage(definition.language, project.nameJa, project.name),
              summary: (definition.language === "ja" ? project.summaryJa : null) ?? carried(project.summary),
            },
          }
        : {}),
    };
  });

  return {
    facts: renderFacts,
    spec: {
      kind,
      language: definition.language,
      subjectName,
      register: (tailoring ? TAILORED_REGISTER[kind] : undefined) ?? definition.register,
      // Newest-first out of SQL; the document decides whether it stays that
      // way. The 履歴書's 職歴 block reads ascending (`docs/04` §4).
      employers: inDocumentOrder(includedEmployers, "newest_first", definition.chronology).map((e, position) => ({
        id: e.id,
        // The same language rule the role titles below follow, and for the same
        // reason. This read `nameLatin ?? nameJa` until the first 職務経歴書 was
        // generated and headed every employer with its Latin name while the
        // record held 株式会社… for all four (`docs/06`, 2026-09-12). A Japanese
        // document writes the Japanese name; the fallback runs both ways so an
        // employer recorded under only one name still has a heading.
        name: nameInLanguage(definition.language, e.nameJa, e.nameLatin),
        industry: e.industryJa,
        startedOn: e.startedOn,
        endedOn: e.endedOn,
        businessDescription: e.businessDescription,
        employmentType: e.employmentType,
        // 資本金 and 従業員数. Carried on the employer row since the schema was
        // first drawn and read by nothing until the 職務経歴書 register existed
        // (`docs/06`, 2026-08-12). Passed through as stored — in yen, and as a
        // headcount — because how they are WRITTEN is a question about the
        // document: 400万円 is one render's wording of 4000000, not the record's.
        capitalYen: e.capitalYen,
        headcount: e.headcount,
        // An English render prefers the Latin title and a Japanese one the
        // Japanese title, but either is better than none, so each falls back to
        // the other. A role with neither carries no title and is dropped: it
        // still bounds the employer's dates, which the employer row already has.
        roles: (rolesByEmployer.get(e.id) ?? []).flatMap((r) => {
          const title =
            definition.language === "ja"
              ? (r.titleJa ?? r.titleLatin)
              : (r.titleLatin ?? r.titleJa);
          return title ? [{ title, startedOn: r.startedOn, endedOn: r.endedOn }] : [];
        }),
        city: e.city,
        // The résumé's alone: the list is newest-first for it, so the position
        // is how recent the employer is (`src/render/resume.ts`).
        ...(kind === "english_resume" ? { bullets: bulletBudget(position, e.endedOn, today) } : {}),
      })),
      projects: includedProjects.map((p) => ({
        id: p.id,
        // As above. The register copies this into a プロジェクト row, so a
        // Japanese document wants the Japanese name where the record has one.
        name: nameInLanguage(definition.language, p.nameJa, p.name),
        employerId: p.employerId,
        // A Japanese document takes the Japanese summary, and otherwise the
        // English one, which the prompt marks as English-only (issue #117).
        summary: p.summary,
        summaryJa: definition.language === "ja" ? p.summaryJa : null,
        startedOn: p.startedOn,
        endedOn: p.endedOn,
      })),
      // Facts first, projects second, and the facts are the half that matters:
      // this record holds a personal project as seven facts and no project row,
      // and a career story planned from the Projects list alone had no chapter
      // to put them in (`docs/06`, 2026-09-13).
      workOutsideEmployment:
        (technologySets
          ? technologySets.some((set) => !set.employerId || !employerById.has(set.employerId))
          : renderFacts.some((f) => f.employer === undefined)) ||
        includedProjects.some((p) => p.employerId === null),
      // Read from the profile row the caller already fetched? No — this
      // function owns the payload, and a field the route had to remember to
      // pass is a field the route will one day forget. Empty string and null
      // are the same absence here: `profiles.desired_role_note` is nullable and
      // the profile form writes `null`, but a whitespace-only note would
      // otherwise reach the prompt as a stated preference.
      desiredRoleNote: profileRow?.desiredRoleNote?.trim() || null,
      careerGaps: gaps,
      // The same language rule a role title follows, with one difference: the
      // Latin name is required by the schema and the Japanese one is optional,
      // so only the Japanese render needs a fallback.
      educations: inDocumentOrder(includedEducations, "oldest_first", definition.chronology).map((e) => ({
        id: e.id,
        institution:
          definition.language === "ja" ? (e.institutionJa ?? e.institution) : e.institution,
        faculty: e.faculty,
        degree: e.degree,
        fieldOfStudy: e.fieldOfStudy,
        startedOn: e.startedOn,
        endedOn: e.endedOn,
        outcome: e.outcome,
        // The rung the register tests. Sent even when null: the register is
        // told that an unstated level prints, so the model never has to fall
        // back to reading the institution's name (`docs/06`, 2026-09-06).
        level: e.level,
      })),
      // The only list here whose sort key can be null: `employers.started_on`
      // is not null, and an education is required to carry a start, an end or
      // both. A certification with no issue date is printed, and printed last —
      // position in a dated list is a claim about when, and this row makes none.
      // The 履歴書 omits it outright, because 免許・資格 is 年 / 月 / 名称 and has
      // nowhere to put it (`docs/04` §4); that is the register's rule, not this
      // boundary's, and until it exists the tail is where the row does least.
      // A lapsed certification is left off the Japanese documents (issue #117),
      // so a 職務経歴書 summary cannot count one its 保有資格 does not list.
      certifications: inDocumentOrder(
        definition.language === "ja"
          ? certificationRows.filter((c) => !isExpired(c.expiresOn, today))
          : certificationRows,
        "newest_first",
        definition.chronology,
        (c) => c.issuedOn,
      ).map((c) => ({
        id: c.id,
        name: definition.language === "ja" ? (c.nameJa ?? c.name) : c.name,
        issuingOrganization: c.issuingOrganization,
        issuedOn: c.issuedOn,
        expiresOn: c.expiresOn,
        kind: c.kind,
        technologies: c.technologies,
      })),
      // No rows is no curation, and the register writes the section from the
      // facts as it did before S9. Rows that leave this render nothing is a
      // curation all the same, and becomes an empty list, never `null`.
      curatedSkills: curation.length > 0 ? curationForRender(curation, renderable) : null,
      // With nothing curated, the section is still bounded: the first real
      // record named about 800 technologies, and a section written "from the
      // facts" had nothing to stop it listing all of them. Ranked over every
      // usable fact, not the budget's, as the curation is narrowed.
      skillShortlist:
        definition.skillsSection && curation.length === 0
          ? autoCuratedSkills(rankedSkills([...(technologySets ?? usable), ...certificationRows]))
          : null,
      jobDescription: tailoring?.jobDescription ?? null,
      application: tailoring?.application ?? null,
    },
    privateFactCount: counted?.private ?? 0,
    generatedFactCount: counted?.generated ?? 0,
    omittedFactCount: usable.length - sent.length,
    acceptedFactCount: counted?.accepted ?? 0,
    usableFactIds: accepted
      .filter((f) => f.disclosure !== "private" && f.provenance !== "generated")
      .map((f) => f.id),
    ...(technologySets ? { technologySets } : {}),
  };
}

/**
 * The usable facts' technologies, one row per distinct set of names under one
 * employer, with how many facts carry it: what ranking skills needs, without a
 * row per fact. A fact's names are de-duplicated as `rankedSkills` does it, by
 * exact spelling; blank names are left for it to drop.
 */
async function usableTechnologySets(
  db: Db,
  userId: string,
  excludedEmployerIds: string[],
  excludedProjectIds: string[],
): Promise<TechnologySet[]> {
  const usableFact = and(
    eq(facts.userId, userId),
    eq(facts.status, "accepted"),
    ne(facts.disclosure, "private"),
    ne(facts.provenance, "generated"),
    ...(excludedEmployerIds.length > 0
      ? [or(isNull(effectiveEmployerId), notInArray(effectiveEmployerId, excludedEmployerIds))]
      : []),
    ...(excludedProjectIds.length > 0 ? [or(isNull(facts.projectId), notInArray(facts.projectId, excludedProjectIds))] : []),
  );
  const perFact = db
    .select({
      employerId: sql<string | null>`${effectiveEmployerId}`.as("employer_id"),
      technologies: sql<string[]>`array(select distinct t from unnest(${facts.technologies}) as t order by t)`.as("technologies"),
    })
    .from(facts)
    .where(usableFact)
    .as("per_fact");
  return db
    .select({ technologies: perFact.technologies, employerId: perFact.employerId, count: sql<number>`count(*)::int` })
    .from(perFact)
    .groupBy(perFact.employerId, perFact.technologies);
}

/** The claims of these facts, read by id. */
async function withClaims<T extends { id: string; claim: string }>(db: Db, userId: string, rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  const read = await db
    .select({ id: facts.id, claim: facts.claim })
    .from(facts)
    .where(and(eq(facts.userId, userId), inArray(facts.id, rows.map((row) => row.id))));
  const claimOf = new Map(read.map((row) => [row.id, row.claim]));
  return rows.map((row) => ({ ...row, claim: claimOf.get(row.id) ?? row.claim }));
}

/**
 * The last line of defence: even if a model echoed an id it was never given,
 * a block referencing an excluded fact cannot carry it into a stored version.
 */
export function stripUnknownFactIds(content: RenderContent, allowed: Set<string>): RenderContent {
  return {
    sections: content.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => ({
        ...block,
        factIds: block.factIds.filter((id) => allowed.has(id)),
      })),
    })),
  };
}

/**
 * Which blocks are drafts for the author to confirm (`docs/06`, 2026-10-26),
 * decided here rather than taken on the model's word alone.
 *
 * Only a tailored 履歴書 has any. In it, the 本人希望欄 is always a draft: it is
 * a request, and the author makes it. A 志望動機・特技・アピールポイント
 * first paragraph is always a draft; later prose is a draft when the model
 * marked it one or it cites no fact. Every other
 * document drops the mark wherever the model put it: its blocks are written
 * from facts, and the accept gate must not be held by a flag nobody can clear.
 */
export function withDrafts(content: RenderContent, spec: Pick<RenderSpec, "kind" | "jobDescription">): RenderContent {
  const tailoredRirekisho = spec.kind === "rirekisho" && Boolean(spec.jobDescription);
  const motivationIndex = content.sections.findIndex((section) => section.key === PROSE_SECTION_KEYS.motivation);
  const kibouIndex = content.sections.findIndex((section) => section.key === PROSE_SECTION_KEYS.kibou);
  return {
    sections: content.sections.map((section, sectionIndex) => ({
      ...section,
      blocks: section.blocks.map(({ drafted, ...block }, index) => {
        const draft =
          tailoredRirekisho &&
          (sectionIndex === kibouIndex ||
            (sectionIndex === motivationIndex && (index === 0 || drafted === true || block.factIds.length === 0)));
        return draft ? { ...block, drafted: true as const } : block;
      }),
    })),
  };
}

export interface GenerateArgs {
  db: Db;
  model: ModelSeam;
  userId: string;
  proposalId: string;
  inputs: RenderInputs;
  /** Which call this is. A run starts at {@link FIRST_STAGE}. */
  stage?: GenerationStage;
}

/**
 * One step of a generation run: one round of model calls (`docs/06`,
 * 2026-11-04). A document is written, a career story a round at a time, an
 * English résumé's lines over their bound are written again, and a document
 * that fails its language check is written once more, each in a step of its
 * own, so each has the whole step timeout. Labels only: a Workflow stores this
 * between steps, and what a step wrote waits on the proposal row.
 */
export interface GenerationStage {
  call: "write" | "shorten";
  /** A story's round; past the first, the write continues the draft on the row. */
  round: number;
  /** The language check's retry is the second. */
  attempt: 1 | 2;
  /** What the first attempt failed, on the second. */
  firstDefect: EnglishDefect | JapaneseDefect | null;
  /** A digest of what the step that started the draft read ({@link readDigest}): never the read itself. */
  read: string | null;
}

export const FIRST_STAGE: GenerationStage = { call: "write", round: 1, attempt: 1, firstDefect: null, read: null };

/** The reason a run is stopped with when the record moved under a draft. */
export const RECORD_CHANGED_REASON = "The record changed while this document was being written. Generate it again.";

/**
 * SHA-256 of a read of the record, facts and spec, the same for two reads
 * that would send the model the same thing. Rows a query returns in no fixed
 * order are put in one.
 */
export async function readDigest(inputs: RenderInputs): Promise<string> {
  const byId = <T extends { id: string }>(rows: readonly T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const stable = {
    ...inputs,
    facts: byId(inputs.facts),
    usableFactIds: [...inputs.usableFactIds].sort(),
    spec: { ...inputs.spec, projects: byId(inputs.spec.projects) },
  };
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(stable)));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The only way off `generating`, for all three endings. A run that lands after
 * its proposal was given up on writes nothing: moving that row back to ready
 * would put a second waiting proposal on the render, which the unique index
 * refuses, and a failed row is one the author may already have replaced.
 */
const whileGenerating = (userId: string, proposalId: string) =>
  and(
    eq(renderProposals.userId, userId),
    eq(renderProposals.id, proposalId),
    eq(renderProposals.generationStatus, "generating"),
  );

/**
 * What a step's calls cost, added to what the steps before it recorded: a
 * document written in several steps, or retried, is several billed calls, and
 * the row reporting one of them would understate what it cost.
 */
const addedUsage = (usage: ModelUsage | null) =>
  usage === null
    ? {}
    : {
        inputTokens: sql`coalesce(${renderProposals.inputTokens}, 0) + ${usage.inputTokens}`,
        outputTokens: sql`coalesce(${renderProposals.outputTokens}, 0) + ${usage.outputTokens}`,
        cacheCreationInputTokens: sql`coalesce(${renderProposals.cacheCreationInputTokens}, 0) + ${usage.cacheCreationInputTokens}`,
        cacheReadInputTokens: sql`coalesce(${renderProposals.cacheReadInputTokens}, 0) + ${usage.cacheReadInputTokens}`,
      };

/**
 * A stated reason on a proposal generation will not finish. A draft a step
 * left on the row goes with it: nothing of a failed generation is kept.
 */
export async function failProposal(db: Db, userId: string, proposalId: string, reason: string, usage: ModelUsage | null = null): Promise<void> {
  await db
    .update(renderProposals)
    .set({
      content: { sections: [] } satisfies RenderContent,
      generationStatus: "failed",
      generationError: reason,
      ...addedUsage(usage),
      updatedAt: new Date(),
    })
    .where(whileGenerating(userId, proposalId));
}

/**
 * Fails, as {@link failProposal} does, every proposal still `generating` that
 * has not changed since `before`: the runs behind them are gone. A statement,
 * so a caller can put it first in the batch that reads the proposals.
 */
export const failLostProposals = (db: Db, userId: string, before: Date, reason: string) =>
  db
    .update(renderProposals)
    .set({ content: { sections: [] } satisfies RenderContent, generationStatus: "failed", generationError: reason, updatedAt: new Date() })
    .where(and(eq(renderProposals.userId, userId), eq(renderProposals.generationStatus, "generating"), lt(renderProposals.updatedAt, before)))
    .returning({ id: renderProposals.id });

/** What one step wrote, for the next to read. The row still reads `generating`, and no screen shows it. */
async function keepDraft(db: Db, userId: string, proposalId: string, content: RenderContent, usage: ModelUsage | null): Promise<void> {
  await db
    .update(renderProposals)
    .set({ content, ...addedUsage(usage), updatedAt: new Date() })
    .where(whileGenerating(userId, proposalId));
}

/**
 * Runs one stage of the model and returns the next, or lands the result on
 * the proposal row and returns `null`. It never touches a `render_versions`
 * row and never moves `renders.current_version_id`, which is what makes "a
 * failure never destroys or mutates a stored version" true by construction
 * rather than by care.
 */
export async function generateIntoProposal(args: GenerateArgs): Promise<GenerationStage | null> {
  const { db, model, userId, proposalId, inputs, stage = FIRST_STAGE } = args;
  // Kept outside the `try` so a generation refused after its retry still
  // records the calls it spent.
  let usage: ModelUsage | null = null;
  const onUsage = (u: ModelUsage) => {
    usage = usage === null ? u : addUsage(usage, u);
  };
  try {
    const today = tokyoToday();
    // A row the record supplies is the same on every attempt, so one that
    // fails the check is refused before any model call, and named as the
    // record's to correct.
    const recordDefect =
      stage.call === "write" && stage.attempt === 1 && inputs.spec.kind === "shokumu_keirekisho"
        ? recordRowDefectReason(recordSections(inputs.spec, today), inputs.spec, inputs.facts)
        : null;
    if (recordDefect !== null) {
      await failProposal(db, userId, proposalId, recordDefect);
      // Ids only.
      console.warn(JSON.stringify({ event: "generation_refused_record_row", proposalId }));
      return null;
    }
    // A step that continues a draft writes and lands it from the read that
    // started it, or not at all: a draft checked against one read and landed
    // against another could drop a citation a fact made Private since needs,
    // or plan a chapter its facts no longer back.
    const read = await readDigest(inputs);
    let draft: RenderContent | null = null;
    if (stage.call === "shorten" || stage.round > 1) {
      if (read !== stage.read) {
        await failProposal(db, userId, proposalId, RECORD_CHANGED_REASON);
        // Ids only.
        console.warn(JSON.stringify({ event: "generation_record_changed", proposalId }));
        return null;
      }
      const [row] = await db
        .select({ content: renderProposals.content })
        .from(renderProposals)
        .where(whileGenerating(userId, proposalId))
        .limit(1);
      if (!row) return null;
      draft = row.content as RenderContent;
    }
    let content =
      stage.call === "shorten"
        ? await repairResumeBounds(draft!, inputs.spec, inputs.facts, (lines) => model.shortenResumeLines(lines, { onUsage }))
        : await model.generateRender(inputs.facts, draft ? { ...inputs.spec, storySoFar: draft } : inputs.spec, {
            onUsage,
            // Ids, chapter keys and the defect's name only.
            onStoryPartRetried: (chapters, defect) =>
              console.warn(JSON.stringify({ event: "generation_part_retried", proposalId, chapters, defect })),
          });
    const allowed = new Set(inputs.facts.map((f) => f.id));
    content = stripUnknownFactIds(content, allowed);
    const wroteChapters = content.sections.some((section) => !draft?.sections.some((done) => done.key === section.key));
    if (isChapteredStory(inputs.spec.kind) && wroteChapters && !isStoryComplete(content, inputs.spec)) {
      await keepDraft(db, userId, proposalId, content, usage);
      return { ...stage, round: stage.round + 1, read };
    }
    // A bullet over 240 characters, or a summary of 50 words, used to refuse
    // the whole document. Those lines alone are written again, next.
    if (stage.call === "write" && inputs.spec.kind === "english_resume" && linesToShorten(content, inputs.facts).length > 0) {
      await keepDraft(db, userId, proposalId, content, usage);
      return { ...stage, call: "shorten", read };
    }
    // Issue #104. An English document that comes back in Japanese, or with a
    // checked record name changed, is retried once and then refused —
    // never lands as reviewable content. When this failure was found, the
    // review screen did not show heading changes. A Japanese document is held
    // to its own check the same way (issue #117): 御社, or a line in English.
    // The record's own 保有資格 and 学歴 rows (issue #117) are part of what the
    // author is shown, so the check reads the content as assembled: a row the
    // model wrote that is discarded is not held to it.
    // The 職務経歴書's two technology lists are bounded before anything reads
    // them (`src/render/skill-lists.ts`).
    const assemble = (c: RenderContent) =>
      inputs.spec.kind === "shokumu_keirekisho"
        ? withRecordSections(boundShokumuLists(c, inputs.spec, inputs.facts), inputs.spec, today)
        : c;
    const defectOf = (c: RenderContent) =>
      inputs.spec.language === "en" ? englishDefect(c, inputs.spec) : japaneseDefect(c, inputs.spec, inputs.facts);
    content = assemble(content);
    const defect = defectOf(content);
    if (defect !== null) {
      if (stage.attempt === 1) {
        // Ids and the defect's name only.
        console.warn(JSON.stringify({ event: "generation_retried", proposalId, defect }));
        await keepDraft(db, userId, proposalId, { sections: [] }, usage);
        return { call: "write", round: 1, attempt: 2, firstDefect: defect, read: null };
      }
      throw new ModelUnavailableError(stage.firstDefect === defect ? DEFECT_REASON[defect] : mixedDefectReason(inputs.spec.language), defect);
    }
    const motivation = content.sections.find((section) => section.key === PROSE_SECTION_KEYS.motivation)?.blocks[0];
    if (inputs.spec.kind === "rirekisho" && inputs.spec.jobDescription && (motivation?.kind !== "paragraph" || !motivation.text.trim())) {
      throw new ModelUnavailableError("The tailored 履歴書 needs a 志望動機 to confirm. Generate it again.");
    }
    if (inputs.spec.kind === "rirekisho" && inputs.spec.jobDescription) {
      const kibou = content.sections.find((section) => section.key === PROSE_SECTION_KEYS.kibou);
      if (!kibou?.blocks.some((block) => block.kind === "paragraph" && block.text.trim())) {
        const block = {
          id: `blk_${crypto.randomUUID()}`,
          kind: "paragraph" as const,
          text: [inputs.spec.application?.kibouNote, inputs.spec.desiredRoleNote, "貴社規定に従います。"]
            .map((text) => text?.trim())
            .find((text) => text && defectOf({ sections: [{ key: PROSE_SECTION_KEYS.kibou, heading: "本人希望欄", blocks: [{ id: "", kind: "paragraph", text, factIds: [] }] }] }) === null)!,
          factIds: [],
          drafted: true as const,
        };
        if (kibou) kibou.blocks = [block];
        else content.sections.push({ key: PROSE_SECTION_KEYS.kibou, heading: "本人希望欄", blocks: [block] });
      }
    }
    await db
      .update(renderProposals)
      .set({
        content: withDrafts(stripUnknownFactIds(content, allowed), inputs.spec),
        generationStatus: "ready",
        generationError: null,
        // The record as this run read it, which is later than the route did.
        usableFactIds: inputs.usableFactIds,
        // Four keys, four columns of the same name. See `ModelUsage`.
        ...addedUsage(usage),
        updatedAt: new Date(),
      })
      .where(whileGenerating(userId, proposalId));
  } catch (err) {
    const reason =
      err instanceof ModelUnavailableError
        ? err.message
        : "This document could not be generated.";
    await failProposal(db, userId, proposalId, reason, usage);
    // Ids only. Never the facts sent, never the content returned. Out of
    // credits is its own event: not an outage, and the proposal can be retried.
    if (err instanceof ModelCreditsExhaustedError) logCreditsExhausted("generate");
    else console.error(JSON.stringify({ event: "generation_failed", proposalId }));
  }
  return null;
}

/** The two checks name their defects apart, so one table reads either. */
const DEFECT_REASON: Record<EnglishDefect | JapaneseDefect, string> = { ...ENGLISH_DEFECT_REASON, ...JAPANESE_DEFECT_REASON };

const mixedDefectReason = (language: "en" | "ja"): string =>
  language === "en" ? MIXED_ENGLISH_DEFECT_REASON : MIXED_JAPANESE_DEFECT_REASON;

function addUsage(a: ModelUsage, b: ModelUsage): ModelUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}
