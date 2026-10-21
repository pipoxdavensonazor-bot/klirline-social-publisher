import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  .filter(([, attributes]) => !/\bsrc\s*=/.test(attributes))
  .map(([, , source]) => source.trim())
  .filter(Boolean);

if (inlineScripts.length === 0) throw new Error("No inline application script found in index.html");
inlineScripts.forEach((source, index) => new vm.Script(source, { filename: `index.html:inline-script-${index + 1}` }));

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
