/**
 * The small component kit, styled from `docs/05-design-system.md`.
 *
 * Two rules the document makes structural and this file makes visible:
 * **a disabled control always states why**, and **green, amber and red are
 * never decorative** — they mean Measured/added, Generated/blocked, and removed.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "bare";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-text-bright px-12 py-6 rounded-control text-micro font-medium hover:brightness-110",
  secondary:
    "border border-border-strong text-text-secondary px-14 py-8 rounded-control text-micro font-medium hover:bg-hover",
  ghost:
    "border border-border-strong text-text-muted px-10 py-6 rounded-control text-smaller font-medium hover:bg-hover hover:text-text-secondary",
  bare: "text-text-dim px-6 py-4 rounded-chip text-smaller hover:bg-border hover:text-text-secondary",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /**
   * Why the control is disabled. REQUIRED whenever `disabled` is set — a
   * disabled control without a stated reason is not permitted (`docs/05` §6).
   */
  disabledReason?: string;
}

export function Button({
  variant = "secondary",
  disabled,
  disabledReason,
  className = "",
  children,
  ...rest
}: ButtonProps) {
  if (disabled && !disabledReason) {
    throw new Error("A disabled control must state why it is disabled (docs/05 §6).");
  }
  const base = "motion-surface whitespace-nowrap";
  const off = "bg-disabled-bg text-text-faint border border-border-control";
  return (
    <button
      {...rest}
      disabled={disabled}
      title={disabled ? disabledReason : rest.title}
      className={`${base} ${disabled ? `${off} px-12 py-6 rounded-control text-micro font-medium` : VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

/** Mono is for machine facts only — line references, counts, filenames, ids. */
export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`font-mono text-mono-label tracking-mono uppercase ${className}`}>
      {children}
    </span>
  );
}

export function Chip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center bg-chip border border-border-control rounded-chip px-6 py-2 font-mono text-micro text-text-dim ${className}`}
    >
      {children}
    </span>
  );
}

export interface Segment<T extends string> {
  value: T;
  label: string;
  /** The semantic tone of THIS value, not of the control. */
  tone: "measured" | "accent" | "generated" | "restricted" | "private";
}

const TONES: Record<Segment<string>["tone"], string> = {
  measured: "bg-add-idle text-measured-text",
  accent: "bg-mark-selected text-accent-text",
  generated: "bg-generated-mark text-generated-text",
  restricted: "bg-restricted-bg text-restricted",
  private: "bg-private-bg text-private",
};

export function SegmentedControl<T extends string>({
  label,
  value,
  segments,
  onChange,
}: {
  label: string;
  value: T;
  segments: Segment<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-8">
      <span className="text-mono-label font-mono uppercase tracking-mono text-text-faint w-60 shrink-0">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex gap-2 p-2 bg-surface-raised border border-border-control rounded-control"
      >
        {segments.map((segment) => {
          const active = segment.value === value;
          return (
            <button
              key={segment.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(segment.value)}
              className={`px-8 py-4 rounded-chip text-micro font-medium motion-tone ${
                active
                  ? `${TONES[segment.tone]} shadow-ring`
                  : "text-text-dim hover:text-text-secondary"
              }`}
            >
              {segment.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={`h-4 bg-progress-track rounded-mark overflow-hidden ${className}`}>
      <div
        className="h-full bg-accent motion-progress"
        style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
      />
    </div>
  );
}

export function Panel({
  heading,
  action,
  children,
  className = "",
}: {
  heading?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`bg-surface-raised border border-border rounded-panel px-16 py-14 ${className}`}
    >
      {(heading || action) && (
        <header className="flex items-center justify-between mb-12">
          {heading && (
            <h2 className="text-panel font-semibold tracking-snug text-text-strong">{heading}</h2>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-8 py-4 rounded-control text-smaller motion-tone border ${
        active
          ? "bg-hover border-border-active text-text-secondary"
          : "border-transparent text-text-dim hover:text-text-secondary"
      }`}
    >
      {children}
    </button>
  );
}

export function Dot({ tone }: { tone: "measured" | "accent" | "generated" | "removed" | "muted" }) {
  const colors = {
    measured: "bg-measured",
    accent: "bg-accent",
    generated: "bg-generated",
    removed: "bg-removed",
    muted: "bg-text-ghost",
  } as const;
  return <span className={`inline-block size-6 rounded-full ${colors[tone]}`} aria-hidden />;
}

export function Notice({ tone, children }: { tone: "generated" | "neutral"; children: ReactNode }) {
  const styles =
    tone === "generated"
      ? "bg-generated-mark border-generated-rule text-generated-text"
      : "bg-surface-raised border-border-control text-text-dim";
  return (
    <p className={`border rounded-control px-10 py-8 text-smaller ${styles}`}>{children}</p>
  );
}

export function Spinner({ label }: { label: string }) {
  // Nothing animates on load, and no spinner outlives the work it represents:
  // this is a text status, not a decoration (`docs/05` §8).
  return <p className="text-smaller text-text-dim">{label}</p>;
}
