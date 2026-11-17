/**
 * Open in Claude: a link that starts a Claude Desktop chat with the prompt for
 * writing this document through the Track Record MCP server already typed in
 * (`docs/specs/mcp-spike.md`). The author reads it and presses Send; nothing is
 * sent by the link itself.
 *
 * The server is local stdio and reads the local database, so the link is
 * offered only in a development build. A production build has no connector to
 * reach and shows nothing.
 */
import type { RenderRow } from "../api";
import { QUIET } from "./document-row";

/** The documented Claude Desktop deep link: a new chat with `q` in the composer. */
const DESKTOP_NEW_CHAT = "claude://claude.ai/new";

export const CLAUDE_LINK_ENABLED = import.meta.env.DEV;

export function claudePrompt(row: Pick<RenderRow, "ref" | "title" | "currentVersionId">): string {
  const verb = row.currentVersionId ? "Write a new version of" : "Write";
  return [
    `${verb} my ${row.title} with the Track Record tools.`,
    `Call get_record with document "${row.ref}" and follow the instructions it returns,`,
    `cite only the fact ids it gives, then save it with save_render for the same document.`,
    `I'll review the proposal in Track Record.`,
  ].join(" ");
}

export function claudeLink(row: Pick<RenderRow, "ref" | "title" | "currentVersionId">): string {
  return `${DESKTOP_NEW_CHAT}?q=${encodeURIComponent(claudePrompt(row))}`;
}

export function OpenInClaude({ row, enabled = CLAUDE_LINK_ENABLED }: { row: RenderRow; enabled?: boolean }) {
  if (!enabled) return null;
  // save_render opens a proposal, and a document holds one at a time.
  if (!row.buildable) return null;
  if (row.status === "proposal_pending" || row.status === "proposal_generating") return null;
  return (
    <a href={claudeLink(row)} aria-label={`Write ${row.title} in Claude`} className={QUIET}>
      Open in Claude
    </a>
  );
}
