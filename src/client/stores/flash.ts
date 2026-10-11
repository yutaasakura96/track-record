/**
 * The line that confirms a change just made on an Applications screen:
 * `Saved as Not applied.`, `Undone.` (`docs/10`, Applications).
 *
 * A store rather than a screen's own state, because the first one is said on
 * the screen after the one that caused it: a job is saved on Add a job and the
 * line is read on its application. It clears itself.
 */
import { create } from "zustand";

/** Long enough to read one sentence, and gone before the next change. */
const SHOWN_MS = 4200;

interface FlashState {
  text: string | null;
  show: (text: string) => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export const useFlashStore = create<FlashState>((set) => ({
  text: null,
  show: (text) => {
    clearTimeout(timer);
    set({ text });
    timer = setTimeout(() => set({ text: null }), SHOWN_MS);
  },
}));
