# Klirline Social Publisher — plan d’usage interne

**Objectif :** permettre aux équipes Klirline de préparer, coordonner, programmer et publier les campagnes de promotion de ses services dans les pays desservis par l’entreprise. L’application n’est pas un produit vendu à des clients.

## Accès et sécurité

- L’API Cloudflare est configurée avec `INTERNAL_MODE=true` et `ALLOW_PUBLIC_SIGNUP=false`.
- Le premier compte administrateur se crée uniquement avec la clé bootstrap. Ne partagez pas ce compte ni sa clé.
- L’administrateur invite les employés dans Préférences avec leur courriel professionnel et un rôle rédacteur ou lecteur. Le lien secret expire après 48 heures et ne peut être utilisé qu’une seule fois; transmettez-le par un canal interne approuvé.
- Les connexions sociales, publications, médias et programmations sont partagés dans l’espace Klirline. Seul l’administrateur gère les connexions OAuth et les membres. Un rédacteur peut publier et programmer; un lecteur peut consulter.
- Désactiver un membre révoque ses sessions sans supprimer les campagnes qu’il a créées. Pour le réactiver, l’administrateur utilise le contrôle Réactiver; l’ancien mot de passe reste le sien et une nouvelle connexion est nécessaire.
- Ne collectez jamais les mots de passe des réseaux sociaux. Utilisez les autorisations OAuth officielles et retirez l’accès des personnes qui quittent l’équipe.
- Plusieurs comptes peuvent être connectés sur un même réseau. Facebook et LinkedIn ajoutent chaque Page/organisation accessible par le titulaire OAuth; pour Instagram, Threads, X, Pinterest et Bluesky, autorisez chaque compte séparément. N’approuvez et ne programmez que les comptes correspondant au marché visé.
- Gardez séparés l’environnement de test et les comptes sociaux réels. Protégez les secrets, limitez les administrateurs et vérifiez les journaux de déploiement.
- Consultez le journal d’activité dans Préférences après les invitations, changements d’accès, connexions sociales, publications et programmations; il conserve les 100 événements les plus récents sans enregistrer le texte des publications.

## Fonctionnalités actuellement disponibles

Le pilote API permet la publication et la programmation vers Instagram professionnel, une Page Facebook, une Page LinkedIn, Threads, X, Pinterest et Bluesky, sous réserve des accès développeur et autorisations réels. X accepte texte et images JPEG/PNG jusqu’à 5 Mo; Pinterest publie une image dans le tableau choisi par l’administrateur. Bluesky accepte texte et une image JPEG/PNG de 2 Mo maximum, avec texte alternatif. Les essais locaux utilisent des réponses fournisseur simulées; les publications réelles doivent être validées sur les comptes Klirline. TikTok reste manuel conformément aux limites de publication d’applications internes; Twitch n’est pas un canal de publication générique. L’app indique le résultat par destination; une erreur ou une action requise doit être traitée avant de considérer une campagne diffusée. Si une programmation affiche que le résultat de l’envoi est incertain après une interruption du Worker, vérifiez d’abord le compte social concerné. Ne relancez pas avant d’avoir vérifié si le réseau a déjà créé la publication, afin d’éviter un doublon.

Les plafonds opérationnels par défaut sont de 100 profils sociaux et 5 000 publications par mois (`WORKSPACE_MAX_CONNECTED_ACCOUNTS` et `WORKSPACE_MONTHLY_PUBLICATION_CAP`). Ce sont des garde-fous techniques configurables, pas des forfaits ou des limites de facturation.

## Processus de campagne multi-pays

1. Confirmer le pays, le public visé, la langue, le service promu et le compte officiel choisi pour ce marché.
2. Faire relire le texte traduit par une personne compétente; vérifier les promesses de service, prix, conditions et exigences locales avant publication.
3. Adapter le format au réseau et au pays; sélectionner uniquement les comptes officiels autorisés.
4. Enregistrer chaque campagne dans les brouillons partagés et faire approuver le contenu exact par un administrateur avant diffusion. En mode interne, le Worker bloque toujours les publications API et programmations qui ne référencent pas un brouillon approuvé dont le texte, les destinations et le média correspondent exactement, même si la variable `REQUIRE_APPROVED_DRAFTS` est mal configurée. Toute modification du contenu exige une nouvelle approbation.
5. Choisir le fuseau horaire IANA du public ciblé dans l’éditeur et vérifier l’heure affichée dans le calendrier; la programmation est conservée en UTC et porte son fuseau de destination.
6. Après envoi, contrôler l’état et l’URL de chaque publication directement dans le réseau. Pour un résultat incertain après interruption du Worker, vérifier le compte avant toute nouvelle tentative. Traiter les échecs, doublons possibles, quotas et demandes de reconnexion.

## Mise en service et exploitation

- Publier le frontend avec Workers Static Assets à la racine du dépôt et déployer l’API séparément depuis `cloudflare-api/`.
- Configurer D1/R2, les secrets, les origines HTTPS, les callbacks OAuth et le domaine d’API; conserver l’inscription publique désactivée.
- Vérifier `/api/health`, les connexions, le téléversement d’image, une publication de test contrôlée, une programmation/annulation et le traitement Cron avant usage opérationnel.
- Mettre en place des sauvegardes D1, une vérification de restauration, alertes de disponibilité, un responsable support interne et les procédures de suppression/révocation.
- Les politiques de confidentialité et la page de suppression restent nécessaires pour les revues de plateformes et les demandes des personnes concernées; elles doivent correspondre aux pratiques réellement déployées et être validées.

## État actuel de l’essai Klirline

- La build de la branche `commercial-readiness` est disponible à `https://commercial-readiness-klirline-social-publisher.pipoxdavensonazor.workers.dev/` pour l’essai manuel. Calendrier, Publications, Médias, Comptes sociaux, Préférences et l’éditeur s’ouvrent. L’interface affiche actuellement « Mode local » et « API configurée · non connecté »; le contrôle direct `https://social-api.klirline.ca/api/health` répond `ok:true`, mais la session API depuis le navigateur n’est pas validée sur cette origine `workers.dev` (les cookies intersites peuvent être bloqués). L’aperçu personnalisé `https://commercial-readiness.social-preview.klirline.ca/` est protégé par Access pour `@klirline.ca` et doit servir à valider la session connectée.
- Après approbation du responsable, la règle Cloudflare `Challenge API Spam` a reçu une exception de contournement limitée à `/api/*`, l’hôte API `social-api.klirline.ca` et les origines preview autorisées. **La condition générale de cette règle reste toutefois au niveau de la zone `klirline.ca` : elle challenge aussi les chemins `/api` des autres hôtes de cette zone, sauf `pay.klirline.ca`.** Cela peut gêner un autre projet qui expose son API sur un sous-domaine `klirline.ca`; son impact réel n’a pas été vérifié. Je n’ai pas élargi l’exception à ces projets. La règle `Block Known Bots and Scrapers` lance volontairement un challenge quand le User-Agent contient `curl` (sauf `pay.klirline.ca`); les réponses `403 cf-mitigated: challenge` des sondes curl sont donc attendues et ne décrivent pas le parcours dans Chrome. Cloudflare Access protège le Worker Klirline Social pour les adresses `@klirline.ca`.
- Aucun essai de connexion OAuth ni post réel n’est validé. Le premier administrateur doit être créé par son titulaire avec une adresse `@klirline.ca`, un mot de passe propre et la clé bootstrap conservée dans Cloudflare; les étapes sont dans `CLOUDFLARE-DEPLOIEMENT.md`. L’endpoint bootstrap ouvert directement sans origine preview peut être challengé par le WAF; utilisez le formulaire dans l’application.
- Le contrôle courant de `/api/providers` indique que les identifiants Meta (Instagram/Facebook), LinkedIn, X, Threads et Pinterest sont manquants. Bluesky est prêt côté serveur mais aucun compte n’est autorisé. TikTok est explicitement hors périmètre pour cet outil interne et Twitch n’a pas de publication promotionnelle générique.
- Le Worker frontend de production n’a pas été modifié. L’hôte personnalisé est couvert par DNS et certificat Cloudflare. La règle anti-curl ne vise pas un navigateur Chrome normal; ouvrir la preview avec une adresse `@klirline.ca` via Cloudflare Access. L’aperçu `workers.dev` sert à l’essai manuel; Préférences signale sa compatibilité de session intersite. Avant d’utiliser d’autres API hébergées sur des sous-domaines `klirline.ca`, vérifier qu’elles ne sont pas touchées par `Challenge API Spam` ou restreindre explicitement cette règle à l’hôte de l’API sociale après validation sécurité.
- Les endpoints publics de l’API signalent les identifiants Meta, LinkedIn, X, Threads et Pinterest manquants. Bluesky est configuré, mais aucun compte n’est autorisé. TikTok reste manuel et Twitch hors périmètre de publication générique.
- En mode manuel, l’équipe peut tester la préparation d’une campagne et les liens de profils dans l’aperçu. Cela ne publie pas automatiquement et les brouillons/médias du mode local restent sur l’appareil utilisé.
- Un essai local est actuellement visible dans l’onglet `workers.dev` utilisé pour la vérification : une campagne de démonstration a été préparée pour le profil Instagram, avec l’état « À publier ». Cela confirme la préparation et le suivi manuel seulement; aucun réseau n’a reçu de requête de publication. Les données de cet essai restent dans le stockage local de ce navigateur. Pour refaire le parcours : **Comptes sociaux → Ajouter un profil**, puis **Créer une publication → Préparer les publications**.

## Écarts à traiter avant un usage régulier par toute l’équipe

- Appliquer toutes les migrations jusqu’à 0015 avant d’utiliser les brouillons partagés, les métadonnées de campagne, les sessions OAuth Bluesky, les textes alternatifs et plusieurs comptes par réseau. Vérifier `/api/health` après migration.
- Les brouillons partagés prennent en charge un pays, une langue, une destination et un fuseau horaire par variante; créer une variante distincte pour chaque adaptation pays/langue.
- Garder `REQUIRE_APPROVED_DRAFTS=true`; en mode interne, le Worker impose aussi cette barrière indépendamment de cette variable. Vérifier `/api/health` après chaque déploiement.
- Valider les accès et publier de vrais essais contrôlés sur chaque réseau que Klirline prévoit d’utiliser; les liens de profil seuls ne donnent aucun droit de publication.
- Choisir les réseaux prioritaires pays par pays, en fonction des comptes officiels, permissions et politiques régionales réellement disponibles.
