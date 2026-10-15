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
 *
 * Applications is the one exception (issue #75): everything under
 * `/applications`, and nothing else, opens at any width and is laid out for a
 * phone under 720px.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";

const MINIMUM = 1024;

/** Under `/applications`: the screens that work at phone width. */
export const opensOnAPhone = (path: string) => path === "/applications" || path.startsWith("/applications/");

/**
 * Whether the window is wide enough for every screen. Where it is not, a control
 * that leads out of Applications to a screen behind the message is held back.
 */
export function useWideEnough() {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? MINIMUM : window.innerWidth,
  );

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return width >= MINIMUM;
}

export function TooNarrow({ children }: { children: ReactNode }) {
  const wide = useWideEnough();
  const path = useRouterState({ select: (state) => state.location.pathname });

  if (wide || opensOnAPhone(path)) return <>{children}</>;

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
