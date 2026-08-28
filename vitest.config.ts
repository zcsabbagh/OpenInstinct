import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// Agent worktrees are nested checkouts under .claude/worktrees. Their test
// files would otherwise be collected and run against this root's alias and
// setup file, failing on imports that only exist in the worktree.
const sharedExclude = [...configDefaults.exclude, ".claude/**"];

// These files each boot a PGlite (WASM Postgres) instance and replay the SQL
// migrations against it. That is cheap in isolation but expensive under CPU
// contention: booting several WASM Postgres instances at once, while `pnpm
// check` is also running lint/typecheck/knip concurrently via turbo, was
// observed to blow through even generous per-test timeouts (15-20s) and fail
// `pnpm check` nondeterministically with no code changes between runs.
//
// Running these files sequentially (one PGlite instance active at a time)
// instead of vitest's default full file-parallelism removes that contention
// at the source, without slowing down the rest of the suite or serializing
// turbo's other tasks.
const pgliteBackedTestFiles = [
  "tests/services.test.ts",
  "tests/invites.test.ts",
  "tests/vault-notes.test.ts",
  "tests/web-monitor.test.ts",
  "tests/database-migration.test.ts",
];

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    exclude: sharedExclude,
    setupFiles: ["./tests/setup-env.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          exclude: [...sharedExclude, ...pgliteBackedTestFiles],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          include: pgliteBackedTestFiles,
          // One PGlite instance at a time: see comment above.
          fileParallelism: false,
        },
      },
    ],
  },
});
