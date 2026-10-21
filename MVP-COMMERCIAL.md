# Périmètre proposé — MVP commercial Klirline Social Publisher

**Version :** proposition de cadrage, 21 octobre 2026  
**Objectif :** définir la première offre commercialisable avant d’élargir les intégrations.

## Décision produit proposée

Positionner la première version comme un **outil de rédaction, planification et suivi de publications pour petites entreprises**, avec publication automatique seulement sur les comptes connectés par autorisation officielle.

Ne pas commercialiser la version actuelle comme un outil de publication automatique. Dans l’application présente, les profils sont des liens enregistrés dans le navigateur; la préparation, le calendrier, les médias et la confirmation de publication sont locaux et manuels. L’interface le signale déjà à l’utilisateur.

## Client et promesse

- **Client de départ :** petite entreprise ou équipe marketing qui publie sur ses propres comptes professionnels.
- **Problème résolu :** préparer une publication dans un seul espace, choisir ses destinations, programmer l’envoi et voir le résultat par destination.
- **Promesse v1 :** « Préparez vos publications au même endroit et publiez-les sur les comptes professionnels que vous avez connectés. »
- **Condition de vérité :** afficher séparément chaque destination publiée, échouée ou nécessitant une action; ne jamais présenter une ouverture de réseau ou un rappel local comme une publication réussie.

## Canaux de lancement recommandés

Commencer avec **Instagram professionnel** et **LinkedIn Page d’entreprise**. Ajouter **Facebook Page** seulement après confirmation que Klirline possède bien une Page publiable. Le lien fourni (`facebook.com/profile.php?id=61589921400915`) ne permet pas à lui seul de confirmer qu’il s’agit d’une Page professionnelle; le site Facebook n’a pas pu être consulté publiquement pendant cette vérification. Confirmer le type du compte dans Meta Business Suite avant d’activer Facebook.

Cette sélection concentre le premier parcours sur les comptes d’entreprise et évite de promettre neuf intégrations dont les permissions et formats diffèrent. Elle reste conditionnée par les comptes développeur et les autorisations de chaque fournisseur. LinkedIn peut imposer un accès Community Management approuvé. Instagram doit être un compte professionnel et obtenir les permissions Meta appropriées.

Les autres canaux — X, Threads, Pinterest, TikTok, Bluesky et Twitch — sont hors périmètre initial. Twitch ne sera pas présenté comme destination de publication sociale générique; TikTok nécessite notamment un audit pour rendre publiques les publications directes d’une application. Pinterest Trial ne permet pas de créer des Pins visibles au public.

## Fonctions visées pour le MVP — à livrer et valider avant la vente

1. Création d’un espace d’entreprise et connexion sécurisée de l’utilisateur.
2. Connexion/déconnexion OAuth des comptes professionnels, affichage du compte autorisé et choix des destinations. Le pilote actuel utilise une seule Page Facebook et une seule organisation LinkedIn configurées par l’exploitant; il n’a pas encore de sélecteur multi-Pages.
3. Rédaction d’une publication texte avec une image; validation des limites avant envoi. Chaque réseau garde son propre état et son message d’erreur.
4. Publication immédiate et programmation en UTC avec affichage dans le fuseau local, annulation avant envoi et prévention des doublons.
5. Historique par destination : en attente, publié avec référence fournisseur, échec ou action requise.
6. Pages confidentialité, conditions d’utilisation, procédure de déconnexion/suppression et moyen de contacter le support.

## Hors périmètre v1

- Toute promesse de connexion en collant simplement un lien de profil, ou de collecte des mots de passe sociaux.
- Vidéo, carrousel, Stories/Reels, publicité, analytics multi-réseaux et adaptation automatique des créations.
- Publication sur profil Facebook personnel, sur Twitch comme fil social ou sur un compte qui n’a pas autorisé l’application.
- Accès multi-entreprises libre avant validation de l’isolation des données, de la facturation et du support.

## Proposition tarifaire à valider

Prix choisi : **9,99 USD par mois**, sans engagement annuel, pour un espace, un utilisateur et jusqu’à trois comptes sociaux connectés. Le plafond de 50 publications (publiées ou programmées) par cycle est appliqué côté serveur. Les limites sont configurables dans Wrangler et `.dev.vars`; elles ne constituent pas encore une offre commerciale active. Le dépôt contient le parcours Stripe Checkout/portail/webhook, mais il n’est pas configuré avec un compte Stripe. Créer le prix récurrent Stripe en USD et vérifier taxes, annulation, remboursements et pages légales avant d’activer la facturation.

Ce prix vise un outil encore étroit, sans analytics, vidéo, approbations d’équipe ni multi-entreprises. À titre de repère, Buffer affiche Essentials à 5 USD par canal et par mois avec paiement annuel, tandis que Metricool affiche Starter à partir de 25 USD par mois sur sa page de prix américaine. Ces offres ont davantage de fonctions et ne sont pas une comparaison parfaite; le prix Klirline devrait être réévalué après validation des coûts Cloudflare et des autorisations des réseaux. Sources consultées le 21 octobre 2026 : [Buffer Pricing](https://buffer.com/pricing), [Metricool Pricing](https://metricool.com/pricing/).

## Critères de sortie du cadrage

Le MVP peut passer au développement commercial quand ces points sont confirmés :

- Les comptes Klirline sont des comptes professionnels compatibles et leurs administrateurs peuvent accorder le consentement OAuth.
- La destination Facebook est une Page d’entreprise; le lien fourni (`facebook.com/profile.php?id=61589921400915`) n’établit pas son type. Le vérifier dans Meta Business Suite; sinon retirer Facebook du lancement.
- La première version est limitée au texte et à une image, avec publication immédiate et programmation.
- Les autorisations développeur et les revues nécessaires sont identifiées pour Instagram et LinkedIn; aucune intégration n’est annoncée comme publique avant son approbation.
- La page d’accueil décrit exactement les réseaux et fonctions qui ont été testés en production.

## Parcours principal à livrer

`Créer un espace → connecter un réseau → vérifier le compte/Page → rédiger et prévisualiser → choisir les destinations → publier ou programmer → consulter le résultat par destination.`

## Écart constaté dans le dépôt actuel

L’interface racine sait appeler un backend lorsque son URL est configurée; sans backend, elle fonctionne en mode local et les publications sont manuelles. `cloudflare-api/` contient une API Workers avec D1/R2 et des espaces clients; l’inscription publique est désactivée par défaut et doit rester fermée tant que Stripe, les domaines, les textes légaux et les comptes fournisseurs ne sont pas vérifiés. Le code permet l’inscription d’un administrateur par espace, mais pas le partage de données et connexions entre membres. Le parcours Stripe n’est ni configuré ni essayé avec le compte marchand; les plafonds configurables proposés sont maintenant appliqués par le Worker. L’API n’est pas déployée ni validée avec de vrais comptes. Elle vise trois canaux et n’a pas de sélection interactive de Pages Facebook ou d’organisations LinkedIn. Le backend `klirline-social-backend/` reste une référence mono-instance JSON. Les pages légales sont des brouillons. Le produit n’est donc pas encore prêt à être vendu ou annoncé comme service de publication automatique.

## Références fournisseurs à revalider avant soumission

- [Meta Instagram API](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [Versions Graph API Meta](https://developers.facebook.com/docs/graph-api/changelog/versions/) — le pilote est réglé sur `v26.0`; confirmer la version permise dans l’application Meta avant les essais réels.
- [LinkedIn Community Management](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview?view=li-lms-2026-01)
- [TikTok Direct Post et audit](https://developers.tiktok.com/docs/en/content-posting-api-get-started)
- [Pinterest niveaux d’accès](https://developers.pinterest.com/docs/key-concepts/access-tiers/)
