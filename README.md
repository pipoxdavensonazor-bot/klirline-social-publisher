# Klirline Social Publisher

Prototype de planification et de gestion de publications sociales pour Klirline. L’interface se sert depuis `index.html`; elle fonctionne localement en mode manuel et peut appeler l’API configurée dans **Préférences → Backend et compte**. `cloudflare-api/` contient désormais une première implémentation Cloudflare Workers avec D1 et R2. `klirline-social-backend/` conserve l’ancien backend Node/Express de référence.

## Statut et mode interne

Klirline Social Publisher est un outil interne de promotion de Klirline; il n’est pas vendu et ne requiert pas de paiement ni d’abonnement. Le Worker Cloudflare est configuré avec `INTERNAL_MODE=true`: l’administrateur peut inviter des rédacteurs ou lecteurs par lien à usage unique; les connexions, médias, publications et programmations sont partagés dans l’espace. L’inscription publique reste fermée.

Le pilote Cloudflare couvre les publications texte/image vers Instagram professionnel, Page Facebook, Page LinkedIn, Threads, X et Pinterest. X utilise OAuth 2.0 avec PKCE, renouvellement des jetons et images JPEG/PNG jusqu’à 5 Mo. Pinterest demande de choisir un tableau et nécessite une image JPEG/PNG. Ces intégrations sont testées avec des réponses simulées, mais ne sont pas validées sur les vrais comptes ni déployées. L’administrateur seul connecte/déconnecte les comptes sociaux; les rédacteurs publient et programment depuis les connexions partagées. TikTok et Bluesky ne sont pas encore disponibles dans ce Worker; Twitch n’est pas un canal de publication générique. Les programmations enregistrent un fuseau horaire IANA par destination. Les quotas internes sont configurés à 9 comptes et 5 000 publications par mois. Un journal d’activité d’administration est disponible dans Préférences. Le serveur Node/Express historique est une référence de développement, pas un service de production.

## Démarrer le prototype

Ouvrir `index.html` dans un navigateur pour utiliser la préparation locale. Le frontend Worker Static Assets se construit avec `npm run build` et `npm run deploy`; son `wrangler.jsonc` sert uniquement la liste publique de `site/`. Pour installer l’API Worker distincte, suivre [`CLOUDFLARE-DEPLOIEMENT.md`](CLOUDFLARE-DEPLOIEMENT.md); son code se trouve dans [`cloudflare-api/`](cloudflare-api/). Le backend Node de référence est décrit dans [`klirline-social-backend/README.md`](klirline-social-backend/README.md).

## Plan d’usage et informations à compléter

- [`USAGE-INTERNE.md`](USAGE-INTERNE.md) : processus de campagne et écarts avant usage régulier par l’équipe.
- [`privacy.html`](privacy.html), [`terms.html`](terms.html), [`deletion.html`](deletion.html) : pages à aligner sur les pratiques réelles, notamment pour les revues des plateformes et demandes de suppression.
- [`GUIDE-CAMPAGNES-INTERNATIONALES.md`](GUIDE-CAMPAGNES-INTERNATIONALES.md) : méthode de campagne par pays/langue, modes de publication et contrôles de lancement interne.
- [`klirline-social-backend/AUDIT.md`](klirline-social-backend/AUDIT.md) : audit technique et limites des intégrations.

Avant l’usage opérationnel, déployer l’API sous des domaines maîtrisés par Klirline, confirmer les secrets et accès OAuth, appliquer toutes les migrations jusqu’à 0012, inviter les employés avec leurs comptes individuels et faire des publications de test contrôlées. Les brouillons peuvent être partagés avec un pays, une langue et un fuseau horaire; `REQUIRE_APPROVED_DRAFTS=true` impose leur approbation avant publication API ou programmation automatique. Mettre en place les sauvegardes et alertes, puis tester les procédures de campagne dans chaque région.
