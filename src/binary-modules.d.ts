/**
 * `.docx` files are binary modules, not JavaScript.
 *
 * The `[[rules]]` entry in `wrangler.toml` gives the Worker build a `Data`
 * module — an `ArrayBuffer` at runtime, emitted beside the bundle rather than
 * inlined into it — and `modulesRules` in `vitest.config.ts` gives the suite
 * the same thing inside workerd. This declaration is what tells TypeScript so.
 */
declare module "*.docx" {
  const contents: ArrayBuffer;
  export default contents;
}
