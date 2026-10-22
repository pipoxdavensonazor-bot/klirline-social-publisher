// OAuth par fournisseur : state anti-CSRF signe + PKCE, echange code->jeton COTE SERVEUR,
// verification du compte, stockage CHIFFRE. Le navigateur ne voit jamais le token.
// References d endpoints : voir src/config.js. Chaque echange est adapte au format du fournisseur.
import { PROVIDERS, PROVIDER_IDS } from "./config.js";
import { signState, verifyState, pkcePair, encryptToken, saveDb, uid } from "./lib.js";

const pkceStore = new Map(); // stateId -> verifier (memoire serveur, 10 min)

function redirectUri(env, provider) {
  const key = { instagram: "INSTAGRAM_REDIRECT_URI", facebook: "FACEBOOK_REDIRECT_URI", threads: "THREADS_REDIRECT_URI", linkedin: "LINKEDIN_REDIRECT_URI", x: "X_REDIRECT_URI", pinterest: "PINTEREST_REDIRECT_URI", tiktok: "TIKTOK_REDIRECT_URI", twitch: "TWITCH_REDIRECT_URI", bluesky: "BLUESKY_REDIRECT_URI" }[provider];
  const fallback = ["instagram", "facebook", "threads"].includes(provider) ? env.META_REDIRECT_URI : "";
  return (env[key] || fallback || "").replace("${PUBLIC_BASE_URL}", env.PUBLIC_BASE_URL || "");
}
function clientId(env, provider) {
  return { instagram: env.META_APP_ID, facebook: env.META_APP_ID, threads: env.META_APP_ID, linkedin: env.LINKEDIN_CLIENT_ID, x: env.X_CLIENT_ID, pinterest: env.PINTEREST_APP_ID, tiktok: env.TIKTOK_CLIENT_KEY, twitch: env.TWITCH_CLIENT_ID, bluesky: env.BLUESKY_CLIENT_METADATA_URL }[provider] || "";
}
function clientSecret(env, provider) {
  return { instagram: env.META_APP_SECRET, facebook: env.META_APP_SECRET, threads: env.META_APP_SECRET, linkedin: env.LINKEDIN_CLIENT_SECRET, x: env.X_CLIENT_SECRET, pinterest: env.PINTEREST_APP_SECRET, tiktok: env.TIKTOK_CLIENT_SECRET, twitch: env.TWITCH_CLIENT_SECRET }[provider] || "";
}

export function startOAuth(env, provider, user) {
  if (!PROVIDERS[provider]) throw Object.assign(new Error("unknown-provider"), { status: 400 });
  if (provider === "bluesky") throw Object.assign(new Error("bluesky-oauth-requires-atproto-oauth-client"), { status: 501 });
  const scopes = PROVIDERS[provider].scopes.join(["tiktok", "instagram", "facebook", "threads"].includes(provider) ? "," : " ");
  const state = signState(env, { uid: user.id, provider, exp: Date.now() + 10 * 60 * 1000, n: uid() });
  const ru = redirectUri(env, provider);
  const id = clientId(env, provider);
  if (!id || !ru) throw Object.assign(new Error("missing-credentials"), { status: 501 });
  if (provider !== "x" && !clientSecret(env, provider)) throw Object.assign(new Error("missing-client-secret"), { status: 501 });
  const q = new URLSearchParams({ client_id: id, redirect_uri: ru, scope: scopes, state, response_type: "code" });
  const P = PROVIDERS[provider];
  if (provider === "x") {
    const { verifier, challenge } = pkcePair();
    pkceStore.set(state, verifier);
    setTimeout(() => pkceStore.delete(state), 10 * 60 * 1000);
    q.set("code_challenge", challenge); q.set("code_challenge_method", "S256");
  }
  if (provider === "tiktok") q.set("client_key", id);
  return P.oauth.authorize + "?" + q.toString();
}

export async function finishOAuth(env, db, { provider, code, state }) {
  const s = verifyState(env, state);
  if (!s || !PROVIDER_IDS.includes(provider) || s.provider !== provider) throw Object.assign(new Error("bad-state"), { status: 400 });
  const ru = redirectUri(env, provider);
  const secret = clientSecret(env, provider);
  let tok;
  if (provider === "x") {
    const verifier = pkceStore.get(state);
    if (!verifier) throw Object.assign(new Error("pkce-expired"), { status: 400 });
    pkceStore.delete(state);
    tok = await exchangeToken(provider, { code, ru, verifier, env, secret });
  } else {
    tok = await exchangeToken(provider, { code, ru, env, secret });
  }
  const access = tok.access_token, refresh = tok.refresh_token || null;
  if (!access) throw Object.assign(new Error("no-access-token"), { status: 502 });
  // Verification du compte : label obtenu via l API du fournisseur (jamais l URL saisie a la main).
  const account = await verifyAccount(provider, access, env);
  const connectionToken = account.connectionToken || access;
  delete account.connectionToken;
  const sealed = encryptToken(env, connectionToken);
  const sealedRefresh = refresh ? encryptToken(env, refresh) : null;
  const existing = db.connections.findIndex((c) => c.userId === s.uid && c.provider === provider);
  const conn = { id: uid(), userId: s.uid, provider, account, scopes: PROVIDERS[provider].scopes, sealed, sealedRefresh, expiresAt: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000).toISOString() : null, createdAt: new Date().toISOString() };
  if (existing >= 0) db.connections[existing] = conn; else db.connections.push(conn);
  saveDb(env, db);
  // Retourne UNIQUEMENT des metadonnees (jamais le jeton).
  return { provider, account, scopes: conn.scopes, expiresAt: conn.expiresAt };
}

async function verifyAccount(provider, accessToken, env) {
  let url, headers = { Authorization: "Bearer " + accessToken };
  if (provider === "facebook") {
    const version = env.META_GRAPH_VERSION || "v26.0";
    const me = await readIdentity(`https://graph.facebook.com/${version}/me?fields=id,name`, headers);
    if (!env.FACEBOOK_PAGE_ID) throw Object.assign(new Error("facebook-page-id-required"), { status: 409 });
    const pages = await readIdentity(`https://graph.facebook.com/${version}/me/accounts?fields=id,name,access_token,tasks`, headers);
    const page = (pages.data || []).find((p) => p.id === env.FACEBOOK_PAGE_ID);
    if (!page?.access_token || !(page.tasks || []).some((t) => ["CREATE_CONTENT", "MANAGE"].includes(t))) throw Object.assign(new Error("facebook-page-not-accessible-for-publishing"), { status: 403 });
    return { id: page.id, label: page.name, ownerId: me.id, connectionToken: page.access_token };
  }
  else if (provider === "instagram") url = `https://graph.instagram.com/${env.META_GRAPH_VERSION || "v26.0"}/me?fields=user_id,username`;
  else if (provider === "threads") url = `https://graph.threads.com/${env.THREADS_API_VERSION || "v1.0"}/me?fields=id,username`;
  else if (provider === "linkedin") url = "https://api.linkedin.com/v2/userinfo";
  else if (provider === "x") url = "https://api.x.com/2/users/me?user.fields=id,name,username";
  else if (provider === "pinterest") url = "https://api.pinterest.com/v5/user_account";
  else if (provider === "tiktok") url = "https://open.tiktokapis.com/v2/user/info/?fields=open_id,username,display_name";
  else if (provider === "twitch") { url = "https://api.twitch.tv/helix/users"; headers["Client-Id"] = env.TWITCH_CLIENT_ID || ""; }
  else throw Object.assign(new Error("identity-verification-not-implemented:" + provider), { status: 501 });
  const j = await readIdentity(url, headers, provider);
  const user = provider === "twitch" ? j.data?.[0] : provider === "tiktok" ? (j.data?.user || {}) : j.data || j;
  const id = user?.id || user?.user_id || user?.open_id || user?.sub || (provider === "pinterest" ? user?.username : null);
  const label = user?.username || user?.display_name || user?.name || user?.login || user?.email;
  if (!id || !label) throw Object.assign(new Error("account-identity-missing:" + provider), { status: 502 });
  return { id, label: ["x", "instagram", "threads", "pinterest", "tiktok"].includes(provider) ? "@" + label.replace(/^@/, "") : label };
}

async function readIdentity(url, headers, provider = "facebook") {
  const r = await fetch(url, { headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw Object.assign(new Error("account-verification-failed:" + provider + ":" + r.status), { status: 502 });
  return j;
}

async function exchangeToken(provider, { code, ru, verifier, env, secret }) {
  const id = clientId(env, provider), endpoint = PROVIDERS[provider].oauth.token;
  if (provider === "facebook") {
    const url = new URL(endpoint);
    Object.entries({ client_id: id, client_secret: secret, redirect_uri: ru, code }).forEach(([k, v]) => url.searchParams.set(k, v || ""));
    return readToken(await fetch(url));
  }
  if (provider === "instagram") {
    const form = new FormData();
    Object.entries({ client_id: id, client_secret: secret, grant_type: "authorization_code", redirect_uri: ru, code }).forEach(([k, v]) => form.set(k, v || ""));
    return readToken(await fetch(endpoint, { method: "POST", body: form }));
  }
  if (provider === "threads") {
    const url = new URL(endpoint);
    Object.entries({ client_id: id, client_secret: secret, grant_type: "authorization_code", redirect_uri: ru, code }).forEach(([k, v]) => url.searchParams.set(k, v || ""));
    return readToken(await fetch(url, { method: "POST" }));
  }
  if (provider === "pinterest") {
    const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: ru });
    const basic = Buffer.from(id + ":" + secret).toString("base64");
    return readToken(await fetch(endpoint, { method: "POST", headers: { Authorization: "Basic " + basic, "Content-Type": "application/x-www-form-urlencoded" }, body }));
  }
  const form = provider === "tiktok"
    ? new URLSearchParams({ client_key: id, client_secret: secret, code, grant_type: "authorization_code", redirect_uri: ru })
    : new URLSearchParams({ client_id: id, code, grant_type: "authorization_code", redirect_uri: ru });
  if (secret && provider !== "x") form.set("client_secret", secret);
  if (provider === "x") { form.set("code_verifier", verifier); if (secret) form.set("client_secret", secret); }
  return readToken(await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form }));
}

async function readToken(response) {
  if (!response.ok) throw Object.assign(new Error("token-exchange-failed:" + response.status), { status: 502 });
  const token = await response.json();
  if (token.error || !token.access_token) throw Object.assign(new Error("token-exchange-rejected"), { status: 502 });
  return token;
}
