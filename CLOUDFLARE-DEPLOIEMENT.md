# Déploiement du prototype Klirline Social

## État actuel

Le dépôt contient le frontend statique (`index.html`), l’ancien backend Node/Express (`klirline-social-backend/`) et l’API Cloudflare Workers (`cloudflare-api/`). Klirline Social Publisher est un outil interne, pas un service vendu. L’API reste un pilote non déployé et non vérifié avec les comptes réels.

**Contrôle Cloudflare en lecture seule — 21 octobre 2026 :** le Worker `klirline-social-publisher` en production sert uniquement des actifs statiques; le tableau indique 100 % du trafic sur le déploiement `c880d057`, construit depuis `main` (commit `6cd0334`). Les réglages signalent que les variables, secrets, liaisons D1/R2 et déclencheurs ne sont pas disponibles pour ce Worker statique. Dans la liste Workers observée, aucun service `klirline-social-api` n’apparaît. Le code de la branche `commercial-readiness` n’est donc pas le code de production, et les fonctions de connexion/publication API ne peuvent pas être considérées opérationnelles tant qu’un Worker API séparé n’est pas créé, configuré et testé.

## Frontend — Worker Static Assets

Le service `klirline-social-publisher` est relié à Workers Builds. Le dépôt fournit maintenant `wrangler.jsonc` à sa racine; `npm run build` copie une liste limitée de fichiers publics vers `site/`, et `npm run deploy` déploie ce dossier au moyen de `wrangler deploy`.

Dans **Workers & Pages → klirline-social-publisher → Settings → Builds**, utiliser :

- Repository : `pipoxdavensonazor-bot/klirline-social-publisher`
- Production branch : `main`
- Preview branch de travail : `commercial-readiness` (laisse les builds de cette branche dans les aperçus, sans modifier le Worker de production)
- Root directory : `/`
- Build command : `npm run build`
- Deploy command : `npm run deploy`
- Preview command : `npx wrangler preview` (pour les branches de prévisualisation seulement)

Un build antérieur échouait lorsque `npx wrangler preview` était configuré comme commande de déploiement; cette commande crée une prévisualisation et ne met pas le site en production. Garder `npm run deploy` pour les déploiements frontend et `npx wrangler preview` uniquement pour les aperçus. Vérifier dans le tableau de bord l’état du build avant de considérer une version publiée. Ne pas remplacer le Worker frontend par la configuration API de `cloudflare-api/`.

## API Cloudflare (pilote à installer)

Le backend Express de `klirline-social-backend/` reste une référence locale et ne doit pas être exposé. L’API Workers de `cloudflare-api/` utilise D1, R2 et un Cron Worker. Le mode interne (`INTERNAL_MODE=true`) désactive les abonnements et garde l’inscription publique fermée. L’API n’est pas encore déployée ni vérifiée avec de vrais comptes sociaux.

Depuis `cloudflare-api/`, préparez les ressources dans votre compte Cloudflare :

### Lier GitHub à un Worker sans remplacer le site existant

Le site public et l’API sont deux projets de déploiement distincts. Le Worker du site s’appelle `klirline-social-publisher`; la configuration de l’API déclare `klirline-social-api`. **Ne changez pas la racine ni la commande du Worker existant pour pointer vers `cloudflare-api/`** : cela pourrait remplacer le service qui sert le site.

Pour connecter le dépôt à l’API, créez un nouveau service **Workers Builds** dans Cloudflare, relié au même dépôt GitHub, avec ces paramètres :

- Root directory : `cloudflare-api`
- Build command : `pnpm install --frozen-lockfile` (installe les dépendances exactes, dont `twitter-text`, utilisé pour valider les textes X)
- Deploy command : `pnpm exec wrangler deploy`
- Nom du Worker : `klirline-social-api`, identique à `name` dans `wrangler.jsonc`
- Branche de production : la branche choisie pour les mises en production; utilisez la branche de travail seulement si vous voulez explicitement y déployer

Configurez les secrets et ressources Cloudflare pour ce nouveau Worker avant le premier déploiement. Laissez le Worker frontend `klirline-social-publisher` à la racine `/` avec `npm run build` et `npm run deploy`; il ne doit pas publier le Worker API. Après déploiement, mettez l’URL HTTPS de l’API dans **Préférences → Backend et compte** sur le site, puis vérifiez `/api/health`. Les noms exacts des champs du tableau de bord peuvent évoluer; contrôlez la configuration avant d’enregistrer. Documentation Cloudflare : [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) et [troubleshooting](https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/).

1. Depuis `cloudflare-api/`, installer les outils du projet avec `pnpm install --frozen-lockfile`.
2. Créer la base D1 : `npx wrangler d1 create klirline-social`. Copier l’identifiant retourné dans `wrangler.jsonc` à la place de `REPLACE_WITH_D1_DATABASE_ID`.
3. Créer le bucket R2 : `npx wrangler r2 bucket create klirline-social-media`.
4. Appliquer les migrations : `pnpm exec wrangler d1 migrations apply klirline-social --remote`.
5. Créer les secrets avec `npx wrangler secret put SESSION_SECRET`, puis répéter pour `BOOTSTRAP_ADMIN_KEY`, `TOKENS_ENCRYPTION_KEY_HEX`, `META_APP_SECRET`, `LINKEDIN_CLIENT_SECRET`, `THREADS_APP_SECRET`, `X_CLIENT_SECRET` et `PINTEREST_APP_SECRET`. Utilisez des valeurs uniques et aléatoires (clé de chiffrement : 64 caractères hexadécimaux). Ne les mettez pas dans `wrangler.jsonc`, GitHub ou le frontend.
6. Garder `INTERNAL_MODE=true`, `ALLOW_PUBLIC_SIGNUP=false` et `REQUIRE_APPROVED_DRAFTS=true`. Le premier administrateur est créé avec `BOOTSTRAP_ADMIN_KEY`; aucun compte de paiement n’est requis. Appliquer toutes les migrations jusqu’à 0014 avant d’inviter l’équipe et d’utiliser les brouillons de campagne partagés.
   Les plafonds par défaut sont opérationnels et non commerciaux : `WORKSPACE_MAX_CONNECTED_ACCOUNTS=100` et `WORKSPACE_MONTHLY_PUBLICATION_CAP=5000`. Ajustez-les dans `wrangler.jsonc` si le volume mondial de l’équipe l’exige.
7. Dans `wrangler.jsonc`, remplacer les domaines d’exemple et configurer `FRONTEND_ORIGIN`, `PUBLIC_BASE_URL`, les IDs d’apps, les callbacks, l’URN LinkedIn et, si une vraie Page existe, son ID Facebook. Créer une app Meta avec le cas d’usage Threads, puis renseigner `THREADS_APP_ID` et son secret Cloudflare. Pour X, configurer une app de type Web App/Automated App (client confidentiel), activer OAuth 2.0, enregistrer le callback `/oauth/x/callback`, renseigner `X_CLIENT_ID` dans les variables et le secret `X_CLIENT_SECRET` dans Cloudflare; le code applique PKCE et les scopes de lecture de profil, publication, média et renouvellement. Pour Pinterest, créer l’app, enregistrer exactement `/oauth/pinterest/callback`, ajouter `PINTEREST_APP_ID` dans `wrangler.jsonc` et `PINTEREST_APP_SECRET` comme secret Cloudflare. Les scopes demandés sont `boards:read` et `pins:write`; l’administrateur sélectionne ensuite le tableau de destination dans Comptes sociaux. Le parcours LinkedIn demande `r_organization_admin` et `w_organization_social`, puis vérifie que le membre possède un rôle approuvé lui permettant de publier sur l’organisation configurée (administrateur, gestionnaire de contenu ou publication directe). L’application Klirline garde ses propres connexions sociales réservées à ses administrateurs. Le frontend doit viser l’URL publique de ce Worker dans Préférences → Backend et compte.
8. Déployer avec `pnpm exec wrangler deploy`, puis attacher un domaine personnalisé à l’API dans Cloudflare et enregistrer les callbacks OAuth exacts auprès de Meta (Instagram/Facebook), LinkedIn, Threads, X et Pinterest. Pour Bluesky, vérifier que l’URL publique `https://<domaine-api>/oauth/bluesky/client-metadata.json` est accessible avec un certificat HTTPS valide; les métadonnées doivent annoncer `https://<domaine-api>/oauth/bluesky/callback` comme URI de redirection. Bluesky n’utilise pas de secret d’application partagé; le Worker exige le domaine HTTPS public et les tables D1 de la migration 0013.

Pour travailler localement, copier `cloudflare-api/.dev.vars.example` vers `.dev.vars`, remplacer les valeurs, puis exécuter `pnpm exec wrangler d1 migrations apply klirline-social --local` et `pnpm dev`. Ne jamais committer `.dev.vars`.

Les parcours automatisés de l’API peuvent être exécutés avant déploiement depuis `cloudflare-api/` avec `node --test`. Ils couvrent l’authentification, le changement de mot de passe et l’invalidation des anciennes sessions, le stockage simulé, la programmation et son Cron, l’idempotence, les invitations et rôles d’équipe, le flux d’approbation, le partage des brouillons et médias, six adaptateurs de publication, le renouvellement Instagram/Threads/LinkedIn/X, Bluesky metadata/handle et la vérification des accès Meta/LinkedIn. Le contrôle `/api/health` vérifie également qu’une requête D1, un accès R2 et les secrets requis fonctionnent. Les tests utilisent SQLite local, un faux bucket R2 et des réponses fournisseur simulées; ils ne remplacent pas les essais OAuth/publication avec de vrais comptes ou Cloudflare.

Le workflow GitHub Actions `.github/workflows/ci.yml` exécute ces tests et les contrôles de syntaxe sur chaque push et pull request. Il ne déploie pas l’application et n’utilise aucun secret de production.

### Prévol et mise en service

Depuis la racine du dépôt, lancez `node scripts/cloudflare-preflight.mjs`. Le script vérifie les marqueurs de configuration et rappelle les étapes qui nécessitent votre compte; il n’accède pas à Cloudflare et ne prouve pas qu’un déploiement fonctionne.

Ordre de mise en service recommandé :

1. Vérifier que le Worker frontend sert bien les fichiers publics attendus. Les changements poussés sur `commercial-readiness` ne remplacent pas la production tant qu’ils ne sont pas promus selon le workflow Cloudflare choisi.
2. Créer la base D1 et le bucket R2. Remplacer l’ID D1 factice dans `cloudflare-api/wrangler.jsonc` par l’identifiant retourné; ne déployer aucun Worker avec le placeholder.
3. Choisir les domaines HTTPS maîtrisés par Klirline, puis configurer `FRONTEND_ORIGIN`, `PUBLIC_BASE_URL`, les variables OAuth/callbacks et les secrets Cloudflare. Enregistrer les mêmes URL de callback dans chaque console fournisseur.
4. Depuis `cloudflare-api/`, appliquer toutes les migrations distantes jusqu’à 0014 avec `npx wrangler d1 migrations apply klirline-social --remote`, puis déployer le Worker API avec `npx wrangler deploy`. La migration 0013 ajoute les tables de session OAuth Bluesky; 0014 ajoute le texte alternatif des médias. Vérifier le résultat de `/api/health` après migration.
5. Vérifier `/api/health` après déploiement; une réponse saine doit confirmer D1, schéma, R2 et secrets. Configurer l’URL HTTPS de l’API dans Préférences → Backend et compte, puis créer le premier administrateur avec la clé bootstrap.
6. Vérifier connexion, changement de mot de passe, invitations, rôles, partage de comptes, approbation, média, programmation, annulation et traitement Cron sans envoi public. Puis connecter les comptes de développeur et valider chaque réseau avec un compte/Page de test et une publication contrôlée.
7. Garder l’accès réservé à l’équipe; dans Préférences → Membres de l’équipe, inviter les collègues avec des liens à usage unique. Avant usage régulier, mettre en place sauvegardes D1, essai de restauration, alertes, responsable support et procédures de réauthentification, révocation et panne de publication.

Le nom de l’exploitant fourni est Klirline Inc. Klirline Social est un outil interne de promotion, sans vente, abonnement ni paiement. Les migrations historiques portant des noms de facturation ne créent pas de parcours de paiement et ne sont pas utilisées comme exigence d’accès dans le mode interne. Les pages de confidentialité et suppression doivent toujours refléter les traitements réels et les exigences des plateformes; le statut de Page professionnelle Facebook n’est pas confirmé. L’adresse fournie est « 10948 Av Rome, H1H 4P4, Canada »; vérifier qu’elle est complète pour les avis légaux.

Cette version couvre la publication texte/image vers Instagram professionnel, Page Facebook, Page LinkedIn, Threads, X, Pinterest et Bluesky. Bluesky utilise OAuth officiel et des sessions chiffrées en D1; il accepte une image JPEG/PNG jusqu’à 2 Mo, avec texte alternatif obligatoire. L’adaptateur X utilise OAuth 2.0 avec PKCE, renouvellement de jeton et images JPEG/PNG jusqu’à 5 Mo. Pinterest permet de choisir un tableau et publie des images JPEG/PNG via une URL publique; les vidéos ne sont pas prises en charge. TikTok reste manuel selon les limites de l’API pour les outils internes; Twitch n’est pas un canal de publication générique. Les migrations 0008 à 0014 et l’API gèrent les invitations, les rôles rédacteur/lecteur, la révocation d’accès, le partage des connexions, médias, publications, programmations et brouillons, un journal d’activité, le fuseau IANA, les métadonnées pays/langue, les sessions OAuth Bluesky et le texte alternatif. Avec `REQUIRE_APPROVED_DRAFTS=true`, toute publication API ou programmation automatique exige le contenu exact d’un brouillon partagé approuvé; un envoi partiel demande une nouvelle correction et relecture. Les profils manuels restent à confirmer directement sur le réseau. Le mode interne garde l’inscription publique fermée. Les limites sont configurées à 100 comptes et 5 000 publications mensuelles. Les fournisseurs dépendent toujours de leurs accès développeur, permissions et validations d’application. Les essais avec les comptes réels, les sauvegardes et la supervision opérationnelle restent à faire.

## Origines, cookies et domaines

Dans le backend, `FRONTEND_ORIGIN` doit être l’origine exacte du site (schéma + domaine, sans chemin ni barre oblique finale), par exemple `https://app.klirline.com`. `PUBLIC_BASE_URL` doit être l’origine HTTPS exacte de l’API. Pour que la session par cookie fonctionne de façon fiable, configurez de préférence frontend et API sous le même domaine de premier niveau, par exemple `app.klirline.com` et `api.klirline.com`. Des domaines séparés comme `workers.dev` et `pages.dev` peuvent être bloqués comme cookies tiers par certains navigateurs.

Les fichiers statiques sont servis par le Worker `klirline-social-publisher`. Le backend Express de référence, son stockage JSON et son worker ne peuvent pas être déployés tels quels comme Worker Cloudflare. Configurez l’URL API vers le Worker de `cloudflare-api/`, pas vers le Worker frontend.

Ne jamais committer `.env`, jetons OAuth, secrets JWT/chiffrement, clés d'applications ni données de comptes. Les secrets de production doivent être configurés dans le tableau de bord de la plateforme.
