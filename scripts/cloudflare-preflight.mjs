import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const api = resolve(root, "cloudflare-api");
const config = JSON.parse(readFileSync(resolve(api, "wrangler.jsonc"), "utf8"));
const migrations = readdirSync(resolve(api, "migrations")).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
const latestRequiredMigration = 14;
const findings = [];
const fail = (message) => findings.push({ level: "BLOCK", message });
const warn = (message) => findings.push({ level: "ACTION", message });

if (config.name !== "klirline-social-api") fail(`Nom Worker inattendu: ${config.name}`);
if (config.d1_databases?.[0]?.database_id?.includes("REPLACE_WITH")) fail("Remplacer database_id dans cloudflare-api/wrangler.jsonc par l'ID D1 réel.");
if (!config.d1_databases?.length) fail("Binding D1 manquant.");
if (!config.r2_buckets?.length) fail("Binding R2 manquant.");
const internalMode = config.vars?.INTERNAL_MODE === "true";
const publicSignup = config.vars?.ALLOW_PUBLIC_SIGNUP === "true";
if (internalMode === publicSignup) fail("Choisir un seul mode : INTERNAL_MODE=true pour usage interne, ou INTERNAL_MODE=false avec ALLOW_PUBLIC_SIGNUP=true pour l’offre commerciale.");
if (!internalMode && publicSignup && !config.vars?.STRIPE_PRICE_ID) warn("Créer dans Stripe le prix récurrent USD 9,99/mois par espace et renseigner STRIPE_PRICE_ID.");
if (!internalMode && publicSignup && config.vars?.STRIPE_AUTOMATIC_TAX_ENABLED !== "true") warn("Configurer Stripe Tax (inscriptions et calcul des taxes applicables), puis activer STRIPE_AUTOMATIC_TAX_ENABLED.");
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
for (const secret of ["SESSION_SECRET", "BOOTSTRAP_ADMIN_KEY", "TOKENS_ENCRYPTION_KEY_HEX", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "META_APP_SECRET", "LINKEDIN_CLIENT_SECRET", "THREADS_APP_SECRET", "X_CLIENT_SECRET", "PINTEREST_APP_SECRET"]) {
  warn(`Créer/configurer le secret Cloudflare ${secret}; ne pas l'ajouter au dépôt.`);
}
if (!migrations.length) fail("Aucune migration D1 trouvée.");
else {
  console.log(`Migrations détectées: ${migrations.join(", ")}`);
  const numbers = new Set(migrations.map((name) => Number(name.slice(0, 4))));
  const missing = Array.from({ length: latestRequiredMigration }, (_, index) => index + 1).filter((number) => !numbers.has(number));
  if (missing.length) fail(`Migrations manquantes avant la mise en service: ${missing.map((number) => String(number).padStart(4, "0")).join(", ")}.`);
  if (!numbers.has(13) || !numbers.has(14)) fail("Bluesky requiert les migrations 0013 (sessions OAuth) et 0014 (texte alternatif des médias).");
}
console.log("Canaux automatiques du Worker: Instagram, Page Facebook, Page LinkedIn, Threads, X, Pinterest et Bluesky.");
console.log("Canaux manuels: TikTok (pas de Direct Post pour cet outil interne) et Twitch (pas de post promotionnel générique).");
warn("Créer et vérifier les identifiants OAuth, domaines/callbacks et accès des comptes sociaux dans les consoles fournisseur.");
warn("Enregistrer les callbacks Meta (Instagram/Facebook), LinkedIn, Threads, X et Pinterest dans leurs consoles; Bluesky doit servir les métadonnées HTTPS /oauth/bluesky/client-metadata.json et son callback /oauth/bluesky/callback. Aucun secret OAuth partagé n’est requis pour Bluesky.");
warn("Créer d'abord D1/R2, inscrire l'ID D1 réel dans wrangler.jsonc, configurer les secrets/domaines, appliquer les migrations D1 distantes, puis déployer l'API Worker depuis cloudflare-api.");
warn("Le Worker frontend doit utiliser la racine du dépôt, « npm run build » comme build et « npm run deploy » comme déploiement de production; ne pas utiliser « wrangler preview » en production.");

for (const { level, message } of findings) console.log(`${level === "BLOCK" ? "❌" : "➡️"} ${level}: ${message}`);
const blockers = findings.filter(({ level }) => level === "BLOCK");
console.log(`\nPrévol local: ${blockers.length ? `${blockers.length} blocage(s)` : "configuration structurelle cohérente"}; ${findings.length - blockers.length} action(s) externe(s) à traiter.`);
if (blockers.length) process.exitCode = 1;
