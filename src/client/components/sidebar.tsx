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
import { Mono } from "./ui";

/**
 * `docs/10` specifies five rows; M1 builds one destination. The other rows stay
 * visible so the shape of the application is legible, but they are DISABLED and
 * they say why (`docs/05` §6) — a row that navigates to Home while reading as
 * Facts is a lie about where it goes, and an active test of `path === to` with
 * every `to` set to "/" marked all three rows active at once (issue #10).
 *
 * A row earns a `to` when its route exists. `to` is what makes it navigable and
 * what makes exactly one row active, so the two cannot drift apart.
 */
const NAV: ({ label: string } & ({ to: string } | { unbuilt: string }))[] = [
  { label: "Home", to: "/" },
  { label: "Facts", unbuilt: "Browsing facts outside an import is not built yet." },
  { label: "Documents", unbuilt: "Browsing source documents is not built yet." },
];

export function Sidebar({ name }: { name: string }) {
  const path = useRouterState({ select: (state) => state.location.pathname });

  return (
    <nav className="w-sidebar shrink-0 bg-surface border-r border-border flex flex-col">
      <div className="h-header flex items-center gap-8 px-10 border-b border-border">
        <span className="app-mark size-16 rounded-chip shrink-0" aria-hidden />
        <span className="text-panel font-semibold tracking-snug text-text">Track Record</span>
      </div>

      <ul className="p-10 grid gap-2">
        {NAV.map((item) => {
          const row = "flex items-center px-10 py-6 rounded-control text-row";
          if (!("to" in item)) {
            return (
              <li key={item.label}>
                <span
                  aria-disabled="true"
                  title={item.unbuilt}
                  className={`${row} text-text-ghost cursor-not-allowed`}
                >
                  {item.label}
                </span>
              </li>
            );
          }
          const active = path === item.to;
          return (
            <li key={item.label}>
              <Link
                to={item.to}
                className={`${row} ${
                  active ? "bg-hover text-text font-medium" : "text-text-dim hover:bg-hover"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto p-10 border-t border-border flex items-center gap-8">
        <span className="size-avatar rounded-full bg-chip shrink-0" aria-hidden />
        <span className="min-w-0">
          <span className="block text-smaller text-text-secondary truncate">{name || "—"}</span>
          <Mono className="block text-text-faint">Personal record</Mono>
        </span>
      </div>
    </nav>
  );
}
