/**
 * Open in Claude (`docs/specs/mcp-spike.md`): a Claude Desktop link with the
 * prompt for the MCP tools already typed in, offered only where save_render
 * could open a proposal. All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RenderRow } from "~/client/api";
import { claudeLink, claudePrompt, OpenInClaude } from "~/client/components/open-in-claude";

const row = (over: Partial<RenderRow> = {}): RenderRow => ({
  id: "rnd_fixture",
  ref: "english_resume",
  tailored: null,
  kind: "english_resume",
  language: "en",
  title: "English résumé",
  buildable: true,
  currentVersionId: null,
  currentVersionNo: null,
  generatedAt: null,
  status: "never_generated",
  newFactsSince: null,
  withdrawnFactsSince: null,
  pendingProposalId: null,
  progressAt: null,
  ...over,
});

describe("the link", () => {
  it("is Claude Desktop's new-chat link with the prompt encoded into q", () => {
    const link = claudeLink(row());
    expect(link.startsWith("claude://claude.ai/new?q=")).toBe(true);
    expect(decodeURIComponent(link.slice(link.indexOf("q=") + 2))).toBe(claudePrompt(row()));
  });

  it("names the document by the ref get_record and save_render take, a tailored id included", () => {
    const prompt = claudePrompt(row({ ref: "tdc_fixture", title: "Résumé for Fixture K.K." }));
    expect(prompt).toContain('get_record with document "tdc_fixture"');
    expect(prompt).toContain("save_render");
    expect(prompt).toContain("Résumé for Fixture K.K.");
  });

  it("asks for a new version once there is one", () => {
    expect(claudePrompt(row())).toMatch(/^Write my /);
    expect(claudePrompt(row({ currentVersionId: "ver_fixture" }))).toMatch(/^Write a new version of /);
  });
});

describe("the control", () => {
  it("is offered on a document that can take a proposal", () => {
    render(<OpenInClaude row={row({ status: "stale" })} enabled />);
    expect(screen.getByRole("link", { name: "Write English résumé in Claude" }).getAttribute("href")).toBe(claudeLink(row()));
  });

  it("is not offered while a proposal waits or is being written, or before the document can be built", () => {
    for (const over of [{ status: "proposal_pending" }, { status: "proposal_generating" }, { buildable: false }] as const) {
      const { container, unmount } = render(<OpenInClaude row={row(over)} enabled />);
      expect(container.innerHTML).toBe("");
      unmount();
    }
  });

  it("is not offered when the build has no connector to reach", () => {
    const { container } = render(<OpenInClaude row={row()} enabled={false} />);
    expect(container.innerHTML).toBe("");
  });
});
