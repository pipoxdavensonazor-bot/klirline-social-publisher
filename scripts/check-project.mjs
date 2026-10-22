import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  .filter(([, attributes]) => !/\bsrc\s*=/.test(attributes))
  .map(([, , source]) => source.trim())
  .filter(Boolean);

if (inlineScripts.length === 0) throw new Error("No inline application script found in index.html");
inlineScripts.forEach((source, index) => new vm.Script(source, { filename: `index.html:inline-script-${index + 1}` }));
if (!html.includes("Brouillons (${sharedDrafts.length+drafts.length})")) throw new Error("The drafts section count must include shared and local drafts.");

const timezoneSource = inlineScripts[0].match(/function calendarDayKey\(date\)[\s\S]*?(?=function populateTimeZones\()/)?.[0];
if (!timezoneSource) throw new Error("Campaign timezone helpers not found in index.html");
const timezoneContext = {};
new vm.Script(`${timezoneSource}; globalThis.timezoneHelpers = { calendarDayKey, dateKeyInTimeZone, wallClockToUTC };`).runInNewContext(timezoneContext);
const { calendarDayKey, dateKeyInTimeZone, wallClockToUTC } = timezoneContext.timezoneHelpers;
assert.equal(calendarDayKey(new Date(2026, 9, 22, 12)), "2026-10-22");
assert.equal(dateKeyInTimeZone("2026-10-22T00:00:00.000Z", "Asia/Tokyo"), "2026-10-22");
assert.equal(dateKeyInTimeZone("2026-10-22T00:00:00.000Z", "America/Toronto"), "2026-10-21");
assert.equal(wallClockToUTC("2026-10-22T09:00", "Asia/Tokyo").toISOString(), "2026-10-22T00:00:00.000Z");
assert.equal(wallClockToUTC("2026-10-22T09:00", "America/Toronto").toISOString(), "2026-10-22T13:00:00.000Z");
let rejectedMissingDstTime = false;
try { wallClockToUTC("2026-03-08T02:30", "America/Toronto"); } catch (error) { rejectedMissingDstTime = /n’existe pas/.test(error.message); }
assert.equal(rejectedMissingDstTime, true, "nonexistent DST wall times must be rejected");
assert.equal(wallClockToUTC("2026-11-01T01:30", "America/Toronto").toISOString(), "2026-11-01T05:30:00.000Z", "repeated fall-back wall times use their first occurrence");
console.log("Campaign timezone and daylight-saving checks: PASS");

const targetingSource = inlineScripts[0].match(/function targetNetwork\(target\)\{[\s\S]*?(?=function refreshProfiles\()/)?.[0];
if (!targetingSource) throw new Error("Regional account selection helpers not found in index.html");
const targetingContext = {
  networks: ["Facebook", "Instagram"],
  networkFor: { facebook: "Facebook", instagram: "Instagram" },
  providerFor: { Facebook: "facebook", Instagram: "instagram" },
  profiles: {},
  selected: ["acct:fb-fr"],
  apiUser: { role: "admin" },
  apiConnections: [
    { id: "fb-ca", provider: "facebook", account: { label: "Klirline Canada" } },
    { id: "fb-fr", provider: "facebook", account: { label: "Klirline France" } },
  ],
  isReadyConnection: () => true,
};
new vm.Script(`${targetingSource}; globalThis.targeting={targetNetwork,normalizeSelectedTargets,activeTargets,providerTarget};`).runInNewContext(targetingContext);
const targeting = targetingContext.targeting;
assert.equal(targeting.targetNetwork({ provider: "facebook", connectionId: "fb-fr" }), "Facebook");
assert.deepEqual(Array.from(targeting.activeTargets()), ["Facebook"]);
assert.equal(JSON.stringify(targeting.providerTarget(targeting.activeTargets())), JSON.stringify([{ provider: "facebook", connectionId: "fb-fr" }]));
targetingContext.selected = ["Facebook"];
assert.equal(JSON.stringify(targeting.providerTarget(targeting.activeTargets())), JSON.stringify([
  { provider: "facebook", connectionId: "fb-ca" },
  { provider: "facebook", connectionId: "fb-fr" },
]));
targetingContext.selected = ["acct:unknown"];
assert.deepEqual(Array.from(targeting.normalizeSelectedTargets(targetingContext.selected)), []);
console.log("Regional account targeting selection checks: PASS");

const xTextBundle = readFileSync(new URL("../vendor/klirline-x-text-3.1.0.js", import.meta.url), "utf8");
const xTextContext = {};
vm.runInNewContext(xTextBundle, xTextContext, { filename: "vendor/klirline-x-text-3.1.0.js" });
assert.equal(xTextContext.KlirlineXText.xTextMetrics("✨".repeat(140)).weightedLength, 280);
assert.equal(xTextContext.KlirlineXText.xTextMetrics("✨".repeat(141)).valid, false);
assert.equal(xTextContext.KlirlineXText.xTextMetrics("https://example.com/a/very/long/path".padEnd(240, "x")).weightedLength, 23);
if (!html.includes('<script src="vendor/klirline-x-text-3.1.0.js"></script>')) throw new Error("The browser X validator is not loaded by index.html");
console.log("Browser X weighted-length checks: PASS");

JSON.parse(readFileSync(new URL("../cloudflare-api/wrangler.jsonc", import.meta.url), "utf8"));
JSON.parse(readFileSync(new URL("../cloudflare-api/package.json", import.meta.url), "utf8"));
const staticWorker = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const rootPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
if (staticWorker.name !== "klirline-social-publisher") throw new Error("Static Worker name must match the Cloudflare service.");
if (staticWorker.assets?.directory !== "./site") throw new Error("Static Worker must serve only the generated site/ directory.");
if (!staticWorker.previews || typeof staticWorker.previews !== "object") throw new Error("Worker preview builds require a previews configuration block.");
if (rootPackage.scripts?.build !== "node scripts/build-site.mjs") throw new Error("Root build script must produce the static Worker asset directory.");
if (rootPackage.scripts?.deploy !== "npx wrangler deploy") throw new Error("The root deploy script must use wrangler deploy, not preview.");
console.log("Frontend JavaScript and Wrangler/package configuration syntax: PASS");
