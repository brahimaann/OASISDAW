// Patterns test: length, the picker (per person), painting and dragging
// patterns onto the playlist, double-click to open, right-click to remove,
// and PAT / SONG play. Needs the app in DEV mode. Run: node e2e/patterns.mjs [baseUrl]
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const base = process.argv[2] ?? "http://localhost:5173";
const room = `pat${Date.now().toString(36)}`;
const fail = (msg) => { console.error("FAIL:", msg); process.exitCode = 1; };
const ok = (msg) => console.log("ok  ", msg);
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });

async function join(name) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on("pageerror", (e) => console.error(`[${name}] pageerror`, e.message));
  await page.goto(`${base}/room/${room}`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("play").waitFor();
  const banner = page.getByText("Click here to turn on sound");
  if (await banner.isVisible()) await banner.click();
  return page;
}
const cell = (page, name) => page.getByTestId("sequencer").getByRole("button", { name, exact: true });
const clips = (page) => page.evaluate(() => {
  const out = [];
  window.__oasisDoc.getMap("tracks").forEach((t) => t.get("clips").forEach((c, id) => out.push({ id, ...c, track: t.get("name") })));
  return out;
});

const a = await join("Prince");
const b = await join("Hima");

// Length: 2 bars from the picker, then drag the edge out to 4.
await a.getByTestId("pattern-length").selectOption("32");
await cell(b, "Kick, step 32").waitFor({ timeout: 3000 }).then(() => ok("2-bar pattern shows 32 steps for B"), () => fail("length 32"));
const h = await a.getByTestId("length-handle").boundingBox();
await a.mouse.move(h.x + h.width / 2, h.y + 10);
await a.mouse.down();
await a.mouse.move(h.x + 600, h.y + 10, { steps: 8 });
await a.mouse.up();
const len = await a.getByTestId("pattern-length").inputValue();
if (Number(len) > 32) ok(`dragging the edge made it ${Number(len) / 16} bars`); else fail(`edge drag: ${len}`);
await a.getByTestId("pattern-length").selectOption("16");

// New pattern: A moves to Pattern 2, B stays on Pattern 1.
await a.getByTestId("new-pattern").click();
const picked = await a.getByTestId("pattern-picker").locator("option:checked").textContent();
if (picked === "Pattern 2") ok("+ New makes Pattern 2 with the same sounds"); else fail(`picker ${picked}`);
await cell(a, "Snare, step 9").click();
await b.waitForTimeout(400);
if ((await b.getByTestId("pattern-picker").locator("option:checked").textContent()) === "Pattern 1") ok("B's rack stays on Pattern 1 (per person)"); else fail("B moved");
await b.locator("body").click({ position: { x: 5, y: 5 } });
await b.keyboard.press("+");
await b.waitForTimeout(200);
if ((await cell(b, "Snare, step 9").getAttribute("aria-pressed")) === "true") ok("+ key steps B to Pattern 2 with A's edit"); else fail("+ key");
await b.keyboard.press("-");

// Paint: A closes the rack and clicks bar 3 of the empty lane. Pattern 2 lands there.
await a.locator("body").click({ position: { x: 5, y: 5 } });
await a.keyboard.press("F6");
const lane = await a.getByTestId("new-lane").boundingBox();
await a.mouse.click(lane.x + 2 * 4 * 24 + 5, lane.y + 20);
await b.waitForTimeout(400);
let cs = await clips(b);
if (cs.length === 1 && cs[0].kind === "pattern" && cs[0].startBeat === 8 && cs[0].lengthBeats === 4) ok(`painted clip at bar 3 on "${cs[0].track}"`); else fail(`paint ${JSON.stringify(cs)}`);

// Drag Pattern 1 from the browser onto the same track at bar 1.
await a.getByRole("button", { name: "patterns", exact: true }).click();
await a.locator('[data-pattern="main"]').first().dragTo(a.getByTestId("lane").first(), { targetPosition: { x: 5, y: 20 } });
await b.waitForTimeout(400);
cs = await clips(b);
if (cs.some((c) => c.patternId === "main" && c.startBeat === 0)) ok("dragged Pattern 1 from the browser onto bar 1"); else fail(`drag ${JSON.stringify(cs)}`);

// Changing Pattern 1's length grows its clip.
await b.getByTestId("pattern-length").selectOption("32");
await a.waitForTimeout(400);
cs = await clips(a);
if (cs.find((c) => c.patternId === "main")?.lengthBeats === 8) ok("clip grew with its pattern (2 bars)"); else fail("clip length follow");
await b.getByTestId("pattern-length").selectOption("16");

// Double-click a pattern clip in B: the rack opens on it.
await b.locator("body").click({ position: { x: 5, y: 5 } });
await b.keyboard.press("F6");
const p2 = b.locator('[data-testid="pattern-clip"]').filter({ hasText: "Pattern 2" });
await p2.dblclick();
await b.getByTestId("floating-window").waitFor();
if ((await b.getByTestId("pattern-picker").locator("option:checked").textContent()) === "Pattern 2") ok("double-click opened Pattern 2 in the rack"); else fail("dblclick");

// SONG mode: Pattern 1 at bar 1 lights the rack when B looks at Pattern 1; PAT mode loops what's open.
await b.getByTestId("pattern-picker").selectOption({ label: "Pattern 1" });
await b.getByTestId("mode-song").click();
await b.getByTestId("play").click();
await b.waitForTimeout(700);
const lit = await b.locator('[data-testid="sequencer"] [data-current]').count();
if (lit > 0) ok("SONG: Pattern 1's clip is playing at bar 1"); else fail("song light");
await b.waitForTimeout(1600); // bar 2 is empty on the playlist
const lit2 = await b.locator('[data-testid="sequencer"] [data-current]').count();
if (lit2 === 0) ok("SONG: nothing plays where the playlist is empty"); else fail("song gap");
const aMode = await a.getByTestId("mode-pat").getAttribute("aria-checked");
if (aMode === "true") ok("A is still in PAT mode (mode is per person)"); else fail("mode shared");
await b.getByTestId("mode-pat").click();
await b.waitForTimeout(300);
if (await b.locator('[data-testid="sequencer"] [data-current]').count() > 0) ok("PAT: the open pattern loops"); else fail("pat loop");
await b.getByTestId("play").click();

// Right-click removes a clip.
await b.locator("body").click({ position: { x: 5, y: 5 } });
await b.keyboard.press("F6");
await p2.click({ button: "right" });
await a.waitForTimeout(400);
cs = await clips(a);
if (!cs.some((c) => c.patternId !== "main")) ok("right-click removed the clip for everyone"); else fail("right-click");

// Starter patterns: A adds "Boom bap" from the browser; B gets the grid. The tempo button sets the BPM.
await a.locator("body").click({ position: { x: 5, y: 5 } });
await a.getByTestId("browser").getByRole("button", { name: "patterns", exact: true }).click();
await a.getByTestId("starter-toggle").click();
await a.locator('[data-starter="ll-04"]').click();
await b.waitForTimeout(500);
const boom = await b.evaluate(() => {
  let out = null;
  window.__oasisDoc.getMap("patterns").forEach((p) => {
    if (p.get("name") !== "Boom bap 80") return;
    const rows = {};
    p.get("rows").forEach((r) => { rows[r.get("name")] = { sound: r.get("soundId"), steps: [...r.get("steps").keys()].map(Number).sort((x, y) => x - y) }; });
    out = { length: p.get("length"), rows };
  });
  return out;
});
if (boom && boom.length === 16 && boom.rows.Kick?.steps.join() === "0,6,8" && boom.rows.Kick.sound === "builtin:kick" && boom.rows.Hat?.steps.length === 8) ok("starter pattern arrived in B with its grid"); else fail("starter: " + JSON.stringify(boom));
if ((await a.getByTestId("pattern-picker").locator("option:checked").textContent()) === "Boom bap 80") ok("starter opened in A's rack"); else fail("starter open");
await a.locator('[data-starter-bpm="ll-04"]').click();
await b.waitForTimeout(400);
if ((await b.evaluate(() => window.__oasisDoc.getMap("meta").get("bpm"))) === 80) ok("tempo button set the room to 80 BPM"); else fail("starter bpm");

await a.screenshot({ path: process.env.SHOT ?? "e2e-patterns.png" });
await browser.close();
console.log(process.exitCode ? "SOME CHECKS FAILED" : "ALL CHECKS PASSED");
