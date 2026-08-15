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
2. Dans l'éditeur SQL du projet, exécuter :

```sql
create table app_data (
  id text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table app_data replica identity full;
alter table app_data enable row level security;
create policy "public read/write" on app_data for all using (true) with check (true);
alter publication supabase_realtime add table app_data;
```

3. Dans **Project Settings → API**, récupérer l'URL du projet et la clé `anon`/`public`, et les
   coller dans `.env` :

```
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### Limites connues de cette version

- **Pas d'authentification Supabase, pas de règles de sécurité par utilisateur** : la table
  `app_data` est lisible/écrivable par quiconque a la clé publique — comme un document partagé sans
  droits fins. C'est suffisant pour une petite troupe de confiance, mais pas pour un usage grand
  public.
- **Mots de passe des comptes toujours en clair** dans les données (`data.accounts`), comme avant —
  ce n'était pas dans le périmètre de ce chantier.
- **Pas de fusion en cas d'écriture simultanée** : si deux personnes modifient les données à
  quelques secondes d'intervalle, la dernière sauvegarde écrase l'autre.

Une vraie sécurisation (comptes Supabase Auth, mots de passe hachés, tables relationnelles avec
permissions par ligne) resterait un chantier séparé, plus lourd, à envisager si l'usage grandit.

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
