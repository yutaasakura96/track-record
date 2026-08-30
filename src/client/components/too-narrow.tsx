/**
 * Desktop only, minimum 1280px (`docs/10-screen-specifications.md`).
 *
 * The two core screens are irreducibly two-pane — source beside facts, current
 * beside proposed — and neither survives a phone. Below 1024px the app states
 * that a wider window is required rather than degrading into an unusable single
 * column, which would invite use on a device where the next click fails.
 *
 * Between 1024 and 1280 the panes simply narrow: the layout is fluid, and the
 * desktop gate is a product decision rather than a layout limitation.
 */
import { useEffect, useState, type ReactNode } from "react";

const MINIMUM = 1024;

export function TooNarrow({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? MINIMUM : window.innerWidth,
  );

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (width >= MINIMUM) return <>{children}</>;

  return (
    <div className="min-h-screen grid place-items-center px-20">
      <p className="max-w-measure text-center text-ui text-text-dim">
        Track Record needs a window at least 1280&nbsp;pixels wide. Reviewing facts means reading a
        document beside its facts, and reviewing a document means reading the current version beside
        the proposed one.
      </p>
    </div>
  );
}
