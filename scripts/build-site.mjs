import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "site");
const expectedOutput = resolve(root, "site");
const rel = relative(root, output);

if (output !== expectedOutput || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
  throw new Error("Refusing to clear a site output directory outside the repository.");
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

const publicFiles = [
  "index.html",
  "privacy.html",
  "terms.html",
  "deletion.html",
  "GUIDE-CAMPAGNES-INTERNATIONALES.md",
  "vendor/klirline-x-text-3.1.0.js",
  "vendor/THIRD-PARTY-LICENSES.txt",
];

for (const file of publicFiles) {
  const destination = resolve(output, file);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(resolve(root, file), destination);
}
console.log(`Built ${publicFiles.length} public files in ${output}`);
