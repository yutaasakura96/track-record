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
import { useThemeStore } from "~/client/stores/theme";

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
}
// jsdom defines this one only to print "Not implemented" on every navigation.
window.scrollTo = () => {};

// Node now ships a `localStorage` global of its own, and without a file to back
// it that object has no methods; it shadows jsdom's. The theme and the review
// guide are kept there (`src/client/stores/theme.ts`), so the tests get a real
// one, in memory. Defined rather than stubbed: `vi.unstubAllGlobals` below would
// take a stub away after the first test.
const memory = new Map<string, string>();
const storage: Storage = {
  get length() {
    return memory.size;
  },
  clear: () => memory.clear(),
  getItem: (key) => memory.get(key) ?? null,
  key: (index) => [...memory.keys()][index] ?? null,
  removeItem: (key) => void memory.delete(key),
  setItem: (key, value) => void memory.set(key, String(value)),
};
for (const target of [globalThis, window]) {
  Object.defineProperty(target, "localStorage", { value: storage, configurable: true });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // The stores are module singletons. A filter chosen in one test would
  // otherwise decide which cards the next one sees.
  useReviewStore.setState({
    selectedFactId: null,
    selectionOrigin: null,
    filter: "all",
    view: "rendered",
    contentsOpen: true,
  });
  // The theme and the hidden guide are kept per browser; a test that sets one
  // would otherwise hand it to the next.
  useThemeStore.getState().setTheme("light");
  localStorage.clear();
  useDiffStore.setState({ selectedChangeId: null });
});
