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
console.log("Frontend JavaScript and Wrangler/package configuration syntax: PASS");
