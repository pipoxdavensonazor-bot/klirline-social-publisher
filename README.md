# Klirline Social Publisher

Prototype de planification et de gestion de publications sociales pour Klirline. L’interface se sert depuis `index.html`; elle fonctionne localement en mode manuel et peut appeler l’API configurée dans **Préférences → Backend et compte**. `cloudflare-api/` contient désormais une première implémentation Cloudflare Workers avec D1 et R2. `klirline-social-backend/` conserve l’ancien backend Node/Express de référence.

## Statut et mode interne

Klirline Social Publisher sert d’abord l’équipe Klirline et peut aussi être proposé aux organisations clientes. Le tarif choisi est de **9,99 USD par espace de travail et par mois**. L’espace interne Klirline est exempté de paiement; les autres espaces doivent avoir un abonnement Stripe actif avant d’accéder aux fonctions protégées. L’inscription publique reste masquée jusqu’à la configuration du Price ID, des secrets Stripe et de Stripe Tax.

L’espace a des plafonds opérationnels configurables (`WORKSPACE_MAX_CONNECTED_ACCOUNTS=100`, `WORKSPACE_MONTHLY_PUBLICATION_CAP=5000`) pour protéger le service contre les erreurs et les abus. Ils ne définissent aucun forfait; les capacités peuvent être ajustées à la charge réelle de l’équipe.

Le pilote Cloudflare couvre les publications texte/image vers Instagram professionnel, Page Facebook, Page LinkedIn, Threads, X, Pinterest et Bluesky. Bluesky utilise OAuth officiel avec PKCE/DPoP et stocke ses sessions chiffrées dans D1; les images acceptées sont JPEG/PNG de 2 Mo maximum et exigent un texte alternatif. TikTok reste manuel selon les limites du partage d’applications internes; Twitch n’est pas un canal de publication générique. Les fournisseurs sont testés avec réponses simulées, mais ne sont pas validés sur les vrais comptes ni déployés. L’administrateur seul connecte/déconnecte les comptes sociaux; les rédacteurs publient et programment depuis les connexions partagées. Les programmations enregistrent un fuseau horaire IANA par destination. Les plafonds opérationnels par défaut sont de 100 profils sociaux et 5 000 publications par mois. Un abonnement inactif bloque les fonctions de publication; Stripe confirme l’état du paiement par webhook signé. Un journal d’activité d’administration est disponible dans Préférences. Le serveur Node/Express historique est une référence de développement, pas un service de production.

## Démarrer le prototype

Ouvrir `index.html` dans un navigateur pour utiliser la préparation locale. Le frontend Worker Static Assets se construit avec `npm run build` et `npm run deploy`; son `wrangler.jsonc` sert uniquement la liste publique de `site/`. Pour installer l’API Worker distincte, suivre [`CLOUDFLARE-DEPLOIEMENT.md`](CLOUDFLARE-DEPLOIEMENT.md); son code se trouve dans [`cloudflare-api/`](cloudflare-api/). Le backend Node de référence est décrit dans [`klirline-social-backend/README.md`](klirline-social-backend/README.md).

## Plan d’usage et informations à compléter

- [`USAGE-INTERNE.md`](USAGE-INTERNE.md) : processus de campagne et écarts avant usage régulier par l’équipe.
- [`privacy.html`](privacy.html), [`terms.html`](terms.html), [`deletion.html`](deletion.html) : pages à aligner sur les pratiques réelles, notamment pour les revues des plateformes et demandes de suppression.
- [`GUIDE-CAMPAGNES-INTERNATIONALES.md`](GUIDE-CAMPAGNES-INTERNATIONALES.md) : méthode de campagne par pays/langue, modes de publication et contrôles de lancement interne.
- [`klirline-social-backend/AUDIT.md`](klirline-social-backend/AUDIT.md) : audit technique et limites des intégrations.

Avant l’usage opérationnel, déployer l’API sous des domaines maîtrisés par Klirline, confirmer les secrets et accès OAuth, appliquer toutes les migrations jusqu’à 0014, inviter les employés avec leurs comptes individuels et faire des publications de test contrôlées. Les brouillons peuvent être partagés avec un pays, une langue et un fuseau horaire; `REQUIRE_APPROVED_DRAFTS=true` impose leur approbation avant publication API ou programmation automatique. Mettre en place les sauvegardes et alertes, puis tester les procédures de campagne dans chaque région.
