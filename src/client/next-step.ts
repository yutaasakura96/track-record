/**
 * What Screen 3's Next step says (`docs/10-screen-specifications.md`).
 *
 * The screen it replaced showed four counts, a chart and five rows, and left
 * the author to work out which of them wanted anything (issue #58). This is that
 * working out, done once and in one place: every step that applies, in the
 * order to take it. The first is the Next step and the rest are `Also waiting`.
 * The three that only answer "what now" (wait, import, up to date) can only
 * ever come first, so they never stand in that list.
 *
 * Pure, so the order is a table to read rather than a render to follow.
 */
import type { Overview, RenderRow } from "./api";

/**
 * Why a document is out of date. It is out of date by facts that arrived, by
 * facts it was generated from that it may no longer use, or by both; a row
 * that is out of date always has one of the two (`docs/06`, 2026-10-08).
 */
function outOfDateBy(row: RenderRow): string {
  const added = row.newFactsSince ?? 0;
  const withdrawn = row.withdrawnFactsSince ?? 0;
  const arrived = `${count(added, "new fact", "new facts")} since it was generated`;
  if (withdrawn === 0) return `${arrived}.`;
  if (added === 0) {
    return `${count(withdrawn, "fact", "facts")} it was generated from can no longer be used.`;
  }
  return `${arrived}, and ${withdrawn.toLocaleString("en-US")} it was generated from can no longer be used.`;
}

const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export type StepAction =
  /** Into Fact Review on that version. */
  | { kind: "review"; label: string; importId: string }
  /** Into Diff Review on that proposal. */
  | { kind: "proposal"; label: string; proposalId: string }
  /** Asks for a proposal, then opens it. */
  | { kind: "generate"; label: string; render: RenderRow["kind"] }
  /** The header's own control. */
  | { kind: "import"; label: string };

export interface Step {
  key: string;
  title: string;
  why: string;
  action: StepAction | null;
}

export function nextSteps(data: Overview): Step[] {
  const steps: Step[] = [];
  const { review, activeImport, unconfirmed, documents, canGenerate } = data;
  const generated = data.factsByProvenance.generated;

  if (review) {
    steps.push({
      key: "review",
      title: `Review ${count(review.openCandidates, "fact", "facts")}`,
      why: `${
        review.documents > 1
          ? `Found in ${review.documents} documents, newest first.`
          : `Found in ${review.filename}.`
      } A fact is used in your documents only after you accept it.`,
      action: { kind: "review", label: "Review facts", importId: review.importId },
    });
  } else if (activeImport) {
    steps.push({
      key: "wait",
      title: "Wait for the first facts",
      why: "The import is still reading. Open the review to watch the facts arrive.",
      action: { kind: "review", label: "Open review", importId: activeImport.importId },
    });
  }

  const proposed = documents.filter((row) => row.buildable && row.pendingProposalId);
  const pending = proposed.find((row) => row.status === "proposal_pending") ?? proposed[0];
  if (pending) {
    const ready = pending.status === "proposal_pending";
    steps.push({
      key: "proposal",
      title: ready ? `Check the new ${pending.title}` : `Wait for the new ${pending.title}`,
      why: ready
        ? "A new version is ready. Nothing changes until you accept it."
        : "It is still being written. Open it to watch it arrive.",
      action: {
        kind: "proposal",
        label: ready ? "Review changes" : "Open it",
        proposalId: pending.pendingProposalId!,
      },
    });
  }

  if (unconfirmed) {
    const n = unconfirmed.count;
    const older = generated - n;
    steps.push({
      key: "confirm",
      title: `Confirm ${count(n, "fact", "facts")}`,
      why: `The importer wrote ${n === 1 ? "it" : "them"} and you have not confirmed ${
        n === 1 ? "it" : "them"
      }, so no document uses ${n === 1 ? "it" : "them"}.${
        older > 0 ? ` ${count(older, "more is", "more are")} in older imports.` : ""
      }`,
      action: { kind: "review", label: n === 1 ? "Open it" : "Open them", importId: unconfirmed.importId },
    });
  }

  if (!canGenerate) {
    // Only an answer to "what now": with something already waiting above, the
    // way to a usable fact is to deal with that, not to import again.
    if (steps.length === 0) {
      steps.push({
        key: "import",
        title: "Import a document",
        why: "Your documents are generated from facts, and facts come from a document you already have.",
        action: { kind: "import", label: "Import a document" },
      });
    }
    return steps;
  }

  // One document stands for all of them; the list under the Next step says the rest.
  const idle = documents.filter((row) => row.buildable && !row.pendingProposalId);
  const never = idle.find((row) => row.status === "never_generated");
  const stale = idle.find((row) => row.status === "stale");
  if (never) {
    steps.push({
      key: "generate",
      title: `Generate your ${never.title}`,
      why: "Your record holds facts it can use. This makes the first version for you to check.",
      action: { kind: "generate", label: "Generate", render: never.kind },
    });
  }
  if (stale) {
    steps.push({
      key: "update",
      title: `Update your ${stale.title}`,
      why: outOfDateBy(stale),
      action: { kind: "generate", label: "Update", render: stale.kind },
    });
  }

  if (steps.length === 0) {
    steps.push({
      key: "done",
      title: "You are up to date",
      why: "Nothing is waiting for you. Import another document to add to your record.",
      action: null,
    });
  }
  return steps;
}
