/**
 * A TrueType font with every glyph a PDF does not draw emptied (issue #117).
 *
 * The Japanese faces are 2–3 MB each (`scripts/build-japanese-fonts.py`), and
 * embedded whole they would make a two-page 職務経歴書 a 5 MB PDF, past what
 * many application forms accept. `pdf-lib`'s own subsetting cannot be used:
 * its subsets drew most characters as nothing in Preview, Quick Look and
 * Ghostscript alike, as they did with Carlito (`./resume-pdf.ts`). It
 * renumbers the glyphs, and a renumbering slip is invisible until a reader
 * draws the page.
 *
 * So nothing is renumbered. Every glyph keeps its id, and the outline of each
 * one the document does not use is removed: its `loca` entry is left empty,
 * which TrueType defines as a glyph with no contours. `cmap`, `hmtx` and the
 * metrics are untouched, so `pdf-lib` lays the text out and measures it
 * exactly as it would the whole font, and a page draws the same glyphs. Only
 * the outlines the page needs travel in the file.
 *
 * The faces carry no GSUB (the build script drops it), so the glyph a
 * character is drawn with is its `cmap` entry and nothing else, and the set to
 * keep is known from the text alone. A composite glyph keeps its components.
 */
import fontkit from "@pdf-lib/fontkit";

/** Tables no PDF reader needs: the original's signature, and device-metric caches that describe glyphs no longer there. */
const DROPPED = new Set(["DSIG", "hdmx", "LTSH", "VDMX"]);

interface Table {
  tag: string;
  data: Uint8Array;
}

/**
 * The font with only the outlines of `text`'s characters, and `.notdef`'s.
 * The ids of the characters' glyphs are the font's own.
 */
export function subsetFont(bytes: ArrayBuffer | Uint8Array, text: Iterable<string>): Uint8Array {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const font = fontkit.create(source);
  const keep = new Set<number>([0]);
  for (const char of new Set(text)) {
    const id = font.glyphForCodePoint(char.codePointAt(0)!).id;
    keep.add(id);
  }

  const tables = readTables(source);
  const byTag = new Map(tables.map((t) => [t.tag, t]));
  const head = byTag.get("head");
  const maxp = byTag.get("maxp");
  const loca = byTag.get("loca");
  const glyf = byTag.get("glyf");
  if (!head || !maxp || !loca || !glyf) throw new Error("not a TrueType-outline font");

  const headView = view(head.data);
  const longOffsets = headView.getInt16(50) === 1;
  const glyphCount = view(maxp.data).getUint16(4);
  const locaView = view(loca.data);
  const offsetOf = (id: number) => (longOffsets ? locaView.getUint32(id * 4) : locaView.getUint16(id * 2) * 2);
  const glyphOf = (id: number) => glyf.data.subarray(offsetOf(id), offsetOf(id + 1));

  // A composite glyph is drawn from others, which it names by id.
  const pending = [...keep];
  while (pending.length > 0) {
    const id = pending.pop()!;
    if (id >= glyphCount) continue;
    for (const component of componentsOf(glyphOf(id))) {
      if (!keep.has(component)) {
        keep.add(component);
        pending.push(component);
      }
    }
  }

  // Long offsets, and each kept outline padded to four bytes.
  const kept: Uint8Array[] = [];
  const newLoca = new DataView(new ArrayBuffer((glyphCount + 1) * 4));
  let at = 0;
  for (let id = 0; id < glyphCount; id++) {
    newLoca.setUint32(id * 4, at);
    if (!keep.has(id)) continue;
    const outline = glyphOf(id);
    const padded = new Uint8Array((outline.length + 3) & ~3);
    padded.set(outline);
    kept.push(padded);
    at += padded.length;
  }
  newLoca.setUint32(glyphCount * 4, at);
  const newGlyf = new Uint8Array(at);
  let cursor = 0;
  for (const outline of kept) {
    newGlyf.set(outline, cursor);
    cursor += outline.length;
  }

  const newHead = head.data.slice();
  view(newHead).setInt16(50, 1);
  // Zeroed before the whole-font checksum is taken, as the specification requires.
  view(newHead).setUint32(8, 0);

  const out: Table[] = tables
    .filter((t) => !DROPPED.has(t.tag))
    .map((t) => {
      switch (t.tag) {
        case "head":
          return { tag: t.tag, data: newHead };
        case "loca":
          return { tag: t.tag, data: new Uint8Array(newLoca.buffer) };
        case "glyf":
          return { tag: t.tag, data: newGlyf };
        case "post":
          return { tag: t.tag, data: postWithoutNames(t.data) };
        default:
          return t;
      }
    });
  return writeFont(source, out);
}

/* ------------------------------------------------------------------ reading */

const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);

function readTables(font: Uint8Array): Table[] {
  const v = view(font);
  const count = v.getUint16(4);
  const tables: Table[] = [];
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16;
    const tag = String.fromCharCode(...font.subarray(record, record + 4));
    const offset = v.getUint32(record + 8);
    const length = v.getUint32(record + 12);
    tables.push({ tag, data: font.subarray(offset, offset + length) });
  }
  return tables;
}

/** The glyph ids a composite glyph is built from (OpenType `glyf`, composite descriptions). */
function componentsOf(glyph: Uint8Array): number[] {
  if (glyph.length < 10) return [];
  const v = view(glyph);
  if (v.getInt16(0) >= 0) return [];
  const ids: number[] = [];
  let at = 10;
  for (;;) {
    const flags = v.getUint16(at);
    ids.push(v.getUint16(at + 2));
    at += 4;
    at += flags & 0x0001 ? 4 : 2; // ARG_1_AND_2_ARE_WORDS
    if (flags & 0x0008) at += 2; // WE_HAVE_A_SCALE
    else if (flags & 0x0040) at += 4; // WE_HAVE_AN_X_AND_Y_SCALE
    else if (flags & 0x0080) at += 8; // WE_HAVE_A_TWO_BY_TWO
    if (!(flags & 0x0020)) return ids; // MORE_COMPONENTS
  }
}

/** `post` version 3: the same metrics, and no glyph names, which only a font editor reads. */
function postWithoutNames(post: Uint8Array): Uint8Array {
  const header = post.slice(0, 32);
  view(header).setUint32(0, 0x00030000);
  return header;
}

/* ------------------------------------------------------------------ writing */

function checksum(data: Uint8Array): number {
  const padded = new Uint8Array((data.length + 3) & ~3);
  padded.set(data);
  const v = view(padded);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
  return sum;
}

function writeFont(original: Uint8Array, tables: Table[]): Uint8Array {
  tables.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const count = tables.length;
  const directory = 12 + count * 16;
  const total = tables.reduce((sum, t) => sum + ((t.data.length + 3) & ~3), directory);
  const out = new Uint8Array(total);
  const v = view(out);

  // The sfnt version, then the search fields for this table count.
  out.set(original.subarray(0, 4));
  const power = 2 ** Math.floor(Math.log2(count));
  v.setUint16(4, count);
  v.setUint16(6, power * 16);
  v.setUint16(8, Math.log2(power));
  v.setUint16(10, count * 16 - power * 16);

  let offset = directory;
  let headOffset = -1;
  tables.forEach((table, i) => {
    const record = 12 + i * 16;
    for (let c = 0; c < 4; c++) out[record + c] = table.tag.charCodeAt(c);
    v.setUint32(record + 4, checksum(table.data));
    v.setUint32(record + 8, offset);
    v.setUint32(record + 12, table.data.length);
    out.set(table.data, offset);
    if (table.tag === "head") headOffset = offset;
    offset += (table.data.length + 3) & ~3;
  });
  // head.checkSumAdjustment: 0xB1B0AFBA less the checksum of the whole font.
  v.setUint32(headOffset + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}
