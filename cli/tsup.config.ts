import { defineConfig } from "tsup";
import { cpSync } from "node:fs";
import { dirname, join } from "node:path";

// Bundle the CLI into a single ESM file for npm publish. @onchain-novel/shared
// (and any other workspace-only dep) is inlined — the published tarball must
// not resolve any @onchain-novel/* at install time.
export default defineConfig({
  entry: { "onchain-novel-cli": "src/bin/onchain-novel-cli.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  // Keep runtime deps external (published in package.json dependencies). Only
  // workspace-only packages get bundled.
  noExternal: [/^@onchain-novel\//],
  splitting: false,
  sourcemap: false,
  onSuccess: async () => {
    // Ship the guide markdowns alongside the bundle so `onchain-novel-cli setup`
    // can still find them at runtime via a relative path from the bundle.
    const here = dirname(new URL(import.meta.url).pathname);
    cpSync(join(here, "src", "guides"), join(here, "dist", "guides"), { recursive: true });
  },
});
