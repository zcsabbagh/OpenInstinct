import type { KnipConfig } from "knip";

export default {
  entry: [
    "agent/channels/**/*.ts",
    "agent/extensions/**/*.ts",
    "agent/hooks/**/*.ts",
    "agent/schedules/**/*.ts",
    "agent/tools/**/*.ts",
    "db/drizzle.config.ts",
    "evals/**/*.eval.ts",
    "evals/evals.config.ts",
    "taze.config.ts",
  ],
  ignoreDependencies: [
    // Consumed only by the Eve AI Elements component surface under
    // components/ai-elements, which is retained as a reusable library even
    // though no route currently renders it.
    "@streamdown/cjk",
    "@streamdown/code",
    "@streamdown/math",
    "@streamdown/mermaid",
    "cmdk",
    "motion",
    "nanoid",
    "streamdown",
    "use-stick-to-bottom",
    // Imported through the owning Tailwind stylesheet rather than TypeScript.
    "shadcn",
    "tailwindcss",
    // Loaded as jsPlugins from .oxlintrc.jsonc rather than TypeScript.
    "eslint-plugin-react-hooks",
    "eslint-plugin-turbo",
    "oxlint-tailwindcss",
    // Loaded from generated configuration.
    "next-themes",
    "sonner",
    // Invoked as a CLI.
    "vercel",
  ],
  ignoreIssues: {
    // Eve AI Elements and shadcn registry primitives intentionally expose
    // a reusable component surface wider than this minimal chat consumes.
    "components/ai-elements/**/*.tsx": ["exports", "files", "types"],
    "components/ui/**/*.tsx": ["exports", "files", "types"],
  },
  project: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
} satisfies KnipConfig;
