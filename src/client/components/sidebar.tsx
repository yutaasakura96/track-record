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
import { useApplications, useImportSummary } from "../api";
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
const NAV: { label: string; to: string; counts?: "openCandidates" | "openFlags" | "goneQuiet" }[] = [
  { label: "Home", to: "/" },
  { label: "Record", to: "/record" },
  { label: "Skills", to: "/skills" },
  { label: "Documents", to: "/documents", counts: "openCandidates" },
  // Issue #57: what the importer flagged, and everything it accepted.
  { label: "Flagged", to: "/flagged", counts: "openFlags" },
  { label: "Master document", to: "/master" },
  // Issue #70: the jobs applied for. It took the Tailored résumés row, and
  // each of those résumés is inside its application.
  { label: "Applications", to: "/applications", counts: "goneQuiet" },
];

/**
 * `1,085 facts to sort`: the count with its unit, so it cannot be read as
 * documents. These are the facts from before the importer accepted on its own;
 * a record imported since has none.
 */
const COUNT_LABEL = {
  openCandidates: (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "fact" : "facts"} to sort`,
  openFlags: (n: number) => `${n.toLocaleString("en-US")} to check`,
  goneQuiet: (n: number) => `${n.toLocaleString("en-US")} gone quiet`,
} as const;

export function Sidebar({ name }: { name: string }) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  // Waiting facts across every version of every document, and flags not yet
  // checked; each shown only above zero. Read from the summary, not the
  // listing: the badges are two numbers and this is the only query the chrome
  // makes on Home, Record and Skills.
  const summary = useImportSummary().data;
  // Read where the list reads it, so the row and the list cannot disagree.
  const goneQuiet = useApplications().data?.items.filter((row) => row.quietDays !== null).length;
  const counts = { ...summary, goneQuiet };

  return (
    <nav className="w-sidebar shrink-0 bg-surface border-r border-border flex flex-col">
      <div className="h-header flex items-center gap-8 px-10 border-b border-border">
        <span className="app-mark size-16 rounded-chip shrink-0" aria-hidden />
        <span className="text-panel font-semibold tracking-snug text-text">Track Record</span>
      </div>

      <ul className="p-10 grid gap-2">
        {NAV.map((item) => {
          // An application's own page and Add a job are under Applications.
          const active = path === item.to || (item.to !== "/" && path.startsWith(`${item.to}/`));
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
                {item.counts && (counts[item.counts] ?? 0) > 0 ? (
                  <span
                    className={`block text-small font-normal ${
                      // Amber is for what is held back. A flag is advice.
                      item.counts === "openCandidates" ? "text-generated-text" : "text-text-muted"
                    }`}
                  >
                    {COUNT_LABEL[item.counts](counts[item.counts]!)}
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
        <ThemeControl />
      </div>
    </nav>
  );
}

/** Light by default, dark as the author's choice, kept for this browser (`docs/05`). */
function ThemeControl() {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  return (
    <SegmentedControl<Theme>
      label="Theme"
      value={theme}
      onChange={setTheme}
      segments={[
        { value: "light", label: "Light", tone: "neutral" },
        { value: "dark", label: "Dark", tone: "neutral" },
      ]}
    />
  );
}

/**
 * The sidebar at phone width, under Applications only (`docs/10` Responsive
 * behaviour, issue #75): a sheet under the header, opened by `Menu`.
 * Applications leads because it is the part that works on a phone; the other
 * rows still go where they go, and say so before they are followed.
 */
export function MenuSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const rows = [...NAV.filter((item) => item.to === "/applications"), ...NAV.filter((item) => item.to !== "/applications")];
  return (
    <nav
      id={id}
      aria-label="Menu"
      className="phone:hidden absolute inset-x-0 top-header bottom-0 z-10 bg-surface flex flex-col overflow-y-auto"
    >
      <ul className="p-10 grid gap-2">
        {rows.map((item) => {
          const active = item.to === "/applications";
          return (
            <li key={item.label}>
              <Link
                to={item.to}
                onClick={onClose}
                aria-current={active ? "page" : undefined}
                className={`block px-10 py-6 rounded-control text-row ${
                  active ? "bg-hover text-text font-medium" : "text-text-muted hover:bg-hover"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="px-20 text-small text-text-muted">
        On a phone, Applications is the part that works. The other screens still ask for a wider window.
      </p>
      <div className="mt-auto p-10 border-t border-border">
        <ThemeControl />
      </div>
    </nav>
  );
}
