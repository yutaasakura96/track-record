/**
 * Screen 10 — Career record (`docs/10-screen-specifications.md`, issue #57).
 * Named the master document until issue #112, and still at `/master`.
 *
 * Everything in the record, read like a CV the author wrote for themselves
 * (issue #112): contents down the side, a chapter an employer, a section a
 * project, Results apart from What I did, and the figures set apart. Every
 * accepted fact is here, Private and Generated ones included; a mark appears
 * only where a fact is unusual, and the document a fact came from shows on
 * hover. The page used to print every fact's storage labels at one weight,
 * and read as "a bunch of random words".
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
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { downloadMasterDocument, failureText, useMasterDocument, useProfile } from "../api";
import { ReadFailure, RefreshFailure } from "../components/read-failure";
import { ScreenIntro } from "../components/screen-intro";
import { Sidebar } from "../components/sidebar";
import { Button, FilterPill, Mono } from "../components/ui";
import { LanguagePanel, LanguageTabs } from "../components/language-tabs";
import { useDocumentLanguageStore } from "../stores/document-language";
import {
  FACT_MARK,
  MASTER_WORDS,
  countSentences,
  factGroups,
  factMarks,
  figures,
  keptOut,
  monthOf,
  period,
  yearSpan,
  type MasterDocument,
  type MasterFact,
  type MasterLanguage,
  type MasterProject,
} from "~/shared/master-document";

/** What ties the tabs to the document under them. */
const TABS = "master-document";

/**
 * The filters (issue #112, evaluation §3.2). Everything is no filter at all,
 * and is not in the address.
 */
export const MASTER_FILTERS = ["results", "kept-out", "unused"] as const;
export type MasterFilter = (typeof MASTER_FILTERS)[number];

const FILTER: Record<MasterFilter, { label: string; matches: (fact: MasterFact) => boolean }> = {
  results: { label: "Results with a number", matches: (fact) => fact.provenance === "measured" },
  "kept-out": { label: "Kept out of documents", matches: keptOut },
  unused: { label: "Not used in any document yet", matches: (fact) => !keptOut(fact) && !fact.used },
};

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
          <h1 className="text-panel font-semibold tracking-snug text-text-strong">Career record</h1>
          <span className="text-smaller text-text-dimmer">Everything you have done, from every source</span>
          <span className="ml-auto">{hasContent ? <Download language={language} /> : null}</span>
        </header>

        {/* No scroll box of its own: the window scrolls, so the contents can stay in view. */}
        <div className="flex-1 px-20 py-26 grid gap-20 content-start">
          <div>
            <LanguageTabs name={TABS} label="Career record language" />
          </div>
          <ScreenIntro
            next={
              !doc
                ? undefined
                : !hasContent
                  ? "import a document. Its achievements appear here."
                  : "nothing is waiting here. Read it, or download a copy to keep."
            }
            legend="A line marked Private or Not confirmed is kept out of every document. Point at a line to see the document it came from, and open it to see its card."
          >
            Everything you have done, from every document you imported and everything you added by
            hand, including what a résumé leaves out. {WRITTEN_FROM[language]} It is built from your
            record each time you open it, so it cannot be edited here: change an achievement on its
            own card. The tabs change the names and headings to the ones a document of that language
            uses; each achievement reads as it was written, and none is translated.
          </ScreenIntro>

          <LanguagePanel name={TABS} className="grid gap-20 content-start">
            {doc && master.isError ? <RefreshFailure query={master} /> : null}
            {!doc && master.isError ? (
              <ReadFailure query={master} />
            ) : !doc ? (
              <p className="text-smaller text-text-dim">Building the career record…</p>
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

/** A chapter: an employer, or the work outside employment. */
interface Chapter {
  id: string;
  /** The contents' line: the name alone. */
  name: string;
  years: string | null;
  projects: MasterProject[];
  facts: MasterFact[];
}

function Body({ doc }: { doc: MasterDocument }) {
  const { language } = doc;
  const words = MASTER_WORDS[language];
  const { show } = useSearch({ from: "/master" });
  const navigate = useNavigate({ from: "/master" });
  const choose = (filter: MasterFilter | undefined) => navigate({ search: filter ? { show: filter } : {}, replace: true });
  const matches = show ? FILTER[show].matches : () => true;

  // Under a filter, a project or a chapter with nothing to show is left out;
  // under Everything, an empty one is listed and says so.
  const narrow = (projects: MasterProject[]) =>
    projects
      .map((project) => ({ ...project, facts: project.facts.filter(matches) }))
      .filter((project) => !show || project.facts.length > 0);
  const chapters: Chapter[] = [
    ...doc.employers.map((employer) => ({
      id: `chapter-${employer.id}`,
      name: employer.name,
      years: yearSpan(employer.startedOn, employer.endedOn, language),
      projects: narrow(employer.projects),
      facts: employer.facts.filter(matches),
    })),
    ...(doc.independent.projects.length > 0 || doc.independent.facts.length > 0
      ? [{
          id: "chapter-outside",
          name: words.outside,
          years: null,
          projects: narrow(doc.independent.projects),
          facts: doc.independent.facts.filter(matches),
        }]
      : []),
  ].filter((chapter) => !show || chapter.facts.length > 0 || chapter.projects.length > 0);
  const background = !show && (doc.educations.length > 0 || doc.certifications.length > 0);

  const all = [
    ...doc.employers.flatMap((employer) => [...employer.facts, ...employer.projects.flatMap((project) => project.facts)]),
    ...doc.independent.facts,
    ...doc.independent.projects.flatMap((project) => project.facts),
  ];
  const nothing = chapters.length === 0 && !background;

  return (
    <div className="flex items-start gap-26 max-wide:flex-col max-wide:items-stretch">
      {nothing ? null : (
        <nav aria-label={words.contents} className="w-sidebar shrink-0 wide:sticky wide:top-20 max-wide:w-full">
          <ul className="grid gap-2 border-l border-border max-wide:flex max-wide:flex-wrap max-wide:gap-x-14 max-wide:border-l-0">
            {chapters.map((chapter) => (
              <li key={chapter.id}>
                <ContentsLink
                  to={chapter.id}
                  name={chapter.name}
                  detail={[chapter.years, String(factsIn(chapter))].filter(Boolean).join(" · ")}
                />
              </li>
            ))}
            {background ? (
              <li>
                <ContentsLink to="chapter-background" name={words.educationAndCertifications} detail={null} />
              </li>
            ) : null}
          </ul>
        </nav>
      )}

      <article className="flex-1 min-w-0 max-w-measure grid gap-20 content-start">
        <Counts doc={doc} onShowKeptOut={() => choose("kept-out")} />

        {all.length > 0 ? (
          <div role="group" aria-label="Show" className="flex flex-wrap gap-4">
            <FilterPill active={!show} onClick={() => choose(undefined)}>
              Everything
            </FilterPill>
            {MASTER_FILTERS.map((filter) => (
              <FilterPill key={filter} active={show === filter} onClick={() => choose(filter)}>
                {FILTER[filter].label} {all.filter(FILTER[filter].matches).length}
              </FilterPill>
            ))}
          </div>
        ) : null}

        {nothing && show ? <p className="text-small text-text-dim">Nothing in your record matches this.</p> : null}

        {chapters.map((chapter, index) => {
          const employer = doc.employers.find((e) => `chapter-${e.id}` === chapter.id);
          return (
            <section
              key={chapter.id}
              id={chapter.id}
              aria-labelledby={`${chapter.id}-heading`}
              className={`grid gap-16 ${index > 0 ? "border-t border-border pt-20" : ""}`}
            >
              <header className="grid gap-4">
                <h2 id={`${chapter.id}-heading`} className="text-page font-semibold tracking-snug text-text-strong">
                  {chapter.name}
                  {employer?.alternateName ? (
                    <>
                      {" "}
                      <span className="font-normal text-text-dim">({employer.alternateName})</span>
                    </>
                  ) : null}
                </h2>
                {employer ? (
                  <p className="text-small text-text-dim">
                    {[period(employer.startedOn, employer.endedOn, language), employer.industry].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                {employer && employer.roles.length > 0 ? (
                  <ul aria-label="Roles" className="mt-4 flex flex-wrap gap-6">
                    {employer.roles.map((role, at) => (
                      <li key={at} className="bg-chip rounded-chip px-6 py-2 text-small text-text-secondary">
                        {role.title} · {period(role.startedOn, role.endedOn, language)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </header>
              {chapter.projects.map((project) => (
                <ProjectSection key={project.id} project={project} language={language} />
              ))}
              {chapter.facts.length > 0 ? (
                <section aria-label={chapter.projects.length > 0 ? (employer ? words.otherWork : words.unfiled) : undefined} className="grid gap-8">
                  {chapter.projects.length > 0 ? <SubHeading>{employer ? words.otherWork : words.unfiled}</SubHeading> : null}
                  <FactGroups facts={chapter.facts} language={language} />
                </section>
              ) : null}
              {chapter.projects.length === 0 && chapter.facts.length === 0 ? (
                <p className="text-small text-text-dim">{words.noFacts}</p>
              ) : null}
            </section>
          );
        })}

        {background ? <Background doc={doc} first={chapters.length === 0} /> : null}
      </article>
    </div>
  );
}

const factsIn = (chapter: { projects: MasterProject[]; facts: MasterFact[] }) =>
  chapter.facts.length + chapter.projects.reduce((sum, project) => sum + project.facts.length, 0);

/**
 * A line of the contents. It scrolls the page rather than navigating, so the
 * filter in the address stays as it is.
 */
function ContentsLink({ to, name, detail }: { to: string; name: string; detail: string | null }) {
  return (
    <a
      href={`#${to}`}
      onClick={(event) => {
        event.preventDefault();
        document.getElementById(to)?.scrollIntoView({ block: "start" });
      }}
      className="block px-10 py-4 rounded-control hover:bg-hover motion-tone max-wide:px-0"
    >
      <span className="block text-row text-text-secondary">{name}</span>
      {detail ? <span className="block text-small text-text-dimmer">{detail}</span> : null}
    </a>
  );
}

/**
 * One plain sentence of counts (issue #112), in place of a row of labels.
 * Flags are counted as the sidebar counts them: it said 34 to check while this
 * said 29 flagged, one counting flags and the other facts (evaluation B7).
 */
function Counts({ doc, onShowKeptOut }: { doc: MasterDocument; onShowKeptOut: () => void }) {
  const { counts } = doc;
  const sentences = countSentences(counts);
  return (
    <p className="bg-surface-raised border border-border rounded-panel px-16 py-12 text-ui text-text-secondary">
      {sentences.lead}
      {sentences.held ? (
        <>
          {" "}
          {sentences.held}{" "}
          <button type="button" onClick={onShowKeptOut} className="text-accent-link hover:text-accent-link-hover underline">
            Show {counts.keptOut === 1 ? "it" : `those ${counts.keptOut}`}
          </button>
          .
        </>
      ) : null}
      {sentences.flags ? (
        <>
          {" "}
          <Link to="/flagged" className="text-accent-link hover:text-accent-link-hover underline">
            {sentences.flags.slice(0, -1)}
          </Link>
          .
        </>
      ) : null}
      {sentences.waiting ? ` ${sentences.waiting} Sort them from Home.` : ""}
    </p>
  );
}

function ProjectSection({ project, language }: { project: MasterProject; language: MasterLanguage }) {
  return (
    <section aria-label={project.name} className="grid gap-8">
      <div>
        <SubHeading>{project.name}</SubHeading>
        {project.summary ? <p className="mt-2 text-small text-text-dim">{project.summary}</p> : null}
      </div>
      {project.facts.length === 0 ? (
        <p className="text-small text-text-dim">{MASTER_WORDS[language].noFacts}</p>
      ) : (
        <FactGroups facts={project.facts} language={language} />
      )}
    </section>
  );
}

const SubHeading = ({ children }: { children: string }) => (
  <h3 className="text-doc-heading font-semibold text-text-strong">{children}</h3>
);

/** Results, then What I did: what changed apart from what was done. */
function FactGroups({ facts, language }: { facts: MasterFact[]; language: MasterLanguage }) {
  const words = MASTER_WORDS[language];
  const { results, work } = factGroups(facts);
  return (
    <>
      {(
        [
          [words.results, results],
          [words.work, work],
        ] as const
      ).map(([label, group]) =>
        group.length === 0 ? null : (
          <div key={label} className="grid gap-2">
            <h4>
              <Mono className="text-text-dimmer">{label}</Mono>
            </h4>
            <ul aria-label={label} className="grid">
              {group.map((fact) => (
                <FactLine key={fact.id} fact={fact} />
              ))}
            </ul>
          </div>
        ),
      )}
    </>
  );
}

/** The tone of each mark: Private's and Generated's own, and a plain chip for a hand-added one. */
const MARK_TONE: Record<keyof typeof FACT_MARK, string> = {
  private: "bg-private-bg border-private-rule text-private",
  generated: "bg-generated-mark border-generated-rule text-generated-text",
  byHand: "bg-chip border-border-control text-text-dim",
};

function FactLine({ fact }: { fact: MasterFact }) {
  // The two that keep a fact out of every document are the ones the claim's
  // own tone carries, as on the fact card.
  const held = keptOut(fact);
  const claim = figures(fact.claim, fact.technologies).map((part, at) =>
    part.figure ? (
      <strong key={at} className={`font-semibold ${held ? "" : "text-measured-text"}`}>
        {part.text}
      </strong>
    ) : (
      part.text
    ),
  );
  // The claim opens its card, and says on hover where it came from. Printed
  // on every line, the file and line were half of the noise (issue #112).
  const tone = `text-doc-compact hover:underline ${held ? "text-text-dim" : "text-text-strong"}`;
  return (
    <li className="flex items-baseline gap-8 py-6 border-b border-border-subtle">
      <span aria-hidden className="text-text-faint">
        •
      </span>
      <span className="flex-1 min-w-0">
        {fact.source ? (
          <Link
            to="/imports/$importId"
            params={{ importId: fact.source.importId }}
            search={{ fact: fact.id }}
            title={`From ${fact.source.filename}${fact.source.lineNumber === null ? "" : `, line ${fact.source.lineNumber}`}`}
            className={tone}
          >
            {claim}
          </Link>
        ) : (
          // No document: a fact saved by quick capture, whose card is there (issue #95).
          <Link to="/capture" search={{ fact: fact.id }} title="Added by hand, on Quick capture" className={tone}>
            {claim}
          </Link>
        )}
        {factMarks(fact).map((mark) => (
          <span
            key={mark}
            className={`ml-8 inline-flex items-center rounded-chip border px-6 text-micro align-baseline ${MARK_TONE[mark]}`}
          >
            {FACT_MARK[mark]}
          </span>
        ))}
      </span>
    </li>
  );
}

function Background({ doc, first }: { doc: MasterDocument; first: boolean }) {
  const { language } = doc;
  const words = MASTER_WORDS[language];
  const comma = language === "ja" ? "、" : ", ";
  return (
    <section
      id="chapter-background"
      aria-labelledby="chapter-background-heading"
      className={`grid gap-16 ${first ? "" : "border-t border-border pt-20"}`}
    >
      <h2 id="chapter-background-heading" className="text-page font-semibold tracking-snug text-text-strong">
        {words.educationAndCertifications}
      </h2>
      {doc.educations.length > 0 ? (
        <section aria-label={words.education} className="grid gap-8">
          <SubHeading>{words.education}</SubHeading>
          <ul className="grid gap-4">
            {doc.educations.map((education) => (
              <li key={education.id} className="text-doc-compact text-text-strong">
                {[education.institution, education.detail].filter(Boolean).join(comma)}{" "}
                <span className="text-small text-text-dim">
                  (
                  {[period(education.startedOn, education.endedOn, language, "?"), words.outcome[education.outcome]]
                    .filter(Boolean)
                    .join(comma)}
                  )
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {doc.certifications.length > 0 ? (
        <section aria-label={words.certifications} className="grid gap-8">
          <SubHeading>{words.certifications}</SubHeading>
          <ul className="grid gap-4">
            {doc.certifications.map((certification) => (
              <li key={certification.id} className="text-doc-compact text-text-strong">
                {certification.name}
                {comma}
                {certification.issuingOrganization}
                {certification.issuedOn ? (
                  <span className="text-small text-text-dim"> ({words.issued(monthOf(certification.issuedOn, language)!)})</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
