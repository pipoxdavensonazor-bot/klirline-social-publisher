// Registre des 9 reseaux : scopes minimaux, limites, endpoints OAuth / API.
// Aucun secret ici — uniquement des URLs publiques et des noms de scopes.
export const PROVIDERS = {
  instagram: {
    name: "Instagram", limit: 2200, kind: "post",
    accountHint: "@klirlineofficial",
    scopes: ["instagram_business_basic", "instagram_business_content_publish"],
    notes: "Compte Professionnel requis. Flux login Instagram Business ou Page Facebook liee.",
    oauth: { authorize: "https://www.instagram.com/oauth/authorize", token: "https://api.instagram.com/oauth/access_token" },
    publishApi: "graph.instagram.com (conteneurs + publication)",
  },
  facebook: {
    name: "Facebook", limit: 63206, kind: "post", blocking: true,
    accountHint: "/people/KlirlineOfficial/… — TYPE A CLARIFIER (probablement profil, pas Page)",
    scopes: ["pages_show_list", "pages_manage_posts", "pages_read_engagement"],
    notes: "Publication API uniquement via Page administree + jeton de Page. Pas d API sur profil personnel.",
    oauth: { authorize: "https://www.facebook.com/dialog/oauth", token: "https://graph.facebook.com/oauth/access_token" },
    publishApi: "graph.facebook.com/{page-id}/feed",
  },
  linkedin: {
    name: "LinkedIn", limit: 3000, kind: "post",
    accountHint: "Page Klirline Inc. (ID decouvert apres OAuth)",
    scopes: ["openid", "profile", "w_organization_social"],
    notes: "Admin de la Page requis + produit Community Management. Acces soumis a approbation possible.",
    oauth: { authorize: "https://www.linkedin.com/oauth/v2/authorization", token: "https://www.linkedin.com/oauth/v2/accessToken" },
    publishApi: "api.linkedin.com/v2/posts (organisation)",
  },
  x: {
    name: "X", limit: 280, kind: "post",
    accountHint: "@klirlineOffice",
    scopes: ["tweet.write", "users.read", "offline.access"],
    notes: "App X Developer + callback PKCE. Verifier plan/couts/quotas.",
    oauth: { authorize: "https://x.com/i/oauth2/authorize", token: "https://api.x.com/2/oauth2/token" },
    publishApi: "POST api.twitter.com/2/tweets",
  },
  threads: {
    name: "Threads", limit: 500, kind: "post",
    accountHint: "@klirlineofficial",
    scopes: ["threads_basic", "threads_content_publish"],
    notes: "App Meta + cas d usage Threads. Gerer expiration/renouvellement.",
    oauth: { authorize: "https://www.threads.com/oauth/authorize", token: "https://graph.threads.com/oauth/access_token" },
    publishApi: "graph.threads.com (creation conteneur + publication)",
  },
  pinterest: {
    name: "Pinterest", limit: 800, kind: "pin",
    accountHint: "@klirlineofficial",
    scopes: ["user_accounts:read", "pins:write", "boards:read"],
    notes: "Epingle = media obligatoire + tableau. App approuvee, redirect exacte.",
    oauth: { authorize: "https://www.pinterest.com/oauth/", token: "https://api.pinterest.com/v5/oauth/token" },
    publishApi: "api.pinterest.com/v5/pins",
  },
  bluesky: {
    name: "Bluesky", limit: 300, kind: "post",
    accountHint: "klirlineofficial.bsky.social",
    scopes: ["atproto"],
    notes: "OAuth AT Protocol (PDS utilisateur), PKCE, sans secret partage. Mot de passe d app = secret, validation explicite requise.",
    oauth: { authorize: "(PDS)/oauth/authorize", token: "(PDS)/oauth/token" },
    publishApi: "app.bsky.feed.post (+ blobs media)",
  },
  tiktok: {
    name: "TikTok", limit: 2200, kind: "video",
    accountHint: "@klirlineofficial",
    scopes: ["user.info.basic", "video.publish"],
    notes: "Produit Content Posting + audit requis pour visibilite publique. Media par URL verifiee ou upload fichier.",
    oauth: { authorize: "https://www.tiktok.com/v2/auth/authorize/", token: "https://open.tiktokapis.com/v2/oauth/token/" },
    publishApi: "open.tiktokapis.com (Direct Post)",
  },
  twitch: {
    name: "Twitch", limit: 500, kind: "specific", specific: true,
    accountHint: "twitch.tv/klirlineofficial",
    scopes: ["clips:edit"],
    notes: "Pas de fil de posts. Actions : clip de live, annonce chat, gestion chaine. Choisir avant de coder.",
    oauth: { authorize: "https://id.twitch.tv/oauth2/authorize", token: "https://id.twitch.tv/oauth2/token" },
    publishApi: "api.twitch.tv/helix/clips + chat/announcements",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);
export const GENERIC_IDS = PROVIDER_IDS.filter((id) => !PROVIDERS[id].specific);

export function providerStatus(providerId, env) {
  // Indique simplement si les identifiants serveur sont renseignes (sans les exposer).
  if (providerId === "bluesky") return "requires-atproto-oauth-client";
  const map = {
    instagram: ["META_APP_ID", "META_APP_SECRET"], facebook: ["META_APP_ID", "META_APP_SECRET", "FACEBOOK_PAGE_ID"],
    threads: ["META_APP_ID", "META_APP_SECRET"], linkedin: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LINKEDIN_ORGANIZATION_URN", "LINKEDIN_VERSION"],
    x: ["X_CLIENT_ID"], pinterest: ["PINTEREST_APP_ID", "PINTEREST_APP_SECRET", "PINTEREST_DEFAULT_BOARD_ID"],
    bluesky: ["BLUESKY_CLIENT_METADATA_URL"], tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"], twitch: ["TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET"],
  };
  const keys = map[providerId] || [];
  if (!keys.length) return "not-configured";
  return keys.every((k) => env[k]) ? "ready" : "missing-credentials";
}
