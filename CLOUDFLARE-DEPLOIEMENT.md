# Déploiement du prototype Klirline Social

## État actuel

Le dossier racine contient le frontend statique (`index.html`) et le dossier `klirline-social-backend/` contient un backend Node/Express de référence. Le frontend n'est pas encore relié au backend. Le backend comprend des intégrations de publication incomplètes et ne doit pas être utilisé avec de vrais comptes en production avant la fin des intégrations et des revues fournisseurs.

## Frontend sur Cloudflare Pages

Créer un projet Pages depuis le dépôt GitHub et choisir **Direct Upload / Pages Git integration** selon la configuration Cloudflare. Pour Git integration :

- Framework preset : `None`
- Build command : laisser vide
- Build output directory : `.`
- Root directory : `/`

Le site est constitué de `index.html` et des fichiers statiques à la racine. Les changements poussés sur la branche configurée déclencheront les déploiements automatiques Pages.

## Backend

Le backend fourni utilise Express, un fichier JSON local comme stockage et un worker planifié en mémoire. Ce stockage ne survit pas aux redémarrages et ne convient pas à un déploiement serverless Cloudflare Workers. La publication du frontend sur Pages ne déploie donc pas le backend.

Avant d'exposer le backend en production, il faut le migrer vers une architecture Cloudflare avec stockage durable (par exemple D1/R2 et une file adaptée), remplacer le worker en mémoire et vérifier les appels réels aux fournisseurs. À défaut, héberger le backend Node sur un service Node persistant distinct et configurer ses secrets dans ce service.

Ne jamais committer `.env`, jetons OAuth, secrets JWT/chiffrement, clés d'applications ni données de comptes. Les secrets de production doivent être configurés dans le tableau de bord de la plateforme.
