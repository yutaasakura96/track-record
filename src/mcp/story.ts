/**
 * A career story written in parts (`docs/specs/mcp-spike.md`), the way the
 * app's generator writes one (`docs/06`, 2026-11-04): each employer chapter
 * by itself, sent only that employer's facts; then the chapters of no
 * employer, written around them; then the closing tables, written from all of
 * it. Each part is held to its own chapters, its own facts and, in Japanese,
 * the Japanese check as it arrives, so one bad part is written again alone
 * instead of the whole story.
 *
 * Stateless: Claude sends the story so far back with each part, and nothing is
 * stored until `save_render` takes the finished story. The plan, each part's
 * facts and each part's prompt are the generator's own functions
 * (`model/generate.ts`), so the two cannot drift apart.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ModelUnavailableError } from "~/model";
import {
  buildGenerationPrompt,
  chaptersOf,
  closingCall,
  employerParts,
  framingCall,
  isStoryComplete,
  parseGeneratedRender,
  parseRenderContent,
  type StoryCall,
} from "~/model/generate";
import { chapterPlan, isChapteredStory } from "~/render/chapters";
import { JAPANESE_DEFECT_REASON, japaneseDefect } from "~/render/japanese";
import type { collectRenderInputs } from "~/server/services/render";
import type { RenderContent } from "~/shared/render-content";
import { Refused, guarded, ok } from "./result";
import { contentSchema, documentSchema } from "./schemas";

type Inputs = Awaited<ReturnType<typeof collectRenderInputs>>;
type InputsFor = (document: string) => Promise<{ target: { ref: string; kind: string; title: string }; inputs: Inputs }>;

/** A model's refusal of a part, said to Claude as what to fix. */
function parsed<T>(read: () => T): T {
  try {
    return read();
  } catch (err) {
    if (err instanceof ModelUnavailableError) throw new Refused(`${err.message} Write this part again.`);
    throw err;
  }
}

export function registerStoryTools(server: McpServer, inputsFor: InputsFor) {
  server.registerTool(
    "story_part",
    {
      title: "Write a career story in parts",
      description:
        "Drives a career story (career_story_en, career_story_ja) the way Track Record's generator writes " +
        "one: a part at a time. Call it first with only `document`: it returns the first part to write, " +
        "with the generator's own `instructions` for that part and the only `facts` it may cite. Write the " +
        "part, then call again with `part` and the `story_so_far` it returned. Each part is checked as it " +
        "arrives; a refused part is written again by itself. When `complete` is true, pass `story_so_far` " +
        "to save_render as the content.",
      inputSchema: {
        document: documentSchema,
        story_so_far: contentSchema.optional(),
        part: contentSchema.optional(),
      },
    },
    ({ document, story_so_far, part }) =>
      guarded("story_part", async () => {
        const { target, inputs } = await inputsFor(document);
        if (!isChapteredStory(target.kind)) {
          throw new Refused(`${target.title} is not a career story. Write it whole from get_record.`);
        }
        const { facts } = inputs;
        const story = { ...inputs.spec, storySoFar: undefined };
        const order = chapterPlan(story.kind, story.employers, story.workOutsideEmployment).map((chapter) => chapter.key);
        const planned = new Set(order);
        const inOrder = (sections: RenderContent["sections"]) =>
          [...sections].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

        /** Joined in plan order and parsed once, so block ids are unique across parts. */
        const joined = (sections: unknown[]): RenderContent =>
          sections.length === 0 ? { sections: [] } : parsed(() => parseRenderContent({ sections }));

        let written = joined(inOrder((story_so_far?.sections ?? []).filter((s) => planned.has(s.key)) as RenderContent["sections"]));

        /** The next call of the generator's rounds with a chapter still to write, as `writeStoryRound` picks it. */
        const next = (sofar: RenderContent): StoryCall | null => {
          const done = new Set(sofar.sections.map((section) => section.key));
          const framing = framingCall(facts, story, sofar);
          const calls = [...employerParts(facts, story), ...(framing ? [framing] : []), closingCall(facts, story, sofar)];
          return calls.find((call) => call.spec.part!.chapters.some((key) => !done.has(key))) ?? null;
        };

        if (part) {
          const call = next(written);
          if (!call) throw new Refused("Every chapter is already written. Save story_so_far with save_render.");
          const chapters = chaptersOf(call.spec);
          const read = parsed(() => parseRenderContent(part, chapters));
          const allowed = new Set(call.facts.map((fact) => fact.id));
          const stray = [...new Set(read.sections.flatMap((s) => s.blocks.flatMap((b) => b.factIds)))].filter((id) => !allowed.has(id));
          if (stray.length > 0) {
            throw new Refused(`${stray.join(", ")} ${stray.length === 1 ? "was" : "were"} not given for this part. Cite only its facts and write it again.`);
          }
          // A Japanese part is held to the Japanese check as it arrives, against every fact's technologies.
          const defect = story.language === "ja" ? japaneseDefect(read, story, facts) : null;
          if (defect) throw new Refused(`${JAPANESE_DEFECT_REASON[defect]} Write this part again.`);
          written = joined(inOrder([...written.sections, ...read.sections]));
        }

        const call = next(written);
        if (call) {
          return ok({
            document: target.ref,
            complete: false,
            next: {
              chapters: call.spec.part!.chapters,
              instructions: buildGenerationPrompt(call.spec),
              facts: call.facts,
            },
            story_so_far: written,
          });
        }
        if (!isStoryComplete(written, story)) {
          throw new Refused("The story is missing a chapter its record plans. Start again without story_so_far.");
        }
        // The whole story, held to its plan as the generator's last round is.
        parsed(() => parseGeneratedRender(written, story));
        return ok({
          document: target.ref,
          complete: true,
          next: "Pass story_so_far to save_render as the content for this document.",
          story_so_far: written,
        });
      }),
  );
}
