# Klirline Social Publisher — plan d’usage interne

**Objectif :** permettre aux équipes Klirline de préparer, coordonner, programmer et publier les campagnes de promotion de ses services dans les pays desservis par l’entreprise. L’application n’est pas un produit vendu à des clients.

## Accès et sécurité

- L’API Cloudflare est configurée avec `INTERNAL_MODE=true` et `ALLOW_PUBLIC_SIGNUP=false`.
- Le premier compte administrateur se crée uniquement avec la clé bootstrap. Ne partagez pas ce compte ni sa clé.
- L’outil ne doit être accessible qu’aux employés et prestataires expressément autorisés, avec des comptes individuels. Le provisionnement des membres supplémentaires et les espaces partagés ne sont pas encore livrés; ne créez pas de comptes en contournant cette limite.
- Ne collectez jamais les mots de passe des réseaux sociaux. Utilisez les autorisations OAuth officielles et retirez l’accès des personnes qui quittent l’équipe.
- Gardez séparés l’environnement de test et les comptes sociaux réels. Protégez les secrets, limitez les administrateurs et vérifiez les journaux de déploiement.

## Fonctionnalités actuellement disponibles

Le pilote API permet la publication texte/image et la programmation vers Instagram professionnel, une Page Facebook et une Page LinkedIn, sous réserve des accès développeur et autorisations réels. Les autres réseaux de la liste Klirline ne sont pas implémentés dans le Worker de production. L’app indique le résultat par destination; une erreur ou une action requise doit être traitée avant de considérer une campagne diffusée.

Les limites serveur configurées pour le mode interne sont de 9 comptes et 5 000 publications par mois. Elles servent de garde-fous techniques, et ne constituent pas une offre ou une facturation.

## Processus de campagne multi-pays

1. Confirmer le pays, le public visé, la langue et le service promu.
2. Faire relire le texte traduit par une personne compétente; vérifier les promesses de service, prix, conditions et exigences locales avant publication.
3. Adapter le format au réseau et au pays; sélectionner uniquement les comptes officiels autorisés.
4. Pour les campagnes sensibles, demander l’approbation d’un responsable Klirline avant programmation. Cette approbation reste un processus d’équipe externe à l’application pour le moment.
5. Programmer en tenant compte du fuseau horaire du public ciblé; noter l’heure locale dans le plan de campagne et vérifier le rendu UTC affiché par l’outil.
6. Après envoi, contrôler l’état et l’URL de chaque publication directement dans le réseau. Traiter les échecs, doublons possibles, quotas et demandes de reconnexion.

## Mise en service et exploitation

- Publier le site statique avec Cloudflare Pages et déployer l’API séparément depuis `cloudflare-api/`.
- Configurer D1/R2, les secrets, les origines HTTPS, les callbacks OAuth et le domaine d’API; conserver l’inscription publique désactivée.
- Vérifier `/api/health`, les connexions, le téléversement d’image, une publication de test contrôlée, une programmation/annulation et le traitement Cron avant usage opérationnel.
- Mettre en place des sauvegardes D1, une vérification de restauration, alertes de disponibilité, un responsable support interne et les procédures de suppression/révocation.
- Les politiques de confidentialité et la page de suppression restent nécessaires pour les revues de plateformes et les demandes des personnes concernées; elles doivent correspondre aux pratiques réellement déployées et être validées.

## Écarts à traiter avant un usage régulier par toute l’équipe

- Ajouter la gestion sécurisée des membres avec invitations, rôles et révocation de compte.
- Partager proprement les connexions, médias, brouillons, publications et programmations au niveau de l’espace Klirline, avec attribution de l’auteur et journal d’audit.
- Ajouter les campagnes multilingues, pays/cibles, fuseaux horaires explicites et un circuit d’approbation interne.
- Valider les accès et publier de vrais essais contrôlés sur chaque réseau que Klirline prévoit d’utiliser; les liens de profil seuls ne donnent aucun droit de publication.
- Choisir les réseaux prioritaires pays par pays, en fonction des comptes officiels, permissions et politiques régionales réellement disponibles.
