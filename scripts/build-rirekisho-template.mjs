/**
 * Builds `templates/rirekisho.blank.docx` from the author's own 履歴書.
 *
 *   node scripts/build-rirekisho-template.mjs <work-dir> <output.docx>
 *
 * The template must take its grid from the real document rather than a generic
 * form — `docs/03` §12 names a rigid grid whose errors are invisible to the
 * author and obvious to a Japanese reader as a live M2 risk, and `docs/04` §4
 * is the field contract extracted from the same file.
 *
 * It reads `local/JAPANESE/履歴書.docx`, which is gitignored, so this only runs
 * on the author's machine. It is committed for the same reason `npm run
 * measure` is: the stripping is then auditable, and the two gates below are
 * the guard rather than a promise in a commit message.
 *
 *   PII GATE     — every remaining text node must be form furniture or a
 *                  placeholder. Any residual value aborts the build.
 *   SCHEMA GATE  — `<w:tblPr>` children must follow the CT_TblPrBase sequence.
 *                  An out-of-order child surfaces only as "Word found
 *                  unreadable content", which is precisely the invisible
 *                  failure this template exists to avoid.
 *
 * The photo, `word/media/`, its relationship, the jpeg content type and the
 * document properties are all removed. Filling the 写真 cell needs an image
 * module and is a render decision that has not been taken.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'local/JAPANESE/履歴書.docx');
const WORK = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'rirekisho-'));
const OUT = process.argv[3] ?? path.join(ROOT, 'templates/rirekisho.blank.docx');

if (!fs.existsSync(SRC)) {
  throw new Error(`${SRC} is missing. local/ is gitignored: this runs only on the author's machine.`);
}

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
execSync(`cd ${WORK} && unzip -o -q "${SRC}"`);
let xml = fs.readFileSync(`${WORK}/word/document.xml`, 'utf8');

// --- generic span helpers: find every match, rebuild by slicing ------------
const spans = (s, re) => {
  const out = []; let m; const r = new RegExp(re.source, 'g');
  while ((m = r.exec(s))) out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  return out;
};
const rebuild = (s, items, edit, drop = new Set()) => {
  let out = '', cursor = 0;
  items.forEach((it, i) => {
    out += s.slice(cursor, it.start); cursor = it.end;
    if (drop.has(i)) return;
    out += edit.has(i) ? edit.get(i)(it.text) : it.text;
  });
  return out + s.slice(cursor);
};

// Rewrite a cell's paragraphs to exactly `texts`, keeping each one's own pPr/rPr.
function setCell(cellXml, texts) {
  let i = 0;
  return rebuild(cellXml, spans(cellXml, /<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/), new Map(
    spans(cellXml, /<w:p(?: [^>]*)?>[\s\S]*?<\/w:p>/).map((_, idx) => [idx, (para) => {
      const open = para.match(/<w:p(?: [^>]*)?>/)[0];
      const body = para.slice(open.length, -'</w:p>'.length);
      if (idx >= texts.length) return '';                       // drop surplus paragraph
      const pPr = (body.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0];
      const rPr = (body.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
      const t = texts[idx];
      const esc = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const run = t === '' ? '' : `<w:r>${rPr}<w:t xml:space="preserve">${esc}</w:t></w:r>`;
      return `${open}${pPr}${run}</w:p>`;
    }])
  ));
}
const setRow = (rowXml, map) => rebuild(rowXml, spans(rowXml, /<w:tc>[\s\S]*?<\/w:tc>/), new Map(
  Object.entries(map).map(([i, texts]) => [Number(i), (c) => setCell(c, texts)])
));
const editRows = (tableXml, edits, drop = new Set()) =>
  rebuild(tableXml, spans(tableXml, /<w:tr(?: [^>]*)?>[\s\S]*?<\/w:tr>/), edits, drop);

// --- per-table edits -------------------------------------------------------
const T = [
  // T1 identity
  (t) => editRows(t, new Map([
    [0, (r) => setRow(r, { 0: ['ふりがな', '名前'], 1: ['{nameKana}', '{nameKanji}'], 2: [''] })],
    [1, (r) => setRow(r, { 0: ['{birthYear}年 {birthMonth}月 {birthDay}日生（満 {age} 歳） {gender}'] })],
    [2, (r) => setRow(r, { 0: ['電話 {phone}', 'Email {email}'] })],
    [3, (r) => setRow(r, { 0: ['ふりがな', '現住所'], 1: ['{addressKana}', '〒{postalCode}', '{address}'] })],
    [4, (r) => setRow(r, { 0: ['ふりがな', '連絡先'], 1: ['〒{contactPostalCode}', '{contactLine}'] })],
  ])),
  // T2 学歴・職歴 — keep the two header rows, one loop row each, and 以上
  (t) => editRows(t, new Map([
    [0, (r) => setRow(r, { 0: ['年'], 1: ['月'], 2: ['学歴・職歴'] })],
    [1, (r) => setRow(r, { 0: ['学歴'] })],
    [2, (r) => setRow(r, { 0: ['{#gakureki}{year}'], 1: ['{month}'], 2: ['{text}{/gakureki}'] })],
    [8, (r) => setRow(r, { 0: ['職歴'] })],
    [9, (r) => setRow(r, { 0: ['{#shokureki}{year}'], 1: ['{month}'], 2: ['{text}{/shokureki}'] })],
    [17, (r) => setRow(r, { 0: ['以上'] })],
  ]), new Set([3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16])),
  // T3 免許・資格
  (t) => editRows(t, new Map([
    [0, (r) => setRow(r, { 0: ['年'], 1: ['月'], 2: ['免許・資格'] })],
    [1, (r) => setRow(r, { 0: ['{#shikaku}{year}'], 1: ['{month}'], 2: ['{text}{/shikaku}'] })],
  ]), new Set([...Array(16).keys()].map((i) => i + 2))),
  // T4 prose
  (t) => editRows(t, new Map([
    [0, (r) => setRow(r, { 0: ['志望動機・特技・アピールポイントなど'] })],
    [1, (r) => setRow(r, { 0: ['{motivation}'] })],
  ])),
  // T5 prose
  (t) => editRows(t, new Map([
    [0, (r) => setRow(r, { 0: ['本人希望欄'] })],
    [1, (r) => setRow(r, { 0: ['{kibou}'] })],
  ])),
];

const tableSpans = spans(xml, /<w:tbl>[\s\S]*?<\/w:tbl>/);
if (tableSpans.length !== 5) throw new Error(`expected 5 tables, found ${tableSpans.length}`);
xml = rebuild(xml, tableSpans, new Map(T.map((fn, i) => [i, fn])));

// title block: everything before the first table
{
  const head = xml.slice(0, xml.indexOf('<w:tbl>'));
  xml = setCell(head, ['履 歴 書', '{submitYear}年 {submitMonth}月 {submitDay}日 ']) + xml.slice(head.length);
}

// strip the photo; lock column widths so a long value cannot move 年/月
xml = xml.replace(/<w:drawing>[\s\S]*?<\/w:drawing>/g, '');
// CT_TblPrBase fixes the child order: tblLayout follows tblBorders/shd and
// precedes tblCellMar. Anchoring on tblW instead makes Word call the file
// corrupt — verified against what the `docx` library emits.
xml = xml.replace(/<w:tblCellMar>/g, '<w:tblLayout w:type="fixed"/><w:tblCellMar>');
fs.writeFileSync(`${WORK}/word/document.xml`, xml);

// --- drop media, its relationship, the jpeg content type, and doc props ----
fs.rmSync(`${WORK}/word/media`, { recursive: true, force: true });
const edit = (p, fn) => fs.writeFileSync(`${WORK}/${p}`, fn(fs.readFileSync(`${WORK}/${p}`, 'utf8')));
edit('word/_rels/document.xml.rels', (s) => s.replace(/<Relationship[^>]*media\/[^>]*\/>/g, ''));
edit('[Content_Types].xml', (s) => s.replace(/<Default[^>]*Extension="jpe?g"[^>]*\/>/gi, ''));
edit('word/settings.xml', (s) => s.replace(/<w:rsids>[\s\S]*?<\/w:rsids>/g, ''));
edit('docProps/app.xml', (s) => s.replace(/<Company>[\s\S]*?<\/Company>/g, '<Company/>')
  .replace(/<Manager>[\s\S]*?<\/Manager>/g, '<Manager/>')
  .replace(/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/g, ''));
fs.writeFileSync(`${WORK}/docProps/core.xml`,
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties ` +
  `xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
  `xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>履歴書</dc:title>` +
  `<dc:creator/><cp:lastModifiedBy/><cp:revision>1</cp:revision></cp:coreProperties>`);

// --- HARD GATE: the template may contain nothing but furniture + placeholders
const norm = (s) => s.replace(/[ 　]/g, '');
const ALLOWED = new Set(['履 歴 書', 'ふりがな', '名前', '現住所', '連絡先', '年', '月',
  '学歴・職歴', '学歴', '職歴', '以上', '免許・資格',
  '志望動機・特技・アピールポイントなど', '本人希望欄'].map(norm));
const leaks = [...xml.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)]
  .map((m) => m[1])
  .filter((t) => t.trim() !== '')
  .map((t) => t.replace(/\{[^}]*\}/g, '').replace(/[年月日生満歳（）〒 　]/g, '').replace(/^(電話|Email)$/, ''))
  .filter((t) => norm(t).trim() !== '' && !ALLOWED.has(norm(t).trim()));
if (leaks.length) throw new Error('PII GATE FAILED, residual text: ' + JSON.stringify(leaks));

// SCHEMA GATE: an out-of-order tblPr child is the kind of defect that shows up
// only as "Word found unreadable content", so assert the sequence here.
const ORDER = ['tblStyle', 'tblpPr', 'tblOverlap', 'bidiVisual', 'tblStyleRowBandSize',
  'tblStyleColBandSize', 'tblW', 'jc', 'tblCellSpacing', 'tblInd', 'tblBorders', 'shd',
  'tblLayout', 'tblCellMar', 'tblLook', 'tblCaption', 'tblDescription'];
for (const pr of xml.match(/<w:tblPr>[\s\S]*?<\/w:tblPr>/g) ?? []) {
  const kids = [...pr.matchAll(/<w:(\w+)[ \/>]/g)].map((m) => m[1])
    .filter((n) => ORDER.includes(n));
  const seq = kids.map((k) => ORDER.indexOf(k));
  if (!seq.every((v, i) => i === 0 || v >= seq[i - 1])) {
    throw new Error('SCHEMA GATE FAILED, tblPr out of order: ' + kids.join(' > '));
  }
}

fs.rmSync(OUT, { force: true });
execSync(`cd ${WORK} && zip -r -X -9 -q "${OUT}" . -x '.*'`);
console.log('gate passed; wrote', OUT, fs.statSync(OUT).size, 'bytes');
