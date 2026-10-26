/**
 * A document's page as its file carries it.
 *
 * Two readers show it. A sent copy (`docs/10` Screen 15) shows the page stored
 * with the file that day; a version (Screen 17) shows the page its download
 * would hold today. The page is the server's in both, so this only sets it.
 */
import { useId, type ReactNode } from "react";
import type { SentPage } from "~/render/sent-page";
import type { Sheet, SheetAlign, SheetCell, SheetLine, SheetSize } from "~/render/sheet";

type PageBlock = SentPage["sections"][number]["blocks"][number];

/**
 * "Show where each line comes from" (issue #110): every block a button, and
 * what stands behind the chosen one shown directly under it, so the next tab
 * stop after a line is its evidence and a phone needs no second pane.
 */
export interface Trace {
  /** The chosen block, as `<section>.<block>`, or null. */
  selected: string | null;
  onSelect: (key: string | null) => void;
  /** What is shown under the chosen block. */
  behind: (block: PageBlock) => ReactNode;
}

/**
 * The document at the reading measure. A 履歴書 or 職務経歴書 is set with the Japanese stack.
 *
 * `photo` is where the 履歴書's 写真 is read from, when its file carries one:
 * the profile's for a page built today, the stored file's for a sent copy. The
 * page says only that the cell holds a photo, never the photo itself.
 */
export function DocumentPage({ page, language, trace, photo = null }: { page: SentPage; language: "en" | "ja"; trace?: Trace; photo?: string | null }) {
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
        <SheetPage sheet={page.sheet} trace={trace} photo={photo} />
      ) : (
        <>
          {page.title ? (
            <>
              <h2 className="text-doc-title text-center font-semibold tracking-tight text-text-bright">{page.title}</h2>
              <div className="mt-8 text-center">
                {page.stamp ? <p className="text-right text-small text-text-muted">{page.stamp}</p> : null}
                <p className="text-render-heading font-semibold text-text-bright">{page.name}</p>
                {page.contact.length > 0 ? (
                  <p className="text-ui text-text-secondary whitespace-pre-line">{page.contact.join(" · ")}</p>
                ) : null}
              </div>
            </>
          ) : (
            // A file with no title leads with the name, as the English résumé
            // does: the name large, its headline in the accent, then the contact line.
            <header>
              <h2 className="text-doc-title font-semibold tracking-tight text-text-bright">{page.name}</h2>
              {page.headline ? <p className="text-doc-body text-accent-text">{page.headline}</p> : null}
              {page.contact.length > 0 ? (
                <p className="text-ui text-text-muted whitespace-pre-line">{page.contact.join(" · ")}</p>
              ) : null}
            </header>
          )}
          {page.sections.map((section, index) => (
            <DocumentSection key={index} section={section}>
              {trace ? <TracedBlocks blocks={section.blocks} section={index} trace={trace} /> : undefined}
            </DocumentSection>
          ))}
        </>
      )}
    </article>
  );
}

/**
 * One section of a page: its heading, then its blocks. Exported for the Skills
 * screen's preview (issue #114), so the section it shows is set as the
 * document's page sets it. `children` stands in for the blocks.
 */
export function DocumentSection({
  section,
  flush = false,
  children,
}: {
  section: SentPage["sections"][number];
  /** Shown alone rather than under a name: no space above the heading. */
  flush?: boolean;
  children?: ReactNode;
}) {
  return (
    <section>
      <h3 className={`${flush ? "mt-0" : "mt-20"} mb-8 text-render-heading font-semibold uppercase tracking-heading text-text-dim`}>
        {section.heading}
      </h3>
      {children ?? <Blocks blocks={section.blocks} />}
    </section>
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
function SheetPage({ sheet, trace, photo }: { sheet: Sheet; trace?: Trace; photo: string | null }) {
  return (
    <div className="text-text-body">
      {sheet.blocks.map((block, index) => {
        if (block.kind === "table") return <SheetTable key={index} table={block} index={index} trace={trace} photo={photo} />;
        if (block.line.text.trim() === "") return <p key={index} aria-hidden="true" className={lineClass(block.line)}>&nbsp;</p>;
        if (trace) {
          const key = `sheet.${index}`;
          const open = trace.selected === key;
          return <SheetLineTrace key={index} line={block.line} open={open} onSelect={() => trace.onSelect(open ? null : key)} behind={() => trace.behind({ kind: "row", text: block.line.text, factIds: [] })} />;
        }
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

function SheetLineTrace({ line, open, onSelect, behind }: { line: SheetLine; open: boolean; onSelect: () => void; behind: () => ReactNode }) {
  const id = useId();
  const content = <button type="button" aria-expanded={open} aria-controls={open ? id : undefined} onClick={onSelect}
    className={`block w-full rounded-control border motion-tone ${lineClass(line)} ${line.size === "title" ? "text-text-bright" : ""} ${open ? "bg-mark-selected border-border-active" : "border-transparent hover:bg-hover"}`}>
    {line.text}
  </button>;
  return <div>
    {line.size === "title" ? <h2 aria-label={spoken(line.text)}>{content}</h2> : content}
    {open ? <div id={id} className="mt-6 mb-8">{behind()}</div> : null}
  </div>;
}

/** The file spaces its title out, 履 歴 書; the heading is named as the word is written, 履歴書. */
const spoken = (text: string) => text.replace(/(?<=[^\x00-\x7f])\s+(?=[^\x00-\x7f])/g, "");

const lineClass = (line: SheetLine) =>
  `${ALIGN[line.align]} ${SIZE[line.size]} ${line.bold ? "font-semibold" : ""} ${BEFORE[line.beforeTwips] ?? "mt-0"} ${AFTER[line.afterTwips] ?? "mb-0"} whitespace-pre-wrap break-words`;

/** A first row the file sets in bold throughout, as it does 年 / 月 / 学歴・職歴, heads its columns. */
const headed = (row: SheetCell[]) =>
  row.length > 1 && row.every((cell) => cell.lines.some((line) => line.text.trim() !== "") && cell.lines.every((line) => line.bold || line.text.trim() === ""));

function SheetTable({ table, index, trace, photo }: { table: Extract<Sheet["blocks"][number], { kind: "table" }>; index: number; trace?: Trace; photo: string | null }) {
  const id = useId();
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
                {row.map((cell, cellIndex) => {
                  const key = `sheet.${index}.${rowIndex}.${cellIndex}`;
                  const open = trace?.selected === key;
                  const panel = `${id}-${rowIndex}-${cellIndex}`;
                  return <Cell
                    key={cellIndex}
                    scope={Cell === "th" ? "col" : undefined}
                    colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                    rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                    className={`border border-border-active px-8 py-6 align-top font-normal ${cell.shaded ? "bg-shade" : ""}`}
                  >
                    {cell.photo ? (
                      // The file's 30 × 40 mm, at the cell's width. Not a line to trace: nothing is written in it.
                      photo ? <img src={photo} alt="写真" className="block w-full aspect-photo object-cover" /> : <span className="sr-only">写真</span>
                    ) : trace ? (
                      <>
                        <button type="button" aria-expanded={open} aria-controls={open ? panel : undefined}
                          onClick={() => trace.onSelect(open ? null : key)}
                          className={`block w-full text-left rounded-control border motion-tone ${open ? "bg-mark-selected border-border-active" : "border-transparent hover:bg-hover"}`}>
                          {cell.lines.map((line, lineIndex) => (
                            <span key={lineIndex} className={`block ${lineClass(line)}`}>{line.text || "\u00a0"}</span>
                          ))}
                        </button>
                        {open ? <div id={panel} className="mt-6 mb-8 min-w-0 break-words">{trace.behind({ kind: "paragraph", text: cell.lines.map((line) => line.text).join("\n"), factIds: cell.factIds ?? [] })}</div> : null}
                      </>
                    ) : cell.lines.map((line, lineIndex) => (
                      <p key={lineIndex} className={lineClass(line)}>{line.text || "\u00a0"}</p>
                    ))}
                  </Cell>
                })}
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

/**
 * The blocks of one section, each a button that opens what stands behind it.
 * A bullet stays a list item, so the page still reads as the document does.
 */
function TracedBlocks({ blocks, section, trace }: { blocks: PageBlock[]; section: number; trace: Trace }) {
  const id = useId();
  const lines = blocks.map((block, index) => {
    const key = `${section}.${index}`;
    const open = trace.selected === key;
    const panel = `${id}-${index}`;
    return {
      key,
      bullet: block.kind === "bullet",
      body: (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? panel : undefined}
            onClick={() => trace.onSelect(open ? null : key)}
            className={`block w-full text-left rounded-control border px-6 py-2 motion-tone ${block.kind === "bullet" ? "" : "whitespace-pre-line"} ${
              open ? "bg-mark-selected border-border-active" : "border-transparent hover:bg-hover"
            }`}
          >
            {block.text}
          </button>
          {open ? (
            <div id={panel} className="mt-6 mb-8">
              {trace.behind(block)}
            </div>
          ) : null}
        </>
      ),
    };
  });

  const body = "text-render-body text-text-body";
  if (lines.every((line) => line.bullet)) {
    return (
      <ul className={`grid gap-4 pl-20 list-disc ${body}`}>
        {lines.map((line) => (
          <li key={line.key}>{line.body}</li>
        ))}
      </ul>
    );
  }
  return (
    <div className={`grid gap-4 ${body}`}>
      {lines.map((line) =>
        line.bullet ? (
          <ul key={line.key} className="pl-20 list-disc">
            <li>{line.body}</li>
          </ul>
        ) : (
          <div key={line.key}>{line.body}</div>
        ),
      )}
    </div>
  );
}
