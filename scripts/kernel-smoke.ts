/**
 * Kernel connectivity smoke test.
 *
 * Exercises the exact Kernel SDK path the agent's browser tools use
 * (agent/extensions/kernel/browser-runtime.ts): create a browser session,
 * run a Playwright snippet against it, then delete it. No vault, no database,
 * no auth - this only answers "is KERNEL_API_KEY good and can we drive a
 * browser end to end".
 *
 * Run:  KERNEL_API_KEY=... node --experimental-strip-types scripts/kernel-smoke.ts
 * or:   node --experimental-strip-types --env-file=.env.local scripts/kernel-smoke.ts
 */
/* oxlint-disable no-restricted-properties -- standalone diagnostic script, run by hand outside Next.js; it deliberately reads the raw KERNEL_API_KEY rather than the validated lib/env module. */
import Kernel from "@onkernel/sdk";

const apiKey = process.env.KERNEL_API_KEY;
if (!apiKey) {
  console.error("KERNEL_API_KEY is not set.");
  process.exit(1);
}

const targetUrl = process.argv[2] ?? "https://example.com/";
const client = new Kernel({ apiKey });

async function main() {
  console.log("Creating browser session...");
  const browser = await client.browsers.create({
    stealth: true,
    timeout_seconds: 120,
  });
  console.log("  session_id:", browser.session_id);
  console.log(
    "  live view:",
    browser.browser_live_view_url ?? "(headless - none)"
  );

  try {
    console.log(`Navigating to ${targetUrl} ...`);
    const result = await client.browsers.playwright.execute(
      browser.session_id,
      {
        code: `await page.goto(${JSON.stringify(targetUrl)}, { waitUntil: "domcontentloaded" });
return { title: await page.title(), url: page.url() };`,
        timeout_sec: 30,
      }
    );

    if (!result.success) {
      console.error(
        "Playwright execution failed:",
        result.error,
        result.stderr
      );
      process.exitCode = 1;
      return;
    }
    console.log("  result:", JSON.stringify(result.result));
    console.log("PASS - Kernel is reachable and can drive a browser.");
  } finally {
    console.log("Deleting browser session...");
    await client.browsers
      .deleteByID(browser.session_id)
      .catch((error: unknown) => {
        console.warn("  cleanup failed:", error);
      });
  }
}

main().catch((error: unknown) => {
  console.error("FAIL:", error);
  process.exit(1);
});
