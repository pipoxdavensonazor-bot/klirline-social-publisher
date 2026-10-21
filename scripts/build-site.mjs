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
];

for (const file of publicFiles) copyFileSync(resolve(root, file), resolve(output, file));
console.log(`Built ${publicFiles.length} public files in ${output}`);
