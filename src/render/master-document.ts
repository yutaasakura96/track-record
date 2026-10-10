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
 *
 * The 日本語 file (issue #59) is the same file in Japanese: its headings, its
 * opening lines and the record's names. A claim is written as it was read, and
 * the labels in brackets stay the product's terms, as on the fact card.
 */
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

/** The lines above the record: what the file is, who it is for, and how much it holds. */
function opening(doc: MasterDocument): string[] {
  const { counts } = doc;
  const built = doc.builtAt.slice(0, 10);
  if (doc.language === "ja") {
    return [
      `# ${MASTER_WORDS.ja.title}${doc.subjectName ? `：${doc.subjectName}` : ""}`,
      "",
      `${built} に記録から作成。承認済みの事実をすべて掲載しており、Private（非公開）の事実と、どの書類にも使われていない事実を含みます。**ご自身の控えです。企業や採用担当者には送らないでください。** 事実の文は取り込んだ文書に書かれた言語のままで、翻訳していません。`,
      "",
      `事実 ${counts.facts} 件：書類に使用可 ${counts.usable} 件、Private ${counts.private} 件、Generated ${counts.generated} 件。` +
        (counts.waiting > 0 ? `ほかに ${counts.waiting} 件が仕分け待ちで、掲載されていません。` : ""),
      "",
    ];
  }
  return [
    `# ${MASTER_WORDS.en.title}${doc.subjectName ? `: ${doc.subjectName}` : ""}`,
    "",
    `Built from the record on ${built}. It lists every accepted fact, including Private facts and facts no résumé uses. **It is your own copy. Do not send it to an employer or a recruiter.**`,
    "",
    `${counts.facts} ${counts.facts === 1 ? "fact" : "facts"}: ${counts.usable} a document may use, ${counts.private} Private, ${counts.generated} Generated.` +
      (counts.waiting > 0
        ? ` ${counts.waiting} more ${counts.waiting === 1 ? "is" : "are"} waiting to be sorted and ${counts.waiting === 1 ? "is" : "are"} not listed.`
        : ""),
    "",
  ];
}

export function masterMarkdown(doc: MasterDocument): string {
  const { language } = doc;
  const words = MASTER_WORDS[language];
  const ja = language === "ja";
  const out: string[] = opening(doc);

  for (const employer of doc.employers) {
    out.push(`## ${employer.name}${employer.alternateName ? ` (${employer.alternateName})` : ""}`, "");
    const facts = [period(employer.startedOn, employer.endedOn, language), employer.industry].filter(Boolean);
    if (facts.length > 0) out.push(facts.join(" · "), "");
    if (employer.roles.length > 0) {
      for (const role of employer.roles) out.push(`- ${role.title} (${period(role.startedOn, role.endedOn, language)})`);
      out.push("");
    }
    for (const project of employer.projects) writeProject(out, project, language);
    if (employer.facts.length > 0) {
      if (employer.projects.length > 0) out.push(`### ${words.otherWork}`, "");
      writeFacts(out, employer.facts);
    }
  }

  if (doc.independent.projects.length > 0 || doc.independent.facts.length > 0) {
    out.push(`## ${words.outside}`, "");
    for (const project of doc.independent.projects) writeProject(out, project, language);
    if (doc.independent.facts.length > 0) {
      if (doc.independent.projects.length > 0) out.push(`### ${words.unfiled}`, "");
      writeFacts(out, doc.independent.facts);
    }
  }

  if (doc.educations.length > 0) {
    out.push(`## ${words.education}`, "");
    for (const education of doc.educations) {
      const when = period(education.startedOn, education.endedOn, language, "?");
      out.push(
        `- ${[education.institution, education.detail].filter(Boolean).join(ja ? "、" : ", ")}` +
          ` (${[when, words.outcome[education.outcome]].filter(Boolean).join(ja ? "、" : ", ")})`,
      );
    }
    out.push("");
  }

  if (doc.certifications.length > 0) {
    out.push(`## ${words.certifications}`, "");
    for (const certification of doc.certifications) {
      const when = [
        certification.issuedOn ? words.issued(monthOf(certification.issuedOn, language)!) : null,
        certification.expiresOn ? words.expires(monthOf(certification.expiresOn, language)!) : null,
      ].filter(Boolean);
      out.push(
        `- ${certification.name}${ja ? "、" : ", "}${certification.issuingOrganization}` +
          (when.length > 0 ? ` (${when.join(ja ? "、" : ", ")})` : ""),
      );
    }
    out.push("");
  }

  return `${out.join("\n").trimEnd()}\n`;
}

function writeProject(out: string[], project: MasterProject, language: MasterLanguage) {
  out.push(`### ${project.name}`, "");
  if (project.summary) out.push(project.summary, "");
  if (project.facts.length === 0) out.push(MASTER_WORDS[language].noFacts, "");
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
