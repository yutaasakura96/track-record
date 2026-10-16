/**
 * Several documents imported at once (`docs/09` Flow 8, `docs/10` Screen 3,
 * issue #93).
 *
 * Through the API, as the import screen sends them: one `POST /api/imports`
 * per file, in the order they were listed, each with its own employer. Each is
 * its own import, and they are read one at a time. Every document, employer and
 * claim here is invented.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { harness, settle, stubModel, type Client, type Harness, type StubModel } from "./helpers/harness";
import { EMPLOYER_FIXTURE, SECOND_EMAIL, seedAllowedUser, uploadForm } from "./helpers/seed";
import { ModelUnavailableError, type CandidateFact } from "~/model/types";
import type { Bindings } from "~/server/env";

interface Status {
  importId: string;
  status: "queued" | "extracting" | "ready" | "failed";
  error: { code: string; message: string } | null;
}

const DOCUMENTS = [
  {
    filename: "harbor-portfolio.md",
    text: "# Harbor routing\n\nThe dispatch rewrite cut the routing run from 40 minutes to 6.\n",
    quote: "The dispatch rewrite cut the routing run from 40 minutes to 6.",
  },
  {
    filename: "meadow-portfolio.md",
    text: "# Meadow billing\n\nInvoices now close on the first working day instead of the fifth.\n",
    quote: "Invoices now close on the first working day instead of the fifth.",
  },
  {
    filename: "quarry-portfolio.md",
    text: "# Quarry search\n\nThe new index answers a part-number lookup in under a second.\n",
    quote: "The new index answers a part-number lookup in under a second.",
  },
] as const;

const found = (index: number): CandidateFact[] => [
  { claim: `Claim from document ${index + 1}`, quote: DOCUMENTS[index]!.quote, technologies: [] },
];

let model: StubModel;
let app: Harness;
let client: Client;

beforeEach(async () => {
  model = stubModel();
  app = harness(model);
  client = app.as(await seedAllowedUser());
});

/** A model call held open until the test lets it answer. */
function held() {
  let answer!: (value: CandidateFact[] | Error) => void;
  const promise = new Promise<CandidateFact[] | Error>((resolve) => {
    answer = resolve;
  });
  return { promise, answer };
}

/** Waits for work running behind `waitUntil`, which a response does not wait for. */
async function until(condition: () => boolean | Promise<boolean>) {
  for (let tries = 0; tries < 250; tries++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the import queue.");
}

async function employer(as: Client, nameLatin: string) {
  const response = await as.post("/api/employers", { ...EMPLOYER_FIXTURE, nameLatin });
  return ((await response.json()) as { id: string }).id;
}

/** One file of the set, sent as the import screen sends it. No settling. */
async function send(index: number, fields: Record<string, string> = {}, as = client) {
  const document = DOCUMENTS[index]!;
  const form = uploadForm(document.text, document.filename);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const response = await as.request("/api/imports", { method: "POST", body: form });
  expect(response.status).toBe(202);
  return ((await response.json()) as { importId: string }).importId;
}

async function sendBatch(indices: number[], employers: (string | null)[] = []) {
  const form = new FormData();
  for (const [position, index] of indices.entries()) {
    const document = DOCUMENTS[index]!;
    form.append("file", new File([document.text], document.filename, { type: "text/markdown" }));
    form.append("filing", JSON.stringify({ employerId: employers[position] ?? undefined }));
  }
  const response = await client.request("/api/imports/batch", { method: "POST", body: form });
  expect(response.status).toBe(202);
  return (await response.json()) as { results: { importId?: string; reason?: string }[] };
}

const statusOf = (importId: string, as = client) => as.json<Status>(`/api/imports/${importId}`);
const statuses = (ids: string[]) => Promise.all(ids.map(async (id) => (await statusOf(id)).status));
const readCalls = () => model.extractCalls.length;

describe("several documents chosen at once", () => {
  it("relaunches a claimed import whose Workflow was lost before it began", async () => {
    const instances = new Map<string, { status: () => Promise<{ status: string }>; restart: () => Promise<void> }>();
    const launched: string[] = [];
    const workflow = {
      async get(id: string) {
        const instance = instances.get(id);
        if (!instance) throw new Error("Instance missing");
        return instance;
      },
      async create(options: { id: string }) {
        if (instances.has(options.id)) throw new Error("Instance exists");
        launched.push(options.id);
        const instance = { status: async () => ({ status: "running" }), restart: async () => {} };
        instances.set(options.id, instance);
        return instance;
      },
    } as unknown as NonNullable<Bindings["IMPORT_WORKFLOW"]>;
    app = harness(model, { workflow });
    client = app.as(await seedAllowedUser());
    const answer = await sendBatch([0, 1]);
    const ids = answer.results.map((row) => row.importId!);
    expect(await statuses(ids)).toEqual(["extracting", "queued"]);
    instances.delete(ids[0]!);
    await client.json("/api/overview");
    expect(launched).toEqual([ids[0], ids[0]]);
    await client.json("/api/imports");
    expect(launched).toEqual([ids[0], ids[0]]);
    expect(await statuses(ids)).toEqual(["extracting", "queued"]);
  });

  it("keeps answering when the Workflow API throws while an import is extracting", async () => {
    let broken = false;
    const workflow = {
      async get() {
        if (broken) throw new Error("Workflow API unavailable");
        throw new Error("Instance missing");
      },
      async create() {
        if (broken) throw new Error("Workflow API unavailable");
        return { status: async () => ({ status: "running" }), restart: async () => {} };
      },
    } as unknown as NonNullable<Bindings["IMPORT_WORKFLOW"]>;
    app = harness(model, { workflow });
    client = app.as(await seedAllowedUser());
    const answer = await sendBatch([0, 1]);
    const ids = answer.results.map((row) => row.importId!);
    expect(await statuses(ids)).toEqual(["extracting", "queued"]);
    broken = true;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await client.request("/api/overview")).status).toBe(200);
      expect((await client.request("/api/imports")).status).toBe(200);
      expect((await client.request(`/api/imports/${ids[0]}`)).status).toBe(200);

      const more = await sendBatch([2]);
      expect(more.results.map((row) => Boolean(row.importId))).toEqual([true]);

      const form = uploadForm(DOCUMENTS[0].text, DOCUMENTS[0].filename);
      expect((await client.request("/api/imports", { method: "POST", body: form })).status).toBe(202);

      expect(logged).toHaveBeenCalled();
      for (const call of logged.mock.calls) {
        const line = String(call[0]);
        expect(line).toContain("import_recovery_failed");
        expect(line).not.toContain("Workflow API unavailable");
      }
    } finally {
      logged.mockRestore();
    }
    expect(await statuses(ids)).toEqual(["extracting", "queued"]);
  });

  it("shows waiting files in the same order the queue will read them", async () => {
    const first = held();
    model.extractions = [first.promise, found(1), found(2), found(0), found(1), found(2)];
    const answer = await sendBatch([0, 1, 2, 0, 1, 2]);
    const ids = answer.results.map((row) => row.importId!);
    await until(() => readCalls() === 1);
    const home = await client.json<{ waitingImports: { importId: string }[] }>("/api/overview");
    expect(home.waitingImports.map((row) => row.importId)).toEqual(ids.slice(1));
    first.answer(found(0));
    await settle();
    expect(await statuses(ids)).toEqual(Array(6).fill("ready"));
  });

  it("stores the whole set before answering and keeps completed results on Home", async () => {
    const harbor = await employer(client, "Harbor Freight Systems");
    const meadow = await employer(client, "Meadow Utilities");
    const first = held();
    model.extractions = [first.promise, new ModelUnavailableError("Anthropic is unavailable."), found(2)];
    const answer = await sendBatch([0, 1, 2], [harbor, meadow, harbor]);
    const ids = answer.results.map((row) => row.importId!);
    expect(ids).toHaveLength(3);
    await until(() => readCalls() === 1);
    expect(await statuses(ids)).toEqual(["extracting", "queued", "queued"]);
    first.answer(found(0));
    await settle();
    expect(await statuses(ids)).toEqual(["ready", "failed", "ready"]);
    const home = await client.json<{ latestImportSet: { importId: string; status: string }[] }>("/api/overview");
    expect(home.latestImportSet.map(({ importId, status }) => [importId, status])).toEqual([
      [ids[0], "ready"], [ids[1], "failed"], [ids[2], "ready"],
    ]);
    const listing = await client.json<{ documents: { filename: string; employer: { id: string } | null }[] }>("/api/imports");
    expect(Object.fromEntries(listing.documents.map((row) => [row.filename, row.employer?.id]))).toEqual({
      "harbor-portfolio.md": harbor, "meadow-portfolio.md": meadow, "quarry-portfolio.md": harbor,
    });
    model.extractions = [found(1)];
    expect((await client.post(`/api/imports/${ids[1]}/retry`)).status).toBe(200);
    await settle();
    const retried = await client.json<{ latestImportSet: { status: string }[] }>("/api/overview");
    expect(retried.latestImportSet.map((row) => row.status)).toEqual(["ready", "ready", "ready"]);
    await sendBatch([0]);
    const next = await client.json<{ latestImportSet: { importId: string }[] }>("/api/overview");
    expect(next.latestImportSet).toHaveLength(1);
  });

  it("refuses one invalid file without losing the accepted rows", async () => {
    const form = new FormData();
    form.append("file", new File([DOCUMENTS[0].text], DOCUMENTS[0].filename));
    form.append("filing", "{}");
    form.append("file", new File(["pdf"], "unsupported.pdf"));
    form.append("filing", "{}");
    form.append("file", new File([DOCUMENTS[2].text], DOCUMENTS[2].filename));
    form.append("filing", "{}");
    model.extractions = [found(0), found(2)];
    const response = await client.request("/api/imports/batch", { method: "POST", body: form });
    expect(response.status).toBe(202);
    const answer = (await response.json()) as { results: { importId?: string; reason?: string }[] };
    expect(answer.results.map((row) => Boolean(row.importId))).toEqual([true, false, true]);
    expect(answer.results[1]?.reason).toContain(".pdf import is not built yet");
    await settle();
    expect(await statuses([answer.results[0]!.importId!, answer.results[2]!.importId!])).toEqual(["ready", "ready"]);
  });
  it("become one import each, every one under the employer chosen for it", async () => {
    const harbor = await employer(client, "Harbor Freight Systems");
    const meadow = await employer(client, "Meadow Utilities");
    model.extractions = [found(0), found(1), found(2)];

    const ids = [
      await send(0, { employerId: harbor }),
      await send(1, { employerId: meadow }),
      await send(2, { employerId: harbor }),
    ];
    await settle();

    expect(new Set(ids).size).toBe(3);
    expect(await statuses(ids)).toEqual(["ready", "ready", "ready"]);

    const listing = await client.json<{
      documents: { filename: string; employer: { id: string } | null; versions: unknown[] }[];
    }>("/api/imports");
    const employerOf = Object.fromEntries(listing.documents.map((d) => [d.filename, d.employer?.id ?? null]));
    expect(employerOf).toEqual({
      "harbor-portfolio.md": harbor,
      "meadow-portfolio.md": meadow,
      "quarry-portfolio.md": harbor,
    });
    expect(listing.documents.every((d) => d.versions.length === 1)).toBe(true);

    // And each document's facts read their employer through it.
    for (const [index, id] of ids.entries()) {
      const { items } = await client.json<{ items: { employerId: string | null }[] }>(`/api/facts?importId=${id}`);
      expect(items.map((fact) => fact.employerId)).toEqual([[harbor, meadow, harbor][index]]);
    }
  });
});

describe("reading one document at a time", () => {
  it("does not start reading the second until the first is done", async () => {
    const first = held();
    model.extractions = [first.promise, found(1), found(2)];

    const ids = [await send(0), await send(1), await send(2)];
    await until(() => readCalls() === 1);
    // Long enough for a second read to have begun, had anything started one.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(readCalls()).toBe(1);
    expect(await statuses(ids)).toEqual(["extracting", "queued", "queued"]);

    // Home names the one being read, and the rest in the order they will be.
    const home = await client.json<{
      activeImport: { importId: string; filename: string } | null;
      waitingImports: { importId: string; filename: string }[];
    }>("/api/overview");
    expect(home.activeImport).toMatchObject({ importId: ids[0], filename: "harbor-portfolio.md" });
    expect(home.waitingImports).toEqual([
      { importId: ids[1], filename: "meadow-portfolio.md" },
      { importId: ids[2], filename: "quarry-portfolio.md" },
    ]);

    first.answer(found(0));
    await settle();

    expect(await statuses(ids)).toEqual(["ready", "ready", "ready"]);
    // Read in the order the files were listed.
    expect(model.extractCalls.map((text) => DOCUMENTS.findIndex((d) => text.includes(d.quote)))).toEqual([0, 1, 2]);
  });

  it("does not start reading the second until the first has failed", async () => {
    const first = held();
    model.extractions = [first.promise, found(1)];

    const ids = [await send(0), await send(1)];
    await until(() => readCalls() === 1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(readCalls()).toBe(1);
    expect(await statuses(ids)).toEqual(["extracting", "queued"]);

    first.answer(new ModelUnavailableError("Anthropic is unavailable."));
    await settle();

    expect(readCalls()).toBe(2);
    expect(await statuses(ids)).toEqual(["failed", "ready"]);
  });

  it("holds an author's queue for that author alone", async () => {
    const other = app.as(await seedAllowedUser(SECOND_EMAIL));
    const first = held();
    model.extractions = [first.promise, found(1)];

    const mine = await send(0);
    await until(() => readCalls() === 1);
    const theirs = await send(1, {}, other);

    await until(async () => (await statusOf(theirs, other)).status === "ready");
    expect((await statusOf(mine)).status).toBe("extracting");

    first.answer(found(0));
    await settle();
    expect((await statusOf(mine)).status).toBe("ready");
  });
});

describe("a document that fails", () => {
  it("leaves the others to finish, and is retried on its own", async () => {
    model.extractions = [found(0), new ModelUnavailableError("Anthropic is unavailable."), found(2)];

    const ids = [await send(0), await send(1), await send(2)];
    await settle();

    expect(await statuses(ids)).toEqual(["ready", "failed", "ready"]);
    expect((await statusOf(ids[1]!)).error?.code).toBe("extraction_failed");

    model.extractions = [found(1)];
    const retried = await client.post(`/api/imports/${ids[1]}/retry`);
    expect(retried.status).toBe(200);
    await settle();

    expect(await statuses(ids)).toEqual(["ready", "ready", "ready"]);
    // The retry read that document alone: nothing was read twice.
    expect(readCalls()).toBe(4);
  });

  it("is not put back in the queue by a retry while it is still waiting", async () => {
    const first = held();
    model.extractions = [first.promise, found(1)];

    const ids = [await send(0), await send(1)];
    await until(() => readCalls() === 1);

    // A retry of the one being read, and of the one waiting, changes neither.
    await client.post(`/api/imports/${ids[0]}/retry`);
    await client.post(`/api/imports/${ids[1]}/retry`);
    expect(await statuses(ids)).toEqual(["extracting", "queued"]);
    expect(readCalls()).toBe(1);

    first.answer(found(0));
    await settle();
    expect(await statuses(ids)).toEqual(["ready", "ready"]);
    expect(readCalls()).toBe(2);
  });
});
