/**
 * The 履歴書's 写真 (issue #117, review issue 8), through the API.
 *
 * What is pinned here: an optional photo on the profile, refused unless it is
 * a JPEG or PNG at 3:4 and under the size limit; read back only by its owner,
 * never inlined into the profile and never cached; kept when the form is
 * saved; removable for good; and placed in the downloaded 履歴書's 写真 cell,
 * or the cell left empty and the review footer told so. A sent copy keeps the
 * photo it was sent with.
 *
 * Every image here is INVENTED (`./helpers/photo.ts`): a flat colour and a
 * block, never a photograph of anyone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";
import { harness, settle, stubModel, type Client, type Harness, type StubModel } from "./helpers/harness";
import { EDUCATION_FIXTURE, PROFILE_FIXTURE, SECOND_EMAIL, postJob, seedAllowedUser, uploadForm } from "./helpers/seed";
import { jpegPhoto, pngPhoto } from "./helpers/photo";
import type { CandidateFact } from "~/model/types";
import { readSheet, sheetHasPhoto, type Sheet } from "~/render/sheet";
import type { RenderContent } from "~/shared/render-content";
import { PHOTO_MAX_BYTES, PHOTO_NOTICE, photoInfo, photoRefusal } from "~/shared/photo";

const USABLE: CandidateFact = {
  claim: "Moved the harbour ledger onto the new batch platform",
  quote: "The harbour ledger moved onto the new batch platform that spring.",
  technologies: [],
  provenance: "measured",
};

const PHOTO = pngPhoto(300, 400);

interface Profile {
  hasPhoto: boolean;
  photoVersion: string | null;
  photo?: unknown;
}

let model: StubModel;
let app: Harness;
let client: Client;
let captured: string[];

beforeEach(async () => {
  captured = [];
  for (const method of ["log", "error", "warn", "info", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      captured.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
  model = stubModel();
  app = harness(model);
  client = app.as(await seedAllowedUser());
});

afterEach(() => {
  vi.restoreAllMocks();
});

const putPhoto = (bytes: Uint8Array, as: Client = client, type = "image/png") =>
  as.request("/api/profile/photo", { method: "PUT", body: bytes as BodyInit, headers: { "content-type": type } });

const refusal = async (response: Response) => {
  expect(response.status).toBe(422);
  const body = (await response.json()) as { error: { message: string; details: { fields: string[] } } };
  expect(body.error.details.fields).toEqual(["photo"]);
  return body.error.message;
};

const bytesOf = async (response: Response) => new Uint8Array(await response.arrayBuffer());

describe("putting a photo on the profile", () => {
  it("needs a profile to put it on", async () => {
    expect((await putPhoto(PHOTO)).status).toBe(404);
  });

  it("keeps a 3:4 PNG, reports it on the profile without inlining it, and reads it back byte for byte, uncached", async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
    const response = await putPhoto(PHOTO);
    expect(response.status).toBe(200);
    const saved = (await response.json()) as Profile;
    expect(saved.hasPhoto).toBe(true);
    expect(saved.photoVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(saved).not.toHaveProperty("photo");

    const profile = await client.json<Profile>("/api/profile");
    expect(profile).toMatchObject({ hasPhoto: true, photoVersion: saved.photoVersion });
    expect(JSON.stringify(profile).length).toBeLessThan(4_000);

    const photo = await client.get("/api/profile/photo");
    expect(photo.status).toBe(200);
    expect(photo.headers.get("content-type")).toBe("image/png");
    expect(photo.headers.get("cache-control")).toBe("private, no-store");
    expect(photo.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await bytesOf(photo)).toEqual(PHOTO);
  });

  it("decides the type from the bytes, not from what the request claims", async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
    expect((await putPhoto(PHOTO, client, "image/jpeg")).status).toBe(200);
    expect((await client.get("/api/profile/photo")).headers.get("content-type")).toBe("image/png");
    expect((await putPhoto(jpegPhoto(300, 400))).status).toBe(200);
    expect((await client.get("/api/profile/photo")).headers.get("content-type")).toBe("image/jpeg");
  });

  it("refuses what is not a JPEG or PNG, and keeps nothing", async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
    const gif = new TextEncoder().encode("GIF89a not a photo at all");
    expect(await refusal(await putPhoto(gif, client, "image/gif"))).toContain("not a JPEG or PNG");
    expect(await refusal(await putPhoto(new Uint8Array()))).toContain("not a JPEG or PNG");
    expect((await client.json<Profile>("/api/profile")).hasPhoto).toBe(false);
  });

  it("refuses a photo that is not cropped to 3:4, or too small to print", async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
    expect(await refusal(await putPhoto(pngPhoto(400, 300)))).toContain("3:4");
    expect(await refusal(await putPhoto(jpegPhoto(600, 600), client, "image/jpeg"))).toContain("3:4");
    expect(await refusal(await putPhoto(pngPhoto(150, 200)))).toContain("too small");
    expect((await client.json<Profile>("/api/profile")).hasPhoto).toBe(false);
  });

  it("refuses incomplete PNG and JPEG files with the plain image error", async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
    const badCrc = PHOTO.slice();
    badCrc[29] = badCrc[29]! ^ 1;
    for (const bytes of [
      PHOTO.subarray(0, 24),
      PHOTO.subarray(0, PHOTO.length - 8),
      badCrc,
      jpegPhoto(300, 400).subarray(0, 39),
      jpegPhoto(300, 400).subarray(0, -2),
    ]) {
      expect(await refusal(await putPhoto(bytes))).toBe("That file is not a JPEG or PNG image, so it was not kept.");
    }
    expect((await client.json<Profile>("/api/profile")).hasPhoto).toBe(false);
  });

  it("refuses a file over the limit, whatever its header says", async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
    const big = new Uint8Array(PHOTO_MAX_BYTES + 1);
    big.set(jpegPhoto(600, 800));
    expect(await refusal(await putPhoto(big, client, "image/jpeg"))).toContain("over 2 MB");
  });

  it("replaces the photo before it, and the version moves", async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
    const first = (await (await putPhoto(PHOTO)).json()) as Profile;
    const other = pngPhoto(450, 600);
    const second = (await (await putPhoto(other)).json()) as Profile;
    expect(second.photoVersion).not.toBe(first.photoVersion);
    expect(await bytesOf(await client.get("/api/profile/photo"))).toEqual(other);
  });

  it("is kept when the profile form is saved again", async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
    await putPhoto(PHOTO);
    const saved = (await (await client.put("/api/profile", { ...PROFILE_FIXTURE, nameLatin: "Y. Aoki" })).json()) as Profile;
    expect(saved.hasPhoto).toBe(true);
    expect(await bytesOf(await client.get("/api/profile/photo"))).toEqual(PHOTO);
  });

  it("is removed for good, and removing none is not an error", async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
    await putPhoto(PHOTO);
    const removed = await client.delete("/api/profile/photo");
    expect(removed.status).toBe(200);
    expect((await removed.json()) as Profile).toMatchObject({ hasPhoto: false, photoVersion: null });
    expect((await client.get("/api/profile/photo")).status).toBe(404);
    expect((await client.delete("/api/profile/photo")).status).toBe(200);
  });

  it("is read by its owner alone", async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
    await putPhoto(PHOTO);
    const other = app.as(await seedAllowedUser(SECOND_EMAIL));
    await other.put("/api/profile", PROFILE_FIXTURE);
    expect((await other.get("/api/profile/photo")).status).toBe(404);
    expect((await other.json<Profile>("/api/profile")).hasPhoto).toBe(false);
    // Removing their own touches nobody else's.
    await other.delete("/api/profile/photo");
    expect((await client.get("/api/profile/photo")).status).toBe(200);
  });

  it("writes nothing of the image to the log: its type and size, and no bytes", async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
    await putPhoto(PHOTO);
    await client.get("/api/profile/photo");
    await client.delete("/api/profile/photo");
    const log = captured.join("\n");
    expect(log).toContain("profile_photo_saved");
    expect(log).toContain("profile_photo_removed");
    expect(log).not.toContain("IHDR");
    expect(log).not.toMatch(/iVBOR|base64|\\x89/);
    expect(log.length).toBeLessThan(5_000);
  });
});

describe("the 写真 on the 履歴書", () => {
  const content = (factId: string): RenderContent => ({
    sections: [
      { key: "motivation", heading: "志望動機・特技・アピールポイントなど", blocks: [{ id: "blk_1", kind: "paragraph", text: "港湾台帳の移行で培った経験を活かしたい。", factIds: [factId] }] },
      { key: "kibou", heading: "本人希望欄", blocks: [{ id: "blk_2", kind: "paragraph", text: "貴社規定に従います。", factIds: [] }] },
    ],
  });

  /** A profile, an employer, an education and one fact, and the 履歴書's proposal generated from them. */
  async function propose(): Promise<{ proposalId: string; warnings: string[] }> {
    await client.put("/api/profile", PROFILE_FIXTURE);
    await postJob(client);
    await client.post("/api/educations", EDUCATION_FIXTURE);
    model.extractions = [[USABLE]];
    await client.request("/api/imports", { method: "POST", body: uploadForm(`# Notes\n\n${USABLE.quote}\n`) });
    await settle();
    const { items } = await client.json<{ items: { id: string }[] }>("/api/facts");
    await client.post(`/api/facts/${items[0]!.id}/accept`);
    model.generations = [content(items[0]!.id)];
    const response = await client.post("/api/renders/rirekisho/generate");
    await settle();
    return (await response.json()) as { proposalId: string; warnings: string[] };
  }

  const download = async () => {
    const response = await client.get("/api/renders/rirekisho/download?format=docx");
    expect(response.status).toBe(200);
    return new PizZip(await response.arrayBuffer());
  };

  it("tells the review footer the cell is empty while the profile has no photo, and stops once it has one", async () => {
    const { proposalId, warnings } = await propose();
    expect(warnings).toContain(PHOTO_NOTICE);
    expect((await client.json<{ warnings: string[] }>(`/api/proposals/${proposalId}`)).warnings).toContain(PHOTO_NOTICE);

    await putPhoto(PHOTO);
    expect((await client.json<{ warnings: string[] }>(`/api/proposals/${proposalId}`)).warnings).not.toContain(PHOTO_NOTICE);
  });

  it("places the photo in the downloaded file's 写真 cell, and in the page View reads out of it", async () => {
    const { proposalId } = await propose();
    await putPhoto(PHOTO);

    // The first version is read before it is accepted, photo included.
    const preview = await client.json<{ preview: { page: { sheet: Sheet } } }>(`/api/proposals/${proposalId}/diff`);
    expect(sheetHasPhoto(preview.preview.page.sheet)).toBe(true);
    await client.post(`/api/proposals/${proposalId}/accept`);

    const zip = await download();
    expect(zip.file("word/media/photo.png")!.asUint8Array()).toEqual(PHOTO);
    expect(zip.file("word/_rels/document.xml.rels")!.asText()).toContain('Target="media/photo.png"');
    expect(zip.file("[Content_Types].xml")!.asText()).toContain('<Default Extension="png" ContentType="image/png"/>');
    const identity = /<w:tbl>[\s\S]*?<\/w:tbl>/.exec(zip.file("word/document.xml")!.asText())![0];
    const cell = [...identity.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((m) => m[0]).find((c) => c.includes('<w:vMerge w:val="restart"/>'))!;
    expect(cell).toContain('<wp:extent cx="1080000" cy="1440000"/>');

    const view = await client.json<{ page: { sheet: Sheet } }>("/api/renders/rirekisho/page");
    expect(sheetHasPhoto(view.page.sheet)).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(/iVBOR|base64/);
  });

  it("leaves the cell empty without a photo, and takes it out again when the photo is removed", async () => {
    const { proposalId } = await propose();
    await client.post(`/api/proposals/${proposalId}/accept`);
    expect((await download()).file(/word\/media\//)).toEqual([]);
    expect(sheetHasPhoto((await client.json<{ page: { sheet: Sheet } }>("/api/renders/rirekisho/page")).page.sheet)).toBe(false);

    await putPhoto(PHOTO);
    expect((await download()).file("word/media/photo.png")).not.toBeNull();
    await client.delete("/api/profile/photo");
    expect((await download()).file(/word\/media\//)).toEqual([]);
  });

  it("stays on a sent copy as it was sent, after the profile's is removed, and is read from the stored file", async () => {
    const { proposalId } = await propose();
    await putPhoto(PHOTO);
    await client.post(`/api/proposals/${proposalId}/accept`);
    const made = (await (await client.post("/api/applications", { company: "Harrowgate Signals", position: "Backend Engineer", jobDescription: "Harrowgate Signals is hiring a backend engineer for its tide-gauge telemetry service." })).json()) as { id: string };
    await client.put(`/api/applications/${made.id}/documents`, { documents: ["rirekisho"] });
    const applied = (await (await client.post(`/api/applications/${made.id}/steps`, { status: "applied" })).json()) as { sentCopies: { id: string }[] };
    const copyId = applied.sentCopies[0]!.id;

    await client.delete("/api/profile/photo");
    const photo = await client.get(`/api/applications/${made.id}/sent-copies/${copyId}/photo`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get("cache-control")).toBe("private, no-store");
    expect(await bytesOf(photo)).toEqual(PHOTO);
    const stored = new PizZip(await (await client.get(`/api/applications/${made.id}/sent-copies/${copyId}/download`)).arrayBuffer());
    expect(sheetHasPhoto(readSheet(stored.generate({ type: "uint8array" })))).toBe(true);

    // Another member cannot reach it, as they cannot reach the copy.
    const other = app.as(await seedAllowedUser(SECOND_EMAIL));
    expect((await other.get(`/api/applications/${made.id}/sent-copies/${copyId}/photo`)).status).toBe(404);
  });
});

describe("reading a photo's header", () => {
  it("reads a PNG's size from IHDR and a JPEG's from its first frame, past the segments before it", () => {
    expect(photoInfo(pngPhoto(300, 400))).toEqual({ type: "image/png", width: 300, height: 400 });
    expect(photoInfo(jpegPhoto(600, 800))).toEqual({ type: "image/jpeg", width: 600, height: 800 });
    // A progressive frame (SOF2), behind fill bytes and a second APP segment.
    const progressive = jpegPhoto(450, 600);
    progressive[21] = 0xc2;
    const padded = new Uint8Array([...progressive.subarray(0, 20), 0xff, 0xff, 0xe1, 0x00, 0x04, 0x00, 0x00, ...progressive.subarray(20)]);
    expect(photoInfo(padded)).toEqual({ type: "image/jpeg", width: 450, height: 600 });
  });

  it("reads nothing out of what is not a JPEG or PNG, or stops before its frame", () => {
    expect(photoInfo(new TextEncoder().encode("GIF89a"))).toBeNull();
    expect(photoInfo(jpegPhoto(600, 800).subarray(0, 22))).toBeNull();
    expect(photoInfo(new Uint8Array())).toBeNull();
  });

  it("takes 3:4 to within the pixel a crop rounds to", () => {
    expect(photoRefusal({ type: "image/jpeg", width: 600, height: 800 })).toBeNull();
    expect(photoRefusal({ type: "image/jpeg", width: 601, height: 800 })).toBeNull();
    expect(photoRefusal({ type: "image/jpeg", width: 610, height: 800 })).toContain("3:4");
    expect(photoRefusal({ type: "image/png", width: 299, height: 399 })).toContain("too small");
    expect(photoRefusal(null)).toContain("not a JPEG or PNG");
  });
});
