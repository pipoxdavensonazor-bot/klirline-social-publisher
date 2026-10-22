# Klirline Social Publisher

Klirline Social Publisher est un outil interne pour préparer, faire approuver, programmer et suivre les promotions Klirline par pays, langue, fuseau horaire et compte social. Il n'est pas vendu et ne comporte ni abonnement ni paiement.

## État actuel

- Le frontend Cloudflare Workers sert l'application depuis `index.html`; `site/` est généré par `npm run build`.
- L'API Cloudflare Worker séparée se trouve dans [`cloudflare-api/`](cloudflare-api/), avec D1, R2, migrations et un Cron de publication.
- Vérification navigateur du 22 octobre 2026 UTC : `https://social-api.klirline.ca/api/health` répond `ok:true` pour D1, schéma, R2, mode interne, approbation, session, chiffrement et préparation du bootstrap. `/api/auth/bootstrap` répond `needsAdmin:true` : le premier compte reste à créer. Le site de production n'a pas été remplacé; l'aperçu est protégé par Access et attend une connexion `@klirline.ca`. Aucun compte social ni publication réelle n'a été validé.
- Les identifiants d'applications OAuth et le consentement des comptes sociaux restent à configurer. Les intégrations sont testées avec des fournisseurs simulés; aucune publication sur un vrai compte n'est validée par ces tests.
- L'état de déploiement des Workers, Cloudflare Access, migrations et secrets doit être vérifié dans [`CLOUDFLARE-DEPLOIEMENT.md`](CLOUDFLARE-DEPLOIEMENT.md). La branche `commercial-readiness` n'est pas automatiquement la version frontend en production.

## Canaux pris en charge

Le Worker comporte des parcours de publication texte/image pour Instagram professionnel, Pages Facebook, Pages LinkedIn, Threads, X, Pinterest et Bluesky. Les autorisations de fournisseur, les formats et les comptes accessibles déterminent ce qui fonctionnera réellement. Bluesky utilise OAuth officiel et DPoP; une image doit être JPEG/PNG de 2 Mo maximum avec un texte alternatif.

TikTok reste un parcours manuel dans le pilote interne. Twitch ne fournit pas de publication promotionnelle générique; utilisez les fonctions propres à la chaîne. Dans l'interface, ajouter un lien de profil seul ne connecte pas le compte et ne permet pas de publier.

Plusieurs comptes peuvent être associés à un réseau. Un administrateur gère les connexions sociales; les rédacteurs préparent et programment les publications depuis les comptes partagés; les lecteurs consultent. En mode interne, le Worker exige un brouillon approuvé dont le texte, les destinations et le média correspondent exactement à la publication demandée.

## Développement et déploiement

- Ouvrir `index.html` pour le mode de préparation locale; les profils et brouillons locaux restent dans ce navigateur.
- Construire les ressources frontend avec `npm run build`.
- Déployer le frontend uniquement selon le processus de production documenté. Ne pas utiliser la configuration de l'API pour remplacer le Worker frontend.
- Déployer l'API séparément depuis `cloudflare-api/`; suivre [`CLOUDFLARE-DEPLOIEMENT.md`](CLOUDFLARE-DEPLOIEMENT.md) et ne jamais enregistrer les secrets dans Git.
- Lancer `node scripts/check-project.mjs` pour vérifier la configuration du projet et, dans `cloudflare-api/`, `pnpm test` pour les parcours API simulés.

## Guides internes

- [`USAGE-INTERNE.md`](USAGE-INTERNE.md) : rôles, sécurité et processus de campagne.
- [`GUIDE-CAMPAGNES-INTERNATIONALES.md`](GUIDE-CAMPAGNES-INTERNATIONALES.md) : adaptations pays/langue et publication.
- [`privacy.html`](privacy.html), [`terms.html`](terms.html), [`deletion.html`](deletion.html) : avis légaux à maintenir selon les pratiques réelles.
- [`RECHERCHE-CONNEXIONS-SOCIALES.md`](RECHERCHE-CONNEXIONS-SOCIALES.md) : portée et contraintes des intégrations.
- [`klirline-social-backend/`](klirline-social-backend/) : ancien backend Node/Express conservé pour référence historique; ce n'est pas le service déployé.

Les plafonds opérationnels par défaut (`WORKSPACE_MAX_CONNECTED_ACCOUNTS=100`, `WORKSPACE_MONTHLY_PUBLICATION_CAP=5000`) sont des garde-fous configurables, pas des forfaits commerciaux.
