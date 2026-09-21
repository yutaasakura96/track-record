/**
 * Runs before every client test file.
 *
 * jsdom lays nothing out, so `Element.scrollTo` does not exist and every
 * `getBoundingClientRect` is zeros. The screens scroll a pane when a selection
 * changes (`src/client/scroll.ts`); here that is a no-op, and where a pane
 * scrolled to is not something these tests claim to check.
 */
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { useDiffStore, useReviewStore } from "~/client/stores/review";

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
}
// jsdom defines this one only to print "Not implemented" on every navigation.
window.scrollTo = () => {};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // The stores are module singletons. A filter chosen in one test would
  // otherwise decide which cards the next one sees.
  useReviewStore.setState({ selectedFactId: null, selectionOrigin: null, filter: "all" });
  useDiffStore.setState({ selectedChangeId: null });
});
