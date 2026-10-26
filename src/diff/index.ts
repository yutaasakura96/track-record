/**
 * The diff engine (`docs/03-technical-design.md` §6.1).
 *
 * Two passes, because one pass is unreadable:
 *
 *   1. Align blocks between the current and proposed versions BY SIMILARITY,
 *      not by position. Without this, a single inserted sentence shifts
 *      everything after it and the whole document reads as changed.
 *   2. Diff tokens inside each matched pair — Myers, the same algorithm git
 *      uses, at word granularity instead of line granularity.
 *
 * Computed server-side. The client renders what this returns.
 *
 * **Both languages, and the language is the only thing that differs.** Tokens
 * are words and punctuation for English and BudouX phrases for Japanese
 * (`docs/03` §6.1, `docs/07` §API). Myers and the rationale are identical
 * downstream of the tokenizer, which is the point: Japanese support is a
 * different token list, not a different engine. Alignment compares Japanese on
 * character bigrams rather than phrases, and only there — see
 * {@link alignmentKeys}.
 */
import { diffArrays } from "diff";
import { segmentJapanese } from "~/segment";
import { CORPORATE_FORM, EXPERIENCE_SECTION, resolveEmployer, type EmployerNames } from "~/render/attribution";
import type { Block, RenderContent, RenderSection } from "~/shared/render-content";

/**
 * Which tokenizer the two passes run on. It comes from the render kind
 * (`RENDER_LANGUAGE`), never from inspecting the text: a Japanese document
 * whose one generated paragraph happens to be mostly Latin is still a Japanese
 * document, and a guess would diff it two ways on two days.
 */
export type DiffLanguage = "en" | "ja";

export type TokenOp = "equal" | "add" | "remove";

export interface DiffToken {
  op: TokenOp;
  text: string;
}

export type RationaleKind =
  | "heading_changed"
  | "from_facts"
  | "removed_no_support"
  | "removed_unverified"
  | "from_restricted";

export interface Rationale {
  kind: RationaleKind;
  /** Written for a human. Never carries a fact claim or source text. */
  text: string;
  factIds: string[];
}

/**
 * What a change is a change to. A section's heading is not a block: it has no
 * id, no facts behind it and nothing aligns it, but a regeneration can rewrite
 * every one of them, and a review that cannot show that is not a review.
 */
export type ChangeTarget = "block" | "heading";

/**
 * Where in the document a change sits. The split view shows changed blocks
 * only, so without this a reworded bullet in a 職務経歴書 — where every
 * employer is inside the one `experience` section — cannot be placed under its
 * company without opening the document (#117, review D2).
 */
export interface ChangeLocation {
  /** The section's heading, on the side the change is read on. */
  section: string;
  /**
   * The opening paragraph of the employer group the block falls under, in an
   * `experience` section. Null outside one, for a heading change, and for the
   * opening paragraph itself, which is the employer line already.
   */
  employer: string | null;
}

export interface DiffChange {
  changeId: string;
  /** `heading` changes carry null block ids and read the heading's own tokens. */
  target: ChangeTarget;
  sectionKey: string;
  location: ChangeLocation;
  currentBlockId: string | null;
  proposedBlockId: string | null;
  tokens: DiffToken[];
  rationale: Rationale;
}

export interface RenderDiff {
  additions: number;
  removals: number;
  changes: DiffChange[];
}

/**
 * How alike two blocks must be to count as the same block, edited, rather than
 * one removed and one added. Tuned against real proposals is the plan
 * (`docs/03` §11, item 4); this is the starting point.
 */
const ALIGNMENT_THRESHOLD = 0.4;

export interface DiffOptions {
  /** The render's own language, from `RENDER_LANGUAGE`. Never inferred. */
  language: DiffLanguage;
  /** Supplies the rationale for each change. A change without one is a defect. */
  explain: (input: {
    currentBlock: Block | null;
    proposedBlock: Block | null;
  }) => Rationale;
  /**
   * The record's employers, which decide which employer an `experience`
   * group's opening paragraph names. Loaded for the render's own user.
   */
  employers: readonly EmployerNames[];
}

export function diffRenders(
  current: RenderContent | null,
  proposed: RenderContent,
  options: DiffOptions,
): RenderDiff {
  const changes: DiffChange[] = [];
  let additions = 0;
  let removals = 0;
  let n = 0;

  const currentSections = new Map((current?.sections ?? []).map((s) => [s.key, s]));
  const seenSections = new Set<string>();

  for (const section of proposed.sections) {
    seenSections.add(section.key);
    const currentSection = currentSections.get(section.key);
    const before = currentSection?.blocks ?? [];

    const heading = headingChange(currentSection, section, options.language);
    if (heading) {
      if (heading.some((t) => t.op === "add")) additions++;
      if (heading.some((t) => t.op === "remove")) removals++;
      changes.push(headingEntry(++n, section.key, heading, currentSection, section));
    }

    const employerBefore = employerLines(currentSection);
    const employerAfter = employerLines(section);

    for (const pair of alignSection(before, section, options)) {
      const tokens = tokenDiff(pair.current, pair.proposed, options.language);
      if (tokens.every((t) => t.op === "equal")) continue;

      if (pair.proposed && !pair.current) additions++;
      else if (pair.current && !pair.proposed) removals++;
      else {
        additions++;
        removals++;
      }

      changes.push({
        changeId: `chg_${++n}`,
        target: "block",
        sectionKey: section.key,
        // A removal is placed where it sat in the current version; anything
        // else where it would sit in the proposal.
        location: pair.proposed
          ? { section: section.heading, employer: employerAfter.get(pair.proposed.id) ?? null }
          : {
              section: currentSection?.heading ?? section.heading,
              employer: employerBefore.get(pair.current!.id) ?? null,
            },
        currentBlockId: pair.current?.id ?? null,
        proposedBlockId: pair.proposed?.id ?? null,
        tokens,
        rationale: options.explain({ currentBlock: pair.current, proposedBlock: pair.proposed }),
      });
    }
  }

  // A section present in the current version and absent from the proposal is a
  // wholesale removal, and each of its blocks still needs its own explanation.
  for (const [key, section] of currentSections) {
    if (seenSections.has(key)) continue;
    const heading = headingChange(section, undefined, options.language);
    if (heading) {
      removals++;
      changes.push(headingEntry(++n, key, heading, section, undefined));
    }
    const employers = employerLines(section);
    for (const block of section.blocks) {
      removals++;
      changes.push({
        changeId: `chg_${++n}`,
        target: "block",
        sectionKey: key,
        location: { section: section.heading, employer: employers.get(block.id) ?? null },
        currentBlockId: block.id,
        proposedBlockId: null,
        tokens: [{ op: "remove", text: block.text }],
        rationale: options.explain({ currentBlock: block, proposedBlock: null }),
      });
    }
  }

  return { additions, removals, changes };
}

/* ------------------------------------------------------------- headings */

/**
 * The tokens of a heading change, or null when there is none to show.
 *
 * A section with no blocks is not in the document (`docs/10` Screen 9: it
 * "disappears from the document and keeps its heading"), so a heading nobody
 * would read is not a change anybody can review.
 */
function headingChange(
  current: RenderSection | undefined,
  proposed: RenderSection | undefined,
  language: DiffLanguage,
): DiffToken[] | null {
  const shown = (s: RenderSection | undefined) => (s && s.blocks.length > 0 ? s.heading : null);
  const before = shown(current);
  const after = shown(proposed);
  if (before === after) return null;
  if (before === null) return [{ op: "add", text: after! }];
  if (after === null) return [{ op: "remove", text: before }];
  return diffArrays(tokensFor(before, language), tokensFor(after, language)).map((part) => ({
    op: part.added ? "add" : part.removed ? "remove" : "equal",
    text: part.value.join(""),
  }));
}

function headingEntry(
  n: number,
  sectionKey: string,
  tokens: DiffToken[],
  current: RenderSection | undefined,
  proposed: RenderSection | undefined,
): DiffChange {
  const shownBefore = current !== undefined && current.blocks.length > 0;
  const shownAfter = proposed !== undefined && proposed.blocks.length > 0;
  return {
    changeId: `chg_${n}`,
    target: "heading",
    sectionKey,
    // The tokens show both wordings; the location names the one the document
    // would carry, or the one it loses with the section.
    location: { section: (shownAfter ? proposed?.heading : current?.heading) ?? "", employer: null },
    currentBlockId: null,
    proposedBlockId: null,
    tokens,
    rationale: {
      kind: "heading_changed",
      // A heading is written with its section, not from a fact, so there is no
      // source to cite. Saying so is the rationale; an empty one is a defect.
      text: !shownBefore
        ? "Heading of a new section · written with the section, not from a fact"
        : !shownAfter
          ? "Heading removed with its section"
          : "Heading rewritten · headings are written with the section, not from a fact",
      factIds: [],
    },
  };
}

/**
 * Block id → the employer line it falls under, in an `experience` section.
 *
 * The section carries no employer ids: a `paragraph` opens an employer group
 * and every row and bullet after it belongs to that group, the same reading
 * `src/render/attribution.ts` checks against. The opening paragraph is the
 * employer's name, period and roles, so it is the line that places a change,
 * in the document's own words.
 */
function employerLines(section: RenderSection | undefined): Map<string, string> {
  const lines = new Map<string, string>();
  if (section?.key !== EXPERIENCE_SECTION) return lines;
  let employer: string | null = null;
  for (const block of section.blocks) {
    if (block.kind === "paragraph") {
      employer = block.text;
      continue;
    }
    if (employer !== null) lines.set(block.id, employer);
  }
  return lines;
}

/* -------------------------------------------------------- pass 1: alignment */

interface AlignedPair {
  current: Block | null;
  proposed: Block | null;
}

interface EmployerGroup {
  opening: Block;
  rest: Block[];
}

/**
 * Splits an `experience` section's blocks the way {@link employerLines} reads
 * them: whatever comes before the first paragraph, then one group per opening
 * paragraph.
 */
function employerGroups(blocks: Block[]): { lead: Block[]; groups: EmployerGroup[] } {
  const lead: Block[] = [];
  const groups: EmployerGroup[] = [];
  for (const block of blocks) {
    if (block.kind === "paragraph") groups.push({ opening: block, rest: [] });
    else if (groups.length > 0) groups[groups.length - 1]!.rest.push(block);
    else lead.push(block);
  }
  return { lead, groups };
}

/** Where a company name ends: a bracket, a heading separator, or the period's first digit. */
const PERIOD_OR_SEPARATOR = /[()—・·|]|\d{4}(?!\d)|\d{1,2}\s*[年月]/u;

/**
 * Which employer an opening paragraph names. The opening paragraph also carries
 * the period, the 雇用形態 and the role titles, and two employers share most of
 * those, so similarity cannot say which employer a group is.
 *
 * The record decides first, as {@link resolveEmployer} reads a heading. Only
 * when no record employer matches does the company name written before the
 * period stand in: width-normalised, corporate form dropped, and cut at the
 * first bracket, heading separator or the period's first digit — a year or a
 * number of months, so a digit inside the name (3M) stays in it. Null when
 * neither names anyone, and a group with no identity pairs with nothing.
 */
function employerIdentity(opening: string, employers: readonly EmployerNames[]): string | null {
  const id = resolveEmployer(opening, employers);
  if (id !== null) return `record:${id}`;
  const text = opening
    .normalize("NFKC")
    .replace(/\((?:株|有|合|同)\)/gu, " ")
    .replace(CORPORATE_FORM, " ");
  const cut = text.search(PERIOD_OR_SEPARATOR);
  const name = (cut === -1 ? text : text.slice(0, cut)).replace(/\s+/gu, " ").trim().toLowerCase();
  return name === "" ? null : `name:${name}`;
}

/**
 * Alignment for one section. Outside an `experience` section the whole section
 * is one group. Inside one, a block only pairs with a block under the same
 * employer: opening paragraphs pair when they name the same employer, and each
 * pair of groups then aligns its own rows and bullets. A 職務経歴書 repeats the
 * same template rows (資本金, 従業員数, 技術スタック) under every employer, and on
 * bigrams two employers' rows are alike enough to pair, which would label one
 * employer's old figures as another's. A block that moved to another employer
 * is one removal and one addition, each under its own employer.
 */
function alignSection(
  current: Block[],
  proposed: RenderSection,
  { language, employers }: DiffOptions,
): AlignedPair[] {
  if (proposed.key !== EXPERIENCE_SECTION) return alignBlocks(current, proposed.blocks, language);

  const before = employerGroups(current);
  const after = employerGroups(proposed.blocks);
  const restOf = (groups: EmployerGroup[]) => new Map(groups.map((g) => [g.opening, g.rest]));
  const restBefore = restOf(before.groups);
  const restAfter = restOf(after.groups);

  const currentOpenings = before.groups.map((g) => g.opening);
  const proposedOpenings = after.groups.map((g) => g.opening);
  const matchOf = new Map<number, number>();
  const claimed = new Set<number>();
  const currentIdentities = currentOpenings.map((c) => employerIdentity(c.text, employers));
  proposedOpenings.forEach((p, pi) => {
    const identity = employerIdentity(p.text, employers);
    if (identity === null) return;
    const ci = currentIdentities.findIndex((c, i) => !claimed.has(i) && c === identity);
    if (ci === -1) return;
    claimed.add(ci);
    matchOf.set(pi, ci);
  });

  const pairs = alignBlocks(before.lead, after.lead, language);
  for (const { current: c, proposed: p } of inDocumentOrder(currentOpenings, proposedOpenings, matchOf)) {
    pairs.push({ current: c, proposed: p });
    if (c && p) pairs.push(...alignBlocks(restBefore.get(c)!, restAfter.get(p)!, language));
    else if (c) pairs.push(...restBefore.get(c)!.map((block) => ({ current: block, proposed: null })));
    else pairs.push(...restAfter.get(p!)!.map((block) => ({ current: null, proposed: block })));
  }
  return pairs;
}

/**
 * Greedy best-match alignment, restricted to the same section. Each current
 * block is claimed by at most one proposed block, and the pairing is chosen by
 * similarity so that an insertion does not shunt every later block into
 * looking changed.
 */
export function alignBlocks(
  current: Block[],
  proposed: Block[],
  language: DiffLanguage = "en",
): AlignedPair[] {
  const tokenSets = new Map<Block, Set<string>>();
  const tokensOf = (block: Block) => {
    let set = tokenSets.get(block);
    if (!set) {
      set = new Set(alignmentKeys(block.text, language));
      tokenSets.set(block, set);
    }
    return set;
  };

  const scored: { c: number; p: number; score: number }[] = [];
  current.forEach((c, ci) =>
    proposed.forEach((p, pi) => {
      const score = c.text === p.text ? 1 : jaccard(tokensOf(c), tokensOf(p));
      if (score >= ALIGNMENT_THRESHOLD) scored.push({ c: ci, p: pi, score });
    }),
  );
  scored.sort((a, b) => b.score - a.score || a.c - b.c || a.p - b.p);

  const currentTaken = new Set<number>();
  const proposedTaken = new Set<number>();
  const matchOf = new Map<number, number>(); // proposed index → current index
  for (const { c, p } of scored) {
    if (currentTaken.has(c) || proposedTaken.has(p)) continue;
    currentTaken.add(c);
    proposedTaken.add(p);
    matchOf.set(p, c);
  }
  return inDocumentOrder(current, proposed, matchOf);
}

/**
 * Walks the proposal in document order, emitting removals from the current
 * version at the point they used to sit. `matchOf` maps a proposed index to
 * the current index it pairs with.
 */
function inDocumentOrder(current: Block[], proposed: Block[], matchOf: Map<number, number>): AlignedPair[] {
  const currentTaken = new Set(matchOf.values());
  const pairs: AlignedPair[] = [];
  let nextCurrent = 0;
  proposed.forEach((p, pi) => {
    const ci = matchOf.get(pi);
    if (ci !== undefined) {
      for (let i = nextCurrent; i < ci; i++) {
        if (!currentTaken.has(i)) pairs.push({ current: current[i]!, proposed: null });
      }
      nextCurrent = Math.max(nextCurrent, ci + 1);
      pairs.push({ current: current[ci]!, proposed: p });
    } else {
      pairs.push({ current: null, proposed: p });
    }
  });
  for (let i = nextCurrent; i < current.length; i++) {
    if (!currentTaken.has(i)) pairs.push({ current: current[i]!, proposed: null });
  }
  return pairs;
}

/**
 * What two blocks are compared on to decide whether they are the same block.
 *
 * English compares the words pass 2 diffs. Japanese does not compare the BudouX
 * phrases pass 2 diffs: a phrase carries its particle, so 「締めを」 and
 * 「締めの」 are different tokens, and a four-phrase bullet that changes one
 * particle loses half its matches. Short bullets reworded that lightly scored
 * 0.2–0.3 on phrases and showed as one whole line removed and another added
 * (#117, review D1). Character bigrams survive a changed particle — only the
 * bigrams touching it change — and still share next to nothing between two
 * unrelated bullets, so one threshold serves both languages. (`tokenize` is
 * worse still on Japanese: it returns a whole paragraph as one token, and
 * alignment would degrade to exact match.)
 *
 * Only alignment reads this. What is shown stays BudouX phrases: a mark on two
 * characters is the scatter `docs/10` Screen 2 rules out.
 */
export function alignmentKeys(text: string, language: DiffLanguage): string[] {
  if (language === "en") return tokensFor(text, language).map((t) => t.trim()).filter(Boolean);
  const chars = Array.from(text.replace(/\s+/gu, ""));
  if (chars.length < 2) return chars;
  return chars.slice(1).map((char, i) => chars[i]! + char);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared++;
  return shared / (a.size + b.size - shared);
}

/* ------------------------------------------------------------ pass 2: tokens */

/**
 * Words and punctuation runs, with the whitespace that follows each token kept
 * attached, so joining the tokens reproduces the input exactly.
 *
 * English only, and unusable on Japanese: the pattern splits on whitespace, and
 * Japanese has none between words, so a whole paragraph comes back as one
 * token. That is what {@link segmentJapanese} is for.
 */
export const tokenize = (text: string): string[] => text.match(/\S+\s*/gu) ?? [];

/**
 * The token list for a language. Both sides hold the same contract — the pieces
 * concatenate back to the input — so the two passes below never learn which
 * language they are running on.
 */
export const tokensFor = (text: string, language: DiffLanguage): string[] =>
  language === "ja" ? segmentJapanese(text) : tokenize(text);

export function tokenDiff(
  current: Block | null,
  proposed: Block | null,
  language: DiffLanguage = "en",
): DiffToken[] {
  if (!current) return proposed ? [{ op: "add", text: proposed.text }] : [];
  if (!proposed) return [{ op: "remove", text: current.text }];
  if (current.text === proposed.text) return [{ op: "equal", text: current.text }];

  return diffArrays(tokensFor(current.text, language), tokensFor(proposed.text, language)).map((part) => ({
    op: part.added ? "add" : part.removed ? "remove" : "equal",
    // Tokens concatenate back to the original — an English one carries its
    // trailing space, and a BudouX phrase carries whatever punctuation and line
    // break sat inside it.
    text: part.value.join(""),
  }));
}
