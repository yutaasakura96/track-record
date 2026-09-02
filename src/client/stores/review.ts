/**
 * UI state, and UI state only — selection, filters, the highlighted change.
 * Server data lives in TanStack Query and never here
 * (`docs/03-technical-design.md` §1).
 */
import { create } from "zustand";

export type FactFilter = "all" | "open" | "resolved";

/**
 * Which half a selection came from. Part of the selection, not a detail of it
 * (issue #6): `docs/10` asks each half to follow the *other* — "clicking a mark
 * selects its card and scrolls the rail to it. Selecting a card scrolls the
 * document" — and scrolling the half you just clicked in yanks the text or the
 * button out from under the pointer. The originating half holds still.
 *
 * `null` means neither half asked — a keyboard jump, or a programmatic select —
 * and both follow.
 */
export type SelectionOrigin = "document" | "rail";

interface ReviewState {
  selectedFactId: string | null;
  selectionOrigin: SelectionOrigin | null;
  filter: FactFilter;
  select: (id: string | null, origin?: SelectionOrigin | null) => void;
  setFilter: (filter: FactFilter) => void;
}

export const useReviewStore = create<ReviewState>((set) => ({
  selectedFactId: null,
  selectionOrigin: null,
  filter: "all",
  select: (selectedFactId, selectionOrigin = null) => set({ selectedFactId, selectionOrigin }),
  setFilter: (filter) => set({ filter }),
}));

interface DiffState {
  selectedChangeId: string | null;
  select: (id: string | null) => void;
}

export const useDiffStore = create<DiffState>((set) => ({
  selectedChangeId: null,
  select: (selectedChangeId) => set({ selectedChangeId }),
}));
