/**
 * The 履歴書's 写真 on the profile (issue #117, review issue 8): cropping it to
 * 3:4, saving it, and removing it.
 *
 * jsdom decodes no image and draws on no canvas, so both are stood in for
 * here: the image reports a size, and the canvas records what it was asked to
 * copy. What is asserted is the part of the image the frame kept, which is the
 * only part that has to be right. Every image is invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { mount, Refusal } from "./harness";
import { INITIAL_CROP, MAX_ZOOM, clampCrop, coverScale, sourceRect } from "~/client/photo-crop";
import { PHOTO_TOO_SMALL } from "~/shared/photo";

const FRAME = { width: 240, height: 320 };

describe("the crop, in numbers", () => {
  it("covers the 3:4 frame with the image at zoom 1, cutting the longer side", () => {
    const landscape = { width: 1200, height: 900 };
    expect(coverScale(landscape, FRAME)).toBeCloseTo(320 / 900);
    // Centred: the middle three quarters of the height's width, all of its height.
    expect(sourceRect(landscape, FRAME, INITIAL_CROP)).toEqual({ x: 262.5, y: 0, width: 675, height: 900 });
  });

  it("keeps exactly 3:4 at any zoom and offset", () => {
    for (const crop of [INITIAL_CROP, { zoom: 2, offset: { x: 30, y: -40 } }, { zoom: MAX_ZOOM, offset: { x: -999, y: 999 } }]) {
      const rect = sourceRect({ width: 3000, height: 2000 }, FRAME, crop);
      expect(rect.width / rect.height).toBeCloseTo(3 / 4);
    }
  });

  it("never lets the frame show past the image's edge, or zoom out past covering it", () => {
    const image = { width: 600, height: 800 };
    const held = clampCrop(image, FRAME, { zoom: 0.5, offset: { x: 50, y: -50 } });
    expect(held).toEqual({ zoom: 1, offset: { x: 0, y: 0 } });

    const zoomed = clampCrop(image, FRAME, { zoom: 2, offset: { x: 1000, y: -1000 } });
    expect(zoomed).toEqual({ zoom: 2, offset: { x: 120, y: -160 } });
    const rect = sourceRect(image, FRAME, zoomed);
    // Pushed right and up as far as it goes: the image's left edge and its bottom half.
    expect(rect).toEqual({ x: 0, y: 400, width: 300, height: 400 });
    expect(clampCrop(image, FRAME, { zoom: 9, offset: { x: 0, y: 0 } }).zoom).toBe(MAX_ZOOM);
  });
});

/** An `Image` that "decodes" at once to the size given, as a browser would. */
function decodingAs(size: { width: number; height: number } | "unreadable") {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = size === "unreadable" ? 0 : size.width;
    naturalHeight = size === "unreadable" ? 0 : size.height;
    set src(_: string) {
      setTimeout(() => (size === "unreadable" ? this.onerror?.() : this.onload?.()), 0);
    }
  }
  vi.stubGlobal("Image", FakeImage);
}

let drawn: number[][];
let resized: (() => void) | undefined;

beforeEach(() => {
  drawn = [];
  resized = undefined;
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resized = callback; }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:photo-test", revokeObjectURL: () => {} }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => ({ drawImage: (...args: unknown[]) => drawn.push(args.slice(1) as number[]) }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (callback: BlobCallback) {
    callback(new Blob(["jpeg"], { type: "image/jpeg" }));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const PROFILE = { id: "profile-test-1", hasPhoto: false, photoVersion: null };
const WITH_PHOTO = { ...PROFILE, hasPhoto: true, photoVersion: "a1b2c3d4e5f6" };

const panel = async () => within((await screen.findByRole("heading", { name: "写真 · Photo" })).closest("section")!);
const choose = (name = "invented.png") =>
  fireEvent.change(screen.getByLabelText("Choose a photo"), { target: { files: [new File(["png"], name, { type: "image/png" })] } });

describe("the photo on the profile", () => {
  it("is offered once there is a profile, and says where it goes", async () => {
    mount("/profile", { "GET /api/profile": PROFILE });
    const photo = await panel();
    expect(photo.getByText(/Placed in the 履歴書's 写真 cell at 30 × 40 mm, and in no other document/)).toBeTruthy();
    expect(photo.getByRole("button", { name: "Add a photo" })).toBeTruthy();
    expect(photo.queryByRole("button", { name: "Remove photo" })).toBeNull();
  });

  it("waits for the profile on a first run", async () => {
    mount("/profile", { "GET /api/profile": new Refusal(404, "not_found", "No profile.") });
    const photo = await panel();
    expect(photo.getByText(/Save your details first/)).toBeTruthy();
    expect(photo.queryByRole("button", { name: "Add a photo" })).toBeNull();
  });

  it("crops what was chosen to the frame and sends only that, as a JPEG, on its own", async () => {
    decodingAs({ width: 1200, height: 900 });
    const { api } = mount("/profile", { "GET /api/profile": PROFILE, "PUT /api/profile/photo": WITH_PHOTO });
    const photo = await panel();
    choose();

    const frame = await photo.findByRole("img", { name: /The part of the photo that is kept/ });
    // Moved with the keys: two steps right.
    fireEvent.keyDown(frame, { key: "ArrowRight" });
    fireEvent.keyDown(frame, { key: "ArrowRight" });
    fireEvent.click(photo.getByRole("button", { name: "Save photo" }));

    await waitFor(() => expect(api.writes()).toEqual(["PUT /api/profile/photo"]));
    // 16 frame pixels right is 45 image pixels left of centre, at 320/900.
    const [x, y, width, height, , , outWidth, outHeight] = drawn[0]!;
    expect(width! / height!).toBeCloseTo(3 / 4);
    expect(x).toBeCloseTo(262.5 - 45);
    expect(y).toBe(0);
    expect([outWidth, outHeight]).toEqual([600, 800]);
    // Saved: the cropper gives way to the photo and its controls.
    expect(await photo.findByRole("img", { name: "Your 履歴書 photo" })).toBeTruthy();
    expect(photo.getByRole("img", { name: "Your 履歴書 photo" }).getAttribute("src")).toBe("/api/profile/photo?v=a1b2c3d4e5f6");
  });

  it("saves the displayed region after the frame narrows", async () => {
    decodingAs({ width: 600, height: 800 });
    let frameSize = FRAME;
    vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
      width: frameSize.width, height: frameSize.height,
    }) as DOMRect);
    const { api } = mount("/profile", { "GET /api/profile": PROFILE, "PUT /api/profile/photo": WITH_PHOTO });
    const photo = await panel();
    choose();
    const frame = await photo.findByRole("img", { name: /The part of the photo that is kept/ });
    fireEvent.change(photo.getByRole("slider"), { target: { value: "2" } });
    for (let i = 0; i < 10; i++) fireEvent.keyDown(frame, { key: "ArrowRight" });
    frameSize = { width: 120, height: 160 };
    act(() => resized?.());
    const image = frame.querySelector("img")!;
    expect(image.style.left).toBe("0px");
    fireEvent.click(photo.getByRole("button", { name: "Save photo" }));
    await waitFor(() => expect(api.writes()).toEqual(["PUT /api/profile/photo"]));
    expect(drawn[0]!.slice(0, 4)).toEqual([0, 200, 300, 400]);
  });

  it("refuses a photo too small to print before sending anything", async () => {
    decodingAs({ width: 200, height: 260 });
    const { api } = mount("/profile", { "GET /api/profile": PROFILE });
    const photo = await panel();
    choose();
    fireEvent.click(await photo.findByRole("button", { name: "Save photo" }));
    expect((await photo.findByRole("alert")).textContent).toBe(PHOTO_TOO_SMALL);
    expect(api.writes()).toEqual([]);
  });

  it("says when the browser cannot open the file", async () => {
    decodingAs("unreadable");
    mount("/profile", { "GET /api/profile": PROFILE });
    const photo = await panel();
    choose("invented.heic");
    expect((await photo.findByRole("alert")).textContent).toContain("cannot open that image");
  });

  it("states the server's refusal and keeps the cropper", async () => {
    decodingAs({ width: 600, height: 800 });
    mount("/profile", {
      "GET /api/profile": PROFILE,
      "PUT /api/profile/photo": new Refusal(422, "validation_failed", "The photo is not cropped to 3:4, so it was not kept.", { fields: ["photo"] }),
    });
    const photo = await panel();
    choose();
    fireEvent.click(await photo.findByRole("button", { name: "Save photo" }));
    expect((await photo.findByRole("alert")).textContent).toContain("not cropped to 3:4");
    expect(photo.getByRole("button", { name: "Save photo" })).toBeTruthy();
  });

  it("cancels without sending", async () => {
    decodingAs({ width: 600, height: 800 });
    const { api } = mount("/profile", { "GET /api/profile": PROFILE });
    const photo = await panel();
    choose();
    fireEvent.click(await photo.findByRole("button", { name: "Cancel" }));
    expect(photo.getByRole("button", { name: "Add a photo" })).toBeTruthy();
    expect(api.writes()).toEqual([]);
  });

  it("shows the saved photo, and Remove takes it off", async () => {
    const { api } = mount("/profile", { "GET /api/profile": WITH_PHOTO, "DELETE /api/profile/photo": PROFILE });
    const photo = await panel();
    expect(photo.getByRole("img", { name: "Your 履歴書 photo" }).getAttribute("src")).toBe("/api/profile/photo?v=a1b2c3d4e5f6");
    expect(photo.getByText(/keeps the photo it was sent with/)).toBeTruthy();
    fireEvent.click(photo.getByRole("button", { name: "Remove photo" }));
    await waitFor(() => expect(api.writes()).toEqual(["DELETE /api/profile/photo"]));
    expect(await photo.findByRole("button", { name: "Add a photo" })).toBeTruthy();
    expect(photo.queryByRole("img", { name: "Your 履歴書 photo" })).toBeNull();
  });
});
