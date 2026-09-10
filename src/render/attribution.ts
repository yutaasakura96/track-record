/**
 * How a render's attribution is checked (`docs/06`). The definition, not the
 * instrument — `scripts/check-attribution.mjs` is the thing you run.
 *
 * `metrics.ts` measures whether a render's bullets are the right SHAPE. This
 * asks a different question: whether the bullets are attached to the right
 * FACTS. The three invariants below were checked by hand at the end of every
 * generation, against a record that grows every time a document is imported.
 * A hand check that has to be repeated is a hand check that will be skipped.
 *
 *   1. unknown-fact       a block cites a fact id the record does not contain
 *   2. unfiled-fact       a fact filed to no employer is used under an employer
 *   3. misfiled-fact      a fact is used under a heading naming a DIFFERENT employer
 *
 * A fourth finding, `unresolved-heading`, is not an invariant about the render.
 * It reports a group whose employer this module could not identify, and it
 * exists because the alternative is checking nothing there and saying nothing.
 * Silence is the one failure mode a checker must not have.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *
 * - Whether a cited fact is ACCEPTED. A render should only draw on accepted
 *   facts, but "cited a candidate fact" and "cited an id that does not exist"
 *   are different faults and folding them together would make the first look
 *   like data corruption. The record passed in carries every fact whatever its
 *   status, so `unknown-fact` means genuinely unknown.
 * - Provenance and disclosure. Generated-provenance and Private-disclosure
 *   facts never reaching a render is enforced at render time (CLAUDE.md), which
 *   is the right place for it: a checker run afterwards would be a second,
 *   weaker copy of a rule that already holds.
 * - Anything about the bullets themselves. That is `metrics.ts`.
 *
 * IT REPORTS IDS AND COUNTS, NEVER TEXT. Not the offending bullet, not the
 * heading it sits under, not the fact's claim, not an excerpt in an error
 * message. Renders are built from the author's real career record and the rule
 * that logs never contain render content does not stop applying because the
 * output is a diagnostic. Block ids, fact ids, employer ids and counts are the
 * whole contract.
 *
 * The input types are structural rather than an import of `RenderContent`, so
 * that this module has no imports at all and Node can load it directly. The
 * test asserts a real `RenderContent` satisfies it, which is what keeps the two
 * from drifting apart.
 */

export interface AttributedBlock {
  id: string;
  kind: string;
  text: string;
  factIds: string[];
}

export interface AttributedSection {
  key: string;
  blocks: AttributedBlock[];
}

export interface AttributedContent {
  sections: AttributedSection[];
}

/**
 * A fact as the check needs it. `employerId` is the fact's EFFECTIVE employer:
 * its own, or its project's when it is filed to a project rather than directly
 * to an employer. Null is what "unfiled" means, and the instrument resolves the
 * project hop in SQL so that this module stays a pure function of its input.
 */
export interface RecordFact {
  id: string;
  employerId: string | null;
}

/**
 * `names` is every string that identifies this employer in a heading — 日本語
 * and Latin both, because a render writes whichever its language calls for.
 */
export interface RecordEmployer {
  id: string;
  names: string[];
}

export interface CareerRecord {
  facts: RecordFact[];
  employers: RecordEmployer[];
}

export type AttributionInvariant =
  | "unknown-fact"
  | "unfiled-fact"
  | "misfiled-fact"
  | "unresolved-heading";

export interface AttributionFinding {
  invariant: AttributionInvariant;
  /** The block that cites the fact, or the heading that could not be resolved. */
  blockId: string;
  factId: string | null;
  /** The employer the heading names. Null when it is the heading that failed. */
  headingEmployerId: string | null;
  /** The employer the fact is filed to. Null when the fact is unfiled. */
  factEmployerId: string | null;
}

export interface AttributionReport {
  findings: AttributionFinding[];
  /** Denominators. A run reporting nothing against nothing is not a pass. */
  blocksChecked: number;
  factReferencesChecked: number;
  groups: number;
  resolvedGroups: number;
}

/** The section key the register defines for employer work. Kept in step with
 * `metrics.ts` by test rather than by import — see the module note above. */
export const EXPERIENCE_SECTION = "experience";

/**
 * Corporate form and the punctuation around it. A record stores an employer's
 * legal name; a document writes whatever its layout has room for, and the two
 * differ by exactly this much.
 */
const CORPORATE_FORM = /株式会社|有限会社|合同会社|\b(?:co|ltd|inc|corp|corporation|llc|k\.?k)\b\.?/gi;
const SEPARATOR = /[.,—・()（）]/g;

/**
 * Whitespace is COLLAPSED, never removed. Removing it lifts no more headings
 * than collapsing does — measured across every proposal in the dev database,
 * both rules resolved the same groups — and it would let a short name match
 * across a word boundary, finding `abc` inside `lab candidate`. Same recall at
 * strictly less risk is not a trade.
 */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(CORPORATE_FORM, " ")
    .replace(SEPARATOR, " ")
    .replace(/[\s\u3000]+/g, " ")
    .trim();
}

interface Match {
  id: string | null;
  /** Two DIFFERENT employers matched equally well. */
  tied: boolean;
}

/** Longest name wins, so an employer whose name contains another's does not
 * lose to it. */
function longestMatch(
  heading: string,
  employers: readonly RecordEmployer[],
  prepare: (value: string) => string,
): Match {
  const text = prepare(heading);
  let id: string | null = null;
  let length = 0;
  let tied = false;

  for (const employer of employers) {
    for (const name of employer.names) {
      const needle = prepare(name);
      if (needle.length === 0 || !text.includes(needle)) continue;
      if (needle.length > length) {
        id = employer.id;
        length = needle.length;
        tied = false;
      } else if (needle.length === length && employer.id !== id) {
        tied = true;
      }
    }
  }

  return { id, tied };
}

/**
 * The experience section has no employer ids in it. It is a flat run of blocks
 * in which a `paragraph` opens a group and the bullets after it belong to that
 * group, and the only thing naming the employer is the paragraph's own prose.
 * So the heading is matched against the record's employer names — which is
 * exactly the invariant as it was checked by hand, a fact sitting under a
 * heading that names someone else.
 *
 * TWO PASSES, and the order carries the whole argument. The exact name is tried
 * first, so that where a heading writes the legal name in full nothing is
 * loosened and two employers differing only in corporate form stay distinct.
 * Only when that finds nothing does the normalised pass run, which is what
 * lifts a heading writing `架空商事` for `架空商事株式会社`. Normalisation can
 * therefore only ADD an answer where there was none; it can never overturn one.
 *
 * A tie is not a near miss and does not fall through: two employers named
 * equally well in one heading is a genuine ambiguity, and normalising it can
 * only blur the thing that would have told them apart.
 *
 * Ambiguity resolves to nothing. A checker that guesses is worse than one that
 * says it could not tell — which is why `unresolved-heading` is reported rather
 * than passed over.
 */
export function resolveEmployer(heading: string, employers: readonly RecordEmployer[]): string | null {
  const exact = longestMatch(heading, employers, (value) => value.trim().toLowerCase());
  if (exact.tied) return null;
  if (exact.id !== null) return exact.id;

  const loose = longestMatch(heading, employers, normalise);
  return loose.tied ? null : loose.id;
}

export interface AttributionGroup {
  /** The paragraph that opened it, or null for bullets preceding any paragraph. */
  headingBlockId: string | null;
  employerId: string | null;
  blocks: AttributedBlock[];
}

/** The experience section split into heading-led groups, in document order. */
export function experienceGroups(
  content: AttributedContent,
  employers: readonly RecordEmployer[],
): AttributionGroup[] {
  const section = content.sections.find((s) => s.key === EXPERIENCE_SECTION);
  if (!section) return [];

  const groups: AttributionGroup[] = [];
  for (const block of section.blocks) {
    if (block.kind === "paragraph") {
      groups.push({
        headingBlockId: block.id,
        employerId: resolveEmployer(block.text, employers),
        blocks: [],
      });
      continue;
    }
    // A block before the first paragraph has no heading to be checked against.
    // It is not dropped: it becomes a group with no heading, which reports.
    let current = groups[groups.length - 1];
    if (current === undefined) {
      current = { headingBlockId: null, employerId: null, blocks: [] };
      groups.push(current);
    }
    current.blocks.push(block);
  }
  return groups;
}

export function checkAttribution(
  content: AttributedContent,
  record: CareerRecord,
): AttributionReport {
  const byId = new Map(record.facts.map((f) => [f.id, f]));
  const findings: AttributionFinding[] = [];
  let blocksChecked = 0;
  let factReferencesChecked = 0;

  // Invariant 1 runs over every section. A citation of an id that is not in the
  // record is wrong wherever it appears, not only under an employer.
  for (const section of content.sections) {
    for (const block of section.blocks) {
      blocksChecked += 1;
      for (const factId of block.factIds) {
        factReferencesChecked += 1;
        if (byId.has(factId)) continue;
        findings.push({
          invariant: "unknown-fact",
          blockId: block.id,
          factId,
          headingEmployerId: null,
          factEmployerId: null,
        });
      }
    }
  }

  // Invariants 2 and 3 are about employer work, so they run over the experience
  // section alone.
  const groups = experienceGroups(content, record.employers);
  let resolvedGroups = 0;

  for (const group of groups) {
    if (group.employerId === null) {
      findings.push({
        invariant: "unresolved-heading",
        // A group with no heading at all is reported against its first block,
        // because there is no heading block to point at.
        blockId: group.headingBlockId ?? group.blocks[0]?.id ?? "",
        factId: null,
        headingEmployerId: null,
        factEmployerId: null,
      });
      continue;
    }
    resolvedGroups += 1;

    for (const block of group.blocks) {
      for (const factId of block.factIds) {
        const fact = byId.get(factId);
        // Already reported as unknown. Saying it twice would only make the
        // count of misfiled facts wrong.
        if (!fact) continue;
        if (fact.employerId === null) {
          findings.push({
            invariant: "unfiled-fact",
            blockId: block.id,
            factId,
            headingEmployerId: group.employerId,
            factEmployerId: null,
          });
          continue;
        }
        if (fact.employerId !== group.employerId) {
          findings.push({
            invariant: "misfiled-fact",
            blockId: block.id,
            factId,
            headingEmployerId: group.employerId,
            factEmployerId: fact.employerId,
          });
        }
      }
    }
  }

  return {
    findings,
    blocksChecked,
    factReferencesChecked,
    groups: groups.length,
    resolvedGroups,
  };
}

/** Findings per invariant, including the invariants that found nothing. */
export function countByInvariant(
  report: AttributionReport,
): Record<AttributionInvariant, number> {
  const counts: Record<AttributionInvariant, number> = {
    "unknown-fact": 0,
    "unfiled-fact": 0,
    "misfiled-fact": 0,
    "unresolved-heading": 0,
  };
  for (const finding of report.findings) counts[finding.invariant] += 1;
  return counts;
}
