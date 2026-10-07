/**
 * The master document as a file: the same structure the screen shows, written
 * out as Markdown (`src/shared/master-document.ts`).
 *
 * **It contains Private facts**, by the owner's decision (`docs/06`,
 * 2026-10-08): it is the author's own copy of their own record, as the JSON
 * export already is. It says so in its first lines, and marks each one.
 *
 * No source text: a fact carries the name of the document it was read from and
 * a line number, never the passage.
 */
import {
  DISCLOSURE_LABEL,
  PROVENANCE_LABEL,
  monthOf,
  period,
  type MasterDocument,
  type MasterFact,
  type MasterProject,
} from "~/shared/master-document";

export function masterMarkdown(doc: MasterDocument): string {
  const out: string[] = [];
  const { counts } = doc;

  out.push(`# Master document${doc.subjectName ? `: ${doc.subjectName}` : ""}`, "");
  out.push(
    `Built from the record on ${doc.builtAt.slice(0, 10)}. It lists every accepted fact, including Private facts and facts no résumé uses. **It is your own copy. Do not send it to an employer or a recruiter.**`,
    "",
  );
  out.push(
    `${counts.facts} ${counts.facts === 1 ? "fact" : "facts"}: ${counts.usable} a document may use, ${counts.private} Private, ${counts.generated} Generated.` +
      (counts.waiting > 0
        ? ` ${counts.waiting} more ${counts.waiting === 1 ? "is" : "are"} waiting to be sorted and ${counts.waiting === 1 ? "is" : "are"} not listed.`
        : ""),
    "",
  );

  for (const employer of doc.employers) {
    out.push(`## ${employer.name}${employer.nameJa ? ` (${employer.nameJa})` : ""}`, "");
    const facts = [period(employer.startedOn, employer.endedOn), employer.industry].filter(Boolean);
    if (facts.length > 0) out.push(facts.join(" · "), "");
    if (employer.roles.length > 0) {
      for (const role of employer.roles) out.push(`- ${role.title} (${period(role.startedOn, role.endedOn)})`);
      out.push("");
    }
    for (const project of employer.projects) writeProject(out, project);
    if (employer.facts.length > 0) {
      if (employer.projects.length > 0) out.push("### Other work here", "");
      writeFacts(out, employer.facts);
    }
  }

  if (doc.independent.projects.length > 0 || doc.independent.facts.length > 0) {
    out.push("## Work outside employment", "");
    for (const project of doc.independent.projects) writeProject(out, project);
    if (doc.independent.facts.length > 0) {
      if (doc.independent.projects.length > 0) out.push("### Not filed under a project", "");
      writeFacts(out, doc.independent.facts);
    }
  }

  if (doc.educations.length > 0) {
    out.push("## Education", "");
    for (const education of doc.educations) {
      const when = period(education.startedOn, education.endedOn, "?");
      out.push(
        `- ${[education.institution, education.detail].filter(Boolean).join(", ")}` +
          ` (${[when, education.outcome].filter(Boolean).join(", ")})`,
      );
    }
    out.push("");
  }

  if (doc.certifications.length > 0) {
    out.push("## Certifications", "");
    for (const certification of doc.certifications) {
      const when = [
        monthOf(certification.issuedOn) ? `issued ${monthOf(certification.issuedOn)}` : null,
        monthOf(certification.expiresOn) ? `expires ${monthOf(certification.expiresOn)}` : null,
      ].filter(Boolean);
      out.push(
        `- ${certification.name}, ${certification.issuingOrganization}${when.length > 0 ? ` (${when.join(", ")})` : ""}`,
      );
    }
    out.push("");
  }

  return `${out.join("\n").trimEnd()}\n`;
}

function writeProject(out: string[], project: MasterProject) {
  out.push(`### ${project.name}`, "");
  if (project.summary) out.push(project.summary, "");
  if (project.facts.length === 0) out.push("No facts filed here yet.", "");
  else writeFacts(out, project.facts);
}

function writeFacts(out: string[], facts: MasterFact[]) {
  for (const fact of facts) {
    const labels = [
      PROVENANCE_LABEL[fact.provenance],
      DISCLOSURE_LABEL[fact.disclosure],
      ...(fact.flags.length > 0 ? ["flagged"] : []),
    ].join(" · ");
    const source = fact.source
      ? ` ${fact.source.filename}${fact.source.lineNumber === null ? "" : ` L${fact.source.lineNumber}`}.`
      : "";
    // One line per fact, so the list stays a list whatever the claim holds.
    out.push(`- ${fact.claim.replace(/\s*\n\s*/g, " ")} [${labels}]${source}`);
  }
  out.push("");
}
