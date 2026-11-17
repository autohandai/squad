import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { birdFaceSvg } from "./src/lib/bird-faces.js";
import { pickFlock } from "./src/lib/flock.js";

// The boot screen paints before any bundle parses, so its birds are drawn
// into index.html here (ADR-0245). Seeded, so a build is repeatable; a larger
// cast changes which birds sit there without touching the page.
function bootFlock() {
  return {
    name: "squad-boot-flock",
    transformIndexHtml(html) {
      const [lead, ...others] = pickFlock(3, { seed: "boot" });
      const birds = [others[0], lead, others[1]].filter(Boolean);
      return html.replace("<!-- squad:boot-flock -->", birds.map(bird => `<span>${birdFaceSvg(bird)}</span>`).join(""));
    },
  };
}

export default defineConfig({
  plugins: [react(), bootFlock()],
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
