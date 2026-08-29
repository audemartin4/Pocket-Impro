/**
 * Quelle ligne de la table `app_data` l'appli utilise.
 *
 * "main" en production, et rien d'autre : la variable n'est définie nulle part sur Netlify. En
 * développement, poser `VITE_APP_DATA_ID=dev` dans son `.env` bascule sur une ligne à part —
 * indispensable, car un serveur de dev branché sur "main" écrit dans les vraies données de la
 * troupe : c'est ainsi qu'un plan de cours enregistré a été perdu le 2026-08-28, écrasé par un
 * onglet de test resté ouvert.
 *
 * Partagé entre `main.jsx` (lecture/écriture) et `App.jsx` (abonnement temps réel), qui doivent
 * évidemment parler de la même ligne.
 */
export const APP_DATA_ROW_ID = import.meta.env.VITE_APP_DATA_ID || "main";
