/**
 * Lets Node load the `.docx` and `.ttf` imports the Worker build and the suite
 * load as `Data` modules (`src/binary-modules.d.ts`): an `ArrayBuffer`, read
 * from the file. The demo seed runs the app's own render routes under `tsx`,
 * and they reach the 履歴書 template and the PDF fonts.
 */
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
      export async function load(url, context, next) {
        if (!/\\.(docx|ttf)$/.test(url)) return next(url, context);
        return {
          format: "module",
          shortCircuit: true,
          source: "import { readFileSync } from 'node:fs';" +
            "const b = readFileSync(new URL(" + JSON.stringify(url) + "));" +
            "export default b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);",
        };
      }
    `),
);
