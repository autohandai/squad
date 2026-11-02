import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    // Live walkthroughs keep their demo repositories under .codex-artifacts.
    // A member writing index.html there made the dev server reload the page,
    // which closed the chat stream and stopped the member mid-build.
    watch: { ignored: ["**/.codex-artifacts/**"] },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
