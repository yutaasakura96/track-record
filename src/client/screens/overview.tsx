/**
 * Screen 3 — Home (`docs/10-screen-specifications.md`).
 *
 * The first thing the author sees. In this order: what to do next, what the
 * record holds, what the documents say. The test of it is that a first-time
 * author and a returning one can both say what it shows and what to do,
 * without knowing a word of the product's vocabulary (issue #58).
 *
 * **Readable by rule.** No text here is set in `text-dimmer`, `text-faint` or
 * `text-ghost`: on the panel surface they measure under the 4.5 to 1 a reader
 * needs. Supporting text is `text-muted` or brighter, and a count is set as
 * text, never as a 9.5px mono label.
 *
 * **The empty state is not a variant of this screen — it is a different
 * screen.** Its sections are absent entirely and import is the only action.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  failureText,
  keys,
  useGenerate,
  useOverview,
  useProfile,
  useSession,
  type Overview as OverviewData,
  type RenderRow,
} from "../api";
import { Button, Dot } from "../components/ui";
import { ReadFailure, RefreshFailure } from "../components/read-failure";
import { Sidebar } from "../components/sidebar";
import { ImportDropTarget, useImportPicker } from "../components/import-picker";
import { relative } from "../format";
import { DownloadButton } from "../components/download-button";
import { nextSteps, type Step, type StepAction } from "../next-step";

const number = (n: number) => n.toLocaleString("en-US");

/** A text link inside a row: quieter than a button, for what is not the row's one action. */
const QUIET = "text-small text-accent-link hover:text-accent-link-hover motion-tone whitespace-nowrap";
/** `Button`'s ghost and secondary, for a control that is a link and so cannot be a `Button`. */
const GHOST =
  "motion-surface whitespace-nowrap border border-border-strong text-text-muted px-10 py-6 rounded-control text-smaller font-medium hover:bg-hover hover:text-text-secondary";
const SECONDARY =
  "motion-surface whitespace-nowrap border border-border-strong text-text-secondary px-14 py-8 rounded-control text-micro font-medium hover:bg-hover";
/** The one primary button in the content column, a size up from the header's. */
const PRIMARY =
  "motion-surface whitespace-nowrap bg-accent text-text-bright px-16 py-10 rounded-control text-ui font-medium hover:brightness-110";

export function Overview() {
  const queryClient = useQueryClient();
  const overview = useOverview();
  const session = useSession();
  const profile = useProfile();
  // The gate lets Home draw while the session and the profile are still out
  // (`../router.tsx`), so the three reads run side by side. Nothing of the
  // record shows until both have answered: a signed-out visit is on its way to
  // the sign-in screen, and one with no profile to the profile form.
  const settling = session.isPending || profile.isPending || profile.data === null;
  // A later read that fails leaves the overview on screen, and says it may be out of date.
  const refresh = overview.data && overview.isError ? <RefreshFailure query={overview} /> : null;
  // A write elsewhere said this overview is no longer true, and its replacement
  // is on the way. What it says to do next is held back until then: Home once
  // told the author to wait for an import they had just finished reviewing.
  // A poll or a return to the page invalidates nothing, and holds nothing.
  const superseded =
    overview.isFetching && queryClient.getQueryState(keys.overview)?.isInvalidated === true;

  // The sidebar renders in every state: a failed read with nothing around it
  // left the author on a blank page with no way to another screen.
  return (
    <div className="min-h-screen flex">
      <Sidebar name={profile.data?.nameLatin ?? ""} />
      <div className="flex-1 min-w-0 flex flex-col">
        {settling || overview.isPending ? (
          <LoadingRecord />
        ) : overview.data ? (
          overview.data.isEmpty ? (
            <EmptyRecord refresh={refresh} />
          ) : (
            <PopulatedRecord data={overview.data} refresh={refresh} superseded={superseded} />
          )
        ) : (
          <>
            <Header />
            <div className="flex-1 grid place-items-center">
              <ReadFailure query={overview} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Header({ note, children }: { note?: ReactNode; children?: ReactNode }) {
  return (
    <header className="h-header shrink-0 flex items-center gap-12 px-20 bg-surface border-b border-border">
      <h1 className="text-panel font-semibold tracking-snug text-text-strong">Home</h1>
      {note ? <span className="text-small text-text-muted">{note}</span> : null}
      {children ? <div className="ml-auto">{children}</div> : null}
    </header>
  );
}

/** A panel that says what it is: a heading, and one sentence under it. */
function Section({
  heading,
  about,
  action,
  children,
}: {
  heading: string;
  about: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="min-w-0 bg-surface-raised border border-border rounded-panel px-16 py-14">
      <header className="flex items-start justify-between gap-12">
        <div className="min-w-0">
          <h2 className="text-doc-body font-semibold tracking-snug text-text-bright">{heading}</h2>
          <p className="text-ui text-text-body">{about}</p>
        </div>
        {action}
      </header>
      {children ? <div className="mt-14">{children}</div> : null}
    </section>
  );
}

/* ----------------------------------------------------------------- loading */

/** How long the frame stands before it says the read is slow. */
const SLOW_MS = 4_000;

/**
 * The frame, drawn at once and filled as the reads answer. It replaced a bare
 * `Loading your record…` on an empty page (issue #58). Nothing animates
 * (`docs/05` §8): the blocks are the height of what they will hold, and still.
 */
function LoadingRecord() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, []);
  const blank = (height: string, key?: number) => (
    <div key={key} className={`${height} rounded-control bg-hover`} />
  );

  return (
    <>
      <Header
        note={
          <span role="status">
            {slow ? "Still loading. This is taking longer than usual." : "Loading your record…"}
          </span>
        }
      />
      <div className="flex-1 overflow-y-auto px-20 py-26" aria-busy="true">
        <div className="mx-auto w-content max-w-full grid gap-20">
          <NextStepFrame about="What is most worth doing now." />
          <Section heading={RECORD.heading} about={RECORD.about}>
            <div className="grid grid-cols-4 gap-2">{[0, 1, 2, 3].map((n) => blank("h-60", n))}</div>
          </Section>
          <Section heading={FACTS.heading} about={FACTS.about}>
            <div className="grid gap-8">{[0, 1, 2].map((n) => blank("h-40", n))}</div>
          </Section>
          <Section heading={DOCUMENTS.heading} about={DOCUMENTS.about}>
            <div className="grid gap-8">{[0, 1, 2, 3, 4].map((n) => blank("h-40", n))}</div>
          </Section>
        </div>
      </div>
    </>
  );
}

/** The Next step with nothing in it yet: on the loading frame, and while a superseded one is read again. */
function NextStepFrame({ about }: { about: ReactNode }) {
  return (
    <Section heading="Next step" about={about}>
      <div className="h-40 rounded-control bg-hover" />
    </Section>
  );
}

/** Each section's heading and sentence, shared with the loading frame so they cannot drift. */
const RECORD = {
  heading: "Your record",
  about: "What you entered by hand: where you worked, and what you hold.",
};
const FACTS = {
  heading: "Facts in your record",
  about: "A fact is one claim about your work, quoted from a document you imported.",
};
const DOCUMENTS = {
  heading: "Your career documents",
  about: "Generated from your accepted facts. Each one is a file you can download.",
};

/* --------------------------------------------------------------- populated */

/** Where a failed Generate is said: beside the button that was pressed. */
type GenerateFrom = "next" | "documents";

function PopulatedRecord({
  data,
  refresh,
  superseded,
}: {
  data: OverviewData;
  refresh: ReactNode;
  superseded: boolean;
}) {
  const navigate = useNavigate();
  const importFile = useImportPicker();
  const generate = useGenerate();
  const [failure, setFailure] = useState<{ from: GenerateFrom; text: string } | null>(null);

  const onGenerate = async (kind: RenderRow["kind"], from: GenerateFrom) => {
    setFailure(null);
    try {
      const created = await generate.mutateAsync(kind);
      await navigate({ to: "/proposals/$proposalId", params: { proposalId: created.proposalId } });
    } catch (error) {
      setFailure({ from, text: failureText(error) });
    }
  };
  const failed = (from: GenerateFrom) => (failure?.from === from ? failure.text : null);

  return (
    <>
      <Header note={data.lastImportAt ? `Last import ${relative(data.lastImportAt)}` : null}>
        {importFile.control}
        <Button variant="primary" onClick={importFile.choose}>
          Import a document
        </Button>
      </Header>

      <div className="flex-1 overflow-y-auto px-20 py-26">
        <div className="mx-auto w-content max-w-full grid gap-20">
          {refresh}
          {importFile.confirmation}
          {importFile.error ? (
            <p role="alert" className="border border-border-control rounded-control px-14 py-12 text-small text-text-secondary">
              {importFile.error}
            </p>
          ) : null}

          {superseded ? (
            <NextStepFrame about={<span role="status">Checking what is waiting for you now…</span>} />
          ) : (
            <>
              {data.activeImport ? <ImportProgress active={data.activeImport} /> : null}
              <NextStep
                steps={nextSteps(data)}
                busy={generate.isPending}
                failure={failed("next")}
                onGenerate={(kind) => void onGenerate(kind, "next")}
                onImport={importFile.choose}
              />
            </>
          )}
          <YourRecord tiles={data.tiles} />
          <Facts counts={data.factsByProvenance} unconfirmed={data.unconfirmed} />
          <CareerDocuments
            rows={data.documents}
            canGenerate={data.canGenerate}
            busy={generate.isPending}
            failure={failed("documents")}
            onGenerate={(kind) => void onGenerate(kind, "documents")}
          />
          <Backup />
        </div>
      </div>
    </>
  );
}

/**
 * An import that is still running, said so that it cannot be missed: the share
 * done, a bar twice the control's height, and a sentence that it is still
 * working. The Next step under it carries the way into the review.
 */
function ImportProgress({ active }: { active: NonNullable<OverviewData["activeImport"]> }) {
  const { chunksDone, chunksTotal, filename } = active;
  const percent = chunksTotal ? Math.round(Math.min(1, chunksDone / chunksTotal) * 100) : 0;

  return (
    <section
      aria-label="Import in progress"
      className="min-w-0 bg-surface-raised border border-border rounded-panel px-16 py-14"
    >
      {/* A filename is whatever the file was called, so it is the one part of
          the line that gives way: cut short, in full on hover. */}
      <div className="flex items-center justify-between gap-12">
        <span className="flex min-w-0 items-center gap-8 text-row font-medium text-text-strong">
          <span className="shrink-0">Reading</span>
          <span className="min-w-0 inline-flex items-center bg-chip border border-border-control rounded-chip px-6 py-2 font-mono text-small font-normal text-text-secondary">
            <span className="truncate" title={filename}>
              {filename}
            </span>
          </span>
        </span>
        <span className="shrink-0 text-row font-medium text-text-strong">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={`Reading ${filename}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mt-10 h-8 bg-progress-track rounded-chip overflow-hidden"
      >
        <div className="h-full bg-accent motion-progress" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-10 text-ui text-text-secondary">
        Still working, please wait.{" "}
        {chunksTotal
          ? `${number(chunksDone)} of ${number(chunksTotal)} parts read.`
          : "Getting the document ready."}
      </p>
      <p className="mt-4 text-small text-text-muted">
        A long document takes several minutes. You can leave this page and it carries on.
      </p>
    </section>
  );
}

/**
 * The one thing most worth doing now, and under it everything else that is
 * waiting. It holds the only primary button in the content column.
 */
function NextStep({
  steps,
  busy,
  failure,
  onGenerate,
  onImport,
}: {
  steps: Step[];
  busy: boolean;
  failure: string | null;
  onGenerate: (kind: RenderRow["kind"]) => void;
  onImport: () => void;
}) {
  const [first, ...rest] = steps;
  if (!first) return null;
  const act = (action: StepAction | null, className: string) => (
    <StepControl action={action} className={className} busy={busy} onGenerate={onGenerate} onImport={onImport} />
  );

  return (
    <section
      aria-labelledby="next-step"
      className="min-w-0 bg-surface-raised border border-border-active rounded-panel px-16 py-14"
    >
      <p id="next-step" className="text-small font-medium text-accent-text">
        Next step
      </p>
      <div className="mt-6 flex items-center justify-between gap-20">
        <div className="min-w-0">
          <h2 className="text-page font-semibold tracking-tight text-text-bright">{first.title}</h2>
          <p className="mt-4 text-ui text-text-body">{first.why}</p>
        </div>
        {act(first.action, PRIMARY)}
      </div>
      {failure ? (
        <p role="alert" className="mt-12 text-small text-text-secondary">
          {failure}
        </p>
      ) : null}

      {rest.length > 0 ? (
        <div className="mt-14 pt-12 border-t border-border-inner">
          <p className="text-small text-text-muted">Also waiting</p>
          <ul className="mt-6">
            {rest.map((step) => (
              <li key={step.key} className="flex items-center justify-between gap-12 py-6">
                <span className="text-row text-text-strong">{step.title}</span>
                {act(step.action, GHOST)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** A step's control: a link where it goes somewhere, a button where it does something. */
function StepControl({
  action,
  className,
  busy,
  onGenerate,
  onImport,
}: {
  action: StepAction | null;
  className: string;
  busy: boolean;
  onGenerate: (kind: RenderRow["kind"]) => void;
  onImport: () => void;
}) {
  if (!action) return null;
  const primary = className === PRIMARY;
  if (action.kind === "review") {
    return (
      <Link to="/imports/$importId" params={{ importId: action.importId }} className={`shrink-0 ${className}`}>
        {action.label}
      </Link>
    );
  }
  if (action.kind === "proposal") {
    return (
      <Link to="/proposals/$proposalId" params={{ proposalId: action.proposalId }} className={`shrink-0 ${className}`}>
        {action.label}
      </Link>
    );
  }
  if (action.kind === "import") {
    return (
      <Button
        type="button"
        variant={primary ? "primary" : "ghost"}
        onClick={onImport}
        className={primary ? "shrink-0 px-16 py-10 text-ui" : "shrink-0"}
      >
        {action.label}
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant={primary ? "primary" : "ghost"}
      onClick={() => onGenerate(action.render)}
      disabled={busy}
      disabledReason={busy ? "Generating…" : undefined}
      className={primary ? "shrink-0 px-16 py-10 text-ui" : "shrink-0"}
    >
      {action.label}
    </Button>
  );
}

function YourRecord({ tiles }: { tiles: OverviewData["tiles"] }) {
  const order: [keyof OverviewData["tiles"], string][] = [
    ["employers", "Employers"],
    ["roles", "Roles"],
    ["projects", "Projects"],
    ["credentials", "Credentials"],
  ];
  return (
    <Section
      heading={RECORD.heading}
      about={RECORD.about}
      action={
        <Link to="/record" className={`shrink-0 ${QUIET}`}>
          Open Record
        </Link>
      }
    >
      {/* 1px gaps over a border background, so the four tiles read as one object. */}
      <div className="grid grid-cols-4 gap-2 bg-border rounded-tile overflow-hidden">
        {order.map(([key, label]) => (
          <div key={key} className="bg-card px-16 py-14">
            <div className="text-small text-text-body">{label}</div>
            <div className="text-stat font-medium tracking-tight text-text-bright mt-6">
              {number(tiles[key].count)}
            </div>
            {/* A zero says so in words, so it reads as an answer and not as a
                failure to load. */}
            <div className="text-small text-text-muted mt-4 min-h-16">
              {tiles[key].count === 0 ? "None added yet" : (tiles[key].note ?? "")}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/**
 * Plain words first, the product's term second: `Measured`, `Attested` and
 * `Generated` are the words on the fact card, and mean nothing at a glance.
 */
const PROVENANCE = [
  {
    key: "measured",
    plain: "Backed by a number",
    term: "Measured",
    tone: "measured",
    about: "A result with a figure, and the passage that proves it.",
    none: "None yet",
    bar: "bg-measured",
  },
  {
    key: "attested",
    plain: "Stated by you",
    term: "Attested",
    tone: "accent",
    about: "True, and yours, with no figure behind it.",
    none: "None yet",
    bar: "bg-accent",
  },
  {
    key: "generated",
    plain: "Not confirmed",
    term: "Generated",
    tone: "generated",
    about: "Written by the importer. Left out of every document until you confirm it.",
    none: "Nothing waiting",
    bar: "bg-generated",
  },
] as const;

function Facts({
  counts,
  unconfirmed,
}: {
  counts: OverviewData["factsByProvenance"];
  unconfirmed: OverviewData["unconfirmed"];
}) {
  const total = counts.measured + counts.attested + counts.generated;

  return (
    <Section
      heading={FACTS.heading}
      about={
        <>
          {FACTS.about}
          {total > 0 ? ` ${number(total)} accepted.` : ""}
        </>
      }
    >
      {total === 0 ? (
        <p className="text-ui text-text-secondary">
          No accepted facts yet. They arrive when you review a document you imported.
        </p>
      ) : (
        <>
          <div className="flex gap-2 h-8 mb-12" aria-hidden>
            {PROVENANCE.filter((row) => counts[row.key] > 0).map((row) => (
              <div
                key={row.key}
                className={`${row.bar} rounded-mark`}
                style={{ width: `${(counts[row.key] / total) * 100}%` }}
              />
            ))}
          </div>

          <ul>
            {PROVENANCE.map((row) => {
              const n = counts[row.key];
              // The Not confirmed row is the ACTION row.
              const waiting = row.key === "generated" && n > 0;
              return (
                <li
                  key={row.key}
                  className={`flex items-center gap-12 px-10 py-10 rounded-control border-b border-border-inner last:border-b-0 ${
                    waiting ? "bg-generated-mark shadow-ring" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-8">
                      <Dot tone={row.tone} />
                      <span className="text-row font-medium text-text-strong">{row.plain}</span>
                      <span className="border border-border-control rounded-chip px-6 py-2 text-smaller text-text-muted">
                        {row.term}
                      </span>
                    </div>
                    <p className="mt-2 pl-14 text-small text-text-body">{row.about}</p>
                  </div>
                  <span className="ml-auto shrink-0 flex items-center gap-12">
                    {/* A zero is written as words, never as `0`. */}
                    {n === 0 ? (
                      <span className="text-small text-text-muted">{row.none}</span>
                    ) : (
                      <span className="text-row font-medium text-text-strong">{number(n)}</span>
                    )}
                    {waiting && unconfirmed ? (
                      <Link
                        to="/imports/$importId"
                        params={{ importId: unconfirmed.importId }}
                        className={GHOST}
                      >
                        Confirm {number(unconfirmed.count)}
                      </Link>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Section>
  );
}

/**
 * Which document to act on, said once above the rows. Five rows each reading
 * `N new facts since it was generated` beside the same three buttons said
 * nothing about where to start (issue #58).
 */
function whichDocument(rows: RenderRow[], canGenerate: boolean): string {
  const built = rows.filter((row) => row.buildable);
  const pending = built.find((row) => row.status === "proposal_pending");
  const generating = built.find((row) => row.status === "proposal_generating");
  const stale = built.filter((row) => row.status === "stale");
  if (pending) return `${pending.title} has a new version waiting for you. Check it first.`;
  if (generating) return `A new version of ${generating.title} is being written. Check it when it is ready.`;
  if (!canGenerate) {
    return "Nothing can be generated until your record holds an accepted fact a document may use.";
  }
  if (stale.length === 1) return `${stale[0]!.title} is out of date. Update it when you next need it.`;
  if (stale.length > 1) {
    return `${stale.length} of ${built.length} are out of date. Update the one you need next; each is updated on its own, and the rest can wait.`;
  }
  if (built.every((row) => row.status === "never_generated")) {
    return "None generated yet. Generate the one you need first; each is made on its own.";
  }
  return "Every document you have generated is up to date with your record.";
}

function CareerDocuments({
  rows,
  canGenerate,
  busy,
  failure,
  onGenerate,
}: {
  rows: RenderRow[];
  canGenerate: boolean;
  busy: boolean;
  failure: string | null;
  onGenerate: (kind: RenderRow["kind"]) => void;
}) {
  return (
    <Section heading={DOCUMENTS.heading} about={DOCUMENTS.about}>
      <p className="mb-6 text-ui text-text-secondary">{whichDocument(rows, canGenerate)}</p>
      {failure ? (
        <p role="alert" className="mb-6 text-small text-text-secondary">
          {failure}
        </p>
      ) : null}
      <ul>
        {rows.map((row) => (
          <li
            key={row.kind}
            className="flex items-center gap-12 px-10 py-12 border-b border-border-inner last:border-b-0"
          >
            <div className="min-w-0">
              {/* Japanese titles render in the mixed stack — the body default. */}
              <div className="text-row font-medium text-text-strong">{row.title}</div>
              <div className="text-small text-text-muted">
                {row.language === "ja" ? "Japanese" : "English"}
                {row.generatedAt ? ` · generated ${relative(row.generatedAt)}` : ""}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-16">
              <StatusText row={row} />
              {/* Offered only once there is something to read or to download:
                  the row already says `Not generated yet`. */}
              {row.currentVersionId ? (
                <>
                  <Link to="/renders/$kind/history" params={{ kind: row.kind }} className={QUIET}>
                    History
                  </Link>
                  {/* One word on every row, so the rows line up: the file's type
                      differs by document and is the document's own business. */}
                  <DownloadButton kind={row.kind} label="Download" className={QUIET} />
                </>
              ) : null}
              <Action row={row} canGenerate={canGenerate} busy={busy} onGenerate={() => onGenerate(row.kind)} />
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function StatusText({ row }: { row: RenderRow }) {
  const line = "flex items-center gap-6 text-small whitespace-nowrap";
  if (!row.buildable) {
    return (
      <span className={`${line} text-text-muted`}>
        <Dot tone="muted" /> Not available yet
      </span>
    );
  }
  if (row.status === "proposal_pending") {
    return (
      <span className={`${line} text-accent-text`}>
        <Dot tone="accent" /> New version waiting
      </span>
    );
  }
  if (row.status === "proposal_generating") {
    return (
      <span className={`${line} text-accent-text`}>
        <Dot tone="accent" /> Writing a new version
      </span>
    );
  }
  if (row.status === "never_generated") {
    return (
      <span className={`${line} text-text-muted`}>
        <Dot tone="muted" /> Not generated yet
      </span>
    );
  }
  if (row.status === "stale") {
    const n = row.newFactsSince ?? 0;
    const gone = row.withdrawnFactsSince ?? 0;
    const arrived = `${number(n)} new ${n === 1 ? "fact" : "facts"}`;
    return (
      <span className={`${line} text-accent-text`}>
        <Dot tone="accent" />{" "}
        {gone === 0
          ? arrived
          : n === 0
            ? `${number(gone)} ${gone === 1 ? "fact" : "facts"} no longer usable`
            : `${arrived}, ${number(gone)} no longer usable`}
      </span>
    );
  }
  return (
    <span className={`${line} text-measured-text`}>
      <Dot tone="measured" /> Up to date
    </span>
  );
}

/** The row's ONE button. History and Download are links beside it. */
function Action({
  row,
  canGenerate,
  busy,
  onGenerate,
}: {
  row: RenderRow;
  canGenerate: boolean;
  busy: boolean;
  onGenerate: () => void;
}) {
  if (!row.buildable) return null;
  if (row.pendingProposalId) {
    return (
      <Link to="/proposals/$proposalId" params={{ proposalId: row.pendingProposalId }} className={SECONDARY}>
        {row.status === "proposal_generating" ? "Open it" : "Review changes"}
      </Link>
    );
  }
  // Not offered at all rather than disabled five times over: the line above the
  // rows is the reason, said once.
  if (!canGenerate) return null;

  const label =
    row.status === "never_generated" ? "Generate" : row.status === "stale" ? "Update" : "Regenerate";
  return (
    <Button
      variant={row.status === "up_to_date" ? "ghost" : "secondary"}
      onClick={onGenerate}
      disabled={busy}
      disabledReason={busy ? "Generating…" : undefined}
    >
      {label}
    </Button>
  );
}

/* ------------------------------------------------------------------- empty */

/** The loop, as steps to follow rather than a paragraph to read. */
const FIRST_STEPS: [string, string][] = [
  ["Import", "a document about your work: a case study, a project write-up, a portfolio."],
  ["Review", "the facts found in it, one at a time, and keep the ones you stand behind."],
  ["Generate", "your résumé, 履歴書 and 職務経歴書 from the facts you kept."],
];

function EmptyRecord({ refresh }: { refresh: ReactNode }) {
  return (
    <>
      <Header />
      <main className="flex-1 grid place-items-center px-20 py-40">
        <div className="w-measure max-w-full">
          {refresh ? <div className="mb-26 flex justify-center">{refresh}</div> : null}
          <h2 className="text-center text-page font-semibold tracking-tight text-text-bright">
            Your record is empty
          </h2>
          <p className="mt-10 text-center text-ui text-text-body">
            Three steps turn a document you already wrote into a résumé.
          </p>
          <ol className="mt-20 grid gap-8">
            {FIRST_STEPS.map(([word, rest], index) => (
              <li
                key={word}
                className="flex items-baseline gap-12 bg-surface-raised border border-border rounded-tile px-16 py-12"
              >
                <span className="text-row font-semibold text-accent-text">{index + 1}</span>
                <span className="text-ui text-text-body">
                  <strong className="font-semibold text-text-bright">{word}</strong> {rest}
                </span>
              </li>
            ))}
          </ol>

          <ImportDropTarget className="mt-26" />

          <p className="mt-20 text-center text-small text-text-muted">
            Document generation opens up once your record holds its first facts.
          </p>
        </div>
      </main>
    </>
  );
}

/**
 * The export in one action. Neon's free plan retains a six-hour restore window,
 * so this is the recovery path for anything older — which makes it a thing to
 * reach for, not an endpoint to know about (S15).
 */
const Backup = () => (
  <Section
    heading="Backup"
    about="Your whole record as one JSON file: everything you entered, every fact, and where each fact is quoted from. The imported documents themselves are not included."
    action={
      <a href="/api/export" className={`shrink-0 ${SECONDARY}`}>
        Export my record
      </a>
    }
  />
);
