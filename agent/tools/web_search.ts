import { defineTool } from "eve/tools";
import { z } from "zod";
import { env } from "@/lib/env";

/**
 * Overrides eve's built-in `web_search`. The default resolves web search from
 * the model provider — Exa via the AI Gateway for Gateway models — which does
 * nothing on a direct provider model (the `gateway.exa_search` tool is dropped
 * with a warning). This calls the Exa API directly with EXA_API_KEY, so search
 * works the same on every model.
 *
 * Exa API: https://docs.exa.ai/reference/search
 */

const exaResultSchema = z.object({
  title: z.string().nullable().optional(),
  url: z.string(),
  publishedDate: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
});

const exaResponseSchema = z.object({
  results: z.array(exaResultSchema),
});

export default defineTool({
  description:
    "Search the web with Exa. Returns ranked results with title, URL, publish date, and a text excerpt. Use it for current events, facts that change over time, or any claim you are not sure of. Do not announce that you are searching.",
  inputSchema: z.object({
    query: z.string().min(1).max(500).describe("The search query."),
    numResults: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe("How many results to return."),
  }),
  async execute({ numResults, query }, ctx) {
    if (!env.EXA_API_KEY) {
      throw new Error("Web search is unavailable: EXA_API_KEY is not set.");
    }

    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.EXA_API_KEY,
      },
      body: JSON.stringify({
        query,
        numResults,
        type: "auto",
        contents: { text: { maxCharacters: 2_000 } },
      }),
      signal: ctx.abortSignal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Exa search returned HTTP ${String(response.status)}: ${detail.slice(0, 300)}`
      );
    }

    const { results } = exaResponseSchema.parse(await response.json());
    return results.map((result) => ({
      title: result.title ?? null,
      url: result.url,
      publishedDate: result.publishedDate ?? null,
      excerpt: result.text?.trim().slice(0, 2_000) ?? null,
    }));
  },
});
