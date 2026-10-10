/**
 * The master document — everything in the record, in one readable piece
 * (issue #57, `docs/06` 2026-10-08).
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
  /** The imported document it was read from. `null` for a fact with none. */
  source: { importId: string; filename: string; lineNumber: number | null } | null;
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
    flagged: number;
    /** Facts still waiting to be sorted. They are not in the document yet. */
    waiting: number;
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

export const PROVENANCE_LABEL = { measured: "Measured", attested: "Attested", generated: "Generated" } as const;
export const DISCLOSURE_LABEL = { public: "Public", restricted: "Restricted", private: "Private" } as const;

/**
 * The document's own words, per language: its headings and the few words it
 * puts around the record. The screen and the file both read these, so the two
 * cannot name a section differently. `Measured`, `Private` and the rest are
 * not here: they are the product's terms, the ones on the fact card, and a
 * second word for each would be a second vocabulary to learn.
 */
export const MASTER_WORDS = {
  en: {
    title: "Master document",
    outside: "Work outside employment",
    otherWork: "Other work here",
    unfiled: "Not filed under a project",
    education: "Education",
    certifications: "Certifications",
    noFacts: "No facts filed here yet.",
    role: "Role",
    present: "present",
    outcome: { graduated: "graduated", completed: "completed", withdrawn: "withdrawn", expected: "expected" },
    issued: (month: string) => `issued ${month}`,
    expires: (month: string) => `expires ${month}`,
  },
  ja: {
    title: "マスタードキュメント",
    outside: "雇用外の活動",
    otherWork: "その他の業務",
    unfiled: "プロジェクト未分類",
    education: "学歴",
    certifications: "資格",
    noFacts: "まだ事実がありません。",
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
