/**
 * How a rendered document's experience section is measured (`docs/06`,
 * 2026-09-08). The definition, not the instrument — `scripts/measure-render.mjs`
 * is the thing you run.
 *
 * Every register decision recorded since 2026-09-04 rests on three numbers:
 * how many experience bullets a render carries, how long they are on average,
 * and what share of them carry a number. Until now those numbers came from a
 * script rebuilt from prose in the decision log at the start of every session,
 * and the only thing making the rebuild safe was that the log recorded enough
 * prior readings to check it against. That is a safety net that frays as the
 * log grows. The definition is executable and tested here instead.
 *
 * WHAT IS DELIBERATELY NOT HERE: any of the attribution invariants the log also
 * reports — unknown fact ids, unfiled facts used in an employer section, facts
 * placed under a heading naming a different employer. Those are questions about
 * the record as well as the render, and they are still checked by hand.
 *
 * The input type is structural rather than an import of `RenderContent`, so
 * that this module has no imports at all and Node can load it directly. The
 * test asserts a real `RenderContent` satisfies it, which is what keeps the two
 * from drifting apart.
 */

export interface MeasuredBlock {
  kind: string;
  text: string;
  factIds: string[];
}

export interface MeasuredSection {
  key: string;
  blocks: MeasuredBlock[];
}

export interface MeasuredContent {
  sections: MeasuredSection[];
}

export interface BulletMeasurement {
  /** The headline triple, in the order the log writes it: count / mean / share. */
  bullets: number;
  meanCharacters: number;
  quantifiedPercent: number;
  /** The tail, which is where a length instruction is obeyed or is not. */
  longestCharacters: number;
  overLongBullets: number;
  /** Composition. `factsPerBullet` is what ADR-0001's welding argument moves. */
  factReferences: number;
  factsPerBullet: number;
  multiFactBullets: number;
}

/** The section key the register defines for employer work. */
export const EXPERIENCE_SECTION = "experience";

/**
 * The threshold the log counts bullets against. 250 rather than the stated
 * ceiling of 240, because it was chosen to count clear overshoots and the
 * readings either side of a register change have to stay comparable.
 */
export const LONG_BULLET_CHARACTERS = 250;

/**
 * "Carries a number" is a digit anywhere in the bullet. Crude on purpose: it
 * counts `two thirds` as unquantified, and it has counted it that way in every
 * reading the log records. A cleverer rule would be a better measure and would
 * make every recorded figure incomparable with the next one.
 */
const CARRIES_A_NUMBER = /\d/;

/** The `bullet` blocks of the experience section, in document order. */
export function experienceBullets(content: MeasuredContent): MeasuredBlock[] {
  const section = content.sections.find((s) => s.key === EXPERIENCE_SECTION);
  if (!section) return [];
  return section.blocks.filter((b) => b.kind === "bullet");
}

const EMPTY: BulletMeasurement = {
  bullets: 0,
  meanCharacters: 0,
  quantifiedPercent: 0,
  longestCharacters: 0,
  overLongBullets: 0,
  factReferences: 0,
  factsPerBullet: 0,
  multiFactBullets: 0,
};

export function measureBullets(bullets: readonly MeasuredBlock[]): BulletMeasurement {
  if (bullets.length === 0) return EMPTY;

  const lengths = bullets.map((b) => b.text.length);
  const factReferences = bullets.reduce((total, b) => total + b.factIds.length, 0);

  return {
    bullets: bullets.length,
    // Rounded, because every figure the log records is an integer and a
    // comparison against one has to be made on the same footing.
    meanCharacters: Math.round(lengths.reduce((a, b) => a + b, 0) / bullets.length),
    quantifiedPercent: Math.round(
      (100 * bullets.filter((b) => CARRIES_A_NUMBER.test(b.text)).length) / bullets.length,
    ),
    longestCharacters: Math.max(...lengths),
    overLongBullets: lengths.filter((n) => n > LONG_BULLET_CHARACTERS).length,
    factReferences,
    factsPerBullet: Math.round((100 * factReferences) / bullets.length) / 100,
    multiFactBullets: bullets.filter((b) => b.factIds.length > 1).length,
  };
}

/**
 * A hand-written document has no sections and no fact ids — it is read as
 * bullet LINES. This is how the target the whole comparison runs against
 * (30 bullets, 191 characters, 57% carrying a number) was measured.
 *
 * A bullet is a line opening with a list marker. Continuation lines are not
 * joined onto the bullet above: every reading in the log was taken this way.
 *
 * An ASCII marker must be followed by a space, or `*emphasis*` opening a line
 * would count as a bullet. `•` and `・` need not be: a Japanese document writes
 * ・項目 with nothing between, and a 職務経歴書 will be measured here too.
 */
const BULLET_LINE = /^\s*(?:[-*+]\s+|\d+[.)]\s+|[•・]\s*)(.*)$/;

export function bulletsFromLines(text: string): MeasuredBlock[] {
  return text
    .split(/\r?\n/)
    .map((line) => BULLET_LINE.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ kind: "bullet", text: (match[1] ?? "").trim(), factIds: [] }))
    .filter((block) => block.text.length > 0);
}
