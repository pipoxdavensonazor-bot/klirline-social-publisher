import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const api = resolve(root, "cloudflare-api");
const config = JSON.parse(readFileSync(resolve(api, "wrangler.jsonc"), "utf8"));
const migrations = readdirSync(resolve(api, "migrations")).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
const findings = [];
const fail = (message) => findings.push({ level: "BLOCK", message });
const warn = (message) => findings.push({ level: "ACTION", message });

if (config.name !== "klirline-social-api") fail(`Nom Worker inattendu: ${config.name}`);
if (config.d1_databases?.[0]?.database_id?.includes("REPLACE_WITH")) fail("Remplacer database_id dans cloudflare-api/wrangler.jsonc par l'ID D1 réel.");
if (!config.d1_databases?.length) fail("Binding D1 manquant.");
if (!config.r2_buckets?.length) fail("Binding R2 manquant.");
if (config.vars?.INTERNAL_MODE !== "true") fail("Activer INTERNAL_MODE=true pour l’espace Klirline interne.");
if (config.vars?.ALLOW_PUBLIC_SIGNUP !== "false") fail("Garder ALLOW_PUBLIC_SIGNUP à false; les inscriptions publiques sont interdites.");
if (config.vars?.REQUIRE_APPROVED_DRAFTS !== "true") fail("Exiger un brouillon partagé approuvé avant toute publication API automatique.");
for (const name of ["FRONTEND_ORIGIN", "PUBLIC_BASE_URL"]) {
  try {
    const url = new URL(config.vars?.[name]);
    if (url.protocol !== "https:") fail(`${name} doit être HTTPS en production.`);
    if (url.hostname.includes("example") || url.hostname === "app.klirline.com" || url.hostname === "api.klirline.com") warn(`${name} utilise encore le domaine d'exemple; remplacer par le domaine réellement configuré.`);
  } catch { fail(`${name} doit contenir une URL HTTPS valide.`); }
}
for (const name of ["META_APP_ID", "LINKEDIN_CLIENT_ID", "THREADS_APP_ID", "X_CLIENT_ID", "PINTEREST_APP_ID", "FACEBOOK_PAGE_ID", "LINKEDIN_ORGANIZATION_URN"]) {
  if (!config.vars?.[name]) warn(`Configurer ${name} seulement si le parcours correspondant est inclus au lancement.`);
}
for (const secret of ["SESSION_SECRET", "BOOTSTRAP_ADMIN_KEY", "TOKENS_ENCRYPTION_KEY_HEX", "META_APP_SECRET", "LINKEDIN_CLIENT_SECRET", "THREADS_APP_SECRET", "X_CLIENT_SECRET", "PINTEREST_APP_SECRET"]) {
  warn(`Créer/configurer le secret Cloudflare ${secret}; ne pas l'ajouter au dépôt.`);
}
if (!migrations.length) fail("Aucune migration D1 trouvée.");
else console.log(`Migrations détectées: ${migrations.join(", ")}`);
warn("Créer et vérifier les identifiants OAuth, domaines/callbacks et accès des comptes sociaux dans les consoles fournisseur.");
warn("Déployer d'abord l'API Worker depuis la racine cloudflare-api avec « npx wrangler deploy », puis appliquer les migrations D1 distantes.");
warn("Le Worker frontend doit utiliser la racine du dépôt, « npm run build » comme build et « npm run deploy » comme déploiement de production; ne pas utiliser « wrangler preview » en production.");

for (const { level, message } of findings) console.log(`${level === "BLOCK" ? "❌" : "➡️"} ${level}: ${message}`);
const blockers = findings.filter(({ level }) => level === "BLOCK");
console.log(`\nPrévol local: ${blockers.length ? `${blockers.length} blocage(s)` : "configuration structurelle cohérente"}; ${findings.length - blockers.length} action(s) externe(s) à traiter.`);
if (blockers.length) process.exitCode = 1;
