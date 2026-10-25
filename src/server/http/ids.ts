/**
 * Prefixed identifiers. The prefix is for humans reading a log line or a URL;
 * nothing parses it.
 */
import { customAlphabet } from "nanoid";

const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const generate = customAlphabet(alphabet, 16);

export const ID_PREFIXES = {
  user: "usr",
  profile: "prf",
  employer: "emp",
  role: "rol",
  project: "prj",
  sourceDocument: "doc",
  /** A source document version IS an import — there is no separate table. */
  sourceDocumentVersion: "sdv",
  importChunk: "chk",
  /** The several files one Import sent together; a column, not a table. */
  importBatch: "imb",
  fact: "fct",
  education: "edu",
  certification: "crt",
  careerGapNote: "gap",
  render: "rnd",
  renderVersion: "rvr",
  renderProposal: "prp",
  skillCuration: "skl",
  factFlag: "flg",
  application: "app",
  applicationStep: "aps",
  interview: "int",
  interviewQuestion: "ivq",
  interviewRecording: "rec",
  applicationDocument: "apd",
  applicationSentCopy: "asc",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

export const newId = (kind: IdKind) => `${ID_PREFIXES[kind]}_${generate()}`;
