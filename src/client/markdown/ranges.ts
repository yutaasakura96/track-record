/**
 * Projecting a quote's source offsets onto rendered text (`docs/10` Screen 1,
 * "Marks in the rendered view").
 *
 * A parsed text node says which source range it came from, but its characters
 * are not always that range's characters. An escape loses its backslash, an
 * entity becomes one character, and a continuation line inside a list item or a
 * quotation loses its indent or its `>`. `alignOffsets` walks the node's text
 * and the source together and answers, for each displayed character, which
 * source offset it came from.
 *
 * The alignment decides only where a mark's edge falls. What is displayed is
 * always the parser's text, so a misalignment can move an edge and can never
 * drop or invent a character.
 */

/** One fact's quote, as offsets into the stored text, and how its mark is drawn. */
export interface MarkRange {
  id: string;
  start: number;
  end: number;
  className: string;
}

const ENTITY = /^&(?:#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/i;

/**
 * How far to look ahead in the source for a displayed character before giving
 * up on it. Markup between two displayed characters is short (an indent, a
 * `> `, a backslash). A character that is not found this near is one the parser
 * rewrote, and searching further would drag every later character with it.
 */
const LOOKAHEAD = 16;

/** For each character of `value`, the source offset it was read from. */
export function alignOffsets(value: string, source: string, start: number, end: number): number[] {
  const map = new Array<number>(value.length);
  let at = start;
  let i = 0;

  while (i < value.length) {
    let found = -1;
    let width = 1;
    let consumed = 1;
    const limit = Math.min(end, at + LOOKAHEAD);
    for (let look = at; look < limit; look += 1) {
      const entity = source[look] === "&" ? ENTITY.exec(source.slice(look, look + 40)) : null;
      // `&amp;` displays as `&`: one character for the whole entity. An entity
      // the parser left alone is still in the text, letter for letter.
      if (entity && !value.startsWith(entity[0], i)) {
        found = look;
        consumed = entity[0].length;
        width = (value.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
        break;
      }
      if (source[look] === value[i]) {
        found = look;
        break;
      }
    }
    if (found === -1) {
      map[i] = Math.min(at, end);
      i += 1;
      continue;
    }
    for (let k = 0; k < width && i + k < value.length; k += 1) map[i + k] = found;
    at = found + consumed;
    i += width;
  }
  return map;
}

export interface Piece {
  text: string;
  range: MarkRange | null;
}

/**
 * Splits a node's text into marked and unmarked runs.
 *
 * `ranges` are sorted and do not overlap (`resolveRanges`). The common case is
 * a node no quote touches, and it returns before aligning anything.
 */
export function pieces(
  value: string,
  source: string,
  start: number,
  end: number,
  ranges: MarkRange[],
): Piece[] {
  const hits = ranges.filter((range) => range.start < end && range.end > start);
  if (hits.length === 0 || value === "") return [{ text: value, range: null }];

  const map = alignOffsets(value, source, start, end);
  const rangeAt = (index: number) =>
    hits.find((range) => map[index]! >= range.start && map[index]! < range.end) ?? null;

  const out: Piece[] = [];
  let from = 0;
  let current = rangeAt(0);
  for (let i = 1; i <= value.length; i += 1) {
    const next = i < value.length ? rangeAt(i) : null;
    if (i < value.length && next === current) continue;
    out.push({ text: value.slice(from, i), range: current });
    from = i;
    current = next;
  }
  return out;
}

/**
 * Sorted by start, and where two quotes overlap the first one wins — the rule
 * the stored-text view has always drawn by, so both views mark the same facts.
 */
export function resolveRanges(ranges: MarkRange[]): MarkRange[] {
  const out: MarkRange[] = [];
  let cursor = 0;
  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    if (range.start < cursor) continue;
    out.push(range);
    cursor = range.end;
  }
  return out;
}

/** The text of `value` that came from inside `[from, to)` of the source. */
export function clip(
  value: string,
  source: string,
  start: number,
  end: number,
  from: number,
  to: number,
): string {
  if (from <= start && to >= end) return value;
  const map = alignOffsets(value, source, start, end);
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    if (map[i]! >= from && map[i]! < to) out += value[i];
  }
  return out;
}
