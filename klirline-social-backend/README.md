# Klirline Social — backend de référence (Node 20+, stockage JSON local)

Fournit les routes de connexion et de publication de référence. Ce serveur reste une version pilote
mono-instance; il ne doit pas être exposé à des clients payants avant migration du stockage et revue
des intégrations. L’interface racine sait maintenant appeler ces routes quand l’URL API est configurée.

## Lancer en local
1. Depuis ce dossier : `npm install`
2. Copier `env.example.txt` vers `.env` (fichier local, JAMAIS commite) et renseigner :
   `PUBLIC_BASE_URL` (https, ex. https://social.example.com),
   `JWT_SECRET`, `BOOTSTRAP_ADMIN_KEY` (32 caractères aléatoires minimum),
   `TOKENS_ENCRYPTION_KEY_HEX` (générer : `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
   En production, ajouter le nom légal et l’adresse de confidentialité dans `COMPANY_LEGAL_NAME` et `PRIVACY_CONTACT_EMAIL`.
3. `npm start` → API sur `PORT` (defaut 8787).

## Deployer en HTTPS (au choix)
- VPS (Caddy/Nginx + certificat auto) : `PUBLIC_BASE_URL=https://social.klirline.example`
- Render / Railway / Fly.io : definir les vars d env du `.env`, disque persistant pour `DATA_DIR`
  (fichier `klirline.json` + `data/media`). Sans disque persistant, les jobs/medias disparaissent au redeploiement.
- Callbacks à déclarer exactement chez chaque fournisseur : `PUBLIC_BASE_URL/oauth/<provider>/callback`.
  Instagram, Facebook et Threads ont chacun leur variable de callback (`*_REDIRECT_URI`).
- Frontend : Préférences → Backend et compte, saisir l’URL API HTTPS, vérifier, puis se connecter. Les liens Confidentialité, Conditions et Suppression sont des pages statiques à la racine du site.
  Le premier compte administrateur exige `BOOTSTRAP_ADMIN_KEY`; le champ est demandé uniquement pendant le bootstrap.

## Comptes et roles
- Premier compte créé avec la clé bootstrap = `admin` (org `klirline`). Ensuite la création d’un `redacteur` exige une session admin.
- Changer un role : editer `data/klirline.json` (redemarrage non requis, ecriture regroupee ~50 ms).
- Session JWT 12 h dans un cookie `HttpOnly; Secure; SameSite=None`; l’interface ne lit pas le jeton. En production, utilisez de préférence des sous-domaines du même domaine (par exemple `app.klirline.com` et `api.klirline.com`) et vérifiez que le navigateur accepte les cookies; les domaines `workers.dev` distincts peuvent être bloqués comme cookies tiers.
  Les écritures navigateur exigent une origine autorisée et l’en-tête CSRF `X-Klirline-Request`.

## OAuth par reseau (serveur uniquement)
- `GET /oauth/:provider/start` (connecte) → 302 vers le fournisseur
  (state HMAC anti-CSRF 10 min, PKCE pour X, scopes minimaux de `src/config.js`).
- `GET /oauth/:provider/callback` → echange code→jeton COTE SERVEUR,
  verification du compte via l API du fournisseur (jamais l URL saisie),
  chiffrement AES-256-GCM au repos, redirection frontend `#oauth-ok=<provider>`.
- `GET /api/connections`, `GET /api/posts` : métadonnées et historique de l’utilisateur seulement.
  `DELETE /api/connections/:provider` : supprime le jeton local; l’utilisateur doit aussi révoquer l’autorisation dans les paramètres du réseau.
- Etat de configuration : `GET /api/providers` → `configured: ready|missing-credentials`
  (calcule la presence des IDs, sans jamais exposer les secrets).

## Publication / medias / file
- `POST /api/publish {text, targets, mediaId}` → resultats par destination
  (`published|failed|action-required`), journalises dans `posts`.
  Adaptateurs actuellement limités : X (texte), Facebook Page (texte/image), Instagram (image),
  Threads (texte/image/vidéo), LinkedIn (texte/image), Pinterest (image). Bluesky est bloqué jusqu’à
  l’intégration d’un client OAuth AT Protocol; TikTok exige encore son flow complet Direct Post;
  Twitch refuse le post générique par conception.
- `POST /api/media` (multipart `file`, image JPEG/PNG/WebP/GIF valide ≤ 10 Mo) → `{id, url}`.
  L’URL publique sert aux flux `PULL_FROM_URL` ou `image_url`. L’upload spécifique X, LinkedIn,
  les vidéos X et Pinterest restent hors implémentation; l’interface connectée v1 accepte JPEG/PNG ≤ 10 Mo.
- `POST /api/scheduled {text, targets, mediaId, runAtUTC}` → job UTC idempotent
  (cle = auteur+texte+cibles+media ; doublon retourne `{deduped:true}`),
  `GET /api/scheduled`, `DELETE /api/scheduled/:id` (annulation si `queued`). Les retries
  sont suivis par destination dans un seul processus; le fichier JSON n’est pas un verrou distribué.
  Worker 15 s : tentatives independantes par destination, backoff 2/10/30/120 min, max 5 essais.
- Les médias expirent après 30 jours. `DELETE /api/account` efface les données serveur après confirmation du mot de passe; les consentements sociaux doivent aussi être révoqués chez chaque fournisseur.

## App reviews — aide-memoire
`GET /api/review-checklist`. Details par fournisseur :
- Meta (IG/FB/Threads) : app + cas d’usage Threads, compte Pro IG, Page FB + rôles,
  screencast, compte test, URLs confidentialité/suppression (les pages statiques du frontend doivent être publiées et finalisées).
- LinkedIn : produit Community Management, `w_organization_social`, admin Page approbateur.
- X : budget/quotas verifies avant de batir.
- TikTok : audit obligatoire (sinon posts prives), `video.publish`.
- Pinterest : `pins:write` + `boards:read`, redirect exacte, tableau choisi par Pin.
- Twitch : scope selon l action retenue (`clips:edit`), contraintes stream/VOD.
- Bluesky : OAuth AT Protocol sur le PDS, pas de mot de passe partage.

## Pages légales (revues + callbacks)
`GET /api/legal/privacy|terms|deletion` (FR). Les pages publiques statiques `privacy.html`, `terms.html` et `deletion.html` sont aussi publiées à la racine du frontend et liées depuis la barre latérale. Ce sont des brouillons : compléter l’identité légale, les contacts, les durées réelles, les prix et les autres champs indiqués avant de les utiliser comme URL officielles dans les consoles développeur ou de vendre le service.

## Limites actuelles

- Le `index.html` peut appeler le backend configuré pour OAuth Instagram/LinkedIn/Facebook, téléverser une image et demander une publication ou programmation. C’est un pilote; les chemins doivent encore être validés avec de vrais comptes développeur et comptes sociaux. Le mode local manuel reste disponible.
- Le stockage JSON et le worker conviennent uniquement à une démonstration mono-instance.
- Le backend Express ne se déploie pas tel quel dans un Worker Cloudflare. Le stockage JSON et le worker doivent être remplacés avant tout usage payant.
- La révocation distante d’un consentement OAuth n’est pas automatisée; l’utilisateur doit retirer Klirline dans les paramètres du réseau.
- Le nom légal de l’exploitant et l’adresse de confidentialité doivent être renseignés avant la production.
- Les pages légales statiques contiennent des champs à compléter et portent `noindex`; ne pas les considérer comme des politiques validées ni les soumettre comme pages officielles avant finalisation.
- OAuth ne se valide qu’avec les identifiants et comptes de test réels. Les accès Meta/LinkedIn/X/Pinterest/TikTok, la Page Facebook, l’organisation LinkedIn et le board Pinterest doivent être configurés.
