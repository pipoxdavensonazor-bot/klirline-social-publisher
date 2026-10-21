# Klirline Social Publisher

Prototype de planification et de gestion de publications sociales pour Klirline. L’interface se sert depuis `index.html`; elle fonctionne localement en mode manuel et peut appeler l’API configurée dans **Préférences → Backend et compte**. `cloudflare-api/` contient désormais une première implémentation Cloudflare Workers avec D1 et R2. `klirline-social-backend/` conserve l’ancien backend Node/Express de référence.

## Statut et mode interne

Klirline Social Publisher est un outil interne de promotion de Klirline; il n’est pas vendu et ne requiert pas de paiement ni d’abonnement. Le Worker Cloudflare est configuré avec `INTERNAL_MODE=true`: l’administrateur peut inviter des rédacteurs ou lecteurs par lien à usage unique; les connexions, médias, publications et programmations sont partagés dans l’espace. L’inscription publique reste fermée.

Le pilote Cloudflare couvre le texte et les images vers Instagram professionnel, Page Facebook et Page LinkedIn, mais il n’est pas déployé ni validé avec les vrais comptes. L’administrateur seul connecte/déconnecte ces comptes sociaux; les rédacteurs publient et programment depuis les connexions partagées. Les autres réseaux ne sont pas encore disponibles dans ce Worker. Les quotas internes sont configurés à 9 comptes et 5 000 publications par mois. Le serveur Node/Express historique est une référence de développement, pas un service de production.

## Démarrer le prototype

Ouvrir `index.html` dans un navigateur pour utiliser la préparation locale. Pour installer le pilote Workers, suivre [`CLOUDFLARE-DEPLOIEMENT.md`](CLOUDFLARE-DEPLOIEMENT.md); l’API se trouve dans [`cloudflare-api/`](cloudflare-api/). Le backend Node de référence est décrit dans [`klirline-social-backend/README.md`](klirline-social-backend/README.md).

## Plan d’usage et informations à compléter

- [`USAGE-INTERNE.md`](USAGE-INTERNE.md) : processus de campagne et écarts avant usage régulier par l’équipe.
- [`privacy.html`](privacy.html), [`terms.html`](terms.html), [`deletion.html`](deletion.html) : pages à aligner sur les pratiques réelles, notamment pour les revues des plateformes et demandes de suppression.
- [`klirline-social-backend/AUDIT.md`](klirline-social-backend/AUDIT.md) : audit technique et limites des intégrations.

Avant l’usage opérationnel, déployer l’API sous des domaines maîtrisés par Klirline, confirmer les secrets et accès OAuth, installer la migration 0008, inviter les employés avec leurs comptes individuels, faire des publications de test contrôlées, mettre en place les sauvegardes et alertes, puis définir les processus de campagne multilingue et d’approbation. Les brouillons de texte restent locaux à chaque navigateur; seules les publications, connexions, médias et programmations du serveur sont partagés.
