/**
 * One document on Home, as a card (`docs/10` Screen 3, issue #111): a picture
 * of its first page, where it stands in plain words, and View first.
 *
 * The rows these replaced offered History, Download and Regenerate, and
 * nothing that opened the document. A card leads with what it looks like and
 * with the way in.
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMasterDocument, useProfilePhotoSrc, useRenderPage, type RenderRow } from "../api";
import { relative } from "../format";
import { DocumentPage } from "./document-page";
import { Action, QUIET, SECONDARY } from "./document-row";
import { DownloadButton } from "./download-button";
import { Dot } from "./ui";
import { MASTER_WORDS, type MasterLanguage } from "~/shared/master-document";

const number = (n: number) => n.toLocaleString("en-US");
const facts = (n: number) => `${number(n)} ${n === 1 ? "fact" : "facts"}`;

/** The card's frame: the picture on top, then the words and the controls. */
function Card({ title, thumbnail, children }: { title: string; thumbnail: ReactNode; children: ReactNode }) {
  return (
    <li className="min-w-0 flex flex-col bg-card border border-border rounded-tile overflow-hidden">
      {thumbnail}
      <div className="flex-1 flex flex-col gap-6 px-14 py-12">
        {/* Japanese titles render in the mixed stack — the body default. */}
        <h3 className="text-row font-medium text-text-strong">{title}</h3>
        {children}
      </div>
    </li>
  );
}

/**
 * The first page, drawn small. A picture and nothing more: hidden from a
 * screen reader, which has the title and status beside it, and inert, so no
 * part of it takes a tab stop.
 */
function Thumbnail({ children }: { children?: ReactNode }) {
  return (
    <div aria-hidden inert className="h-thumbnail overflow-hidden bg-surface-raised border-b border-border px-14 pt-14">
      <div className="h-full overflow-hidden bg-bg border border-b-0 border-border rounded-t-control">
        {children ? <div className="page-thumbnail">{children}</div> : null}
      </div>
    </div>
  );
}

/** A generated document: its current version's page, as View opens it. */
function RenderThumbnail({ row }: { row: RenderRow }) {
  // Read only once there is a version; a page refused for a withheld fact, or
  // one that fails to read, leaves the blank page, which says nothing wrong.
  const read = useRenderPage(row.ref, undefined, Boolean(row.currentVersionId));
  const photo = useProfilePhotoSrc();
  return (
    <Thumbnail>{read.data ? <DocumentPage page={read.data.page} language={read.data.language} photo={photo} /> : null}</Thumbnail>
  );
}

/** Where a generated document stands, in words a first-time author can read. */
export function documentStatus(row: RenderRow): { tone: "measured" | "accent" | "muted"; text: string } {
  if (!row.buildable) return { tone: "muted", text: "Not available yet" };
  if (row.status === "proposal_pending") return { tone: "accent", text: "A new version is waiting for you to check" };
  if (row.status === "proposal_generating") return { tone: "accent", text: "A new version is being written" };
  if (row.status === "never_generated") return { tone: "muted", text: "Not written yet" };
  if (row.status === "stale") {
    const added = row.newFactsSince ?? 0;
    const gone = row.withdrawnFactsSince ?? 0;
    const since = row.currentVersionNo ? ` since v${row.currentVersionNo}` : "";
    const arrived = `${number(added)} new ${added === 1 ? "fact" : "facts"}${since}`;
    if (gone === 0) return { tone: "accent", text: arrived };
    if (added === 0) return { tone: "accent", text: `${facts(gone)} it was written from can no longer be used` };
    return { tone: "accent", text: `${arrived}, and ${number(gone)} it was written from can no longer be used` };
  }
  return { tone: "measured", text: "Up to date with your record" };
}

const TONE_TEXT = { measured: "text-measured-text", accent: "text-accent-text", muted: "text-text-muted" } as const;

function Status({ tone, children }: { tone: keyof typeof TONE_TEXT; children: ReactNode }) {
  return (
    <p className={`flex items-baseline gap-6 text-small ${TONE_TEXT[tone]}`}>
      <span className="shrink-0 self-center inline-flex">
        <Dot tone={tone} />
      </span>
      <span>{children}</span>
    </p>
  );
}

export function DocumentCard({
  row,
  note,
  canGenerate,
  busy,
  onGenerate,
}: {
  row: RenderRow;
  /** What the document is for, said under its status. */
  note?: string;
  canGenerate: boolean;
  busy: boolean;
  onGenerate: () => void;
}) {
  const status = documentStatus(row);
  const version = row.currentVersionId !== null;
  return (
    <Card title={row.title} thumbnail={<RenderThumbnail row={row} />}>
      <Status tone={status.tone}>{status.text}</Status>
      <p className="text-small text-text-muted">
        {[
          version && row.currentVersionNo ? `v${row.currentVersionNo}` : null,
          row.generatedAt ? `written ${relative(row.generatedAt)}` : null,
          note ?? null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className="mt-auto pt-6 flex flex-wrap items-center gap-x-12 gap-y-8">
        {version ? (
          <>
            {/* The way in, and the card's one button (issue #111). */}
            <Link
              to="/renders/$ref/view"
              params={{ ref: row.ref }}
              aria-label={`View ${row.title}`}
              className={SECONDARY}
            >
              View
            </Link>
            <DownloadButton kind={row.kind} docRef={row.ref} label="Download" className={QUIET} />
            <Link to="/renders/$ref/history" params={{ ref: row.ref }} className={QUIET}>
              History
            </Link>
          </>
        ) : null}
        <span className={version ? "ml-auto" : ""}>
          <Action row={row} canGenerate={canGenerate} busy={busy} onGenerate={onGenerate} quiet={version} />
        </span>
      </div>
    </Card>
  );
}

/** How many claims a chapter shows on the career record's picture. */
const SHOWN = 2;

/**
 * The career record of the tab: not generated and with no versions, so it has
 * no status dot, no History and no Generate. It is opened, and the screen it
 * opens is where it is downloaded, beside the note that the file holds Private
 * facts.
 */
export function MasterDocumentCard({ language, count }: { language: MasterLanguage; count: number }) {
  const words = MASTER_WORDS[language];
  const master = useMasterDocument(language);
  const doc = master.data;
  return (
    <Card
      title={words.title}
      thumbnail={
        <Thumbnail>
          {doc ? (
            <article lang={language} className={`px-40 py-40 ${language === "ja" ? "tracking-ja" : ""}`}>
              {doc.subjectName ? <p className="text-doc-title font-semibold text-text-bright">{doc.subjectName}</p> : null}
              {doc.employers.slice(0, 3).map((employer) => (
                <section key={employer.id} className="mt-20">
                  <p className="text-render-heading font-semibold uppercase tracking-heading text-text-dim">{employer.name}</p>
                  {[...employer.projects.flatMap((project) => project.facts), ...employer.facts]
                    .slice(0, SHOWN)
                    .map((fact) => (
                      <p key={fact.id} className="mt-8 text-doc-body text-text-body">
                        • {fact.claim}
                      </p>
                    ))}
                </section>
              ))}
            </article>
          ) : null}
        </Thumbnail>
      }
    >
      <p className="text-small text-text-muted">
        {count === 0 ? "No facts yet" : facts(count)} · everything in your record, and what every{" "}
        {language === "ja" ? "Japanese" : "English"} document is written from. Not for sending.
      </p>
      <div className="mt-auto pt-6">
        <Link
          to="/master"
          aria-label={`Open the ${language === "ja" ? "Japanese" : "English"} career record`}
          className={SECONDARY}
        >
          Open
        </Link>
      </div>
    </Card>
  );
}
