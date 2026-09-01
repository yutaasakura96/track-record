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
    // The key is a REGEX, not the plain string "/api", because Vite matches a
    // string key as a PREFIX — which also captures `/api.ts`, this client's own
    // API module. That request is then proxied to the Worker, answered with the
    // SPA fallback, and every module importing it fails MIME checking: the app
    // serves its HTML and mounts nothing. Anchoring on `^/api/` proxies the API
    // and leaves sibling source paths alone.
    proxy: { "^/api/": "http://localhost:8787" },
  },
});
