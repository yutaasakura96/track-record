/**
 * Several documents imported at once (`docs/09` Flow 8, `docs/10` Screen 3,
 * issue #93).
 *
 * Through the API, as the import screen sends them: one `POST /api/imports`
 * per file, in the order they were listed, each with its own employer. Each is
 * its own import, and they are read one at a time. Every document, employer and
 * claim here is invented.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { harness, settle, stubModel, type Client, type Harness, type StubModel } from "./helpers/harness";
import { EMPLOYER_FIXTURE, SECOND_EMAIL, seedAllowedUser, uploadForm } from "./helpers/seed";
import { ModelUnavailableError, type CandidateFact } from "~/model/types";

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

const statusOf = (importId: string, as = client) => as.json<Status>(`/api/imports/${importId}`);
const statuses = (ids: string[]) => Promise.all(ids.map(async (id) => (await statusOf(id)).status));
const readCalls = () => model.extractCalls.length;

describe("several documents chosen at once", () => {
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
