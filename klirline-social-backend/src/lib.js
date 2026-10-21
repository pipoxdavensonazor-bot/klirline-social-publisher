// Stockage JSON fichier (zero dependance) + chiffrement AES-256-GCM des tokens + JWT.
// Les tokens chiffrés ne quittent JAMAIS le serveur : l API n expose que des metadonnees.
import { randomBytes, createCipheriv, createDecipheriv, createHash, randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export function loadEnv() {
  const env = process.env;
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 || env.JWT_SECRET === "changez-moi-64-caracteres-minimum") {
    throw new Error("Configurez JWT_SECRET avec au moins 32 caracteres aleatoires avant de demarrer le serveur.");
  }
  if (!/^[0-9a-fA-F]{64}$/.test(env.TOKENS_ENCRYPTION_KEY_HEX || "")) {
    throw new Error("Configurez TOKENS_ENCRYPTION_KEY_HEX avec exactement 64 caracteres hexadecimaux avant de demarrer le serveur.");
  }
  if (env.NODE_ENV === "production" && (!/^https:\/\//i.test(env.PUBLIC_BASE_URL || "") || !env.FRONTEND_ORIGIN)) {
    throw new Error("En production, PUBLIC_BASE_URL et FRONTEND_ORIGIN HTTPS sont obligatoires.");
  }
  return env;
}

export function dataDir(env) { return env.DATA_DIR || "./data"; }
function dbPath(env) { return join(dataDir(env), "klirline.json"); }

export function loadDb(env) {
  const d = dataDir(env);
  mkdirSync(d, { recursive: true });
  const p = dbPath(env);
  if (!existsSync(p)) {
    const init = { users: [], connections: [], posts: [], jobs: [], media: [] };
    writeFileSync(p, JSON.stringify(init, null, 2));
    return init;
  }
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch (error) { throw new Error(`Database file is unreadable (${p}); refusing to start with empty data: ${error.message}`); }
}
let saveTimer = null;
export function saveDb(env, db) {
  // Ecriture regroupee (anti-rafale) — persistance simple mais suffisante pour mono-entreprise.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { writeFileSync(dbPath(env), JSON.stringify(db, null, 2)); } catch {}
  }, 50);
}
export function saveDbSync(env, db) {
  mkdirSync(dataDir(env), { recursive: true });
  writeFileSync(dbPath(env), JSON.stringify(db, null, 2));
}

// ---- Chiffrement tokens (AES-256-GCM) ----
function encKey(env) {
  const hex = env.TOKENS_ENCRYPTION_KEY_HEX || "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("TOKENS_ENCRYPTION_KEY_HEX manquante (64 hex). Voir env.example.txt");
  return Buffer.from(hex, "hex");
}
export function encryptToken(env, plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(env), iv);
  const data = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return { iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), data: data.toString("hex") };
}
export function decryptToken(env, sealed) {
  const decipher = createDecipheriv("aes-256-gcm", encKey(env), Buffer.from(sealed.iv, "hex"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, "hex")), decipher.final()]).toString("utf8");
}

// ---- Etats OAuth anti-CSRF signes (HMAC) ----
export function signState(env, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET is not configured");
  const sig = createHmac("sha256", env.JWT_SECRET).update(body).digest("base64url");
  return body + "." + sig;
}
export function verifyState(env, state) {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) return null;
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) return null;
  const expect = createHmac("sha256", env.JWT_SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
  if (p.exp && Date.now() > p.exp) return null;
  return p;
}

// ---- PKCE (X, et fournisseurs le supportant) ----
export function pkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// ---- Divers ----
export const uid = () => randomUUID();
export function sha256(s) { return createHash("sha256").update(String(s)).digest("hex"); }
// Cle d idempotence : meme contenu + memes cibles + meme auteur = meme cle -> pas de double post.
export function idempotencyKey({ authorId, text, targets, mediaId, runAtUTC }) {
  return sha256([authorId, text, [...targets].sort().join(","), mediaId || "-", runAtUTC || "-"].join("|"));
}
