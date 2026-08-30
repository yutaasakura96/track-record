/**
 * Screen 3 — Record Overview (`docs/10-screen-specifications.md`).
 *
 * Home. What the record contains, what the documents say, what needs attention.
 *
 * **The empty state is not a variant of this screen — it is a different
 * screen.** Stat tiles and the documents list are absent entirely, import is
 * the only action, and Quick capture is HIDDEN rather than disabled, because
 * there is nothing to capture against yet.
 */
import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  ApiError,
  downloadUrl,
  useGenerate,
  useOverview,
  useProfile,
  useStartImport,
  type Overview as OverviewData,
  type RenderRow,
} from "../api";
import { Button, Dot, Mono, Panel, ProgressBar } from "../components/ui";
import { Sidebar } from "../components/sidebar";

export function Overview() {
  const overview = useOverview();
  const profile = useProfile();

  if (overview.isLoading || !overview.data) {
    return <div className="min-h-screen grid place-items-center text-small text-text-dim">Loading your record…</div>;
  }

  return (
    <div className="min-h-screen flex">
      <Sidebar name={profile.data?.nameLatin ?? ""} />
      <div className="flex-1 min-w-0 flex flex-col">
        {overview.data.isEmpty ? <EmptyRecord /> : <PopulatedRecord data={overview.data} />}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- populated */

function PopulatedRecord({ data }: { data: OverviewData }) {
  const navigate = useNavigate();
  const importFile = useImportPicker();

  return (
    <>
      <header className="h-header shrink-0 flex items-center gap-12 px-20 bg-surface border-b border-border">
        <h1 className="text-panel font-semibold tracking-snug text-text-strong">Your record</h1>
        {data.lastImportAt ? (
          <span className="text-smaller text-text-dimmer">
            Last import {relative(data.lastImportAt)}
          </span>
        ) : null}
        <div className="ml-auto">
          {importFile.control}
          <Button variant="primary" onClick={importFile.choose}>
            Import a document
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-20 py-26">
        <div className="mx-auto w-content max-w-full grid gap-20">
          {importFile.error ? (
            <p role="alert" className="border border-border-control rounded-control px-14 py-12 text-small text-text-secondary">
              {importFile.error}
            </p>
          ) : null}

          {data.activeImport ? (
            <button
              type="button"
              onClick={() => void navigate({ to: "/imports/$importId", params: { importId: data.activeImport!.importId } })}
              className="text-left bg-surface-raised border border-border rounded-panel px-16 py-14 hover:bg-hover"
            >
              <div className="flex items-center justify-between">
                <span className="text-row font-medium text-text-strong">
                  Importing a document — review is open
                </span>
                <Mono className="text-text-dimmer">
                  {data.activeImport.chunksDone} / {data.activeImport.chunksTotal || 1}
                </Mono>
              </div>
              <ProgressBar
                className="mt-10"
                value={data.activeImport.chunksTotal ? data.activeImport.chunksDone / data.activeImport.chunksTotal : 0}
              />
            </button>
          ) : null}

          <AtAGlance tiles={data.tiles} />
          <Provenance counts={data.factsByProvenance} />
          <Documents rows={data.documents} />
        </div>
      </div>
    </>
  );
}

function AtAGlance({ tiles }: { tiles: OverviewData["tiles"] }) {
  const order: [keyof OverviewData["tiles"], string][] = [
    ["employers", "Employers"],
    ["roles", "Roles"],
    ["projects", "Projects"],
    ["credentials", "Credentials"],
  ];
  return (
    <section>
      <h2 className="text-mono-label font-mono uppercase tracking-mono text-text-faint mb-10">
        At a glance
      </h2>
      {/* 1px gaps over a border background, so the four tiles read as one object. */}
      <div className="grid grid-cols-4 gap-2 bg-border rounded-panel overflow-hidden">
        {order.map(([key, label]) => (
          <div key={key} className="bg-surface-raised px-16 py-14">
            <div className="text-smaller text-text-dim">{label}</div>
            <div className="text-stat font-medium tracking-tight text-text-bright mt-6">
              {tiles[key].count}
            </div>
            <div className="text-smaller text-text-dimmer mt-4 min-h-16">{tiles[key].note ?? ""}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Provenance({ counts }: { counts: OverviewData["factsByProvenance"] }) {
  const total = counts.measured + counts.attested + counts.generated;
  const share = (n: number) => (total === 0 ? 0 : (n / total) * 100);

  const rows = [
    { key: "measured", label: "Measured", tone: "measured" as const, count: counts.measured, note: "Proved by a passage in a source document" },
    { key: "attested", label: "Attested", tone: "accent" as const, count: counts.attested, note: "Stated by you, without a measurement behind it" },
    { key: "generated", label: "Generated", tone: "generated" as const, count: counts.generated, note: "Inferred by the importer — never used in a document" },
  ];

  return (
    <Panel heading="Facts by provenance">
      <div className="flex gap-2 h-6 mb-14">
        <div className="bg-measured rounded-mark" style={{ width: `${share(counts.measured)}%` }} />
        <div className="bg-accent rounded-mark" style={{ width: `${share(counts.attested)}%` }} />
        <div className="bg-generated rounded-mark" style={{ width: `${share(counts.generated)}%` }} />
        {total === 0 ? <div className="bg-progress-track rounded-mark w-full" /> : null}
      </div>

      <ul>
        {rows.map((row) => {
          // The Generated row is the ACTION row: everything waiting for the
          // author is expressed here.
          const waiting = row.key === "generated" && row.count > 0;
          return (
            <li
              key={row.key}
              className={`flex items-center gap-10 px-10 py-8 rounded-control border-b border-border-inner last:border-b-0 ${
                waiting ? "bg-generated-mark shadow-ring" : ""
              }`}
            >
              <Dot tone={row.tone} />
              <span className="text-row font-medium text-text-strong w-60">{row.label}</span>
              <span className="text-smaller text-text-dim">{row.note}</span>
              <span className="ml-auto flex items-center gap-12">
                <Mono className={row.count === 0 ? "text-text-ghost" : "text-text-dimmer"}>
                  {row.count}
                </Mono>
                {row.key === "generated" ? (
                  waiting ? (
                    <span className="text-smaller text-generated-text">Review {row.count} →</span>
                  ) : (
                    <span className="text-smaller text-text-ghost">Nothing waiting</span>
                  )
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function Documents({ rows }: { rows: RenderRow[] }) {
  const navigate = useNavigate();
  const generate = useGenerate();
  const [failure, setFailure] = useState<string | null>(null);

  return (
    <Panel heading="Documents">
      {failure ? (
        <p role="alert" className="mb-12 text-small text-text-secondary">
          {failure}
        </p>
      ) : null}
      <ul>
        {rows.map((row) => (
          <li
            key={row.kind}
            className="flex items-center gap-12 px-10 py-12 border-b border-border-inner last:border-b-0"
          >
            <span className="size-icon rounded-tile bg-chip shrink-0" aria-hidden />
            <div className="min-w-0">
              {/* Japanese titles render in the mixed stack — the body default. */}
              <div className="text-row font-medium text-text-strong">{row.title}</div>
              <div className="text-smaller text-text-dimmer">
                {row.language === "ja" ? "Japanese" : "English"}
                {row.generatedAt ? ` · generated ${relative(row.generatedAt)}` : ""}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-12">
              <StatusText row={row} />
              <Action
                row={row}
                busy={generate.isPending}
                onOpen={() =>
                  row.pendingProposalId &&
                  void navigate({ to: "/proposals/$proposalId", params: { proposalId: row.pendingProposalId } })
                }
                onGenerate={async () => {
                  setFailure(null);
                  try {
                    const created = await generate.mutateAsync(row.kind);
                    await navigate({ to: "/proposals/$proposalId", params: { proposalId: created.proposalId } });
                  } catch (error) {
                    setFailure(error instanceof ApiError ? error.message : "Generation could not be started.");
                  }
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function StatusText({ row }: { row: RenderRow }) {
  if (row.status === "never_generated") {
    return (
      <span className="flex items-center gap-6 text-smaller text-text-faint">
        <Dot tone="muted" /> Never generated
      </span>
    );
  }
  if (row.status === "proposal_pending") {
    return (
      <span className="flex items-center gap-6 text-smaller text-accent-text">
        <Dot tone="accent" /> A proposal is waiting
      </span>
    );
  }
  if (row.status === "stale") {
    return (
      <span className="flex items-center gap-6 text-smaller text-accent-text">
        <Dot tone="accent" /> {row.newFactsSince} new facts since it was generated
      </span>
    );
  }
  return (
    <span className="flex items-center gap-6 text-smaller text-measured-text">
      <Dot tone="measured" /> Up to date with your record
    </span>
  );
}

function Action({
  row,
  busy,
  onOpen,
  onGenerate,
}: {
  row: RenderRow;
  busy: boolean;
  onOpen: () => void;
  onGenerate: () => void;
}) {
  if (!row.buildable) {
    return (
      <Button disabled disabledReason="This document is not built yet.">
        Generate
      </Button>
    );
  }
  if (row.status === "proposal_pending") {
    return (
      <Button variant="primary" onClick={onOpen}>
        Review proposal
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-8">
      {row.currentVersionId ? (
        <a
          href={downloadUrl(row.kind, "docx")}
          className="border border-border-strong text-text-muted px-10 py-6 rounded-control text-smaller font-medium hover:bg-hover hover:text-text-secondary"
        >
          Download .docx
        </a>
      ) : null}
      <Button variant="primary" onClick={onGenerate} disabled={busy} disabledReason={busy ? "Generating…" : undefined}>
        {row.status === "never_generated" ? "Generate" : "Regenerate"}
      </Button>
    </span>
  );
}

/* ------------------------------------------------------------------- empty */

function EmptyRecord() {
  const importFile = useImportPicker();
  return (
    <main className="flex-1 grid place-items-center px-20 py-40">
      <div className="w-measure max-w-full text-center">
        <h1 className="text-page font-semibold tracking-tight text-text-bright">
          Your record is empty
        </h1>
        <p className="mt-10 text-ui text-text-body">
          Import a document you already have — a case study, a project write-up, anything long you
          wrote about your own work. It is read once, and the claims it supports become facts you
          review one at a time. Every document this tool produces is generated from those facts,
          never from re-reading the original.
        </p>

        <div className="mt-26 border border-dashed border-border-dashed rounded-panel px-20 py-32">
          <div className="mx-auto size-32 rounded-tile bg-chip" aria-hidden />
          <p className="mt-14 text-row font-medium text-text-strong">Import your first document</p>
          <p className="mt-6 text-smaller text-text-dim">
            Choose a Markdown or plain text file.
          </p>
          {importFile.control}
          <div className="mt-16">
            <Button variant="primary" onClick={importFile.choose} className="px-16 py-8">
              Choose a file
            </Button>
          </div>
          {importFile.error ? (
            <p role="alert" className="mt-14 text-small text-text-secondary">
              {importFile.error}
            </p>
          ) : null}
        </div>

        <p className="mt-20 text-smaller text-text-faint">
          Document generation opens up once your record holds its first facts.
        </p>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ shared */

/**
 * The review screen opens IMMEDIATELY on upload, so the document can be read
 * while extraction is still running.
 */
function useImportPicker() {
  const input = useRef<HTMLInputElement>(null);
  const start = useStartImport();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const control = (
    <input
      ref={input}
      type="file"
      accept=".md,.markdown,.txt"
      className="hidden"
      onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        setError(null);
        try {
          const created = await start.mutateAsync({ file });
          await navigate({ to: "/imports/$importId", params: { importId: created.importId } });
        } catch (caught) {
          setError(caught instanceof ApiError ? caught.message : "That file could not be imported.");
        }
      }}
    />
  );

  return { control, error, choose: () => input.current?.click() };
}

export function relative(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toISOString().slice(0, 7);
}
