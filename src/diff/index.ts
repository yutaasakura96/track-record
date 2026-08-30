/**
 * The diff engine (`docs/03-technical-design.md` §6.1).
 *
 * Two passes, because one pass is unreadable:
 *
 *   1. Align blocks between the current and proposed versions BY SIMILARITY,
 *      not by position. Without this, a single inserted sentence shifts
 *      everything after it and the whole document reads as changed.
 *   2. Diff tokens inside each matched pair — Myers, the same algorithm git
 *      uses, at word granularity for English and 文節 granularity for Japanese.
 *
 * Computed server-side. The client renders what this returns.
 */
import { diffArrays } from "diff";
import type { Block, RenderContent } from "~/shared/render-content";
import { segment } from "~/segment";

export type TokenOp = "equal" | "add" | "remove";

export interface DiffToken {
  op: TokenOp;
  text: string;
}

export type RationaleKind =
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

export interface DiffChange {
  changeId: string;
  sectionKey: string;
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
  language: "en" | "ja";
  /** Supplies the rationale for each change. A change without one is a defect. */
  explain: (input: {
    currentBlock: Block | null;
    proposedBlock: Block | null;
  }) => Rationale;
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
    const before = currentSections.get(section.key)?.blocks ?? [];
    for (const pair of alignBlocks(before, section.blocks, options.language)) {
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
        sectionKey: section.key,
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
    for (const block of section.blocks) {
      removals++;
      changes.push({
        changeId: `chg_${++n}`,
        sectionKey: key,
        currentBlockId: block.id,
        proposedBlockId: null,
        tokens: [{ op: "remove", text: block.text }],
        rationale: options.explain({ currentBlock: block, proposedBlock: null }),
      });
    }
  }

  return { additions, removals, changes };
}

/* -------------------------------------------------------- pass 1: alignment */

interface AlignedPair {
  current: Block | null;
  proposed: Block | null;
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
  language: "en" | "ja",
): AlignedPair[] {
  const tokenSets = new Map<Block, Set<string>>();
  const tokensOf = (block: Block) => {
    let set = tokenSets.get(block);
    if (!set) {
      set = new Set(segment(block.text, language).map((t) => t.trim()).filter(Boolean));
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

  // Walk the proposal in document order, emitting removals from the current
  // version at the point they used to sit.
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

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared++;
  return shared / (a.size + b.size - shared);
}

/* ------------------------------------------------------------ pass 2: tokens */

export function tokenDiff(
  current: Block | null,
  proposed: Block | null,
  language: "en" | "ja",
): DiffToken[] {
  if (!current) return proposed ? [{ op: "add", text: proposed.text }] : [];
  if (!proposed) return [{ op: "remove", text: current.text }];
  if (current.text === proposed.text) return [{ op: "equal", text: current.text }];

  return diffArrays(segment(current.text, language), segment(proposed.text, language)).map(
    (part) => ({
      op: part.added ? "add" : part.removed ? "remove" : "equal",
      // Both segmenters produce tokens that concatenate back to the original —
      // Latin tokens carry their trailing space, Japanese phrases are adjacent.
      text: part.value.join(""),
    }),
  );
}
