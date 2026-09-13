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

**En développement, toujours poser `VITE_APP_DATA_ID=dev`** dans son `.env` : sans elle, le serveur
de dev lit ET écrit dans `main`, c'est-à-dire dans les données réelles de la troupe — toute fiche de
test, toute manipulation d'écran s'y enregistre pour tout le monde. La ligne `dev` est une copie de
`main`, à rafraîchir au besoin :
`insert into app_data (id, value) select 'dev', value from app_data where id='main'
 on conflict (id) do update set value = excluded.value;`

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
- Les écritures sont **debouncées à 500 ms**. `window.storage.set` **relit la base puis fusionne**
  avant d'écrire (`src/fusionBlob.js`) : chaque onglet n'impose que ce qu'il a lui-même modifié
  depuis sa dernière lecture, le reste vient de la base. Les listes d'objets à `id` se fusionnent
  élément par élément (ajouts des deux côtés conservés, suppressions respectées) ; sur une même
  fiche modifiée des deux côtés, le dernier écrivain gagne — mais sur cette fiche seulement.
  `set` renvoie la valeur réellement écrite, que `useAppData` adopte pour ne pas la réécraser.
- Un canal **Supabase Realtime** (`postgres_changes` sur `app_data`) resynchronise les autres
  navigateurs. `lastSentRef` sert à ignorer l'écho de sa propre écriture.
- Toute donnée métier se modifie via le helper `update((d) => …)`, qui fait un `structuredClone` du
  blob complet — on mute donc librement le clone.

**Sauvegardes.** Tout tenant dans une seule ligne, une écriture fautive efface tout le monde : c'est
arrivé trois fois (banque de manches vidée, plan de cours « Test03 » perdu). Un trigger
`app_data_archive` archive donc, à la **première modification de chaque journée**, l'état d'avant
cette modification, dans `app_data_sauvegardes` (30 jours de rétention, ~192 Ko par instantané). La
table est fermée aux clés publiques et la fonction avale ses propres erreurs : une sauvegarde
impossible ne doit jamais empêcher l'appli d'enregistrer. Pour restaurer une journée entière :

```sql
update app_data a set value = s.value
from app_data_sauvegardes s
where a.id = 'main' and s.row_id = 'main' and s.jour = '2026-09-06';
```

Pour ne remettre qu'une partie (recommandé si le reste a bougé depuis) :
`... set value = a.value || jsonb_build_object('ambassadeurManches', s.value->'ambassadeurManches')`.

**Cause connue des pertes** (corrigée le 2026-09-06) : quand la première lecture échouait — 401
« JWT expired » au réveil d'un téléphone — `useAppData` repartait du `SEED`, et l'effet d'écriture
renvoyait cette base inventée par-dessus le contenu réel 500 ms plus tard, sans aucun message.
D'où deux règles à ne pas défaire : **ne jamais retomber sur le `SEED` après une lecture ratée**
(seulement après une lecture réussie qui ne trouve aucune ligne), et **ne jamais écrire depuis un
onglet qui n'a jamais réussi à lire** (`dernierEtatConnu === null` ⇒ on adopte la base, on ne
l'écrase pas).

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

Deux tables Supabase seulement côté appli : `app_data` (le blob) et `profiles` — la troisième,
`app_data_sauvegardes`, n'est alimentée que par un trigger et reste fermée aux clés publiques (voir
« Sauvegardes »). **Chaque opération SQL réellement
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

### 5. `App.jsx` : un seul fichier de ~10 800 lignes

Volontairement monolithique (héritage de l'artifact). Les numéros de ligne ci-dessous bougent à
chaque ajout : chercher plutôt le nom. Organisation interne :

- **Constantes de domaine** en haut : `COLORS`, polices, `NIVEAUX`, `ENERGIES`, `FORMATS_JEU`,
  `SECTIONS_EXERCICE`, `EXERCICES_PROCHES`, familles d'objectifs, puis les gros tableaux de seed.
- **Composants UI réutilisables** (à partir de `/* Small UI atoms */`) : `IndexCard`, `Btn`, `Field`,
  `SearchableMultiSelect`, `SearchableSingleSelect`, `ExercisePicker`, `CategoryPicker`, etc.
- **Cartes de programme** : `ProgrammeExerciseCard` / `ProgrammeCategoryCard` servent les trois
  écrans qui affichent un programme (générateur de cours, générateur de spectacle, plans
  enregistrés). Ce qui diffère d'un écran à l'autre passe par des emplacements (`star`, `badges`,
  `actions`, `footerRight`…), jamais par une variante interne : toute retouche de présentation se
  fait donc une seule fois. Le glisser-déposer (`useDragReorder` + `data-drop-card`) est branché
  par l'écran appelant, pas par la carte.
- **`ImproApp`** : racine. La navigation est un `useState` `tab` synchronisé avec
  `window.location.hash` et l'historique du navigateur ; le rendu est une longue liste de
  `{tab === "…" && <XxxTab … />}`.
- **Un composant `XxxTab` par écran**, puis les générateurs (`buildCours`, `buildSpectacle`) et les
  exports PDF (`exportCoursePlanPDF`, `exportSpectaclePlanPDF`) tout en bas.

Google Fonts et **jsPDF sont chargés dynamiquement au runtime** via des balises injectées dans
`ImproApp` — pas de dépendance npm pour le PDF. jsPDF n'utilise que les polices standard, limitées à
Latin-1 : tout caractère en dehors (tiret cadratin, « œ », apostrophe courbe…) **disparaît
silencieusement** du PDF. Tout texte écrit dans un PDF passe donc par `pdfTexte()`.

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
- **Fiches proches** (`EXERCICES_PROCHES`) : paires de titres qui se recoupent (deux variantes du
  même jeu). Les générateurs de **cours** et d'**échauffement** ne doivent jamais en enchaîner deux
  à la suite — elles peuvent figurer dans le même programme, mais pas l'une derrière l'autre, et la
  règle vaut aussi entre le dernier échauffement et le premier exercice. Le bouton **« Aléatoire »**
  d'une carte, lui, reste libre de proposer la fiche voisine : c'est un choix explicite de
  l'utilisateur. La table est indexée par titre (pas un champ de fiche) : elle est symétrique par
  construction, n'exige aucune migration, et un titre encore absent de la bibliothèque est ignoré.
  Renommer une fiche, en revanche, casse le lien sans rien signaler.
- **Fiche d'ouverture** (`EXERCICE_OUVERTURE`, « Les 2 chaises ») : quand le générateur de cours la
  retient, elle passe **en premier exercice**, juste après les échauffements — elle sert à poser la
  théorie selon laquelle la simplicité du jeu se suffit à elle-même, ce qui ne vaut qu'avant les
  autres. La remontée se fait au tirage (`unshift`), jamais par un tri après coup : les cartes déjà
  retenues gardent leurs voisines, donc la règle des fiches proches reste vérifiée. Sa probabilité
  d'être tirée ne change pas ; seule sa place change. Repérée par son titre, comme « Ambassadeur ».
- **`publics`** : tranches d'âge d'une fiche d'exercice (`"Enfants" | "Ados" | "Adultes" | "Senior"`,
  même vocabulaire que `TRANCHES_AGE`). Renseigné sur le lot importé en septembre 2026 et **lu par
  aucun écran pour l'instant** : il attend le « choix par tranche d'âge » annoncé sur l'accueil.
- **Ambassadeur** (jeu de mime) : une **manche** (`ambassadeurManches`) est la brique réutilisable —
  un thème général, un titre, un niveau, des tranches d'âge, 5 mots ; c'est elle qui passe par la
  modération. Classement sur deux niveaux : `themeGeneral` vient de la liste **fermée**
  `AMBASSADEUR_THEMES_GENERAUX` (les utilisateurs n'en créent pas), tandis que le **titre** est le
  champ `theme` (nom historique) — libre, créé à la volée, et c'est LUI le secret de jeu.
  Les deux sont **facultatifs** : afficher une manche par son nom passe par `titreManche()`. Un
  **ambassadeur** (`ambassadeurs`) n'est qu'un assemblage de 3 ids de manches, donc pas de
  modération — et, justement parce qu'il ne regarde que celui qui l'a monté pour son cours, il
  **n'est visible que de son créateur** (`creatorUsername`), Admin compris. Son drapeau `archive` le
  range : il quitte la liste « Ambassadeurs prêts à jouer » et ne reste que dans la section
  Ambassadeur du profil. Les plans de cours, eux, gardent leurs propres manches
  (`ambassadeurMancheIds`) et ne dépendent pas des assemblages.
  Le **titre est un secret de jeu** : les équipes doivent le deviner en fin de manche, il ne doit
  jamais s'afficher sur un écran visible des joueurs (écran de jeu, listes publiques) — seulement
  dans le sommaire du maître du jeu, derrière un bouton de révélation, ou au moment de préparer.
  Le thème général, lui, n'est qu'une étagère de rangement, mais il reste un indice : ne pas
  l'afficher non plus pendant une partie.
  À la création, on choisit de **partager la manche ou non** (« Non » par défaut) : une manche
  `prive` n'est jamais `pending` (rien à modérer), n'entre pas dans le vocabulaire de thèmes commun,
  et n'est visible que de son auteur — **pas même de l'Admin**. Une manche partagée par un membre
  reste ensuite sous **embargo de 14 jours à compter de sa `createdAt`** (pas de sa validation) :
  l'auteur doit pouvoir la faire jouer à ses élèves avant qu'ils puissent lire les mots dans l'appli.
  Toute liste de manches passe par `mancheVisiblePar()` / `manchesJouables()` : les lire directement
  dans `data.ambassadeurManches` laisse fuiter les manches privées ou sous embargo des autres (mots,
  thèmes, suggestions de doublon).

### Écrans mis de côté

`CONCEPTS_SPECTACLE_VISIBLES` (à `false` depuis le 2026-09-06) masque **les concepts de spectacle** :
la carte de la bibliothèque, la tuile du profil et les deux écrans `spectacles` /
`spectacles-crees`, qui ne répondent plus (une adresse tapée à la main affiche une page vide, comme
n'importe quelle adresse inconnue). Rien n'est supprimé : ni `SpectaclesTab`, ni les fiches en base,
ni les blocs Admin (modération et « Validés » continuent volontairement de les lister). Repasser la
constante à `true` remet tout en place.

## Conventions

- Interface, commentaires et messages de commit : **en français**. Les commentaires expliquent le
  *pourquoi* (souvent un incident passé ou une contrainte utilisateur), pas le *quoi*.
- Style visuel « fiche bristol » : palette `COLORS`, `IndexCard` pour chaque carte, trois polices
  (`FONT_DISPLAY` / `FONT_BODY` / `FONT_MONO`).
- Déploiement : Netlify se déclenche automatiquement sur un push vers `master`.
