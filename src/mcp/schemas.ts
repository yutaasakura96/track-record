/** Input schemas more than one MCP tool takes (`docs/specs/mcp-spike.md`). */
import { z } from "zod";

/**
 * A main document by its kind (`english_resume`, `rirekisho`, …) or a tailored
 * document by its id, exactly as the render routes address them
 * (`services/render-ref.ts`).
 */
export const documentSchema = z
  .string()
  .default("english_resume")
  .describe("A document kind (english_resume, rirekisho, shokumu_keirekisho, career_story_en, career_story_ja) or a tailored document's id from get_record's `documents`.");

export const blockSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["paragraph", "bullet", "row"]),
  text: z.string(),
  factIds: z.array(z.string()).default([]),
});

export const contentSchema = z.object({
  sections: z.array(
    z.object({ key: z.string(), heading: z.string(), blocks: z.array(blockSchema) }),
  ),
});
