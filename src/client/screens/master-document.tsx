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
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { downloadMasterDocument, failureText, useMasterDocument, useProfile } from "../api";
import { ReadFailure, RefreshFailure } from "../components/read-failure";
import { ScreenIntro } from "../components/screen-intro";
import { Sidebar } from "../components/sidebar";
import { Button, Mono, Panel } from "../components/ui";
import {
  DISCLOSURE_LABEL,
  PROVENANCE_LABEL,
  period,
  type MasterDocument,
  type MasterFact,
  type MasterProject,
} from "~/shared/master-document";

export function MasterDocumentScreen() {
  const profile = useProfile();
  const master = useMasterDocument();
  const doc = master.data;

  return (
    <div className="min-h-screen flex">
      <Sidebar name={profile.data?.nameLatin ?? ""} />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-header shrink-0 flex items-center gap-12 px-20 bg-surface border-b border-border">
          <h1 className="text-panel font-semibold tracking-snug text-text-strong">Master document</h1>
          <span className="text-smaller text-text-dimmer">Everything in your record, in one place</span>
          <span className="ml-auto">{doc && doc.counts.facts > 0 ? <Download /> : null}</span>
        </header>

        <div className="flex-1 overflow-y-auto px-20 py-26 grid gap-20 content-start">
          <ScreenIntro
            next={
              !doc
                ? undefined
                : doc.counts.facts === 0
                  ? "import a document. Its facts appear here."
                  : "nothing is waiting here. Read it, or download a copy to keep."
            }
            legend="Private facts and Generated facts are listed here and marked. No résumé uses them."
          >
            Every fact you have accepted, from every document you imported, including the ones a
            résumé leaves out. Every résumé is written from this. It is built from your record each
            time you open it, so it cannot be edited here: change a fact on its own card.
          </ScreenIntro>

          {doc && master.isError ? <RefreshFailure query={master} /> : null}
          {!doc && master.isError ? (
            <ReadFailure query={master} />
          ) : !doc ? (
            <p className="text-smaller text-text-dim">Building the master document…</p>
          ) : (
            <Body doc={doc} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The file holds Private facts, by the owner's decision (`docs/06`,
 * 2026-10-08), and the button says so before it is pressed rather than after.
 */
function Download() {
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
            await downloadMasterDocument();
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
  const { counts } = doc;
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
        <Panel key={employer.id} heading={employer.nameJa ? `${employer.name} (${employer.nameJa})` : employer.name}>
          <p className="text-smaller text-text-dim">
            {[period(employer.startedOn, employer.endedOn), employer.industry].filter(Boolean).join(" · ")}
          </p>
          {employer.roles.length > 0 ? (
            <ul className="mt-8 grid gap-2">
              {employer.roles.map((role, index) => (
                <li key={index} className="text-small text-text-secondary">
                  {role.title} <span className="text-text-dim">({period(role.startedOn, role.endedOn)})</span>
                </li>
              ))}
            </ul>
          ) : null}
          {employer.projects.map((project) => (
            <ProjectSection key={project.id} project={project} />
          ))}
          {employer.facts.length > 0 ? (
            <section className="mt-14">
              {employer.projects.length > 0 ? <SubHeading>Other work here</SubHeading> : null}
              <Facts facts={employer.facts} />
            </section>
          ) : null}
          {employer.projects.length === 0 && employer.facts.length === 0 ? (
            <p className="mt-8 text-smaller text-text-dim">No facts filed here yet.</p>
          ) : null}
        </Panel>
      ))}

      {outside ? (
        <Panel heading="Work outside employment">
          {doc.independent.projects.map((project) => (
            <ProjectSection key={project.id} project={project} />
          ))}
          {doc.independent.facts.length > 0 ? (
            <section className="mt-14">
              <SubHeading>Not filed under a project</SubHeading>
              <Facts facts={doc.independent.facts} />
            </section>
          ) : null}
        </Panel>
      ) : null}

      {doc.educations.length > 0 ? (
        <Panel heading="Education">
          <ul className="grid gap-4">
            {doc.educations.map((education) => (
              <li key={education.id} className="text-small text-text-secondary">
                {[education.institution, education.detail].filter(Boolean).join(", ")}{" "}
                <span className="text-text-dim">
                  ({[period(education.startedOn, education.endedOn, "?"), education.outcome].filter(Boolean).join(", ")})
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {doc.certifications.length > 0 ? (
        <Panel heading="Certifications">
          <ul className="grid gap-4">
            {doc.certifications.map((certification) => (
              <li key={certification.id} className="text-small text-text-secondary">
                {certification.name}, {certification.issuingOrganization}
                {certification.issuedOn ? (
                  <span className="text-text-dim"> (issued {certification.issuedOn.slice(0, 7)})</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}

function ProjectSection({ project }: { project: MasterProject }) {
  return (
    <section aria-label={project.name} className="mt-14">
      <SubHeading>{project.name}</SubHeading>
      {project.summary ? <p className="mb-8 text-small text-text-dim">{project.summary}</p> : null}
      {project.facts.length === 0 ? (
        <p className="text-smaller text-text-dim">No facts filed here yet.</p>
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
