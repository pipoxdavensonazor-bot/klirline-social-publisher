# Audit du backend Klirline Social

> **Périmètre actuel :** ce document audite l’ancien backend Node/Express de référence; il ne décrit pas l’implémentation destinée au déploiement. Klirline Social est un outil interne de promotion de Klirline, sans vente, abonnement ni paiement. Pour l’état du pilote Cloudflare Workers, ses sept réseaux pris en charge et ses prérequis de mise en service, consulter le `README.md` et `CLOUDFLARE-DEPLOIEMENT.md` à la racine du dépôt. Aucun des documents de ce dépôt ne confirme un déploiement API ou une publication réelle.

> **Addendum de travail — 21 octobre 2026 :** depuis cet audit, le frontend racine appelle les routes d’authentification, OAuth, publication et programmation lorsque l’URL du serveur est configurée. Les sessions passent maintenant par cookie HTTPOnly/Secure, le premier administrateur demande une clé bootstrap, les écritures navigateur vérifient l’origine, les callbacks Meta sont distincts, les images téléversées sont validées par signature (JPEG/PNG/WebP/GIF, 10 Mo max), les médias expirés sont nettoyés après 30 jours et `DELETE /api/account` efface les données serveur après confirmation du mot de passe. La révocation chez chaque réseau reste manuelle. **Cet addendum ne rend pas le stockage JSON/worker mono-instance apte au commerce et ne remplace pas les essais OAuth ou les revues fournisseurs.** Les constats plus bas sur ces limites restent valides; ceux disant que le frontend n’est pas câblé, que la suppression complète n’existe pas ou qu’aucun nettoyage média n’existe sont remplacés par cet addendum.

> **Addendum — 21 octobre 2026 (pilote Cloudflare) :** `cloudflare-api/` contient une seconde implémentation Cloudflare Workers avec tables D1, stockage image R2, authentification cookie, bootstrap administrateur, limitation d’essais de connexion, OAuth lié par state et cookie, publication immédiate/programmée ciblant Instagram, Page Facebook et Page LinkedIn. Les autres réseaux sont marqués hors périmètre du pilote. Les migrations SQLite ont été appliquées localement, `node --check` valide le Worker et `git diff --check` ne trouve pas d’erreur de patch. **Aucun déploiement Wrangler, essai d’intégration Worker/D1/R2 ni essai OAuth réel n’a eu lieu**; ce pilote n’est donc pas certifié pour la production. La sélection dynamique des Pages/organisations, invitations, récupération de mot de passe, facturation, révocation distante, rotation de jetons, sauvegardes et procédures opérationnelles restent à réaliser.

Date : 21 octobre 2026  
Périmètre : revue statique de l’archive `klirline-social-backend.zip`, sans secrets, sans connexion réelle aux fournisseurs et sans déploiement.

## Verdict

Cette archive est un **prototype de backend**, pas un backend prêt pour la production. J’ai corrigé plusieurs failles simples pendant la revue (inscription après bootstrap, secrets implicites, contrôle média, validation des dates, appels X et retries par destination). Les intégrations restent partielles, le frontend du workspace n’appelle pas ce backend, et les flux réels ne sont pas validés par les comptes fournisseurs.

## Bloqueurs à corriger avant tout déploiement public

### Corrigé — Inscription publique après le bootstrap

`POST /api/auth/register` autorise maintenant le premier compte admin sans session, puis exige un JWT admin pour créer un rédacteur. Le bootstrap reste sensible si plusieurs instances sont lancées avant la création du premier admin; créer ce compte avec une seule instance.

Le client ne choisit pas le rôle. Une gestion d’invitations à usage unique reste à ajouter si les rédacteurs doivent s’inscrire eux-mêmes.

### Corrigé — Secrets de développement implicites

`src/lib.js` valide maintenant JWT et chiffrement au démarrage; les chemins auth/signature n’utilisent plus `"dev"`. En production, HTTPS et l’origine du frontend sont obligatoires. Les valeurs d’exemple doivent être remplacées par des secrets aléatoires.

La validation stricte des identifiants OAuth par fournisseur et des callbacks exacts reste à finir.

### Corrigé — Hôte X et troncature silencieuse

L’adaptateur texte X appelle maintenant `api.x.com` et transmet le texte validé sans le tronquer. L’envoi des médias X reste en `action-required` tant que l’upload chunké n’est pas implémenté.

La réponse fournisseur et le scope doivent encore être vérifiés contre une app X autorisée.

## P1 — Les neuf intégrations ne sont pas fonctionnelles

| Réseau | État observé dans l’archive | Problème |
|---|---|---|
| Instagram | OAuth et publication **image simple** codés | Compte professionnel, app/scopes/consentement requis; médias vidéo et vérification complète du traitement non gérés; URL publique requise. |
| Facebook | OAuth vérifie la Page définie par `FACEBOOK_PAGE_ID`, chiffre son Page token; texte vers `/feed` | Page, rôle et tâche CREATE_CONTENT/MANAGE requis. Le profil `/people/` fourni ne confirme pas de Page. Images/vidéos non gérées. |
| LinkedIn | Publication texte `/rest/posts` codée si `LINKEDIN_ORGANIZATION_URN` et `LINKEDIN_VERSION` sont définis | Accès Community Management et rôle de Page restent externes; upload média absent. |
| X | Publication de texte via `POST https://api.x.com/2/tweets` | Projet, scopes, plan et quotas requis; upload média absent. |
| Threads | Texte/image/vidéo : création container puis `threads_publish` | À valider avec un compte autorisé; traitement asynchrone vidéo et certains formats nécessitent un suivi. |
| Pinterest | Pin image avec `media_source.image_url` | URL d’image accessible et `PINTEREST_DEFAULT_BOARD_ID` requis; choix du board non intégré à l’interface; vidéo absente. |
| Bluesky | Connexion et publication explicitement bloquées | OAuth AT Protocol nécessite un client conforme; ne pas annoncer le fournisseur prêt. |
| TikTok | Profil vérifié; Direct Post retourne `action-required` | UI de choix de confidentialité, domaine vérifié/upload, creator-info, audit et suivi de statut requis. |
| Twitch | Publication générique refusée (comportement correct) | Ce réseau n’est pas un canal de cross-post générique. `clips:edit` permet un cas d’usage de clips, à développer séparément. |

Les adaptateurs ne couvrent pas tous les médias/options. Le backend retourne maintenant `action-required` pour les cas qu’il ne peut pas publier au lieu de prétendre qu’ils ont réussi.

## P1 — L’OAuth ne vérifie pas toujours le compte annoncé

`verifyAccount()` possède maintenant des appels séparés pour Instagram, Facebook, Threads, LinkedIn, X, Pinterest, TikTok et Twitch, et refuse une réponse sans identifiant/nom. Bluesky est bloqué avant OAuth. Facebook exige `FACEBOOK_PAGE_ID` et un rôle Page autorisé; LinkedIn vérifie le membre, mais l’accès d’écriture organisation se configure via l’URN.

La découverte et la sélection interactives de plusieurs Pages, organisations et boards restent à ajouter; pour l’instant Facebook/Pinterest/LinkedIn utilisent la configuration serveur.

## P1 — Queue susceptible de publier deux fois

`src/queue.js` suit maintenant les essais par destination et évite le chevauchement des ticks dans le même processus. Un deuxième processus ou une deuxième instance peut toujours traiter le même job : le stockage JSON ne fournit pas de verrou distribué. Un crash après publication distante et avant persistance peut aussi provoquer un doublon.

Les états et essais par destination sont codés. Pour plusieurs instances, remplacer le tableau JSON par une base transactionnelle et un worker à verrou distribué; classifier les erreurs retryables et utiliser les clés idempotentes fournisseurs lorsqu’elles existent.

La clé d’idempotence inclut maintenant `runAtUTC`; le worker ne peut toujours pas garantir l’idempotence chez le fournisseur en cas de crash au mauvais moment.

## P1 — Contrôle d’accès aux médias insuffisant

Les routes de publication/programmation vérifient maintenant que le média appartient à l’utilisateur. Les médias sont servis publiquement et aucune suppression automatique à 30 jours n’est codée, bien que la politique de confidentialité le promette. Les téléchargements de 100 Mo sont conservés en mémoire.

**Reste à faire :** valider le type réel du fichier, ajouter quota/nettoyage et aligner le texte légal; considérer stockage objet et URLs à durée limitée.

## P1 — Suppression/révocation annoncées, pas implémentées

La route `DELETE /api/connections/:provider` supprime le jeton local avant toute révocation distante (TODO). `GET /api/legal/deletion` ne supprime pas les données. Les comptes, jobs, médias et journaux n’ont pas de route d’effacement.

**Correction :** révoquer le jeton si l’API le permet, puis supprimer localement même si la révocation distante échoue; implémenter une suppression de compte et de médias/jobs, et les callbacks de désautorisation/suppression requis par fournisseur. Publier uniquement des engagements légaux réellement appliqués.

## P1 — Le frontend joint n’est pas câblé au backend

Le `index.html` à la racine conserve le flux local du prototype. Il ne contient aucune configuration URL backend, session JWT, test `/api/health`, connexion OAuth, publication HTTP ou programmation serveur. Les profils restent en `localStorage` et les boutons ouvrent des pages des réseaux.

**Correction :** intégrer l’interface de connexion à ce frontend séparément; stocker une session avec stratégie adaptée (préférer cookie HttpOnly/Secure/SameSite si le modèle est web) et appeler les routes uniquement via HTTPS. Ne pas considérer cette archive backend comme la preuve que le frontend est relié.

## P2 — Autres écarts et robustesse

- `package.json` déclare maintenant `"type": "module"`.
- `providerStatus("bluesky")` signale maintenant qu’un client OAuth AT Protocol est requis; le flux n’est pas implémenté.
- La date programmée doit maintenant respecter le format ISO UTC finissant par `Z`.
- Les cibles doivent maintenant être un tableau et sont dédupliquées.
- `PUBLIC_BASE_URL` doit être HTTPS et public pour que les fournisseurs récupèrent les médias; une validation stricte est imposée en mode production.
- Le JSON DB et les écritures différées par timer peuvent perdre des données lors d’un arrêt. Ce stockage ne convient qu’à une démo mono-instance et disque persistant.
- Aucune limite de débit sur login/inscription ni en-têtes de sécurité; CORS n’autorise maintenant aucune origine si `FRONTEND_ORIGIN` est absent.
- Les textes de confidentialité annoncent la suppression de médias en 30 jours et l’API annonce une suppression planifiée : aucun worker de nettoyage ne le réalise.
- Il n’y a ni validation des formats médias propres à chaque API, ni statut de traitement/confirmation post-publication.

## État de vérification

- Archive inspectée et extraite dans `klirline-social-backend/`.
- `node --check` passe pour les huit modules JavaScript avec le runtime local Node `v24.19.0`.
- `npm` n’est pas disponible dans l’environnement; aucune installation de dépendances ni démarrage réel n’a été effectué. Les intégrations OAuth/API ne peuvent pas être validées sans identifiants de développeur et consentement des comptes.
- Les URLs de callback, clés, app reviews, accès de Page/organisation, domaines médias vérifiés et comptes des réseaux restent des prérequis externes.

## Sources officielles utiles

- X Create Posts (endpoint `api.x.com`) : https://docs.x.com/x-api/posts/create-post
- LinkedIn Posts API et rôles d’organisation : https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
- Pinterest OAuth et scopes : https://developer.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/
- Pinterest création de boards/Pins et `media_source` : https://developer.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/
- Meta Threads API, OAuth et publication : https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api
- Meta Instagram API et distinction comptes professionnels : https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
- TikTok Direct Post, audit et restriction des apps non auditées : https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post
- Bluesky création de post : https://docs.bsky.app/docs/tutorials/creating-a-post
- Twitch API et actions disponibles : https://dev.twitch.tv/docs/api/reference

