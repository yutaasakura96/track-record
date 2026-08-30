/**
 * UI state, and UI state only — selection, filters, the highlighted change.
 * Server data lives in TanStack Query and never here
 * (`docs/03-technical-design.md` §1).
 */
import { create } from "zustand";

export type FactFilter = "all" | "open" | "resolved";

interface ReviewState {
  selectedFactId: string | null;
  filter: FactFilter;
  select: (id: string | null) => void;
  setFilter: (filter: FactFilter) => void;
}

export const useReviewStore = create<ReviewState>((set) => ({
  selectedFactId: null,
  filter: "all",
  select: (selectedFactId) => set({ selectedFactId }),
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
