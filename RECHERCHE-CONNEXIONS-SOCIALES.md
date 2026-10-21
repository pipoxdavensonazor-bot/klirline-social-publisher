# Revue et recherche : connexions sociales Klirline

**Date de vérification : 20 octobre 2026**  
**Objectif :** connecter les neuf profils Klirline fournis, choisir les destinations et publier depuis une seule interface.

## Conclusion

Le produit souhaité est faisable pour plusieurs réseaux, mais les liens publics fournis ne suffisent pas à connecter les comptes. Chaque plateforme doit confirmer que le propriétaire du compte autorise l’application à agir. L’expérience peut rester simple pour Klirline : bouton **Connecter**, connexion chez le réseau, écran de consentement, retour dans l’application. La partie technique utilise tout de même OAuth et les API officielles en arrière-plan.

Il ne faut pas demander ni stocker les mots de passe des réseaux. Il ne faut pas non plus automatiser le navigateur connecté pour contourner les règles des plateformes : ce mécanisme est fragile et peut compromettre les comptes. Le frontend actuel est un prototype local, pas encore une application OAuth.

## Revue de l’application actuelle

Le projet contient une page statique `index.html`. Elle sert à présenter l’éditeur, mais ne réalise aucune connexion d’identité.

| Constat | Effet actuel | Travail nécessaire |
|---|---|---|
| Cinq réseaux seulement dans l’interface | Threads, Pinterest, Bluesky et Twitch manquent | Ajouter les neuf intégrations et leurs états propres |
| Les profils entrés sont stockés dans `localStorage` | Le profil n’est ni vérifié ni connecté; les données restent sur ce navigateur | Créer une session utilisateur et enregistrer des connexions vérifiées côté serveur |
| Les URL de profil sont enregistrées, mais non utilisées pour authentifier ou publier | N’importe qui peut saisir un lien; aucun droit de publication n’est accordé | Remplacer ce champ par un vrai flux « Connecter avec … » |
| Le bouton « Publier maintenant » copie le texte et ouvre des pages génériques | Aucune publication ni confirmation de succès n’a lieu | Envoyer le contenu au serveur, traiter chaque réseau, enregistrer les ID et erreurs |
| La programmation ajoute une entrée locale datée de demain | Rien ne s’exécute à l’heure indiquée | Ajouter une base de données et un ordonnanceur serveur/queue |
| Le média est seulement affiché dans l’aperçu du navigateur | Le fichier n’est pas envoyé aux réseaux; une URL locale n’est pas accessible par leurs serveurs | Stockage objet privé/public contrôlé, conversions et upload selon les exigences de chaque API |
| Tout le code est dans le navigateur et s’ouvre par `file://` | Pas de domaine HTTPS, callback OAuth, secrets ou traitement serveur | Héberger l’application sur HTTPS et ajouter une API backend |

## Capacités par profil fourni

Les URL de profils ne permettent pas de déduire le type interne du compte, les rôles d’administrateur, les limites publicitaires ou le consentement déjà accordé. Le tableau ci-dessous indique la voie documentée et les contrôles à faire lors de la connexion.

| Réseau et profil | Publication officielle | Préconditions / vérifications | Priorité proposée |
|---|---|---|---|
| **Instagram** — `@klirlineofficial` | Oui. API Instagram avec connexion Instagram ou connexion Facebook; publication de médias prise en charge. | Le compte doit être **Professionnel** (Business ou Creator). Selon le flux, utiliser le login Instagram Business et la permission de publication Instagram (`instagram_business_content_publish`), ou relier un compte professionnel à une Page Facebook et obtenir les permissions Page/Instagram requises. Vérifier le type de compte et le jeton au retour OAuth. | P1 |
| **Facebook** — URL `/people/KlirlineOfficial/...` | Oui pour une **Page** administrée avec l’API Pages; ce lien `/people/` ressemble à un profil/personne plutôt qu’à une Page. | Confirmer dans Facebook si la destination est une Page « KlirlineOfficial » et si la personne qui connecte a le rôle/tâche de création de contenu. La publication API de Page utilise un jeton Page et l’accès correspondant. Si c’est un profil personnel, ne pas promettre une publication API de profil; créer ou sélectionner une Page Klirline. | P1 — vérifier le type avant de développer |
| **LinkedIn** — Page d’entreprise `Klirline Inc.` | Oui. Posts API pour une organisation. | Le membre qui autorise doit pouvoir administrer la Page ou détenir un rôle autorisé (par ex. ADMINISTRATOR, CONTENT_ADMIN ou DIRECT_SPONSORED_CONTENT_POSTER). La permission d’écriture d’organisation (`w_organization_social`) et l’accès produit Community Management doivent être disponibles pour l’app. L’ID organisation doit être découvert/choisi après OAuth, pas repris aveuglément de l’URL. | P1 — accès LinkedIn potentiellement soumis à approbation |
| **X** — `@klirlineOffice` | Oui via `POST /2/tweets`, avec OAuth utilisateur et permission d’écriture. | Créer un projet/app X Developer, enregistrer le callback OAuth (PKCE est adapté au parcours web avec backend), demander seulement les scopes nécessaires, dont écriture des posts. Vérifier le plan et les coûts d’accès du compte développeur avant de bâtir : tarifs et quotas sont pilotés par X et peuvent évoluer. | P2 — vérifier budget/quota |
| **Threads** — `@klirlineofficial` | Oui. L’API Threads permet les posts texte, image, vidéo et carrousel via création puis publication, selon le format. | Créer une app Meta avec le cas d’usage Threads, activer OAuth/redirect URI, obtenir la permission `threads_content_publish` et l’autorisation de l’utilisateur. Tester les formats et le cycle d’expiration/renouvellement du jeton. | P1 |
| **Pinterest** — `@klirlineofficial` | Oui. API v5 permet de créer des Pins/boards avec les scopes d’écriture adaptés. | Compte développeur/app Pinterest approuvé et accès API; OAuth code grant avec redirect URI exacte. Pour publier un Pin, demander `pins:write`; pour choisir une destination/board, lire les boards avec `boards:read`. Le profil public seul ne fournit ni le jeton ni les IDs de board. | P2 |
| **Bluesky** — `klirlineofficial.bsky.social` | Oui. AT Protocol permet de créer un record `app.bsky.feed.post`; les médias nécessitent l’envoi de blobs et leur intégration dans le record. | Préférer OAuth AT Protocol aux mots de passe. L’authentification et l’écriture se font sur le PDS de l’utilisateur. Prévoir la gestion des handles/DID, sessions, expiration et consentement; si une méthode de transition par mot de passe d’application est évaluée, la traiter comme secret et demander une validation explicite de sécurité avant de l’adopter. | P2 — bon candidat pour prototype technique |
| **TikTok** — `@klirlineofficial` | Oui via Content Posting API, pour vidéo et désormais photo. | App TikTok Developer, produit Content Posting, OAuth, scope `video.publish`, approbation de la portée et consentement du créateur. Les comptes et réglages de confidentialité disponibles doivent être affichés à l’utilisateur. Le média servi par URL exige un domaine/URL préalablement vérifié; sinon utiliser l’upload fichier. **Sans audit de l’app, les posts API restent privés** : l’audit est donc un préalable au lancement public. | P2/P3 — app review/audit obligatoire pour visibilité publique |
| **Twitch** — `twitch.tv/klirlineofficial` | Pas d’équivalent à un fil de posts sociaux génériques dans l’API consultée. Twitch API couvre plutôt l’identité, les streams, le chat, les annonces, les clips et les vidéos. | Décider ce que « publier sur Twitch » signifie : créer un clip d’un live (scope `clips:edit` et contraintes de stream/VOD), envoyer une annonce dans le chat (pas une publication de promotion sur le profil), ou gérer la chaîne/stream. Il faut OAuth utilisateur pour les actions de chaîne, enregistrer l’app/redirect, valider les jetons. | P3 — fonctionnalité spécifique Twitch, pas un cross-post générique |

**Résultat réaliste :** huit destinations peuvent être étudiées pour une forme de publication sociale, sous réserve des types de compte et examens d’app. Twitch est différent : il ne faut pas le présenter comme un neuvième canal de publication universel. Le Facebook `/people/` est le principal point bloquant à clarifier.

## Ce que signifie « sans API » dans le parcours utilisateur

Si l’objectif est que Klirline n’ait pas à créer de jetons ou à copier des clés, c’est possible : l’application peut gérer l’inscription développeur et l’OAuth en coulisses, puis l’utilisateur clique **Connecter**, se connecte directement chez Meta/X/LinkedIn/etc. et accorde des permissions précises.

Si « sans API » signifie qu’aucun appel API ni mécanisme officiel n’est utilisé, alors une publication automatique multi-réseaux n’est pas possible. Un lien de profil n’est pas une autorisation de publication. L’alternative sans API est un assistant manuel : copier le texte, ouvrir chaque site, ajouter le média et cliquer Publier sur chaque plateforme.

## Architecture minimale pour la version réelle

1. **Déployer une web app HTTPS** avec domaine stable, page confidentialité, conditions, suppression des données et URLs de callback OAuth.
2. **Ajouter comptes utilisateurs et permissions** pour séparer Klirline des futurs clients, même si le premier usage est mono-entreprise.
3. **Créer une intégration par fournisseur** avec bouton OAuth, `state` anti-CSRF, scopes minimaux et retour qui vérifie le compte/organisation obtenu.
4. **Backend de connexion** : échanger le code OAuth côté serveur; ne jamais exposer les secrets client ni stocker les access/refresh tokens dans `localStorage` ou le navigateur. Chiffrer les jetons au repos, limiter l’accès, renouveler/révoquer et auditer les connexions.
5. **Service de publication** : modèle commun du post, adaptateurs distincts par réseau, règles de longueur/média, prévalidation, tentatives indépendantes par destination, retries prudents et statut par réseau (`en attente`, `publié`, `échec`, `action requise`).
6. **Médias** : accepter les formats, tailles, ratios et URLs par destination; conserver temporairement en stockage sécurisé; supprimer selon politique. Instagram/Threads/Pinterest/TikTok peuvent exiger une URL publique récupérable ou un protocole d’upload particulier.
7. **Programmation réelle** : persister la date en UTC, traiter avec une queue serveur, gérer les fuseaux, jetons expirés, modifications, annulations et idempotence pour ne pas poster deux fois.
8. **App review et conformité** : descriptions d’usage, screencast/compte de test si demandé, politique de confidentialité, instructions de suppression et revue fournisseur. Les accès/permissions précis varient avec le mode développement/production et la catégorie d’app.
9. **Interface** : connecter/déconnecter chaque compte, montrer le nom obtenu par OAuth, choisir les cibles (Page/organisation/board), indiquer les capacités médias par réseau, proposer adaptation de texte et confirmer le résultat après chaque envoi.

## Informations Klirline à confirmer avant de coder les connexions

- Instagram : compte Professionnel ou personnel? Business ou Creator? Une Page Facebook est-elle déjà liée si le flux Meta choisi l’exige?
- Facebook : la destination est-elle bien un profil personnel ou existe-t-il une Page d’entreprise Klirline? Qui a le contrôle complet de cette Page?
- LinkedIn : qui est administrateur de la page entreprise et peut approuver l’accès de l’application?
- Pour les neuf comptes : qui peut se connecter et donner le consentement OAuth? Aucun mot de passe ne doit être partagé ici.
- Public attendu : uniquement les comptes Klirline internes (mode de test) ou d’autres entreprises clientes (app publique, examens élargis)?
- Contenu visé : texte seul, images, vidéos, carrousels, stories/reels? Les formats ne sont pas identiques partout.
- Programmation : publication immédiate seulement ou date/heure, fuseau horaire et calendrier?
- Twitch : voulez-vous publier des clips, envoyer des annonces de chat ou simplement afficher le lien de la chaîne?
- X : confirmer qu’un budget/API tierce est accepté après consultation des conditions actuellement offertes dans Developer Console.

## Sources officielles consultées

- Instagram API de Meta (workspace documentaire officiel) : https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api
- Instagram API avec connexion Instagram, permissions et publication : https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api?entity=request-23987686-894be833-d0b6-4877-859e-c61ae6474d64
- Threads API officiel Meta (OAuth, permissions, publication) : https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api
- Facebook API officiel Meta (jetons de Page) : https://www.postman.com/meta/facebook/documentation/r56bjfd/facebook-api
- LinkedIn Posts API : https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api
- LinkedIn Community Management migration/access : https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-api-migration-guide
- X Create Posts : https://docs.x.com/x-api/posts/create-post
- Pinterest OAuth scopes : https://developer.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/
- Pinterest create/manage boards and Pins : https://dev.pinterest.com/docs/work-with-organic-content-and-users/create-boards-and-pins/
- Bluesky create a post : https://docs.bsky.app/docs/tutorials/creating-a-post
- Bluesky account management and OAuth : https://docs.bsky.app/blog/account-management
- TikTok Content Posting API get started : https://developers.tiktok.com/docs/en/content-posting-api-get-started
- TikTok Direct Post reference/audit limitations : https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post
- Twitch API reference (actions réellement proposées) : https://dev.twitch.tv/docs/api/reference
- Twitch authentication and OAuth : https://dev.twitch.tv/docs/authentication
- Twitch create clips : https://dev.twitch.tv/docs/api/clips/

