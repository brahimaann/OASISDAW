// Two-tab smoke test: presence, shared play/stop, BPM, chat, shared steps.
// Needs the server (npm run dev:server) and app (npm run dev:app) running in DEV mode.
// Run: node e2e/two-tabs.mjs [baseUrl]
import { createRequire } from "node:module";

// CommonJS require so a globally installed Playwright (NODE_PATH) also works.
const { chromium } = createRequire(import.meta.url)("playwright");

const base = process.argv[2] ?? "http://localhost:5173";
const room = `e2e${Date.now().toString(36)}`;
const fail = (msg) => { console.error("FAIL:", msg); process.exitCode = 1; };
const ok = (msg) => console.log("ok  ", msg);

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });

async function join(name) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error(`[${name}] pageerror`, e.message));
  await page.goto(`${base}/room/${room}`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("play").waitFor();
  // Turn sound on (the banner) so the Transport can run.
  const banner = page.getByText("Click here to turn on sound");
  if (await banner.isVisible()) await banner.click();
  return page;
}

const clock = (page) => page.evaluate(async () => {
  const t = await import("/src/engine/transport.ts");
  return t.debugClock();
});

const a = await join("Hima");
const b = await join("Prince");

await b.getByTestId("presence").getByText("Hima").waitFor({ timeout: 5000 }).then(() => ok("B sees A in the room"), () => fail("presence"));
await a.getByTestId("presence").getByText("Prince").waitFor({ timeout: 5000 }).then(() => ok("A sees B in the room"), () => fail("presence"));

// Play from A.
await a.getByTestId("play").click();
await a.waitForTimeout(1200);
const [ca, cb] = await Promise.all([clock(a), clock(b)]);
console.log("     A:", ca, "\n     B:", cb);
if (ca.state === "started" && cb.state === "started") ok("both tabs playing"); else fail("both should play");
const driftMs = Math.abs((ca.seconds - cb.seconds) * 1000 - (ca.serverNow - cb.serverNow));
console.log(`     position difference after correcting for sample time: ${driftMs.toFixed(1)} ms`);
if (driftMs < 30) ok("positions agree within 30 ms"); else fail(`drift ${driftMs} ms`);

// Change BPM from B while playing.
await b.getByTestId("bpm").fill("100");
await b.getByTestId("bpm").press("Enter");
await a.waitForTimeout(800);
const [ca2, cb2] = await Promise.all([clock(a), clock(b)]);
if (ca2.bpm === 100 && cb2.bpm === 100) ok("BPM change reached both"); else fail(`bpm ${ca2.bpm}/${cb2.bpm}`);
const drift2 = Math.abs((ca2.seconds - cb2.seconds) * 1000 - (ca2.serverNow - cb2.serverNow));
if (drift2 < 30) ok(`still in step after tempo change (${drift2.toFixed(1)} ms)`); else fail(`drift after bpm ${drift2}`);

// Stop from B.
await b.getByTestId("play").click();
await a.waitForTimeout(500);
const [ca3, cb3] = await Promise.all([clock(a), clock(b)]);
if (ca3.state === "stopped" && cb3.state === "stopped") ok("stop from B stopped both"); else fail("stop");

// Chat.
await a.getByLabel("Message").fill("yo, drums on your side?");
await a.getByRole("button", { name: "Send" }).click();
await b.getByTestId("chat").getByText("yo, drums on your side?").waitFor({ timeout: 5000 }).then(() => ok("chat synced"), () => fail("chat"));

// Shared step on the audio/ui Sequencer.
const cellA = a.getByTestId("sequencer").getByRole("button").first();
await cellA.click();
await b.waitForTimeout(500);
const pressedB = await b.getByTestId("sequencer").getByRole("button").first().getAttribute("aria-pressed");
if (pressedB === "true") ok("sequencer step synced"); else fail(`step not synced (aria-pressed=${pressedB})`);

// Late joiner lands in the right place.
await a.getByTestId("play").click();
await a.waitForTimeout(700);
const c = await join("Gibby");
await c.waitForTimeout(800);
const [ca4, cc4] = await Promise.all([clock(a), clock(c)]);
const drift4 = Math.abs((ca4.seconds - cc4.seconds) * 1000 - (ca4.serverNow - cc4.serverNow));
if (cc4.state === "started" && drift4 < 30) ok(`late joiner in step (${drift4.toFixed(1)} ms)`); else fail(`late joiner ${cc4.state} ${drift4}`);

await a.screenshot({ path: process.env.SHOT ?? "e2e-room.png", fullPage: true });
await browser.close();
console.log(process.exitCode ? "SOME CHECKS FAILED" : "ALL CHECKS PASSED");
