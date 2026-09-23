# Pocket impro — export pour Claude Code

Ce dossier contient l'appli **Pocket impro, l'assistant des Idéphiles**, exportée depuis
l'environnement Artifacts de Claude.ai vers un vrai projet **Vite + React + Tailwind**, prêt à être
repris avec Claude Code (ou n'importe quel éditeur/terminal).

## Ce qui a été fait pour cet export

- `src/App.jsx` : le composant tel quel, logique inchangée à l'exception d'une petite synchronisation
  temps réel ajoutée dans `useAppData()` (voir plus bas).
- `src/main.jsx` : point d'entrée. Il recrée `window.storage` (l'API de stockage propre à Artifacts),
  mais branchée sur une table Supabase partagée au lieu de `localStorage`, pour que `App.jsx` n'ait
  besoin d'aucun changement pour lire/écrire les données.
- `index.html`, `vite.config.js`, `tailwind.config.js`, `postcss.config.js`, `package.json` : setup
  Vite standard, avec Tailwind configuré (dans Artifacts, Tailwind était fourni par la plateforme —
  ici il faut l'installer et le configurer soi-même, ce qui est fait).
- Polices Google Fonts et jsPDF : toujours chargés dynamiquement au runtime (comme avant), aucun
  changement nécessaire — ça fonctionne pareil dans un vrai navigateur.

## Démarrer le projet

1. Copier `.env.example` vers `.env` et y renseigner tes clés Supabase (voir section suivante) :

```bash
cp .env.example .env
```

2. Installer et lancer :

```bash
npm install
npm run dev
```

Puis ouvrir l'URL affichée (en général `http://localhost:5173`).

## Backend partagé (Supabase)

Les données de l'appli (`impro-data`) sont maintenant stockées dans une table Supabase partagée par
toute la troupe, au lieu du `localStorage` de chaque navigateur. Tout le monde voit donc les mêmes
exercices, catégories, comptes, messages et plans, mis à jour en direct (Supabase Realtime).

Pour brancher ton propre projet Supabase :

1. Créer un compte et un projet gratuit sur [supabase.com](https://supabase.com).
2. Appliquer les migrations du dossier [`supabase/migrations`](supabase/migrations) — elles créent
   les trois tables, les règles de sécurité (RLS) et les droits d'accès à l'API :

```bash
npx supabase link --project-ref <ref-du-projet>
npx supabase db push
```

   Elles peuvent aussi se coller une par une, dans l'ordre des noms de fichiers, dans l'éditeur SQL
   du tableau de bord. **Ne pas créer les tables à la main** : depuis le 30 octobre 2026, une table
   créée sans `grant` explicite n'est pas joignable par l'API et l'appli répond « permission
   denied » (voir la règle des nouvelles tables dans [CLAUDE.md](CLAUDE.md)).

3. Dans **Project Settings → API**, récupérer l'URL du projet et la clé `anon`/`public`, et les
   coller dans `.env` :

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### Limites connues de cette version

*(Cette section décrivait l'état de l'été 2026. Les trois points d'alors — pas d'authentification,
mots de passe en clair, pas de fusion — sont réglés depuis : les comptes passent par Supabase Auth
(`src/auth.js`, table `profiles`), et les écritures concurrentes se fusionnent ligne par ligne
(`src/fusionBlob.js`). Ce qui reste :)*

- **`app_data` reste modifiable par quiconque a la clé publique** — laquelle est, par construction,
  dans le JavaScript que tout visiteur télécharge. Côté appli, plus rien ne s'écrit sans compte : la
  garde est dans `update()`, le point de passage unique des écritures. Mais une garde en JavaScript
  se contourne depuis la console du navigateur ; tant que `anon` garde `insert`/`update` en base, le
  verrou n'est pas complet. La suppression de la ligne, elle, est fermée depuis la migration
  `20260924133004`.
- **Tout tient dans une seule ligne** : une écriture fautive touche tout le monde à la fois. D'où
  la sauvegarde quotidienne automatique (`app_data_sauvegardes`, 30 jours de rétention).

Pour un build de production :

```bash
npm run build
npm run preview
```

## Structure du projet

```
pocket-impro-project/
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── .env.example        ← modèle pour les clés Supabase (à copier en .env)
├── src/
│   ├── main.jsx         ← point d'entrée + window.storage branché sur Supabase
│   ├── supabaseClient.js ← création du client Supabase
│   ├── App.jsx           ← toute l'appli (logique inchangée depuis Artifacts)
│   └── index.css         ← directives Tailwind
└── README.md              ← ce fichier
```
