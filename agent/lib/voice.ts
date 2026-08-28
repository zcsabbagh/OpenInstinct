import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { env } from "@/lib/env";

/**
 * Speech-to-text for inbound Linq voice notes, via ElevenLabs Scribe v2.
 *
 * Claude cannot take audio input and the AI SDK Anthropic provider throws on an
 * audio file part, so the Linq channel transcribes voice notes here and feeds
 * the text to the model instead (see agent/channels/linq.ts).
 */

let client: ElevenLabsClient | undefined;

function elevenLabs(): ElevenLabsClient {
  if (!env.ELEVEN_API_KEY) {
    throw new Error("ELEVEN_API_KEY is not set.");
  }
  client ??= new ElevenLabsClient({ apiKey: env.ELEVEN_API_KEY });
  return client;
}

/** Transcribe an audio attachment hosted at `sourceUrl`. Returns trimmed text. */
export async function transcribeAudio(sourceUrl: string): Promise<string> {
  const result = await elevenLabs().speechToText.convert({
    sourceUrl,
    modelId: "scribe_v2",
    tagAudioEvents: false,
  });

  if ("text" in result && typeof result.text === "string") {
    return result.text.trim();
  }
  throw new Error("ElevenLabs returned no transcript for the voice note.");
}
