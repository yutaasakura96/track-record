/**
 * Uploaded recordings on an interview entry, through the API (`docs/07` §9b,
 * issue #76).
 *
 * What is pinned here: an audio file goes to the bucket and is listed on its
 * entry once it is stored; it plays back whole or by the range asked for,
 * which is what seeking needs; only its owner, signed in, reaches it; the size
 * and the type are enforced by the server whatever the browser said; removing
 * one deletes the file and empties its row for good; deleting the entry takes
 * its files too; and no log line carries the file's name.
 *
 * The bucket is Miniflare's, in memory. Every name, company and byte here is
 * INVENTED: the "audio" is a real header in front of counted bytes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { harness, stubModel, type Client, type Harness, type SeededUser } from "./helpers/harness";
import { SECOND_EMAIL, seedAllowedUser } from "./helpers/seed";
import { interviewRecordings } from "~/server/db/schema";
import type { Bindings } from "~/server/env";
import { peekBody, putRecording, rangeOf, recordingObjectKey } from "~/server/services/recording-store";
import { RECORDING_MAX_BYTES, audioTypeOf, keptFileName, type Recording } from "~/shared/recording";

const bucket = (env as unknown as Bindings).RECORDINGS;

interface Detail {
  id: string;
  lastActivityAt: string;
  interviews: { id: string; recordings: Recording[] }[];
}

const JOB = {
  company: "Heron Metering",
  position: "Data Engineer",
  jobDescription: "Heron Metering is hiring a data engineer for its meter-reading pipeline.",
};

const DAY_ONE = new Date("2026-03-02T03:00:00.000Z");

/** `length` bytes that start as an MP3 with an ID3 tag, then count up. */
function mp3(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = i % 251;
  bytes.set([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
  return bytes;
}

/** A WAV header in front of counted bytes. */
function wav(length: number): Uint8Array<ArrayBuffer> {
  const bytes = mp3(length);
  bytes.set([...new TextEncoder().encode("RIFF"), 0, 0, 0, 0, ...new TextEncoder().encode("WAVE")]);
  return bytes;
}

let app: Harness;
let user: SeededUser;
let client: Client;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(DAY_ONE);
  app = harness(stubModel());
  user = await seedAllowedUser();
  client = app.as(user);
});

afterEach(async () => {
  vi.useRealTimers();
  const listed = await bucket.list();
  await bucket.delete(listed.objects.map((object) => object.key));
});

const base = (id: string, interviewId: string) => `/api/applications/${id}/interviews/${interviewId}/recordings`;
const audioOf = (id: string, interviewId: string, recordingId: string) => `${base(id, interviewId)}/${recordingId}/audio`;

function upload(
  id: string,
  interviewId: string,
  bytes: Uint8Array<ArrayBuffer>,
  { name = "heron-first-interview.mp3", type = "audio/mpeg", duration = "3120" as string | null, as = client } = {},
) {
  // A browser declares the length of a file it sends; a request built here has to say it.
  const headers = new Headers({
    "content-type": type,
    "x-file-name": encodeURIComponent(name),
    "content-length": String(bytes.byteLength),
  });
  if (duration !== null) headers.set("x-duration-seconds", duration);
  return as.request(`${base(id, interviewId)}/audio`, { method: "POST", body: bytes, headers });
}

/** An application with one interview entry on it. */
async function noted(as: Client = client) {
  const { id } = (await (await as.post("/api/applications", JOB)).json()) as Detail;
  const after = (await (
    await as.post(`/api/applications/${id}/interviews`, { date: "2026-03-02", round: "interview_1", howItWent: "Calm." })
  ).json()) as Detail;
  return { id, interviewId: after.interviews[0]!.id };
}

async function uploaded(bytes = mp3(4096)) {
  const { id, interviewId } = await noted();
  const response = await upload(id, interviewId, bytes);
  expect(response.status).toBe(201);
  const after = (await response.json()) as Detail;
  return { id, interviewId, recordingId: after.interviews[0]!.recordings[0]!.id, after };
}

describe("uploading an audio file", () => {
  it("stores the file under the owner and the recording, and lists it on its entry once stored", async () => {
    const bytes = mp3(4096);
    const { id, recordingId, after } = await uploaded(bytes);

    expect(after.interviews[0]!.recordings).toEqual([
      {
        id: expect.stringMatching(/^rec_/),
        kind: "upload",
        fileName: "heron-first-interview.mp3",
        byteSize: 4096,
        durationSeconds: 3120,
        // The day the database stamped it, in Japan: its clock is not the test's.
        uploadedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      },
    ]);
    const stored = await bucket.get(recordingObjectKey(user.id, recordingId));
    expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(bytes);
    expect(stored!.httpMetadata?.contentType).toBe("audio/mpeg");
    // The key names no file: only the two ids.
    expect(stored!.key).toBe(`${user.id}/${recordingId}`);
    expect((await client.json<Detail>(`/api/applications/${id}`)).interviews).toEqual(after.interviews);
  });

  it("is a change to the application", async () => {
    const { id, interviewId } = await noted();
    const before = await client.json<Detail>(`/api/applications/${id}`);
    vi.setSystemTime(new Date(DAY_ONE.getTime() + 60_000));
    await upload(id, interviewId, mp3(1024));
    expect((await client.json<Detail>(`/api/applications/${id}`)).lastActivityAt > before.lastActivityAt).toBe(true);
  });

  it("stores the type it recognised, not the one the browser claimed", async () => {
    const { id, interviewId } = await noted();
    const after = (await (await upload(id, interviewId, wav(2048), { name: "call.wav", type: "audio/x-made-up" })).json()) as Detail;
    const recordingId = after.interviews[0]!.recordings[0]!.id;

    const played = await client.get(audioOf(id, interviewId, recordingId));
    expect(played.headers.get("content-type")).toBe("audio/wav");
  });

  it("leaves the length out when the browser could not read it, and refuses one that is not a number", async () => {
    const { id, interviewId } = await noted();
    await upload(id, interviewId, mp3(1024), { duration: null });
    await upload(id, interviewId, mp3(1024), { duration: "an hour" });

    const recordings = (await client.json<Detail>(`/api/applications/${id}`)).interviews[0]!.recordings;
    expect(recordings.map((recording) => recording.kind === "upload" && recording.durationSeconds)).toEqual([null, null]);
  });

  it("keeps only the last part of a name with a path in it, without control characters", async () => {
    const { id, interviewId } = await noted();
    const after = (await (await upload(id, interviewId, mp3(1024), { name: "C:\\calls\\面接\u0007 一次.m4a" })).json()) as Detail;
    expect(after.interviews[0]!.recordings[0]).toMatchObject({ fileName: "面接 一次.m4a" });
  });
});

describe("the size and type limits", () => {
  it("refuses a file over the limit before reading it, and stores nothing", async () => {
    const { id, interviewId } = await noted();
    const response = await client.request(`${base(id, interviewId)}/audio`, {
      method: "POST",
      body: new ReadableStream({ start: (controller) => controller.close() }),
      headers: {
        "content-type": "audio/mpeg",
        "x-file-name": "long-call.mp3",
        // A constructed request sends no declared length; this one says what an oversized file would.
        "content-length": String(RECORDING_MAX_BYTES + 1),
      },
    });
    expect([411, 422]).toContain(response.status);
    expect((await bucket.list()).objects).toEqual([]);
  });

  it("refuses a body that is not audio, with its name, the kinds it takes and the limit", async () => {
    const { id, interviewId } = await noted();
    const response = await upload(id, interviewId, new TextEncoder().encode("This is a text file, not a recording."), {
      name: "notes.txt",
      type: "audio/mpeg",
    });

    expect(response.status).toBe(422);
    const { error } = (await response.json()) as { error: { message: string } };
    expect(error.message).toBe("notes.txt is not audio this app keeps. It takes MP3, M4A, AAC, WAV, FLAC or Ogg, up to 90 MB.");
    expect((await bucket.list()).objects).toEqual([]);
    expect((await client.json<Detail>(`/api/applications/${id}`)).interviews[0]!.recordings).toEqual([]);
  });

  it.each([
    ["an empty file", new Uint8Array(0), "heron.mp3", 422],
    ["a file with no name", mp3(1024), "", 422],
  ])("refuses %s", async (_, bytes, name, status) => {
    const { id, interviewId } = await noted();
    expect((await upload(id, interviewId, bytes, { name })).status).toBe(status);
    expect((await bucket.list()).objects).toEqual([]);
  });

  it("recognises each kind it takes by its first bytes, and nothing else", () => {
    const head = (...parts: (string | number[])[]) => {
      const bytes = new Uint8Array(12);
      let at = 0;
      for (const part of parts) {
        const values = typeof part === "string" ? [...new TextEncoder().encode(part)] : part;
        bytes.set(values, at);
        at += values.length;
      }
      return bytes;
    };
    expect(audioTypeOf(head("ID3"))).toBe("audio/mpeg");
    expect(audioTypeOf(head([0xff, 0xfb, 0x90]))).toBe("audio/mpeg");
    expect(audioTypeOf(head([0xff, 0xf1, 0x50]))).toBe("audio/aac");
    expect(audioTypeOf(head([0, 0, 0, 0x20], "ftypM4A "))).toBe("audio/mp4");
    expect(audioTypeOf(head("RIFF", [0, 0, 0, 0], "WAVE"))).toBe("audio/wav");
    expect(audioTypeOf(head("fLaC"))).toBe("audio/flac");
    expect(audioTypeOf(head("OggS"))).toBe("audio/ogg");
    // A video's MP4 brand, a QuickTime movie, WebM, a PDF and too few bytes are not.
    expect(audioTypeOf(head([0, 0, 0, 0x20], "ftypM4V "))).toBeNull();
    expect(audioTypeOf(head([0, 0, 0, 0x14], "ftypqt  "))).toBeNull();
    expect(audioTypeOf(head([0x1a, 0x45, 0xdf, 0xa3]))).toBeNull();
    expect(audioTypeOf(head("%PDF-1.7"))).toBeNull();
    expect(audioTypeOf(new TextEncoder().encode("ID3"))).toBeNull();
  });

  it("keeps a file's name without its path", () => {
    expect(keptFileName("/home/someone/first.mp3")).toBe("first.mp3");
    expect(keptFileName("  ")).toBe("");
  });
});

describe("an upload cut off part way", () => {
  it("stores nothing when fewer bytes arrive than were declared", async () => {
    const bytes = mp3(2048);
    const short = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 1024));
        controller.close();
      },
    });
    const peeked = await peekBody(short, bytes.length);
    expect(audioTypeOf(peeked.head)).toBe("audio/mpeg");

    await expect(putRecording(bucket, "cut/off", peeked.stream(), "audio/mpeg")).rejects.toThrow();
    expect(await bucket.head("cut/off")).toBeNull();
  });

  it("stores the whole file, head included, when all of it arrives in small pieces", async () => {
    const bytes = mp3(5000);
    const pieces = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.length; at += 7) controller.enqueue(bytes.slice(at, at + 7));
        controller.close();
      },
    });
    const peeked = await peekBody(pieces, bytes.length);
    await putRecording(bucket, "whole/file", peeked.stream(), "audio/mpeg");
    expect(new Uint8Array(await (await bucket.get("whole/file"))!.arrayBuffer())).toEqual(bytes);
  });
});

describe("playing it back", () => {
  it("answers the whole file, privately, saying it takes ranges", async () => {
    const bytes = mp3(4096);
    const { id, interviewId, recordingId } = await uploaded(bytes);

    const response = await client.get(audioOf(id, interviewId, recordingId));
    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe("4096");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it.each([
    ["bytes=1000-1999", 1000, 1000],
    ["bytes=4000-", 4000, 96],
    ["bytes=-100", 3996, 100],
    ["bytes=4000-9999", 4000, 96],
  ])("answers %s with that range, which is what seeking asks for", async (range, offset, length) => {
    const bytes = mp3(4096);
    const { id, interviewId, recordingId } = await uploaded(bytes);

    const response = await client.request(audioOf(id, interviewId, recordingId), { headers: { range } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes ${offset}-${offset + length - 1}/4096`);
    expect(response.headers.get("content-length")).toBe(String(length));
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.subarray(offset, offset + length));
  });

  it("refuses a range past the end with 416, and answers the whole for one it does not read", async () => {
    const { id, interviewId, recordingId } = await uploaded(mp3(4096));

    const past = await client.request(audioOf(id, interviewId, recordingId), { headers: { range: "bytes=5000-" } });
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */4096");

    const several = await client.request(audioOf(id, interviewId, recordingId), { headers: { range: "bytes=0-1,5-6" } });
    expect(several.status).toBe(200);
    await several.arrayBuffer();
  });

  it("reads ranges as RFC 9110 writes them", () => {
    expect(rangeOf(null, 10)).toBeNull();
    expect(rangeOf("bytes=0-0", 10)).toEqual({ offset: 0, length: 1 });
    expect(rangeOf("bytes=-20", 10)).toEqual({ offset: 0, length: 10 });
    expect(rangeOf("bytes=-0", 10)).toBe("unsatisfiable");
    expect(rangeOf("bytes=5-2", 10)).toBeNull();
    expect(rangeOf("items=0-1", 10)).toBeNull();
  });

  it("offers it to save under its own name with ?download", async () => {
    const { id } = await noted();
    const { interviewId } = { interviewId: (await client.json<Detail>(`/api/applications/${id}`)).interviews[0]!.id };
    const after = (await (await upload(id, interviewId, mp3(1024), { name: "面接 \"final\".mp3" })).json()) as Detail;
    const recordingId = after.interviews[0]!.recordings[0]!.id;

    const response = await client.get(`${audioOf(id, interviewId, recordingId)}?download`);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="__ _final_.mp3"; filename*=UTF-8''${encodeURIComponent('面接 "final".mp3')}`,
    );
    await response.arrayBuffer();
  });
});

describe("only its owner reaches it", () => {
  it("is a 401 signed out and a 404 to anyone else, for playing, removing and uploading alike", async () => {
    const { id, interviewId, recordingId } = await uploaded();
    const other = app.as(await seedAllowedUser(SECOND_EMAIL));

    expect((await app.anonymous().get(audioOf(id, interviewId, recordingId))).status).toBe(401);
    expect((await other.get(audioOf(id, interviewId, recordingId))).status).toBe(404);
    expect((await other.delete(`${base(id, interviewId)}/${recordingId}`)).status).toBe(404);
    expect((await upload(id, interviewId, mp3(1024), { as: other })).status).toBe(404);

    // Still there, and still one.
    expect((await bucket.list()).objects).toHaveLength(1);
    expect((await client.get(audioOf(id, interviewId, recordingId))).status).toBe(200);
  });

  it("is a 404 through another entry or application of the owner's own", async () => {
    const { id, interviewId, recordingId } = await uploaded();
    const elsewhere = await noted();

    expect((await client.get(audioOf(elsewhere.id, elsewhere.interviewId, recordingId))).status).toBe(404);
    expect((await client.get(audioOf(id, elsewhere.interviewId, recordingId))).status).toBe(404);
    expect((await client.get(audioOf(elsewhere.id, interviewId, recordingId))).status).toBe(404);
  });

  it("does not play a link as a file", async () => {
    const { id, interviewId } = await noted();
    const after = (await (await client.post(base(id, interviewId), { url: "https://meet.example.invalid/rec/1" })).json()) as Detail;
    expect((await client.get(audioOf(id, interviewId, after.interviews[0]!.recordings[0]!.id))).status).toBe(404);
  });
});

describe("removing it", () => {
  it("deletes the file and empties its row for good, leaving the line with the day", async () => {
    const { id, interviewId, recordingId } = await uploaded();

    const response = await client.delete(`${base(id, interviewId)}/${recordingId}`);
    expect(response.status).toBe(200);
    const after = (await response.json()) as Detail;

    expect(after.interviews[0]!.recordings).toEqual([{ id: recordingId, kind: "removed", removedOn: "2026-03-02" }]);
    expect(await bucket.head(recordingObjectKey(user.id, recordingId))).toBeNull();
    const [row] = await app.db.select().from(interviewRecordings).where(eq(interviewRecordings.id, recordingId));
    expect(row).toMatchObject({ fileName: null, byteSize: null, contentType: null, durationSeconds: null, label: "", url: null });
    expect((await client.get(audioOf(id, interviewId, recordingId))).status).toBe(404);
    expect((await client.delete(`${base(id, interviewId)}/${recordingId}`)).status).toBe(404);
  });

  it("goes with its entry when the entry is deleted", async () => {
    const { id, interviewId, recordingId } = await uploaded();

    expect((await client.delete(`/api/applications/${id}/interviews/${interviewId}`)).status).toBe(200);
    expect(await bucket.head(recordingObjectKey(user.id, recordingId))).toBeNull();
    const [row] = await app.db.select().from(interviewRecordings).where(eq(interviewRecordings.id, recordingId));
    expect(row!.removedAt).not.toBeNull();
    expect(row!.fileName).toBeNull();
  });

  it("is refused by the table when a removed upload keeps its name", async () => {
    const { recordingId } = await uploaded();
    await expect(
      app.db.update(interviewRecordings).set({ removedAt: new Date() }).where(eq(interviewRecordings.id, recordingId)),
    ).rejects.toThrow();
  });
});

describe("logs", () => {
  it("carry ids, the type and the size, never the file's name", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
    try {
      const { id, interviewId, recordingId } = await uploaded();
      await client.delete(`${base(id, interviewId)}/${recordingId}`);
    } finally {
      spy.mockRestore();
    }
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toContainEqual(expect.objectContaining({ event: "recording_added", kind: "upload", contentType: "audio/mpeg", bytes: 4096 }));
    expect(events).toContainEqual(expect.objectContaining({ event: "recording_removed", kind: "upload" }));
    expect(lines.join("\n")).not.toContain("heron-first-interview");
  });
});
