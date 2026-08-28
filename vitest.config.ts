import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    // Agent worktrees are nested checkouts under .claude/worktrees. Their test
    // files would otherwise be collected and run against this root's alias and
    // setup file, failing on imports that only exist in the worktree.
    exclude: [...configDefaults.exclude, ".claude/**"],
    setupFiles: ["./tests/setup-env.ts"],
  },
});
