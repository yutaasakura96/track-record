/**
 * The master document — everything in the record, in one readable piece
 * (issue #57, `docs/06` 2026-10-08).
 *
 * It is a VIEW. It is built from the record each time it is opened, by no
 * model, and stored nowhere, so there is one source of truth and nothing to
 * keep in step with it. It holds what a résumé leaves out: Private facts,
 * Generated facts, and facts no document has ever used.
 */
export type MasterFlagKind = "confidential" | "number" | "unsure" | "repeat";

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
  name: string;
  /** The Japanese name, when the heading is the Latin one. */
  nameJa: string | null;
  industry: string | null;
  startedOn: string;
  endedOn: string | null;
  roles: { title: string; startedOn: string; endedOn: string | null }[];
  projects: MasterProject[];
  /** Facts filed under the employer and under no project. */
  facts: MasterFact[];
}

export interface MasterDocument {
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

/** `2024-09-01` → `2024-09`. Calendar columns are month precision; the day is never shown. */
export const monthOf = (date: string | null) => (date ? date.slice(0, 7) : null);

export const period = (startedOn: string | null, endedOn: string | null, open = "present") =>
  startedOn === null && endedOn === null ? null : `${monthOf(startedOn) ?? "?"} to ${monthOf(endedOn) ?? open}`;
