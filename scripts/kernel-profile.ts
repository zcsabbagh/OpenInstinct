/* oxlint-disable no-restricted-properties -- standalone diagnostic script, run by hand outside Next.js; it reads raw env rather than the validated lib/env module. */
/**
 * Manual proof of the persistent-browser-session design
 * (docs/kernel-persistent-sessions-design.md): sign into Google once in a
 * headful Kernel browser bound to a profile + pinned proxy, then confirm the
 * session is reused by a fresh browser on a different site.
 *
 * Run with: node --experimental-strip-types --env-file=.env.local scripts/kernel-profile.ts <cmd>
 *
 *   connect [profileName]        create profile + proxy, open a headful browser
 *                                on accounts.google.com, print the live-view URL
 *   finish  <sessionId>          end that browser session (saves state -> profile)
 *   test    <profileName> <url>  open a fresh browser with the profile, load the
 *                                url, screenshot it to scratch, report sign-in state
 *   status  [profileName]        list profiles + proxies
 */
import Kernel from "@onkernel/sdk";
import { writeFileSync } from "node:fs";

const apiKey = process.env.KERNEL_API_KEY;
if (!apiKey) {
  console.error("KERNEL_API_KEY is not set.");
  process.exit(1);
}
const client = new Kernel({ apiKey });

const PROXY_NAME = "persistent-sessions-us";
const SHOT_DIR =
  "/private/tmp/claude-501/-Users-zane/3a0ff24e-a959-426f-875e-62a197b9b65c/scratchpad";

async function ensureProxy(): Promise<string> {
  for await (const proxy of client.proxies.list()) {
    if (proxy.name === PROXY_NAME) {
      if (!proxy.id) throw new Error(`proxy ${PROXY_NAME} has no id`);
      return proxy.id;
    }
  }
  const created = await client.proxies.create({
    type: "isp",
    config: { country: "US" },
    name: PROXY_NAME,
    protocol: "http",
  });
  console.log("created proxy:", created.id);
  if (!created.id) throw new Error(`created proxy ${PROXY_NAME} has no id`);
  return created.id;
}

async function ensureProfile(name: string): Promise<string> {
  try {
    const existing = await client.profiles.retrieve(name);
    return existing.name ?? name;
  } catch {
    const created = await client.profiles.create({ name });
    console.log("created profile:", created.name);
    return created.name ?? name;
  }
}

async function connect(profileName: string) {
  const [proxyId, profile] = await Promise.all([
    ensureProxy(),
    ensureProfile(profileName),
  ]);
  const browser = await client.browsers.create({
    profile: { name: profile, save_changes: true },
    proxy: { id: proxyId },
    stealth: true,
    timeout_seconds: 1800,
  });
  await client.browsers.playwright.execute(browser.session_id, {
    code: `await page.goto("https://accounts.google.com/", { waitUntil: "domcontentloaded" }); return page.url();`,
    timeout_sec: 40,
  });
  console.log(
    "\n=== sign in here (2FA and all), then run: finish",
    browser.session_id,
    "==="
  );
  console.log("profile:      ", profile);
  console.log("proxy:        ", proxyId);
  console.log("session_id:   ", browser.session_id);
  console.log("live view:    ", browser.browser_live_view_url);
}

async function finish(sessionId: string) {
  await client.browsers.deleteByID(sessionId);
  console.log("session ended - state saved back to its profile.");
}

async function test(profileName: string, url: string) {
  const proxyId = await ensureProxy();
  const browser = await client.browsers.create({
    profile: { name: profileName, save_changes: false },
    proxy: { id: proxyId },
    stealth: true,
    timeout_seconds: 180,
  });
  try {
    const probe = await client.browsers.playwright.execute(browser.session_id, {
      code: `
await page.goto(${JSON.stringify(url)}, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const text = (await page.locator("body").innerText()).slice(0, 400);
const signedOut = /sign in|log in|continue with google/i.test(text);
return { url: page.url(), signedOut, text };`,
      timeout_sec: 45,
    });
    console.log("result:", JSON.stringify(probe.result, null, 2));
    const shot = await client.browsers.playwright.execute(browser.session_id, {
      code: `return (await page.screenshot()).toString("base64");`,
      timeout_sec: 30,
    });
    if (shot.success && typeof shot.result === "string") {
      const path = `${SHOT_DIR}/profile-test.png`;
      writeFileSync(path, Buffer.from(shot.result, "base64"));
      console.log("screenshot:", path);
    }
  } finally {
    // Best-effort cleanup: the test browser is disposable and its state
    // isn't saved (save_changes: false), so a delete failure here is safe
    // to ignore.
    await client.browsers.deleteByID(browser.session_id).catch(() => undefined);
  }
}

async function status(profileName?: string) {
  const profiles = [];
  for await (const p of client.profiles.list()) profiles.push(p);
  console.log("profiles:", JSON.stringify(profiles, null, 1));
  const proxies = [];
  for await (const p of client.proxies.list())
    proxies.push({ id: p.id, name: p.name, type: p.type });
  console.log("proxies:", JSON.stringify(proxies, null, 1));
  if (profileName) console.log("target profile:", profileName);
}

const [cmd, a, b] = process.argv.slice(2);
switch (cmd) {
  case "connect":
    await connect(a ?? "zane-primary");
    break;
  case "finish":
    if (!a) throw new Error("finish <sessionId>");
    await finish(a);
    break;
  case "test":
    if (!a || !b) throw new Error("test <profileName> <url>");
    await test(a, b);
    break;
  case "status":
    await status(a);
    break;
  default:
    console.error("commands: connect | finish | test | status");
    process.exit(1);
}
