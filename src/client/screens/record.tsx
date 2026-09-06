/**
 * Screen — Your record (S7, `docs/02-product-requirements.md`).
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
 * Calendar fields collect MONTH AND YEAR ONLY. The day is pinned to `01` and is
 * never displayed (`docs/04-database-schema.md` §0).
 */
import { useState, type FormEvent } from "react";
import {
  ApiError,
  useEntities,
  useEntityActions,
  useProfile,
  type Certification,
  type Education,
  type Employer,
  type EntityKey,
  type Project,
  type Role,
} from "../api";
import { Button, Mono, Panel } from "../components/ui";
import { Sidebar } from "../components/sidebar";
import { fromMonth, toMonth } from "~/shared/calendar";

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

const OUTCOMES = [
  { value: "graduated", label: "卒業 · Graduated" },
  { value: "completed", label: "修了 · Completed" },
  { value: "withdrawn", label: "中退 · Withdrawn" },
  { value: "expected", label: "卒業見込 · Expected" },
];

/* ---------------------------------------------------------------- sections */

interface Section<T> {
  key: EntityKey;
  heading: string;
  singular: string;
  blurb: string;
  fields: FieldSpec[];
  /** How one stored row reads in the list. */
  row: (item: T, employers: Employer[]) => { title: string; detail: string };
  /** Stated when the collection is empty, in place of the list. */
  empty: string;
  /** This collection cannot be added to until employers exist. */
  needsEmployer?: boolean;
}

const employerName = (employers: Employer[], id: string | null) =>
  employers.find((e) => e.id === id)?.nameLatin ??
  employers.find((e) => e.id === id)?.nameJa ??
  "—";

/** `2022-04-01`, `null` → `2022-04 – present`. The day is never shown. */
const span = (startedOn: string | null, endedOn: string | null) => {
  if (!startedOn) return endedOn ? `until ${toMonth(endedOn)}` : "no dates";
  return `${toMonth(startedOn)} – ${endedOn ? toMonth(endedOn) : "present"}`;
};

const EMPLOYERS: Section<Employer> = {
  key: "employers",
  heading: "Employers",
  singular: "employer",
  blurb:
    "One row per employer. Every document's employment sections and their dates are built from these rows — not from the wording of your facts.",
  empty: "No employers yet. The English résumé has no sections to build until there is one.",
  fields: [
    { name: "nameJa", label: "会社名 · Employer name" },
    {
      name: "nameLatin",
      label: "Name in Latin script",
      optional: true,
      hint: "Used on the English résumé. Falls back to 会社名.",
    },
    { name: "employmentType", label: "雇用形態 · Employment type", type: "select", options: EMPLOYMENT_TYPES },
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
  row: (employer) => ({
    title: employer.nameLatin ? `${employer.nameJa} · ${employer.nameLatin}` : employer.nameJa,
    detail: `${span(employer.startedOn, employer.endedOn)}${
      employer.industryJa ? ` · ${employer.industryJa}` : ""
    }`,
  }),
};

const ROLES: Section<Role> = {
  key: "roles",
  heading: "Roles",
  singular: "role",
  blurb:
    "The titles you held, and when. A promotion is a second role, not an edit to the first — both are true and both belong in the record.",
  empty: "No roles yet. Employer sections render without a title until there is one.",
  needsEmployer: true,
  fields: [
    { name: "employerId", label: "Employer", type: "select", optionsFrom: "employers" },
    { name: "titleLatin", label: "Title", optional: true, hint: "As it should read in English." },
    { name: "titleJa", label: "役職 · Title (Japanese)", optional: true },
    { name: "shokushuJa", label: "職種 · Occupation", optional: true },
    { name: "startedOn", label: "Started", type: "month" },
    { name: "endedOn", label: "Ended", type: "month", optional: true, hint: "Leave empty if you hold it now." },
  ],
  row: (role, employers) => ({
    title: role.titleLatin ?? role.titleJa ?? "Untitled role",
    detail: `${employerName(employers, role.employerId)} · ${span(role.startedOn, role.endedOn)}`,
  }),
};

const PROJECTS: Section<Project> = {
  key: "projects",
  heading: "Projects",
  singular: "project",
  blurb:
    "A project with no employer is an independent one, and the English résumé gives those their own section.",
  empty: "No projects yet.",
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
  row: (project, employers) => ({
    title: project.name,
    detail: `${project.employerId ? employerName(employers, project.employerId) : "Independent"} · ${span(
      project.startedOn,
      project.endedOn,
    )}`,
  }),
};

const EDUCATIONS: Section<Education> = {
  key: "educations",
  heading: "Education",
  singular: "education",
  blurb:
    "履歴書 renders two 学歴 rows per record — one for 入学 and one for the outcome — so the outcome is not decoration. A withdrawal must read 中退, never 卒業.",
  empty: "No education recorded yet.",
  fields: [
    { name: "institution", label: "Institution" },
    { name: "institutionJa", label: "学校名 · Institution (Japanese)", optional: true },
    { name: "faculty", label: "学部・学科 · Faculty", optional: true },
    { name: "degree", label: "Degree", optional: true },
    { name: "fieldOfStudy", label: "Field of study", optional: true },
    { name: "outcome", label: "Outcome", type: "select", options: OUTCOMES },
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
      optional: true,
      hint: "Required unless the outcome is 卒業見込.",
    },
  ],
  row: (education) => ({
    title: education.institution,
    detail: `${span(education.startedOn, education.endedOn)} · ${
      OUTCOMES.find((o) => o.value === education.outcome)?.label ?? education.outcome
    }`,
  }),
};

const CERTIFICATIONS: Section<Certification> = {
  key: "certifications",
  heading: "Certifications",
  singular: "certification",
  blurb:
    "The same shape you already maintain elsewhere. Technologies named here feed the same skill pool your facts do.",
  empty: "No certifications recorded yet.",
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
  row: (certification) => ({
    title: certification.name,
    detail: `${certification.issuingOrganization}${
      certification.issuedOn ? ` · ${toMonth(certification.issuedOn)}` : ""
    }${certification.expiresOn ? ` · expires ${toMonth(certification.expiresOn)}` : ""}`,
  }),
};

/* ------------------------------------------------------------------ screen */

export function Record() {
  const profile = useProfile();
  const employers = useEntities<Employer>("employers");
  const rows = employers.data?.items ?? [];

  return (
    <div className="min-h-screen flex">
      <Sidebar name={profile.data?.nameLatin ?? ""} />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-header shrink-0 flex items-center gap-12 px-20 bg-surface border-b border-border">
          <h1 className="text-panel font-semibold tracking-snug text-text-strong">Your record</h1>
          <span className="text-smaller text-text-dimmer">
            Entered by hand — nothing here is extracted from a document
          </span>
        </header>

        <div className="flex-1 overflow-y-auto px-20 py-26">
          <div className="mx-auto w-content max-w-full grid gap-20">
            <EntitySection section={EMPLOYERS} employers={rows} />
            <EntitySection section={ROLES} employers={rows} />
            <EntitySection section={PROJECTS} employers={rows} />
            <EntitySection section={EDUCATIONS} employers={rows} />
            <EntitySection section={CERTIFICATIONS} employers={rows} />
          </div>
        </div>
      </div>
    </div>
  );
}

function EntitySection<T extends { id: string }>({
  section,
  employers,
}: {
  section: Section<T>;
  employers: Employer[];
}) {
  const query = useEntities<T>(section.key);
  const actions = useEntityActions(section.key);
  const [editing, setEditing] = useState<T | "new" | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  const items = query.data?.items ?? [];
  const blocked = section.needsEmployer && employers.length === 0;

  return (
    <Panel
      heading={section.heading}
      action={
        editing ? null : blocked ? (
          <Button disabled disabledReason="Add an employer first — a role belongs to one.">
            Add
          </Button>
        ) : (
          <Button onClick={() => setEditing("new")}>Add</Button>
        )
      }
    >
      <p className="text-smaller text-text-dim mb-12">{section.blurb}</p>

      {conflict ? (
        <p role="alert" className="mb-12 border border-border-control rounded-control px-10 py-8 text-smaller text-text-secondary">
          {conflict}
        </p>
      ) : null}

      {items.length === 0 && editing === null ? (
        <p className="text-smaller text-text-faint">{section.empty}</p>
      ) : (
        <ul>
          {items.map((item) => {
            const { title, detail } = section.row(item, employers);
            const open = editing !== "new" && editing?.id === item.id;
            return (
              <li key={item.id} className="border-b border-border-inner last:border-b-0">
                <div className="flex items-center gap-12 px-10 py-10">
                  <div className="min-w-0">
                    <div className="text-row font-medium text-text-strong truncate">{title}</div>
                    <div className="text-smaller text-text-dimmer">{detail}</div>
                  </div>
                  <div className="ml-auto flex items-center gap-8">
                    <Button
                      variant="bare"
                      onClick={() => setEditing(open ? null : item)}
                    >
                      {open ? "Close" : "Edit"}
                    </Button>
                    <Button
                      variant="bare"
                      onClick={async () => {
                        setConflict(null);
                        try {
                          await actions.remove.mutateAsync(item.id);
                          if (open) setEditing(null);
                        } catch (error) {
                          setConflict(
                            error instanceof ApiError
                              ? error.message
                              : `That ${section.singular} could not be deleted.`,
                          );
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
                {open ? (
                  <EntityForm
                    section={section}
                    employers={employers}
                    item={item}
                    onDone={() => setEditing(null)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {editing === "new" ? (
        <EntityForm
          section={section}
          employers={employers}
          item={null}
          onDone={() => setEditing(null)}
        />
      ) : null}
    </Panel>
  );
}

/**
 * One row's form, for a new row or an existing one.
 *
 * Saving is immediate and the whole row is sent, so a partly filled form is
 * never half-saved: the server validates it and the failure names the fields.
 */
function EntityForm<T extends { id: string }>({
  section,
  employers,
  item,
  onDone,
}: {
  section: Section<T>;
  employers: Employer[];
  item: T | null;
  onDone: () => void;
}) {
  const actions = useEntityActions(section.key);
  const save = item ? actions.update : actions.create;
  const failure = save.error instanceof ApiError ? save.error : null;
  const invalid = new Set(failure?.fields ?? []);

  const initial = (field: FieldSpec) => {
    const stored = item ? (item as Record<string, unknown>)[field.name] : undefined;
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
      className="border-t border-border-inner px-10 py-14 grid gap-14"
    >
      {failure ? (
        <p role="alert" className="text-smaller text-removed">
          {failure.message} Nothing was saved.
        </p>
      ) : null}

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
  "bg-surface-raised border rounded-control px-10 py-8 text-ui text-text-strong outline-none focus:shadow-ring";

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
    <label className={`grid gap-6 ${spec.wide ? "col-span-2" : ""}`}>
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
