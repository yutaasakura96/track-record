/**
 * Screen 10 — Master document (`docs/10-screen-specifications.md`, issue #57).
 *
 * Everything in the record, in one long readable piece: every accepted fact
 * from every imported document, Private and Generated ones included, under the
 * employer and project it belongs to. Every résumé is written from this.
 *
 * Read-only, and built from the record each time it is opened: there is no
 * second copy to edit and none to fall out of step. A fact is changed where
 * facts are changed, on its card.
 *
 * **One per language** (issue #59): the tabs choose English or 日本語. The
 * record is named as a document of that language names it, and a claim reads
 * as it was written. Nothing is translated, because no model writes this.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { downloadMasterDocument, failureText, useMasterDocument, useProfile } from "../api";
import { ReadFailure, RefreshFailure } from "../components/read-failure";
import { ScreenIntro } from "../components/screen-intro";
import { Sidebar } from "../components/sidebar";
import { Button, Mono, Panel } from "../components/ui";
import { LanguagePanel, LanguageTabs } from "../components/language-tabs";
import { useDocumentLanguageStore } from "../stores/document-language";
import {
  DISCLOSURE_LABEL,
  MASTER_WORDS,
  PROVENANCE_LABEL,
  monthOf,
  period,
  type MasterDocument,
  type MasterFact,
  type MasterLanguage,
  type MasterProject,
} from "~/shared/master-document";

/** What ties the tabs to the document under them. */
const TABS = "master-document";

export function MasterDocumentScreen() {
  const profile = useProfile();
  const language = useDocumentLanguageStore((state) => state.language);
  const master = useMasterDocument(language);
  const doc = master.data;
  const hasContent = doc && (
    doc.counts.facts > 0 || doc.employers.length > 0 || doc.independent.projects.length > 0 ||
    doc.independent.facts.length > 0 || doc.educations.length > 0 || doc.certifications.length > 0
  );

  return (
    <div className="min-h-screen flex">
      <Sidebar name={profile.data?.nameLatin ?? ""} />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-header shrink-0 flex items-center gap-12 px-20 bg-surface border-b border-border">
          <h1 className="text-panel font-semibold tracking-snug text-text-strong">Master document</h1>
          <span className="text-smaller text-text-dimmer">Everything in your record, in one place</span>
          <span className="ml-auto">{hasContent ? <Download language={language} /> : null}</span>
        </header>

        <div className="flex-1 overflow-y-auto px-20 py-26 grid gap-20 content-start">
          <div>
            <LanguageTabs name={TABS} label="Master document language" />
          </div>
          <ScreenIntro
            next={
              !doc
                ? undefined
                : !hasContent
                  ? "import a document. Its facts appear here."
                  : "nothing is waiting here. Read it, or download a copy to keep."
            }
            legend="Private facts and Generated facts are listed here and marked. No résumé uses them."
          >
            Every fact you have accepted, from every document you imported, including the ones a
            résumé leaves out. {WRITTEN_FROM[language]} It is built from your record each time you
            open it, so it cannot be edited here: change a fact on its own card. The tabs change
            the names and headings to the ones a document of that language uses; each fact reads
            as it was written, and none is translated.
          </ScreenIntro>

          <LanguagePanel name={TABS} className="grid gap-20 content-start">
            {doc && master.isError ? <RefreshFailure query={master} /> : null}
            {!doc && master.isError ? (
              <ReadFailure query={master} />
            ) : !doc ? (
              <p className="text-smaller text-text-dim">Building the master document…</p>
            ) : (
              <Body doc={doc} />
            )}
          </LanguagePanel>
        </div>
      </div>
    </div>
  );
}

/** What is written from each one, by name: the documents on that tab of Home. */
const WRITTEN_FROM: Record<MasterLanguage, string> = {
  en: "Your résumé and your career story are written from this.",
  ja: "Your 履歴書, 職務経歴書 and 職務経歴ストーリー are written from this.",
};

/**
 * The file holds Private facts, by the owner's decision (`docs/06`,
 * 2026-10-08), and the button says so before it is pressed rather than after.
 */
function Download({ language }: { language: MasterLanguage }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-10">
      {failure ? (
        <span role="alert" className="text-smaller text-removed">
          {failure}
        </span>
      ) : (
        <span className="text-smaller text-text-dimmer">The file includes Private facts. It is your copy.</span>
      )}
      <Button
        disabled={busy}
        disabledReason={busy ? "Preparing the file…" : undefined}
        onClick={async () => {
          setFailure(null);
          setBusy(true);
          try {
            await downloadMasterDocument(language);
          } catch (error) {
            setFailure(failureText(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Preparing…" : "Download .md"}
      </Button>
    </span>
  );
}

function Body({ doc }: { doc: MasterDocument }) {
  const { counts, language } = doc;
  const words = MASTER_WORDS[language];
  const comma = language === "ja" ? "、" : ", ";
  const outside = doc.independent.projects.length > 0 || doc.independent.facts.length > 0;

  return (
    <>
      <p className="text-small text-text-secondary">
        {counts.facts} {counts.facts === 1 ? "fact" : "facts"}: {counts.usable} a document may use, {counts.private} Private,{" "}
        {counts.generated} Generated.
        {counts.flagged > 0 ? (
          <>
            {" "}
            <Link to="/flagged" className="text-text-dim hover:text-text-secondary underline">
              {counts.flagged} flagged to check
            </Link>
            .
          </>
        ) : null}
        {counts.waiting > 0
          ? ` ${counts.waiting} more ${counts.waiting === 1 ? "is" : "are"} waiting to be sorted and ${counts.waiting === 1 ? "is" : "are"} not listed yet. Sort them from Home.`
          : ""}
      </p>

      {doc.employers.map((employer) => (
        <Panel
          key={employer.id}
          heading={employer.alternateName ? `${employer.name} (${employer.alternateName})` : employer.name}
        >
          <p className="text-smaller text-text-dim">
            {[period(employer.startedOn, employer.endedOn, language), employer.industry].filter(Boolean).join(" · ")}
          </p>
          {employer.roles.length > 0 ? (
            <ul className="mt-8 grid gap-2">
              {employer.roles.map((role, index) => (
                <li key={index} className="text-small text-text-secondary">
                  {role.title} <span className="text-text-dim">({period(role.startedOn, role.endedOn, language)})</span>
                </li>
              ))}
            </ul>
          ) : null}
          {employer.projects.map((project) => (
            <ProjectSection key={project.id} project={project} language={language} />
          ))}
          {employer.facts.length > 0 ? (
            <section className="mt-14">
              {employer.projects.length > 0 ? <SubHeading>{words.otherWork}</SubHeading> : null}
              <Facts facts={employer.facts} />
            </section>
          ) : null}
          {employer.projects.length === 0 && employer.facts.length === 0 ? (
            <p className="mt-8 text-smaller text-text-dim">{words.noFacts}</p>
          ) : null}
        </Panel>
      ))}

      {outside ? (
        <Panel heading={words.outside}>
          {doc.independent.projects.map((project) => (
            <ProjectSection key={project.id} project={project} language={language} />
          ))}
          {doc.independent.facts.length > 0 ? (
            <section className="mt-14">
              <SubHeading>{words.unfiled}</SubHeading>
              <Facts facts={doc.independent.facts} />
            </section>
          ) : null}
        </Panel>
      ) : null}

      {doc.educations.length > 0 ? (
        <Panel heading={words.education}>
          <ul className="grid gap-4">
            {doc.educations.map((education) => (
              <li key={education.id} className="text-small text-text-secondary">
                {[education.institution, education.detail].filter(Boolean).join(comma)}{" "}
                <span className="text-text-dim">
                  (
                  {[period(education.startedOn, education.endedOn, language, "?"), words.outcome[education.outcome]]
                    .filter(Boolean)
                    .join(comma)}
                  )
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {doc.certifications.length > 0 ? (
        <Panel heading={words.certifications}>
          <ul className="grid gap-4">
            {doc.certifications.map((certification) => (
              <li key={certification.id} className="text-small text-text-secondary">
                {certification.name}
                {comma}
                {certification.issuingOrganization}
                {certification.issuedOn ? (
                  <span className="text-text-dim"> ({words.issued(monthOf(certification.issuedOn, language)!)})</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}

function ProjectSection({ project, language }: { project: MasterProject; language: MasterLanguage }) {
  return (
    <section aria-label={project.name} className="mt-14">
      <SubHeading>{project.name}</SubHeading>
      {project.summary ? <p className="mb-8 text-small text-text-dim">{project.summary}</p> : null}
      {project.facts.length === 0 ? (
        <p className="text-smaller text-text-dim">{MASTER_WORDS[language].noFacts}</p>
      ) : (
        <Facts facts={project.facts} />
      )}
    </section>
  );
}

const SubHeading = ({ children }: { children: string }) => (
  <h3 className="mb-6 text-row font-medium text-text-strong">{children}</h3>
);

function Facts({ facts }: { facts: MasterFact[] }) {
  return (
    <ul className="grid gap-8">
      {facts.map((fact) => {
        // The two that keep a fact out of every document are the ones the
        // surface and the claim's own tone carry, as on the fact card.
        const held = fact.disclosure === "private" || fact.provenance === "generated";
        return (
          <li key={fact.id} className="grid gap-2">
            <p className={`text-claim ${held ? "text-text-dim" : "text-text-strong"}`}>{fact.claim}</p>
            <p className="flex flex-wrap items-center gap-8">
              <Mono
                className={
                  fact.provenance === "generated"
                    ? "text-generated-text"
                    : fact.provenance === "measured"
                      ? "text-measured-text"
                      : "text-text-faint"
                }
              >
                {PROVENANCE_LABEL[fact.provenance]}
              </Mono>
              <Mono className={fact.disclosure === "private" ? "text-private" : "text-text-faint"}>
                {DISCLOSURE_LABEL[fact.disclosure]}
              </Mono>
              {fact.flags.length > 0 ? <Mono className="text-text-dim">Flagged</Mono> : null}
              {fact.source ? (
                <Link
                  to="/imports/$importId"
                  params={{ importId: fact.source.importId }}
                  search={{ fact: fact.id }}
                  className="text-smaller text-text-dimmer hover:text-text-secondary"
                >
                  {fact.source.filename}
                  {fact.source.lineNumber === null ? "" : ` L${fact.source.lineNumber}`}
                </Link>
              ) : null}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
