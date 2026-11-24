// Vocal capture test: A records a take with a (fake) mic; B sees it on the
// playlist at the same beat, downloads it and draws its waveform. Also checks
// nudge sync, and that a take survives a refresh mid-recording.
// Needs the app running in DEV mode (see two-tabs.mjs). Run: node e2e/record.mjs [baseUrl]
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const base = process.argv[2] ?? "http://localhost:5173";
const room = `rec${Date.now().toString(36)}`;
const fail = (msg) => { console.error("FAIL:", msg); process.exitCode = 1; };
const ok = (msg) => console.log("ok  ", msg);

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

async function join(name) {
  const ctx = await browser.newContext({ permissions: ["microphone"] });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error(`[${name}] pageerror`, e.message));
  page.on("console", (m) => m.type() === "warning" && console.log(`[${name}] ${m.text()}`));
  await page.goto(`${base}/room/${room}`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("play").waitFor();
  const banner = page.getByText("Click here to turn on sound");
  if (await banner.isVisible()) await banner.click();
  return page;
}

const a = await join("Artist");
const b = await join("Hima");

// The record panel opens from the top bar's record button.
await a.getByTestId("record-toggle").click();
await a.getByTestId("record-panel").waitFor().then(() => ok("record panel opens from the top bar"), () => fail("record panel"));
await a.getByLabel("Count-in before recording").selectOption("0");

// Record is blocked until headphones are confirmed.
if (await a.getByTestId("record").isDisabled()) ok("record waits for the headphones check"); else fail("record should need headphones");
await a.getByTestId("headphones").check();

// Latency check with a fake mic can't hear the clicks: it should say so, not guess.
await a.getByRole("button", { name: "Check latency" }).click();
await a.getByTestId("record-note").waitFor({ timeout: 15000 });
const noteText = await a.getByTestId("record-note").textContent();
if (/Couldn't hear|Measured/.test(noteText ?? "")) ok(`latency check finished: "${noteText?.slice(0, 40)}…"`); else fail(`latency note: ${noteText}`);

// Record about 2 seconds.
await a.getByTestId("record").click();
await a.getByText("■ Stop recording").waitFor();
await b.waitForTimeout(600);
const playingB = await b.evaluate(() => window.__oasisClock().state);
if (playingB === "started") ok("recording started the beat for everyone"); else fail(`B transport ${playingB}`);
await a.waitForTimeout(2200);
await a.getByTestId("record").click();

// B closes the floating rack (F6) to see the whole playlist.
await b.locator("body").click({ position: { x: 5, y: 5 } });
await b.keyboard.press("F6");
const clipB = b.getByTestId("clip").first();
await clipB.waitFor({ timeout: 10000 }).then(() => ok("take shows on B's playlist"), () => fail("no clip on B"));
await b.locator('[data-testid="clip"][data-status="ready"][data-waveform="drawn"]').first().waitFor({ timeout: 20000 })
  .then(() => ok("take uploaded, downloaded and drawn in B"), () => fail("B never got the audio"));
const [startA, startB] = await Promise.all([
  a.getByTestId("clip").first().getAttribute("data-start-beat"),
  clipB.getAttribute("data-start-beat"),
]);
if (startA === startB) ok(`same position in both tabs (beat ${startA})`); else fail(`position A=${startA} B=${startB}`);

const takeInfo = await b.evaluate(() => {
  const doc = window.__oasisDoc;
  const takes = [...doc.getMap("takes").values()];
  const clips = [];
  doc.getMap("tracks").forEach((t) => t.get("clips").forEach((c) => clips.push(c)));
  return { take: takes[0], clip: clips[0] };
});
console.log("     take:", JSON.stringify(takeInfo.take));
console.log("     clip:", JSON.stringify(takeInfo.clip));
if (takeInfo.clip.lengthBeats > 2 && takeInfo.clip.lengthBeats < 8) ok(`clip length ${takeInfo.clip.lengthBeats.toFixed(2)} beats`); else fail("clip length looks wrong");
const head = await b.evaluate(async (url) => (await fetch(url, { method: "HEAD" })).status, takeInfo.take.url);
if (head === 200) ok("server serves the take by hash"); else fail(`HEAD ${head}`);

// Nudge from B shows in A.
await clipB.click();
await b.getByRole("button", { name: "Nudge later" }).click();
await b.getByRole("button", { name: "Nudge later" }).click();
await a.waitForTimeout(400);
const nudged = await a.evaluate(() => {
  let n = null;
  window.__oasisDoc.getMap("tracks").forEach((t) => t.get("clips").forEach((c) => (n = c.nudgeMs)));
  return n;
});
if (nudged === 10) ok("nudge synced (+10 ms)"); else fail(`nudge ${nudged}`);

// Drag the clip 2 beats later in B (snap: beat). A sees the new spot.
const box = await clipB.boundingBox();
await b.mouse.move(box.x + 20, box.y + box.height / 2);
await b.mouse.down();
await b.mouse.move(box.x + 20 + 30, box.y + box.height / 2, { steps: 4 });
await b.mouse.move(box.x + 20 + 50, box.y + box.height / 2, { steps: 4 });
await b.mouse.up();
await a.waitForTimeout(500);
const moved = await a.getByTestId("clip").first().getAttribute("data-start-beat");
if (Math.abs(Number(moved) - (Math.round(Number(startA)) + 2)) < 1e-6) ok(`dragged clip snapped to beat ${moved}`); else fail(`drag: ${startA} -> ${moved}`);

// A 1-bar count-in: the beat starts a bar later and the take still lands at bar 1.
await a.getByLabel("Count-in before recording").selectOption("1");
await a.getByTestId("record").click();
await a.getByText("■ Stop recording").waitFor();
await a.waitForTimeout(700);
const pos = await a.getByTestId("position").textContent();
if (pos?.startsWith("-") || pos === "1.1") ok(`count-in running (position ${pos})`); else fail(`count-in position ${pos}`);
await a.waitForTimeout(3300);
await a.getByTestId("record").click();
await b.waitForFunction(() => {
  let n = 0;
  window.__oasisDoc.getMap("tracks").forEach((t) => (n += t.get("clips").size));
  return n >= 2;
}, null, { timeout: 15000 });
const ci = await b.evaluate(() => {
  const all = [];
  window.__oasisDoc.getMap("tracks").forEach((t) => t.get("clips").forEach((c) => all.push(c)));
  return all.sort((x, y) => x.trimIn - y.trimIn).pop();
});
// Expect one bar more audio before bar 1 than the take without a count-in had.
const bpmNow = await b.evaluate(() => window.__oasisDoc.getMap("meta").get("bpm"));
const barS = (60 / bpmNow) * 4;
console.log("     count-in clip:", JSON.stringify(ci));
if (ci.startBeat === 0 && Math.abs(ci.trimIn - takeInfo.clip.trimIn - barS) < 0.1) ok(`count-in audio trimmed (${ci.trimIn.toFixed(2)} s before bar 1)`); else fail("count-in clip placement");
await a.getByLabel("Count-in before recording").selectOption("0");

// Refresh in the middle of a take: it should come back and upload.
await a.getByTestId("record").click();
await a.getByText("■ Stop recording").waitFor();
await a.waitForTimeout(1500);
await a.reload();
await a.getByLabel("Your name").isVisible().then(async (v) => { if (v) { await a.getByLabel("Your name").fill("Artist"); await a.getByRole("button", { name: "Continue" }).click(); } });
await a.getByTestId("record-toggle").click();
await a.getByTestId("record-note").waitFor({ timeout: 15000 }).then(async () => ok(`after refresh: "${await a.getByTestId("record-note").textContent()}"`), () => fail("no recovery note"));
// Someone has to stop the transport the reload left running.
await b.waitForFunction(() => {
  let n = 0;
  window.__oasisDoc.getMap("tracks").forEach((t) => (n += t.get("clips").size));
  return n >= 3;
}, null, { timeout: 15000 }).then(() => ok("rescued take is on B's playlist"), () => fail("rescued take missing"));

await b.screenshot({ path: process.env.SHOT ?? "e2e-record.png", fullPage: true });
await browser.close();
console.log(process.exitCode ? "SOME CHECKS FAILED" : "ALL CHECKS PASSED");
