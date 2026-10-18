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
      <div className={`${page.stamp ? "text-right" : "text-center"} mt-8`}>
        {page.stamp ? <p className="text-small text-text-muted">{page.stamp}</p> : null}
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
    </article>
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
