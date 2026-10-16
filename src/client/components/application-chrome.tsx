/**
 * What the three Applications screens share (`docs/10`, Applications; issue
 * #70): the frame, which Quick capture shares too (issue #95), the status line, the gone-quiet mark and the fields of a
 * job.
 *
 * No status carries green, amber or red. Those mean verified, not usable yet
 * and removed (`docs/05` §9), and an application is none of them: the step it
 * is at is the accent, and one not started or closed is grey.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useProfile, type ApplicationFields } from "../api";
import { useFlashStore } from "../stores/flash";
import { STATUS_LABEL, statusOf, type Standing } from "~/shared/application";
import { MenuSheet, Sidebar } from "./sidebar";
import { Button, Dot } from "./ui";

export const CONTROL =
  "min-h-control w-full bg-surface-raised border border-border-control rounded-control px-10 py-8 text-ui text-text-strong outline-none focus:shadow-ring focus:border-border-active";
/** A control standing in a line of text: a date being corrected, the step picker. */
export const CONTROL_INLINE =
  "min-h-control-inline bg-surface-raised border border-border-control rounded-control px-6 py-2 text-small text-text-strong outline-none focus:shadow-ring focus:border-border-active";

export const POSTING_LINK_LABEL = "Link to the posting, if you have one";

export const days = (n: number) => (n === 1 ? "1 day" : `${n.toLocaleString("en-US")} days`);

export function ApplicationsFrame({
  title,
  crumb = false,
  note,
  action,
  children,
}: {
  title: string;
  /** Under Applications rather than Applications itself: the header leads back to the list. */
  crumb?: boolean;
  note?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PhoneFrame title={title} back={crumb ? { to: "/applications", label: "Applications" } : undefined} note={note} action={action}>
      {children}
    </PhoneFrame>
  );
}

/**
 * The frame of a screen that works at phone width: Applications (issue #75)
 * and Quick capture (issue #95). Under 720px the sidebar is a sheet under the
 * header, opened by `Menu` (`docs/10`, Responsive behaviour).
 */
export function PhoneFrame({
  title,
  back,
  note,
  action,
  children,
}: {
  title: string;
  /** Where the header leads back to, before the title. */
  back?: { to: "/applications" | "/"; label: string };
  note?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const profile = useProfile();
  const flash = useFlashStore((state) => state.text);
  const [menu, setMenu] = useState(false);
  const sheet = useId();
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenu(false);
      toggle.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  return (
    <div className="h-screen flex">
      <div className="max-phone:hidden flex">
        <Sidebar name={profile.data?.nameLatin ?? ""} />
      </div>
      <div className="relative flex-1 min-w-0 flex flex-col">
        <header className="h-header shrink-0 flex items-center gap-12 px-20 max-phone:gap-8 max-phone:px-12 bg-surface border-b border-border">
          <Button
            ref={toggle}
            variant="ghost"
            aria-expanded={menu}
            aria-controls={menu ? sheet : undefined}
            onClick={() => setMenu(!menu)}
            className="phone:hidden shrink-0"
          >
            Menu
          </Button>
          <h1 className="min-w-0 truncate text-panel font-semibold tracking-snug text-text-strong">
            {back ? (
              <>
                <Link to={back.to} className="text-accent-link hover:text-accent-link-hover motion-tone">
                  {back.label}
                </Link>{" "}
                <span className="font-normal text-text-dim">/</span>{" "}
              </>
            ) : null}
            {title}
          </h1>
          {note ? <span className="max-phone:hidden min-w-0 truncate text-smaller text-text-dimmer">{note}</span> : null}
          {action ? <span className="ml-auto shrink-0 flex gap-8">{action}</span> : null}
        </header>
        {menu ? <MenuSheet id={sheet} onClose={() => setMenu(false)} /> : null}

        <div className="flex-1 overflow-y-auto px-20 py-26 max-phone:px-12 max-phone:py-16">
          <div className="mx-auto w-content max-w-full grid grid-cols-1 gap-20 max-phone:gap-16">{children}</div>
        </div>
      </div>
      {flash ? (
        <p
          role="status"
          className="fixed bottom-14 left-1/2 -translate-x-1/2 z-10 max-w-full bg-text-bright text-bg rounded-control px-12 py-8 text-small"
        >
          {flash}
        </p>
      ) : null}
    </div>
  );
}

/** The step an application is at, or how it closed. */
export function StatusLine({ standing }: { standing: Pick<Standing, "step" | "closedAs"> }) {
  const idle = standing.closedAs !== null || standing.step === "not_applied";
  return (
    <span
      className={`inline-flex items-center gap-6 text-small whitespace-nowrap ${idle ? "text-text-muted" : "text-accent-text"}`}
    >
      <Dot tone={idle ? "muted" : "accent"} />
      {STATUS_LABEL[statusOf(standing)]}
    </span>
  );
}

/** Nothing has changed for fourteen days while waiting to hear back. */
export function QuietChip({ quietDays }: { quietDays: number }) {
  return (
    <span className="inline-flex items-center bg-chip border border-border-active rounded-chip px-6 py-2 font-mono text-micro font-medium text-text-strong whitespace-nowrap">
      Gone quiet · {days(quietDays)}
    </span>
  );
}

/**
 * The fields of a job that stay correctable after it is added.
 *
 * `read` is Add a job's check step: the fields hold what was read from the
 * posting, an empty one says it was not found, and the link is not asked for
 * again because it was given with the text.
 */
export function JobFields({
  value,
  onChange,
  read = false,
}: {
  value: ApplicationFields;
  onChange: (next: ApplicationFields) => void;
  read?: boolean;
}) {
  const notFound = read ? "Not found in the text. Type it in." : undefined;
  const setRequirement = (index: number, text: string) =>
    onChange({ ...value, requirements: value.requirements.map((item, i) => (i === index ? text : item)) });

  return (
    <>
      <div className="grid grid-cols-2 max-phone:grid-cols-1 gap-12">
        <label className="grid gap-4 min-w-0">
          <span className="text-small text-text-secondary">Company</span>
          <input
            name="company"
            value={value.company}
            maxLength={200}
            placeholder={notFound}
            onChange={(event) => onChange({ ...value, company: event.target.value })}
            className={CONTROL}
          />
        </label>
        <label className="grid gap-4 min-w-0">
          <span className="text-small text-text-secondary">Position</span>
          <input
            name="position"
            value={value.position}
            maxLength={200}
            placeholder={notFound}
            onChange={(event) => onChange({ ...value, position: event.target.value })}
            className={CONTROL}
          />
        </label>
      </div>
      {read ? null : (
        <label className="grid gap-4 min-w-0">
          <span className="text-small text-text-secondary">{POSTING_LINK_LABEL}</span>
          <input
            name="postingUrl"
            type="url"
            inputMode="url"
            placeholder="https://"
            value={value.postingUrl ?? ""}
            onChange={(event) => onChange({ ...value, postingUrl: event.target.value })}
            className={CONTROL}
          />
        </label>
      )}
      <div className="grid gap-4 min-w-0">
        <span className="text-small text-text-secondary">Key requirements</span>
        <div className="grid gap-6">
          {value.requirements.map((requirement, index) => (
            // Keyed by place: a requirement has no identity but its position in the list.
            <div key={index} className="flex items-center gap-6">
              <input
                aria-label={`Requirement ${index + 1}`}
                value={requirement}
                maxLength={300}
                onChange={(event) => setRequirement(index, event.target.value)}
                className={CONTROL}
              />
              <Button
                type="button"
                variant="bare"
                onClick={() =>
                  onChange({ ...value, requirements: value.requirements.filter((_, i) => i !== index) })
                }
              >
                Remove
              </Button>
            </div>
          ))}
          {value.requirements.length === 0 ? (
            <p className="text-small text-text-muted">
              {read ? "None found." : "None noted."} Add the ones that matter to you, or leave this empty.
            </p>
          ) : null}
        </div>
        <div>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onChange({ ...value, requirements: [...value.requirements, ""] })}
          >
            Add a requirement
          </Button>
        </div>
      </div>
    </>
  );
}
