# Déploiement du prototype Klirline Social

## État actuel

Le dépôt contient le frontend statique (`index.html`), l’ancien backend Node/Express (`klirline-social-backend/`) et l’API Cloudflare Workers (`cloudflare-api/`). Klirline Social Publisher est un outil interne, pas un service vendu. L’API reste un pilote non déployé et non vérifié avec les comptes réels.

## Frontend sur Cloudflare Pages

Créer un projet Pages depuis le dépôt GitHub et choisir **Direct Upload / Pages Git integration** selon la configuration Cloudflare. Pour Git integration :

- Framework preset : `None`
- Build command : laisser vide
- Build output directory : `.`
- Root directory : `/`

Le site est constitué de `index.html` et des fichiers statiques à la racine (`privacy.html`, `terms.html`, `deletion.html`). Les changements poussés sur la branche configurée déclencheront les déploiements automatiques Pages. Ces pages légales sont des brouillons avec des champs de l’exploitant à remplir; elles ne doivent pas être présentées comme textes définitifs.

### Si le tableau de bord est configuré comme un Worker

Le site racine est du HTML statique et n’a pas de configuration Wrangler pour le servir comme Worker. Pour le publier, configurez Cloudflare Pages comme ci-dessus. Si vous gardez le service Worker existant, ne relancez pas son build avec `npx wrangler preview`: cette commande échoue sans configuration de prévisualisation et ne déploie pas le site. Réservez un service Worker séparé à `cloudflare-api/` et utilisez `npx wrangler deploy`. Avant d’enregistrer une modification, vérifiez que vous êtes dans le projet voulu et que la racine correspondante est affichée.

## API Cloudflare (pilote à installer)

Le backend Express de `klirline-social-backend/` reste une référence locale et ne doit pas être exposé. L’API Workers de `cloudflare-api/` utilise D1, R2 et un Cron Worker. Le mode interne (`INTERNAL_MODE=true`) désactive les abonnements et garde l’inscription publique fermée. L’API n’est pas encore déployée ni vérifiée avec de vrais comptes sociaux.

Depuis `cloudflare-api/`, préparez les ressources dans votre compte Cloudflare :

### Lier GitHub à un Worker sans remplacer le site existant

Le site public et l’API sont deux projets de déploiement distincts. Le Worker du site s’appelle `klirline-social-publisher`; la configuration de l’API déclare `klirline-social-api`. **Ne changez pas la racine ni la commande du Worker existant pour pointer vers `cloudflare-api/`** : cela pourrait remplacer le service qui sert le site.

Pour connecter le dépôt à l’API, créez un nouveau service **Workers Builds** dans Cloudflare, relié au même dépôt GitHub, avec ces paramètres :

- Root directory : `cloudflare-api`
- Build command : vide (ou `npm install` si le tableau de bord exige une commande)
- Deploy command : `npx wrangler deploy`
- Nom du Worker : `klirline-social-api`, identique à `name` dans `wrangler.jsonc`
- Branche de production : la branche choisie pour les mises en production; utilisez la branche de travail seulement si vous voulez explicitement y déployer

Configurez les secrets et ressources Cloudflare pour ce nouveau Worker avant le premier déploiement. Laissez le projet Pages qui sert le frontend à la racine (`/`) avec son répertoire de sortie statique; il ne doit pas publier le Worker API. Après déploiement, mettez l’URL HTTPS de l’API dans **Préférences → Backend et compte** sur le site, puis vérifiez `/api/health`. Les noms exacts des champs du tableau de bord peuvent évoluer; contrôlez la configuration avant d’enregistrer. Documentation Cloudflare : [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) et [troubleshooting](https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/).

1. Installer les outils du projet avec `npm install`.
2. Créer la base D1 : `npx wrangler d1 create klirline-social`. Copier l’identifiant retourné dans `wrangler.jsonc` à la place de `REPLACE_WITH_D1_DATABASE_ID`.
3. Créer le bucket R2 : `npx wrangler r2 bucket create klirline-social-media`.
4. Appliquer la migration : `npx wrangler d1 migrations apply klirline-social --remote`.
5. Créer les secrets avec `npx wrangler secret put SESSION_SECRET`, puis répéter pour `BOOTSTRAP_ADMIN_KEY`, `TOKENS_ENCRYPTION_KEY_HEX`, `META_APP_SECRET` et `LINKEDIN_CLIENT_SECRET`. Utilisez des valeurs uniques et aléatoires (clé de chiffrement : 64 caractères hexadécimaux). Ne les mettez pas dans `wrangler.jsonc`, GitHub ou le frontend.
6. Garder `INTERNAL_MODE=true` et `ALLOW_PUBLIC_SIGNUP=false`. Le premier administrateur est créé avec `BOOTSTRAP_ADMIN_KEY`; Stripe, un prix et un webhook ne sont pas requis pour l’outil interne. Appliquer toutes les migrations, dont 0008, avant d’inviter l’équipe.
7. Dans `wrangler.jsonc`, remplacer les domaines d’exemple et configurer `FRONTEND_ORIGIN`, `PUBLIC_BASE_URL`, les IDs d’apps, les callbacks, l’URN LinkedIn et, si une vraie Page existe, son ID Facebook. Le parcours LinkedIn demande `r_organization_admin` et `w_organization_social`, puis exige que le membre soit administrateur approuvé de l’organisation configurée avant d’enregistrer la connexion. Ce contrôle strict correspond à la portée actuelle du droit `r_organization_admin`. Le frontend doit viser l’URL publique de ce Worker dans Préférences → Backend et compte.
9. Déployer avec `npx wrangler deploy`, puis attacher un domaine personnalisé à l’API dans Cloudflare et enregistrer les callbacks OAuth exacts auprès de Meta et LinkedIn.

Pour travailler localement, copier `cloudflare-api/.dev.vars.example` vers `.dev.vars`, remplacer les valeurs, puis exécuter `npx wrangler d1 migrations apply klirline-social --local` et `npm run dev`. Ne jamais committer `.dev.vars`.

Les parcours automatisés de l’API peuvent être exécutés avant déploiement depuis `cloudflare-api/` avec `node --test`. Ils couvrent l’authentification, le changement de mot de passe et l’invalidation des anciennes sessions, le stockage simulé, la programmation et son Cron, l’idempotence, la suppression de compte, les requêtes de publication pour les trois adaptateurs, le renouvellement LinkedIn et la vérification d’accès LinkedIn, y compris un échec partiel dû à une limite de débit. Le contrôle `/api/health` vérifie également qu’une requête D1, un accès R2 et les secrets requis fonctionnent. Les tests utilisent SQLite local, un faux bucket R2 et des réponses fournisseur simulées; ils ne remplacent pas les essais avec de vrais comptes ou Cloudflare.

Le workflow GitHub Actions `.github/workflows/ci.yml` exécute ces tests et les contrôles de syntaxe sur chaque push et pull request. Il ne déploie pas l’application et n’utilise aucun secret de production.

### Prévol et mise en service

Depuis la racine du dépôt, lancez `node scripts/cloudflare-preflight.mjs`. Le script vérifie les marqueurs de configuration et rappelle les étapes qui nécessitent votre compte; il n’accède pas à Cloudflare et ne prouve pas qu’un déploiement fonctionne.

Ordre de mise en service recommandé :

1. Publier le frontend sur Pages avec la racine `/`, sans commande de build et `.` comme sortie; vérifier les trois pages et le domaine public.
2. Créer le Worker API distinct avec `cloudflare-api/` comme racine et `npx wrangler deploy` comme commande de déploiement. Créer D1/R2, remplacer l’ID D1 factice, ajouter les secrets dans les paramètres du Worker et appliquer toutes les migrations distantes.
3. Configurer le domaine API et les variables d’origine/callback exactement, puis redéployer. Tester `/api/health` et conserver le résultat; une réponse saine doit confirmer D1, R2 et secrets.
4. Dans l’application publiée, saisir l’URL HTTPS de l’API, créer l’espace administrateur avec la clé d’initialisation, puis vérifier connexion, changement de mot de passe, quota, média et programmation sans publier publiquement.
5. Ajouter les comptes de développeur et OAuth seulement après avoir choisi les canaux du lancement. Faire un essai sur un compte/Page de test avec une publication contrôlée, puis vérifier son statut côté Klirline et chez le fournisseur.
6. Garder l’accès réservé à l’équipe. Créer l’administrateur initial avec la clé bootstrap et confirmer que l’inscription publique reste désactivée. Dans Préférences → Membres de l’équipe, créer un lien rédacteur/lecteur à usage unique. Le collègue configure la même URL API, ouvre le lien, crée son mot de passe et se connecte.
7. Connecter les réseaux sous le compte administrateur; leurs autorisations sont partagées avec l’espace. Préparer le support interne, la réauthentification OAuth, la panne de publication et la révocation/réactivation des comptes. Mettre en place alertes, sauvegardes D1/export et un essai de restauration avant un usage régulier.

Le nom de l’exploitant fourni est Klirline Inc. Le service est interne et aucun prix ni parcours de paiement ne s’applique. Les pages de confidentialité et suppression doivent toujours refléter les traitements réels et les exigences des plateformes; le statut de Page professionnelle Facebook n’est pas confirmé. L’adresse fournie est « 10948 Av Rome, H1H 4P4, Canada »; vérifier qu’elle est complète pour les avis légaux.

Cette première version ne couvre que la publication texte/image vers Instagram professionnel, Page Facebook et Page LinkedIn. X, Threads, Pinterest, TikTok, Bluesky et Twitch ne sont pas pris en charge dans ce Worker. La migration 0008 et l’API gèrent les invitations, les rôles rédacteur/lecteur, la révocation d’accès et le partage des connexions, médias, publications et programmations au niveau de l’espace; les brouillons restent locaux au navigateur. Le mode interne désactive le paiement et garde l’inscription publique fermée. Les limites sont configurées à 9 comptes et 5 000 publications mensuelles. Instagram peut renouveler le jeton selon les autorisations obtenues; LinkedIn peut demander une reconnexion; Facebook utilise une Page et un jeton autorisés. Le journal d’audit, les campagnes traduites et circuits d’approbation, la sélection interactive de plusieurs Pages/organisations, les sauvegardes et la supervision opérationnelle restent à traiter. Vérifier séparément les accès développeur et les permissions demandées par chaque réseau.

## Origines, cookies et domaines

Dans le backend, `FRONTEND_ORIGIN` doit être l’origine exacte du site (schéma + domaine, sans chemin ni barre oblique finale), par exemple `https://app.klirline.com`. `PUBLIC_BASE_URL` doit être l’origine HTTPS exacte de l’API. Pour que la session par cookie fonctionne de façon fiable, configurez de préférence frontend et API sous le même domaine de premier niveau, par exemple `app.klirline.com` et `api.klirline.com`. Des domaines séparés comme `workers.dev` et `pages.dev` peuvent être bloqués comme cookies tiers par certains navigateurs.

Les pages statiques sont servies par Cloudflare Pages. Le backend Express de référence, son stockage JSON et son worker ne peuvent pas être déployés tels quels comme Worker Cloudflare. Configurez l’URL API vers le Worker de `cloudflare-api/`, pas vers le site Pages lui-même.

Ne jamais committer `.env`, jetons OAuth, secrets JWT/chiffrement, clés d'applications ni données de comptes. Les secrets de production doivent être configurés dans le tableau de bord de la plateforme.
