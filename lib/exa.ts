import { z } from "zod";
import { env } from "@/lib/env";

// Plain Exa Search (https://docs.exa.ai/reference/search). Pay-as-you-go, no
// Pro plan - the Websets / Monitors API needs a paid team, so web monitoring
// runs its own daily search on our cron instead.

const resultSchema = z.object({
  id: z.string().optional(),
  url: z.string(),
  title: z.string().nullish(),
  publishedDate: z.string().nullish(),
  text: z.string().nullish(),
});

const responseSchema = z.object({ results: z.array(resultSchema) });

export type ExaResult = z.infer<typeof resultSchema>;

export async function exaSearch(
  query: string,
  numResults = 10
): Promise<ExaResult[]> {
  const key = env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY is not set.");

  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify({
      query,
      numResults,
      type: "auto",
      contents: { text: { maxCharacters: 800 } },
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Exa search -> ${String(response.status)}: ${text.slice(0, 300)}`
    );
  }
  return responseSchema.parse(JSON.parse(text) as unknown).results;
}

export function resultTitle(result: ExaResult): string {
  const title = result.title?.trim();
  return title && title.length > 0 ? title : result.url;
}
