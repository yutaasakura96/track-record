/**
 * Uploaded recordings in R2 (issue #76): putting one, reading one back with
 * seeking, and deleting one. Nothing else touches the `RECORDINGS` bucket.
 *
 * A file is never held in memory. The body of the upload request goes to R2 as
 * a stream, and a read goes back to the browser as one; the proof of
 * 2026-10-15 in the decision log is what says this stays inside the Worker's
 * limits. Erroring a stream that is already piped into `put` brought the local
 * runtime down in that proof, so the format is decided from bytes read off the
 * body BEFORE the put starts, and those bytes are written back in front.
 *
 * The key is the owner's id and the recording's id. The file's name is not in
 * it, and nothing about the file but its type is stored beside it.
 */
import { AUDIO_HEAD_BYTES } from "~/shared/recording";

export const recordingObjectKey = (userId: string, recordingId: string) => `${userId}/${recordingId}`;

/**
 * The first {@link AUDIO_HEAD_BYTES} of a body, and a stream of exactly
 * `length` bytes that starts with them and carries on with the rest. Fewer or
 * more bytes than `length` error the stream, so a cut-off upload fails the put
 * instead of storing half a file. `cancel` gives the body up unread.
 */
export async function peekBody(body: ReadableStream<Uint8Array>, length: number) {
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let have = 0;
  while (have < AUDIO_HEAD_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    have += value.byteLength;
  }
  const read = new Uint8Array(have);
  let at = 0;
  for (const part of parts) {
    read.set(part, at);
    at += part.byteLength;
  }

  const fixed = new FixedLengthStream(length);
  let started = false;

  return {
    head: read.subarray(0, AUDIO_HEAD_BYTES),
    /** The whole body again. Asking for it starts the copy; until then nothing past the head is read. */
    stream: (): ReadableStream => {
      if (!started) {
        started = true;
        const writer = fixed.writable.getWriter();
        void (async () => {
          await writer.write(read);
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            await writer.write(value);
          }
          await writer.close();
        })().catch((error: unknown) => writer.abort(error).catch(() => {}));
      }
      return fixed.readable;
    },
    cancel: () => reader.cancel().catch(() => {}),
  };
}

export async function putRecording(
  bucket: R2Bucket,
  key: string,
  stream: ReadableStream,
  contentType: string,
): Promise<void> {
  await bucket.put(key, stream, { httpMetadata: { contentType } });
}

/** Deletes every key given, in one call. A key that is already gone is not an error. */
export async function deleteRecordings(bucket: R2Bucket, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await bucket.delete(keys);
}

/**
 * One byte range of a file `size` long, from a `Range` header: `bytes=a-b`,
 * `bytes=a-` and `bytes=-n`. `null` is the whole file, which is the answer to
 * no header, to one this does not read, and to more than one range, as
 * RFC 9110 allows. `"unsatisfiable"` is a range that starts past the end.
 */
export function rangeOf(header: string | null, size: number): { offset: number; length: number } | "unsatisfiable" | null {
  const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!match) return null;
  const [, from, to] = match;
  if (from === "" && to === "") return null;
  if (from === "") {
    const suffix = Number(to);
    if (suffix === 0) return "unsatisfiable";
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const offset = Number(from);
  if (offset >= size) return "unsatisfiable";
  const end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  if (end < offset) return null;
  return { offset, length: end - offset + 1 };
}

/**
 * A stored file as a response: the whole of it, or the one range asked for,
 * which is what lets the page's player seek. Never cached anywhere: it is
 * private to the person whose session asked for it.
 */
export async function recordingResponse(
  bucket: R2Bucket,
  key: string,
  file: { byteSize: number; contentType: string; disposition: string },
  rangeHeader: string | null,
): Promise<Response | null> {
  const headers = new Headers({
    "content-type": file.contentType,
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-disposition": file.disposition,
  });
  const range = rangeOf(rangeHeader, file.byteSize);
  if (range === "unsatisfiable") {
    headers.set("content-range", `bytes */${file.byteSize}`);
    return new Response(null, { status: 416, headers });
  }

  const object = await bucket.get(key, range ? { range } : undefined);
  if (!object) return null;
  if (!range) {
    headers.set("content-length", String(object.size));
    return new Response(object.body, { status: 200, headers });
  }
  headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`);
  headers.set("content-length", String(range.length));
  return new Response(object.body, { status: 206, headers });
}

/**
 * `Content-Disposition` for a file of the author's naming: the name for
 * browsers that read RFC 6266's `filename*`, encoded as RFC 8187's attr-char
 * allows, and a plain-ASCII one beside it.
 */
export function dispositionOf(kind: "inline" | "attachment", fileName: string): string {
  // eslint-disable-next-line no-control-regex
  const plain = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(fileName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
