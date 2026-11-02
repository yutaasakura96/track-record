/**
 * Clearing one user's uploaded recordings from R2. **Objects only.** Nothing
 * here can reach the bucket itself: the only verbs are listing a prefix and
 * deleting keys.
 *
 * The prefix, not the rows, says what to delete: an object whose row is gone
 * still has the user's id on it, and "listing `<userId>/` returns nothing" is
 * what the runbook checks.
 */
import { recordingObjectKey } from "~/server/services/recording-store";

/** Named in `wrangler.toml`, which is the only thing that binds it. */
export const RECORDINGS_BUCKET = "track-record-recordings";

export interface RecordingObjects {
  list(prefix: string): Promise<string[]>;
  delete(keys: string[]): Promise<void>;
}

/** How many it deleted. Stops if any are left. */
export async function clearRecordingObjects(objects: RecordingObjects, userId: string): Promise<number> {
  // An empty id would make the prefix the whole bucket's.
  if (!userId) throw new Error("No user to clear recordings for.");
  const prefix = recordingObjectKey(userId, "");
  const keys = await objects.list(prefix);
  await objects.delete(keys);
  const left = await objects.list(prefix);
  if (left.length > 0) throw new Error(`${left.length} recording object(s) are still in R2 under "${prefix}". Rerun the load to clear them.`);
  return keys.length;
}

/** A bound bucket: `wrangler dev`'s emulation on disk, and the suite's. */
export const boundObjects = (bucket: Pick<R2Bucket, "list" | "delete">): RecordingObjects => ({
  async list(prefix) {
    const keys: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await bucket.list({ prefix, cursor });
      keys.push(...page.objects.map((object) => object.key));
      if (!page.truncated) return keys;
      cursor = page.cursor;
    }
  },
  async delete(keys) {
    for (let at = 0; at < keys.length; at += 1000) await bucket.delete(keys.slice(at, at + 1000));
  },
});

/**
 * The production bucket over Cloudflare's API, the same paths `wrangler r2
 * object` uses. Wrangler has no list command, and the Worker's binding is out
 * of reach from a script.
 */
export function cloudflareObjects(config: { accountId: string; token: string; bucket?: string; fetch?: typeof fetch }): RecordingObjects {
  const send = config.fetch ?? fetch;
  const objects = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/r2/buckets/${config.bucket ?? RECORDINGS_BUCKET}/objects`;
  const call = async (url: string, method: string) => {
    const response = await send(url, { method, headers: { authorization: `Bearer ${config.token}` } });
    if (!response.ok) throw new Error(`Cloudflare answered ${method} on the recordings bucket with ${response.status}.`);
    return response;
  };
  return {
    async list(prefix) {
      const keys: string[] = [];
      let cursor: string | undefined;
      for (;;) {
        const query = new URLSearchParams({ prefix, per_page: "1000", ...(cursor ? { cursor } : {}) });
        const page = (await (await call(`${objects}?${query}`, "GET")).json()) as {
          result: { key: string }[];
          result_info?: { cursor?: string; is_truncated?: boolean };
        };
        keys.push(...page.result.map((object) => object.key));
        if (!page.result_info?.is_truncated) return keys;
        cursor = page.result_info.cursor;
      }
    },
    async delete(keys) {
      for (const key of keys) await call(`${objects}/${key}`, "DELETE");
    },
  };
}
