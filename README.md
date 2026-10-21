# Klirline Social Publisher

Prototype de planification et de gestion de publications sociales pour Klirline. L’interface se sert depuis `index.html`; elle fonctionne localement en mode manuel et peut appeler l’API configurée dans **Préférences → Backend et compte**. `cloudflare-api/` contient désormais une première implémentation Cloudflare Workers avec D1 et R2. `klirline-social-backend/` conserve l’ancien backend Node/Express de référence.

## Statut et mode interne

Klirline Social Publisher est un outil interne de promotion de Klirline; il n’est pas vendu et ne requiert pas de paiement ni d’abonnement. Le Worker Cloudflare est maintenant configuré avec `INTERNAL_MODE=true`: les membres déjà autorisés peuvent publier sans Stripe et l’inscription publique reste fermée. Le premier administrateur est créé avec la clé bootstrap. Le partage sécurisé de l’espace entre plusieurs membres n’est pas encore livré.

Le pilote Cloudflare couvre le texte et les images vers Instagram professionnel, Page Facebook et Page LinkedIn, mais il n’est pas déployé ni validé avec les vrais comptes. Les autres réseaux ne sont pas encore disponibles dans ce Worker. Les quotas internes proposés sont de 9 comptes et 5 000 publications par mois. Le serveur Node/Express historique est une référence de développement, pas un service de production.

## Démarrer le prototype

Ouvrir `index.html` dans un navigateur pour utiliser la préparation locale. Pour installer le pilote Workers, suivre [`CLOUDFLARE-DEPLOIEMENT.md`](CLOUDFLARE-DEPLOIEMENT.md); l’API se trouve dans [`cloudflare-api/`](cloudflare-api/). Le backend Node de référence est décrit dans [`klirline-social-backend/README.md`](klirline-social-backend/README.md).

## Plan d’usage et informations à compléter

- [`USAGE-INTERNE.md`](USAGE-INTERNE.md) : processus de campagne et écarts avant usage régulier par l’équipe.
- [`privacy.html`](privacy.html), [`terms.html`](terms.html), [`deletion.html`](deletion.html) : pages à aligner sur les pratiques réelles, notamment pour les revues des plateformes et demandes de suppression.
- [`klirline-social-backend/AUDIT.md`](klirline-social-backend/AUDIT.md) : audit technique et limites des intégrations.

Avant l’usage opérationnel, déployer l’API sous des domaines maîtrisés par Klirline, confirmer les secrets et les accès OAuth, faire des publications de test contrôlées, mettre en place des comptes individuels pour l’équipe, les sauvegardes et l’alerte d’incident, puis définir les processus de campagne multilingue et d’approbation.
