# Guide de campagne internationale Klirline

Cet outil est réservé aux équipes Klirline. Il sert à coordonner la promotion des services dans les pays desservis; il n’est pas commercialisé et ne traite aucun paiement.

## Préparer une campagne par marché

1. Créer une variante par combinaison pays, langue et public cible. Utiliser le code pays ISO 3166-1 alpha-2 (ex. `CA`) et une balise de langue BCP 47 (ex. `fr-CA`, `en-CA`).
2. Faire relire la traduction par une personne connaissant le marché. Vérifier les noms des services, les prix locaux, les affirmations, les liens, les règles de publicité et les restrictions sectorielles avant d’approuver.
3. Choisir les comptes officiels du pays et les destinations qui conviennent au public. L’espace peut contenir plusieurs comptes d’un même réseau. Facebook et LinkedIn ajoutent les Pages autorisées par le titulaire OAuth; connectez séparément les comptes Instagram, Threads, X, Pinterest ou Bluesky nécessaires. La connexion API correspond à un consentement OAuth valide; un simple lien de profil ne donne aucun accès.
4. Programmer avec le fuseau IANA du public visé (ex. `America/Toronto`, `Europe/Paris`) et vérifier l’heure locale dans le calendrier.
5. Après l’envoi, vérifier le statut par réseau et ouvrir le post directement sur la plateforme. Ne considérer la campagne comme diffusée que si la destination confirme la publication.

## Modes de publication

| Réseau | Mode dans le pilote | À confirmer avant usage réel |
|---|---|---|
| Instagram, Facebook Pages, LinkedIn Pages, Threads, X, Pinterest, Bluesky | Publication et programmation côté Worker sur un ou plusieurs comptes sélectionnés | App développeur, scopes, consentement, formats et test contrôlé sur chaque compte officiel; Bluesky exige HTTPS, une session OAuth et un alt text avec image |
| TikTok | Préparation locale, puis confirmation manuelle par un membre | L’API Direct Post n’est pas adaptée à cet outil interne selon les règles de partage TikTok |
| Twitch | Lien de profil et préparation manuelle | Le produit ne publie pas de post promotionnel générique sur Twitch |

Le code de ces intégrations ne prouve pas qu’un compte réel est connecté ni qu’une publication publique sera acceptée. Pour les contenus vidéo, utiliser uniquement les parcours manuels qui apparaissent dans l’interface; l’API de publication actuelle accepte seulement les formats documentés par destination.

## Gouvernance de l’équipe

- L’administrateur garde les connexions OAuth et invite chaque membre avec son propre compte et le rôle minimal nécessaire.
- Les brouillons sont partagés et envoyés en relecture. En mode interne, toute publication API et programmation automatique doit utiliser le contenu exact d’un brouillon approuvé par un administrateur, y compris les comptes de destination précis. Si l’envoi échoue ou nécessite une action, corrigez le brouillon et envoyez-le de nouveau en relecture. Les destinations en mode manuel restent confirmées directement sur le réseau.
- Retirer rapidement l’accès d’un membre qui quitte l’équipe et révoquer son consentement dans chaque réseau social.
- Ne jamais demander ni enregistrer un mot de passe de réseau social.

## Vérifications de lancement interne

- API et application accessibles uniquement sous les domaines HTTPS contrôlés par Klirline.
- Base D1, bucket R2, secrets, migrations, callbacks OAuth et tâche Cron configurés sur l’environnement cible.
- Sauvegarde D1 testée, rétention des données appliquée et alertes d’exploitation attribuées à un responsable.
- Chaque connexion et destination testées avec une publication non sensible, contrôlée par l’équipe, puis supprimée si nécessaire.
- Procédure de suppression/révocation et contacts internes connus par les administrateurs.

## Limites actuelles à suivre

L’interface locale conserve les profils manuels, brouillons et rappels dans le navigateur. Les rappels manuels dépendent de cet appareil et ne publient pas automatiquement. Le Worker permet la publication API pour sept réseaux sous réserve d’autorisations réelles et d’une mise en service de l’API. L’inscription publique reste désactivée et l’espace ne comporte aucun paiement ni abonnement.
