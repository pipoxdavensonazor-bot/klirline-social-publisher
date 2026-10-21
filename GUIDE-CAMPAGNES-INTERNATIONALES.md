# Guide de campagne internationale Klirline

Cet outil est réservé aux équipes Klirline. Il sert à coordonner la promotion des services dans les pays desservis; il n’est pas commercialisé et ne traite aucun paiement.

## Préparer une campagne par marché

1. Créer une variante par combinaison pays, langue et public cible. Utiliser le code pays ISO 3166-1 alpha-2 (ex. `CA`) et une balise de langue BCP 47 (ex. `fr-CA`, `en-CA`).
2. Faire relire la traduction par une personne connaissant le marché. Vérifier les noms des services, les prix locaux, les affirmations, les liens, les règles de publicité et les restrictions sectorielles avant d’approuver.
3. Choisir les profils officiels du pays et les destinations qui conviennent au public. La connexion API correspond à un consentement OAuth valide; un simple lien de profil ne donne aucun accès.
4. Programmer avec le fuseau IANA du public visé (ex. `America/Toronto`, `Europe/Paris`) et vérifier l’heure locale dans le calendrier.
5. Après l’envoi, vérifier le statut par réseau et ouvrir le post directement sur la plateforme. Ne considérer la campagne comme diffusée que si la destination confirme la publication.

## Modes de publication

| Réseau | Mode dans le pilote | À confirmer avant usage réel |
|---|---|---|
| Instagram, Facebook Page, LinkedIn, Threads, X, Pinterest | Publication et programmation côté Worker lorsqu’un compte est connecté | App développeur, scopes, consentement, formats et test contrôlé sur le compte officiel |
| TikTok, Bluesky | Préparation locale, puis confirmation manuelle par un membre | Pas d’adaptateur de publication dans le Worker; la politique TikTok rend le Direct Post inadapté au périmètre interne actuel |
| Twitch | Lien de profil et préparation manuelle | Le produit ne publie pas de post promotionnel générique sur Twitch |

Le code de ces intégrations ne prouve pas qu’un compte réel est connecté ni qu’une publication publique sera acceptée. Pour les contenus vidéo, utiliser uniquement les parcours manuels qui apparaissent dans l’interface; l’API de publication actuelle accepte seulement les formats documentés par destination.

## Gouvernance de l’équipe

- L’administrateur garde les connexions OAuth et invite chaque membre avec son propre compte et le rôle minimal nécessaire.
- Les brouillons peuvent être partagés et envoyés en relecture. La relecture n’est pas encore une barrière technique à la publication directe; pour une campagne sensible, exiger l’approbation du responsable dans le processus d’équipe avant l’envoi.
- Retirer rapidement l’accès d’un membre qui quitte l’équipe et révoquer son consentement dans chaque réseau social.
- Ne jamais demander ni enregistrer un mot de passe de réseau social.

## Vérifications de lancement interne

- API et application accessibles uniquement sous les domaines HTTPS contrôlés par Klirline.
- Base D1, bucket R2, secrets, migrations, callbacks OAuth et tâche Cron configurés sur l’environnement cible.
- Sauvegarde D1 testée, rétention des données appliquée et alertes d’exploitation attribuées à un responsable.
- Chaque connexion et destination testées avec une publication non sensible, contrôlée par l’équipe, puis supprimée si nécessaire.
- Procédure de suppression/révocation et contacts internes connus par les administrateurs.

## Limites actuelles à suivre

L’interface locale conserve les profils manuels, brouillons et rappels dans le navigateur. Les rappels manuels dépendent de cet appareil et ne publient pas automatiquement. Le Worker permet la publication API pour six réseaux sous réserve d’autorisations. L’inscription publique reste désactivée et l’espace ne comporte aucun paiement ni abonnement.
