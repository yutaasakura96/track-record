/**
 * A document's page as its file carries it.
 *
 * Two readers show it. A sent copy (`docs/10` Screen 15) shows the page stored
 * with the file that day; a version (Screen 17) shows the page its download
 * would hold today. The page is the server's in both, so this only sets it.
 */
import type { SentPage } from "~/render/sent-page";

/** The document at the reading measure. A 履歴書 or 職務経歴書 is set with the Japanese stack. */
export function DocumentPage({ page, language }: { page: SentPage; language: "en" | "ja" }) {
  const japanese = language === "ja";
  return (
    <article
      lang={japanese ? "ja" : "en"}
      className={`mx-auto w-measure max-w-full px-20 py-40 max-phone:px-0 max-phone:py-20 ${japanese ? "tracking-ja" : ""}`}
    >
      <h2 className="text-doc-title text-center font-semibold tracking-tight text-text-bright">{page.title}</h2>
      {page.form ? (
        <FormPage form={page.form} stamp={page.stamp} />
      ) : (
        <>
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

function FormPage({ form, stamp }: { form: NonNullable<SentPage["form"]>; stamp: string | null }) {
  return (
    <div className="mt-8 grid gap-20 text-render-body text-text-body">
      {stamp ? <p className="text-right text-small text-text-muted">{stamp}</p> : null}
      <dl className="grid grid-cols-2 max-phone:grid-cols-1 border-t border-l border-border">
        {form.cells.map((cell) => (
          <div key={cell.label} className="min-w-0 border-r border-b border-border p-8">
            <dt className="text-smaller text-text-dim">{cell.label}</dt>
            <dd className="whitespace-pre-line break-words">{cell.value}</dd>
          </div>
        ))}
      </dl>
      {form.tables.map((table) => (
        <div key={table.heading} className="min-w-0 max-w-full overflow-x-auto border border-border">
          <table className="w-full min-w-measure border-collapse text-left">
            <caption className="p-8 text-left text-render-heading font-semibold text-text-dim">{table.heading}</caption>
            <thead>
              <tr><th scope="col" className="border border-border p-8">年</th><th scope="col" className="border border-border p-8">月</th><th scope="col" className="border border-border p-8">{table.heading}</th></tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={index}>
                  <td className="border border-border p-8 whitespace-nowrap">{row.year}</td>
                  <td className="border border-border p-8 whitespace-nowrap">{row.month}</td>
                  <td className="border border-border p-8 whitespace-pre-line break-words">{row.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {form.prose.map((cell) => (
        <section key={cell.heading} className="border border-border">
          <h3 className="border-b border-border p-8 text-render-heading font-semibold text-text-dim">{cell.heading}</h3>
          <p className="p-8 whitespace-pre-line">{cell.text}</p>
        </section>
      ))}
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
