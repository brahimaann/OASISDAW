// Export test: bounce one pattern loop (mix + stems zip), the song from the
// playlist, and the share link. Needs the app in DEV mode. Run: node e2e/export.mjs [baseUrl]
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const base = process.argv[2] ?? "http://localhost:5173";
const room = `exp${Date.now().toString(36)}`;
const fail = (msg) => { console.error("FAIL:", msg); process.exitCode = 1; };
const ok = (msg) => console.log("ok  ", msg);

/** Reads a PCM WAV: channels, rate, bits, frames, and peak level. */
function readWav(buf) {
  const ch = buf.readUInt16LE(22), rate = buf.readUInt32LE(24), bits = buf.readUInt16LE(34), len = buf.readUInt32LE(40);
  const frames = len / (ch * bits / 8);
  let peak = 0;
  for (let o = 44; o + 2 < 44 + len; o += 3) {
    let x = buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16);
    if (x & 0x800000) x -= 0x1000000;
    peak = Math.max(peak, Math.abs(x) / 0x800000);
  }
  return { ch, rate, bits, frames, peak, riff: buf.toString("ascii", 0, 4) };
}

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("pageerror", e.message));
await page.goto(`${base}/room/${room}`);
await page.getByLabel("Your name").fill("Prince");
await page.getByRole("button", { name: "Continue" }).click();
await page.getByTestId("play").waitFor();
const banner = page.getByText("Click here to turn on sound");
if (await banner.isVisible()) await banner.click();

const cell = (n) => page.getByTestId("sequencer").getByRole("button", { name: n, exact: true });
for (const s of [1, 7, 11]) await cell(`Kick, step ${s}`).click();
for (const s of [5, 13]) await cell(`Snare, step ${s}`).click();
for (const s of [1, 3, 5, 7, 9, 11, 13, 15]) await cell(`Hat, step ${s}`).click();
const bpm = 140;

// 1. One loop of the pattern: mix + stems.
await page.getByTestId("export-button").click();
await page.getByLabel("Beat name").fill("Late night");
await page.getByLabel("Key").fill("Fmin");
await page.getByTestId("export-stems").check();
const downloads = [];
page.on("download", (d) => downloads.push(d));
await page.getByTestId("export-go").click();
await page.getByTestId("export-note").waitFor({ timeout: 30000 });
console.log("    ", await page.getByTestId("export-note").textContent());
await page.waitForTimeout(500);
const names = downloads.map((d) => d.suggestedFilename());
console.log("     files:", names.join(" | "));
if (names.includes("Late night - 140bpm - Fmin - Pattern 1.wav")) ok("mix named with beat, BPM, key, pattern"); else fail("mix name");
const mixPath = await downloads.find((d) => d.suggestedFilename().endsWith("Pattern 1.wav"))?.path();
if (mixPath) {
  const w = readWav(await readFile(mixPath));
  const want = Math.round((16 * 15 / bpm) * 44100);
  console.log("     mix:", JSON.stringify(w), "want frames", want);
  if (w.riff === "RIFF" && w.ch === 2 && w.bits === 24 && w.rate === 44100) ok("24-bit stereo 44.1 kHz WAV"); else fail("wav format");
  if (Math.abs(w.frames - want) <= 2) ok("exactly one bar long (a clean loop)"); else fail(`frames ${w.frames}`);
  if (w.peak > 0.05 && w.peak <= 1) ok(`has sound, no clipping (peak ${w.peak.toFixed(2)})`); else fail(`peak ${w.peak}`);
}
const zipPath = await downloads.find((d) => d.suggestedFilename().endsWith("stems.zip"))?.path();
if (zipPath) {
  const zip = await readFile(zipPath);
  const entries = [...zip.toString("latin1").matchAll(/Late night - 140bpm - Fmin - Pattern 1 - (\w+)\.wav/g)].map((m) => m[1]);
  const uniq = [...new Set(entries)].sort();
  if (uniq.join(",") === "Hat,Kick,Snare") ok(`stems zip holds Hat, Kick, Snare (no empty Clap)`); else fail(`stems ${uniq}`);
} else fail("no zip");

// 2. Share link for the mix.
await page.getByTestId("export-share").click();
await page.getByTestId("export-link").waitFor({ timeout: 20000 });
const link = await page.getByTestId("export-link").inputValue();
const res = await page.evaluate(async (u) => { const r = await fetch(u); return { status: r.status, cd: r.headers.get("content-disposition"), size: (await r.arrayBuffer()).byteLength }; }, link);
console.log("     link:", link.replace(/^https?:\/\/[^/]+/, ""), JSON.stringify(res));
if (res.status === 200 && res.cd?.includes("Late night - 140bpm - Fmin - Pattern 1.wav")) ok("share link downloads the mix with its name"); else fail("share link");
await page.getByRole("button", { name: "Close export" }).click();

// 3. The song: Pattern 1 on bars 1-2 of the playlist. Length = 2 bars + 2 s tail.
await page.locator("body").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("F6");
for (const bar of [0, 1]) {
  const lane = await page.getByTestId("new-lane").boundingBox();
  const target = bar === 0 ? lane : await page.getByTestId("lane").first().boundingBox();
  await page.mouse.click(target.x + bar * 96 + 4, target.y + 20);
}
downloads.length = 0;
await page.getByTestId("export-button").click();
await page.getByTestId("export-stems").uncheck();
await page.getByTestId("export-go").click();
await page.getByTestId("export-note").waitFor({ timeout: 30000 });
await page.waitForTimeout(500);
const songPath = await downloads[0]?.path();
if (songPath) {
  const w = readWav(await readFile(songPath));
  const want = Math.round((2 * 16 * 15 / bpm + 2) * 44100);
  console.log("     song:", downloads[0].suggestedFilename(), JSON.stringify(w));
  if (Math.abs(w.frames - want) <= 2 && w.peak > 0.05) ok("song bounce: 2 bars + 2 s tail, with sound"); else fail(`song frames ${w.frames} want ${want}`);
  if (downloads[0].suggestedFilename() === "Late night - 140bpm - Fmin.wav") ok("name and key were kept for the next export"); else fail("name/key not kept");
} else fail("no song download");

await browser.close();
console.log(process.exitCode ? "SOME CHECKS FAILED" : "ALL CHECKS PASSED");
