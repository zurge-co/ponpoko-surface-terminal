import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const project = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(project, "src"),
  base: "./",
  build: {
    outDir: resolve(project, "dist"),
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 900,
  },
});
