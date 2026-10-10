/**
 * Which language's documents the author is looking at: English or 日本語
 * (issue #59, `docs/10` Screen 3 and Screen 10).
 *
 * Home's documents and the master document both read it, so choosing 日本語
 * on one is 日本語 on the other. Like the theme, it is one `localStorage` key
 * and not a column: it says which tab is open in this browser, and nothing
 * about the record.
 */
import { create } from "zustand";
import type { MasterLanguage } from "~/shared/master-document";

export type DocumentLanguage = MasterLanguage;

export const DOCUMENT_LANGUAGE_KEY = "track-record:document-language";

/** Storage can be refused outright (a locked-down browser). The tabs still work for the visit. */
function stored(): DocumentLanguage {
  try {
    return localStorage.getItem(DOCUMENT_LANGUAGE_KEY) === "ja" ? "ja" : "en";
  } catch {
    return "en";
  }
}

interface DocumentLanguageState {
  language: DocumentLanguage;
  setLanguage: (language: DocumentLanguage) => void;
}

export const useDocumentLanguageStore = create<DocumentLanguageState>((set) => ({
  language: stored(),
  setLanguage: (next) => {
    try {
      localStorage.setItem(DOCUMENT_LANGUAGE_KEY, next);
    } catch {
      // Not remembered, but shown.
    }
    set({ language: next });
  },
}));
