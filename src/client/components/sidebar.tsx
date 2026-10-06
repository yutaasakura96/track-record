/**
 * Shared chrome — the sidebar (`docs/10-screen-specifications.md`).
 *
 * The footer carries the literal label `Personal record`: the single-user
 * posture, stated in the interface rather than only in the docs.
 *
 * The fact-review and diff-review screens REPLACE this with a breadcrumb in the
 * header. They are focused, full-width tasks, not navigation destinations.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import { useImportSummary } from "../api";
import { useThemeStore, type Theme } from "../stores/theme";
import { Mono, SegmentedControl } from "./ui";

/**
 * A destination that is not built has no row (`docs/10`, Shared chrome). `Facts`
 * stood here disabled, with its reason in a tooltip, so the shape of the
 * application was legible; it was read as a broken link (issue #58). Before
 * that it navigated to Home while reading as Facts, which marked three rows
 * active at once (issue #10).
 *
 * A row earns its place when its route exists. `to` is what makes it navigable
 * and what makes exactly one row active, so the two cannot drift apart.
 */
const NAV: { label: string; to: string; counts?: "openCandidates" }[] = [
  { label: "Home", to: "/" },
  { label: "Record", to: "/record" },
  { label: "Skills", to: "/skills" },
  { label: "Documents", to: "/documents", counts: "openCandidates" },
];

/** `1,085 facts to review`: the count with its unit, so it cannot be read as documents. */
const toReview = (openCandidates: number) =>
  `${openCandidates.toLocaleString("en-US")} ${openCandidates === 1 ? "fact" : "facts"} to review`;

export function Sidebar({ name }: { name: string }) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  // Open candidates across every version of every document, shown only above zero.
  // Read from the summary, not the listing: the badge is one number and this is
  // the only query the chrome makes on Home, Record and Skills.
  const openCandidates = useImportSummary().data?.openCandidates ?? 0;
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  return (
    <nav className="w-sidebar shrink-0 bg-surface border-r border-border flex flex-col">
      <div className="h-header flex items-center gap-8 px-10 border-b border-border">
        <span className="app-mark size-16 rounded-chip shrink-0" aria-hidden />
        <span className="text-panel font-semibold tracking-snug text-text">Track Record</span>
      </div>

      <ul className="p-10 grid gap-2">
        {NAV.map((item) => {
          const active = path === item.to;
          return (
            <li key={item.label}>
              <Link
                to={item.to}
                className={`block px-10 py-6 rounded-control text-row ${
                  active ? "bg-hover text-text font-medium" : "text-text-muted hover:bg-hover"
                }`}
              >
                {item.label}
                {/* On a line of its own and in words: a bare number beside
                    `Documents` read as a number of documents (issue #58). */}
                {item.counts && openCandidates > 0 ? (
                  <span className="block text-small font-normal text-generated-text">
                    {toReview(openCandidates)}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto p-10 border-t border-border grid gap-10">
        <div className="flex items-center gap-8">
          <span className="size-avatar rounded-full bg-chip shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="block text-smaller text-text-secondary truncate">{name || "—"}</span>
            <Mono className="block text-text-muted">Personal record</Mono>
          </span>
        </div>
        {/* Light by default, dark as the author's choice, kept for this browser (`docs/05`). */}
        <SegmentedControl<Theme>
          label="Theme"
          value={theme}
          onChange={setTheme}
          segments={[
            { value: "light", label: "Light", tone: "neutral" },
            { value: "dark", label: "Dark", tone: "neutral" },
          ]}
        />
      </div>
    </nav>
  );
}
