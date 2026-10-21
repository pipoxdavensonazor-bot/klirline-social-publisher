# Klirline Social Publisher

Prototype de planification et de gestion de publications sociales pour Klirline. L’interface se sert depuis `index.html`; elle fonctionne localement en mode manuel et peut appeler l’API configurée dans **Préférences → Backend et compte**. `cloudflare-api/` contient désormais une première implémentation Cloudflare Workers avec D1 et R2. `klirline-social-backend/` conserve l’ancien backend Node/Express de référence.

## État commercial

Ce dépôt n’est pas encore prêt pour la vente. L’API Cloudflare et son parcours Stripe sont du code non déployé ni validé avec les comptes de production; ils requièrent des ressources, secrets, domaines, prix récurrent et comptes sociaux réels. L’API ne couvre que le texte et les images (Instagram JPEG, Facebook Page, LinkedIn Page). L’inscription cliente est désactivée par défaut; les espaces clients ont un administrateur unique, sans partage multi-membres. Les quotas suggérés ne sont pas appliqués. L’ancien backend Node stocke ses données en fichiers JSON et n’est pas compatible tel quel avec Cloudflare Workers. Les trois pages légales statiques contiennent des champs à compléter; elles ne constituent pas des textes juridiques validés. Ne promettez pas la publication automatique avant les autorisations et vérifications en production.

## Démarrer le prototype

Ouvrir `index.html` dans un navigateur pour utiliser la préparation locale. Pour installer le pilote Workers, suivre [`CLOUDFLARE-DEPLOIEMENT.md`](CLOUDFLARE-DEPLOIEMENT.md); l’API se trouve dans [`cloudflare-api/`](cloudflare-api/). Le backend Node de référence est décrit dans [`klirline-social-backend/README.md`](klirline-social-backend/README.md).

## Cadrage et informations à compléter

- [`MVP-COMMERCIAL.md`](MVP-COMMERCIAL.md) : périmètre proposé et critères du MVP.
- [`privacy.html`](privacy.html), [`terms.html`](terms.html), [`deletion.html`](deletion.html) : brouillons de pages publiques; compléter raison sociale, adresse, contacts et modalités applicables avant leur publication commerciale.
- [`klirline-social-backend/AUDIT.md`](klirline-social-backend/AUDIT.md) : audit technique et limites des intégrations.

Avant tout lancement client, il reste notamment à choisir le prix final, configurer le compte et le webhook Stripe, vérifier les limites d’usage et les taxes, garder l’inscription fermée jusqu’aux essais, déployer l’API sous des domaines maîtrisés par Klirline, remplir et valider les pages légales, faire approuver les applications développeur, vérifier les vrais comptes sociaux, et définir support, sauvegardes, sécurité opérationnelle et suppression des données.
