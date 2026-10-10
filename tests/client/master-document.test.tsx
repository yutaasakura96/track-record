/**
 * Screen 10, Master document (`docs/10-screen-specifications.md`, issue #57).
 *
 * A read-only view of the whole record. What matters is that the facts no
 * résumé may use are on it and marked, that nothing on it can be edited, and
 * that the download says it includes Private facts before it is pressed.
 * There is one per language (issue #59), and the tabs choose between them. All
 * fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import type { MasterDocument, MasterFact } from "~/shared/master-document";
import { useDocumentLanguageStore } from "~/client/stores/document-language";
import { mount, Refusal, type Routes } from "./harness";

const fact = (over: Partial<MasterFact> = {}): MasterFact => ({
  id: "fct-test-1",
  claim: "Cut the plinth build from 40 minutes to 6",
  provenance: "measured",
  disclosure: "restricted",
  technologies: [],
  flags: [],
  source: { importId: "sdv-test-1", filename: "quillset-notes.md", lineNumber: 12 },
  ...over,
});

const USABLE = fact();
const PRIVATE = fact({ id: "fct-test-2", claim: "Rebuilt the zentrel ledger", provenance: "attested", disclosure: "private", flags: ["confidential"] });
const GENERATED = fact({ id: "fct-test-3", claim: "Improved delivery confidence", provenance: "generated", flags: ["unsure"], source: null });
const SIDE = fact({ id: "fct-test-4", claim: "Published a tide-table tool", provenance: "attested" });

const master = (over: Partial<MasterDocument> = {}): MasterDocument => ({
  language: "en",
  builtAt: "2026-10-08T03:00:00.000Z",
  subjectName: "Test Author",
  counts: { facts: 4, usable: 2, private: 1, generated: 1, flagged: 2, waiting: 0 },
  employers: [
    {
      id: "emp-test-1",
      name: "Orrery Works",
      alternateName: "株式会社オーラリー",
      industry: "ソフトウェア",
      startedOn: "2022-04-01",
      endedOn: null,
      roles: [{ title: "Backend Engineer", startedOn: "2022-04-01", endedOn: null }],
      projects: [{ id: "prj-test-1", name: "Plinth build", summary: "The build pipeline.", facts: [USABLE, PRIVATE] }],
      facts: [GENERATED],
    },
  ],
  independent: { projects: [], facts: [SIDE] },
  educations: [
    { id: "edu-test-1", institution: "Midorikawa Institute of Technology", detail: "B.Eng.", startedOn: "2013-04-01", endedOn: "2017-03-01", outcome: "graduated" },
  ],
  certifications: [
    { id: "crt-test-1", name: "Applied Information Technology Engineer", issuingOrganization: "IPA", issuedOn: "2019-06-01", expiresOn: null },
  ],
  ...over,
});

const open = (doc: MasterDocument, routes: Routes = {}) =>
  mount("/master", {
    "GET /api/master-document": doc,
    "GET /api/imports/summary": { openCandidates: 0, openFlags: 0, running: false },
    ...routes,
  });

const rowOf = async (claim: string) => (await screen.findByText(claim)).closest("li")!;

describe("the master document", () => {
  it("lists every fact under its employer and project, the Private and the Generated with the rest", async () => {
    open(master());

    expect(within(await rowOf(USABLE.claim)).getByText("Measured")).toBeTruthy();
    expect(within(await rowOf(PRIVATE.claim)).getByText("Private")).toBeTruthy();
    expect(within(await rowOf(PRIVATE.claim)).getByText("Flagged")).toBeTruthy();
    expect(within(await rowOf(GENERATED.claim)).getByText("Generated")).toBeTruthy();
    expect(within(await rowOf(SIDE.claim)).queryByText("Flagged")).toBeNull();

    expect(screen.getByRole("heading", { name: "Orrery Works (株式会社オーラリー)" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Plinth build" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Work outside employment" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Education" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Certifications" })).toBeTruthy();
    expect(screen.getByText("Backend Engineer")).toBeTruthy();
    expect(screen.getByText(/4 facts: 2 a document may use, 1 Private,\s+1 Generated\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "2 flagged to check" }).getAttribute("href")).toBe("/flagged");
  });

  it("is read-only: one read, no write, and nothing to type into", async () => {
    const { api } = open(master());
    await screen.findByText(USABLE.claim);

    expect(api.writes()).toEqual([]);
    expect(screen.queryAllByRole("textbox")).toEqual([]);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).not.toContain("Save");
  });

  it("links each fact to its card in the document it was read from", async () => {
    open(master());
    const link = within(await rowOf(USABLE.claim)).getByRole("link");
    expect(link.getAttribute("href")).toBe("/imports/sdv-test-1?fact=fct-test-1");
    // A fact with no source document has nowhere to open.
    expect(within(await rowOf(GENERATED.claim)).queryByRole("link")).toBeNull();
  });

  it("says how many facts are still waiting to be sorted, and where to sort them", async () => {
    open(master({ counts: { facts: 4, usable: 2, private: 1, generated: 1, flagged: 0, waiting: 3 } }));
    expect(await screen.findByText(/3 more are waiting to be sorted and are not listed yet\. Sort them from Home\./)).toBeTruthy();
  });

  it("offers no download and says what to do while the record holds no fact", async () => {
    open(
      master({
        counts: { facts: 0, usable: 0, private: 0, generated: 0, flagged: 0, waiting: 0 },
        employers: [],
        independent: { projects: [], facts: [] },
        educations: [],
        certifications: [],
      }),
    );
    expect(await screen.findByText(/import a document\. Its facts appear here\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download .md" })).toBeNull();
  });

  it("downloads roles, education and certifications even without an accepted fact", async () => {
    const { api, user } = open(master({
      counts: { facts: 0, usable: 0, private: 0, generated: 0, flagged: 0, waiting: 0 },
      employers: [{ ...master().employers[0]!, projects: [], facts: [] }],
      independent: { projects: [], facts: [] },
    }), {
      "GET /api/master-document/download": new Refusal(500, "internal", "The master document could not be built."),
    });

    expect(await screen.findByText("Backend Engineer")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Education" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Certifications" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Download .md" }));
    expect(api.calls.filter((call) => `${call.method} ${call.path}` === "GET /api/master-document/download")).toHaveLength(1);
  });
});

/**
 * Issue #59. The 日本語 master document is the same view with the record named
 * as a Japanese document names it. The server decides the names; what the
 * screen owes is to ask for the right one and to head its sections in Japanese.
 */
describe("the master document in each language", () => {
  const JA_ROUTE = "GET /api/master-document?language=ja";
  const japanese = (): MasterDocument =>
    master({
      language: "ja",
      subjectName: "試験　著者",
      employers: [
        {
          ...master().employers[0]!,
          name: "株式会社オーラリー",
          alternateName: "Orrery Works",
          roles: [{ title: "バックエンドエンジニア", startedOn: "2022-04-01", endedOn: null }],
          projects: [{ id: "prj-test-1", name: "台座ビルド", summary: null, facts: [USABLE] }, { id: "prj-test-2", name: "空のプロジェクト", summary: null, facts: [] }],
          facts: [GENERATED],
        },
      ],
      educations: [
        { id: "edu-test-1", institution: "緑川工科大学", detail: "情報工学部", startedOn: "2013-04-01", endedOn: "2017-03-01", outcome: "withdrawn" },
      ],
      certifications: [
        { id: "crt-test-1", name: "応用情報技術者試験", issuingOrganization: "情報処理推進機構", issuedOn: "2019-06-01", expiresOn: null },
      ],
    });

  it("opens in English, and says the tabs change names and headings and translate nothing", async () => {
    const { api } = open(master());
    await screen.findByText(USABLE.claim);

    expect(screen.getAllByRole("tab").map((tab) => [tab.textContent, tab.getAttribute("aria-selected")])).toEqual([
      ["English", "true"],
      ["日本語", "false"],
    ]);
    expect(screen.getByText(/each fact reads\s+as it was written, and none is translated\./)).toBeTruthy();
    expect(screen.getByText(/Your résumé and your career story are written from this\./)).toBeTruthy();
    expect(api.calls.map((call) => call.path)).not.toContain("/api/master-document?language=ja");
  });

  it("reads the Japanese one under 日本語, with its sections headed in Japanese and its claims as written", async () => {
    const { api, user } = open(master(), { [JA_ROUTE]: japanese() });
    await screen.findByText(USABLE.claim);
    await user.click(screen.getByRole("tab", { name: "日本語" }));

    expect(await screen.findByRole("heading", { name: "株式会社オーラリー (Orrery Works)" })).toBeTruthy();
    expect(api.calls.map((call) => call.path)).toContain("/api/master-document?language=ja");
    for (const heading of ["台座ビルド", "その他の業務", "雇用外の活動", "学歴", "資格"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    }
    expect(screen.queryByRole("heading", { name: "Education" })).toBeNull();
    expect(screen.getByText("バックエンドエンジニア").closest("li")!.textContent).toBe("バックエンドエンジニア (2022年4月〜現在)");
    // A withdrawal reads 中退, as a 履歴書 writes it.
    expect(screen.getByText(/緑川工科大学、情報工学部/).closest("li")!.textContent).toBe(
      "緑川工科大学、情報工学部 (2013年4月〜2017年3月、中退)",
    );
    expect(screen.getByText(/応用情報技術者試験/).closest("li")!.textContent).toBe(
      "応用情報技術者試験、情報処理推進機構 (2019年6月取得)",
    );
    expect(screen.getByText("まだ事実がありません。")).toBeTruthy();
    // The claim is the one that was read from the document. Nothing translated it.
    expect(within(await rowOf(USABLE.claim)).getByText("Measured")).toBeTruthy();
    expect(screen.getByText(/Your 履歴書, 職務経歴書 and 職務経歴ストーリー are written from this\./)).toBeTruthy();
    expect(screen.getByRole("tabpanel", { name: "日本語" })).toBeTruthy();
    expect(api.writes()).toEqual([]);
  });

  it("downloads the file of the language that is open", async () => {
    const { api, user } = open(master(), {
      [JA_ROUTE]: japanese(),
      "GET /api/master-document/download?language=ja": new Refusal(500, "internal", "The master document could not be built."),
    });
    await screen.findByText(USABLE.claim);
    await user.click(screen.getByRole("tab", { name: "日本語" }));
    await screen.findByRole("heading", { name: "学歴" });
    await user.click(screen.getByRole("button", { name: "Download .md" }));

    await screen.findByRole("alert");
    const downloads = api.calls.map((call) => call.path).filter((path) => path.startsWith("/api/master-document/download"));
    expect(downloads).toEqual(["/api/master-document/download?language=ja"]);
  });

  it("opens on the language chosen on Home", async () => {
    useDocumentLanguageStore.getState().setLanguage("ja");
    open(master(), { [JA_ROUTE]: japanese() });

    expect(await screen.findByRole("heading", { name: "学歴" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "日本語" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("downloading the master document", () => {
  const DOWNLOAD = "GET /api/master-document/download";

  it("says before the press that the file includes Private facts", async () => {
    open(master());
    await screen.findByText(USABLE.claim);
    expect(screen.getByText("The file includes Private facts. It is your copy.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download .md" })).toBeTruthy();
  });

  it("asks for the file once, writes nothing, and says why when it is refused", async () => {
    const { api, user } = open(master(), {
      [DOWNLOAD]: new Refusal(500, "internal", "The master document could not be built."),
    });
    await user.click(await screen.findByRole("button", { name: "Download .md" }));

    expect((await screen.findByRole("alert")).textContent).toBe("The master document could not be built.");
    expect(api.calls.filter((c) => `${c.method} ${c.path}` === DOWNLOAD)).toHaveLength(1);
    expect(api.writes()).toEqual([]);
    // Usable again rather than stuck on "Preparing…".
    expect(screen.getByRole("button", { name: "Download .md" })).toBeTruthy();
  });
});
