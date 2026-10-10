/**
 * The two tabs that separate the English documents from the 日本語 ones
 * (issue #59, `docs/10` Screen 3 and Screen 10).
 *
 * A WAI-ARIA tab list: one tab stop, arrow keys inside it, and the panel under
 * it named by its tab. Selection follows focus, as `SegmentedControl` does and
 * for the same reason: nothing here is slow enough to want a second keystroke.
 *
 * The choice is kept in `stores/document-language.ts`, so the tab open on Home
 * is the tab open on the master document.
 */
import type { KeyboardEvent, ReactNode } from "react";
import { useDocumentLanguageStore, type DocumentLanguage } from "../stores/document-language";

/** Each tab in its own language, which is how a reader of it would look for it. */
const TABS: { value: DocumentLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
];

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

const tabId = (name: string, language: DocumentLanguage) => `${name}-tab-${language}`;
const panelId = (name: string) => `${name}-panel`;

export function LanguageTabs({
  name,
  label,
}: {
  /** Unique on the screen: it ties the tabs to their panel. */
  name: string;
  /** What the tabs choose between, for a reader who cannot see them. */
  label: string;
}) {
  const language = useDocumentLanguageStore((state) => state.language);
  const setLanguage = useDocumentLanguageStore((state) => state.setLanguage);

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = TABS.findIndex((tab) => tab.value === language);
    const next =
      event.key in STEP
        ? (current + STEP[event.key]! + TABS.length) % TABS.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? TABS.length - 1
            : null;
    if (next === null) return;
    event.preventDefault();
    setLanguage(TABS[next]!.value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={move}
      className="inline-flex gap-2 p-2 bg-surface-raised border border-border-control rounded-control"
    >
      {TABS.map((tab) => {
        const active = tab.value === language;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={tabId(name, tab.value)}
            aria-selected={active}
            aria-controls={panelId(name)}
            tabIndex={active ? 0 : -1}
            onClick={() => setLanguage(tab.value)}
            className={`px-12 py-6 rounded-chip text-row font-medium motion-tone ${
              active ? "bg-hover text-text-strong shadow-ring" : "text-text-muted hover:text-text-secondary"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/** What the chosen tab shows. It is one panel, relabelled, because only one language is ever drawn. */
export function LanguagePanel({ name, className, children }: { name: string; className?: string; children: ReactNode }) {
  const language = useDocumentLanguageStore((state) => state.language);
  return (
    <div role="tabpanel" id={panelId(name)} aria-labelledby={tabId(name, language)} className={className}>
      {children}
    </div>
  );
}
