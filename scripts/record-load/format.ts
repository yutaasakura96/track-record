/**
 * The structured-record file `npm run db:load:record` loads: one JSON document
 * holding the part of a record only its author can type (`docs/12` §5b has the
 * fields and an example). It lives outside this repository.
 *
 * Each row is held to the schema its API route holds it to, so a file the
 * loader accepts is one the screens could have written. Strict on top of that:
 * a misspelt key would otherwise be dropped and load as an empty field.
 */
import { resolve, sep } from "node:path";
import { z } from "zod";
import { certificationBody, educationFields, educationRules } from "~/server/routes/credentials";
import { profileBody } from "~/server/routes/profile";
import { employerBody, roleBody } from "~/server/routes/record";

const role = roleBody.omit({ employerId: true }).strict();
const employer = employerBody.extend({ roles: z.array(role) }).strict();

export const recordFile = z.strictObject({
  formatVersion: z.literal(1),
  profile: profileBody.strict(),
  employers: z.array(employer).min(1, "A record has at least one employer."),
  educations: z.array(educationFields.strict().superRefine(educationRules)),
  certifications: z.array(certificationBody.strict()),
});

export type RecordFile = z.output<typeof recordFile>;

/** Every message names a place in the file and never carries a value from it: this file is PII. */
export class RecordFileError extends Error {
  constructor(readonly problems: string[]) {
    super(`The record file was refused:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
  }
}

export function parseRecordFile(text: string): RecordFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // Not the parser's message: it quotes the text around the mistake.
    throw new RecordFileError(["The file is not valid JSON."]);
  }
  const parsed = recordFile.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new RecordFileError(
    parsed.error.issues.map((issue) => `${issue.path.join(".") || "(top level)"}: ${issue.message}`),
  );
}

export function assertOutsideRepository(file: string, root: string): void {
  const path = resolve(file);
  const repository = resolve(root);
  if (path === repository || path.startsWith(repository + sep)) {
    throw new Error("The record file is inside this repository, which is public. Keep it outside it.");
  }
}
