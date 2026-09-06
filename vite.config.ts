import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src/client",
  build: { outDir: "../../dist/client", emptyOutDir: true },
  resolve: {
    alias: { "~": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    fs: {
      // Vite resolves the workspace root by walking up for a lockfile, finds
      // `package-lock.json` at the repository root, and serves anything under
      // it over `/@fs/`. That reaches `local/` (the author's real career
      // documents) and `.dev.vars` (DATABASE_URL, ANTHROPIC_API_KEY,
      // BETTER_AUTH_SECRET) from any page in the dev browser. Vite's default
      // `fs.deny` covers `.env` and `.env.*`; it does not know `.dev.vars`.
      //
      // Naming `allow` disables the workspace search, so the repository root
      // leaves the served scope entirely rather than being denied file by
      // file. Absolute paths, because a relative entry resolves against
      // `root` (`src/client`) and would read as one level of `..` too few.
      // `deny` is deliberately not set: overriding it would drop Vite's own
      // defaults (`.env`, keys and certificates, `.git`).
      allow: [
        fileURLToPath(new URL("./src", import.meta.url)),
        fileURLToPath(new URL("./node_modules", import.meta.url)),
      ],
    },
    // The key is a REGEX, not the plain string "/api", because Vite matches a
    // string key as a PREFIX — which also captures `/api.ts`, this client's own
    // API module. That request is then proxied to the Worker, answered with the
    // SPA fallback, and every module importing it fails MIME checking: the app
    // serves its HTML and mounts nothing. Anchoring on `^/api/` proxies the API
    // and leaves sibling source paths alone.
    proxy: { "^/api/": "http://localhost:8787" },
  },
});
