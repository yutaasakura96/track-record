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
  fact: "fct",
  education: "edu",
  certification: "crt",
  render: "rnd",
  renderVersion: "rvr",
  renderProposal: "prp",
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

export const newId = (kind: IdKind) => `${ID_PREFIXES[kind]}_${generate()}`;
