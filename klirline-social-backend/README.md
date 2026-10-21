# Klirline Social — prototype de backend (Node 20+, stockage JSON local)

Fournit les routes et la structure de départ. Plusieurs étapes de publication, de sélection
de destination et de conformité restent à compléter; consulter `AUDIT.md` avant tout déploiement.

## Lancer en local
1. Depuis ce dossier : `npm install`
2. Copier `env.example.txt` vers `.env` (fichier local, JAMAIS commite) et renseigner :
   `PUBLIC_BASE_URL` (https, ex. https://social.example.com),
   `JWT_SECRET`, `TOKENS_ENCRYPTION_KEY_HEX` (generer : `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
3. `npm start` → API sur `PORT` (defaut 8787).

## Deployer en HTTPS (au choix)
- VPS (Caddy/Nginx + certificat auto) : `PUBLIC_BASE_URL=https://social.klirline.example`
- Render / Railway / Fly.io : definir les vars d env du `.env`, disque persistant pour `DATA_DIR`
  (fichier `klirline.json` + `data/media`). Sans disque persistant, les jobs/medias disparaissent au redeploiement.
- Callbacks a declarer IDENTIQUES chez chaque fournisseur :
  `PUBLIC_BASE_URL/oauth/<provider>/callback` avec provider ∈
  `instagram facebook linkedin x threads pinterest bluesky tiktok twitch`.
  Meta mutualise instagram/facebook/threads via `META_REDIRECT_URI` (meme URL, state.provider distingue).
- Frontend : champ « URL du backend » (ex. `https://social.klirline.example`), bouton Tester.
  Sans backend : l interface reste en mode manuel local (aucune regression).

## Comptes et roles
- Premier compte inscrit = `admin` (org `klirline`) et reçoit une session JWT. Ensuite l’inscription exige un JWT admin et crée un `redacteur`.
- Changer un role : editer `data/klirline.json` (redemarrage non requis, ecriture regroupee ~50 ms).
- JWT 12 h via `Authorization: Bearer`. Routes sensibles : `admin`/`redacteur` ; lecture : tout role connecte.

## OAuth par reseau (serveur uniquement)
- `GET /oauth/:provider/start` (connecte) → 302 vers le fournisseur
  (state HMAC anti-CSRF 10 min, PKCE pour X, scopes minimaux de `src/config.js`).
- `GET /oauth/:provider/callback` → echange code→jeton COTE SERVEUR,
  verification du compte via l API du fournisseur (jamais l URL saisie),
  chiffrement AES-256-GCM au repos, redirection frontend `#oauth-ok=<provider>`.
- `GET /api/connections` : metadonnees uniquement (label verifie, scopes, expiration).
  `DELETE /api/connections/:provider` : supprime + TODO revocation officielle.
- Etat de configuration : `GET /api/providers` → `configured: ready|missing-credentials`
  (calcule la presence des IDs, sans jamais exposer les secrets).

## Publication / medias / file
- `POST /api/publish {text, targets, mediaId}` → resultats par destination
  (`published|failed|action-required`), journalises dans `posts`.
  Adaptateurs actuellement limités : X (texte), Facebook Page (texte), Instagram (image),
  Threads (texte/image/vidéo), LinkedIn (texte), Pinterest (image). Bluesky est bloqué jusqu’à
  l’intégration d’un client OAuth AT Protocol; TikTok exige encore son flow complet Direct Post;
  Twitch refuse le post générique par conception.
- `POST /api/media` (multipart `file`, image/video ≤ 100 Mo) → `{id, url}`.
  L’URL publique sert aux flux `PULL_FROM_URL` ou `image_url`. L’upload spécifique X, LinkedIn,
  Pinterest vidéo, TikTok fichier et Facebook média n’est pas encore implémenté.
- `POST /api/scheduled {text, targets, mediaId, runAtUTC}` → job UTC idempotent
  (cle = auteur+texte+cibles+media ; doublon retourne `{deduped:true}`),
  `GET /api/scheduled`, `DELETE /api/scheduled/:id` (annulation si `queued`). Les retries
  sont suivis par destination dans un seul processus; le fichier JSON n’est pas un verrou distribué.
  Worker 15 s : tentatives independantes par destination, backoff 2/10/30/120 min, max 5 essais.

## App reviews — aide-memoire
`GET /api/review-checklist`. Details par fournisseur :
- Meta (IG/FB/Threads) : app + cas d usage Threads, compte Pro IG, Page FB + roles,
  screencast, compte test, URLs confidentialite/suppression (`/api/legal/*`).
- LinkedIn : produit Community Management, `w_organization_social`, admin Page approbateur.
- X : budget/quotas verifies avant de batir.
- TikTok : audit obligatoire (sinon posts prives), `video.publish`.
- Pinterest : `pins:write` + `boards:read`, redirect exacte, tableau choisi par Pin.
- Twitch : scope selon l action retenue (`clips:edit`), contraintes stream/VOD.
- Bluesky : OAuth AT Protocol sur le PDS, pas de mot de passe partage.

## Pages legales (revues + callbacks)
`GET /api/legal/privacy|terms|deletion` (FR). A recopier comme URL officielles dans
chaque console developpeur + lien depuis le frontend (modale « Infos legales »).

## Limites actuelles

- Le `index.html` à la racine du projet n’est pas encore câblé à ces routes; ses actions restent locales/manuelles.
- Le stockage JSON et le worker conviennent uniquement à une démonstration mono-instance.
- `GET /api/legal/deletion` affiche l’information, mais aucune suppression complète de compte ni révocation distante n’est encore implémentée.
- OAuth ne se valide qu’avec les identifiants et comptes de test réels. Les accès Meta/LinkedIn/X/Pinterest/TikTok, la Page Facebook, l’organisation LinkedIn et le board Pinterest doivent être configurés.
