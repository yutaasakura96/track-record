/**
 * Scroll geometry for the two-pane review screens.
 *
 * **Why rects and not `offsetTop`** (issue #6). `offsetTop` is measured from the
 * element's *offset parent*, which is the nearest positioned ancestor — and if
 * nothing above it is positioned, that is `<body>`. The fact-review pane sits
 * 80px down the page under a 46px header and a 34px label strip, so every
 * measurement was 80px too large and every selection landed 80px too high:
 * 24% from the top of the pane where `docs/10` specifies ~34%.
 *
 * The fix is not to position the pane. Making the pane its own offset parent
 * would work today and would make a scroll calculation silently depend on a
 * `position` declaration in a file that never mentions scrolling — and it would
 * break again the moment any intermediate wrapper gained `position: relative`,
 * because that wrapper would become the offset parent instead. Rects are
 * measured against the viewport and depend on no ancestor at all.
 */

/** `docs/10` §Fact review: the selected passage sits ~34% from the top. */
export const SELECTION_BAND = 0.34;

/** Where `element` currently sits inside `container`, in the container's own scroll coordinates. */
function topWithin(container: HTMLElement, element: HTMLElement): number {
  return container.scrollTop + (element.getBoundingClientRect().top - container.getBoundingClientRect().top);
}

/** Scrolls `container` so `element` sits `band` of the way down it. */
export function scrollToBand(container: HTMLElement, element: HTMLElement, band = SELECTION_BAND): void {
  const top = topWithin(container, element) - container.clientHeight * band;
  container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}

/**
 * The same, but only when `element` is not already fully in view.
 *
 * This is what keeps the rail from fighting the reader. A card they can already
 * see does not move under them; only one they cannot see is brought to the band.
 */
export function revealInBand(container: HTMLElement, element: HTMLElement, band = SELECTION_BAND): void {
  const c = container.getBoundingClientRect();
  const e = element.getBoundingClientRect();
  if (e.top >= c.top && e.bottom <= c.bottom) return;
  scrollToBand(container, element, band);
}
