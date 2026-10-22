import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = resolve(apiRoot, "../vendor");
const output = resolve(vendorRoot, "klirline-x-text-3.1.0.js");
mkdirSync(vendorRoot, { recursive: true });

await build({
  entryPoints: [resolve(apiRoot, "src/x-text.js")],
  outfile: output,
  bundle: true,
  format: "iife",
  globalName: "KlirlineXText",
  platform: "browser",
  target: "es2020",
  minify: true,
  legalComments: "external"
});
const require = createRequire(import.meta.url);
function packageInfo(name, fromPaths) {
  for (const base of fromPaths) {
    const candidate = resolve(base, "..", name);
    try {
      const metadata = JSON.parse(readFileSync(resolve(candidate, "package.json"), "utf8"));
      if (metadata.name === name) return { directory: candidate, metadata };
    } catch {}
  }
  let directory = dirname(require.resolve(name, { paths: fromPaths }));
  while (true) {
    try {
      const metadataPath = resolve(directory, "package.json");
      const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
      if (metadata.name === name) return { directory, metadata };
    } catch {}
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Cannot find installed package metadata for ${name}`);
    directory = parent;
  }
}
const twitterText = packageInfo("twitter-text", [apiRoot]);
const bundledPackages = [
  twitterText,
  packageInfo("twemoji-parser", [twitterText.directory]),
  packageInfo("core-js", [twitterText.directory]),
  packageInfo("punycode", [twitterText.directory])
];
const notices = bundledPackages.map(({ directory, metadata }) => {
  const licenseFile = ["LICENSE", "LICENSE.md", "LICENSE-MIT.txt"].find((name) => {
    try { readFileSync(resolve(directory, name)); return true; } catch { return false; }
  });
  if (!licenseFile) throw new Error(`Cannot find license file for ${metadata.name}`);
  return `===== ${metadata.name} ${metadata.version} (${metadata.license || "see included license text"}) =====\n${readFileSync(resolve(directory, licenseFile), "utf8").trim()}`;
}).join("\n\n");
writeFileSync(resolve(vendorRoot, "THIRD-PARTY-LICENSES.txt"), `${notices}\n`);
console.log(`Built X text validator: ${output}`);
