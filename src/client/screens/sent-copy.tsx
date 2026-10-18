/**
 * Applications, a sent copy (`docs/10-screen-specifications.md` Screen 15,
 * issue #71).
 *
 * Read-only, and that is the whole screen: the document as it was sent, with
 * the name and contact lines it carried that day. There is no edit, no history
 * and no regenerate here, and the download is the stored file, never a fresh
 * one. What is shown was taken when the file was, so nothing on this page is
 * read from the record or the profile as they are now.
 */
import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { ApiError, downloadSentCopy, failureText, useSentCopy, type SentCopyPage } from "../api";
import { ApplicationsFrame } from "../components/application-chrome";
import { DocumentBlocks } from "../components/document-blocks";
import { ReadFailure } from "../components/read-failure";
import { Button, Chip } from "../components/ui";

export function SentCopyScreen() {
  const { applicationId, copyId } = useParams({ from: "/applications/$applicationId/sent/$copyId" });
  const copy = useSentCopy(applicationId, copyId);
  const data = copy.data;

  if (!data) {
    const missing = copy.error instanceof ApiError && copy.error.status === 404;
    return (
      <ApplicationsFrame title={missing ? "Not found" : "Sent copy"} crumb>
        {copy.isError && !missing ? (
          <ReadFailure query={copy} />
        ) : (
          <p className="text-ui text-text-dim">{missing ? "That sent copy was not found." : "Opening the sent copy…"}</p>
        )}
      </ApplicationsFrame>
    );
  }

  return (
    <ApplicationsFrame title={`${data.company} / ${data.title} as sent`} crumb>
      <Notice copy={data} />
      <Document copy={data} />
    </ApplicationsFrame>
  );
}

function Notice({ copy }: { copy: SentCopyPage }) {
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setFailure(null);
    setBusy(true);
    try {
      await downloadSentCopy(copy.applicationId, copy.id);
    } catch (error) {
      setFailure(failureText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-x-12 gap-y-8 border border-border-control bg-surface-raised rounded-control px-10 py-8 text-small text-text-secondary">
        <Chip>v{copy.versionNo} · frozen</Chip>
        <span className="min-w-0 flex-1 max-phone:basis-full">
          Sent to {copy.company} on <span className="font-mono">{copy.sentOn}</span>. This is the file as it was that
          day. It cannot be edited, and later changes to the résumé or to your record do not reach it.
        </span>
        <span className="ml-auto max-phone:ml-0 flex items-center gap-8">
          <Button variant="ghost" onClick={() => void download()} disabled={busy} disabledReason="Preparing…">
            {busy ? "Preparing…" : "Download"}
          </Button>
          <Link
            to="/applications/$applicationId"
            params={{ applicationId: copy.applicationId }}
            className="text-text-dim px-6 py-4 rounded-chip text-smaller hover:bg-border hover:text-text-secondary motion-surface whitespace-nowrap"
          >
            Back to the application
          </Link>
        </span>
      </div>
      {failure ? (
        <p role="alert" className="text-small text-removed">
          {failure}
        </p>
      ) : null}
    </div>
  );
}

/** The document at the reading measure. A 履歴書 or 職務経歴書 is set with the Japanese stack. */
function Document({ copy }: { copy: SentCopyPage }) {
  const { page } = copy;
  const japanese = copy.language === "ja";
  return (
    <article
      lang={japanese ? "ja" : "en"}
      className={`mx-auto w-measure max-w-full px-20 py-40 max-phone:px-0 max-phone:py-20 ${japanese ? "tracking-ja" : ""}`}
    >
      {page.stamp ? <p className="text-small text-text-muted">{page.stamp}</p> : null}
      <h2 className="text-doc-title font-semibold tracking-tight text-text-bright">{page.name}</h2>
      {page.contact.map((line) => (
        <p key={line} className="text-ui text-text-secondary whitespace-pre-line">
          {line}
        </p>
      ))}
      {page.sections.map((section, index) => (
        <section key={index}>
          <h3 className="mt-20 mb-8 text-render-heading font-semibold uppercase tracking-heading text-text-dim">
            {section.heading}
          </h3>
          <DocumentBlocks blocks={section.blocks} />
        </section>
      ))}
    </article>
  );
}
