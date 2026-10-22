/**
 * The career record — everything in the record, in one readable piece
 * (issue #57, `docs/06` 2026-10-08). It was called the master document until
 * issue #112, and the code still calls it that.
 *
 * It is a VIEW. It is built from the record each time it is opened, by no
 * model, and stored nowhere, so there is one source of truth and nothing to
 * keep in step with it. It holds what a résumé leaves out: Private facts,
 * Generated facts, and facts no document has ever used.
 *
 * **There is one per language** (issue #59, `docs/06` 2026-10-10), and both
 * are the same view. A language decides what the record is CALLED: the names
 * of employers, roles, projects, schools and certifications, the headings, and
 * how a month is written, each as a document of that language writes it. It
 * never decides what a fact SAYS. A claim is shown as it was written in the
 * document it was read from, because turning it into the other language is a
 * model's work and no model writes this.
 */
export type MasterLanguage = "en" | "ja";
export type MasterFlagKind = "confidential" | "number" | "unsure" | "repeat";

/** `?language=`, read forgivingly: anything that is not `ja` is English, as an unknown filter is ignored elsewhere. */
export const masterLanguage = (value: unknown): MasterLanguage => (value === "ja" ? "ja" : "en");

export interface MasterFact {
  id: string;
  claim: string;
  provenance: "measured" | "attested" | "generated";
  disclosure: "public" | "restricted" | "private";
  technologies: string[];
  /** The kinds of flag still to check on it. Empty on most facts. */
  flags: MasterFlagKind[];
  /** The imported document it was read from. `null` for a fact with none: one added by hand. */
  source: { importId: string; filename: string; lineNumber: number | null } | null;
  /** Whether the current version of any document cites it (issue #112). */
  used: boolean;
}

export interface MasterProject {
  id: string;
  name: string;
  summary: string | null;
  facts: MasterFact[];
}

export interface MasterEmployer {
  id: string;
  /** In the document's language, or the other where the record holds only that. */
  name: string;
  /** The name in the other language, when the record holds both. */
  alternateName: string | null;
  industry: string | null;
  startedOn: string;
  endedOn: string | null;
  roles: { title: string; startedOn: string; endedOn: string | null }[];
  projects: MasterProject[];
  /** Facts filed under the employer and under no project. */
  facts: MasterFact[];
}

export interface MasterDocument {
  language: MasterLanguage;
  builtAt: string;
  /** `null` until the profile is filled in. */
  subjectName: string | null;
  counts: {
    facts: number;
    /** What a document may be written from: not Private, and not Generated. */
    usable: number;
    private: number;
    generated: number;
    /** Private or Generated, or both: what no document may use. */
    keptOut: number;
    /**
     * Flags not marked checked, on facts not rejected: the number beside
     * `Flagged` in the sidebar, in the same unit (issue #112). It counted facts
     * with a flag, and the two disagreed.
     */
    flags: number;
    /** Facts still waiting to be sorted. They are not in the document yet. */
    waiting: number;
    /** Whole years from the first employment or project to the last, or to today. `null` with no dates. */
    years: number | null;
  };
  employers: MasterEmployer[];
  /** Work that belongs to no employer. */
  independent: { projects: MasterProject[]; facts: MasterFact[] };
  educations: {
    id: string;
    institution: string;
    detail: string | null;
    startedOn: string | null;
    endedOn: string | null;
    outcome: "graduated" | "completed" | "withdrawn" | "expected";
  }[];
  certifications: {
    id: string;
    name: string;
    issuingOrganization: string;
    issuedOn: string | null;
    expiresOn: string | null;
  }[];
}

/**
 * The three things worth saying about a fact, and only these (issue #112).
 * Every fact used to carry its Worth, its Who and its document, and
 * `Restricted` stood on almost every line because it is the importer's
 * default: the page printed the rule, and the exceptions were lost in it.
 * The words are the product's, the same in both languages, as on Home.
 */
export const FACT_MARK = {
  private: "Private",
  generated: "Not confirmed",
  byHand: "Added by hand",
} as const;

/** What sets a fact apart, in the order it is shown. Most facts have none. */
export function factMarks(fact: Pick<MasterFact, "disclosure" | "provenance" | "source">): (keyof typeof FACT_MARK)[] {
  return [
    ...(fact.disclosure === "private" ? (["private"] as const) : []),
    ...(fact.provenance === "generated" ? (["generated"] as const) : []),
    ...(fact.source === null ? (["byHand"] as const) : []),
  ];
}

/** A fact no document may use: Private, or Generated and not confirmed. */
export const keptOut = (fact: Pick<MasterFact, "disclosure" | "provenance">) =>
  fact.disclosure === "private" || fact.provenance === "generated";

/**
 * A project's facts, split as a CV splits them: what changed, and what was
 * done. A Measured fact is a result, because a figure stands behind it; the
 * rest is the work.
 */
export function factGroups(facts: MasterFact[]): { results: MasterFact[]; work: MasterFact[] } {
  return {
    results: facts.filter((fact) => fact.provenance === "measured"),
    work: facts.filter((fact) => fact.provenance !== "measured"),
  };
}

/**
 * The document's own words, per language: its headings and the few words it
 * puts around the record. The screen and the file both read these, so the two
 * cannot name a section differently. The marks of `FACT_MARK` are not here:
 * they are the product's terms, and a second word for each would be a second
 * vocabulary to learn.
 */
export const MASTER_WORDS = {
  en: {
    title: "Career record",
    contents: "Contents",
    results: "Results",
    work: "What I did",
    outside: "Work outside employment",
    otherWork: "Other work here",
    unfiled: "Not filed under a project",
    education: "Education",
    certifications: "Certifications",
    educationAndCertifications: "Education and certifications",
    noFacts: "Nothing filed here yet.",
    role: "Role",
    present: "present",
    outcome: { graduated: "graduated", completed: "completed", withdrawn: "withdrawn", expected: "expected" },
    issued: (month: string) => `issued ${month}`,
    expires: (month: string) => `expires ${month}`,
  },
  ja: {
    title: "キャリア記録",
    contents: "目次",
    results: "成果",
    work: "取り組み",
    outside: "雇用外の活動",
    otherWork: "その他の業務",
    unfiled: "プロジェクト未分類",
    education: "学歴",
    certifications: "資格",
    educationAndCertifications: "学歴・資格",
    noFacts: "まだ何もありません。",
    role: "職務",
    present: "現在",
    // The closing words a 履歴書 uses (`src/render/rirekisho-rows.ts`): a withdrawal reads 中退, never 卒業.
    outcome: { graduated: "卒業", completed: "修了", withdrawn: "中退", expected: "卒業見込み" },
    issued: (month: string) => `${month}取得`,
    expires: (month: string) => `${month}失効`,
  },
} as const;

/**
 * `2024-09-01` → `2024-09`, or `2024年9月`. Calendar columns are month
 * precision; the day is never shown.
 */
export function monthOf(date: string | null, language: MasterLanguage = "en"): string | null {
  if (!date) return null;
  return language === "ja" ? `${Number(date.slice(0, 4))}年${Number(date.slice(5, 7))}月` : date.slice(0, 7);
}

/** `2022-04 to present`, or `2022年4月〜現在`. `open` is what an absent end reads as. */
export function period(
  startedOn: string | null,
  endedOn: string | null,
  language: MasterLanguage = "en",
  open: string = MASTER_WORDS[language].present,
): string | null {
  if (startedOn === null && endedOn === null) return null;
  const from = monthOf(startedOn, language) ?? "?";
  const to = monthOf(endedOn, language) ?? open;
  return language === "ja" ? `${from}〜${to}` : `${from} to ${to}`;
}

/** `2015 – 2017`, `2024 – now`, or `2024年〜現在`: the years alone, for the contents. */
export function yearSpan(startedOn: string | null, endedOn: string | null, language: MasterLanguage = "en"): string | null {
  if (startedOn === null) return null;
  const from = startedOn.slice(0, 4);
  if (language === "ja") return `${from}年〜${endedOn ? `${endedOn.slice(0, 4)}年` : MASTER_WORDS.ja.present}`;
  const to = endedOn ? endedOn.slice(0, 4) : "now";
  return from === to ? from : `${from} – ${to}`;
}

/* ----------------------------------------------------------------- figures */

/** A counter that makes a written-out number a figure: `nine months`, `four engineers`. */
const UNIT =
  "(?:percent|ms|milliseconds?|seconds?|secs?|s|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|quarters?|years?|" +
  "KB|MB|GB|TB|PB|requests?|users?|people|engineers?|developers?|members?|services?|teams?|squads?|clients?|" +
  "customers?|participants?|countries|languages|releases?|times)";
const TENS = "(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)";
const WORD_NUMBER =
  `(?:${TENS}-(?:one|two|three|four|five|six|seven|eight|nine)|one|two|three|four|five|six|seven|eight|nine|ten|eleven|` +
  `twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|${TENS}|hundreds|thousands|millions)`;
/** The counters a Japanese figure is written with: 30%, 3倍, 5名, 2年. */
const COUNTER = "(?:%|％|×|倍|割|名|人|件|社|台|万円|億円|円|万|億|回|時間|日|週間|ヶ月|か月|カ月|年間|年|分|秒)";
// Thousands commas, and at most one decimal point: `1,200`, `0.42`.
const DIGITS = "[¥$€£]?(?:\\p{Nd}{1,3}(?:,\\p{Nd}{3})+|\\p{Nd}+)(?:\\.\\p{Nd}+)?";
const FIGURE = new RegExp(
  [
    // `1 in 5`, `one in twenty`: a rate, read as one figure.
    `(?:one|\\p{Nd}+) in (?:${WORD_NUMBER}|five|\\p{Nd}+)`,
    `\\b${WORD_NUMBER} ${UNIT}(?![\\p{L}])`,
    `${DIGITS}(?:\\s?${COUNTER}|x(?![\\p{L}]))?(?: (?:hundred|thousand|million|billion))?(?: ?${UNIT}(?![\\p{L}]))?`,
    // A figure written in kanji, with the counter that makes it one.
    "[〇一二三四五六七八九十百千万億]+(?:割|倍|名|人|件|年|ヶ月|か月|カ月|週間|時間|秒|社|台|円|回|％|%)",
  ].join("|"),
  "giu",
);
const LATIN_WORD = /[A-Za-z0-9_]/;
/**
 * One part of a longer run: an address or a version (`10.20.4.15`, `3.12.1`),
 * or a name joined by hyphens (`prd-01`, `twenty-six`).
 */
const JOINED_AFTER = /^(?:[.:]\p{Nd}|-[A-Za-z0-9])/u;
const JOINED_BEFORE = /(?:\p{Nd}[.:]|[A-Za-z0-9]-)$/u;
const YEAR = /^(?:19|20)\d{2}年?$/;

/**
 * A claim cut where its figures are, so they can be set apart: the numbers are
 * what a résumé is built from (issue #112). Read by rule, not by a model.
 *
 * Not a figure: a digit inside a word (`EC2`, `K8s`, `2FA`), a year alone, an
 * address or a version (`10.20.4.15`), or a digit inside a technology the fact
 * names (`Java 17`). The importer's number flag reads figures with this
 * (`unsourcedNumber`), so the two agree on what a figure is.
 */
export function figures(claim: string, technologies: string[] = []): { text: string; figure: boolean }[] {
  const named: [number, number][] = [];
  for (const name of technologies) {
    const trimmed = name.trim();
    if (trimmed === "" || !/\p{Nd}/u.test(trimmed)) continue;
    const pattern = new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    for (const match of claim.matchAll(pattern)) named.push([match.index, match.index + match[0].length]);
  }

  const parts: { text: string; figure: boolean }[] = [];
  let at = 0;
  for (const match of claim.matchAll(FIGURE)) {
    const start = match.index;
    const end = start + match[0].length;
    if (LATIN_WORD.test(claim[start - 1] ?? "") || LATIN_WORD.test(claim[end] ?? "")) continue;
    if (JOINED_AFTER.test(claim.slice(end, end + 2)) || JOINED_BEFORE.test(claim.slice(Math.max(0, start - 2), start))) continue;
    if (YEAR.test(match[0])) continue;
    if (named.some(([from, to]) => start < to && end > from)) continue;
    if (start > at) parts.push({ text: claim.slice(at, start), figure: false });
    parts.push({ text: match[0], figure: true });
    at = end;
  }
  if (at < claim.length) parts.push({ text: claim.slice(at), figure: false });
  return parts;
}

/* -------------------------------------------------------------- the counts */

const many = (n: number, one: string, other: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : other}`;
const are = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "is" : "are"}`;

/**
 * The count line, in plain sentences (issue #112): how much the record holds,
 * how much of it can go into a document, and why the rest cannot. The screen
 * and the English file say it in the same words.
 */
export function countSentences(counts: MasterDocument["counts"]): {
  /** `59 achievements across 11 years. 53 can go into a document.` */
  lead: string;
  /** `4 are kept private, and 2 are not confirmed yet.`, or `null` when nothing is kept out. */
  held: string | null;
  /** `34 flags to check.`, in the sidebar's unit, or `null` at none. */
  flags: string | null;
  /** `2 more are waiting to be sorted and are not listed yet.`, or `null` at none. */
  waiting: string | null;
} {
  const across = counts.years && counts.years > 0 ? ` across ${many(counts.years, "year", "years")}` : "";
  const reasons = [
    counts.private > 0 ? `${are(counts.private)} kept private` : null,
    counts.generated > 0 ? `${are(counts.generated)} not confirmed yet` : null,
  ].filter(Boolean);
  return {
    lead:
      counts.facts === 0
        ? "No achievements yet."
        : `${many(counts.facts, "achievement", "achievements")}${across}. ${counts.usable.toLocaleString("en-US")} can go into a document.`,
    held: reasons.length > 0 ? `${reasons.join(", and ")}.` : null,
    flags: counts.flags > 0 ? `${many(counts.flags, "flag", "flags")} to check.` : null,
    waiting:
      counts.waiting > 0
        ? `${counts.waiting.toLocaleString("en-US")} more ${counts.waiting === 1 ? "is" : "are"} waiting to be sorted and ${counts.waiting === 1 ? "is" : "are"} not listed yet.`
        : null,
  };
}
