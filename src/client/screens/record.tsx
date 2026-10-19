/**
 * Screen 4 — Career timeline (S7 and S13, `docs/10-screen-specifications.md`).
 *
 * The five hand-entered entity types: employers, roles, projects, education and
 * certifications. **Each is a plain form.** No document import, no fact
 * extraction, no diff review — these are entered, not derived, and saving is
 * immediate (S7's acceptance criteria, and issue #14's first decision).
 *
 * Why hand-entered rather than extracted: one career has a handful of employers
 * and that number does not grow, while facts arrive in hundreds per import.
 * Automate what scales; type in what does not. These forms were a `MUST` for M2
 * regardless, so entering the entities here costs nothing extra and carries no
 * extraction risk.
 *
 * Laid out as a timeline rather than five lists (issue #113): a role and a
 * project are read inside the employer they belong to, beside how long the job
 * lasted and how many achievements back it. Per-render inclusion is one line
 * per entry naming only the exceptions, with the boxes behind it.
 *
 * Calendar fields collect MONTH AND YEAR ONLY. The day is pinned to `01` and is
 * never displayed (`docs/04-database-schema.md` §0).
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ApiError,
  failureText,
  useCareerTimeline,
  useEntities,
  useEntityActions,
  useProfile,
  useRenderInclusions,
  useSetRenderInclusion,
  type Certification,
  type Education,
  type Employer,
  type EntityKey,
  type IncludableEntity,
  type Profile,
  type Project,
  type Role,
} from "../api";
import { Button, Chip, Mono, Panel } from "../components/ui";
import { Sidebar } from "../components/sidebar";
import { ScreenIntro } from "../components/screen-intro";
import { currentMonth, fromMonth, toMonth } from "~/shared/calendar";
import { RENDER_KINDS, RENDER_TITLE } from "~/shared/render-content";
import {
  duration,
  expiry,
  gapPosition,
  gapText,
  inclusionSummary,
  type CareerTimeline,
  type TimelineGap,
} from "~/shared/career-timeline";

/* ------------------------------------------------------------------ fields */

interface FieldSpec {
  name: string;
  label: string;
  hint?: string;
  type?: "text" | "month" | "number" | "select" | "checkbox" | "textarea" | "url" | "list";
  options?: { value: string; label: string }[];
  /** Options come from a collection loaded on this screen, not from a constant. */
  optionsFrom?: "employers";
  /**
   * A required select that must not answer for the user. Without it the browser
   * — and React, which selects the first option when the value matches none —
   * answers with whichever option happens to be first, and a row saved without
   * the field ever being touched carries a value nobody chose.
   */
  unset?: string;
  optional?: boolean;
  /** Spans both columns. For prose and for a control with a long label. */
  wide?: boolean;
}

const EMPLOYMENT_TYPES = [
  { value: "full_time", label: "正社員 · Full time" },
  { value: "contract", label: "契約社員 · Contract" },
  { value: "dispatch", label: "派遣 · Dispatch" },
  { value: "part_time", label: "アルバイト · Part time" },
  { value: "independent", label: "個人事業主 · Independent" },
];

/** The employment type as the card's meta line reads it, English only. */
const EMPLOYMENT_SHORT: Record<Employer["employmentType"], string> = {
  full_time: "Full time",
  contract: "Contract",
  dispatch: "Dispatch",
  part_time: "Part time",
  independent: "Independent",
};

/**
 * The rung, stage-neutral rather than 中学校/高校 — most of this record's
 * schooling is not Japanese. The English résumé drops the two secondary rungs;
 * the 履歴書 prints them all (`docs/06`, 2026-09-06).
 */
const LEVELS = [
  { value: "secondary_lower", label: "中学校 · Lower secondary" },
  { value: "secondary_upper", label: "高校 · Upper secondary" },
  { value: "vocational", label: "専門・非学位 · Vocational, non-degree" },
  { value: "tertiary", label: "大学 · University" },
  { value: "postgraduate", label: "大学院 · Postgraduate" },
];

/** The rungs the English résumé leaves out, whatever the inclusion setting says. */
const SECONDARY = new Set<Education["level"]>(["secondary_lower", "secondary_upper"]);

/** A required select's first entry on a new row: the author answers it, the first option does not. */
const UNCHOSEN = "— 未選択 · Choose one —";

const OUTCOMES = [
  { value: "graduated", label: "卒業 · Graduated" },
  { value: "completed", label: "修了 · Completed" },
  { value: "withdrawn", label: "中退 · Withdrawn" },
  { value: "expected", label: "卒業見込 · Expected" },
];

/* ---------------------------------------------------------------- sections */

/** One collection's form: what it asks, and the guidance shown above it. */
interface Section {
  key: EntityKey;
  singular: string;
  blurb: string;
  fields: FieldSpec[];
}

/** `2022-04-01`, `null` → `2022-04 – present`. The day is never shown. */
const span = (startedOn: string | null, endedOn: string | null) => {
  if (!startedOn) return endedOn ? `until ${toMonth(endedOn)}` : "no dates";
  return `${toMonth(startedOn)} – ${endedOn ? toMonth(endedOn) : "present"}`;
};

/** Newest first, and a row with no start after every row with one. */
const newestFirst = (a: { startedOn: string | null }, b: { startedOn: string | null }) =>
  (b.startedOn ?? "").localeCompare(a.startedOn ?? "");

const count = (n: number, noun: string) => `${n} ${n === 1 ? noun : `${noun}s`}`;

const EMPLOYERS: Section = {
  key: "employers",
  singular: "employer",
  blurb:
    "One row per employer. Every document's employment sections and their dates are built from these rows — not from the wording of your facts.",
  fields: [
    { name: "nameJa", label: "会社名 · Employer name" },
    {
      name: "nameLatin",
      label: "Name in Latin script",
      optional: true,
      hint: "Used on the English résumé. Falls back to 会社名.",
    },
    {
      name: "employmentType",
      label: "雇用形態 · Employment type",
      type: "select",
      options: EMPLOYMENT_TYPES,
      unset: UNCHOSEN,
    },
    { name: "industryJa", label: "業種 · Industry", optional: true },
    { name: "startedOn", label: "入社 · Started", type: "month" },
    {
      name: "endedOn",
      label: "退職 · Ended",
      type: "month",
      optional: true,
      hint: "Leave empty if this is where you work now.",
    },
    { name: "capitalYen", label: "資本金 · Capital", type: "number", optional: true, hint: "In yen, not 万円." },
    { name: "headcount", label: "従業員数 · Headcount", type: "number", optional: true },
    {
      name: "businessDescription",
      label: "事業内容 · Business description",
      type: "textarea",
      optional: true,
      wide: true,
      hint: "One paragraph. The 職務経歴書 opens each employer with it.",
    },
    { name: "leavingReasonJa", label: "退職理由 · Reason for leaving", optional: true, wide: true },
  ],
};

const ROLES: Section = {
  key: "roles",
  singular: "role",
  blurb:
    "The titles you held, and when. A promotion is a second role, not an edit to the first — both are true and both belong in the record.",
  fields: [
    { name: "employerId", label: "Employer", type: "select", optionsFrom: "employers", unset: UNCHOSEN },
    { name: "titleLatin", label: "Title", optional: true, hint: "As it should read in English." },
    { name: "titleJa", label: "役職 · Title (Japanese)", optional: true },
    { name: "shokushuJa", label: "職種 · Occupation", optional: true },
    { name: "startedOn", label: "Started", type: "month" },
    { name: "endedOn", label: "Ended", type: "month", optional: true, hint: "Leave empty if you hold it now." },
  ],
};

const PROJECTS: Section = {
  key: "projects",
  singular: "project",
  blurb:
    "A project with no employer is an independent one, and the English résumé gives those their own section.",
  fields: [
    { name: "name", label: "Project name" },
    { name: "nameJa", label: "案件名 · Project name (Japanese)", optional: true },
    {
      name: "employerId",
      label: "Employer",
      type: "select",
      optionsFrom: "employers",
      optional: true,
      hint: "Leave unset for an independent project.",
    },
    { name: "startedOn", label: "Started", type: "month", optional: true },
    { name: "endedOn", label: "Ended", type: "month", optional: true },
    { name: "summary", label: "Summary", type: "textarea", optional: true, wide: true },
    {
      name: "clientIsNamed",
      label: "The client may be named in documents",
      type: "checkbox",
      wide: true,
      hint: "Off by default. Turning it on overrides the standing rule for this project only.",
    },
  ],
};

const EDUCATIONS: Section = {
  key: "educations",
  singular: "education",
  blurb:
    "履歴書 renders two 学歴 rows per record — one for 入学 and one for the outcome — so the outcome is not decoration. A withdrawal must read 中退, never 卒業.",
  fields: [
    { name: "institution", label: "Institution" },
    { name: "institutionJa", label: "学校名 · Institution (Japanese)", optional: true },
    { name: "faculty", label: "学部・学科 · Faculty", optional: true },
    { name: "degree", label: "Degree", optional: true },
    { name: "fieldOfStudy", label: "Field of study", optional: true },
    { name: "outcome", label: "Outcome", type: "select", options: OUTCOMES, unset: UNCHOSEN },
    {
      name: "level",
      label: "Level",
      type: "select",
      options: LEVELS,
      // No default rung. The first option would otherwise be selected for a row
      // that has none — a row entered before the column existed, or a new one
      // whose author never opened this select — and the first option is
      // `secondary_lower`, which is exactly the rung the English résumé drops.
      // An empty value is refused by the server on a new row and preserved as
      // "not recorded" on an old one, which prints.
      unset: "— 未記入 · Not recorded —",
      hint: "The English résumé omits the two secondary rungs. It cannot tell them from an institution's name.",
    },
    {
      name: "startedOn",
      label: "入学 · Started",
      type: "month",
      optional: true,
      hint: "Leave empty when the record holds only the month it finished.",
    },
    {
      name: "endedOn",
      label: "卒業・修了・中退 · Ended",
      type: "month",
      hint: "Required unless the outcome is 卒業見込.",
    },
  ],
};

const CERTIFICATIONS: Section = {
  key: "certifications",
  singular: "certification",
  blurb:
    "The same shape you already maintain elsewhere. Technologies named here feed the same skill pool your facts do.",
  fields: [
    { name: "name", label: "Name" },
    { name: "nameJa", label: "資格名 · Name (Japanese)", optional: true },
    { name: "issuingOrganization", label: "Issuing organization" },
    { name: "issuedOn", label: "取得 · Issued", type: "month", optional: true },
    { name: "expiresOn", label: "有効期限 · Expires", type: "month", optional: true },
    { name: "credentialId", label: "Credential ID", optional: true },
    { name: "credentialUrl", label: "Credential URL", type: "url", optional: true },
    {
      name: "technologies",
      label: "Technologies",
      type: "list",
      optional: true,
      wide: true,
      hint: "Separated by commas.",
    },
  ],
};

/** The form open in one place on the screen: which collection, which row, and what a new row starts with. */
interface Editing {
  section: Section;
  item: { id: string } | null;
  defaults?: Record<string, string>;
}

/* ------------------------------------------------------------------ screen */

export function Record() {
  const profile = useProfile();
  const employers = useEntities<Employer>("employers");
  const roles = useEntities<Role>("roles");
  const projects = useEntities<Project>("projects");
  const timeline = useCareerTimeline();
  const rows = employers.data?.items ?? [];

  return (
    <div className="min-h-screen flex">
      <Sidebar name={profile.data?.nameLatin ?? ""} />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-header shrink-0 flex items-center gap-12 px-20 bg-surface border-b border-border">
          <h1 className="text-panel font-semibold tracking-snug text-text-strong">Career timeline</h1>
          <span className="text-smaller text-text-dimmer">
            Where you worked, what you held, what you studied. Every document takes its names and dates from here.
          </span>
        </header>

        <div className="flex-1 overflow-y-auto px-20 py-26">
          <div className="mx-auto w-content max-w-full grid gap-20">
            {/* The `Next:` waits for the read: "add an employer" said over a
                record that has three is worse than saying nothing for a moment. */}
            <ScreenIntro
              next={
                !employers.data
                  ? undefined
                  : rows.length === 0
                    ? "add a job. Roles, projects and imported documents are filed under one."
                    : "nothing is waiting here. Add or correct an entry when something changes."
              }
            >
              Your jobs with the roles and projects inside them, then your schooling and
              certifications, all entered by hand.
            </ScreenIntro>
            <ProfileCard profile={profile.data} />
            <Work
              employers={rows}
              roles={roles.data?.items ?? []}
              projects={projects.data?.items ?? []}
              timeline={timeline.data}
            />
            <IndependentProjects
              employers={rows}
              projects={(projects.data?.items ?? []).filter((p) => p.employerId === null)}
              timeline={timeline.data}
            />
            <div className="grid grid-cols-2 items-start gap-20">
              <EducationPanel employers={rows} />
              <CertificationsPanel employers={rows} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- profile */

/**
 * What the résumé's header shows, and the way to change it. The 履歴書's
 * personal fields are not repeated here: they print on no other document.
 */
function ProfileCard({ profile }: { profile: Profile | null | undefined }) {
  if (profile === undefined) return null;
  const kanji = profile ? [profile.familyNameKanji, profile.givenNameKanji].filter(Boolean).join(" ") : "";
  const initials = (profile?.nameLatin ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase())
    .filter((_, i, all) => i === 0 || i === all.length - 1)
    .join("");

  return (
    <section
      aria-label="Profile"
      className="bg-surface-raised border border-border rounded-panel px-16 py-14 flex items-center gap-14"
    >
      <span
        aria-hidden
        className="size-40 shrink-0 rounded-full bg-mark-selected text-accent-text text-small font-semibold flex items-center justify-center"
      >
        {initials}
      </span>
      <div className="min-w-0">
        {profile ? (
          <>
            <div className="text-row font-semibold text-text-strong truncate">
              {profile.nameLatin}
              {kanji ? <span className="font-normal text-text-dim"> · {kanji}</span> : null}
            </div>
            <div className="text-smaller text-text-dim truncate">{profile.email}</div>
          </>
        ) : (
          <div className="text-smaller text-text-dim">No profile yet. Every document's header is built from it.</div>
        )}
      </div>
      <div className="ml-auto flex items-center gap-10 shrink-0">
        <Chip>Birth date, phone and address: 履歴書 only</Chip>
        <Link
          to="/profile"
          className="motion-surface whitespace-nowrap border border-border-strong text-text-muted px-10 py-6 rounded-control text-smaller font-medium hover:bg-hover hover:text-text-secondary"
        >
          {profile ? "Edit profile" : "Add your profile"}
        </Link>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- work */

function Work({
  employers,
  roles,
  projects,
  timeline,
}: {
  employers: Employer[];
  roles: Role[];
  projects: Project[];
  timeline: CareerTimeline | undefined;
}) {
  const [adding, setAdding] = useState(false);
  const heading = useId();
  const today = currentMonth();
  const ordered = [...employers].sort(newestFirst);

  // Each gap sits above the first card that started before it ended, so it
  // reads between the two jobs it falls between.
  const gapsAt = new Map<number, TimelineGap[]>();
  for (const gap of timeline?.gaps ?? []) {
    const at = gapPosition(gap, ordered.map((e) => e.startedOn));
    gapsAt.set(at, [...(gapsAt.get(at) ?? []), gap]);
  }
  const gapRows = (at: number) =>
    (gapsAt.get(at) ?? []).map((gap) => (
      <li key={`gap-${gap.after}-${gap.before}`} className="flex gap-14">
        <span aria-hidden className="w-14 shrink-0 flex justify-center">
          <span className="border-l border-dashed border-border-dashed" />
        </span>
        <p className="flex-1 border border-dashed border-border-dashed rounded-control px-10 py-8 text-smaller text-text-dim">
          {gapText(gap)}
        </p>
      </li>
    ));

  return (
    <section aria-labelledby={heading} className="grid gap-12">
      <header className="flex items-center justify-between">
        <h2 id={heading} className="text-panel font-semibold tracking-snug text-text-strong">
          Work
        </h2>
        {adding ? null : <Button onClick={() => setAdding(true)}>Add a job</Button>}
      </header>

      {adding ? (
        <div className="bg-surface-raised border border-border rounded-panel">
          <EntityForm section={EMPLOYERS} employers={employers} item={null} onDone={() => setAdding(false)} />
        </div>
      ) : null}

      {ordered.length === 0 && !adding ? (
        <p className="text-smaller text-text-faint">
          No jobs yet. The English résumé has no sections to build until there is one.
        </p>
      ) : (
        <ol className="grid gap-12">
          {ordered.map((employer, index) => (
            <TimelineEntry key={employer.id} gaps={gapRows(index)}>
              <EmployerCard
                employer={employer}
                employers={employers}
                roles={roles.filter((r) => r.employerId === employer.id).sort(newestFirst)}
                projects={projects.filter((p) => p.employerId === employer.id).sort(newestFirst)}
                timeline={timeline}
                today={today}
                last={index === ordered.length - 1}
              />
            </TimelineEntry>
          ))}
          {gapRows(ordered.length)}
        </ol>
      )}
    </section>
  );
}

/** Gaps above, then one card on the rail. */
function TimelineEntry({ gaps, children }: { gaps: ReactNode[]; children: ReactNode }) {
  return (
    <>
      {gaps}
      <li className="flex gap-14">{children}</li>
    </>
  );
}

function EmployerCard({
  employer,
  employers,
  roles,
  projects,
  timeline,
  today,
  last,
}: {
  employer: Employer;
  employers: Employer[];
  roles: Role[];
  projects: Project[];
  timeline: CareerTimeline | undefined;
  today: string;
  last: boolean;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const title = employer.nameLatin ?? employer.nameJa;
  const counts = timeline?.employers.find((e) => e.id === employer.id);
  const current = employer.endedOn === null;

  const meta = [
    span(employer.startedOn, employer.endedOn),
    duration(employer.startedOn, employer.endedOn, today),
    EMPLOYMENT_SHORT[employer.employmentType],
    employer.industryJa,
    employer.headcount === null ? null : `${employer.headcount} ${employer.headcount === 1 ? "person" : "people"}`,
  ].filter(Boolean);

  const isOpen = (key: EntityKey, id: string) => editing?.section.key === key && editing.item?.id === id;
  const toggle = (section: Section, item: { id: string }) =>
    setEditing(isOpen(section.key, item.id) ? null : { section, item });
  const actionProps = {
    onConflict: setConflict,
    onRemoved: (id: string) => {
      if (editing?.item?.id === id) setEditing(null);
    },
  };

  return (
    <>
      <span aria-hidden className="w-14 shrink-0 flex flex-col items-center gap-4 pt-20">
        <span
          className={`size-12 shrink-0 rounded-full border-2 border-accent ${current ? "bg-accent" : "bg-surface"}`}
        />
        {last ? null : <span className="flex-1 border-l border-border-strong" />}
      </span>
      <article
        aria-label={title}
        className="flex-1 min-w-0 bg-surface-raised border border-border rounded-panel px-16 py-14 grid gap-12"
      >
        <header className="flex items-start gap-12">
          <div className="min-w-0">
            <h3 className="text-row font-semibold text-text-strong">
              {title}
              {employer.nameLatin ? <span className="font-normal text-text-dim"> {employer.nameJa}</span> : null}
            </h3>
            <div className="text-smaller text-text-dimmer">{meta.join(" · ")}</div>
          </div>
          <RowActions
            entity={EMPLOYERS.key}
            id={employer.id}
            title={title}
            open={isOpen(EMPLOYERS.key, employer.id)}
            onToggle={() => toggle(EMPLOYERS, employer)}
            {...actionProps}
          />
        </header>

        {conflict ? <Conflict text={conflict} /> : null}

        <div className="grid grid-cols-2 gap-20">
          <div>
            <Mono className="text-text-faint">Roles</Mono>
            <ul className="mt-6">
              {roles.map((role) => {
                const roleTitle = role.titleLatin ?? role.titleJa ?? "Untitled role";
                return (
                  <li key={role.id} className="flex items-center gap-8 py-6 border-b border-border-inner">
                    <span className="min-w-0 text-small text-text-strong truncate">{roleTitle}</span>
                    <span className="ml-auto shrink-0 text-smaller text-text-dimmer">
                      {span(role.startedOn, role.endedOn)}
                    </span>
                    <RowActions
                      entity={ROLES.key}
                      id={role.id}
                      title={roleTitle}
                      open={isOpen(ROLES.key, role.id)}
                      onToggle={() => toggle(ROLES, role)}
                      {...actionProps}
                    />
                  </li>
                );
              })}
              {roles.length === 0 ? (
                <li className="py-6 text-smaller text-text-faint">No roles yet. The section renders without a title.</li>
              ) : null}
            </ul>
            <Button
              variant="bare"
              className="mt-6"
              onClick={() => setEditing({ section: ROLES, item: null, defaults: { employerId: employer.id } })}
            >
              {roles.length === 0 ? "Add a role" : "Add a role or promotion"}
            </Button>
          </div>

          <div>
            <Mono className="text-text-faint">Projects and achievements</Mono>
            <ul className="mt-6">
              {projects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  achievements={timeline ? (timeline.projects.find((p) => p.id === project.id)?.achievements ?? 0) : null}
                  open={isOpen(PROJECTS.key, project.id)}
                  onToggle={() => toggle(PROJECTS, project)}
                  {...actionProps}
                />
              ))}
              {counts && counts.unfiled > 0 ? (
                <li className="flex items-center gap-8 py-6 border-b border-border-inner">
                  <span className="text-small text-text-dim">Not filed under a project</span>
                  <span className="ml-auto text-smaller text-text-dimmer">{count(counts.unfiled, "achievement")}</span>
                </li>
              ) : null}
              {timeline && projects.length === 0 && !counts?.unfiled ? (
                <li className="py-6 text-smaller text-text-faint">No projects or achievements yet.</li>
              ) : null}
            </ul>
            <Button
              variant="bare"
              className="mt-6"
              onClick={() => setEditing({ section: PROJECTS, item: null, defaults: { employerId: employer.id } })}
            >
              Add a project
            </Button>
          </div>
        </div>

        {editing ? (
          <div className="border-t border-border-inner -mx-16 -mb-14">
            <EntityForm
              key={`${editing.section.key}-${editing.item?.id ?? "new"}`}
              section={editing.section}
              employers={employers}
              item={editing.item}
              defaults={editing.defaults}
              onDone={() => setEditing(null)}
            />
          </div>
        ) : (
          <footer className="flex flex-wrap items-center gap-x-8 gap-y-4 border-t border-border-inner pt-10 text-smaller text-text-dim">
            {/* No count until the counts are read: "0 achievements" for a
                moment over a job that has twelve is worse than a blank. */}
            {timeline ? (
              <>
                <span>{counts ? sources(counts.documents, counts.captures) : "Nothing imported yet"}</span>
                <span aria-hidden>·</span>
                <span>{count(counts?.achievements ?? 0, "achievement")}</span>
                <span aria-hidden>·</span>
              </>
            ) : null}
            <Inclusion entityType="employer" entityId={employer.id} name={title} />
          </footer>
        )}
      </article>
    </>
  );
}

/** Where an employer's achievements came from. Quick capture files one fact per claim. */
const sources = (documents: number, captures: number) => {
  const parts = [
    documents ? count(documents, "imported document") : null,
    captures ? `${captures} added by quick capture` : null,
  ].filter(Boolean);
  return parts.length === 0 ? "Nothing imported yet" : `From ${parts.join(" and ")}`;
};

function ProjectRow({
  project,
  achievements,
  open,
  onToggle,
  onConflict,
  onRemoved,
}: {
  project: Project;
  /** Null until the counts are read. */
  achievements: number | null;
  open: boolean;
  onToggle: () => void;
  onConflict: (text: string | null) => void;
  onRemoved: (id: string) => void;
}) {
  return (
    <li className="py-6 border-b border-border-inner">
      {/* The count on the first line and the actions on the second, so the
          count lines up with the unfiled row's, which has no actions. */}
      <div className="flex items-center gap-8">
        <span className="min-w-0 text-small text-text-strong truncate">{project.name}</span>
        <span className="ml-auto shrink-0 text-smaller text-text-dimmer">
          {achievements === null ? null : count(achievements, "achievement")}
        </span>
      </div>
      <div className="flex items-center gap-8 text-smaller text-text-dimmer">
        <span className="flex flex-wrap items-center gap-x-8">
          <span>{span(project.startedOn, project.endedOn)}</span>
          <span aria-hidden>·</span>
          <Inclusion entityType="project" entityId={project.id} name={project.name} />
        </span>
        <RowActions
          entity={PROJECTS.key}
          id={project.id}
          title={project.name}
          open={open}
          onToggle={onToggle}
          onConflict={onConflict}
          onRemoved={onRemoved}
        />
      </div>
    </li>
  );
}

/** Projects filed under no employer: the English résumé gives them their own section. */
function IndependentProjects({
  employers,
  projects,
  timeline,
}: {
  employers: Employer[];
  projects: Project[];
  timeline: CareerTimeline | undefined;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const ordered = [...projects].sort(newestFirst);
  const isOpen = (id: string) => editing?.item?.id === id;

  return (
    <Panel
      heading="Independent projects"
      action={
        editing?.item === null ? null : (
          <Button onClick={() => setEditing({ section: PROJECTS, item: null })}>Add a project</Button>
        )
      }
    >
      {conflict ? <Conflict text={conflict} /> : null}
      {ordered.length === 0 ? (
        <p className="text-smaller text-text-faint">
          None. A project with no employer is an independent one, and the English résumé gives those their own section.
        </p>
      ) : (
        <ul>
          {ordered.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              achievements={timeline ? (timeline.projects.find((p) => p.id === project.id)?.achievements ?? 0) : null}
              open={isOpen(project.id)}
              onToggle={() => setEditing(isOpen(project.id) ? null : { section: PROJECTS, item: project })}
              onConflict={setConflict}
              onRemoved={(id) => {
                if (isOpen(id)) setEditing(null);
              }}
            />
          ))}
        </ul>
      )}
      {editing ? (
        <EntityForm
          key={editing.item?.id ?? "new"}
          section={PROJECTS}
          employers={employers}
          item={editing.item}
          onDone={() => setEditing(null)}
        />
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------- education, certificates */

function EducationPanel({ employers }: { employers: Employer[] }) {
  const query = useEntities<Education>("educations");
  const items = [...(query.data?.items ?? [])].sort((a, b) => (b.endedOn ?? "").localeCompare(a.endedOn ?? ""));
  return (
    <ListPanel
      heading="Education"
      add="Add education"
      empty="No education recorded yet."
      section={EDUCATIONS}
      employers={employers}
      items={items}
      row={(education) => ({
        title: education.institution,
        detail: `${span(education.startedOn, education.endedOn)} · ${
          OUTCOMES.find((o) => o.value === education.outcome)?.label ?? education.outcome
        }`,
        chip: SECONDARY.has(education.level) ? "Not on the English résumé" : null,
        extra: <Inclusion entityType="education" entityId={education.id} name={education.institution} />,
      })}
    />
  );
}

function CertificationsPanel({ employers }: { employers: Employer[] }) {
  const query = useEntities<Certification>("certifications");
  const today = currentMonth();
  return (
    <ListPanel
      heading="Certifications"
      add="Add a certification"
      empty="No certifications recorded yet."
      section={CERTIFICATIONS}
      employers={employers}
      items={query.data?.items ?? []}
      row={(certification) => ({
        title: certification.name,
        detail: `${certification.issuingOrganization}${
          certification.issuedOn ? ` · ${toMonth(certification.issuedOn)}` : ""
        }${certification.expiresOn ? ` · expires ${toMonth(certification.expiresOn)}` : ""}`,
        chip: expiry(certification.expiresOn, today)?.text ?? null,
      })}
    />
  );
}

/** A panel of rows with Edit and Delete, for the two collections no employer holds. */
function ListPanel<T extends { id: string }>({
  heading,
  add,
  empty,
  section,
  employers,
  items,
  row,
}: {
  heading: string;
  add: string;
  empty: string;
  section: Section;
  employers: Employer[];
  items: T[];
  row: (item: T) => { title: string; detail: string; chip: string | null; extra?: ReactNode };
}) {
  const [editing, setEditing] = useState<T | "new" | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  return (
    <Panel heading={heading} action={editing === "new" ? null : <Button onClick={() => setEditing("new")}>{add}</Button>}>
      {conflict ? <Conflict text={conflict} /> : null}
      {items.length === 0 && editing === null ? (
        <p className="text-smaller text-text-faint">{empty}</p>
      ) : (
        <ul>
          {items.map((item) => {
            const { title, detail, chip, extra } = row(item);
            const open = editing !== "new" && editing?.id === item.id;
            return (
              <li key={item.id} className="border-b border-border-inner last:border-b-0">
                <div className="flex items-start gap-8 py-8">
                  <div className="min-w-0 grid gap-2">
                    <div className="flex flex-wrap items-center gap-6">
                      <span className="text-small font-medium text-text-strong">{title}</span>
                      {chip ? <Chip>{chip}</Chip> : null}
                    </div>
                    <div className="text-smaller text-text-dimmer">{detail}</div>
                    {extra ? <div className="text-smaller text-text-dimmer">{extra}</div> : null}
                  </div>
                  <RowActions
                    entity={section.key}
                    id={item.id}
                    title={title}
                    open={open}
                    onToggle={() => setEditing(open ? null : item)}
                    onConflict={setConflict}
                    onRemoved={() => {
                      if (open) setEditing(null);
                    }}
                  />
                </div>
                {open ? (
                  <EntityForm section={section} employers={employers} item={item} onDone={() => setEditing(null)} />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {editing === "new" ? (
        <EntityForm section={section} employers={employers} item={null} onDone={() => setEditing(null)} />
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------- row pieces */

/**
 * Edit and Delete for one row. A refused delete — an employer or a project
 * something still points at answers `409` with what is attached — is handed up
 * to be shown where the row's card starts, not beside the button.
 */
function RowActions({
  entity,
  id,
  title,
  open,
  onToggle,
  onConflict,
  onRemoved,
}: {
  entity: EntityKey;
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  onConflict: (text: string | null) => void;
  onRemoved: (id: string) => void;
}) {
  const actions = useEntityActions(entity);
  return (
    <span className="ml-auto shrink-0 flex items-center gap-4">
      <Button variant="bare" aria-label={`${open ? "Close" : "Edit"} ${title}`} onClick={onToggle}>
        {open ? "Close" : "Edit"}
      </Button>
      <Button
        variant="bare"
        aria-label={`Delete ${title}`}
        onClick={async () => {
          onConflict(null);
          try {
            await actions.remove.mutateAsync(id);
            onRemoved(id);
          } catch (error) {
            onConflict(failureText(error));
          }
        }}
      >
        Delete
      </Button>
    </span>
  );
}

function Conflict({ text }: { text: string }) {
  return (
    <p role="alert" className="mb-12 border border-border-control rounded-control px-10 py-8 text-smaller text-text-secondary">
      {text}
    </p>
  );
}

/**
 * Which renders this entry appears in (S13, `docs/10` Screen 4), as one line
 * naming only the exceptions, with the five boxes behind Change.
 *
 * Checked unless the author unchecked it. Unchecking takes the entry and the
 * facts filed under it out of that render's generation input and changes
 * nothing else on this screen. Nothing renders until the settings have loaded,
 * because every entry would otherwise read as in every document for a moment
 * and a line that changes on its own is a line nobody trusts.
 */
function Inclusion({ entityType, entityId, name }: { entityType: IncludableEntity; entityId: string; name: string }) {
  const inclusions = useRenderInclusions();
  const setInclusion = useSetRenderInclusion();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();

  // Escape returns focus to Change; a press anywhere outside closes quietly.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (box.current?.contains(target) || button.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  if (!inclusions.data) return null;
  const excluded = new Set(
    inclusions.data.items
      .filter((i) => i.entityType === entityType && i.entityId === entityId && !i.included)
      .map((i) => i.kind),
  );

  return (
    <span className="relative inline-flex flex-wrap items-center gap-x-4">
      <span>{inclusionSummary(excluded)}</span>
      <Button
        ref={button}
        variant="bare"
        aria-label={`Change where ${name} appears`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        Change
      </Button>
      {setInclusion.error ? (
        <span role="alert" className="text-removed">
          That setting was not saved. {failureText(setInclusion.error)}
        </span>
      ) : null}
      {open ? (
        <div
          ref={box}
          id={id}
          role="group"
          aria-label="Appears in"
          className="absolute left-0 top-full z-10 mt-4 grid gap-8 w-max bg-card border border-border-control rounded-control shadow-lifted px-12 py-10"
        >
          <Mono className="text-text-faint">Appears in</Mono>
          {RENDER_KINDS.map((kind) => (
            <label key={kind} className="flex items-center gap-6 text-smaller text-text-dim">
              <input
                type="checkbox"
                className="size-icon accent-accent"
                checked={!excluded.has(kind)}
                onChange={(event) =>
                  setInclusion.mutate({ entityType, entityId, kind, included: event.target.checked })
                }
              />
              {RENDER_TITLE[kind]}
            </label>
          ))}
        </div>
      ) : null}
    </span>
  );
}

/* -------------------------------------------------------------------- form */

/**
 * One row's form, for a new row or an existing one.
 *
 * Saving is immediate and the whole row is sent, so a partly filled form is
 * never half-saved: the server validates it and the failure names the fields.
 */
function EntityForm({
  section,
  employers,
  item,
  defaults = {},
  onDone,
}: {
  section: Section;
  employers: Employer[];
  item: { id: string } | null;
  /** A new row's starting values: a role added inside a card starts under that employer. */
  defaults?: Record<string, string>;
  onDone: () => void;
}) {
  const actions = useEntityActions(section.key);
  const save = item ? actions.update : actions.create;
  // Fields come only from a refusal; a write that never arrived names none.
  const invalid = new Set(save.error instanceof ApiError ? save.error.fields : []);

  const initial = (field: FieldSpec) => {
    if (!item) return defaults[field.name] ?? "";
    const stored = (item as Record<string, unknown>)[field.name];
    if (field.type === "checkbox") return stored === true ? "on" : "";
    if (field.type === "month") return toMonth(stored as string | null | undefined);
    if (field.type === "list") return Array.isArray(stored) ? stored.join(", ") : "";
    return stored === null || stored === undefined ? "" : String(stored);
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {};
    for (const field of section.fields) {
      const raw = String(form.get(field.name) ?? "").trim();
      if (field.type === "checkbox") {
        body[field.name] = form.get(field.name) === "on";
      } else if (field.type === "month") {
        body[field.name] = fromMonth(raw) || null;
      } else if (field.type === "number") {
        body[field.name] = raw === "" ? null : Number(raw);
      } else if (field.type === "list") {
        body[field.name] = raw === "" ? [] : raw.split(",").map((t) => t.trim()).filter(Boolean);
      } else {
        body[field.name] = raw || null;
      }
    }
    try {
      if (item) await actions.update.mutateAsync({ id: item.id, body });
      else await actions.create.mutateAsync(body);
      onDone();
    } catch {
      // Rendered from `save.error`; nothing was saved.
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-label={item ? `Editing ${section.singular}` : `New ${section.singular}`}
      className="border-t border-border-inner px-16 py-14 grid gap-14"
    >
      <p className="text-smaller text-text-dim">{section.blurb}</p>
      <div className="grid grid-cols-2 gap-14">
        {section.fields.map((field) => (
          <EntityField
            key={field.name}
            spec={field}
            defaultValue={initial(field)}
            invalid={invalid.has(field.name)}
            employers={employers}
          />
        ))}
      </div>

      {/* Beside Save, not above the fields: the form is taller than the window,
          and a line at its top is out of view when Save is clicked. */}
      {save.error ? (
        <p role="alert" className="text-smaller text-removed">
          {failureText(save.error)} Nothing was saved.
        </p>
      ) : null}

      <div className="flex items-center gap-10">
        <Mono className="text-text-faint">
          {item ? `Editing ${section.singular}` : `New ${section.singular}`}
        </Mono>
        <div className="ml-auto flex items-center gap-8">
          <Button variant="bare" type="button" onClick={onDone}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </form>
  );
}

const CONTROL =
  "min-h-control bg-surface-raised border rounded-control px-10 py-8 text-ui text-text-strong outline-none focus:shadow-ring";

function EntityField({
  spec,
  defaultValue,
  invalid,
  employers,
}: {
  spec: FieldSpec;
  defaultValue: string;
  invalid: boolean;
  employers: Employer[];
}) {
  const border = invalid ? "border-removed" : "border-border-control";
  const options =
    spec.optionsFrom === "employers"
      ? employers.map((e) => ({ value: e.id, label: e.nameLatin ?? e.nameJa }))
      : (spec.options ?? []);

  return (
    // content-start: a field sits in a row with its neighbour, and without it a
    // neighbour's hint or error line stretched this control to match.
    <label className={`grid content-start gap-6 ${spec.wide ? "col-span-2" : ""}`}>
      <span className="text-smaller text-text-dim">
        {spec.label}
        {spec.optional ? <span className="text-text-faint"> · optional</span> : null}
      </span>

      {spec.type === "select" ? (
        <select name={spec.name} defaultValue={defaultValue} className={`${CONTROL} ${border}`}>
          {spec.optional ? <option value="">—</option> : null}
          {spec.unset ? <option value="">{spec.unset}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : spec.type === "textarea" ? (
        <textarea
          name={spec.name}
          defaultValue={defaultValue}
          rows={3}
          className={`${CONTROL} ${border} resize-y`}
        />
      ) : spec.type === "checkbox" ? (
        <input
          name={spec.name}
          type="checkbox"
          defaultChecked={defaultValue === "on"}
          className="size-icon justify-self-start accent-accent"
        />
      ) : (
        <input
          name={spec.name}
          type={spec.type === "month" ? "month" : spec.type === "number" ? "number" : spec.type === "url" ? "url" : "text"}
          defaultValue={defaultValue}
          aria-invalid={invalid}
          className={`${CONTROL} ${border}`}
        />
      )}

      {invalid ? (
        <span className="text-smaller text-removed">This field needs attention.</span>
      ) : spec.hint ? (
        <span className="text-smaller text-text-faint">{spec.hint}</span>
      ) : null}
    </label>
  );
}
