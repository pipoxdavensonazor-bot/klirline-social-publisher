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
