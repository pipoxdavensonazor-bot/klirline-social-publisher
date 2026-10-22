// Textes FR : confidentialite, CGU, suppression. Servis en JSON + page HTML simple.
export const LEGAL = {
  privacy: {
    title: "Politique de confidentialite",
    updated: "2026-10-21",
    body: [
      "Responsable : a renseigner avant lancement. Contact : a renseigner.",
      "Donnees : compte utilisateur (email, role), connexions OAuth (labels de compte, scopes, expiration — JAMAIS les mots de passe), contenus rediges, journaux d envoi, medias temporaires.",
      "Jetons OAuth : echanges et chiffres cote serveur (AES-256-GCM), jamais exposes au navigateur ni stockes en localStorage.",
      "Medias : stockes temporairement pour l envoi, supprimes selon la politique (30 jours max par defaut).",
      "Partage : uniquement les API officielles des reseaux choisis, avec votre consentement OAuth par reseau.",
      "Droits : acces, rectification, suppression — voir section Suppression des donnees.",
    ],
  },
  terms: {
    title: "Conditions d utilisation",
    body: [
      "Usage prevu : outil interne reserve aux membres autorises de l equipe Klirline. Aucune inscription publique ni facturation.",
      "Interdit : partager des mots de passe, automatiser les navigateurs contre les CGU des plateformes, publier sur un compte sans consentement OAuth du proprietaire.",
      "Limites : quotas et regles de chaque plateforme (X, TikTok audit, LinkedIn approbation…) s appliquent.",
      "Twitch : clips/annonces/gestion de chaine uniquement — pas de cross-post generique.",
    ],
  },
  deletion: {
    title: "Suppression des donnees",
    body: [
      "Dans l app : utilisez Préférences > Supprimer mon compte pour supprimer le compte, ses connexions enregistrées, contenus, programmation et médias du serveur après confirmation du mot de passe.",
      "La suppression locale du jeton ne retire pas automatiquement l’autorisation accordée à la plateforme sociale. Révoquez également l’accès Klirline dans les paramètres de chaque réseau connecté.",
      "Consequence : les publications deja effectuees sur les reseaux restent soumises aux outils de suppression de chaque plateforme.",
      "Pour toute demande d’assistance à la suppression, contactez le responsable à l’adresse de confidentialité publiée sur le site.",
    ],
  },
};
