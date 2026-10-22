# Déploiement et mise en service de Klirline Social

Klirline Social Publisher est un outil interne pour les campagnes de Klirline. Il n’est pas vendu et n’a ni abonnement ni facturation.

## État vérifié — 21 octobre 2026

- Le Worker frontend de production `klirline-social-publisher` n’a pas été remplacé par la branche `commercial-readiness`. La PR GitHub reste en brouillon. Le site de production continue de servir la version antérieure.
- L’aperçu vérifié de la branche est [`https://commercial-readiness-klirline-social-publisher.pipoxdavensonazor.workers.dev/`](https://commercial-readiness-klirline-social-publisher.pipoxdavensonazor.workers.dev/) et protégé par Cloudflare Access. La politique Allow couvre les adresses `@klirline.ca`; l’accès doit être effectué par un membre de l’équipe. L’hôte personnalisé d’aperçu est préparé, mais ne résout pas encore dans le contrôle réseau.
- Le Worker API distinct `klirline-social-api` est en ligne sur `https://social-api.klirline.ca`, version `380b7f4d-e117-475b-9327-00be6119526a`. Il utilise D1 `klirline-social`, R2 `klirline-social-media` et les migrations `0001` à `0015`.
- Le contrôle navigateur de [`/api/health`](https://social-api.klirline.ca/api/health) est `ok:true`: D1, schéma, R2, mode interne, approbation, session, chiffrement des jetons et préparation du bootstrap sont tous valides. [`/api/auth/bootstrap`](https://social-api.klirline.ca/api/auth/bootstrap) répond encore `needsAdmin:true`.
- Les requêtes D1 de contrôle ont trouvé 0 utilisateur, 0 connexion sociale, 0 publication et 0 programmation avant l’onboarding. Aucun compte social n’a été connecté ni aucune publication réelle envoyée.
- La configuration CORS de l’API autorise les origines frontend de production et les previews autorisées, dont `https://commercial-readiness.social-preview.klirline.ca`. L’exception anti-challenge Cloudflare est limitée aux requêtes `/api/*` de cette origine vers `social-api.klirline.ca`. Le déploiement API et l’ajout du domaine preview ne remplacent pas le Worker frontend de production.

## Première connexion et administrateur

1. Ouvrir l’[aperçu `commercial-readiness`](https://commercial-readiness-klirline-social-publisher.pipoxdavensonazor.workers.dev/) et se connecter à Cloudflare Access avec une adresse `@klirline.ca` et le code reçu par courriel. Ne pas envoyer ce code à quelqu’un d’autre.
2. Dans **Préférences → Backend et compte**, utiliser `https://social-api.klirline.ca`, puis **Enregistrer et vérifier**.
3. Comme aucun utilisateur n’existe, le formulaire **Créer le premier administrateur** apparaît. Choisir une adresse professionnelle `@klirline.ca` et son propre mot de passe (12 caractères minimum).
4. La clé bootstrap se trouve dans Cloudflare comme secret et sa copie locale de secours est chiffrée pour le compte Windows qui a configuré Wrangler. Pour la mettre temporairement dans le presse-papiers sans l’afficher, exécuter dans PowerShell :

   ```powershell
   $enc = Get-Content -Raw "$env:TEMP\klirline-social-secrets\bootstrap-admin-key.dpapi"
   $sec = ConvertTo-SecureString $enc
   $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
   try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) | Set-Clipboard }
   finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
   ```

   Coller la clé dans son champ, créer l’administrateur, puis effacer le presse-papiers. Le backend n’accepte cette clé que pour la création du premier compte. Ne pas l’ajouter à Git, GitHub ou aux messages.

5. Confirmer que l’interface indique **Connecté**, puis vérifier l’enregistrement d’un brouillon et son approbation avant tout essai de publication.

La navigation de l’application et la réponse de l’API ont été vérifiées séparément. L’étape qui reste au titulaire est de se connecter à Access puis de créer le premier administrateur avec sa clé bootstrap. Aucun administrateur, compte social ou post réel n’a encore été créé. Sur `workers.dev`, le cookie de session peut être bloqué comme cookie intersite; si cela arrive, l’hôte personnalisé d’aperçu doit d’abord être rendu joignable et testé.

## Réseaux et prérequis externes

Publication automatique codée dans le Worker : Instagram professionnel, Pages Facebook, Pages LinkedIn, Threads, X, Pinterest et Bluesky. Chaque réseau exige ses identifiants d’application, permissions, consentement OAuth et, selon le fournisseur, revue d’application. Le lien d’un profil seul ne donne aucun droit de publication. Le type Page Facebook et les rôles réels sur les Pages/organisations doivent être confirmés à la connexion.

TikTok reste manuel. Les règles de partage officielles de TikTok indiquent que les applications réservées à une équipe privée pour publier sur les comptes gérés par cette même équipe ne sont pas un cas d’usage acceptable pour son Content Posting API. Ne pas activer l’automatisation TikTok pour l’outil interne. Twitch n’offre pas de publication générique de promotion comme un fil social; utiliser les outils de chaîne/stream ou préparer le contenu manuellement. Voir [la recherche des intégrations](RECHERCHE-CONNEXIONS-SOCIALES.md).

Avant de publier réellement : enregistrer les URI de callback exactes figurant dans `cloudflare-api/wrangler.jsonc` auprès des applications développeur; configurer leurs identifiants et secrets dans les secrets Cloudflare; connecter les comptes officiels avec leurs titulaires; vérifier les capacités média et faire un essai contrôlé par destination. Ne jamais demander ni enregistrer les mots de passe sociaux.

## Déploiement sans toucher au frontend de production

- Le site `klirline-social-publisher` est servi depuis la racine du dépôt avec `wrangler.jsonc` racine. Le Worker API est un service séparé, configuré dans `cloudflare-api/wrangler.jsonc` sous le nom `klirline-social-api`.
- Pour développer ou déployer l’API, travailler dans `cloudflare-api/` et utiliser son Wrangler. Ne changez pas la racine ou la commande Workers Builds du frontend vers `cloudflare-api/`.
- La branche `commercial-readiness` reste séparée de `main`; sa prévisualisation ne promeut pas automatiquement les changements frontend en production. Ne promouvoir le frontend qu’après validation authentifiée et décision de déploiement de Klirline.
- Garder `INTERNAL_MODE=true`, `ALLOW_PUBLIC_SIGNUP=false` et `REQUIRE_APPROVED_DRAFTS=true`. Les seuils 100 comptes et 5 000 publications mensuelles sont des plafonds opérationnels, pas des forfaits commerciaux.
- Les sauvegardes D1/R2, la restauration testée, les alertes, la supervision Cron et les essais réels par réseau restent des tâches d’exploitation à organiser.

## Vérifications du dépôt

À la racine : `node scripts/check-project.mjs`. Dans `cloudflare-api/` : `node --test`. Les tests utilisent des fournisseurs simulés et ne prouvent pas qu’un jeton OAuth réel ou une publication de compte Klirline fonctionne.

Les secrets Cloudflare `SESSION_SECRET`, `TOKENS_ENCRYPTION_KEY_HEX` et `BOOTSTRAP_ADMIN_KEY` sont configurés. Les sauvegardes locales des deux derniers secrets sont protégées par DPAPI pour le compte Windows qui les a générées. Ne pas les supprimer avant d’avoir établi une sauvegarde appropriée, surtout après la première connexion d’un réseau : perdre la clé de chiffrement rendrait les jetons sociaux stockés irrécupérables.
