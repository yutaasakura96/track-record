/**
 * The English résumé, laid out from the record with the model's prose set into
 * it (issue #107).
 *
 * Until this module the résumé went through the generic `toDocx` path every
 * flowing document takes, and everything on the page was written by the model:
 * the employer, title and date line of each job, the skills, the education and
 * the certifications. The wording of the bullets held up; the document around
 * them did not — a run-on job line with each date printed twice in ISO form, a
 * Japanese faculty name, an expired certification, a language score inside the
 * summary. None of that is prose, and none of it should have been asked for.
 *
 * **The model now writes the summary and the bullets, and nothing else.** The
 * 履歴書 settled the same split first (`src/render/rirekisho.ts`): what is data
 * is read from the record when the file is built, and only what has to be
 * written is generated. Each employer's bullets are stored under a section
 * keyed by that employer's id — the key the career stories already use — so
 * the job header is joined to them by id, never matched on a heading.
 *
 * Three things live here, all pure:
 *   - the bullet budget, computed per employer and printed into the prompt;
 *   - the shaping of what the model returned into exactly the sections the
 *     register asks for;
 *   - the assembly of a stored version and today's record into the document a
 *     file, a Markdown download and a sent copy's page are all written from,
 *     so the three cannot disagree.
 */
import type { RenderSpec } from "~/model/types";
import { leavesOutEducation } from "~/shared/education";
import { type Block, type RenderContent, type RenderSection } from "~/shared/render-content";
import { experienceGroups } from "./attribution";
import { employerChapterKey, employerIdOfChapter } from "./chapters";
import { identityLines, type RenderIdentity } from "./identity";
import { hasJapaneseScript } from "./language";
import type { SentPage } from "./sent-page";

/* ------------------------------------------------------------ section keys */

export const SUMMARY_KEY = "summary";

export const PROJECT_KEY_PREFIX = "project:";

export const projectKey = (projectId: string): string => `${PROJECT_KEY_PREFIX}${projectId}`;

/**
 * Independent work the record holds as facts with no project row. A career
 * story met this first: a personal project recorded as seven facts and no row
 * had no chapter to land in (`docs/06`, 2026-09-13).
 */
export const OTHER_PROJECTS_KEY = "projects";

/* ----------------------------------------------------------- bullet budget */

/** The current and the previous employer: §4.3's "recent roles". */
const RECENT_EMPLOYERS = 2;

/** "Roles over about 8 years old", counted from the month the job ended. */
const OLD_ROLE_MONTHS = 8 * 12;

export interface BulletBudget {
  min: number;
  max: number;
}

const monthIndex = (isoDate: string) => Number(isoDate.slice(0, 4)) * 12 + Number(isoDate.slice(5, 7)) - 1;

/**
 * How many bullets one employer gets, by its position in the newest-first list
 * and how long ago it ended. Four or five for the two most recent, one or two
 * for a job that ended more than eight years ago, and two or three for the
 * ones between — which is what keeps a long career to two pages with the
 * strongest material on the first.
 *
 * Age wins over position: a second employer that ended ten years ago, before a
 * gap, is old work whatever its place in the list.
 */
export function bulletBudget(position: number, endedOn: string | null, today: string): BulletBudget {
  if (endedOn !== null && monthIndex(today) - monthIndex(endedOn) > OLD_ROLE_MONTHS) return { min: 1, max: 2 };
  if (position < RECENT_EMPLOYERS) return { min: 4, max: 5 };
  return { min: 2, max: 3 };
}

/* ----------------------------------------------------- shaping a generation */

/**
 * What the model returned, reduced to the sections the register asks for.
 *
 * Every heading is replaced by the record's: the summary is "Summary", an
 * employer's section is headed with its name, a project's with its name. The
 * heading is what the diff and the edit screens show; the file prints the
 * record's job header and never reads it.
 *
 */
function resumeSectionPlan(spec: Pick<RenderSpec, "employers" | "projects">) {
  const planned: { key: string; heading: string; kind: Block["kind"] }[] = [
    { key: SUMMARY_KEY, heading: "Summary", kind: "paragraph" },
    ...spec.employers.map((e) => ({ key: employerChapterKey(e.id), heading: e.name, kind: "bullet" as const })),
    ...spec.projects
      .filter((p) => p.employerId === null)
      .map((p) => ({ key: projectKey(p.id), heading: p.name, kind: "bullet" as const })),
    { key: OTHER_PROJECTS_KEY, heading: "Projects", kind: "bullet" },
  ];
  return planned;
}

function validateResumeSectionShape(
  content: RenderContent,
  planned: ReturnType<typeof resumeSectionPlan>,
  legacyKeys: Set<string> = new Set(),
): void {
  const byKey = new Map(planned.map((section) => [section.key, section]));
  const seen = new Set<string>();
  for (const section of content.sections) {
    const expected = byKey.get(section.key);
    if (seen.has(section.key) || (!expected && !legacyKeys.has(section.key)) ||
      (expected && section.blocks.some((block) => block.kind !== expected.kind)) ||
      (section.key === "experience" && section.blocks.some((block) => block.kind === "row"))) {
      throw new Error(`Invalid résumé section ${section.key}.`);
    }
    seen.add(section.key);
  }
  if (!legacyKeys.size && !content.sections.some((section) => section.key === SUMMARY_KEY && section.blocks.length > 0)) {
    throw new Error("The résumé needs a Summary paragraph.");
  }
}

const sectionKind = (key: string): Block["kind"] =>
  key === SUMMARY_KEY ? "paragraph" : "bullet";

const isCurrentSectionKey = (key: string): boolean =>
  key === SUMMARY_KEY || key === OTHER_PROJECTS_KEY ||
  employerIdOfChapter(key) !== null ||
  (key.startsWith(PROJECT_KEY_PREFIX) && key.length > PROJECT_KEY_PREFIX.length);

/**
 * An edit is checked against the version it was made from, not today's
 * record: an employer left out or a project reassigned since must not lock the
 * author out of fixing a word.
 */
export function validateResumeEditShape(content: RenderContent, previous: RenderContent): void {
  const previousKeys = new Set(previous.sections.map((section) => section.key));
  if (content.sections.length !== previous.sections.length) {
    throw new Error("A résumé edit must keep its sections.");
  }
  if (isOlderVersion(previous)) {
    validateResumeSectionShape(content, [], previousKeys);
    const previousBlocks = new Map(previous.sections.flatMap((section) => section.blocks.map((block) => [block.id, block.kind] as const)));
    for (const section of content.sections) {
      for (const block of section.blocks) {
        const kind = previousBlocks.get(block.id);
        if (kind && kind !== block.kind) throw new Error(`Invalid résumé section ${section.key}.`);
      }
    }
    return;
  }
  validateResumeSectionShape(
    content,
    [...previousKeys].map((key) => ({ key, heading: "", kind: sectionKind(key) })),
  );
}

/**
 * A version generated before this layout, under the register that asked for
 * every section and omitted "any with nothing behind it". It need not have an
 * `experience` section: one generated when no employer fact was usable can
 * hold only a summary and projects, or no summary at all. What marks it is a
 * key this layout never asks for, or a section the current shape refuses.
 */
function isOlderVersion(version: RenderContent): boolean {
  if (version.sections.some((section) => !isCurrentSectionKey(section.key))) return true;
  try {
    validateResumeSectionShape(
      version,
      version.sections.map(({ key }) => ({ key, heading: "", kind: sectionKind(key) })),
    );
    return false;
  } catch {
    return true;
  }
}

export function shapeResumeContent(content: RenderContent, spec: RenderSpec): RenderContent {
  const planned = resumeSectionPlan(spec);
  validateResumeSectionShape(content, planned);
  const blocksByKey = new Map(content.sections.map((section) => [section.key, section.blocks]));

  const sections: RenderSection[] = planned.flatMap(({ key, heading }) => {
    const blocks = blocksByKey.get(key) ?? [];
    return blocks.length === 0 ? [] : [{ key, heading, blocks }];
  });
  validateResumeBounds({ sections }, spec.employers);
  for (const project of spec.projects.filter((p) => p.employerId === null)) {
    if (!blocksByKey.get(projectKey(project.id))?.length) throw new Error(`Project ${project.id} needs bullets.`);
  }
  return { sections };
}

/**
 * With `previous`, the budget binds only a section the edit grew: a stored
 * version stays editable after the record has moved its employers around.
 */
export function validateResumeBounds(
  content: RenderContent,
  employers: RenderSpec["employers"],
  previous?: RenderContent,
): void {
  for (const section of content.sections) {
    const before = previous?.sections.find((row) => row.key === section.key)?.blocks.length;
    if (section.key === SUMMARY_KEY && section.blocks.flatMap((block) => block.text.trim().split(/\s+/u)).length >= 50) {
      throw new Error("The résumé summary must be under 50 words.");
    }
    if (section.blocks.some((block) => [...block.text].length > 240 && (block.kind === "bullet" || section.key !== SUMMARY_KEY))) {
      throw new Error(`Résumé section ${section.key} has a bullet over 240 characters.`);
    }
    const employer = employers.find((row) => employerChapterKey(row.id) === section.key);
    if (employer?.bullets && section.blocks.length > employer.bullets.max && (before === undefined || section.blocks.length > before)) {
      throw new Error(`Résumé employer ${employer.id} exceeds its bullet budget.`);
    }
  }
}

/* ------------------------------------------------------------- the document */

/**
 * What the file is built from besides the version: today's record, already
 * narrowed to this render — Private and Generated facts gone, entries left out
 * of the résumé gone, names in their English form (`collectRenderInputs`).
 */
export interface ResumeRecord {
  /** Newest first. */
  employers: RenderSpec["employers"];
  projects: RenderSpec["projects"];
  educations: RenderSpec["educations"];
  /** Newest first, undated last. */
  certifications: RenderSpec["certifications"];
  /** A group with an empty name is a list nobody grouped. Empty is no skills section. */
  skills: { name: string; skills: string[] }[];
}

export type ResumeBlock =
  /**
   * A plain paragraph: the summary, a project's own summary, a list run together.
   * `factIds`, here and on a bullet, are the facts the version wrote it from
   * (issue #110); a paragraph made from the record cites none.
   */
  | { kind: "paragraph"; text: string; factIds?: string[] }
  /** A job, a project or a school: bold lead, a detail after it, the dates right-aligned. */
  | { kind: "entry"; lead: string; detail: string | null; dates: string | null }
  /** The titles held, in italic under the job. */
  | { kind: "subtitle"; text: string }
  | { kind: "bullet"; text: string; factIds?: string[] }
  /** One skills group: its name in bold, then the skills. */
  | { kind: "labelled"; label: string; text: string };

export interface ResumeSection {
  key: string;
  heading: string;
  blocks: ResumeBlock[];
}

export interface ResumeDocument {
  name: string;
  /** The line under the name, when the author filled one in (issue #108). */
  headline: string | null;
  /** The one contact line under the headline: city, email, phone and links. */
  contact: string[];
  sections: ResumeSection[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2024-01-01` → `Jan 2024`. Never numeric: a reader abroad cannot tell 01/02 from 02/01. */
export const monthYear = (isoDate: string): string =>
  `${MONTHS[Number(isoDate.slice(5, 7)) - 1] ?? ""} ${isoDate.slice(0, 4)}`.trim();

/** `Jan 2024 – Present`. */
export const monthSpan = (startedOn: string, endedOn: string | null): string =>
  `${monthYear(startedOn)} – ${endedOn ? monthYear(endedOn) : "Present"}`;

const yearOf = (isoDate: string) => isoDate.slice(0, 4);

/**
 * A certification whose expiry month has passed is left out. One expiring this
 * month is still held this month.
 */
const isExpired = (expiresOn: string | null, today: string) =>
  expiresOn !== null && expiresOn.slice(0, 7) < today.slice(0, 7);

export interface AssembleArgs {
  content: RenderContent;
  record: ResumeRecord;
  identity: RenderIdentity;
  /** `YYYY-MM-DD`, Tokyo. */
  today: string;
}

/** One stored version and today's record, as the document an employer is sent. */
export function assembleResume({ content, record, identity, today }: AssembleArgs): ResumeDocument {
  const [name = "", ...lines] = identityLines("english_resume", identity);
  const headline = identity.resume.headline?.trim() || null;
  const contact = headline === null ? lines : lines.slice(1);
  const sections: ResumeSection[] = [
    section(SUMMARY_KEY, "Summary", summaryBlocks(content)),
    section("skills", "Skills", skillsBlocks(record)),
    section("experience", "Experience", experienceBlocks(content, record)),
    section("projects", "Projects", projectBlocks(content, record)),
    section("education", "Education", educationBlocks(record)),
    section("certifications", "Certifications", certificationBlocks(record, today, "technical")),
    section("languages", "Languages", certificationBlocks(record, today, "language")),
  ].filter((s) => s.blocks.length > 0);
  const document = { name, headline, contact, sections };
  assertEnglishResume(document);
  return document;
}

/** A stored version and today's record that cannot make the file. Refused, never printed around. */
export class ResumeAssemblyError extends Error {}

export class ResumeLanguageError extends ResumeAssemblyError {}

/**
 * A name an English reader can read: at least one letter, and every letter in
 * Latin script. An employer recorded only as Компания has no Latin name to
 * fall back to, any more than one recorded only as 株式会社… does.
 */
const isLatinName = (value: string): boolean =>
  /\p{L}/u.test(value) && !/(?!\p{Script=Latin})\p{L}/u.test(value);

export function assertResumeSpecNames(spec: Pick<RenderSpec, "employers" | "projects" | "educations">): void {
  const names: [string, string][] = [
    ...spec.employers.map((employer): [string, string] => ["employer", employer.name]),
    ...spec.projects.map((project): [string, string] => ["project", project.name]),
    ...spec.educations.map((education): [string, string] => ["education", education.institution]),
  ];
  const unreadable = names.find(([, value]) => !isLatinName(value));
  if (unreadable) throw new ResumeLanguageError(`The English résumé needs a Latin-script name for ${unreadable[0]}.`);
}

/** A job whose header would print without its city, its title, or both. */
export interface IncompleteJobHeader {
  employerId: string;
  name: string;
  missing: ("city" | "role")[];
}

/**
 * The jobs the header cannot be written for. Every job on an English résumé is
 * headed by its city and its title, and the record holds both as optional: a
 * city added in migration 0027 is empty on every older employer, and a job can
 * have no role, or only roles with no title. Generation is refused on these and
 * names them, rather than printing a header with a hole in it.
 */
export function incompleteJobHeaders(employers: RenderSpec["employers"]): IncompleteJobHeader[] {
  return employers.flatMap((e) => {
    const missing = [
      ...(e.city?.trim() ? [] : ["city" as const]),
      ...(rolesLine(e.roles) === null ? ["role" as const] : []),
    ];
    return missing.length === 0 ? [] : [{ employerId: e.id, name: e.name, missing }];
  });
}

/**
 * `… Aozora Logistics needs a city; Harbourline needs a role with a title.` Each
 * part ends on what is missing, so a name ending in `K.K.` never ends the sentence.
 */
export function incompleteJobHeadersMessage(incomplete: IncompleteJobHeader[]): string {
  const what = { city: "a city", role: "a role with a title" };
  const parts = incomplete.map((job) => `${job.name} needs ${job.missing.map((m) => what[m]).join(" and ")}`);
  return `Every job on the English résumé is headed by its city and title. ${parts.join("; ")}.`;
}

const NAMED_ENTRIES = new Set(["employer", "project", "education"]);

export function assertEnglishResume(document: ResumeDocument): void {
  const names: [string, string][] = [["profile name", document.name]];
  const fields: [string, string][] = [
    ["profile name", document.name],
    ["headline", document.headline ?? ""],
    ...document.contact.map((value) => ["contact", value] as [string, string]),
  ];
  for (const section of document.sections) {
    const type = section.key === "experience" ? "employer" : section.key === "projects" ? "project" : section.key;
    let entry = type;
    for (const block of section.blocks) {
      if (block.kind === "entry") {
        entry = `${type} ${block.lead}`;
        if (NAMED_ENTRIES.has(type)) names.push([`${entry} name`, block.lead]);
        fields.push([`${entry} name`, block.lead], [`${entry} ${type === "employer" ? "city" : "detail"}`, block.detail ?? ""]);
      } else if (block.kind === "labelled") {
        fields.push([`${type} label`, block.label], [`${type} value`, block.text]);
      } else {
        fields.push([block.kind === "subtitle" ? `${entry} title` : type, block.text]);
      }
    }
  }
  const invalid = fields.find(([, value]) => hasJapaneseScript(value));
  if (invalid) throw new ResumeLanguageError(`The English résumé needs an English value for ${invalid[0]}.`);
  const unreadable = names.find(([, value]) => !isLatinName(value));
  if (unreadable) throw new ResumeLanguageError(`The English résumé needs a Latin-script name for ${unreadable[0]}.`);
}

const section = (key: string, heading: string, blocks: ResumeBlock[]): ResumeSection => ({ key, heading, blocks });

type Written = { text: string; factIds: string[] };

/** A block's text and the facts it was written from, without the rest of the block. */
const written = (b: Written): Written => ({ text: b.text, factIds: b.factIds });

const writtenOf = (content: RenderContent, key: string): Written[] =>
  content.sections.filter((s) => s.key === key).flatMap((s) => s.blocks.map(written));

const bullet = (b: Written): ResumeBlock => ({ kind: "bullet", ...b });

function summaryBlocks(content: RenderContent): ResumeBlock[] {
  return writtenOf(content, SUMMARY_KEY).map((b) => ({ kind: "paragraph", ...b }));
}

function skillsBlocks(record: ResumeRecord): ResumeBlock[] {
  return record.skills.flatMap((group): ResumeBlock[] => {
    const skills = group.skills;
    if (skills.length === 0) return [];
    const label = group.name.trim();
    return label
      ? [{ kind: "labelled", label, text: skills.join(", ") }]
      : [{ kind: "paragraph", text: skills.join(", ") }];
  });
}

/**
 * The titles under a job. One title stands alone; a promotion is a second role
 * (`docs/04` §3.4), and two or more are each dated so the promotion reads as
 * one: `Tech Lead (Apr 2021 – Dec 2023) · Senior Engineer (Jul 2020 – Mar 2021)`.
 */
function rolesLine(roles: RenderSpec["employers"][number]["roles"]): string | null {
  const titled = roles.filter((r) => r.title.trim());
  if (titled.length === 0) return null;
  if (titled.length === 1) return titled[0]!.title;
  return titled.map((r) => `${r.title} (${monthSpan(r.startedOn, r.endedOn)})`).join(" · ");
}

/**
 * Every employer the résumé includes, with its header from the record and its
 * bullets from the version. An employer the version wrote nothing for still
 * prints its header: a gap in the history is the first thing a reader asks
 * about, and the dates are true whether or not a bullet is.
 *
 * A version generated before this layout may hold an `experience` section in
 * which a paragraph opens each employer. Its groups are joined to the record by
 * the attribution check's own name resolution, so an old version downloads in
 * the new layout with its bullets under the right job. A group whose heading
 * names no employer the résumé includes is refused rather than printed: every
 * job line comes from the record, and a model-written one is what this layout
 * exists to keep off the page. Regenerating gives the version a key per job.
 */
function experienceBlocks(content: RenderContent, record: ResumeRecord): ResumeBlock[] {
  const bulletsByEmployer = new Map<string, Written[]>();
  const add = (employerId: string, blocks: Written[]) =>
    bulletsByEmployer.set(employerId, [...(bulletsByEmployer.get(employerId) ?? []), ...blocks]);

  for (const s of content.sections) {
    const employerId = employerIdOfChapter(s.key);
    if (employerId !== null) add(employerId, s.blocks.map(written));
  }

  const named = record.employers.map((e) => ({ id: e.id, names: [e.name], copy: [] }));
  for (const group of experienceGroups(content, named)) {
    const blocks = group.blocks.map(written);
    if (group.employerId === null) {
      throw new ResumeAssemblyError(
        "This résumé version has an experience heading that names no employer the résumé includes. Generate the résumé again.",
      );
    }
    add(group.employerId, blocks);
  }

  return record.employers.flatMap((e): ResumeBlock[] => {
    const titles = rolesLine(e.roles);
    return [
      { kind: "entry", lead: e.name, detail: e.city, dates: monthSpan(e.startedOn, e.endedOn) },
      ...(titles ? [{ kind: "subtitle" as const, text: titles }] : []),
      ...(bulletsByEmployer.get(e.id) ?? []).map(bullet),
    ];
  });
}

/**
 * Independent projects — those with no employer — each under its own header,
 * then any independent work the record holds as facts alone.
 */
function projectBlocks(content: RenderContent, record: ResumeRecord): ResumeBlock[] {
  const entries = record.projects
    .filter((p) => p.employerId === null)
    .flatMap((p): ResumeBlock[] => {
      return [
        { kind: "entry", lead: p.name, detail: null, dates: p.startedOn ? monthSpan(p.startedOn, p.endedOn) : null },
        ...writtenOf(content, projectKey(p.id)).map(bullet),
      ];
    });
  const other = writtenOf(content, OTHER_PROJECTS_KEY).map(bullet);
  return [...entries, ...other];
}

/**
 * Everything past secondary school, newest first: a vocational programme and a
 * row whose level is not recorded print beside a degree (`~/shared/education`).
 * The degree and field are the
 * English fields; the 学部・学科 is the 履歴書's and is never read here. An
 * entry left unfinished says so, and one still in progress says when it is
 * expected — a withdrawal printed as a degree is a misrepresentation
 * (`docs/04` §3.8).
 */
function educationBlocks(record: ResumeRecord): ResumeBlock[] {
  return record.educations
    .filter((e) => !leavesOutEducation("english_resume", e.level))
    .map((e): ResumeBlock => {
      const studied = [e.degree, e.fieldOfStudy].filter((v): v is string => Boolean(v)).join(", ");
      const detail = e.outcome === "withdrawn" ? [studied, "not completed"].filter(Boolean).join(", ") : studied;
      return { kind: "entry", lead: e.institution, detail: detail || null, dates: educationDates(e) };
    });
}

function educationDates(e: RenderSpec["educations"][number]): string | null {
  if (e.outcome === "expected") return e.endedOn ? `Expected ${monthYear(e.endedOn)}` : "In progress";
  if (e.outcome === "withdrawn" && e.startedOn && e.endedOn) return `${yearOf(e.startedOn)} – ${yearOf(e.endedOn)}`;
  const end = e.endedOn ?? e.startedOn;
  return end ? yearOf(end) : null;
}

/**
 * Current certifications of one kind, run together on one line. `other` — a
 * driving licence — is nobody's line on an English résumé.
 */
function certificationBlocks(record: ResumeRecord, today: string, kind: "technical" | "language"): ResumeBlock[] {
  const items = record.certifications
    .filter((c) => c.kind === kind && !isExpired(c.expiresOn, today))
    .flatMap((c) => {
      const name = c.name;
      if (!c.issuedOn) return [name];
      return [kind === "language" ? `${name} (${yearOf(c.issuedOn)})` : `${name}, ${yearOf(c.issuedOn)}`];
    });
  return items.length === 0 ? [] : [{ kind: "paragraph", text: items.join(" · ") }];
}

/* -------------------------------------------------------- the other formats */

const entryText = (block: Extract<ResumeBlock, { kind: "entry" }>) =>
  [block.lead, block.detail, block.dates].filter((v): v is string => v !== null).join(" · ");

/** The `?format=md` download. Same document, same order, no title above the name. */
export function resumeMarkdown(doc: ResumeDocument): string {
  const lines: string[] = [`# ${doc.name}`, ...[doc.headline, ...doc.contact].flatMap((line) => (line ? ["", line] : [])), ""];
  for (const s of doc.sections) {
    lines.push(`## ${s.heading}`, "");
    for (const block of s.blocks) {
      switch (block.kind) {
        case "entry":
          lines.push(
            `**${block.lead}**${block.detail ? ` · ${block.detail}` : ""}${block.dates ? ` — ${block.dates}` : ""}`,
            "",
          );
          break;
        case "subtitle":
          lines.push(`*${block.text}*`, "");
          break;
        case "bullet":
          lines.push(`- ${block.text}`, "");
          break;
        case "labelled":
          lines.push(`**${block.label}:** ${block.text}`, "");
          break;
        case "paragraph":
          lines.push(block.text, "");
          break;
      }
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** What a sent copy's screen shows: the file's text, in its order. Headers and titles read as rows. */
export function resumeSentPage(doc: ResumeDocument, citations = false): SentPage {
  return {
    // The file prints no title above the name (§4.3), so neither does its page.
    title: null,
    stamp: null,
    name: doc.name,
    ...(doc.headline === null ? {} : { headline: doc.headline }),
    contact: doc.contact,
    sections: doc.sections.map((s) => ({
      heading: s.heading,
      blocks: s.blocks.map((block) => {
        switch (block.kind) {
          case "entry":
            return { kind: "row" as const, text: entryText(block) };
          case "subtitle":
            return { kind: "row" as const, text: block.text };
          case "labelled":
            return { kind: "row" as const, text: `${block.label}: ${block.text}` };
          default:
            return { kind: block.kind, text: block.text, ...(citations ? { factIds: block.factIds ?? [] } : {}) };
        }
      }),
    })),
  };
}

/**
 * `Kenji-Moriyama-Resume-2026-10.docx` — the name a recruiter's downloads
 * folder can tell apart from the dozen others, and the month the version was
 * accepted, in Tokyo. ASCII only: it goes in a `content-disposition` header, so
 * accents are folded and anything else outside it is dropped.
 */
export function resumeFilename(nameLatin: string, extension: string, accepted: Date): string {
  const name = nameLatin
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[\s-]+/)
    .map((part) => part.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean)
    .join("-");
  const month = new Date(accepted.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
  return `${name ? `${name}-` : ""}Resume-${month}.${extension}`;
}
