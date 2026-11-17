/**
 * Node has no idea what a `.docx` or `.ttf` import is. wrangler and Vite load
 * the 履歴書 template and the PDF fonts as `Data` modules — ArrayBuffers — and
 * the render modules reach them transitively, so the stdio MCP server, which
 * runs under Node, needs the same thing. Registered by `scripts/mcp-server.ts` before it
 * imports anything under `src/`.
 */
import { readFile } from "node:fs/promises";

/** The `Data` globs in `wrangler.toml`. */
const DATA = [".docx", ".ttf"];

export async function load(url, context, nextLoad) {
  if (!DATA.some((ext) => url.endsWith(ext))) return nextLoad(url, context);
  const base64 = (await readFile(new URL(url))).toString("base64");
  return {
    format: "module",
    shortCircuit: true,
    source:
      `const b = Buffer.from(${JSON.stringify(base64)}, "base64");\n` +
      "export default b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);\n",
  };
}
