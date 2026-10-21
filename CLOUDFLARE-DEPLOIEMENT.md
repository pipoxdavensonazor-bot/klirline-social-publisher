# Déploiement du prototype Klirline Social

## État actuel

Le dépôt contient le frontend statique (`index.html`), l’ancien backend Node/Express (`klirline-social-backend/`) et une première API Cloudflare Workers (`cloudflare-api/`). Le frontend peut appeler les routes de l’API après configuration de l’URL. L’API Cloudflare est un pilote non déployé et non vérifié avec des comptes réels; ne pas l’annoncer comme service commercial prêt.

## Frontend sur Cloudflare Pages

Créer un projet Pages depuis le dépôt GitHub et choisir **Direct Upload / Pages Git integration** selon la configuration Cloudflare. Pour Git integration :

- Framework preset : `None`
- Build command : laisser vide
- Build output directory : `.`
- Root directory : `/`

Le site est constitué de `index.html` et des fichiers statiques à la racine (`privacy.html`, `terms.html`, `deletion.html`). Les changements poussés sur la branche configurée déclencheront les déploiements automatiques Pages. Ces pages légales sont des brouillons avec des champs de l’exploitant à remplir; elles ne doivent pas être présentées comme textes définitifs.

## API Cloudflare (pilote à installer)

Le backend Express de `klirline-social-backend/` reste une référence locale et ne doit pas être exposé aux clients. Une première API compatible Workers se trouve maintenant dans `cloudflare-api/`: D1 conserve comptes, connexions chiffrées, publications, programmation et limites d’authentification; R2 conserve les images; un Cron Worker traite les programmations. Le code n’est pas encore déployé ni vérifié avec de vrais comptes sociaux.

Depuis `cloudflare-api/`, préparez les ressources dans votre compte Cloudflare :

1. Installer les outils du projet avec `npm install`.
2. Créer la base D1 : `npx wrangler d1 create klirline-social`. Copier l’identifiant retourné dans `wrangler.jsonc` à la place de `REPLACE_WITH_D1_DATABASE_ID`.
3. Créer le bucket R2 : `npx wrangler r2 bucket create klirline-social-media`.
4. Appliquer la migration : `npx wrangler d1 migrations apply klirline-social --remote`.
5. Créer les secrets avec `npx wrangler secret put SESSION_SECRET`, puis répéter pour `BOOTSTRAP_ADMIN_KEY`, `TOKENS_ENCRYPTION_KEY_HEX`, `META_APP_SECRET` et `LINKEDIN_CLIENT_SECRET`. Utilisez des valeurs uniques et aléatoires (clé de chiffrement : 64 caractères hexadécimaux). Ne les mettez pas dans `wrangler.jsonc`, GitHub ou le frontend.
6. Dans `wrangler.jsonc`, remplacer les domaines d’exemple et configurer `FRONTEND_ORIGIN`, `PUBLIC_BASE_URL`, les IDs d’apps, les callbacks, l’URN LinkedIn et, si une vraie Page existe, son ID Facebook. Le parcours LinkedIn demande `r_organization_admin` et `w_organization_social`, puis exige que le membre soit administrateur approuvé de l’organisation configurée avant d’enregistrer la connexion. Ce contrôle strict correspond à la portée actuelle du droit `r_organization_admin`. Le frontend doit viser l’URL publique de ce Worker dans Préférences → Backend et compte.
7. Déployer avec `npx wrangler deploy`, puis attacher un domaine personnalisé à l’API dans Cloudflare et enregistrer les callbacks OAuth exacts auprès de Meta et LinkedIn.

Pour travailler localement, copier `cloudflare-api/.dev.vars.example` vers `.dev.vars`, remplacer les valeurs, puis exécuter `npx wrangler d1 migrations apply klirline-social --local` et `npm run dev`. Ne jamais committer `.dev.vars`.

Les parcours automatisés de l’API peuvent être exécutés avant déploiement depuis `cloudflare-api/` avec `node --test`. Ils couvrent l’authentification, le stockage simulé, la programmation et son Cron, l’idempotence, la suppression de compte, les requêtes de publication pour les trois adaptateurs, le renouvellement LinkedIn et la vérification d’accès LinkedIn, y compris un échec partiel dû à une limite de débit. Le contrôle `/api/health` vérifie également qu’une requête D1, un accès R2 et les secrets requis fonctionnent. Les tests utilisent SQLite local, un faux bucket R2 et des réponses fournisseur simulées; ils ne remplacent pas les essais avec de vrais comptes ou Cloudflare.

Le workflow GitHub Actions `.github/workflows/ci.yml` exécute ces tests et les contrôles de syntaxe sur chaque push et pull request. Il ne déploie pas l’application et n’utilise aucun secret de production.

Cette première version ne couvre que la publication texte/image limitée à Instagram professionnel, Page Facebook et Page LinkedIn. X, Threads, Pinterest, TikTok, Bluesky et Twitch sont indiqués comme hors lancement. Le pilote vise un seul espace Klirline (pas encore un SaaS multi-entreprises). Instagram tente de renouveler automatiquement le jeton avant son expiration. LinkedIn le renouvelle seulement si son échange OAuth a fourni un jeton de renouvellement valide; LinkedIn réserve les jetons de renouvellement programmatiques aux partenaires MDP approuvés, et sans jeton valide le poste demande une reconnexion. Facebook utilise un jeton de Page et demandera un nouveau consentement si le fournisseur le rejette. La sélection interactive de plusieurs Pages/organisations, la facturation, les invitations membres, la révocation OAuth distante, les sauvegardes, la supervision et les procédures d’incident restent à construire/configurer. Obtenir aussi les accès développeur et les revues exigées par chaque réseau. Ne la commercialisez pas tant que les parcours avec de vrais comptes ne sont pas validés.

## Origines, cookies et domaines

Dans le backend, `FRONTEND_ORIGIN` doit être l’origine exacte du site (schéma + domaine, sans chemin ni barre oblique finale), par exemple `https://app.klirline.com`. `PUBLIC_BASE_URL` doit être l’origine HTTPS exacte de l’API. Pour que la session par cookie fonctionne de façon fiable, configurez de préférence frontend et API sous le même domaine de premier niveau, par exemple `app.klirline.com` et `api.klirline.com`. Des domaines séparés comme `workers.dev` et `pages.dev` peuvent être bloqués comme cookies tiers par certains navigateurs.

Les pages statiques sont servies par Cloudflare Pages. Le backend Express de référence, son stockage JSON et son worker ne peuvent pas être déployés tels quels comme Worker Cloudflare. Configurez l’URL API vers le Worker de `cloudflare-api/`, pas vers le site Pages lui-même.

Ne jamais committer `.env`, jetons OAuth, secrets JWT/chiffrement, clés d'applications ni données de comptes. Les secrets de production doivent être configurés dans le tableau de bord de la plateforme.
