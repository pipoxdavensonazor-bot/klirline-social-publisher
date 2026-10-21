// Service de publication : validation par reseau, adaptateurs, statuts par destination.
// Statuts : queued | published | failed | action-required. Twitch = action specifique uniquement.
import { PROVIDERS } from "./config.js";
import { decryptToken } from "./lib.js";

export function validateFor(provider, text, media) {
  const P = PROVIDERS[provider];
  if (!P) return "unknown-provider";
  if (!text || !text.trim()) return "empty-text";
  if (text.length > P.limit) return "too-long:" + P.limit;
  if (provider === "pinterest" && !media) return "media-required";
  if (provider === "tiktok" && !media) return "media-required";
  if (provider === "instagram" && !media) return "media-required";
  if (provider === "twitch") return "specific-action-required";
  return null;
}

export async function publishOne(env, db, { connection, text, media }) {
  const { provider } = connection;
  const problem = validateFor(provider, text, media && { id: 1 });
  if (problem === "specific-action-required") {
    return { status: "action-required", message: "Twitch : clip, annonce chat ou gestion chaine — pas de post generique.", postId: null };
  }
  if (problem) return { status: "failed", message: problem, postId: null };
  let access;
  try { access = decryptToken(env, connection.sealed); }
  catch { return { status: "failed", message: "token-unreadable", postId: null }; }
  try {
    const out = await callProviderApi(provider, { access, text, media, connection, env });
    if (out.status === "action-required") return { status: "action-required", postId: null, message: out.message };
    return { status: "published", postId: out.id || null, message: out.message || "ok" };
  } catch (e) {
    return { status: "failed", message: String(e.message || e).slice(0, 300), postId: null };
  }
}

async function callProviderApi(provider, { access, text, media, connection, env }) {
  const apiVersion = env.META_GRAPH_VERSION || "v25.0";
  if (provider === "x") {
    const body = { text };
    if (media) {
      // X media upload requires the dedicated chunked upload API and media ID.
      return { status: "action-required", message: "x-media-upload-not-configured" };
    }
    const j = await requestJson("https://api.x.com/2/tweets", { method: "POST", headers: { Authorization: "Bearer " + access, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { id: j.data?.id };
  }
  if (provider === "facebook") {
    if (media) return { status: "action-required", message: "facebook-media-upload-flow-not-configured" };
    const pageId = connection.account?.id;
    if (!pageId) return { status: "action-required", message: "facebook-page-not-connected" };
    const j = await requestJson(`https://graph.facebook.com/${apiVersion}/${encodeURIComponent(pageId)}/feed`, { method: "POST", headers: { Authorization: "Bearer " + access, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ message: text }) });
    return { id: j.id };
  }
  if (provider === "instagram") {
    if (!/^image\//.test(media.mime || "") || !media.url) return { status: "action-required", message: "instagram-image-post-needs-public-image-url" };
    const userId = connection.account?.id;
    if (!userId) return { status: "action-required", message: "instagram-account-id-missing" };
    const base = `https://graph.instagram.com/${apiVersion}/${encodeURIComponent(userId)}`;
    const created = await requestJson(`${base}/media`, { method: "POST", headers: { Authorization: "Bearer " + access, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ image_url: media.url, caption: text }) });
    if (!created.id) throw new Error("instagram-container-id-missing");
    const posted = await requestJson(`${base}/media_publish`, { method: "POST", headers: { Authorization: "Bearer " + access, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ creation_id: created.id }) });
    return { id: posted.id };
  }
  if (provider === "threads") {
    const base = `https://graph.threads.net/${apiVersion}/me`;
    const fields = { media_type: "TEXT", text };
    if (media) {
      if (!media.url) return { status: "action-required", message: "threads-media-needs-public-url" };
      if (media.mime?.startsWith("image/")) { fields.media_type = "IMAGE"; fields.image_url = media.url; }
      else if (media.mime?.startsWith("video/")) { fields.media_type = "VIDEO"; fields.video_url = media.url; }
      else return { status: "action-required", message: "threads-unsupported-media-type" };
    }
    const created = await requestJson(`${base}/threads`, { method: "POST", headers: { Authorization: "Bearer " + access, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
    if (!created.id) throw new Error("threads-container-id-missing");
    const posted = await requestJson(`${base}/threads_publish`, { method: "POST", headers: { Authorization: "Bearer " + access, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ creation_id: created.id }) });
    return { id: posted.id };
  }
  if (provider === "linkedin") {
    const author = env.LINKEDIN_ORGANIZATION_URN;
    if (!author) return { status: "action-required", message: "linkedin-organization-urn-required" };
    if (media) return { status: "action-required", message: "linkedin-media-upload-flow-not-configured" };
    const version = env.LINKEDIN_VERSION;
    if (!/^\d{6}$/.test(version || "")) return { status: "action-required", message: "linkedin-version-YYYYMM-required" };
    const j = await requestJson("https://api.linkedin.com/rest/posts", { method: "POST", headers: { Authorization: "Bearer " + access, "Content-Type": "application/json", "X-Restli-Protocol-Version": "2.0.0", "Linkedin-Version": version }, body: JSON.stringify({ author, commentary: text, visibility: "PUBLIC", distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false }) });
    return { id: j.id || null };
  }
  if (provider === "pinterest") {
    if (!media?.url || !/^image\//.test(media.mime || "")) return { status: "action-required", message: "pinterest-image-pin-needs-public-image" };
    const boardId = media.boardId || env.PINTEREST_DEFAULT_BOARD_ID;
    if (!boardId) return { status: "action-required", message: "pinterest-board-id-required" };
    const j = await requestJson("https://api.pinterest.com/v5/pins", { method: "POST", headers: { Authorization: "Bearer " + access, "Content-Type": "application/json" }, body: JSON.stringify({ board_id: boardId, title: text.slice(0, 100), description: text.slice(0, 800), media_source: { source_type: "image_url", url: media.url } }) });
    return { id: j.id };
  }
  if (provider === "bluesky") {
    return { status: "action-required", message: "bluesky-atproto-oauth-client-not-configured" };
  }
  if (provider === "tiktok") {
    return { status: "action-required", message: "tiktok-requires-creator-privacy-choice-and-audited-upload-flow" };
  }
  if (provider === "twitch") {
    return { status: "action-required", message: "twitch-specific-action-required" };
  }
  throw new Error("no-adapter:" + provider);
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) throw new Error(`provider-api:${response.status}:${String(body.error?.message || body.message || body.error || "request-failed").slice(0, 160)}`);
  return body;
}
