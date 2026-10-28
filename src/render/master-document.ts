/**
 * The career record as a file: the same structure the screen shows, written
 * out as Markdown (`src/shared/master-document.ts`). Contents, one chapter an
 * employer, one section a project, Results apart from What I did, and the
 * figures in bold (issue #112).
 *
 * **It contains Private facts**, by the owner's decision (`docs/06`,
 * 2026-10-08): it is the author's own copy of their own record, as the JSON
 * export already is. It says so in its first lines, and marks each one.
 *
 * No source text: a fact carries the name of the document it was read from and
 * a line number, never the passage. That reference is an HTML comment at the
 * end of its line, where the screen shows it on hover: there when it is looked
 * for, and out of the reading.
 *
 * The 日本語 file (issue #59) is the same file in Japanese: its headings, its
 * opening lines and the record's names. A claim is written as it was read, and
 * the marks in brackets stay the product's terms, as on the screen.
 */
import {
  FACT_MARK,
  MASTER_WORDS,
  countSentences,
  factGroups,
  factMarks,
  figures,
  monthOf,
  period,
  yearSpan,
  type MasterDocument,
  type MasterFact,
  type MasterLanguage,
  type MasterProject,
} from "~/shared/master-document";
import { tokyoDay } from "./filename";

/** The lines above the record: what the file is, who it is for, and how much it holds. */
function opening(doc: MasterDocument): string[] {
  const { counts } = doc;
  const built = tokyoDay(new Date(doc.builtAt));
  if (doc.language === "ja") {
    return [
      `# ${MASTER_WORDS.ja.title}${doc.subjectName ? `：${doc.subjectName}` : ""}`,
      "",
      `${built} に記録から作成。承認済みの実績をすべて掲載しており、Private（非公開）のものと、どの書類にも使われていないものを含みます。**ご自身の控えです。企業や採用担当者には送らないでください。** 実績の文は取り込んだ文書に書かれた言語のままで、翻訳していません。`,
      "",
      `実績 ${counts.facts} 件${counts.years ? `（${counts.years}年間）` : ""}。書類に使えるもの ${counts.usable} 件。` +
        (counts.keptOut > 0
          ? `${[counts.private > 0 ? `Private ${counts.private} 件` : null, counts.generated > 0 ? `Not confirmed ${counts.generated} 件` : null]
              .filter(Boolean)
              .join("、")}は書類に使われません。`
          : "") +
        (counts.flags > 0 ? `確認待ちのフラグ ${counts.flags} 件。` : "") +
        (counts.waiting > 0 ? `ほかに ${counts.waiting} 件が仕分け待ちで、掲載されていません。` : ""),
      "",
    ];
  }
  const sentences = countSentences(counts);
  return [
    `# ${MASTER_WORDS.en.title}${doc.subjectName ? `: ${doc.subjectName}` : ""}`,
    "",
    `Built from the record on ${built}. It lists every accepted achievement, including Private ones and ones no résumé uses. **It is your own copy. Do not send it to an employer or a recruiter.**`,
    "",
    [sentences.lead, sentences.held, sentences.flags, sentences.waiting].filter(Boolean).join(" "),
    "",
  ];
}

export function masterMarkdown(doc: MasterDocument): string {
  const { language } = doc;
  const words = MASTER_WORDS[language];
  const ja = language === "ja";
  const out: string[] = opening(doc);
  const outside = doc.independent.projects.length > 0 || doc.independent.facts.length > 0;
  const background = doc.educations.length > 0 || doc.certifications.length > 0;

  const contents = [
    ...doc.employers.map((employer) =>
      [employer.name, yearSpan(employer.startedOn, employer.endedOn, language), String(factsUnder(employer))]
        .filter(Boolean)
        .join(" · "),
    ),
    ...(outside ? [`${words.outside} · ${factsUnder(doc.independent)}`] : []),
    ...(background ? [words.educationAndCertifications] : []),
  ];
  if (contents.length > 0) out.push(`## ${words.contents}`, "", ...contents.map((line) => `- ${line}`), "");

  for (const employer of doc.employers) {
    out.push(`## ${employer.name}${employer.alternateName ? ` (${employer.alternateName})` : ""}`, "");
    const about = [period(employer.startedOn, employer.endedOn, language), employer.industry].filter(Boolean);
    if (about.length > 0) out.push(about.join(" · "), "");
    if (employer.roles.length > 0) {
      for (const role of employer.roles) out.push(`- ${role.title} (${period(role.startedOn, role.endedOn, language)})`);
      out.push("");
    }
    for (const project of employer.projects) writeProject(out, project, language);
    if (employer.facts.length > 0) {
      if (employer.projects.length > 0) out.push(`### ${words.otherWork}`, "");
      writeFacts(out, employer.facts, language);
    }
    if (employer.projects.length === 0 && employer.facts.length === 0) out.push(words.noFacts, "");
  }

  if (outside) {
    out.push(`## ${words.outside}`, "");
    for (const project of doc.independent.projects) writeProject(out, project, language);
    if (doc.independent.facts.length > 0) {
      if (doc.independent.projects.length > 0) out.push(`### ${words.unfiled}`, "");
      writeFacts(out, doc.independent.facts, language);
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

/** Every fact in a chapter, the number its contents line carries. */
const factsUnder = (chapter: { projects: MasterProject[]; facts: MasterFact[] }) =>
  chapter.facts.length + chapter.projects.reduce((sum, project) => sum + project.facts.length, 0);

function writeProject(out: string[], project: MasterProject, language: MasterLanguage) {
  out.push(`### ${project.name}`, "");
  if (project.summary) out.push(project.summary, "");
  if (project.facts.length === 0) out.push(MASTER_WORDS[language].noFacts, "");
  else writeFacts(out, project.facts, language);
}

/** Results, then What I did, each under its label. */
function writeFacts(out: string[], facts: MasterFact[], language: MasterLanguage) {
  const words = MASTER_WORDS[language];
  const { results, work } = factGroups(facts);
  for (const [label, group] of [
    [words.results, results],
    [words.work, work],
  ] as const) {
    if (group.length === 0) continue;
    out.push(`**${label}**`, "");
    for (const fact of group) out.push(factLine(fact));
    out.push("");
  }
}

/** One line per fact, so the list stays a list whatever the claim holds. */
function factLine(fact: MasterFact): string {
  const claim = figures(fact.claim.replace(/\s*\n\s*/g, " "), fact.technologies)
    .map((part) => (part.figure ? `**${part.text}**` : part.text))
    .join("");
  const marks = factMarks(fact).map((mark) => ` *(${FACT_MARK[mark]})*`).join("");
  // A filename is the author's own, and `-->` in one would end the comment early.
  const source = fact.source
    ? ` <!-- ${fact.source.filename.replaceAll("-->", "->")}${fact.source.lineNumber === null ? "" : ` L${fact.source.lineNumber}`} -->`
    : "";
  return `- ${claim}${marks}${source}`;
}
