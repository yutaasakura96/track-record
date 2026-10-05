/**
 * The theme: light by default, dark as the author's choice (`docs/05` intro,
 * `docs/10` Shared chrome).
 *
 * It is one attribute on `<html>` and one `localStorage` key, not a column. A
 * theme belongs to a screen in a room, not to the record, and the operating
 * system's preference is deliberately not read: the default is light for
 * everyone until they say otherwise (`docs/06`, 2026-10-05).
 *
 * `index.html` reads the same key before first paint. This store is what the
 * control writes through, and it applies the stored value again on load so the
 * attribute and the store cannot disagree.
 */
import { create } from "zustand";

export type Theme = "light" | "dark";

export const THEME_KEY = "track-record:theme";

/** Storage can be refused outright (a locked-down browser). The theme still works for the visit. */
function stored(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function apply(theme: Theme) {
  // Light is the absence of the attribute, so the default needs nothing set.
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>((set) => {
  const theme = stored();
  apply(theme);
  return {
    theme,
    setTheme: (next) => {
      apply(next);
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        // Not remembered, but applied.
      }
      set({ theme: next });
    },
  };
});
