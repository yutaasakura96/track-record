/**
 * The 写真 cell, filled (issue #117, review issue 8).
 *
 * The template's 写真 cell is the identity table's merged right-hand cell,
 * shaded, holding one empty paragraph. The photo goes into that paragraph as
 * an **inline** picture, 30 × 40 mm and centred: inline rather than floating,
 * so the cell grows to hold it and the layout model can count it
 * (`./rirekisho-layout.ts`), where a floating one would sit over the rows
 * below it in whatever way the reader's Word placed it.
 *
 * The cell is 2000 twips wide, which with its 100-twip margins leaves 31.75 mm,
 * so the conventional 30 mm fits. It is 40 mm tall where the three rows it
 * spans are about 34 mm, so with a photo the identity block is about 8 mm
 * taller and page 1 holds a row fewer of 学歴・職歴.
 *
 * Like the layout passes, this is string edits over the template's XML, and
 * it runs after the fill and before the pagination, so the page break is
 * worked out with the photo in place.
 */
import type PizZip from "pizzip";
import type { PhotoType } from "~/shared/photo";

/** A stored photo, already checked by {@link photoInfo} to be 3:4. */
export interface RirekishoPhoto {
  bytes: Uint8Array;
  type: PhotoType;
}

/** 1 mm in EMU, the unit DrawingML sizes in. */
const EMU_PER_MM = 36_000;
export const PHOTO_WIDTH_EMU = 30 * EMU_PER_MM;
export const PHOTO_HEIGHT_EMU = 40 * EMU_PER_MM;

const RELATIONSHIP_ID = "rIdRirekishoPhoto";
const EXTENSION: Record<PhotoType, string> = { "image/jpeg": "jpeg", "image/png": "png" };
const IMAGE_RELATIONSHIP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

const FIRST_TABLE = /<w:tbl>[\s\S]*?<\/w:tbl>/;
const CELL = /<w:tc>[\s\S]*?<\/w:tc>/g;
const PARAGRAPH = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/;

/**
 * Put the photo in the 写真 cell of a filled document: the picture into
 * `document.xml`, the file into `word/media`, and the relationship and content
 * type that name it. Returns the new `document.xml`; the other parts are
 * written into `zip`.
 */
export function placePhoto(zip: PizZip, xml: string, photo: RirekishoPhoto): string {
  const extension = EXTENSION[photo.type];
  const target = `media/photo.${extension}`;
  zip.file(`word/${target}`, photo.bytes);

  const relsPath = "word/_rels/document.xml.rels";
  const rels = zip.file(relsPath)!.asText();
  if (!rels.includes(`Id="${RELATIONSHIP_ID}"`)) {
    zip.file(
      relsPath,
      rels.replace("</Relationships>", `<Relationship Id="${RELATIONSHIP_ID}" Type="${IMAGE_RELATIONSHIP}" Target="${target}"/></Relationships>`),
    );
  }

  const typesPath = "[Content_Types].xml";
  const types = zip.file(typesPath)!.asText();
  if (!new RegExp(`<Default Extension="${extension}"`, "i").test(types)) {
    zip.file(typesPath, types.replace("<Default ", `<Default Extension="${extension}" ContentType="${photo.type}"/><Default `));
  }

  const table = FIRST_TABLE.exec(xml);
  if (!table) throw new Error("the 履歴書 has no identity table");
  const cell = [...table[0].matchAll(CELL)].find(([c]) => /<w:vMerge w:val="restart"\/>/.test(c));
  if (!cell) throw new Error("the 履歴書 has no 写真 cell");
  const paragraph = PARAGRAPH.exec(cell[0]);
  if (!paragraph) throw new Error("the 写真 cell has no paragraph");

  const filledCell = cell[0].replace(paragraph[0], pictureParagraph());
  const filledTable = table[0].replace(cell[0], filledCell);
  return xml.replace(table[0], filledTable);
}

/**
 * The picture, centred, with no space above or below it. The line is left
 * `auto` — the one paragraph in the document that is not an exact height —
 * because an exact line clips an inline picture to it.
 */
function pictureParagraph(): string {
  const size = `cx="${PHOTO_WIDTH_EMU}" cy="${PHOTO_HEIGHT_EMU}"`;
  return (
    `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>` +
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent ${size}/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="1" name="写真" descr="写真"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="0" name="写真"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${RELATIONSHIP_ID}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext ${size}/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  );
}

/** The photo a filled 履歴書 carries, read back out of its file, or null when its 写真 cell is empty. */
export function photoOf(zip: PizZip): RirekishoPhoto | null {
  for (const [type, extension] of Object.entries(EXTENSION) as [PhotoType, string][]) {
    const file = zip.file(`word/media/photo.${extension}`);
    if (file) return { bytes: file.asUint8Array(), type };
  }
  return null;
}
