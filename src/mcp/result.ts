/**
 * What every MCP tool answers with, and the one wrapper every handler runs
 * through (`docs/specs/mcp-spike.md`).
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";
import { ApiError } from "~/server/http/errors";
import { EditRejected } from "~/render/edit";

/** A refusal Claude can read and act on. Ids and reasons, never record text. */
export class Refused extends Error {}

export const ok = (payload: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
});

export const refused = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

/**
 * Every handler runs through this. A `Refused`, an `ApiError`, a refused edit
 * or a route schema's validation message is written for the caller; anything
 * else is not, and becomes a generic one.
 */
export async function guarded(tool: string, run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Refused || err instanceof ApiError || err instanceof EditRejected) {
      return refused(err.message);
    }
    if (err instanceof ZodError) {
      // The route's own messages ("Give it a company."), never the input.
      return refused(`${err.issues.map((issue) => issue.message).join(" ")} Nothing was stored.`);
    }
    // The tool name only. Never the arguments, which carry claims and quotes.
    console.error(JSON.stringify({ event: "mcp_tool_failed", tool }));
    return refused(`${tool} failed. Nothing was changed.`);
  }
}
