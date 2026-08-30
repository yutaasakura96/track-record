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

const NAV: { label: string; to: string }[] = [
  { label: "Home", to: "/" },
  { label: "Facts", to: "/" },
  { label: "Documents", to: "/" },
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
          const active = path === item.to;
          return (
            <li key={item.label}>
              <Link
                to={item.to}
                className={`flex items-center px-10 py-6 rounded-control text-row ${
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
