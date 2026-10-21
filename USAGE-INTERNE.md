# Klirline Social Publisher — plan d’usage interne

**Objectif :** permettre aux équipes Klirline de préparer, coordonner, programmer et publier les campagnes de promotion de ses services dans les pays desservis par l’entreprise. L’application n’est pas un produit vendu à des clients.

## Accès et sécurité

- L’API Cloudflare est configurée avec `INTERNAL_MODE=true` et `ALLOW_PUBLIC_SIGNUP=false`.
- Le premier compte administrateur se crée uniquement avec la clé bootstrap. Ne partagez pas ce compte ni sa clé.
- L’administrateur invite les employés dans Préférences avec leur courriel professionnel et un rôle rédacteur ou lecteur. Le lien secret expire après 48 heures et ne peut être utilisé qu’une seule fois; transmettez-le par un canal interne approuvé.
- Les connexions sociales, publications, médias et programmations sont partagés dans l’espace Klirline. Seul l’administrateur gère les connexions OAuth et les membres. Un rédacteur peut publier et programmer; un lecteur peut consulter.
- Désactiver un membre révoque ses sessions sans supprimer les campagnes qu’il a créées. Pour le réactiver, l’administrateur utilise le contrôle Réactiver; l’ancien mot de passe reste le sien et une nouvelle connexion est nécessaire.
- Ne collectez jamais les mots de passe des réseaux sociaux. Utilisez les autorisations OAuth officielles et retirez l’accès des personnes qui quittent l’équipe.
- Gardez séparés l’environnement de test et les comptes sociaux réels. Protégez les secrets, limitez les administrateurs et vérifiez les journaux de déploiement.
- Consultez le journal d’activité dans Préférences après les invitations, changements d’accès, connexions sociales, publications et programmations; il conserve les 100 événements les plus récents sans enregistrer le texte des publications.

## Fonctionnalités actuellement disponibles

Le pilote API permet la publication et la programmation vers Instagram professionnel, une Page Facebook, une Page LinkedIn, Threads, X et Pinterest, sous réserve des accès développeur et autorisations réels. X accepte texte et images JPEG/PNG jusqu’à 5 Mo; Pinterest publie une image dans le tableau choisi par l’administrateur. Les essais locaux utilisent des réponses fournisseur simulées; les publications réelles doivent être validées sur les comptes Klirline. TikTok et Bluesky ne sont pas implémentés dans le Worker; Twitch n’est pas un canal de publication générique. L’app indique le résultat par destination; une erreur ou une action requise doit être traitée avant de considérer une campagne diffusée. Si une programmation affiche que le résultat de l’envoi est incertain après une interruption du Worker, vérifiez d’abord le compte social concerné. Ne relancez pas avant d’avoir vérifié si le réseau a déjà créé la publication, afin d’éviter un doublon.

Les plafonds opérationnels par défaut sont de 100 profils sociaux et 5 000 publications par mois (`WORKSPACE_MAX_CONNECTED_ACCOUNTS` et `WORKSPACE_MONTHLY_PUBLICATION_CAP`). Ce sont des garde-fous techniques configurables, pas des forfaits ou des limites de facturation.

## Processus de campagne multi-pays

1. Confirmer le pays, le public visé, la langue et le service promu.
2. Faire relire le texte traduit par une personne compétente; vérifier les promesses de service, prix, conditions et exigences locales avant publication.
3. Adapter le format au réseau et au pays; sélectionner uniquement les comptes officiels autorisés.
4. Enregistrer chaque campagne dans les brouillons partagés et faire approuver le contenu exact par un administrateur avant diffusion. Avec `REQUIRE_APPROVED_DRAFTS=true`, le Worker bloque techniquement les publications API et programmations qui ne référencent pas un brouillon approuvé dont le texte, les destinations et le média correspondent exactement. Toute modification du contenu exige une nouvelle approbation.
5. Choisir le fuseau horaire IANA du public ciblé dans l’éditeur et vérifier l’heure affichée dans le calendrier; la programmation est conservée en UTC et porte son fuseau de destination.
6. Après envoi, contrôler l’état et l’URL de chaque publication directement dans le réseau. Pour un résultat incertain après interruption du Worker, vérifier le compte avant toute nouvelle tentative. Traiter les échecs, doublons possibles, quotas et demandes de reconnexion.

## Mise en service et exploitation

- Publier le frontend avec Workers Static Assets à la racine du dépôt et déployer l’API séparément depuis `cloudflare-api/`.
- Configurer D1/R2, les secrets, les origines HTTPS, les callbacks OAuth et le domaine d’API; conserver l’inscription publique désactivée.
- Vérifier `/api/health`, les connexions, le téléversement d’image, une publication de test contrôlée, une programmation/annulation et le traitement Cron avant usage opérationnel.
- Mettre en place des sauvegardes D1, une vérification de restauration, alertes de disponibilité, un responsable support interne et les procédures de suppression/révocation.
- Les politiques de confidentialité et la page de suppression restent nécessaires pour les revues de plateformes et les demandes des personnes concernées; elles doivent correspondre aux pratiques réellement déployées et être validées.

## Écarts à traiter avant un usage régulier par toute l’équipe

- Appliquer toutes les migrations jusqu’à 0012 avant d’utiliser les brouillons partagés, les métadonnées de campagne et la barrière d’approbation. Vérifier `/api/health` après migration.
- Les brouillons partagés prennent en charge un pays, une langue, une destination et un fuseau horaire par variante; créer une variante distincte pour chaque adaptation pays/langue.
- Le Worker applique la barrière d’approbation seulement si `REQUIRE_APPROVED_DRAFTS=true`; garder cette valeur activée dans les environnements internes et vérifier sa valeur dans Cloudflare avant le lancement des campagnes.
- Valider les accès et publier de vrais essais contrôlés sur chaque réseau que Klirline prévoit d’utiliser; les liens de profil seuls ne donnent aucun droit de publication.
- Choisir les réseaux prioritaires pays par pays, en fonction des comptes officiels, permissions et politiques régionales réellement disponibles.
