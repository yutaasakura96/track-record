import type { Block } from "~/shared/render-content";

/** Bullets as a list, everything else as lines: a table row of a 履歴書 is a line of its own. */
export function DocumentBlocks({ blocks }: { blocks: Pick<Block, "kind" | "text">[] }) {
  const body = "text-render-body text-text-body";
  if (blocks.every((block) => block.kind === "bullet")) {
    return (
      <ul className={`grid gap-6 pl-20 list-disc ${body}`}>
        {blocks.map((block, index) => (
          <li key={index}>{block.text}</li>
        ))}
      </ul>
    );
  }
  return (
    <div className={`grid gap-6 ${body}`}>
      {blocks.map((block, index) =>
        block.kind === "bullet" ? (
          <ul key={index} className="pl-20 list-disc">
            <li>{block.text}</li>
          </ul>
        ) : (
          <p key={index} className="whitespace-pre-line">
            {block.text}
          </p>
        ),
      )}
    </div>
  );
}
