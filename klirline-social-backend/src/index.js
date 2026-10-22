// API Klirline Social — Express.
//principes : secrets uniquement en env, tokens chiffres au repos, navigateur = metadonnees.
import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { timingSafeEqual } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PROVIDERS, PROVIDER_IDS, GENERIC_IDS, providerStatus } from "./config.js";
import { loadEnv, loadDb, saveDb, saveDbSync, uid, idempotencyKey } from "./lib.js";
import { register, login, authMiddleware, publicUser } from "./auth.js";
import { startOAuth, finishOAuth } from "./oauth.js";
import { publishOne, validateFor } from "./publish.js";
import { enqueue, cancelJob, startWorker } from "./queue.js";
import { LEGAL } from "./legal.js";

const env = loadEnv();
const db = loadDb(env);
LEGAL.privacy.body[0] = `Responsable : ${env.COMPANY_LEGAL_NAME || "à renseigner"}. Contact confidentialité : ${env.PRIVACY_CONTACT_EMAIL || "à renseigner"}.`;
const app = express();
app.use(express.json({ limit: "2mb" }));
const allowedOrigins = (env.FRONTEND_ORIGIN || "").split(",").map((x) => x.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : false, credentials: true, allowedHeaders: ["Content-Type", "X-Klirline-Request", "X-Klirline-Bootstrap", "Idempotency-Key"] }));
// Les écritures navigateur exigent une origine autorisée et un en-tête non-simple (protection CSRF).
app.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("Origin");
  if (!origin || !allowedOrigins.includes(origin) || req.get("X-Klirline-Request") !== "1") {
    return res.status(403).json({ error: "origin-or-csrf-check-failed" });
  }
  next();
});

const sessionCookie = "klirline_session";
function setSessionCookie(res, token) {
  res.cookie(sessionCookie, token, { httpOnly: true, secure: true, sameSite: "none", path: "/", maxAge: 12 * 60 * 60 * 1000 });
}
function clearSessionCookie(res) {
  res.clearCookie(sessionCookie, { httpOnly: true, secure: true, sameSite: "none", path: "/" });
}
function sameSecret(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}
function sniffImage(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", ext: "png" };
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp" };
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) return { mime: "image/gif", ext: "gif" };
  return null;
}

const mediaDir = env.MEDIA_DIR || join(env.DATA_DIR || "./data", "media");
mkdirSync(mediaDir, { recursive: true });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
app.use(env.MEDIA_PUBLIC_PREFIX || "/media", (req, res, next) => { res.setHeader("X-Content-Type-Options", "nosniff"); next(); }, express.static(mediaDir, { dotfiles: "deny", index: false }));

function mediaWithBytes(id) {
  const item = db.media.find((m) => m.id === id);
  if (!item) return null;
  try { return { ...item, buffer: readFileSync(join(mediaDir, item.name)) }; } catch { return null; }
}
function removeExpiredMedia() {
  const configuredRetention = Number(env.MEDIA_RETENTION_DAYS || 30);
  const retentionDays = Math.min(30, Math.max(1, Number.isFinite(configuredRetention) ? configuredRetention : 30));
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const expired = db.media.filter((m) => Date.parse(m.createdAt) < cutoff);
  if (!expired.length) return;
  for (const item of expired) {
    const path = join(mediaDir, item.name);
    if (existsSync(path)) { try { unlinkSync(path); } catch {} }
  }
  const ids = new Set(expired.map((m) => m.id));
  db.media = db.media.filter((m) => !ids.has(m.id));
  for (const job of db.jobs) if (ids.has(job.mediaId)) { job.status = "action-required"; job.results = [{ status: "action-required", message: "scheduled-media-expired" }]; }
  saveDb(env, db);
}
removeExpiredMedia();
const mediaCleanupTimer = setInterval(removeExpiredMedia, 24 * 60 * 60 * 1000);
mediaCleanupTimer.unref();
startWorker(env, db, mediaWithBytes);

app.get("/api/health", (req, res) => res.json({ ok: true, providers: PROVIDER_IDS }));
app.get("/api/legal/:doc", (req, res) => {
  const d = LEGAL[req.params.doc];
  if (!d) return res.status(404).json({ error: "unknown-doc" });
  res.json(d);
});
// Etat public d integration : scopes et pre-requis, JAMAIS de secrets.
app.get("/api/providers", (req, res) => res.json(
  Object.fromEntries(PROVIDER_IDS.map((id) => [id, { ...PROVIDERS[id], configured: providerStatus(id, env) }]))
));

// ---- Comptes utilisateurs + roles ----
const need = (...roles) => authMiddleware(env, db, ...roles);
app.get("/api/auth/bootstrap", (req, res) => res.json({ needsAdmin: db.users.length === 0 }));
app.post("/api/auth/register", (req, res, next) => {
  // Le premier administrateur requiert une clé à usage unique configurée hors du dépôt.
  if (db.users.length === 0) {
    if (!env.BOOTSTRAP_ADMIN_KEY) return res.status(503).json({ error: "bootstrap-admin-key-not-configured" });
    if (!sameSecret(req.get("X-Klirline-Bootstrap"), env.BOOTSTRAP_ADMIN_KEY)) return res.status(403).json({ error: "invalid-bootstrap-key" });
    return next();
  }
  return need("admin")(req, res, next);
}, (req, res) => {
  try {
    const first = db.users.length === 0;
    const role = first ? "admin" : "redacteur";
    const u = register(env, db, { email: req.body.email, password: req.body.password, role, org: "klirline" });
    const session = login(env, db, req.body);
    setSessionCookie(res, session.token);
    res.status(201).json({ user: u, first });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
app.post("/api/auth/login", (req, res) => {
  try { const session = login(env, db, req.body); setSessionCookie(res, session.token); res.json({ user: session.user }); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
app.post("/api/auth/logout", (req, res) => { clearSessionCookie(res); res.json({ ok: true }); });
app.get("/api/me", need(), (req, res) => res.json({ user: publicUser(req.user) }));
app.delete("/api/account", need(), (req, res) => {
  try {
    login(env, db, { email: req.user.email, password: req.body.password });
    const userId = req.user.id;
    if (db.jobs.some((j) => j.authorId === userId && j.status === "processing")) return res.status(409).json({ error: "scheduled-publication-in-progress" });
    const ownedMedia = db.media.filter((m) => m.owner === userId);
    for (const item of ownedMedia) {
      const path = join(mediaDir, item.name);
      if (existsSync(path)) { try { unlinkSync(path); } catch {} }
    }
    db.connections = db.connections.filter((c) => c.userId !== userId);
    db.posts = db.posts.filter((p) => p.authorId !== userId);
    db.jobs = db.jobs.filter((j) => j.authorId !== userId);
    db.media = db.media.filter((m) => m.owner !== userId);
    db.users = db.users.filter((u) => u.id !== userId);
    saveDbSync(env, db);
    clearSessionCookie(res);
    res.json({ ok: true, providerPermissionsRequireRevocation: true });
  } catch (e) { res.status(e.status || 401).json({ error: e.status ? e.message : "password-required" }); }
});

// ---- OAuth : demarrage + callback (redirect_uri = ce serveur) ----
app.get("/oauth/:provider/start", need("admin", "redacteur"), (req, res) => {
  try { res.redirect(startOAuth(env, req.params.provider, req.user)); }
  catch (e) { res.status(e.status || 500).send("OAuth: " + e.message); }
});
app.get("/oauth/:provider/callback", async (req, res) => {
  try {
    const meta = await finishOAuth(env, db, { provider: req.params.provider, code: req.query.code, state: req.query.state });
    const front = (env.FRONTEND_ORIGIN || "").split(",")[0];
    if (!front) return res.send("OAuth OK : " + meta.provider + " (" + (meta.account.label || "compte") + "). Retournez dans l application.");
    res.redirect(front + "#oauth-ok=" + encodeURIComponent(meta.provider));
  } catch (e) { res.status(e.status || 500).send("OAuth callback: " + e.message); }
});
app.get("/api/connections", need(), (req, res) => {
  // Metadonnees uniquement : provider, label verifie, scopes, expiration. Jamais de jeton.
  res.json(db.connections.filter((c) => c.userId === req.user.id).map((c) => ({ provider: c.provider, account: c.account, scopes: c.scopes, expiresAt: c.expiresAt, createdAt: c.createdAt })));
});
app.get("/api/posts", need(), (req, res) => res.json(db.posts.filter((p) => p.authorId === req.user.id)));
app.delete("/api/connections/:provider", need("admin", "redacteur"), (req, res) => {
  const i = db.connections.findIndex((c) => c.userId === req.user.id && c.provider === req.params.provider);
  if (i < 0) return res.status(404).json({ error: "not-found" });
  db.connections.splice(i, 1); saveDb(env, db);
  // Le jeton est effacé localement; l’utilisateur doit aussi retirer l’autorisation chez le fournisseur.
  res.json({ ok: true, providerAuthorizationMustBeRevoked: true });
});

// ---- Medias : upload serveur -> URL publique (ou chemin fichier selon fournisseur) ----
app.post("/api/media", need("admin", "redacteur"), upload.single("file"), (req, res) => {
  const f = req.file;
  if (!f) return res.status(400).json({ error: "no-file" });
  const imageType = sniffImage(f.buffer);
  if (!imageType) return res.status(400).json({ error: "unsupported-or-invalid-image" });
  const id = uid();
  const name = id + "." + imageType.ext;
  writeFileSync(join(mediaDir, name), f.buffer);
  const rec = { id, name, mime: imageType.mime, size: f.size, url: (env.PUBLIC_BASE_URL || "") + (env.MEDIA_PUBLIC_PREFIX || "/media") + "/" + name, createdAt: new Date().toISOString(), owner: req.user.id };
  db.media.push(rec); saveDb(env, db);
  res.json({ id, url: rec.url, mime: rec.mime, size: rec.size });
});

// ---- Publication : adaptateurs par reseau, statuts par destination ----
app.post("/api/publish", need("admin", "redacteur"), async (req, res) => {
  const { text, targets, mediaId } = req.body;
  const requestKey = String(req.get("Idempotency-Key") || "").slice(0, 128);
  if (requestKey) {
    const previous = db.posts.find((p) => p.authorId === req.user.id && p.idempotencyKey === requestKey);
    if (previous) return res.json({ results: previous.results, deduped: true, postId: previous.id });
  }
  if (!Array.isArray(targets)) return res.status(400).json({ error: "targets-must-be-array" });
  const list = [...new Set(targets.filter((t) => typeof t === "string" && PROVIDERS[t]))];
  if (!text?.trim()) return res.status(400).json({ error: "empty-text" });
  if (!list.length) return res.status(400).json({ error: "no-targets" });
  const media = mediaId ? db.media.find((m) => m.id === mediaId) : null;
  if (mediaId && (!media || media.owner !== req.user.id)) return res.status(404).json({ error: "media-not-found" });
  const mediaPayload = mediaId ? mediaWithBytes(mediaId) : null;
  if (mediaId && !mediaPayload) return res.status(404).json({ error: "media-file-missing" });
  const results = [];
  for (const provider of list) {
    const conn = db.connections.find((c) => c.userId === req.user.id && c.provider === provider);
    if (!conn) { results.push({ provider, status: "action-required", message: "not-connected" }); continue; }
    results.push({ provider, ...(await publishOne(env, db, { connection: conn, text, media: mediaPayload })) });
  }
  db.posts.push({ id: uid(), authorId: req.user.id, idempotencyKey: requestKey || null, text: text.slice(0, 4000), targets: list, mediaId: mediaId || null, results, createdAt: new Date().toISOString() });
  saveDb(env, db);
  res.json({ results });
});

// ---- Programmation reelle : date UTC, idempotence, annulation ----
app.post("/api/scheduled", need("admin", "redacteur"), (req, res) => {
  const { text, targets, mediaId, runAtUTC } = req.body;
  const requestKey = String(req.get("Idempotency-Key") || "").slice(0, 128);
  if (!Array.isArray(targets)) return res.status(400).json({ error: "targets-must-be-array" });
  const list = [...new Set(targets.filter((t) => typeof t === "string" && GENERIC_IDS.includes(t)))];
  if (!text?.trim() || !list.length || !runAtUTC) return res.status(400).json({ error: "text-targets-runAtUTC-required" });
  if (typeof runAtUTC !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(runAtUTC)) return res.status(400).json({ error: "runAtUTC-must-be-ISO-UTC" });
  const run = new Date(runAtUTC);
  if (isNaN(run) || run.getTime() < Date.now() + 60000) return res.status(400).json({ error: "runAtUTC-must-be-future-UTC" });
  const media = mediaId ? db.media.find((m) => m.id === mediaId) : null;
  if (mediaId && (!media || media.owner !== req.user.id)) return res.status(404).json({ error: "media-not-found" });
  for (const p of list) {
    const v = validateFor(p, text, mediaId ? { id: 1 } : null);
    if (v === "too-long:" + PROVIDERS[p].limit || v?.startsWith?.("too-long")) return res.status(400).json({ error: "too-long:" + p });
    if (v === "media-required") return res.status(400).json({ error: "media-required:" + p });
  }
  const idem = requestKey
    ? idempotencyKey({ authorId: req.user.id, text: requestKey, targets: [], mediaId: null, runAtUTC: "request" })
    : idempotencyKey({ authorId: req.user.id, text, targets: list, mediaId, runAtUTC: run.toISOString() });
  const { job, deduped } = enqueue(env, db, { authorId: req.user.id, text, targets: list, mediaId, runAtUTC: run.toISOString(), idem });
  res.json({ job: { id: job.id, runAtUTC: job.runAtUTC, status: job.status, targets: job.targets }, deduped });
});
app.get("/api/scheduled", need(), (req, res) => res.json(db.jobs.filter((j) => j.authorId === req.user.id)));
app.delete("/api/scheduled/:id", need("admin", "redacteur"), (req, res) => {
  const j = cancelJob(env, db, req.params.id, req.user.id);
  if (!j) return res.status(404).json({ error: "not-found" });
  res.json({ id: j.id, status: j.status });
});

// ---- Checklist app reviews (Meta, LinkedIn, X, TikTok, Pinterest, Twitch) ----
app.get("/api/review-checklist", (req, res) => res.json([
  { area: "Meta (IG/FB/Threads)", items: ["App + cas d usage Threads", "redirects exactes", "compte Pro IG + Page FB", "screencast + compte test", "confidentialite/suppression"] },
  { area: "LinkedIn", items: ["produit Community Management", "admin Page approbateur", "w_organization_social", "ID org post-OAuth"] },
  { area: "X", items: ["projet/app Developer", "callback PKCE", "plan/couts/quotas verifies"] },
  { area: "TikTok", items: ["produit Content Posting", "video.publish", "audit (sinon posts prives)", "URL verifiee ou upload fichier"] },
  { area: "Pinterest", items: ["app approuvee", "pins:write + boards:read", "redirect exacte", "board choisie par Pin"] },
  { area: "Twitch", items: ["action retenue (clip/annonce/chaine)", "scopes minimaux", "contraintes stream/VOD"] },
  { area: "Bluesky", items: ["OAuth AT Protocol sur PDS", "handle/DID + sessions", "aucun mot de passe partage"] },
]));

const port = Number(env.PORT || 8787);
saveDbSync(env, db);
app.listen(port, () => console.log("Klirline backend : " + port + " — callbacks : " + (env.PUBLIC_BASE_URL || "?") + "/oauth/:provider/callback"));
