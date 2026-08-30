/**
 * The profile form.
 *
 * Every render needs a name, so this is the first thing after sign-in and the
 * only thing reachable until it is done. Abandoning it costs nothing: nothing
 * is saved until the whole form is valid, and the form is here again next time.
 *
 * Calendar fields collect MONTH AND YEAR ONLY. The day is pinned to `01` and is
 * never displayed (`docs/04-database-schema.md` §0).
 */
import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ApiError, useProfile, useSaveProfile } from "../api";
import { Button, Panel } from "../components/ui";

interface FieldSpec {
  name: string;
  label: string;
  hint?: string;
  type?: "text" | "email" | "month";
  optional?: boolean;
}

const IDENTITY: FieldSpec[] = [
  { name: "familyNameKanji", label: "姓 · Family name" },
  { name: "givenNameKanji", label: "名 · Given name" },
  { name: "familyNameKana", label: "せい · Family name (kana)" },
  { name: "givenNameKana", label: "めい · Given name (kana)" },
  { name: "nameLatin", label: "Name in Latin script", hint: "As it appears on the English résumé." },
  { name: "dateOfBirth", label: "生年月日 · Date of birth", type: "month", hint: "Month and year." },
  { name: "gender", label: "性別 · Gender", optional: true },
];

const CONTACT: FieldSpec[] = [
  { name: "phone", label: "電話番号 · Phone" },
  { name: "email", label: "メールアドレス · Email", type: "email" },
  { name: "postalCode", label: "郵便番号 · Postal code" },
  { name: "address", label: "住所 · Address" },
  { name: "addressKana", label: "ふりがな · Address (kana)" },
];

const monthValue = (isoDate: string | undefined) => (isoDate ? isoDate.slice(0, 7) : "");

export function ProfileForm() {
  const existing = useProfile();
  const save = useSaveProfile();
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, string>>({});

  const current = existing.data;
  const failure = save.error instanceof ApiError ? save.error : null;
  const invalid = new Set(failure?.fields ?? []);

  const valueOf = (field: FieldSpec) => {
    if (values[field.name] !== undefined) return values[field.name]!;
    const stored = current?.[field.name as keyof typeof current];
    if (field.type === "month") return monthValue(stored as string | undefined);
    return stored === null || stored === undefined ? "" : String(stored);
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {};
    for (const field of [...IDENTITY, ...CONTACT]) {
      const raw = String(form.get(field.name) ?? "").trim();
      // A month input yields `YYYY-MM`; the day is pinned here and never shown.
      body[field.name] = field.type === "month" && raw ? `${raw}-01` : raw || null;
    }
    body.contactSameAsAddress = true;
    try {
      await save.mutateAsync(body);
      await navigate({ to: "/" });
    } catch {
      // The error is rendered from `save.error`; nothing was saved.
    }
  }

  return (
    <main className="min-h-screen px-20 py-40">
      <div className="mx-auto w-content max-w-full">
        <h1 className="text-page font-semibold tracking-tight text-text-bright">
          {current ? "Your details" : "First, who this record is about"}
        </h1>
        <p className="mt-8 text-ui text-text-dim">
          Every document generated from your record carries your name. The Japanese fields fill
          履歴書 and appear in no other document.
        </p>

        {failure ? (
          <p
            role="alert"
            className="mt-16 border border-border-control rounded-control px-14 py-12 text-small text-text-secondary"
          >
            {failure.message} Nothing was saved.
          </p>
        ) : null}

        <form onSubmit={onSubmit} className="mt-26 grid gap-20">
          <Panel heading="Identity">
            <div className="grid grid-cols-2 gap-16">
              {IDENTITY.map((field) => (
                <Field key={field.name} spec={field} value={valueOf(field)} invalid={invalid.has(field.name)} onChange={(v) => setValues((s) => ({ ...s, [field.name]: v }))} />
              ))}
            </div>
          </Panel>

          <Panel heading="Contact">
            <div className="grid grid-cols-2 gap-16">
              {CONTACT.map((field) => (
                <Field key={field.name} spec={field} value={valueOf(field)} invalid={invalid.has(field.name)} onChange={(v) => setValues((s) => ({ ...s, [field.name]: v }))} />
              ))}
            </div>
          </Panel>

          <div className="flex items-center justify-end gap-12">
            <p className="text-smaller text-text-faint mr-auto">
              You can leave this and come back — nothing is saved until it is complete.
            </p>
            <Button type="submit" variant="primary" className="px-16 py-8">
              {save.isPending ? "Saving…" : "Save and continue"}
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}

function Field({
  spec,
  value,
  invalid,
  onChange,
}: {
  spec: FieldSpec;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-6">
      <span className="text-smaller text-text-dim">
        {spec.label}
        {spec.optional ? <span className="text-text-faint"> · optional</span> : null}
      </span>
      <input
        name={spec.name}
        type={spec.type === "month" ? "month" : (spec.type ?? "text")}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid}
        className={`bg-surface-raised border rounded-control px-10 py-8 text-ui text-text-strong outline-none focus:shadow-ring ${
          invalid ? "border-removed" : "border-border-control"
        }`}
      />
      {invalid ? (
        <span className="text-smaller text-removed">This field is required.</span>
      ) : spec.hint ? (
        <span className="text-smaller text-text-faint">{spec.hint}</span>
      ) : null}
    </label>
  );
}
