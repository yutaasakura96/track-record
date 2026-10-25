/**
 * The download control for the Japanese documents (issue #117): a PDF first,
 * Word beside it, and the file saved under the Japanese name the server sends
 * as RFC 6266's `filename*`. All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { filenameFrom } from "~/client/api";
import { DownloadButton } from "~/client/components/download-button";

describe("the file's name", () => {
  it("is the UTF-8 name when the server sends one, not its ASCII stand-in", () => {
    const header =
      `attachment; filename="rirekisho_Hanako-Kakuu_20261023.pdf"; filename*=UTF-8''${encodeURIComponent("履歴書_架空花子_20261023.pdf")}`;
    expect(filenameFrom(header, "rirekisho.pdf")).toBe("履歴書_架空花子_20261023.pdf");
  });

  it("is the plain name when that is all there is, and the fallback when there is none", () => {
    expect(filenameFrom('attachment; filename="Hanako-Kakuu-Resume-2026-10.pdf"', "x.pdf")).toBe("Hanako-Kakuu-Resume-2026-10.pdf");
    expect(filenameFrom(null, "shokumu_keirekisho.pdf")).toBe("shokumu_keirekisho.pdf");
  });
});

describe("the control", () => {
  for (const kind of ["rirekisho", "shokumu_keirekisho"] as const) {
    it(`offers the ${kind} as a PDF, with its Word file beside it`, () => {
      render(<DownloadButton kind={kind} />);
      expect(screen.getByRole("button", { name: "Download .pdf" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Download as Word (.docx)" })).toBeTruthy();
    });
  }

  it("offers a career story as Markdown alone", () => {
    render(<DownloadButton kind="career_story_ja" />);
    expect(screen.getByRole("button", { name: "Download .md" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Word/ })).toBeNull();
  });
});
