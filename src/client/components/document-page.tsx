/**
 * A document's page as its file carries it.
 *
 * Two readers show it. A sent copy (`docs/10` Screen 15) shows the page stored
 * with the file that day; a version (Screen 17) shows the page its download
 * would hold today. The page is the server's in both, so this only sets it.
 */
import type { SentPage } from "~/render/sent-page";
import type { Sheet, SheetAlign, SheetCell, SheetLine, SheetSize } from "~/render/sheet";

/** The document at the reading measure. A 履歴書 or 職務経歴書 is set with the Japanese stack. */
export function DocumentPage({ page, language }: { page: SentPage; language: "en" | "ja" }) {
  const japanese = language === "ja";
  return (
    <article
      lang={japanese ? "ja" : "en"}
      className={`mx-auto w-measure max-w-full px-20 py-40 max-phone:px-0 max-phone:py-20 ${japanese ? "tracking-ja" : ""}`}
    >
      {page.readFailure === "original_file_unreadable" ? (
        <p role="alert" className="mb-12 text-small text-removed">The original file could not be read — showing its text only.</p>
      ) : null}
      {page.sheet ? (
        <SheetPage sheet={page.sheet} />
      ) : (
        <>
          <h2 className="text-doc-title text-center font-semibold tracking-tight text-text-bright">{page.title}</h2>
          <div className="mt-8 text-center">
            {page.stamp ? <p className="text-right text-small text-text-muted">{page.stamp}</p> : null}
            <p className="text-render-heading font-semibold text-text-bright">{page.name}</p>
            {page.contact.length > 0 ? (
              <p className="text-ui text-text-secondary whitespace-pre-line">{page.contact.join(" · ")}</p>
            ) : null}
          </div>
          {page.sections.map((section, index) => (
            <section key={index}>
              <h3 className="mt-20 mb-8 text-render-heading font-semibold uppercase tracking-heading text-text-dim">
                {section.heading}
              </h3>
              <Blocks blocks={section.blocks} />
            </section>
          ))}
        </>
      )}
    </article>
  );
}

const ALIGN: Record<SheetAlign, string> = { start: "text-left", center: "text-center", end: "text-right" };
const SIZE: Record<SheetSize, string> = {
  title: "text-doc-title",
  large: "text-doc-heading",
  body: "text-render-body",
  small: "text-smaller",
};
/** The template's paragraph spacing, in twips, on the spacing scale: 20 twips is a point. */
const BEFORE: Record<number, string> = { 0: "mt-0", 40: "mt-4", 100: "mt-8", 400: "mt-26" };
const AFTER: Record<number, string> = { 0: "mb-0", 20: "mb-2", 40: "mb-4", 80: "mb-6", 100: "mb-8", 200: "mb-14" };

/**
 * A 履歴書 as its file lays it out: the file's lines and tables, cell for cell,
 * with its spans, its merged 写真 cell, its shading and its fixed column widths.
 * At phone width the widths give way to the content, so a year is not broken. Nothing here knows
 * which field is which, so the screen cannot set out a form the file does not.
 * The empty lines that space the file's tables are the gap between them.
 */
function SheetPage({ sheet }: { sheet: Sheet }) {
  return (
    <div className="text-text-body">
      {sheet.blocks.map((block, index) => {
        if (block.kind === "table") return <SheetTable key={index} table={block} />;
        if (block.line.text.trim() === "") return <p key={index} aria-hidden="true" className={lineClass(block.line)}>&nbsp;</p>;
        return block.line.size === "title" ? (
          <h2 key={index} aria-label={spoken(block.line.text)} className={`${lineClass(block.line)} text-text-bright`}>
            {block.line.text}
          </h2>
        ) : (
          <p key={index} className={lineClass(block.line)}>
            {block.line.text}
          </p>
        );
      })}
    </div>
  );
}

/** The file spaces its title out, 履 歴 書; the heading is named as the word is written, 履歴書. */
const spoken = (text: string) => text.replace(/(?<=[^\x00-\x7f])\s+(?=[^\x00-\x7f])/g, "");

const lineClass = (line: SheetLine) =>
  `${ALIGN[line.align]} ${SIZE[line.size]} ${line.bold ? "font-semibold" : ""} ${BEFORE[line.beforeTwips] ?? "mt-0"} ${AFTER[line.afterTwips] ?? "mb-0"} whitespace-pre-wrap break-words`;

/** A first row the file sets in bold throughout, as it does 年 / 月 / 学歴・職歴, heads its columns. */
const headed = (row: SheetCell[]) =>
  row.length > 1 && row.every((cell) => cell.lines.some((line) => line.text.trim() !== "") && cell.lines.every((line) => line.bold || line.text.trim() === ""));

function SheetTable({ table }: { table: Extract<Sheet["blocks"][number], { kind: "table" }> }) {
  return (
    <div className="min-w-0 max-w-full overflow-x-auto">
      <table className="w-full table-fixed max-phone:table-auto border-collapse">
        <colgroup>
          {table.columns.map((width, index) => (
            <col key={index} style={{ width: `${(width * 100).toFixed(2)}%` }} />
          ))}
        </colgroup>
        <tbody>
          {table.rows.map((row, rowIndex) => {
            const Cell = rowIndex === 0 && headed(row) ? "th" : "td";
            return (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <Cell
                    key={cellIndex}
                    scope={Cell === "th" ? "col" : undefined}
                    colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                    rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                    className={`border border-border-active px-8 py-6 align-top font-normal ${cell.shaded ? "bg-chip" : ""}`}
                  >
                    {cell.lines.map((line, lineIndex) => (
                      <p key={lineIndex} className={lineClass(line)}>
                        {line.text || "\u00a0"}
                      </p>
                    ))}
                  </Cell>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Bullets as a list, everything else as lines: a table row of a 履歴書 is a line of its own. */
function Blocks({ blocks }: { blocks: SentPage["sections"][number]["blocks"] }) {
  const body = "text-render-body text-text-body";
  if (blocks.every((block) => block.kind === "bullet")) {
    return (
      <ul className={`grid gap-6 pl-20 list-disc ${body}`}>
        {blocks.map((block, index) => (
          <li key={index}>{block.text}</li>
        ))}
      </ul>
    );
  }
  return (
    <div className={`grid gap-6 ${body}`}>
      {blocks.map((block, index) =>
        block.kind === "bullet" ? (
          <ul key={index} className="pl-20 list-disc">
            <li>{block.text}</li>
          </ul>
        ) : (
          <p key={index} className="whitespace-pre-line">
            {block.text}
          </p>
        ),
      )}
    </div>
  );
}
