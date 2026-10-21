const PROVIDERS = {
  instagram: { name: "Instagram", limit: 2200, scopes: ["instagram_business_basic", "instagram_business_content_publish"] },
  facebook: { name: "Facebook Page", limit: 63206, scopes: ["pages_show_list", "pages_manage_posts", "pages_read_engagement"] },
  linkedin: { name: "LinkedIn Page", limit: 3000, scopes: ["openid", "profile", "r_organization_admin", "w_organization_social"] },
  x: { name: "X", limit: 280, scopes: ["tweet.read", "tweet.write", "users.read", "offline.access", "media.write"] }, threads: { name: "Threads", limit: 500, scopes: ["threads_basic", "threads_content_publish"] }, pinterest: { name: "Pinterest", limit: 800, scopes: ["boards:read", "pins:write"] },
  bluesky: { name: "Bluesky", limit: 300 }, tiktok: { name: "TikTok", limit: 2200 }, twitch: { name: "Twitch", limit: 500 }
};
const LAUNCH_PROVIDERS = ["instagram", "facebook", "linkedin", "threads", "x", "pinterest"];
const REQUIRED_SCHEMA_TABLES = ["users", "oauth_states", "connections", "media", "posts", "scheduled_posts", "scheduled_results", "organizations", "usage_counters", "auth_limits", "team_invitations", "audit_events", "campaign_drafts"];
const REQUIRED_SCHEMA_COLUMNS = [
  ["campaign_drafts", "publication_state"],
  ["posts", "campaign_draft_id"],
  ["scheduled_posts", "campaign_draft_id"]
];
const DEFAULT_MAX_ACCOUNTS = 9;
const NON_ISO_REGION_CODES = new Set(["AC", "CP", "DG", "EA", "EU", "EZ", "IC", "QO", "TA", "UK", "UN", "XK"]);
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const COOKIE = "klirline_session";
const OAUTH_COOKIE = "klirline_oauth_state";

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), (c) => c.charCodeAt(0));
const randomId = (size = 24) => b64u(crypto.getRandomValues(new Uint8Array(size)));
const nowIso = () => new Date().toISOString();
const httpError = (message, status = 400) => Object.assign(new Error(message), { status });
async function auditEvent(db, orgId, actorId, type, targetId = null, details = {}) {
  const safeDetails = JSON.stringify(details).slice(0, 2000);
  await db.prepare("INSERT INTO audit_events(id,org_id,actor_user_id,event_type,target_id,details_json,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(randomId(), orgId, actorId || null, type, targetId, safeDetails, nowIso()).run();
}

function allowedOrigins(env) { return String(env.FRONTEND_ORIGIN || "").split(",").map((x) => x.trim()).filter(Boolean); }
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "Content-Type, X-Klirline-Request, X-Klirline-Bootstrap, Idempotency-Key", "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS", "Vary": "Origin" };
}
function secureHeaders(headers = {}) {
  return { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store", ...headers };
}
function cookieValue(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}
function sessionCookie(token) { return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=43200`; }
function clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`; }
function oauthCookie(state) { return `${OAUTH_COOKIE}=${encodeURIComponent(state)}; Path=/oauth/; HttpOnly; Secure; SameSite=None; Max-Age=600`; }
function clearOAuthCookie() { return `${OAUTH_COOKIE}=; Path=/oauth/; HttpOnly; Secure; SameSite=None; Max-Age=0`; }

async function hmacKey(secret) {
  if (!secret || secret.length < 32) throw httpError("session-secret-not-configured", 503);
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function makeSession(user, env) {
  const head = b64u(new TextEncoder().encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64u(new TextEncoder().encode(JSON.stringify({ sub: user.id, role: user.role, org: user.org_id, ver: user.auth_version || 0, exp: Math.floor(Date.now() / 1000) + 43200 })));
  const input = `${head}.${body}`;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(env.SESSION_SECRET), new TextEncoder().encode(input));
  return `${input}.${b64u(signature)}`;
}
async function authenticate(request, env, db, roles = []) {
  const token = cookieValue(request, COOKIE) || (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw httpError("auth-required", 401);
  const [head, body, signature, ...extra] = token.split(".");
  if (!head || !body || !signature || extra.length) throw httpError("bad-token", 401);
  const key = await hmacKey(env.SESSION_SECRET);
  const valid = await crypto.subtle.verify("HMAC", key, unb64u(signature), new TextEncoder().encode(`${head}.${body}`));
  if (!valid) throw httpError("bad-token", 401);
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(unb64u(body))); } catch { throw httpError("bad-token", 401); }
  if (!payload.exp || payload.exp <= Date.now() / 1000) throw httpError("bad-token", 401);
  const user = await db.prepare("SELECT id,email,role,org_id,auth_version,is_active FROM users WHERE id=?").bind(payload.sub).first();
  if (!user) throw httpError("unknown-user", 401);
  if (user.is_active === 0) throw httpError("account-disabled", 401);
  if ((payload.ver || 0) !== (user.auth_version || 0)) throw httpError("bad-token", 401);
  if (roles.length && !roles.includes(user.role)) throw httpError("forbidden-role", 403);
  return user;
}
async function passwordHash(password, salt, iterations = 310000) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: unb64u(salt), iterations, hash: "SHA-256" }, key, 256);
  return b64u(bits);
}
async function loginLimitKeys(request, email, env) {
  const key = await hmacKey(env.SESSION_SECRET);
  const address = request.headers.get("CF-Connecting-IP") || "unknown-ip";
  const values = [`ip:${address}`, `email:${email}`];
  return Promise.all(values.map(async (value) => b64u(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)))));
}
async function checkLoginLimit(request, email, env, db) {
  const keys = await loginLimitKeys(request, email, env); const now = Date.now(); const windowStart = now - 15 * 60 * 1000;
  for (const key of keys) {
    const row = await db.prepare(`INSERT INTO auth_limits(bucket_key,window_started,failures) VALUES(?,?,1)
    ON CONFLICT(bucket_key) DO UPDATE SET
    failures=CASE WHEN auth_limits.window_started<=? THEN 1 ELSE auth_limits.failures+1 END,
    window_started=CASE WHEN auth_limits.window_started<=? THEN excluded.window_started ELSE auth_limits.window_started END
    RETURNING failures`).bind(key,now,windowStart,windowStart).first();
    if (row?.failures > 12) throw httpError("login-rate-limited", 429);
  }
  return keys;
}
async function clearLoginLimit(keys, db) {
  await db.batch(keys.map((key) => db.prepare("DELETE FROM auth_limits WHERE bucket_key=?").bind(key)));
}
function same(a, b) {
  const aa = new TextEncoder().encode(String(a)); const bb = new TextEncoder().encode(String(b));
  let diff = aa.length ^ bb.length;
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) diff |= (aa[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}
function encryptionKey(env) {
  const raw = String(env.TOKENS_ENCRYPTION_KEY_HEX || "");
  if (!/^[0-9a-f]{64}$/i.test(raw)) throw httpError("token-encryption-key-not-configured", 503);
  return crypto.subtle.importKey("raw", Uint8Array.from(raw.match(/.{2}/g), (x) => parseInt(x, 16)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
function requireInternalWorkspace(env) {
  if (env.INTERNAL_MODE !== "true") throw httpError("internal-workspace-disabled", 503);
}
function planLimit(env, key, fallback) {
  const value = Number(env[key]);
  return Number.isSafeInteger(value) && value > 0 && value <= 100000 ? value : fallback;
}
function usagePeriodKey() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}
async function reserveMonthlyPublication(db, user, env) {
  const period = usagePeriodKey(); const limit = planLimit(env, "PLAN_MONTHLY_POST_LIMIT", 5000);
  const row = await db.prepare(`INSERT INTO usage_counters(org_id,period_key,publication_count) VALUES(?,?,1)
    ON CONFLICT(org_id,period_key) DO UPDATE SET publication_count=publication_count+1
    WHERE publication_count<? RETURNING publication_count`).bind(user.org_id, period, limit).first();
  if (!row) throw httpError("monthly-publication-limit-reached", 429);
  return period;
}
async function releaseMonthlyPublication(db, orgId, period) {
  if (!period) return;
  await db.prepare("UPDATE usage_counters SET publication_count=publication_count-1 WHERE org_id=? AND period_key=? AND publication_count>0").bind(orgId, period).run();
  await db.prepare("DELETE FROM usage_counters WHERE org_id=? AND period_key=? AND publication_count=0").bind(orgId, period).run();
}
async function workspaceUsage(db, user, env) {
  const period = usagePeriodKey();
  const [usage, accounts] = await Promise.all([
    db.prepare("SELECT publication_count FROM usage_counters WHERE org_id=? AND period_key=?").bind(user.org_id, period).first(),
    db.prepare("SELECT COUNT(*) AS count FROM connections WHERE user_id IN (SELECT id FROM users WHERE org_id=?)").bind(user.org_id).first()
  ]);
  return { periodStart: period, publications: usage?.publication_count || 0, publicationLimit: planLimit(env, "PLAN_MONTHLY_POST_LIMIT", 5000), connectedAccounts: accounts?.count || 0, connectedAccountLimit: planLimit(env, "PLAN_MAX_ACCOUNTS", DEFAULT_MAX_ACCOUNTS) };
}
async function sealToken(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, await encryptionKey(env), new TextEncoder().encode(value));
  return { data: b64u(sealed), iv: b64u(iv) };
}
async function openToken(row, env) {
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64u(row.token_iv), tagLength: 128 }, await encryptionKey(env), unb64u(row.token_ciphertext));
  const value = new TextDecoder().decode(clear);
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && typeof parsed.accessToken === "string") return parsed;
  } catch {}
  // Rows written by earlier versions contain only the access token.
  return { accessToken: value, refreshToken: null };
}
async function readJson(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_JSON_BYTES) throw httpError("request-too-large", 413);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") || "")) throw httpError("json-content-type-required", 415);
  if (!request.body) throw httpError("invalid-json", 400);
  const reader = request.body.getReader(); const chunks = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JSON_BYTES) { await reader.cancel(); throw httpError("request-too-large", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("json-object-required");
    return value;
  }
  catch { throw httpError("invalid-json", 400); }
}
function userMetadata(row) { return { id: row.id, email: row.email, role: row.role, org: row.org_id }; }
async function requestFingerprint(userId, kind, data) {
  const canonical = JSON.stringify({ userId, kind, ...data });
  return b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)));
}
function requestedTargets(value) {
  if (!Array.isArray(value) || !value.length) throw httpError("no-targets");
  if (value.some((provider) => typeof provider !== "string" || !PROVIDERS[provider])) throw httpError("unsupported-target");
  return [...new Set(value)];
}
function providerStatus(id, env) {
  const keys = {
    instagram: ["META_APP_ID", "META_APP_SECRET", "INSTAGRAM_REDIRECT_URI"],
    facebook: ["META_APP_ID", "META_APP_SECRET", "FACEBOOK_REDIRECT_URI", "FACEBOOK_PAGE_ID"],
    linkedin: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LINKEDIN_REDIRECT_URI", "LINKEDIN_ORGANIZATION_URN", "LINKEDIN_VERSION"],
    threads: ["THREADS_APP_ID", "THREADS_APP_SECRET", "THREADS_REDIRECT_URI"],
    x: ["X_CLIENT_ID", "X_CLIENT_SECRET", "X_REDIRECT_URI"],
    pinterest: ["PINTEREST_APP_ID", "PINTEREST_APP_SECRET", "PINTEREST_REDIRECT_URI"]
  }[id];
  if (!keys) return { configured: "out-of-scope", available: false };
  return { configured: keys.every((key) => Boolean(env[key])) ? "ready" : "missing-credentials", available: true };
}
function providerList(env) {
  return Object.fromEntries(Object.entries(PROVIDERS).map(([id, item]) => [id, { ...item, configured: providerStatus(id, env).configured, available: LAUNCH_PROVIDERS.includes(id) }]));
}
function validateOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins(env).includes(origin) || request.headers.get("X-Klirline-Request") !== "1") throw httpError("origin-or-csrf-check-failed", 403);
}
async function graphJson(url, token, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw httpError(`provider-api-${response.status}:${String(data.error?.message || data.message || "request-failed").slice(0, 160)}`, response.status >= 500 || response.status === 429 ? 502 : 400);
  if (response.headers.get("x-restli-id") && !data.id) data.id = response.headers.get("x-restli-id");
  return data;
}
function providerEnv(provider, env) {
  return {
    instagram: { id: env.META_APP_ID, secret: env.META_APP_SECRET, redirect: env.INSTAGRAM_REDIRECT_URI, authorize: "https://www.instagram.com/oauth/authorize", token: "https://api.instagram.com/oauth/access_token", scopeSep: ",", scopes: PROVIDERS.instagram.scopes },
    facebook: { id: env.META_APP_ID, secret: env.META_APP_SECRET, redirect: env.FACEBOOK_REDIRECT_URI, authorize: "https://www.facebook.com/dialog/oauth", token: "https://graph.facebook.com/oauth/access_token", scopeSep: ",", scopes: PROVIDERS.facebook.scopes },
    linkedin: { id: env.LINKEDIN_CLIENT_ID, secret: env.LINKEDIN_CLIENT_SECRET, redirect: env.LINKEDIN_REDIRECT_URI, authorize: "https://www.linkedin.com/oauth/v2/authorization", token: "https://www.linkedin.com/oauth/v2/accessToken", scopeSep: " ", scopes: PROVIDERS.linkedin.scopes },
    threads: { id: env.THREADS_APP_ID, secret: env.THREADS_APP_SECRET, redirect: env.THREADS_REDIRECT_URI, authorize: "https://threads.net/oauth/authorize", token: "https://graph.threads.net/oauth/access_token", scopeSep: ",", scopes: PROVIDERS.threads.scopes },
    x: { id: env.X_CLIENT_ID, secret: env.X_CLIENT_SECRET, redirect: env.X_REDIRECT_URI, authorize: "https://x.com/i/oauth2/authorize", token: "https://api.x.com/2/oauth2/token", scopeSep: " ", scopes: PROVIDERS.x.scopes },
    pinterest: { id: env.PINTEREST_APP_ID, secret: env.PINTEREST_APP_SECRET, redirect: env.PINTEREST_REDIRECT_URI, authorize: "https://www.pinterest.com/oauth/", token: "https://api.pinterest.com/v5/oauth/token", scopeSep: ",", scopes: PROVIDERS.pinterest.scopes }
  }[provider];
}
async function oauthStart(provider, user, env, db) {
  if (!LAUNCH_PROVIDERS.includes(provider)) throw httpError("provider-out-of-scope-for-mvp", 501);
  const current = await db.prepare("SELECT id FROM connections WHERE provider=? AND user_id IN (SELECT id FROM users WHERE org_id=?) LIMIT 1").bind(provider, user.org_id).first();
  if (!current) {
    const count = await db.prepare("SELECT COUNT(*) AS count FROM connections WHERE user_id IN (SELECT id FROM users WHERE org_id=?)").bind(user.org_id).first();
    if (count?.count >= planLimit(env, "PLAN_MAX_ACCOUNTS", DEFAULT_MAX_ACCOUNTS)) throw httpError("connected-account-limit-reached", 429);
  }
  const cfg = providerEnv(provider, env);
  if (!cfg.id || !cfg.secret || !cfg.redirect || !env.FRONTEND_ORIGIN || !env.PUBLIC_BASE_URL) throw httpError("missing-credentials", 503);
  const state = randomId(32); const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
  let verifier = null; const params = new URLSearchParams({ client_id: cfg.id, redirect_uri: cfg.redirect, scope: cfg.scopes.join(cfg.scopeSep), state, response_type: "code" });
  if (provider === "x") {
    verifier = randomId(48);
    const challenge = b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    params.set("code_challenge", challenge); params.set("code_challenge_method", "S256");
  }
  if (provider === "linkedin") params.set("prompt", "consent");
  await db.prepare("INSERT INTO oauth_states (state_hash,user_id,provider,verifier,created_at,expires_at) VALUES (?,?,?,?,?,?)")
    .bind(b64u(hash), user.id, provider, verifier, nowIso(), new Date(Date.now() + 10 * 60000).toISOString()).run();
  return { location: `${cfg.authorize}?${params}`, state };
}
async function exchangeOAuth(provider, code, env, verifier = null) {
  const cfg = providerEnv(provider, env);
  if (provider === "threads") {
    const tokenUrl=new URL(cfg.token);
    for(const [key,value] of Object.entries({client_id:cfg.id,client_secret:cfg.secret,code,grant_type:"authorization_code",redirect_uri:cfg.redirect})) tokenUrl.searchParams.set(key,value);
    const response=await fetch(tokenUrl,{method:"POST"}); const shortToken=await response.json().catch(()=>({}));
    if(!response.ok||!shortToken.access_token) throw httpError("token-exchange-failed",502);
    const longUrl=new URL("https://graph.threads.net/access_token"); longUrl.searchParams.set("grant_type","th_exchange_token"); longUrl.searchParams.set("client_secret",cfg.secret); longUrl.searchParams.set("access_token",shortToken.access_token);
    const longResponse=await fetch(longUrl); const longToken=await longResponse.json().catch(()=>({}));
    if(!longResponse.ok||!longToken.access_token||!longToken.expires_in) throw httpError("long-lived-token-exchange-failed",502);
    return {...shortToken,...longToken};
  }
  if (provider === "instagram") {
    const body = new FormData(); body.set("client_id", cfg.id); body.set("client_secret", cfg.secret); body.set("grant_type", "authorization_code"); body.set("redirect_uri", cfg.redirect); body.set("code", code);
    const response = await fetch(cfg.token, { method: "POST", body }); const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw httpError("token-exchange-failed", 502);
    const longLivedUrl = new URL("https://graph.instagram.com/access_token");
    longLivedUrl.searchParams.set("grant_type", "ig_exchange_token");
    longLivedUrl.searchParams.set("client_secret", cfg.secret);
    longLivedUrl.searchParams.set("access_token", data.access_token);
    const longLivedResponse = await fetch(longLivedUrl);
    const longLived = await longLivedResponse.json().catch(() => ({}));
    if (!longLivedResponse.ok || !longLived.access_token || !longLived.expires_in) throw httpError("long-lived-token-exchange-failed", 502);
    return { ...data, ...longLived };
  }
  if (provider === "x") {
    const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: cfg.redirect, client_id: cfg.id, code_verifier: verifier || "" });
    const headers = { "content-type": "application/x-www-form-urlencoded" };
    if (cfg.secret) headers.Authorization = `Basic ${btoa(`${cfg.id}:${cfg.secret}`)}`;
    const response = await fetch(cfg.token, { method: "POST", headers, body }); const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw httpError("token-exchange-failed", 502); return data;
  }
  if (provider === "pinterest") {
    const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: cfg.redirect });
    const response = await fetch(cfg.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${cfg.id}:${cfg.secret}`)}` }, body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw httpError("token-exchange-failed", 502); return data;
  }
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: cfg.redirect, client_id: cfg.id, client_secret: cfg.secret });
  const response = await fetch(cfg.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }); const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw httpError("token-exchange-failed", 502); return data;
}
async function completeOAuth(request, env, db) {
  const url = new URL(request.url);
  const provider = url.pathname.split("/").at(-2); const state = url.searchParams.get("state"); const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) throw httpError("oauth-consent-denied", 400);
  if (!state || !same(state, cookieValue(request, OAUTH_COOKIE)) || !code || !LAUNCH_PROVIDERS.includes(provider)) throw httpError("bad-oauth-callback", 400);
  const stateHash = b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state)));
  const record = await db.prepare("SELECT * FROM oauth_states WHERE state_hash=? AND provider=? AND expires_at>? ").bind(stateHash, provider, nowIso()).first();
  if (!record) throw httpError("oauth-state-invalid-or-expired", 400);
  await db.prepare("DELETE FROM oauth_states WHERE state_hash=?").bind(stateHash).run();
  const token = await exchangeOAuth(provider, code, env, record.verifier);
  let account; let connectionToken = token.access_token;
  if (provider === "instagram") {
    account = await graphJson(`https://graph.instagram.com/${env.META_GRAPH_VERSION || "v26.0"}/me?fields=user_id,username`, token.access_token);
    account = { id: String(account.user_id || account.id || ""), label: account.username ? `@${account.username}` : "" };
  } else if (provider === "facebook") {
    if (!env.FACEBOOK_PAGE_ID) throw httpError("facebook-page-id-required", 409);
    const graph = `https://graph.facebook.com/${env.META_GRAPH_VERSION || "v26.0"}`;
    const me = await graphJson(`${graph}/me?fields=id,name`, token.access_token);
    const pages = await graphJson(`${graph}/me/accounts?fields=id,name,access_token,tasks`, token.access_token);
    const page = (pages.data || []).find((item) => String(item.id) === String(env.FACEBOOK_PAGE_ID));
    if (!page?.access_token || !(page.tasks || []).some((task) => ["CREATE_CONTENT", "MANAGE"].includes(task))) throw httpError("facebook-page-not-accessible-for-publishing", 403);
    account = { id: page.id, label: page.name, ownerId: me.id }; connectionToken = page.access_token;
  } else if (provider === "threads") {
    const profile=await graphJson(`https://graph.threads.net/${env.THREADS_API_VERSION||"v1.0"}/me?fields=id,username`,token.access_token);
    account={id:String(profile.id||""),label:profile.username?`@${profile.username}`:""};
  } else if (provider === "x") {
    const profile = await graphJson("https://api.x.com/2/users/me?user.fields=id,name,username", token.access_token);
    account = { id: String(profile.data?.id || ""), label: profile.data?.username ? `@${profile.data.username}` : String(profile.data?.name || "") };
  } else if (provider === "pinterest") {
    const profile = await graphJson("https://api.pinterest.com/v5/user_account", token.access_token);
    const username = String(profile.username || profile.id || "");
    account = { id: username, label: profile.username ? `@${profile.username}` : String(profile.business_name || "Pinterest") , username: profile.username || null };
  } else {
    const identity = await graphJson("https://api.linkedin.com/v2/userinfo", token.access_token);
    if (!env.LINKEDIN_ORGANIZATION_URN || !/^urn:li:organization:\d+$/.test(env.LINKEDIN_ORGANIZATION_URN)) throw httpError("linkedin-organization-urn-required", 503);
    if (!identity.sub) throw httpError("linkedin-member-identity-missing", 502);
    const version = env.LINKEDIN_VERSION || "202610";
    const query = new URLSearchParams({ q: "roleAssignee", state: "APPROVED", count: "100" });
    const access = await graphJson(`https://api.linkedin.com/rest/organizationAcls?${query}`, token.access_token, { headers: { "X-Restli-Protocol-Version": "2.0.0", "Linkedin-Version": version } });
    const publishingRoles = new Set(["ADMINISTRATOR", "DIRECT_SPONSORED_CONTENT_POSTER", "CONTENT_ADMIN", "CONTENT_ADMINISTRATOR"]);
    const canPublish = (access.elements || []).some((entry) => entry.state === "APPROVED" && publishingRoles.has(entry.role) && entry.organization === env.LINKEDIN_ORGANIZATION_URN);
    if (!canPublish) throw httpError("linkedin-member-lacks-organization-publishing-role", 403);
    account = { id: env.LINKEDIN_ORGANIZATION_URN, label: env.LINKEDIN_ORGANIZATION_NAME || "LinkedIn organization", memberId: identity.sub };
  }
  if (!account?.id || !account?.label) throw httpError("account-identity-missing", 502);
  const sealed = await sealToken(JSON.stringify({ accessToken: connectionToken, refreshToken: ["linkedin", "x", "pinterest"].includes(provider) ? token.refresh_token || null : null, refreshExpiresAt: token.refresh_token_expires_in ? new Date(Date.now() + token.refresh_token_expires_in * 1000).toISOString() : null }), env); const id = randomId();
  await db.prepare(`INSERT INTO connections(id,user_id,provider,account_id,account_label,account_json,scopes_json,token_ciphertext,token_iv,expires_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET id=excluded.id,account_id=excluded.account_id,account_label=excluded.account_label,account_json=excluded.account_json,scopes_json=excluded.scopes_json,token_ciphertext=excluded.token_ciphertext,token_iv=excluded.token_iv,expires_at=excluded.expires_at,created_at=excluded.created_at`)
    .bind(id, record.user_id, provider, String(account.id), account.label, JSON.stringify(account), JSON.stringify(PROVIDERS[provider].scopes), sealed.data, sealed.iv, token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null, nowIso()).run();
  const owner = await db.prepare("SELECT org_id FROM users WHERE id=?").bind(record.user_id).first();
  if (owner) await auditEvent(db,owner.org_id,record.user_id,"social.connected",provider,{accountLabel:account.label});
  return provider;
}
async function getConnection(db, userId, provider) {
  const row = await db.prepare("SELECT c.* FROM connections c JOIN users owner ON owner.id=c.user_id JOIN users requester ON requester.org_id=owner.org_id WHERE requester.id=? AND c.provider=? ORDER BY c.created_at DESC LIMIT 1").bind(userId, provider).first();
  if (row) row.account = JSON.parse(row.account_json || "{}");
  return row;
}
async function currentAccessToken(provider, connection, env) {
  const bundle = await openToken(connection, env);
  const expiresAt = connection.expires_at ? Date.parse(connection.expires_at) : NaN;
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now() + 5 * 60 * 1000) return bundle.accessToken;
  let response;
  if (provider === "instagram") {
    const url = new URL("https://graph.instagram.com/refresh_access_token");
    url.searchParams.set("grant_type", "ig_refresh_token");
    url.searchParams.set("access_token", bundle.accessToken);
    response = await fetch(url);
  } else if (provider === "threads") {
    const url=new URL("https://graph.threads.net/refresh_access_token"); url.searchParams.set("grant_type","th_refresh_token"); url.searchParams.set("access_token",bundle.accessToken); response=await fetch(url);
  } else if (provider === "x" && bundle.refreshToken) {
    const cfg = providerEnv("x", env);
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: bundle.refreshToken, client_id: cfg.id });
    const headers = { "content-type": "application/x-www-form-urlencoded" };
    if (cfg.secret) headers.Authorization = `Basic ${btoa(`${cfg.id}:${cfg.secret}`)}`;
    response = await fetch(cfg.token, { method: "POST", headers, body });
  } else if (provider === "pinterest" && bundle.refreshToken && (!bundle.refreshExpiresAt || Date.parse(bundle.refreshExpiresAt) > Date.now())) {
    const cfg = providerEnv("pinterest", env);
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: bundle.refreshToken });
    response = await fetch(cfg.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${cfg.id}:${cfg.secret}`)}` }, body });
  } else if (provider === "linkedin" && bundle.refreshToken && (!bundle.refreshExpiresAt || Date.parse(bundle.refreshExpiresAt) > Date.now())) {
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: bundle.refreshToken, client_id: env.LINKEDIN_CLIENT_ID, client_secret: env.LINKEDIN_CLIENT_SECRET });
    response = await fetch("https://www.linkedin.com/oauth/v2/accessToken", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  } else {
    throw httpError("reconnect-required-token-expired", 401);
  }
  const refreshed = await response.json().catch(() => ({}));
  if (!response.ok || !refreshed.access_token || !refreshed.expires_in) throw httpError("reconnect-required-token-refresh-failed", 401);
  const next = {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token || bundle.refreshToken || null,
    refreshExpiresAt: refreshed.refresh_token_expires_in ? new Date(Date.now() + refreshed.refresh_token_expires_in * 1000).toISOString() : bundle.refreshExpiresAt || null
  };
  const sealed = await sealToken(JSON.stringify(next), env);
  await env.DB.prepare("UPDATE connections SET token_ciphertext=?,token_iv=?,expires_at=? WHERE id=?")
    .bind(sealed.data, sealed.iv, new Date(Date.now() + refreshed.expires_in * 1000).toISOString(), connection.id).run();
  return next.accessToken;
}
async function getMedia(db, id, userId) {
  return db.prepare("SELECT m.* FROM media m JOIN users owner ON owner.id=m.user_id JOIN users requester ON requester.org_id=owner.org_id WHERE m.id=? AND requester.id=? AND m.expires_at>? ").bind(id, userId, nowIso()).first();
}
async function publishOne(provider, connection, text, media, env) {
  if (!LAUNCH_PROVIDERS.includes(provider)) return { provider, status: "action-required", message: "provider-out-of-scope-for-mvp" };
  let access;
  try { access = await currentAccessToken(provider, connection, env); } catch (error) {
    if (String(error?.message || "").startsWith("reconnect-required")) return { provider, status: "action-required", message: "reconnect-required-token-expired" };
    return { provider, status: "failed", message: "token-unreadable" };
  }
  try {
    const apiVersion = env.META_GRAPH_VERSION || "v26.0";
    if (provider === "facebook") {
      const pageId = connection.account_id;
      if (media) {
        if (!media.publicUrl || !media.mime.startsWith("image/")) return { provider, status: "action-required", message: "facebook-image-needs-public-image-url" };
        const response = await graphJson(`https://graph.facebook.com/${apiVersion}/${encodeURIComponent(pageId)}/photos`, access, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ url: media.publicUrl, caption: text, published: "true" }) });
        return { provider, status: "published", postId: response.post_id || response.id || null, message: "ok" };
      }
      const response = await graphJson(`https://graph.facebook.com/${apiVersion}/${encodeURIComponent(pageId)}/feed`, access, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ message: text }) });
      return { provider, status: "published", postId: response.id || null, message: "ok" };
    }
    if (provider === "instagram") {
      if (!media || media.mime !== "image/jpeg") return { provider, status: "action-required", message: "instagram-requires-jpeg-image" };
      const base = `https://graph.instagram.com/${apiVersion}/${encodeURIComponent(connection.account_id)}`;
      const created = await graphJson(`${base}/media`, access, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ image_url: media.publicUrl, caption: text }) });
      if (!created.id) throw httpError("instagram-container-id-missing", 502);
      const posted = await graphJson(`${base}/media_publish`, access, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ creation_id: created.id }) });
      return { provider, status: "published", postId: posted.id || null, message: "ok" };
    }
    if (provider === "linkedin") {
      const headers = { Authorization: `Bearer ${access}`, "Content-Type": "application/json", "X-Restli-Protocol-Version": "2.0.0", "Linkedin-Version": env.LINKEDIN_VERSION };
      let mediaContent;
      if (media) {
        if (!media.r2Object || !["image/jpeg", "image/png"].includes(media.mime)) return { provider, status: "action-required", message: "linkedin-image-requires-jpeg-or-png" };
        const init = await graphJson("https://api.linkedin.com/rest/images?action=initializeUpload", null, { method: "POST", headers, body: JSON.stringify({ initializeUploadRequest: { owner: connection.account_id } }) });
        const uploadUrl = init.value?.uploadUrl; const image = init.value?.image;
        if (!uploadUrl || !image) throw httpError("linkedin-image-upload-details-missing", 502);
        const uploaded = await fetch(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${access}`, "Content-Type": media.mime }, body: media.r2Object });
        if (!uploaded.ok) throw httpError(`linkedin-image-upload-failed-${uploaded.status}`, uploaded.status >= 500 ? 502 : 400);
        let ready = false;
        for (let i = 0; i < 15; i++) {
          const status = await graphJson(`https://api.linkedin.com/rest/images/${encodeURIComponent(image)}`, null, { headers });
          if (status.status === "AVAILABLE") { ready = true; break; }
          if (status.status === "PROCESSING_FAILED") throw httpError("linkedin-image-processing-failed", 502);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (!ready) throw httpError("linkedin-image-processing-timeout", 502);
        mediaContent = { media: { title: "Klirline", id: image } };
      }
      const post = { author: connection.account_id, commentary: text, visibility: "PUBLIC", distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] }, ...(mediaContent ? { content: { ...mediaContent, mediaCategory: "IMAGE" } } : {}) };
      const result = await graphJson("https://api.linkedin.com/rest/posts", null, { method: "POST", headers, body: JSON.stringify(post) });
      return { provider, status: "published", postId: result.id || null, message: "ok" };
    }
    if (provider === "threads") {
      if(media && (!media.publicUrl || !["image/jpeg","image/png"].includes(media.mime))) return {provider,status:"action-required",message:"threads-image-requires-public-jpeg-or-png"};
      const base=`https://graph.threads.net/${env.THREADS_API_VERSION||"v1.0"}/${encodeURIComponent(connection.account_id)}`;
      const fields=media?{media_type:"IMAGE",image_url:media.publicUrl,text}:{media_type:"TEXT",text,auto_publish_text:"true"};
      const container=await graphJson(`${base}/threads`,access,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams(fields)});
      if(!container.id) throw httpError("threads-container-id-missing",502);
      if(!media) return {provider,status:"published",postId:container.id,message:"ok"};
      const published=await graphJson(`${base}/threads_publish`,access,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({creation_id:container.id})});
      return {provider,status:"published",postId:published.id||null,message:"ok"};
    }
    if (provider === "x") {
      let mediaId;
      if (media) {
        if (!media.bytes || media.bytes.byteLength > 5 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(media.mime)) return { provider, status: "action-required", message: "x-image-requires-jpeg-or-png-under-5mb" };
        const bytes = media.bytes; let binary = ""; for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        const uploaded = await graphJson("https://api.x.com/2/media/upload", access, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ media: btoa(binary), media_category: "tweet_image" }) });
        mediaId = uploaded.data?.id || uploaded.data?.media_id || uploaded.media_id_string || uploaded.media_id;
        if (!mediaId) throw httpError("x-media-id-missing", 502);
      }
      const post = await graphJson("https://api.x.com/2/tweets", access, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, ...(mediaId ? { media: { media_ids: [String(mediaId)] } } : {}) }) });
      return { provider, status: "published", postId: post.data?.id || null, message: "ok" };
    }
    if (provider === "pinterest") {
      if (!connection.account?.boardId) return { provider, status: "action-required", message: "pinterest-board-selection-required" };
      if (!media?.publicUrl || !["image/jpeg", "image/png"].includes(media.mime)) return { provider, status: "action-required", message: "pinterest-requires-jpeg-or-png-image" };
      const pin = await graphJson("https://api.pinterest.com/v5/pins", access, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ board_id: connection.account.boardId, description: text, media_source: { source_type: "image_url", url: media.publicUrl, is_standard: true } }) });
      return { provider, status: "published", postId: pin.id || null, message: "ok" };
    }
  } catch (error) {
    return { provider, status: "failed", message: String(error.message || error).slice(0, 240), retryable: !error.status || error.status === 502 };
  }
  return { provider, status: "action-required", message: "provider-not-implemented" };
}
function sniffImage(bytes) {
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((v, i) => bytes[i] === v)) return "image/png";
  return null;
}
async function loadMedia(row, env) {
  const object = await env.MEDIA.get(row.object_key);
  if (!object) return null;
  const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
  return { ...row, publicUrl: `${env.PUBLIC_BASE_URL}/media/${encodeURIComponent(row.id)}`, bytes, r2Object: bytes };
}
async function accountPublish(request, user, env, db) {
  const body = await readJson(request); const text = String(body.text || "").trim();
  const targets = requestedTargets(body.targets);
  if (!text) throw httpError("empty-text"); if (!targets.length) throw httpError("no-targets");
  for (const provider of targets) {
    if (text.length > PROVIDERS[provider].limit) throw httpError(`too-long:${provider}`);
    if (["instagram", "pinterest"].includes(provider) && !body.mediaId) throw httpError(`media-required:${provider}`);
    if (provider === "x" && body.mediaId) {
      // The X API currently accepts images up to 5 MB; reject unsupported files before making provider calls.
      const media = body.mediaId ? await getMedia(db, body.mediaId, user.id) : null;
      if (!media || media.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(media.mime)) throw httpError("x-image-requires-jpeg-or-png-under-5mb");
    }
  }
  const idem = String(request.headers.get("Idempotency-Key") || "").slice(0, 128) || null;
  const draftId = String(body.draftId || "").trim() || null;
  const fingerprint = idem ? await requestFingerprint(user.id, "publish", { text, targets: [...targets].sort(), mediaId: body.mediaId || null, draftId }) : null;
  if (idem) {
    const prior = await db.prepare("SELECT id,results_json,request_fingerprint FROM posts WHERE user_id=? AND idempotency_key=?").bind(user.id, idem).first();
    if (prior) {
      if (prior.request_fingerprint && prior.request_fingerprint !== fingerprint) throw httpError("idempotency-key-reused-with-different-request", 409);
      let priorResults = JSON.parse(prior.results_json || "[]");
      if (!priorResults.length) {
        priorResults = targets.map((provider) => ({ provider, status: "action-required", message: "prior-attempt-status-unknown-check-network-before-retry" }));
        await db.prepare("UPDATE posts SET results_json=? WHERE id=? AND results_json='[]'").bind(JSON.stringify(priorResults), prior.id).run();
      }
      return { results: priorResults, postId: prior.id, deduped: true };
    }
  }
  const approvedDraft = await requireApprovedDraft(db,user,env,draftId,text,targets,body.mediaId || null);
  let media = null;
  if (body.mediaId) {
    media = await getMedia(db, body.mediaId, user.id);
    if (!media) throw httpError("media-not-found", 404);
    media = await loadMedia(media, env);
    if (!media) throw httpError("media-file-missing", 404);
  }
  if (approvedDraft) await claimApprovedDraft(db,user,approvedDraft.id,"publishing");
  let usagePeriod;
  try { usagePeriod=await reserveMonthlyPublication(db,user,env); }
  catch(error) { if(approvedDraft)await releaseApprovedDraft(db,user.org_id,approvedDraft.id,"publishing"); throw error; }
  const id = randomId();
  if (idem) {
    try { await db.prepare("INSERT INTO posts(id,user_id,idempotency_key,text,media_id,results_json,created_at,request_fingerprint,usage_period,campaign_draft_id) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(id,user.id,idem,text,body.mediaId || null,"[]",nowIso(),fingerprint,usagePeriod,approvedDraft?.id||null).run(); }
    catch { await releaseMonthlyPublication(db,user.org_id,usagePeriod); if(approvedDraft)await releaseApprovedDraft(db,user.org_id,approvedDraft.id,"publishing"); const prior = await db.prepare("SELECT id,results_json,request_fingerprint FROM posts WHERE user_id=? AND idempotency_key=?").bind(user.id, idem).first(); if (prior) { if (prior.request_fingerprint && prior.request_fingerprint !== fingerprint) throw httpError("idempotency-key-reused-with-different-request", 409); const priorResults=JSON.parse(prior.results_json||"[]"); return {results:priorResults.length?priorResults:targets.map((provider)=>({provider,status:"action-required",message:"prior-attempt-status-unknown-check-network-before-retry"})),postId:prior.id,deduped:true}; } throw httpError("publish-idempotency-conflict", 409); }
  }
  const results = await Promise.all(targets.map(async (provider) => {
    const connection = await getConnection(db, user.id, provider);
    return connection ? publishOne(provider, connection, text, media, env) : { provider, status: "action-required", message: "not-connected" };
  }));
  if (idem) await db.prepare("UPDATE posts SET results_json=? WHERE id=?").bind(JSON.stringify(results), id).run();
  else {
    try { await db.prepare("INSERT INTO posts(id,user_id,text,media_id,results_json,created_at,usage_period,campaign_draft_id) VALUES(?,?,?,?,?,?,?,?)").bind(id,user.id,text,body.mediaId || null,JSON.stringify(results),nowIso(),usagePeriod,approvedDraft?.id||null).run(); }
    catch (error) { await releaseMonthlyPublication(db,user.org_id,usagePeriod); if(approvedDraft)await releaseApprovedDraft(db,user.org_id,approvedDraft.id,"publishing"); throw error; }
  }
  if (approvedDraft) await finishApprovedDraft(db,user.org_id,approvedDraft.id,results.every((result)=>result.status==="published")?"published":"needs_action");
  return { results, postId: id };
}
async function createSchedule(request, user, env, db) {
  const body = await readJson(request); const text = String(body.text || "").trim(); const targets = requestedTargets(body.targets);
  const runAt = new Date(body.runAtUTC);
  if (!text || !targets.length || !body.runAtUTC || !Number.isFinite(runAt.getTime()) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(body.runAtUTC) || runAt.getTime() < Date.now() + 60000) throw httpError("text-targets-future-runAtUTC-required");
  const timezone = String(body.timezone || "UTC").trim();
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(runAt); } catch { throw httpError("invalid-time-zone"); }
  for (const provider of targets) { if (text.length > PROVIDERS[provider].limit) throw httpError(`too-long:${provider}`); if (["instagram", "pinterest"].includes(provider) && !body.mediaId) throw httpError(`media-required:${provider}`); }
  if (body.mediaId) {
    const media = await getMedia(db, body.mediaId, user.id);
    if (!media) throw httpError("media-not-found", 404);
    // Keep the media available through the scheduled send and the worker's retry window.
    if (runAt.getTime() >= new Date(media.expires_at).getTime() - 3 * 60 * 60 * 1000) throw httpError("scheduled-media-expires-too-soon");
  }
  const idem = String(request.headers.get("Idempotency-Key") || "").slice(0, 128) || null;
  const draftId = String(body.draftId || "").trim() || null;
  const fingerprint = idem ? await requestFingerprint(user.id, "schedule", { text, targets: [...targets].sort(), mediaId: body.mediaId || null, runAtUTC: runAt.toISOString(), timezone, draftId }) : null;
  if (idem) { const prior = await db.prepare("SELECT * FROM scheduled_posts WHERE user_id=? AND idempotency_key=?").bind(user.id, idem).first(); if (prior) { if (prior.request_fingerprint && prior.request_fingerprint !== fingerprint) throw httpError("idempotency-key-reused-with-different-request", 409); return { job: await scheduleView(db, prior), deduped: true }; } }
  const approvedDraft = await requireApprovedDraft(db,user,env,draftId,text,targets,body.mediaId || null);
  if (approvedDraft) await claimApprovedDraft(db,user,approvedDraft.id,"scheduled");
  let usagePeriod;
  try {
    usagePeriod=await reserveMonthlyPublication(db,user,env);
    const id = randomId(); const created = nowIso();
    const statements = [db.prepare("INSERT INTO scheduled_posts(id,user_id,idempotency_key,text,media_id,targets_json,status,run_at,created_at,request_fingerprint,usage_period,timezone,campaign_draft_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,user.id,idem,text,body.mediaId || null,JSON.stringify(targets),"queued",runAt.toISOString(),created,fingerprint,usagePeriod,timezone,approvedDraft?.id||null)];
    for (const provider of targets) statements.push(db.prepare("INSERT INTO scheduled_results(job_id,provider,status,attempts,next_run_at) VALUES(?,?,?,?,?)").bind(id,provider,"queued",0,runAt.toISOString()));
    await db.batch(statements);
    return { job: { id, runAtUTC: runAt.toISOString(), timezone, status: "queued", targets }, deduped: false };
  } catch (error) {
    if (usagePeriod) await releaseMonthlyPublication(db,user.org_id,usagePeriod);
    if (approvedDraft) await releaseApprovedDraft(db,user.org_id,approvedDraft.id,"scheduled");
    if (idem) { const prior = await db.prepare("SELECT * FROM scheduled_posts WHERE user_id=? AND idempotency_key=?").bind(user.id, idem).first(); if (prior) { if (prior.request_fingerprint && prior.request_fingerprint !== fingerprint) throw httpError("idempotency-key-reused-with-different-request", 409); return { job: await scheduleView(db, prior), deduped: true }; } }
    throw error;
  }
}

async function requireApprovedDraft(db,user,env,draftId,text,targets,mediaId) {
  if (env.REQUIRE_APPROVED_DRAFTS !== "true") return null;
  if (!draftId) throw httpError("approved-campaign-draft-required",409);
  const draft=await db.prepare("SELECT id,text,targets_json,media_id,review_status,publication_state FROM campaign_drafts WHERE id=? AND org_id=?").bind(draftId,user.org_id).first();
  if (!draft) throw httpError("approved-campaign-draft-not-found",404);
  if (draft.review_status !== "approved" || draft.publication_state !== "not_published") throw httpError("approved-campaign-draft-not-ready",409);
  const approvedTargets=JSON.parse(draft.targets_json||"[]").sort();
  if (draft.text !== text || JSON.stringify(approvedTargets) !== JSON.stringify([...targets].sort()) || (draft.media_id||null) !== (mediaId||null)) throw httpError("approved-campaign-content-mismatch",409);
  return draft;
}
async function claimApprovedDraft(db,user,draftId,state) {
  const result=await db.prepare("UPDATE campaign_drafts SET publication_state=? WHERE id=? AND org_id=? AND review_status='approved' AND publication_state='not_published'").bind(state,draftId,user.org_id).run();
  if (!result.meta?.changes) throw httpError("approved-campaign-draft-already-claimed",409);
}
async function releaseApprovedDraft(db,orgId,draftId,state) {
  await db.prepare("UPDATE campaign_drafts SET publication_state='not_published' WHERE id=? AND org_id=? AND publication_state=?").bind(draftId,orgId,state).run();
}
async function finishApprovedDraft(db,orgId,draftId,state) {
  await db.prepare("UPDATE campaign_drafts SET publication_state=?,review_status=CASE WHEN ?='needs_action' THEN 'draft' ELSE review_status END WHERE id=? AND org_id=? AND publication_state='publishing'").bind(state,state,draftId,orgId).run();
}
async function scheduleView(db, row) {
  const result = await db.prepare("SELECT provider,status,attempts,result_json FROM scheduled_results WHERE job_id=? ORDER BY provider").bind(row.id).all();
  return { id: row.id, authorId: row.user_id, text: row.text, mediaId: row.media_id, campaignDraftId:row.campaign_draft_id||null, targets: JSON.parse(row.targets_json), status: row.status, runAtUTC: row.run_at, timezone: row.timezone || "UTC", createdAt: row.created_at, results: (result.results || []).filter((r) => r.result_json).map((r) => JSON.parse(r.result_json)) };
}
async function processDue(env, db) {
  const now = nowIso();
  await db.prepare("UPDATE scheduled_posts SET status='queued',lease_until=NULL WHERE status='processing' AND lease_until<?").bind(now).run();
  const claimed = await db.prepare(`UPDATE scheduled_posts SET status='processing',lease_until=? WHERE id IN (SELECT id FROM scheduled_posts WHERE status='queued' AND run_at<=? ORDER BY run_at LIMIT 10) AND status='queued' RETURNING *`).bind(new Date(Date.now() + 10 * 60000).toISOString(), now).all();
  for (const job of claimed.results || []) {
    const targets = JSON.parse(job.targets_json);
    await Promise.all(targets.map(async (provider) => {
      const target = await db.prepare("SELECT * FROM scheduled_results WHERE job_id=? AND provider=?").bind(job.id, provider).first();
      if (!target || target.status === "published" || target.status === "action-required" || target.status === "failed" || target.next_run_at > nowIso()) return;
      const connection = await getConnection(db, job.user_id, provider);
      let result;
      if (!connection) result = { provider, status: "action-required", message: "not-connected" };
      else {
        const row = job.media_id ? await getMedia(db, job.media_id, job.user_id) : null;
        const media = row ? await loadMedia(row, env) : null;
        if (job.media_id && !media) result = { provider, status: "action-required", message: "scheduled-media-missing" };
        else result = await publishOne(provider, connection, job.text, media, env);
      }
      const attempts = target.attempts + 1;
      const retry = result.status === "failed" && result.retryable && attempts < 5;
      const next = retry ? new Date(Date.now() + [120000,600000,1800000,7200000][Math.min(attempts - 1, 3)]).toISOString() : nowIso();
      await db.prepare("UPDATE scheduled_results SET status=?,attempts=?,next_run_at=?,result_json=? WHERE job_id=? AND provider=?").bind(retry ? "queued" : result.status, attempts, next, JSON.stringify(result), job.id, provider).run();
    }));
    const summary = await db.prepare("SELECT status,COUNT(*) AS count,MIN(CASE WHEN status='queued' THEN next_run_at END) AS next_run FROM scheduled_results WHERE job_id=? GROUP BY status").bind(job.id).all();
    const states = summary.results || [];
    const queued = states.some((s) => s.status === "queued");
    const status = queued ? "queued" : states.some((s) => s.status === "failed") ? "failed" : states.some((s) => s.status === "action-required") ? "action-required" : "published";
    const nextAt = states.find((s) => s.status === "queued")?.next_run;
    await db.prepare("UPDATE scheduled_posts SET status=?,run_at=COALESCE(?,run_at),lease_until=NULL WHERE id=? AND status='processing'").bind(status, nextAt ?? null, job.id).run();
    if (job.campaign_draft_id && !queued) await db.prepare("UPDATE campaign_drafts SET publication_state=?,review_status=CASE WHEN ?='needs_action' THEN 'draft' ELSE review_status END WHERE id=? AND publication_state='scheduled'").bind(status==="published"?"published":"needs_action",status==="published"?"published":"needs_action",job.campaign_draft_id).run();
    const owner = await db.prepare("SELECT org_id FROM users WHERE id=?").bind(job.user_id).first();
    if (owner) {
      const results = await db.prepare("SELECT provider,status FROM scheduled_results WHERE job_id=? ORDER BY provider").bind(job.id).all();
      await auditEvent(db,owner.org_id,job.user_id,"publication.schedule.processed",job.id,{status,results:results.results||[]});
    }
  }
  const expired = await db.prepare("SELECT id,object_key FROM media WHERE expires_at<=?").bind(now).all();
  await db.prepare("UPDATE scheduled_posts SET status='action-required',lease_until=NULL WHERE status='queued' AND media_id IN (SELECT id FROM media WHERE expires_at<=?)").bind(now).run();
  await db.prepare("UPDATE campaign_drafts SET publication_state='needs_action',review_status='draft' WHERE publication_state='scheduled' AND id IN (SELECT campaign_draft_id FROM scheduled_posts WHERE status='action-required' AND media_id IN (SELECT id FROM media WHERE expires_at<=?))").bind(now).run();
  await db.prepare(`UPDATE scheduled_results SET status='action-required',result_json='{"status":"action-required","message":"scheduled-media-expired"}'
    WHERE status='queued' AND job_id IN (SELECT id FROM scheduled_posts WHERE status='action-required' AND media_id IN (SELECT id FROM media WHERE expires_at<=?))`).bind(now).run();
  for (const item of expired.results || []) await env.MEDIA.delete(item.object_key);
  await db.prepare("DELETE FROM media WHERE expires_at<=?").bind(now).run();
  await db.prepare("DELETE FROM oauth_states WHERE expires_at<=?").bind(now).run();
  await db.prepare("DELETE FROM auth_limits WHERE window_started<?").bind(Date.now() - 15 * 60 * 1000).run();
  await db.prepare("DELETE FROM usage_counters WHERE period_key<?").bind(new Date(Date.now() - 400 * 86400000).toISOString()).run();
}

function campaignDraftView(row) {
  return { id:row.id, authorId:row.author_user_id, updatedById:row.updated_by_user_id, title:row.title, text:row.text, mediaId:row.media_id,
    targets:JSON.parse(row.targets_json), countryCode:row.country_code, languageTag:row.language_tag, timezone:row.timezone,
    reviewStatus:row.review_status, reviewNote:row.review_note, publicationState:row.publication_state||"not_published", createdAt:row.created_at, updatedAt:row.updated_at };
}
function campaignDraftInput(body) {
  const title=String(body.title||"").trim(); const text=String(body.text||"").trim();
  if (!text || text.length>2200) throw httpError("invalid-draft-text");
  if (title.length>160) throw httpError("invalid-draft-title");
  const targets=body.targets===undefined?[]:body.targets;
  if (!Array.isArray(targets) || targets.length>9 || targets.some((provider)=>typeof provider!=="string"||!PROVIDERS[provider])) throw httpError("unsupported-target");
  const countryCode=String(body.countryCode||"").trim().toUpperCase();
  if (countryCode) {
    const displayName=/^[A-Z]{2}$/.test(countryCode)&&!NON_ISO_REGION_CODES.has(countryCode)
      ? new Intl.DisplayNames(["en"],{type:"region",fallback:"none"}).of(countryCode)
      : undefined;
    if (!displayName || displayName===countryCode || displayName==="Unknown Region") throw httpError("invalid-country-code");
  }
  const languageTag=String(body.languageTag||"").trim();
  let canonicalLanguageTag=languageTag;
  if (languageTag) { try { canonicalLanguageTag=Intl.getCanonicalLocales(languageTag)[0]; if (!canonicalLanguageTag) throw new Error(); } catch { throw httpError("invalid-language-tag"); } }
  const timezone=String(body.timezone||"").trim();
  if (timezone) { try { new Intl.DateTimeFormat("en",{timeZone:timezone}); } catch { throw httpError("invalid-time-zone"); } }
  const mediaId=body.mediaId?String(body.mediaId):null;
  if(mediaId && mediaId.length>128) throw httpError("invalid-media-id");
  return {title:title||text.slice(0,80),text,targets:[...new Set(targets)],countryCode,languageTag:canonicalLanguageTag,timezone,mediaId};
}

async function handle(request, env, ctx) {
  const url = new URL(request.url); const cors = corsHeaders(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: secureHeaders(cors) });
  if (request.method !== "GET" && request.method !== "HEAD") validateOrigin(request, env);
  if (url.pathname.startsWith("/media/")) {
    const id = decodeURIComponent(url.pathname.slice("/media/".length)); const row = await env.DB.prepare("SELECT * FROM media WHERE id=? AND expires_at>? ").bind(id, nowIso()).first();
    if (!row) return new Response("Not found", { status: 404, headers: secureHeaders(cors) });
    const object = await env.MEDIA.get(row.object_key); if (!object) return new Response("Not found", { status: 404, headers: secureHeaders(cors) });
    return new Response(object.body, { headers: secureHeaders({ ...cors, "Content-Type": row.mime, "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" }) });
  }
  if (url.pathname === "/api/health" && request.method === "GET") {
    let database = false; let databaseSchema = false; let mediaStorage = false;
    try { database = Boolean(await env.DB?.prepare("SELECT 1 AS ready").first()); } catch {}
    try {
      const placeholders = REQUIRED_SCHEMA_TABLES.map(() => "?").join(",");
      const schema = await env.DB?.prepare(`SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN (${placeholders})`).bind(...REQUIRED_SCHEMA_TABLES).first();
      const columns = await Promise.all(REQUIRED_SCHEMA_COLUMNS.map(([table, column]) =>
        env.DB.prepare("SELECT COUNT(*) AS count FROM pragma_table_info(?) WHERE name=?").bind(table, column).first()
      ));
      databaseSchema = schema?.count === REQUIRED_SCHEMA_TABLES.length && columns.every((result) => result?.count === 1);
    } catch {}
    try { if (env.MEDIA?.head) { await env.MEDIA.head("__klirline_healthcheck__"); mediaStorage = true; } } catch {}
    const checks = {
      database,
      databaseSchema,
      mediaStorage,
      internalMode: env.INTERNAL_MODE === "true",
      sessionSecret: typeof env.SESSION_SECRET === "string" && env.SESSION_SECRET.length >= 32,
      tokenEncryptionKey: /^[0-9a-f]{64}$/i.test(String(env.TOKENS_ENCRYPTION_KEY_HEX || ""))
    };
    const ok = Object.values(checks).every(Boolean);
    return json({ ok, checks, providers: LAUNCH_PROVIDERS }, ok ? 200 : 503, secureHeaders(cors));
  }
  if (url.pathname === "/api/public-config" && request.method === "GET") {
    const internalMode = env.INTERNAL_MODE === "true";
    return json({ internalMode, publicSignupEnabled: false, requireApprovedDrafts:env.REQUIRE_APPROVED_DRAFTS==="true" }, 200, secureHeaders(cors));
  }
  if (url.pathname === "/api/providers" && request.method === "GET") return json(providerList(env), 200, secureHeaders(cors));
  if (url.pathname === "/api/auth/bootstrap" && request.method === "GET") { const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first(); return json({ needsAdmin: !row?.count }, 200, secureHeaders(cors)); }
  if (url.pathname === "/api/auth/register" && request.method === "POST") {
    const body = await readJson(request); const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first();
    const email=String(body.email||"").trim().toLowerCase(); const password=String(body.password||"");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw httpError("invalid-email"); if (password.length < 12 || password.length > 200) throw httpError("password-too-short");
    if (count?.count) { await authenticate(request, env, env.DB, ["admin"]); throw httpError("team-members-not-supported", 403); }
    if (!env.BOOTSTRAP_ADMIN_KEY || !same(request.headers.get("X-Klirline-Bootstrap"), env.BOOTSTRAP_ADMIN_KEY)) throw httpError("invalid-bootstrap-key", 403);
    if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw httpError("session-secret-not-configured",503);
    const id=randomId(); const salt=randomId(16); const hash=await passwordHash(password,salt);
    try { await env.DB.prepare("INSERT INTO users(id,email,password_salt,password_hash,role,org_id,created_at) SELECT ?,?,?,?,'admin','klirline',? WHERE NOT EXISTS(SELECT 1 FROM users)").bind(id,email,salt,hash,nowIso()).run(); }
    catch { throw httpError("admin-already-created",409); }
    const user=await env.DB.prepare("SELECT id,email,role,org_id,auth_version FROM users WHERE id=?").bind(id).first(); if (!user) throw httpError("admin-already-created",409);
    const token=await makeSession(user,env); return json({ user:userMetadata(user), first:true },201,secureHeaders({ ...cors, "Set-Cookie": sessionCookie(token) }));
  }
  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    const body=await readJson(request); const email=String(body.email||"").trim().toLowerCase(); const password=String(body.password||""); if(password.length>200) throw httpError("invalid-credentials",401);
    const keys=await checkLoginLimit(request,email,env,env.DB); const user=await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
    const candidate=await passwordHash(password,user?.password_salt||"AAAAAAAAAAAAAAAAAAAAAA");
    if (!user || user.is_active === 0 || !same(candidate,user.password_hash)) throw httpError("invalid-credentials",401);
    await clearLoginLimit(keys,env.DB);
    const token=await makeSession(user,env); return json({ user:userMetadata(user) },200,secureHeaders({ ...cors, "Set-Cookie": sessionCookie(token) }));
  }
  if (url.pathname === "/api/auth/password" && request.method === "POST") {
    const user = await authenticate(request,env,env.DB); const body = await readJson(request);
    const row = await env.DB.prepare("SELECT password_salt,password_hash,auth_version FROM users WHERE id=?").bind(user.id).first();
    if (!row || !same(await passwordHash(String(body.currentPassword||""),row.password_salt),row.password_hash)) throw httpError("invalid-credentials",401);
    const nextPassword = String(body.newPassword||"");
    if (nextPassword.length < 12 || nextPassword.length > 200) throw httpError("password-too-short");
    if (nextPassword === String(body.currentPassword||"")) throw httpError("new-password-must-differ");
    const salt = randomId(16); const hash = await passwordHash(nextPassword,salt); const version = row.auth_version + 1;
    await env.DB.prepare("UPDATE users SET password_salt=?,password_hash=?,auth_version=? WHERE id=?").bind(salt,hash,version,user.id).run();
    const token = await makeSession({...user,auth_version:version},env);
    return json({ok:true},200,secureHeaders({...cors,"Set-Cookie":sessionCookie(token)}));
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") return json({ok:true},200,secureHeaders({...cors,"Set-Cookie":clearCookie()}));
  if (url.pathname === "/api/team" && request.method === "GET") {
    if (env.INTERNAL_MODE !== "true") throw httpError("not-found",404);
    const user = await authenticate(request,env,env.DB,["admin"]);
    const rows = await env.DB.prepare("SELECT id,email,role,is_active,created_at FROM users WHERE org_id=? ORDER BY created_at,email").bind(user.org_id).all();
    return json((rows.results||[]).map((row)=>({id:row.id,email:row.email,role:row.role,active:row.is_active===1,createdAt:row.created_at})),200,secureHeaders(cors));
  }
  if (url.pathname === "/api/audit" && request.method === "GET") {
    if (env.INTERNAL_MODE !== "true") throw httpError("not-found",404);
    const user = await authenticate(request,env,env.DB,["admin"]);
    const rows = await env.DB.prepare("SELECT e.id,e.actor_user_id,u.email AS actor_email,e.event_type,e.target_id,e.details_json,e.created_at FROM audit_events e LEFT JOIN users u ON u.id=e.actor_user_id WHERE e.org_id=? ORDER BY e.created_at DESC LIMIT 100").bind(user.org_id).all();
    return json((rows.results||[]).map((row)=>({id:row.id,actorId:row.actor_user_id,actorEmail:row.actor_email||"Compte supprimé",type:row.event_type,targetId:row.target_id,details:JSON.parse(row.details_json||"{}"),createdAt:row.created_at})),200,secureHeaders(cors));
  }
  if (url.pathname === "/api/team/invitations" && request.method === "GET") {
    if (env.INTERNAL_MODE !== "true") throw httpError("not-found",404);
    const user = await authenticate(request,env,env.DB,["admin"]);
    const rows = await env.DB.prepare("SELECT id,email,role,created_at,expires_at FROM team_invitations WHERE org_id=? AND used_at IS NULL AND expires_at>? ORDER BY created_at DESC").bind(user.org_id,nowIso()).all();
    return json(rows.results||[],200,secureHeaders(cors));
  }
  if (url.pathname === "/api/team/invitations" && request.method === "POST") {
    if (env.INTERNAL_MODE !== "true") throw httpError("not-found",404);
    const user = await authenticate(request,env,env.DB,["admin"]); const body = await readJson(request);
    const email = String(body.email||"").trim().toLowerCase(); const role = String(body.role||"redacteur");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw httpError("invalid-email");
    if (!["redacteur","lecteur"].includes(role)) throw httpError("invalid-team-role");
    if (await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first()) throw httpError("team-email-already-exists",409);
    await env.DB.prepare("DELETE FROM team_invitations WHERE expires_at<=? OR used_at IS NOT NULL").bind(nowIso()).run();
    const token = randomId(32); const tokenHash = b64u(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token)));
    const id = randomId(); const createdAt = nowIso(); const expiresAt = new Date(Date.now()+48*60*60*1000).toISOString();
    await env.DB.prepare("INSERT INTO team_invitations(id,org_id,email,role,token_hash,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)").bind(id,user.org_id,email,role,tokenHash,user.id,createdAt,expiresAt).run();
    await auditEvent(env.DB,user.org_id,user.id,"team.invitation.created",id,{email,role});
    const inviteUrl = new URL(allowedOrigins(env)[0]); inviteUrl.searchParams.set("invite",token);
    return json({email,role,expiresAt,invitationUrl:inviteUrl.toString()},201,secureHeaders(cors));
  }
  if (url.pathname.startsWith("/api/team/invitations/") && request.method === "DELETE") {
    if (env.INTERNAL_MODE !== "true") throw httpError("not-found",404);
    const user = await authenticate(request,env,env.DB,["admin"]); const id = decodeURIComponent(url.pathname.split("/").at(-1));
    const result = await env.DB.prepare("DELETE FROM team_invitations WHERE id=? AND org_id=? AND used_at IS NULL").bind(id,user.org_id).run();
    if (!result.meta?.changes) throw httpError("not-found",404);
    await auditEvent(env.DB,user.org_id,user.id,"team.invitation.revoked",id);
    return json({id,revoked:true},200,secureHeaders(cors));
  }
  if (url.pathname === "/api/team/accept" && request.method === "POST") {
    if (env.INTERNAL_MODE !== "true") throw httpError("not-found",404);
    const body = await readJson(request); const token = String(body.token||""); const password = String(body.password||"");
    if (token.length < 32 || token.length > 128) throw httpError("invitation-invalid-or-expired",400);
    if (password.length < 12 || password.length > 200) throw httpError("password-too-short");
    const tokenHash = b64u(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token)));
    const salt = randomId(16); const hash = await passwordHash(password,salt); const id = randomId(); const createdAt = nowIso();
    try {
      await env.DB.batch([
        env.DB.prepare("UPDATE team_invitations SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?").bind(createdAt,tokenHash,createdAt),
        env.DB.prepare("INSERT INTO users(id,email,password_salt,password_hash,role,org_id,created_at) SELECT ?,email,?,?,role,org_id,? FROM team_invitations WHERE token_hash=? AND used_at=?").bind(id,salt,hash,createdAt,tokenHash,createdAt)
      ]);
    } catch { throw httpError("invitation-invalid-or-expired",400); }
    const createdUser = await env.DB.prepare("SELECT id,email,role,org_id,auth_version FROM users WHERE id=? AND is_active=1").bind(id).first();
    if (!createdUser) throw httpError("invitation-invalid-or-expired",400);
    await auditEvent(env.DB,createdUser.org_id,createdUser.id,"team.invitation.accepted",id,{email:createdUser.email,role:createdUser.role});
    const session = await makeSession(createdUser,env);
    return json({user:userMetadata(createdUser)},201,secureHeaders({...cors,"Set-Cookie":sessionCookie(session)}));
  }
  if (url.pathname.startsWith("/api/team/") && request.method === "DELETE") {
    if (env.INTERNAL_MODE !== "true") throw httpError("not-found",404);
    const user = await authenticate(request,env,env.DB,["admin"]); const id = decodeURIComponent(url.pathname.split("/").at(-1));
    if (!id || id===user.id) throw httpError("cannot-disable-current-admin",409);
    const target = await env.DB.prepare("SELECT role,is_active FROM users WHERE id=? AND org_id=?").bind(id,user.org_id).first();
    if (!target) throw httpError("not-found",404);
    if (target.role==="admin") throw httpError("cannot-disable-workspace-admin",409);
    await env.DB.prepare("UPDATE users SET is_active=0,auth_version=auth_version+1 WHERE id=? AND org_id=?").bind(id,user.org_id).run();
    await auditEvent(env.DB,user.org_id,user.id,"team.member.disabled",id);
    return json({id,active:false},200,secureHeaders(cors));
  }
  if (url.pathname.startsWith("/api/team/") && url.pathname.endsWith("/activate") && request.method === "POST") {
    if (env.INTERNAL_MODE !== "true") throw httpError("not-found",404);
    const user = await authenticate(request,env,env.DB,["admin"]); const id = decodeURIComponent(url.pathname.split("/").at(-2));
    const target = await env.DB.prepare("SELECT role FROM users WHERE id=? AND org_id=?").bind(id,user.org_id).first();
    if (!target) throw httpError("not-found",404);
    if (target.role==="admin") throw httpError("cannot-change-workspace-admin",409);
    await env.DB.prepare("UPDATE users SET is_active=1,auth_version=auth_version+1 WHERE id=? AND org_id=?").bind(id,user.org_id).run();
    await auditEvent(env.DB,user.org_id,user.id,"team.member.enabled",id);
    return json({id,active:true},200,secureHeaders(cors));
  }
  if (url.pathname === "/api/usage" && request.method === "GET") {
    requireInternalWorkspace(env);
    const user = await authenticate(request,env,env.DB);
    return json({status:"internal",usage:await workspaceUsage(env.DB,user,env)},200,secureHeaders(cors));
  }  if (url.pathname.startsWith("/oauth/") && url.pathname.endsWith("/start") && request.method === "GET") { const user=await authenticate(request,env,env.DB,["admin"]); const result=await oauthStart(url.pathname.split("/")[2],user,env,env.DB); return new Response(null,{status:302,headers:{Location:result.location,"Set-Cookie":oauthCookie(result.state),"Cache-Control":"no-store"}}); }
  if (url.pathname.startsWith("/oauth/") && url.pathname.endsWith("/callback") && request.method === "GET") {
    try { await completeOAuth(request,env,env.DB); return new Response(null,{status:302,headers:{Location:`${allowedOrigins(env)[0]}#oauth-ok=${encodeURIComponent(url.pathname.split("/")[2])}`,"Set-Cookie":clearOAuthCookie(),"Cache-Control":"no-store"}}); }
    catch (error) { return new Response(`OAuth callback: ${String(error.message||error)}`,{status:error.status||500,headers:{"content-type":"text/plain; charset=utf-8","Cache-Control":"no-store","Set-Cookie":clearOAuthCookie()}}); }
  }
  if (url.pathname === "/api/me" && request.method === "GET") return json({ user:userMetadata(await authenticate(request,env,env.DB)) },200,secureHeaders(cors));
  if (url.pathname === "/api/connections" && request.method === "GET") {
    const user=await authenticate(request,env,env.DB); const rows=await env.DB.prepare("SELECT c.provider,c.account_id,c.account_label,c.account_json,c.scopes_json,c.expires_at,c.created_at FROM connections c JOIN users owner ON owner.id=c.user_id WHERE owner.org_id=? ORDER BY c.provider,c.created_at DESC").bind(user.org_id).all();
    return json((rows.results||[]).map((r)=>({provider:r.provider,account:{...JSON.parse(r.account_json),id:r.account_id,label:r.account_label},scopes:JSON.parse(r.scopes_json),expiresAt:r.expires_at,createdAt:r.created_at})),200,secureHeaders(cors));
  }
  if (url.pathname === "/api/pinterest/boards" && request.method === "GET") {
    const user=await authenticate(request,env,env.DB); const connection=await getConnection(env.DB,user.id,"pinterest");
    if(!connection) throw httpError("pinterest-not-connected",404);
    const access=await currentAccessToken("pinterest",connection,env); const boardsUrl=new URL("https://api.pinterest.com/v5/boards"); boardsUrl.searchParams.set("page_size","250");
    const bookmark=url.searchParams.get("bookmark"); if(bookmark) boardsUrl.searchParams.set("bookmark",bookmark);
    const result=await graphJson(boardsUrl,access);
    return json({items:(result.items||[]).map(board=>({id:String(board.id),name:String(board.name||"Tableau Pinterest")})),bookmark:result.bookmark||null},200,secureHeaders(cors));
  }
  if (url.pathname === "/api/pinterest/board" && request.method === "POST") {
    const user=await authenticate(request,env,env.DB,["admin"]); const body=await readJson(request); const boardId=String(body.boardId||"").trim();
    if(!boardId||boardId.length>128) throw httpError("invalid-pinterest-board");
    const connection=await getConnection(env.DB,user.id,"pinterest"); if(!connection) throw httpError("pinterest-not-connected",404);
    const access=await currentAccessToken("pinterest",connection,env); const board=await graphJson(`https://api.pinterest.com/v5/boards/${encodeURIComponent(boardId)}`,access);
    if(String(board.id||"")!==boardId || (board.owner?.username && connection.account?.username && board.owner.username!==connection.account.username)) throw httpError("pinterest-board-not-owned",403);
    const account={...connection.account,boardId,boardName:String(board.name||"")};
    await env.DB.prepare("UPDATE connections SET account_json=? WHERE id=? AND provider='pinterest'").bind(JSON.stringify(account),connection.id).run();
    await auditEvent(env.DB,user.org_id,user.id,"social.pinterest-board-selected",boardId,{boardName:account.boardName});
    return json({boardId,boardName:account.boardName},200,secureHeaders(cors));
  }
  if (url.pathname === "/api/posts" && request.method === "GET") {
    const user=await authenticate(request,env,env.DB); const rows=await env.DB.prepare("SELECT p.* FROM posts p JOIN users author ON author.id=p.user_id WHERE author.org_id=? ORDER BY p.created_at DESC LIMIT 200").bind(user.org_id).all();
    return json((rows.results||[]).map((r)=>({id:r.id,authorId:r.user_id,text:r.text,mediaId:r.media_id,results:JSON.parse(r.results_json),createdAt:r.created_at})),200,secureHeaders(cors));
  }
  if (url.pathname === "/api/drafts" && request.method === "GET") {
    const user=await authenticate(request,env,env.DB); const rows=await env.DB.prepare("SELECT * FROM campaign_drafts WHERE org_id=? ORDER BY updated_at DESC LIMIT 200").bind(user.org_id).all();
    return json((rows.results||[]).map(campaignDraftView),200,secureHeaders(cors));
  }
  if (url.pathname === "/api/drafts" && request.method === "POST") {
    const user=await authenticate(request,env,env.DB,["admin","redacteur"]); requireInternalWorkspace(env); const data=campaignDraftInput(await readJson(request)); const id=randomId(),now=nowIso();
    if(data.mediaId && !await env.DB.prepare("SELECT m.id FROM media m JOIN users owner ON owner.id=m.user_id WHERE m.id=? AND owner.org_id=? AND m.expires_at>?").bind(data.mediaId,user.org_id,now).first()) throw httpError("media-not-found",404);
    await env.DB.prepare("INSERT INTO campaign_drafts(id,org_id,author_user_id,updated_by_user_id,title,text,targets_json,country_code,language_tag,timezone,media_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id,user.org_id,user.id,user.id,data.title,data.text,JSON.stringify(data.targets),data.countryCode,data.languageTag,data.timezone,data.mediaId,now,now).run();
    await auditEvent(env.DB,user.org_id,user.id,"campaign.draft.created",id,{countryCode:data.countryCode,languageTag:data.languageTag});
    return json(campaignDraftView(await env.DB.prepare("SELECT * FROM campaign_drafts WHERE id=?").bind(id).first()),201,secureHeaders(cors));
  }
  if (url.pathname.startsWith("/api/drafts/") && url.pathname.endsWith("/review") && request.method === "POST") {
    const user=await authenticate(request,env,env.DB,["admin"]); requireInternalWorkspace(env); const id=decodeURIComponent(url.pathname.split("/").at(-2)); const body=await readJson(request); const decision=String(body.decision||""); const note=String(body.note||"").trim();
    if (!["approved","rejected"].includes(decision) || (decision==="rejected"&&!note) || note.length>1000) throw httpError("invalid-review-decision");
    const result=await env.DB.prepare("UPDATE campaign_drafts SET review_status=?,review_note=?,updated_by_user_id=?,updated_at=? WHERE id=? AND org_id=? AND review_status='in_review' AND publication_state IN ('not_published','needs_action')").bind(decision,note,user.id,nowIso(),id,user.org_id).run();
    if (!result.meta?.changes) { const found=await env.DB.prepare("SELECT id FROM campaign_drafts WHERE id=? AND org_id=?").bind(id,user.org_id).first(); if(!found) throw httpError("not-found",404); throw httpError("draft-not-in-review",409); }
    await auditEvent(env.DB,user.org_id,user.id,`campaign.draft.${decision}`,id,{noteLength:note.length});
    return json(campaignDraftView(await env.DB.prepare("SELECT * FROM campaign_drafts WHERE id=?").bind(id).first()),200,secureHeaders(cors));
  }
  if (url.pathname.startsWith("/api/drafts/") && request.method === "PUT") {
    const user=await authenticate(request,env,env.DB,["admin","redacteur"]); requireInternalWorkspace(env); const id=decodeURIComponent(url.pathname.split("/").at(-1)); const data=campaignDraftInput(await readJson(request));
    const before=await env.DB.prepare("SELECT review_status,publication_state FROM campaign_drafts WHERE id=? AND org_id=?").bind(id,user.org_id).first(); if(!before) throw httpError("not-found",404);
    if(["scheduled","publishing"].includes(before.publication_state)) throw httpError("campaign-draft-publication-in-progress",409);
    const status="draft";
    if(data.mediaId && !await env.DB.prepare("SELECT m.id FROM media m JOIN users owner ON owner.id=m.user_id WHERE m.id=? AND owner.org_id=? AND m.expires_at>?").bind(data.mediaId,user.org_id,nowIso()).first()) throw httpError("media-not-found",404);
    await env.DB.prepare("UPDATE campaign_drafts SET title=?,text=?,targets_json=?,country_code=?,language_tag=?,timezone=?,media_id=?,review_status=?,review_note='',publication_state='not_published',updated_by_user_id=?,updated_at=? WHERE id=? AND org_id=?")
      .bind(data.title,data.text,JSON.stringify(data.targets),data.countryCode,data.languageTag,data.timezone,data.mediaId,status,user.id,nowIso(),id,user.org_id).run();
    await auditEvent(env.DB,user.org_id,user.id,"campaign.draft.updated",id,{countryCode:data.countryCode,languageTag:data.languageTag});
    return json(campaignDraftView(await env.DB.prepare("SELECT * FROM campaign_drafts WHERE id=?").bind(id).first()),200,secureHeaders(cors));
  }
  if (url.pathname.startsWith("/api/drafts/") && request.method === "POST") {
    const user=await authenticate(request,env,env.DB,["admin","redacteur"]); requireInternalWorkspace(env); const id=decodeURIComponent(url.pathname.split("/").at(-1)); const body=await readJson(request);
    if(body.action!=="submit-review"&&body.action!=="withdraw-review") throw httpError("invalid-draft-action");
    const next=body.action==="submit-review"?"in_review":"draft";
    const result=await env.DB.prepare("UPDATE campaign_drafts SET review_status=?,review_note='',publication_state='not_published',updated_by_user_id=?,updated_at=? WHERE id=? AND org_id=? AND publication_state IN ('not_published','needs_action') AND (review_status IN ('draft','rejected') OR (?='draft' AND review_status='in_review'))").bind(next,user.id,nowIso(),id,user.org_id,next).run();
    if(!result.meta?.changes){const found=await env.DB.prepare("SELECT id FROM campaign_drafts WHERE id=? AND org_id=?").bind(id,user.org_id).first();if(!found)throw httpError("not-found",404);throw httpError("draft-state-conflict",409);}
    await auditEvent(env.DB,user.org_id,user.id,`campaign.draft.${next}`,id);
    return json(campaignDraftView(await env.DB.prepare("SELECT * FROM campaign_drafts WHERE id=?").bind(id).first()),200,secureHeaders(cors));
  }
  if (url.pathname.startsWith("/api/drafts/") && request.method === "DELETE") {
    const user=await authenticate(request,env,env.DB,["admin","redacteur"]); requireInternalWorkspace(env); const id=decodeURIComponent(url.pathname.split("/").at(-1));
    const draft=await env.DB.prepare("SELECT publication_state FROM campaign_drafts WHERE id=? AND org_id=?").bind(id,user.org_id).first(); if(!draft)throw httpError("not-found",404); if(["scheduled","publishing"].includes(draft.publication_state))throw httpError("campaign-draft-publication-in-progress",409);
    const result=await env.DB.prepare("DELETE FROM campaign_drafts WHERE id=? AND org_id=?").bind(id,user.org_id).run(); if(!result.meta?.changes)throw httpError("not-found",404);
    await auditEvent(env.DB,user.org_id,user.id,"campaign.draft.deleted",id); return json({id,deleted:true},200,secureHeaders(cors));
  }
  if (url.pathname === "/api/publish" && request.method === "POST") { const user=await authenticate(request,env,env.DB,["admin","redacteur"]); requireInternalWorkspace(env); const result=await accountPublish(request,user,env,env.DB); await auditEvent(env.DB,user.org_id,user.id,"publication.sent",result.postId,{results:result.results.map(({provider,status})=>({provider,status}))}); return json(result,200,secureHeaders(cors)); }
  if (url.pathname === "/api/media" && request.method === "POST") {
    const user=await authenticate(request,env,env.DB,["admin","redacteur"]); requireInternalWorkspace(env); const form=await request.formData(); const file=form.get("file");
    if (!(file instanceof File)) throw httpError("no-file"); if (file.size > MAX_MEDIA_BYTES) throw httpError("file-too-large",413);
    const bytes=new Uint8Array(await file.arrayBuffer()); const mime=sniffImage(bytes); if (!mime) throw httpError("unsupported-or-invalid-image");
    const id=randomId(); const key=`${user.id}/${id}`; const created=nowIso(); const expires=new Date(Date.now()+30*86400000).toISOString();
    await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:mime,cacheControl:"public, max-age=3600"}});
    try { await env.DB.prepare("INSERT INTO media(id,user_id,object_key,mime,size,created_at,expires_at) VALUES(?,?,?,?,?,?,?)").bind(id,user.id,key,mime,bytes.byteLength,created,expires).run(); }
    catch (error) { await env.MEDIA.delete(key); throw error; }
    return json({id,url:`${env.PUBLIC_BASE_URL}/media/${encodeURIComponent(id)}`,mime,size:bytes.byteLength},201,secureHeaders(cors));
  }
  if (url.pathname === "/api/scheduled" && request.method === "POST") { const user=await authenticate(request,env,env.DB,["admin","redacteur"]); requireInternalWorkspace(env); const result=await createSchedule(request,user,env,env.DB); await auditEvent(env.DB,user.org_id,user.id,"publication.scheduled",result.job.id,{targets:result.job.targets,runAtUTC:result.job.runAtUTC,timezone:result.job.timezone}); return json(result,200,secureHeaders(cors)); }
  if (url.pathname === "/api/scheduled" && request.method === "GET") {
    const user=await authenticate(request,env,env.DB); const rows=await env.DB.prepare("SELECT s.* FROM scheduled_posts s JOIN users author ON author.id=s.user_id WHERE author.org_id=? ORDER BY s.run_at DESC LIMIT 200").bind(user.org_id).all();
    return json(await Promise.all((rows.results||[]).map((row)=>scheduleView(env.DB,row))),200,secureHeaders(cors));
  }
  if (url.pathname.startsWith("/api/scheduled/") && request.method === "DELETE") {
    const user=await authenticate(request,env,env.DB,["admin","redacteur"]); const id=decodeURIComponent(url.pathname.split("/").at(-1)); const orgUsers="user_id IN (SELECT id FROM users WHERE org_id=?)"; const before=await env.DB.prepare(`SELECT usage_period,campaign_draft_id FROM scheduled_posts WHERE id=? AND ${orgUsers} AND status='queued'`).bind(id,user.org_id).first(); const result=await env.DB.prepare(`UPDATE scheduled_posts SET status='canceled' WHERE id=? AND ${orgUsers} AND status='queued'`).bind(id,user.org_id).run();
    if (!result.meta?.changes) { const found=await env.DB.prepare(`SELECT status FROM scheduled_posts WHERE id=? AND ${orgUsers}`).bind(id,user.org_id).first(); if (!found) throw httpError("not-found",404); return json({id,status:found.status},200,secureHeaders(cors)); }
    if (before?.usage_period) await releaseMonthlyPublication(env.DB,user.org_id,before.usage_period);
    if (before?.campaign_draft_id) await releaseApprovedDraft(env.DB,user.org_id,before.campaign_draft_id,"scheduled");
    await auditEvent(env.DB,user.org_id,user.id,"publication.schedule-canceled",id);
    return json({id,status:"canceled"},200,secureHeaders(cors));
  }
  if (url.pathname.startsWith("/api/connections/") && request.method === "DELETE") {
    const user=await authenticate(request,env,env.DB,["admin"]); const provider=decodeURIComponent(url.pathname.split("/").at(-1));
    const result=await env.DB.prepare("DELETE FROM connections WHERE provider=? AND user_id IN (SELECT id FROM users WHERE org_id=?)").bind(provider,user.org_id).run(); if (!result.meta?.changes) throw httpError("not-found",404);
    await auditEvent(env.DB,user.org_id,user.id,"social.disconnected",provider);
    return json({ok:true,providerAuthorizationMustBeRevoked:true},200,secureHeaders(cors));
  }
  if (url.pathname === "/api/account" && request.method === "DELETE") {
    await authenticate(request,env,env.DB);
    throw httpError("member-removal-managed-by-workspace-admin",409);
  }  return json({error:"not-found"},404,secureHeaders(cors));
}

export default {
  async fetch(request, env, ctx) {
    try {
      const path = new URL(request.url).pathname;
      if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS" ) validateOrigin(request,env);
      const response=await handle(request,env,ctx);
      const cors=corsHeaders(request,env); const headers=new Headers(response.headers); for (const [key,value] of Object.entries(secureHeaders(cors))) if (!headers.has(key) || key.startsWith("Access-Control-")) headers.set(key,value);
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    } catch (error) { return json({error:String(error.message||"internal-error").slice(0,240)},error.status||500,secureHeaders(corsHeaders(request,env))); }
  },
  async scheduled(_event, env, ctx) { ctx.waitUntil(processDue(env,env.DB).catch((error)=>console.error("scheduled-worker-failed",String(error)))); }
};
