# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install      # première fois seulement
npm run dev      # serveur de dev Vite (http://localhost:5173)
npm run build    # build de production
npm run preview  # sert le build de production
```

Pas de tests, pas de linter configurés dans ce projet.

Prérequis : copier `.env.example` vers `.env` et y renseigner `VITE_SUPABASE_URL` et
`VITE_SUPABASE_ANON_KEY` (voir README.md pour le SQL de création de la table `app_data`).
Sans ces variables, l'appli démarre mais ne peut ni lire ni écrire les données.

## Architecture

Appli **Vite + React + Tailwind**, francophone, à destination d'une troupe d'improvisation théâtrale
(les Idéphiles). Origine : un artifact Claude.ai exporté en vrai projet — d'où deux particularités
structurantes qui expliquent beaucoup du code.

### 1. Tout tient dans un seul blob JSON partagé

`src/main.jsx` recrée `window.storage` (l'API de stockage propre à l'environnement Artifacts), mais
branchée sur **une table Supabase à une seule ligne** (`app_data`, `id = "main"`) au lieu de
`localStorage`. Tout l'état applicatif — exercices, catégories, concepts de spectacle, plans de cours
et de spectacle — vit dans **un unique objet JSON** dans la colonne `value`.

Conséquences pratiques :

- `App.jsx` n'a aucune notion de Supabase pour les données métier : il appelle `window.storage.get/set`.
- Les écritures sont **debouncées à 500 ms** puis écrasent tout le blob (`useAppData`, `App.jsx`).
  Pas de fusion : deux éditions simultanées → la dernière gagne.
- Un canal **Supabase Realtime** (`postgres_changes` sur `app_data`) resynchronise les autres
  navigateurs. `lastSentRef` sert à ignorer l'écho de sa propre écriture.
- Toute donnée métier se modifie via le helper `update((d) => …)`, qui fait un `structuredClone` du
  blob complet — on mute donc librement le clone.

### 2. Les migrations de données, pas les fichiers de seed

Les données de seed (`SEED`, `CATEGORIES_A_FUSIONNER`, `CATEGORIES_DETAILLEES`,
`EXERCICES_ECHAUFFEMENT`, `EXERCICES_PRE_IMPRO`, `EXERCICES_IMPRO`) ne s'appliquent qu'à une base
vierge. Les utilisateurs existants ont déjà leur blob en base : **modifier une constante de seed ne
change rien pour eux.**

Pour faire évoluer des données déjà enregistrées, il faut ajouter une **migration one-shot** dans
`mergeMissingCategories()` (`App.jsx`), sur le modèle des dizaines déjà présentes :

```js
let monChangementV1 = data._monChangementV1;
if (!monChangementV1 && categories) {
  categories = categories.map(…);
  monChangementV1 = true;
}
```

Puis ajouter le flag **à deux endroits** en fin de fonction : la condition de sortie anticipée
(`if (… === data._monChangementV1) return data;`) et l'objet retourné (`_monChangementV1: monChangementV1`).
Oublier l'un des deux casse silencieusement la migration.

Le flag `_…V1` garantit que la migration ne se rejoue jamais, pour ne pas écraser une modification
manuelle faite ensuite par un utilisateur dans l'interface.

### 3. Authentification et permissions : Supabase Auth, séparé du blob

`src/auth.js` gère les **vrais comptes** via Supabase Auth (`signUp`/`signIn`/reset password) et
charge le profil associé (`username`, `troupe`, `ville`, `is_admin`) depuis la table `profiles`.
C'est distinct des données métier du blob.

Deux tables Supabase seulement : `app_data` (le blob) et `profiles`. **Chaque opération SQL réellement
effectuée par l'appli a besoin d'une policy RLS correspondante** (SELECT/INSERT/UPDATE/DELETE) — une
policy manquante fait échouer l'opération de façon parfois silencieuse (`window.storage.set` est
appelé avec `.catch(() => {})`). En cas de comportement « ça ne sauvegarde pas », vérifier
`select * from pg_policies where tablename = '…'` avant de chercher un bug dans le code.

### 4. Modération : `data` vs `publicData`

Les fiches créées par la communauté ont des drapeaux `pending` / `rejected`. Dans `ImproApp` :

- **`publicData`** filtre les fiches non validées — à passer à tout ce qui doit rester fiable
  (générateurs de cours/spectacle/échauffement, recherche, tirage aléatoire, favoris, plans).
- **`data`** (non filtré) va aux pages de modération, aux pages « mes créations », et à l'édition —
  c'est là que la validation a lieu et que le créateur retrouve une fiche refusée.

Choisir le mauvais des deux est le piège classique de ce fichier.

### 5. `App.jsx` : un seul fichier de ~8400 lignes

Volontairement monolithique (héritage de l'artifact). Organisation interne :

- **Constantes de domaine** en haut : `COLORS`, polices, `NIVEAUX`, `ENERGIES`, `FORMATS_JEU`,
  `SECTIONS_EXERCICE`, familles d'objectifs, puis les gros tableaux de seed.
- **Composants UI réutilisables** (~l.1275-1830) : `IndexCard`, `Btn`, `Field`, `ExercisePicker`,
  `CategoryPicker`, etc.
- **`ImproApp`** (l.1843) : racine. La navigation est un `useState` `tab` synchronisé avec
  `window.location.hash` et l'historique du navigateur ; le rendu est une longue liste de
  `{tab === "…" && <XxxTab … />}`.
- **Un composant `XxxTab` par écran**, puis les générateurs (`buildCours`, `buildSpectacle`) et les
  exports PDF (`exportCoursePlanPDF`, `exportSpectaclePlanPDF`) tout en bas.

Google Fonts et **jsPDF sont chargés dynamiquement au runtime** via des balises injectées dans
`ImproApp` — pas de dépendance npm pour le PDF.

### Vocabulaire métier

Distinctions à respecter, elles pilotent les générateurs :

- **Exercice** vs **Catégorie** : un exercice est un jeu d'entraînement (champ `title`) ; une
  catégorie est un genre de scène jouable en spectacle (champ `name`). Deux formulaires, deux
  bibliothèques, deux pickers distincts.
- **`phase`** d'un exercice : `"Échauffement"` / `"Pré-impro"` / `"Impro"`, complété par les drapeaux
  `warmup` (utilisable en échauffement rapide), `stageWarmup` (échauffement de scène pour ouvrir un
  spectacle) et `dualUse`.
- **`canOpenShow` / `canCloseShow`** sur une catégorie : éligible pour ouvrir/terminer un spectacle.
- **`groupe`** = famille d'objectifs (une seule) ; **`objectives`** = tags (plusieurs). La liste
  maîtresse des tags valides est `SEED.objectifs` — l'appli s'attend à ce que les tags viennent de là.
- **`actualDuration`** : durée resserrée que le générateur a réservée pour ce créneau, prioritaire sur
  la `duration` brute de la fiche. La conserver lors d'un remplacement de carte, sinon le total
  affiché dérive.

## Conventions

- Interface, commentaires et messages de commit : **en français**. Les commentaires expliquent le
  *pourquoi* (souvent un incident passé ou une contrainte utilisateur), pas le *quoi*.
- Style visuel « fiche bristol » : palette `COLORS`, `IndexCard` pour chaque carte, trois polices
  (`FONT_DISPLAY` / `FONT_BODY` / `FONT_MONO`).
- Déploiement : Netlify se déclenche automatiquement sur un push vers `master`.
