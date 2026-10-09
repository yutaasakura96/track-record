/**
 * UI state, and UI state only — selection, filters, the highlighted change.
 * Server data lives in TanStack Query and never here
 * (`docs/03-technical-design.md` §1).
 */
import { create } from "zustand";

/**
 * `regrade`: accepted facts whose provenance nobody chose (issue #37).
 * `flagged`: facts with a flag not yet marked checked (issue #57).
 */
export type FactFilter = "all" | "open" | "resolved" | "regrade" | "flagged";

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

/**
 * How the source pane shows a Markdown document (`docs/10` Screen 1).
 * `rendered` reads as a document; `source` is the stored characters a quote is
 * verified against. It lasts while the app is open and is not stored.
 */
export type SourceView = "rendered" | "source";

interface ReviewState {
  selectedFactId: string | null;
  selectionOrigin: SelectionOrigin | null;
  filter: FactFilter;
  view: SourceView;
  contentsOpen: boolean;
  select: (id: string | null, origin?: SelectionOrigin | null) => void;
  setFilter: (filter: FactFilter) => void;
  setView: (view: SourceView) => void;
  setContentsOpen: (open: boolean) => void;
}

export const useReviewStore = create<ReviewState>((set) => ({
  selectedFactId: null,
  selectionOrigin: null,
  filter: "all",
  view: "rendered",
  contentsOpen: true,
  select: (selectedFactId, selectionOrigin = null) => set({ selectedFactId, selectionOrigin }),
  setFilter: (filter) => set({ filter }),
  setView: (view) => set({ view }),
  setContentsOpen: (contentsOpen) => set({ contentsOpen }),
}));

interface DiffState {
  selectedChangeId: string | null;
  select: (id: string | null) => void;
}

export const useDiffStore = create<DiffState>((set) => ({
  selectedChangeId: null,
  select: (selectedChangeId) => set({ selectedChangeId }),
}));
