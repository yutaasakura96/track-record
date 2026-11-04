/**
 * The 職務経歴書's technology lists, bounded in code after the model writes them.
 *
 * Its skills section and every employer's 技術スタック row are the two places
 * the model lists technologies, and the register's word was all that bounded
 * them. The first real record named about 800 technologies across its facts,
 * with `zod` beside `Zod` and `S3` beside `AWS S3`, and a list written "from
 * the facts" had nothing to stop it at. The register now says how long each
 * list runs; this makes the bound true whatever came back.
 *
 * Only an item that IS a technology the record names is ever removed — a
 * segment between two list separators that folds (`skillKey`) to one. Prose
 * around a list, and a phrase that merely contains a technology
 * (`Javaを用いた設計`), are kept as written.
 */
import type { RenderSpec } from "~/model/types";
import type { Block, RenderContent } from "~/shared/render-content";
import { AUTO_SKILL_CAP, skillKey } from "~/shared/skills";
import { hasJapaneseScript } from "./language";

/** The skills section's key in the 職務経歴書 register. */
const SKILLS_SECTION = "skills";

/** The row label the register gives each employer's technologies. */
const TECH_STACK_LABEL = "技術スタック：";

/** How many technologies one 技術スタック row names. The register states the same number. */
export const TECH_STACK_CAP = 12;

/** A list separator, with the spaces around it: 、 , ， and the ・ a Japanese list also uses. */
const SEPARATOR = /(\s*[、,，・]\s*)/u;

/** Sentence-closing punctuation a list's last item may carry. */
const CLOSING = /[。．.]+$/u;

interface ListBound {
  /** Every technology the record names, by key: what may be removed. */
  known: ReadonlySet<string>;
  /** When set, a known technology not on it is removed too. */
  allowed: ReadonlySet<string> | null;
  /** Shared across the texts one bound covers, so a repeat in a later one goes. */
  seen: Set<string>;
  cap: number | null;
}

/**
 * `text` with each technology named once, none past `cap`, and none outside
 * `allowed`. A label up to the first full-width colon is kept as it is.
 */
export function boundTechnologyList(text: string, bound: ListBound): string {
  const colon = text.indexOf("：");
  const label = colon === -1 ? "" : text.slice(0, colon + 1);
  const parts = text.slice(label.length).split(SEPARATOR);
  // parts alternates item, separator, item, …
  let out = "";
  let closing = "";
  for (let i = 0; i < parts.length; i += 2) {
    const raw = parts[i]!;
    const last = i === parts.length - 1;
    const trailing = last ? (raw.trim().match(CLOSING)?.[0] ?? "") : "";
    const item = trailing ? raw.trimEnd().slice(0, -trailing.length) : raw;
    const key = skillKey(item);
    const isTechnology = key !== "" && bound.known.has(key);
    const dropped =
      isTechnology &&
      (bound.seen.has(key) ||
        // A Japanese term the record files as a technology (要件定義) is a skill
        // of the section's own kind, and is not held to a list of technologies.
        (bound.allowed !== null && !hasJapaneseScript(item) && !bound.allowed.has(key)) ||
        (bound.cap !== null && bound.seen.size >= bound.cap));
    if (dropped) {
      closing = trailing;
      continue;
    }
    if (isTechnology) bound.seen.add(key);
    out += (out === "" ? "" : (parts[i - 1] ?? "")) + raw;
    closing = "";
  }
  const body = out.trim() === "" ? "" : out + closing;
  return body === "" ? "" : label + body;
}

const keysOf = (names: Iterable<string>) => new Set([...names].map(skillKey).filter(Boolean));

/**
 * The 職務経歴書 as the model wrote it, with both lists bounded. A curated list
 * is the author's: its skills are each named once, and no other is named, but
 * it is never cut. A shortlist bounds the section to itself and to
 * `AUTO_SKILL_CAP`. A paragraph or row left with nothing is dropped, and so is
 * the group label above an emptied skills paragraph.
 */
export function boundShokumuLists(
  content: RenderContent,
  spec: Pick<RenderSpec, "curatedSkills" | "skillShortlist" | "certifications">,
  facts: readonly { technologies: string[] }[],
): RenderContent {
  const listed = spec.curatedSkills?.flatMap((g) => g.skills) ?? spec.skillShortlist ?? null;
  const known = keysOf([
    ...facts.flatMap((f) => f.technologies),
    ...spec.certifications.flatMap((c) => c.technologies),
    ...(listed ?? []),
  ]);
  const skills: ListBound = {
    known,
    allowed: listed === null ? null : keysOf(listed),
    seen: new Set(),
    cap: spec.curatedSkills === null ? AUTO_SKILL_CAP : null,
  };

  return {
    sections: content.sections.map((section) => {
      if (section.key === SKILLS_SECTION) {
        const blocks: Block[] = [];
        for (const block of section.blocks) {
          if (block.kind !== "paragraph") {
            blocks.push(block);
            continue;
          }
          const text = boundTechnologyList(block.text, skills);
          if (text !== "") {
            blocks.push({ ...block, text });
            continue;
          }
          if (blocks.at(-1)?.kind === "row") blocks.pop();
        }
        return { ...section, blocks };
      }
      return {
        ...section,
        blocks: section.blocks.flatMap((block) => {
          if (block.kind !== "row" || !block.text.startsWith(TECH_STACK_LABEL)) return [block];
          const text = boundTechnologyList(block.text, { known, allowed: null, seen: new Set(), cap: TECH_STACK_CAP });
          return text === "" || text === TECH_STACK_LABEL ? [] : [{ ...block, text }];
        }),
      };
    }),
  };
}
