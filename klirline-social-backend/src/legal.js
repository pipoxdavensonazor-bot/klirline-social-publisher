// Textes FR : confidentialite, CGU, suppression. Servis en JSON + page HTML simple.
export const LEGAL = {
  privacy: {
    title: "Politique de confidentialite",
    updated: "2026-10-21",
    body: [
      "Responsable : Klirline Services (mono-entreprise, puis multi-clients). Contact : a renseigner.",
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
      "Usage prevu : Klirline interne d abord. L ouverture a des clients exige une app publique par fournisseur (revues).",
      "Interdit : partager des mots de passe, automatiser les navigateurs contre les CGU des plateformes, publier sur un compte sans consentement OAuth du proprietaire.",
      "Limites : quotas et regles de chaque plateforme (X, TikTok audit, LinkedIn approbation…) s appliquent.",
      "Twitch : clips/annonces/gestion de chaine uniquement — pas de cross-post generique.",
    ],
  },
  deletion: {
    title: "Suppression des donnees",
    body: [
      "Dans l app : Deconnecter un reseau supprime sa connexion et planifie la revocation du jeton.",
      "Demande complete : ecrivez a l adresse de contact avec l email du compte — suppression sous 30 jours (compte, connexions, contenus, medias, jobs).",
      "Consequence : les publications deja effectuees sur les reseaux restent soumises aux outils de suppression de chaque plateforme.",
      "Statut : a integrer comme URL officielle dans chaque console developpeur (Meta, LinkedIn, TikTok…), exige pour les revues.",
    ],
  },
};
