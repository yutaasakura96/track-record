import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExtractionProgress } from "~/client/components/extraction-progress";

describe("extraction progress", () => {
  it.each(["queued", "extracting"] as const)("stays below complete while %s", (status) => {
    const { container } = render(
      <ExtractionProgress status={status} chunksDone={150} chunksTotal={150} meanwhile="Review found facts." />,
    );
    const bar = screen.getByRole("progressbar");
    const percent = bar.getAttribute("aria-valuenow");
    expect(percent === null || Number(percent) < 100).toBe(true);
    expect(container.querySelector<HTMLElement>(".motion-progress")?.style.width).not.toBe("100%");
    if (status === "extracting") {
      expect(percent).toBe("99");
      expect(container.querySelector<HTMLElement>(".motion-progress")?.style.width).toBe("99%");
    }
  });
});
