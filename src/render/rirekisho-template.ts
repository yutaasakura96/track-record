/**
 * The 履歴書 template, and the one function that fills it.
 *
 * `docs/03-technical-design.md` §30: documents are built; forms are filled.
 * The English résumé is assembled paragraph by paragraph in `./docx.ts`; the
 * 履歴書 is a rigid grid whose errors are invisible to the author and obvious
 * to a Japanese reader (§12), so it is a committed template with every value
 * stripped out — `templates/rirekisho.blank.docx`, built by
 * `scripts/build-rirekisho-template.mjs` from the author's own file.
 *
 * This module knows the template's placeholders and nothing else. Deriving the
 * 学歴・職歴 rows from the record — the two rows per education entry, the verb
 * that ends every 免許・資格 row, the 退社 reason leading its row — is the
 * render's job, and `docs/04-database-schema.md` §4 is its contract.
 */
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import blankTemplate from "../../templates/rirekisho.blank.docx";

/** One row of a 年 / 月 / 内容 table. Every value is pre-composed text. */
export interface RirekishoRow {
  year: string;
  month: string;
  text: string;
}

/**
 * Every placeholder the template carries, and no field it does not.
 *
 * `address` may hold a newline — the author's file puts a building name and
 * room number on a second line, and `linebreaks: true` below is what turns it
 * into one. `contactLine` is 同上 when the contact address repeats the current
 * one. The 写真 cell has no placeholder: it is an anchored image and
 * docxtemplater cannot place one without an image module, so the cell ships
 * and renders empty (`docs/04` §4).
 */
export interface RirekishoTemplateData {
  submitYear: string;
  submitMonth: string;
  submitDay: string;
  nameKana: string;
  nameKanji: string;
  birthYear: string;
  birthMonth: string;
  birthDay: string;
  age: string;
  gender: string;
  phone: string;
  email: string;
  addressKana: string;
  postalCode: string;
  address: string;
  contactPostalCode: string;
  contactLine: string;
  gakureki: RirekishoRow[];
  shokureki: RirekishoRow[];
  shikaku: RirekishoRow[];
  motivation: string;
  kibou: string;
}

/** The stripped grid, as loaded by the runtime. Never mutated. */
export const RIREKISHO_TEMPLATE_BYTES: ArrayBuffer = blankTemplate;

/**
 * Fill the template. Returns the `.docx` bytes; nothing is written anywhere.
 *
 * `linebreaks: true` is required by the address field. `compression: "DEFLATE"`
 * is required because PizZip stores by default, which yields a file around
 * three times the necessary size that opens perfectly well and so never
 * complains (`docs/06`, 2026-09-08).
 */
export function fillRirekishoTemplate(data: RirekishoTemplateData): Uint8Array {
  const doc = new Docxtemplater(new PizZip(RIREKISHO_TEMPLATE_BYTES), {
    paragraphLoop: true,
    linebreaks: true,
  });
  doc.render(data);
  return doc.getZip().generate({ type: "uint8array", compression: "DEFLATE" });
}
