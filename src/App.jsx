import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";
import {
  Sparkles, Shuffle, Clock, BookOpen, Users, Flame, ClipboardList,
  Plus, Trash2, Tag, ChevronRight, ChevronUp, ChevronDown, ChevronLeft, Download,
  Save, X, Check, Home, Theater, Pencil, Library, UserCircle, Pointer, Star, LogIn, LogOut, AlertTriangle, Mail, Eye, EyeOff, Contact,
  Facebook, Instagram
} from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { useAuthUser, signIn, signUp, signOut, resetPasswordForEmail, updatePassword } from "./auth.js";

/* ---------- Tokens ---------- */
const COLORS = {
  ink: "#1E2A38",
  inkSoft: "#324156",
  paper: "#EDE6D6",
  card: "#F8F4EA",
  cardEdge: "#DDD3BC",
  accent: "#B5433A",
  brass: "#A9812F",
  text: "#241F1A",
  textSoft: "#5B5347",
};

const FONT_DISPLAY = "'Fraunces', Georgia, serif";
const FONT_BODY = "'IBM Plex Sans', system-ui, sans-serif";
const FONT_MONO = "'IBM Plex Mono', monospace";

const THEME_COLORS = ["#B5433A", "#A9812F", "#3B6E5E", "#5A5A9E", "#B06A3B", "#7A5C8E"];
function themeColor(name, allThemes) {
  const idx = allThemes.indexOf(name);
  return THEME_COLORS[idx % THEME_COLORS.length] || COLORS.brass;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// Envoie un message automatique (type "notif", distinct des messages utilisateur→Admin) au créateur
// d'un exercice/catégorie quand l'Admin valide ou refuse sa proposition. Rien n'est envoyé pour les
// fiches créées par l'Admin lui-même (creatorUsername vide).
function itemTitleFor(item, kind) {
  if (kind === "exercice") return item.title;
  if (kind === "catégorie") return item.name;
  return `${item.theme} · ${item.type}`; // concept de spectacle
}

function notifyCreatorApproved(d, item, kind) {
  if (!item.creatorUsername) return;
  d.messages = d.messages || [];
  const title = itemTitleFor(item, kind);
  const extra = kind === "concept de spectacle"
    ? "il est maintenant visible dans la liste publique des concepts de spectacle."
    : "il est maintenant visible dans la bibliothèque publique et pourra être proposé par les générateurs de cours, de spectacle et d'échauffement.";
  d.messages.push({
    id: uid(),
    type: "notif",
    to: item.creatorUsername,
    troupe: item.creatorTroupe || "",
    text: `🎉 Ton ${kind} « ${title} » a été validé${kind === "catégorie" ? "e" : ""} par l'Admin : ${extra}`,
    createdAt: Date.now(),
    seen: false,
  });
}

function notifyCreatorRejected(d, item, kind, reason) {
  if (!item.creatorUsername) return;
  d.messages = d.messages || [];
  const title = itemTitleFor(item, kind);
  let text;
  if (kind === "concept de spectacle") {
    text = `Ton concept de spectacle « ${title} » n'a pas été validé pour la liste publique : il n'apparaîtra pas dans la liste publique des concepts de spectacle. Tu peux quand même le retrouver et le réutiliser depuis la page « Concepts de spectacle ».`;
  } else {
    const pickerLabel = kind === "exercice" ? "Ajouter un exercice" : "Ajouter une catégorie";
    const mesFiches = kind === "exercice" ? "tes exercices créés" : "tes catégories créées";
    text = `Ton ${kind} « ${title} » n'a pas été validé${kind === "catégorie" ? "e" : ""} pour la bibliothèque publique : il n'apparaîtra pas dans la bibliothèque publique et ne sera pas proposé par les générateurs. Tu peux quand même le retrouver dans ${mesFiches} (onglet Mon profil), ou en tapant son nom dans la barre de recherche « ${pickerLabel} » de la création de cours ou de spectacle, pour l'ajouter toi-même à ton programme si tu le souhaites.`;
  }
  if (reason) text += `\n\nRaison indiquée par l'Admin : ${reason}`;
  d.messages.push({
    id: uid(),
    type: "notif",
    to: item.creatorUsername,
    troupe: item.creatorTroupe || "",
    text,
    createdAt: Date.now(),
    seen: false,
  });
}

/* Estime le temps (en min) où un élève reste spectateur pendant un exercice "chacun son tour" */
function computeWaitMinutes(exercise, participants) {
  if (exercise.format !== "Tour à tour avec spectateur") return 0;
  const groupSize = exercise.groupSize || 2;
  const p = Math.max(participants || groupSize, groupSize);
  const waitFraction = Math.max(0, 1 - groupSize / p);
  return Math.round(exercise.duration * waitFraction);
}

/* ---------- Listes de référence ---------- */
const NIVEAUX = ["Débutant", "Confirmé", "Avancé"];
const ENERGIES = ["Faible", "Modérée", "Forte"];
// Choix possibles pour les menus déroulants "nombre de joueurs" (catégories, 1 à 12) et "nombre
// d'élèves" (exercices, 0 à 30 — 0 signifie illimité, géré séparément dans le select).
const PLAYERS_COUNTS = Array.from({ length: 12 }, (_, i) => i + 1);
const STUDENTS_COUNTS = Array.from({ length: 30 }, (_, i) => i + 1);
// Détecte si la recherche tapée correspond à un niveau (insensible aux accents/majuscules),
// pour faire remonter en premier les fiches de ce niveau dans les résultats de recherche.
const detectNiveauQuery = (query) => {
  const nq = normalize(query);
  if (!nq) return null;
  return NIVEAUX.find((n) => normalize(n).includes(nq) || nq.includes(normalize(n))) || null;
};
const CATEGORY_TAGS = ["Univers", "Narration", "Contrainte d'espace", "Contrainte vocale", "Contrainte physique", "Contrainte de style", "Conduite par le MC", "De groupe", "Solo/duo et début/fin de spectacle", "Public", "Répétition", "Débile", "Spéciales match", "Devinettes", "Musicales"];
// Classement résumé des objectifs pédagogiques, utilisé pour l'instant uniquement sur le champ
// de recherche de "Créer un cours" — pas encore relié aux tags des fiches d'exercices.
const OBJECTIFS_PEDAGOGIQUES_RESUME = [
  "Acceptation et écoute", "Premières impro", "Posture confiante", "Plateforme", "Enjeux", "Monter les enjeux",
  "Entrer et sortir / transitions", "Observation, mimétisme et complicité", "Simplicité / jeu juste", "Jeu du corps",
  "Clown", "Les statuts", "Incarner les émotions", "Approfondir le personnage", "Regard", "Le contact",
  "Gérer l'instable et l'obstacle", "Comédie du jeu de la scène", "Sentir ce qui manque", "Jouer avec la musique",
  "Match et caucus", "Travail des univers", "Impro longue", "Masque",
];
// Familles des échauffements (classement fourni par l'utilisateur, distinct des familles Impro).
const FAMILLES_ECHAUFFEMENT = ["Relaxation", "Groupe, prénoms et confiance", "Physique", "Vocal", "Déconnexion", "Cercle", "Marche"];
// Toutes les familles confondues (échauffement + Impro), pour le champ "Famille d'objectif travaillé"
// des fiches d'exercice — une fiche n'a qu'une seule famille (champ `groupe`).
const TOUTES_LES_FAMILLES = [...FAMILLES_ECHAUFFEMENT, ...OBJECTIFS_PEDAGOGIQUES_RESUME];
// Familles créées à la volée par l'admin depuis les formulaires exercice/échauffement/catégorie
// (champ "+ Créer la famille…"), persistées dans data.customFamilies — fusionnées avec les listes
// de base ci-dessus pour que la nouvelle famille soit immédiatement disponible partout (formulaire
// exercice, formulaire catégorie, sélection d'objectif pédagogique dans "Créer un cours").
const familiesObjectifsWithCustom = (data) => {
  const custom = (data?.customFamilies || []).filter((f) => !OBJECTIFS_PEDAGOGIQUES_RESUME.includes(f));
  return [...OBJECTIFS_PEDAGOGIQUES_RESUME, ...custom];
};
const toutesLesFamillesWithCustom = (data) => {
  const custom = (data?.customFamilies || []).filter((f) => !TOUTES_LES_FAMILLES.includes(f));
  return [...TOUTES_LES_FAMILLES, ...custom];
};
// Enregistre une nouvelle famille créée à la volée dans data.customFamilies (dédoublonnée, ignorée
// si elle correspond déjà à une famille de base).
const addCustomFamily = (update, name) => {
  const v = (name || "").trim();
  if (!v) return;
  update((d) => {
    if (!d.customFamilies) d.customFamilies = [];
    if (!d.customFamilies.some((x) => normalize(x) === normalize(v)) && !TOUTES_LES_FAMILLES.some((x) => normalize(x) === normalize(v))) {
      d.customFamilies.push(v);
    }
    return d;
  });
};
// Deuxième priorité de la génération de cours : si une famille résumée ci-dessus n'a pas assez
// de fiches classées dedans (champ `groupe`), on complète avec les fiches portant l'un des tags
// d'objectif précis associés à cette famille.
const FAMILLE_VERS_TAGS = {
  "Acceptation et écoute": ["Écoute", "Acceptation", "Confiance", "Cohésion", "Déconnexion", "Lâcher-prise", "Cercle", "Relaxation"],
  "Premières impro": ["Narration", "Jeu", "Prénom", "Concentration", "Mémoire", "Imagination"],
  "Posture confiante": ["Posture", "Énergie"],
  "Plateforme": ["Plateforme", "Lieux", "Relation"],
  "Enjeux": ["Enjeux"],
  "Monter les enjeux": ["Argumentation", "Créativité"],
  "Entrer et sortir / transitions": ["Entrées/Sorties"],
  "Observation, mimétisme et complicité": ["Observation", "Imitation", "Complicité"],
  "Simplicité / jeu juste": ["Jouer juste", "Silence"],
  "Jeu du corps": ["Corps", "Physique", "Mime", "Danse", "Rythme", "Objet", "Déambulation"],
  "Clown": ["Clown"],
  "Les statuts": ["Statut"],
  "Incarner les émotions": ["Émotions", "Sensations"],
  "Approfondir le personnage": ["Personnages", "Adaptation", "Voix", "Engagement", "Masque"],
  "Regard": ["Regard"],
  "Le contact": ["Contact"],
  "Gérer l'instable et l'obstacle": ["Imprévu"],
  "Comédie du jeu de la scène": ["Jeu de la scène"],
  "Sentir ce qui manque": ["Spontanéité", "Voix"],
  "Jouer avec la musique": ["Musique", "Voix"],
  "Match et caucus": ["Match", "Caucus"],
  "Travail des univers": ["Univers", "Téléréalité"],
  "Impro longue": ["Préparation spectacle"],
  "Masque": ["Masque"],
};
// Tags précis utilisés spécifiquement pour la correspondance des CATÉGORIES par famille d'objectif
// (les exercices continuent d'utiliser FAMILLE_VERS_TAGS ci-dessus) — permet d'exclure un tag
// pertinent pour les exercices mais pas pour les catégories, ou d'en utiliser un autre à la place.
// Par défaut identique à FAMILLE_VERS_TAGS ; seules les familles listées ici diffèrent.
const FAMILLE_VERS_TAGS_CATEGORIES = {
  ...FAMILLE_VERS_TAGS,
  // Pour les catégories, "Voix" est trop générique (ressort des scènes sans lien avec la musique) ;
  // on cible plutôt "chant" et "ambiance musicale", en plus du genre "Musicales" (voir
  // FAMILLE_VERS_CATEGORY_TAG ci-dessous).
  "Jouer avec la musique": ["chant", "ambiance musicale"],
  // Pour les catégories, on cible directement le tag "personnage" en priorité plutôt que les tags
  // plus larges utilisés pour les exercices (Adaptation, Voix, Engagement, Masque), qui ramènent
  // des catégories moins centrées sur le travail du personnage.
  "Approfondir le personnage": ["personnage"],
};
// Repli par GENRE (champ tags de la catégorie, ex. "Univers", "Musicales") pour certaines familles
// d'objectif pédagogique — en plus (ou à la place) de la correspondance par tag précis ci-dessus.
const FAMILLE_VERS_CATEGORY_TAG = { "Travail des univers": "Univers", "Jouer avec la musique": "Musicales" };
// Catégories choisies à la main par la troupe pour certaines familles d'objectif, indépendamment
// de leurs tags précis — proposées en priorité, juste après la correspondance directe par famille/
// genre et avant le repli par tag précis (FAMILLE_VERS_TAGS_CATEGORIES).
const FAMILLE_VERS_CATEGORIES_PRIORITAIRES = {
  "Acceptation et écoute": ["Point de vue", "Poursuite", "Bis repetita"],
  "Posture confiante": ["Pas de question", "Interview d'expert", "Épistolaire"],
  "Plateforme": ["Point de vue", "Banc public"],
  "Entrer et sortir / transitions": ["Banc public", "Vaudeville", "Travelling"],
  "Jeu du corps": ["1 seul mot", "Compter de 1 à 50"],
  "Incarner les émotions": ["Zone d'émotions", "Exagérée"],
  "Approfondir le personnage": ["À poil et à plumes / Animal totem"],
};
// Retire les accents pour des recherches insensibles aux accents (ex. "couche" trouve "couché").
const normalize = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
// Compare deux libellés de tag de façon souple (accents/majuscules ignorés, et l'un peut être
// inclus dans l'autre — ex. "personnage" recoupe "Personnages"). Utilisé pour faire correspondre
// les tags précis d'une catégorie (champ objectives) aux tags précis d'une famille d'objectif
// (FAMILLE_VERS_TAGS), même quand les libellés ne sont pas rigoureusement identiques.
// L'inclusion n'est acceptée que si les deux libellés sont proches en longueur (variante
// singulier/pluriel type "personnage"/"Personnages") — sinon un tag court et générique (ex.
// "jeu") matcherait à tort n'importe quel tag composé qui le contient (ex. "Jeu de la scène").
const tagOverlap = (a, b) => {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  return longer.includes(shorter) && longer.length - shorter.length <= 3;
};
// Recherche multi-mots-clés : chaque mot tapé doit se retrouver quelque part dans les champs
// fournis (titre, objectifs, thématiques...), insensible aux accents et à l'ordre des mots.
// Insensible au pluriel dans le mot tapé (ex. "clowns" trouve aussi "clown") : le sens inverse
// (taper "clown" trouve "clowns") fonctionne déjà de lui-même grâce à la recherche par sous-chaîne.
const singularOf = (w) => (w.length > 3 && /[sx]$/.test(w) ? w.slice(0, -1) : w);
const matchesKeywords = (query, ...fields) => {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const combined = normalize(fields.filter(Boolean).join(" "));
  return words.every((w) => combined.includes(w) || combined.includes(singularOf(w)));
};
// Les générateurs peuvent faire varier la durée effective d'un exercice/échauffement/catégorie
// de 2 minutes près (par compression) pour mieux remplir le temps demandé, sans jamais dépasser
// le budget disponible : un exercice de 10 min peut être retenu même s'il ne reste que 8 min.
const DURATION_TOLERANCE = 2;
const fitsBudget = (duration, remaining) => duration <= remaining + DURATION_TOLERANCE;
const consumeBudget = (duration, remaining) => Math.max(0, remaining - Math.min(duration, remaining));
// Durée minimale affichée sur une carte générée (cours, spectacle, échauffement) : en dessous, une
// scène ou un exercice n'a plus vraiment de sens à jouer. Utilisée pour ne jamais retenir un élément
// de plus une fois qu'il ne reste plus assez de budget pour lui laisser une durée correcte — mieux
// vaut terminer un peu plus tôt que d'écraser un élément à 0 ou 1 minute.
const MIN_CARD_DURATION = 2;
const SECTIONS_EXERCICE = ["Échauffement", "Pré-impro", "Impro"];
const FORMATS_JEU = ["Solo simultané", "En groupe simultané", "Tour à tour avec spectateur", "En cercle", "Déambulation"];
const CONTEXTES_ECHAUFFEMENT = ["Match", "Cabaret", "Format Long", "Spectacle personnalisé"];
const DUREES_ECHAUFFEMENT = [5, 10, 15, 30];
const PALIERS_TEMPS_COURS = [0, 5, 10, 15, 20, 25, 30, 35, 40];
// Nom d'utilisateur "virtuel" utilisé par le bouton "Mode utilisateur" (profil Admin) : simule une
// session non-admin sans compte réel, pour tester rapidement le point de vue d'un utilisateur lambda.
const TEST_USER_NAME = "Utilisateur test";
const TEMPS_TOTAL_OPTIONS = [30, 60, 90, 120];
const DEBRIEF_MIN = 15;

/* ---------- Seed data (à remplacer par ton contenu) ---------- */
const SEED = {
  thematiques: ["Amour", "Peur", "Aventure", "Mystère", "Cinéma", "Vacances", "Humour", "Émotion", "Familial", "Participatif", "Expérimental"],
  showTypes: ["Cabaret", "Match", "Concept original"],
  objectifs: ["Écoute", "Acceptation", "Confiance", "Cohésion", "Personnages", "Émotions", "Corps", "Voix", "Narration", "Préparation spectacle", "Relaxation", "Déconnexion", "Prénom", "Jeu", "Physique", "Danse", "Rythme", "Mémoire", "Imagination", "Mime", "Concentration", "Énergie", "Cercle", "Lâcher-prise", "Observation", "Déambulation", "Lieux", "Univers", "Enjeux", "Objet", "Entrées/Sorties", "Engagement", "Relation", "Posture", "Argumentation", "Créativité", "Spontanéité", "Plateforme", "Sensations", "Contact", "Complicité", "Jouer juste", "Silence", "Masque", "Clown", "Statut", "Imitation", "Adaptation", "Regard", "Imprévu", "Jeu de la scène", "Caucus", "Match", "Téléréalité", "Musique"],
  categories: [
  ],
  exercises: [],
  showConcepts: [],
  coursePlans: [],
  spectaclePlans: [],
};

/* Catégories (genres de scène) tirées des documents fournis par l'utilisateur (exercices +
   liste officielle des catégories de match) — résumés proposés à partir du nom, à ajuster
   librement dans l'appli. Les entrées identiques à des catégories déjà présentes (Muette,
   Show me that...) sont automatiquement ignorées lors de la fusion. */
const CATEGORIES_A_FUSIONNER = [
                                                                                                                                                      { name: "Science-Fiction", summary: "La science-fiction explore des futurs possibles en se basant sur des avancées scientifiques et technologiques hypothétiques et questionne leurs implications éthiques et sociales. Elle cherche à extrapoler le présent vers des mondes imaginaires pour proposer des réflexions sur la place de l'Homme dans l'univers et les possibilités futures de l'humanité.", themesFrequents: "Robots et intelligence artificielle (IA), transhumanisme (prothèses, cyborgs…), voyage dans le temps, dans l'espace (découverte/colonisation de planètes), société extraterrestre, technologies avancées (voiture volante, téléportation, sabre-laser…), changement climatique, fin du monde, post-apocalyptique, dystopie, réalité virtuelle, conscience collective, éthique scientifique.", phrasesClassiques: ["“Les machines ne sont pas des amis.” - Terminator", "“La réalité est une illusion, bien que très persistante.” - Matrix", "“Nous sommes tous des poussières d'étoiles.” - Interstellar", "“Vous êtes sur le point de voir quelque chose d'extraordinaire.” - Les Gardiens de la Galaxie", "“Je vais faire un saut en hyperespace.” - Star Wars : Episode IV"], universAssocies: "Catastrophe : la survie à un cataclysme. Ex: Le jour d'après. Post-apocalyptique : la survie dans un monde sans ressource et violent. Ex: Mad Max",vocabulaireUnivers: { lexique: "Hyperespace, Cyborg, Terraformation, propulsion, Androide, IA, Cryo(truc), interface, Nanotechnologie, exoplanète, contamination, vecteur", personnages: "inventés en -EO\nprénoms féminins en -A\nPrénoms existants un peu complexifiés : Aude = Audezia", expressions: "TECHNOBABIL MAÎTRISÉ (Sans définition)\nRéinitialisation de...\nDésactivation...", styleDiscours: "DIALOGUE RAPIDE - PHRASE COURTES", tips: "Si personnage du futur/androide ou autres : syntaxe trop parfaite\nEx : je ne peux pas = il m'est impossible de ...." },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 4, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "39dcbf50", name: "L'intelligence artificielle (IA) / robot", desc: "Un personnage non-humain, souvent une IA ou un robot, qui soulève des questions sur la conscience, l'humanité et l'éthique. Ils sont dénués de sentiments, assez “neutres” et donc parfois comiques. Ils peuvent être des alliés, des menaces existentielles, ou des entités cherchant leur identité. Ex: HAL 9000 dans 2001: L'Odyssée de l'espace." }, { id: "ff5c3f91", name: "L'extraterrestre", desc: "Personnage venant d'une autre planète, questionnant les habitudes des humains. Il peut être hostile (veut conquérir la planète Terre), posséder des pouvoirs ou des technologies plus avancées, ou connaître des informations sur l'univers. Ex: E.T., l'extra-terrestre." }, { id: "82dc577c", name: "Le rebelle", desc: "Il s'oppose à un régime tyrannique ou une force oppressive. Le rebelle est motivé par un désir de liberté, de justice, ou de vérité. Ex: Katniss Everdeen dans Hunger Games." }, { id: "0e3b270d", name: "Le scientifique", desc: "Un personnage doté d'une grande intelligence et responsable de découvertes majeures. Il joue un rôle crucial dans le développement de l'intrigue, qu'il s'agisse de résoudre un problème ou de provoquer une crise. Ex: Doc dans Retour vers le futur." }, { id: "a7cb5427", name: "L'explorateur", desc: "Un personnage qui incarne l'esprit de découverte et d'aventure en quête de mondes inconnus ou de nouvelles frontières. Il est motivé par la curiosité, la science, ou la soif d'aventure. Souvent le héros de l'histoire. Ex: Ellen Ripley dans Alien." }, { id: "c8965f84", name: "Le survivant cynique", desc: "Personnage principal complexe, moralement ambigu, qui est plus motivé par la survie ou des intérêts personnels que par un sens du devoir ou de l'héroïsme. Ex: Han Solo dans Star Wars." }, { id: "e7993fa2", name: "Le prophète", desc: "Un personnage qui possède une vision particulière de l'avenir ou du potentiel humain. Ce visionnaire peut être un guide, un leader ou un inventeur, et perçu comme un génie ou un fou. Ex: Morpheus dans Matrix." }, { id: "518a70e7", name: "Le commandant", desc: "Un leader militaire charismatique chargé de mener des troupes ou des citoyens dans des combats cruciaux pour la survie ou la liberté. Il est stratégique et courageux. Il peut être gentil ou méchant. Ex: le colonel Miles Quaritch dans Avatar." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Western", summary: "Le western se déroule principalement dans l'Ouest américain durant la période du XIXe siècle, souvent appelé le Far West. Il s'agit de récits avec de l'action (quêtes, aventures, combat) et de la violence (loi du plus fort) mais qui se caractérise par un rythme très lent, une ambiance pesante, qui rappelle le paysage dans lequel évolue les personnages: plaines désertiques, petites villes poussiéreuses, et grands espaces sauvages. Il y a des cactus, des vautours, des coyotes, des mexicains, des saloons…", themesFrequents: "Conquête de territoires sauvages (construction de rails de train, de villes et de fermes, bêtes sauvages), conflit entre civilisation et nature, exploitation ressources (pétrole, or, minéraux), conflit culturel (entre les colons et les amérindiens), la justice personnelle (souvent sous forme de duels ou de vengeance), les codes de l'honneur.", phrasesClassiques: ["“Je ne pardonne jamais et je n'oublie jamais.” - Il était une fois dans l'Ouest", "“Mourir, ce n'est pas vraiment vivre, gamin.” - Josey Wales hors-la-loi", "“Cette ville n'est pas assez grande pour nous deux.”", "“Si tu veux tirer, tire. Ne parle pas.” - Le Bon, la Brute et le Truand", "“Tu es sacrément malin pour un étranger.” - Le Train sifflera trois fois"],vocabulaireUnivers: { lexique: "Six-coups, Diligence, Éperons, Gringo, Lasso, Shérif, Rançon, Duel, dégainer, ruée, solitaire, ombre", personnages: "Sully, Jill, Fill, Bill, Kid\nMarge, Liz, Scarlet, Rose\nOn s'appelle avec diminutifs : le kid, le doc, la gachette, le borgne, la boiteuse", expressions: "faire la loi\navoir la gachette facile\ntenir la ville", styleDiscours: "DISCOURS LACONIQUE / RUGUEUX / EN TENSION", tips: "Mettre l'accent sur la tension : le silence ou un bruit de bouche suffit.\nOn parle à son ennemi ou un inconnu en disant \"......, l'ami\"" },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 3, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "5744eb0a", name: "Le cowboy", desc: "C'est un héros taciturne et solitaire, qui vit selon un code moral strict. Il peut être un ancien hors-la-loi cherchant la rédemption, un tireur d'élite, ou un justicier. Ce personnage est courageux, indépendant, et prêt à affronter le danger pour défendre ce qu'il considère juste. Ex: Clint Eastwood dans tous ses films…Le bon, la brute et le truand." }, { id: "150c8672", name: "Le hors-la-loi", desc: "Le méchant classique du western, souvent charismatique, mais impitoyable. Ce personnage incarne la menace de l'anarchie, ou de la brutalité. Il est motivé par l'appât du gain, la vengeance, ou le simple plaisir de semer le chaos. Il est parfois un chef de gang, un bandit de grand chemin, ou un tueur à gages. Il a des hommes de main. Ex: Gian Maria Volonté qui joue Ramón Rojo dans Pour une poignée de dollars." }, { id: "9d07b075", name: "Le Shérif", desc: "Figure d'autorité dans la petite ville de l'Ouest, il est pris entre son devoir de faire respecter la loi et la réalité brutale du Far West. Il peut être un allié ou un adversaire du héros, selon qu'il est corrompu ou intègre. Le shérif représente l'ordre dans un monde chaotique. Ex: John Wayne dans Rio Bravo." }, { id: "978b7075", name: "L'indien", desc: "Représente le lien avec la nature et une sagesse ancienne. Il incarne la dignité, la spiritualité et une compréhension plus profonde du monde naturel. Il défend ses terres, peut être amical ou vouloir tuer les “blancs” (en les scalpant). Il a des lieux sacrés, invoque des esprits, utilise des flèches, monte des chevaux. Tribus Pawnee, Apache, Sioux, Navajo, Cheyenne… Ex: Le Pawnee qui sauve Leonardo DiCaprio dans The Revenant." }, { id: "899e6874", name: "Le médecin / pasteur / instituteur", desc: "Personnages pacifiques, ils incarnent les valeurs de soin, de moralité et de spiritualité. Ils sont confrontés à la violence de l'Ouest et servent de conscience morale pour les autres personnages. Ils essaient de “sauver” l'âme des autres personnages. Ex: Doc Holliday, joué par Val Kilmer dans Tombstone." }, { id: "b0a51298", name: "La femme forte", desc: "Le Far West est un milieu dur pour les femmes. Leurs personnages doivent être forts et défier les normes sociales (veuve courageuse, propriétaire de saloon ou hors-la-loi). Elles apportent une dimension émotionnelle et une perspective différente sur la vie dans l'Ouest. Ex: Joan Crawford dans le rôle de Vienna dans Johnny Guitar." }, { id: "93fd2c8b", name: "Le chercheur d'or", desc: "Parfois vieux et expérimenté, c'est un vétéran de l'Ouest. Il a un passé riche d'expériences, parfois douloureuses. Il essaye de faire fortune en trouvant un trésor ou des pépites d'or. Il est attiré par la richesse et bafoue et les lieux sacrés, en opposition avec les indiens. Ex: \"Prosit\" Luckner dans la BD Blueberry La mine de l'allemand perdu." }, { id: "725199b2", name: "D'autres personnages…", desc: "le croque-mort, le gérant de saloon, la danseuse de cabaret, les militaires, la famille dans un ranch, le journaliste, le barbier" }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Fantasy", canOpenShow: true, summary: "La fantasy est un genre qui se distingue par son exploration d'univers imaginaires où des éléments magiques ou fantastiques jouent un rôle central (contrairement à la science-fiction qui repose sur des technologies). On y met en scène des héros gentils (heroïc fantasy) dotés de capacités spéciales qui combattent des méchants et réalisent des quêtes. Les créatures comme les dragons, les elfes, les nains, les sorciers… y sont fréquentes. Les histoires se passent dans des univers médiévaux (châteaux forts) ou antiques, avec des paysages naturels comme la forêt, la montagne, les rivières.", themesFrequents: "Lutte entre le bien et le mal, quête héroïque, découverte de pouvoirs extraordinaires, passage à l'âge adulte, voyage dans des paysages exotiques, valeurs de la chevalerie (honneur, courage…), David contre Goliath (des personnages insignifiants peuvent avoir un destin important).", phrasesClassiques: ["“Un sorcier n'est jamais en retard, ni en avance d'ailleurs. Il arrive précisément à l'heure prévue.”- Le Seigneur des Anneaux", "“La magie a un prix.” - Les Chroniques de Narnia", "“La nuit est sombre et pleine de terreurs.” - Le Trône de Fer", "“On ne choisit pas son destin. C'est lui qui vous choisit.” - L'Assassin Royal"], universAssocies: "Onirique: L'univers onirique prend racines dans les contes, légendes et fables. On part de la réalité et le personnage découvre de plus en plus d'éléments fantastiques. La frontière entre la réalité et l'imaginaire est floue. Les contes de Perrault - Les contes des frères Grimm - Les milles et une nuits - La belle et la bête - Peter Pan - Le songe d'une nuit d'été - Alice au pays des merveilles - les films de Miyasaki… Mythologique: Les histoires issues de la mythologie sont des récits épiques où humains et Dieux se côtoient et s'affrontent. Fantastique : histoire qui semble se passer dans le monde réel mais certains éléments trahissent en fait la présence de magie et de surnaturel. Ex: Le sixième sens - Donnie Darko - La mouche - Shutter Island",vocabulaireUnivers: { lexique: "Quête, Prophétie, Artéfact, Murmurante, Donjon, Sorts, Banni, Oublié, Chandelle, Obscurité, Maitre, Forces", personnages: "Masculin : inventé en -on ou -alf\nFéminin : -ys ou -en\nDes noms à rallonge ...machin fils de ... Du royaume des.... et....", expressions: "Respect de la lignée : on s'adresse aux gens par leur titre et leur race : Maitre nain, Noble Elfe...\nIl faut récupérer le.... / Il faut empêcher que ...", styleDiscours: "DISCOURS LYRIQUE ET ARCHAÏQUE (MÉDIÉVAL)", tips: "L'inversion poétique : placer l'adjectif après le nom\nEx : Une ombre funeste, un sorcier maléfique..." },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 5, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "ca072441", name: "Le héros", desc: "C'est le personnage central destiné à accomplir une grande quête. Il commence comme une personne ordinaire, mais découvre progressivement ses pouvoirs ou sa véritable identité. Ex: Willow dans Willow." }, { id: "344cade5", name: "Le magicien", desc: "Un sage expérimenté qui guide le héros, lui fournissant les connaissances ou les outils nécessaires pour accomplir sa mission. Il a des pouvoirs magiques puissants, peut envoyer des sorts, etc. Ex: Gandalf dans Le Seigneur des Anneaux." }, { id: "b3ba4446", name: "Le seigneur des ténèbres", desc: "L'antagoniste principal, une incarnation du mal ou de la corruption. Il cherche à dominer ou à détruire le monde, et il est doté de pouvoirs magiques redoutables ou de grandes armées puissantes. Ex: Voldemort dans Harry Potter." }, { id: "9af488a0", name: "Le voleur", desc: "Un personnage rusé, souvent marginal, qui possède des compétences en infiltration, en vol ou en espionnage. Il peut être ambigu moralement, mais fidèle à sa propre manière. Il se déplace sans bruit et est très agile. Ex: Bilbo dans Le Hobbit." }, { id: "d7439000", name: "La figure royale", desc: "Un personnage de sang royal qui joue un rôle central dans la quête, soit comme objectif à sauver, soit comme leader en devenir. Elle peut être un personnage passif ou actif (donner la quête) dans l'intrigue. Ex: L'impératrice dans L'histoire sans fin." }, { id: "911746d0", name: "Les créatures fantastiques", desc: "Nain, elfe, dragon, magicien, centaure, griffon, gobelin, troll, orc, squelettes, démons, licorne, loup-garou, vampire, géant, cyclope, sirène, minotaure, harpie, fée, golem, phoenix, fantôme, zombie, yéti, lutin/gnome, kraken, nymphe, sphinx… Ex: Legolas et Gimli dans Le Seigneur des Anneaux." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Tragédie", summary: "La tragédie est un genre littéraire et théâtrale né en Grèce antique qui met en scène des personnages de haut rang ou de stature héroïque confrontés à des forces inéluctables qui les mènent à la souffrance, à la déchéance, ou à la mort. Il explore les aspects sombres de l'existence humaine. Les thèmes et histoires sont empruntés à la mythologie grecque et à l'Histoire antique.", themesFrequents: "Le destin et la fatalité, les personnages sont piégés par une série d'événements ou de circonstances inévitables, dictés par le destin, qui les conduisent à une fin tragique. Le sentiment d'inévitabilité est clef dans la tragédie. L'influence des dieux est un autre élément qui participe à l'impuissance des personnages humains dont la vie dépend de leurs décisions. Les conflits moraux : les personnages sont confrontés à des choix impossibles où chaque décision conduit à des conséquences désastreuses). La grandeur et la chute : Le parcours du héros tragique met en scène sa grandeur initiale, suivie de sa déchéance.", phrasesClassiques: ["“N'essayez pas de vous révolter contre le sort ; tout ce qui arrive est écrit.” - Oedipe Roi", "“Il est des maux plus grands que la mort.” - Antigone", "“Les plus grandes haines naissent des plus grands amours.” - Médée", "“La souffrance est la plus grande école de la sagesse.” - Agamemnon", "“La vie est un rêve fugitif, et le plus grand trésor, c'est la paix du cœur.” - Hécube"],vocabulaireUnivers: { lexique: "Fatum/Destin, Oracle, Exil, Lignée, Orchestre, Colonne, Latrines, Oppidum, Thermes, Amphore, Olympe, Trahir", personnages: "Hommes 2 syllabes en -ée ou en -os : Démos / Allos / Irée..\nFemmes : en -Ia : Alixia - Isimia - Loulia", expressions: "On s'adresse souvent aux dieux et aux éléments. On utilise le \"O\" (O lumière du jour...\")\nOn invoque la fatalité en utilisant du futur (pas du conditionnel) \"tu tueras ton frère et épousera...\"", styleDiscours: "POETIQUE, NOBLE ET EXAGERE", tips: "On ne \"parle\" pas, on décline des vérités universelles face à l'éternité\n« Nul homme ne peut être dit heureux avant qu'il n'ait franchi le seuil de la mort. »" },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 2, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "e2829322", name: "Le héros tragique", desc: "Un personnage noble ou de haut rang qui possède une qualité exceptionnelle mais qui est marqué par un défaut fatal (“hamartia”) tel que l'orgueil, l'ambition ou la jalousie. Ce défaut mène inévitablement à sa chute. Ex: Oedipe dans Oedipe Roi." }, { id: "bf721338", name: "Le confident", desc: "Il écoute et conseille le héros sans être directement impliqué dans l'action principale. Le confident peut aider à révéler les pensées intérieures du héros et à exposer les dilemmes auxquels il est confronté. Ex: Horatio dans Hamlet." }, { id: "505cb3e2", name: "Le chœur", desc: "Bien qu'il ne soit pas un personnage unique, le chœur joue un rôle collectif crucial en commentant l'action, en apportant un éclairage moral, et en représentant souvent la voix du peuple ou des dieux." }, { id: "eabd818b", name: "L'antagoniste", desc: "La force qui s'oppose au héros tragique, souvent personnifiant le destin, les dieux, ou un autre aspect inévitable du monde. Ex: Créon dans Antigone." }, { id: "316b10d3", name: "L'oracle", desc: "Un personnage qui prédit ou annonce l'inévitable destin du héros en lien avec les dieux. Sa prophétie est ignorée ou défiée par le héros, menant à sa perte." }, { id: "473d78ef", name: "La victime innocente", desc: "Souffre ou meurt de manière injuste, souvent à cause des actions ou du destin du héros tragique. Ex: Cordelia dans Le roi Lear." }, { id: "a791d9ef", name: "Les dieux", desc: "issus de la mythologie grecque (Zeus, Athéna, Poséidon, Hadès…) ils interviennent dans la vie des humains en donnant des quêtes, réalisant des adultères ou en protégeant le héros. Ils ont des caractères plutôt négatifs comme la jalousie, la colère, le désir…" }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Polar", summary: "Le polar, abréviation de \"policier\", se concentre sur le crime, l'enquête et la résolution de mystères. Les héros sont des détectives, des policiers, ou des individus ordinaires confrontés à des situations criminelles complexes. L'histoire se déroule dans des environnements urbains sombres et réalistes, avec une ambiance de tension.", themesFrequents: "Le crime, la justice, la désillusion (vis-à-vis de la société), la corruption, la vengeance, les identités cachées ou doubles, l'environnement urbain et son côté sale ou plein de vices, les dynamiques de pouvoir (politique), critique sociale (féminicide, racisme, classes sociales).", phrasesClassiques: ["“La vérité, tu la trouves rarement dans un rapport de police.” - L.A. Confidential", "“Elémentaire mon cher Watson” - Sherlock Holmes", "“La clé d'un mystère est souvent cachée dans les détails les plus insignifiants.”", "“Il n'y a pas de crime parfait, seulement des crimes qui n'ont pas encore été découverts.”", "“Les réponses que nous cherchons se trouvent souvent dans les questions que nous n'osons pas poser.” - L'Homme qui souriait"], universAssocies: "Film noir: Se caractérise par un détective privé très amer et dépressif, qui monologue et poursuit son enquête alors qu'on essaye de l'en empêcher. Exemples: Boulevard du crépuscule - Sueurs froides - Sin City - Blacksad - Watchmen - Zodiac - Le silence des agneaux. Thriller: L'enquêteur est une personne ordinaire ou pro qui finit par se mettre en danger à force de s'intéresser de trop près à un mystère ou un crime. Exemples: Fenêtre sur cour, Shutter Island - Prisoners - Gone Girl - Psychose - Mystic River",vocabulaireUnivers: { lexique: "Indic, Alibi, planque, Mobile, Hold-up, Alibi, Balancer, Morgue, Corruption", personnages: "Vince, Franck, Carl, Dwayne\nPam, June, Débra, Robin\nNom Américain courant : Gold, Higgins, Clark....", expressions: "Employer des phrases punchy\nEx : \"Le monde se divise en deux : ceux qui ont un pistolet, et ceux qui creusent. Toi, tu creuses.\"", styleDiscours: "DISCOURS CYNIQUE/URBAIN/PERCUTANT", tips: "Utiliser le monologue intérieur (la voix off qui commente sa déchéance ou son entourage)." },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 2, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "aabe38fb", name: "Le détective", desc: "Un privé, un policier, ou un enquêteur amateur. Il est intelligent, perspicace, et parfois cynique. Il peut être un héros moralement ambigu, marqué par un passé sombre ou un caractère solitaire. Il peut monologuer. Ex: Sherlock Holmes." }, { id: "c8992307", name: "Le criminel charismatique", desc: "Un antagoniste complexe, aussi intelligent que le détective, avec des motivations qui vont au-delà du gain matériel. Il peut être séduisant, manipulateur, ou même sympathique, malgré ses actes criminels. Ex: Hannibal Lecter dans Le Silence des Agneaux." }, { id: "5815df61", name: "La victime innocente", desc: "Un personnage qui subit les conséquences du crime, soit en étant la cible du criminel, soit en étant faussement accusé. Il incarne l'innocence et sert de contraste avec le cynisme du monde environnant. Ex: Laura Palmer dans Twin Peaks." }, { id: "c1e360dd", name: "Le journaliste fouineur", desc: "Un journaliste tenace qui cherche à découvrir la vérité, parfois au risque de sa propre sécurité. Il peut être un allié ou un obstacle pour le détective, selon ses propres motivations. C'est un gêneur. Ex: Weekly dans la BD Blacksad." }, { id: "8717e9fb", name: "La femme fatale", desc: "Mystérieuse et séduisante, elle joue un rôle central dans l'intrigue. Elle est ambiguë, avec des intentions qui ne sont pas immédiatement claires, et peut manipuler les autres pour atteindre ses propres fins. Ex: Jessica Rabbit dans Qui veut la peau de Roger Rabbit." }, { id: "219e82fa", name: "Le faux suspect", desc: "Un proche ou un personnage qui semble être le coupable parfait car il cache quelque chose (il a honte d'avoir assisté au crime ou protège quelqu'un d'autre). Il est pris pour cible par le détective et constitue une fausse piste. Ex: Arthur Leigh Allen dans le film Zodiac." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Gangster", summary: "Oeuvres qui se concentrent sur le monde du crime organisé à travers la montée et la chute de personnages liés à la mafia, aux cartels, ou à d'autres réseaux criminels. Les héros sont des criminels, contrairement au polar où les héros sont des policiers. Les lieux et l'ambiance sont proches du polar: paysages urbains et atmosphère pesante (bars clandestins, quartiers mal-famés, bureaux enfumés…)", themesFrequents: "Moralité (frontière entre le bien et la mal floue, les personnages sont charismatiques mais méchants, justifient leurs actes par un code d'honneur), pouvoir et ambition (quête du pouvoir et de la richesse, gravir les échelons de la société), loyauté et trahison (rôle central de la famille), violence, rédemption.", phrasesClassiques: ["“On ne fait pas de mal à la famille”", "“C'est à ce moment-là que tout a commencé…” (classique voix-off)", "“C'est pas contre toi, c'est juste les affaires” (avant de liquider quelqu'un)", "“Maintenant t'es l'un des nôtres”", "“Il parle trop, il faudrait l'emmener faire un tour” (un ordre pour liquider quelqu'un)"],vocabulaireUnivers: { lexique: "affranchi, omerta, Racket, Blanchiment, vendetta, Soudoyer, Planque, Balance, Liquider, Défourrailler, Territoire, Contrebande", personnages: "Vitto / Tony / Léone / Don\nCarmella / Ada / Rosa / Virginia\nà consonance italienne ou un surnom : Le renard / Le Sicilien / La panthère...", expressions: "Code de l'honneur verbal : on parle beaucoup de respect ; de parole donnée, de famille.\nExpressions polies pour des actes atroces \"On va l'emmener faire une promenade\" = tuer\nPhrases courtes, souvent menaçantes / calme", styleDiscours: "DISCOURS MINIMAL MAIS MINÉ (LE MOT TUE)", tips: "Quand on s'adresse au chef : le langage est marqué par des marques de respect excessives (\"Avec tout mon respect, Don Lucio...\") qui cachent souvent une tension extrême." },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 6, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "6020252d", name: "Le boss du crime", desc: "Un personnage puissant, charismatique et redouté, qui dirige une organisation criminelle avec une poigne de fer. Il peut paraître sympathique, non violent et gentil (Don Corleone dans Le Parrain) ou bien juste violent (Tony Montana dans Scarface)." }, { id: "4214fac5", name: "Le lieutenant fidèle", desc: "Un homme (ou parfois une femme) de confiance, chargé de faire respecter les ordres du boss, violent et sans pitié il s'occupe du sale boulot. Ex: Lefty joué par Al Pacino dans Donnie Brasco." }, { id: "d18f889b", name: "Le jeune ambitieux", desc: "Un jeune outsider (qui vient d'un milieu non criminel) qui aspire à entrer dans la famille des mafieux et plus tard à prendre la place du boss. C'est le personnage principal. Il peut être tiraillé entre le bien et le mal (vouloir se ranger). Ex: Ze Pequenho dans La cité de Dieu." }, { id: "4468c1a9", name: "L'avocat, le comptable", desc: "Il paraît innocent mais c'est le côté “respectable” de l'organisation criminelle. Il protège les membres lors des procès, gère les deals politiques, s'occupe de l'argent de l'organisation. C'est un personnage calculateur, cruel et froid ou alors peureux et ridicule. Ex: Saul Goodman dans Breaking Bad." }, { id: "9a6cc2c0", name: "La balance", desc: "Un membre de l'organisation criminelle qui craint de se faire “refroidir” et qui choisit donc de donner des informations à la police. Considéré comme la pire trahison possible, c'est un personnage haï et méprisé. Ex: Henry Hill dans Les affranchis." }, { id: "bc78f124", name: "Les forces de l'ordre", desc: "Souvent représentées par un détective ou un procureur, ces personnages cherchent à démanteler l'organisation criminelle, mais peuvent aussi être corrompus ou impuissants face à la force des gangsters. Ex: Inspecteur Vincent Hanna dans Heat." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Horreur", summary: "Conçu pour provoquer chez le spectateur ou le lecteur des sentiments de peur, de terreur, et d'angoisse. Ce genre se caractérise par l'exploration des aspects les plus sombres et effrayants de la condition humaine, en mettant en scène des situations surnaturelles, des monstres, ou des psychopathes. L'horreur joue sur les peurs primaires, qu'elles soient liées à la mort, à l'inconnu, ou à la perte de contrôle. L'histoire se passe dans des lieux isolés (maison abandonnée/hantée, jungle, caverne, île déserte…).", themesFrequents: "Surnaturel, monstres (zombies, vampires, mutants, fantômes, démons), psychopathes, folie, traumatismes, troubles mentaux, blessures, mort, gore et sang, la survie, suspense et anticipation : l'horreur joue beaucoup sur ce qui est suggéré plutôt que montré, avec des sons inquiétants, des mouvements hors champ, et des silences qui augmentent la tension.", phrasesClassiques: ["“Oh non il est de retour” dans tout type de suite de film d'horreur", "“Ne t'endors pas, surtout.” Les Griffes de la nuit", "“Surtout on ne se sépare pas” mais ils finissent par le faire…", "“Nous devons sortir de cet endroit” mais les personnages n'y arrive jamais", "“Il y a quelque chose dans la maison” The Conjuring"], universAssocies: "Slasher : Se caractérise par des meurtres violents et souvent graphiques, généralement perpétrés par un tueur en série. Ex: Massacre à la tronçonneuse - Scream - Les griffes de la nuit - Halloween - Vendredi 13 - Scary Movie. Found Footage : L'histoire est racontée à travers des séquences de vidéo trouvée et filmée caméra au poing. Ex: Le projet Blair Witch - [REC] - Paranormal activity.",vocabulaireUnivers: { lexique: "Désert, Sombre, plus de réseau, Ame, Décomposition, Entité, Tueur, Chasser, Cris, Ombres, Exorciser, Tombes", personnages: "Masculin : Vlad / Isma / Dan\nFéminin : Esther / Lucy / Carrie\nPour les vilains : des surnoms ex : la coupeuse de tête / le démanbreur", expressions: "Expression de doute : Des questions rhétoriques \"Il y a quelqu'un ?\", \"Tu as entendu ça ?\"\nDes répétitions (choc) de mots simples \"Non, non, non...\"", styleDiscours: "DISCOURS MINIMALISTE ET HALLETANT", tips: "L'importance du souffle : Les dialogues sont entrecoupés de silences, de respirations lourdes ou de cris étouffés." },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 2, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "da307c36", name: "Le Survivant Final", desc: "Celui qui survit jusqu'à la fin du film. C'est une figure morale ou héroïque, souvent la « vierge » (personnage féminin qui est souvent plus pur ou moralement innocent par rapport aux autres personnages). Ex: Laurie Strode dans Halloween." }, { id: "5a973025", name: "Le Leader", desc: "Charismatique et courageux, ce personnage prend l'initiative de faire face à la menace ou de mener le groupe. Il peut être un policier, un enquêteur ou un professionnel spécialisé dans les phénomènes paranormaux. Ex: Ash Williams dans Evil Dead." }, { id: "578887bc", name: "Le Comique", desc: "Il apporte une touche d'humour au récit pour alléger l'atmosphère. Il est souvent la première victime du tueur. Ex: Randy Meeks dans Scream." }, { id: "1f307d6c", name: "Le Sportif", desc: "Un personnage masculin stéréotypique qui est athlétique et populaire. Il est confiant et impulsif. Il est l'un des premiers à mourir dans les films de slasher. Ex: Mark dans Prom Night." }, { id: "54d39854", name: "La Coquette", desc: "Personnage féminin stéréotypé étant intéressée par les choses superficielles, comme la mode ou les relations amoureuses. Par exemple, une pom-pom girl. Elle est la prochaine victime après le comique. Ex: Heather dans The Blair Witch Project." }, { id: "d12e506a", name: "Le Nerd", desc: "Plus intelligent mais socialement maladroit. Il peut être sceptique et remettre en question les phénomènes paranormaux. Il joue un rôle clé dans la résolution de la situation grâce à ses connaissances ou compétences. Ex: Stuart dans Scary Movie." }, { id: "e839b709", name: "Le Tueur", desc: "Un tueur en série ou une créature terrifiante. Ce personnage est masqué ou dissimulé, avec une identité mystérieuse ou une motivation obscure. Ce peut être aussi une menace qu'on ne voit jamais ou alors très peu (Les dents de la mer)." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Comédie", summary: "La comédie englobe des œuvres qui visent principalement à divertir et faire rire le public. Ces œuvres reposent souvent sur des situations humoristiques, des dialogues pleins d'esprit, des quiproquos, et des personnages excentriques ou stéréotypés. La comédie peut aborder une variété de sujets, souvent avec une perspective légère et optimiste, où les conflits sont résolus de manière joyeuse et où les personnages finissent généralement bien. C'est un genre très vaste qui recoupe plusieurs univers associés dont certains sont décrits dans des fiches séparées dans ce guide (commedia dell'arte, comédie romantique, comédie musicale).", themesFrequents: "Clown : Univers qui trouve ses racines dans le théâtre et le cirque, c'est un monde coloré et excentrique où les émotions sont exacerbées. Le jeu de scène est très physique avec quantité de chutes et d'accessoires loufoques. On y retrouve l'absurdité, la dualité des émotions joie/tristesse, la quête de la reconnaissance et le combat contre l'ennui. Burlesque : Proche du clown, le burlesque est surtout connu dans les films muets. Il se caractérise par des gags “slapstick” c'est-à-dire des chutes, collisions et poursuites. Sitcoms : L'univers des sitcoms est un monde familier, léger et exagéré, où les personnages vivent des situations quotidiennes agrémentées d'humour, de quiproquos, et de dialogues rapides.", phrasesClassiques: [], universAssocies: "Clown, Burlesque, Sitcoms (voir thèmes fréquents pour le détail de ces trois univers).", level: "", playersMin: 2, playersMax: 6, energy: "", duration: 4, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "c2911ee0", name: "Le clown blanc", desc: "est sérieux et authoritaire, il représente l'ordre, l'authorité et la discipline. Il est souvent victime de ses propres règles rigides." }, { id: "8a2e71ac", name: "Le clown Auguste", desc: "désordonné, malicieux et maladroit. Il incarne la liberté, le chaos et la rébellion contre l'ordre établi par le clown blanc." }, { id: "39080574", name: "Le clown triste", desc: "est un personnage mélancolique, il porte un sourire forcé." }, { id: "15e9fc3d", name: "Groupes d'amis ou de collègues", desc: "avec des personnalités variées mais pas exagérées. Ex: Ross, Monica, Chandler, Joey, Phoebe et Rachel dans Friends" }, { id: "51f06059", name: "Le voisin ou l'ami envahissant", desc: "personnage loufoque. Ex: Kramer dans Seinfeld ou Barney dans How I met your mother" }, { id: "0a76da7e", name: "Le patron excentrique", desc: "Ex: Michael Scott dans The Office" }, { id: "233f3128", name: "Les membres de la famille / Les conquêtes amoureuses", desc: "personnages récurrents des sitcoms." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Commedia dell'arte", summary: "La Commedia dell'arte est une forme de théâtre populaire italienne qui a émergé au XVIe siècle, la plupart du temps les intrigues se passent donc dans cette période en Italie. Elle se caractérise par son humour léger, ses intrigues divertissantes et ses personnages typiques. Les récits se basent sur les aspects les plus quotidiens de la vie humaine. Pour information c'est d'ailleurs un des ancêtres de l'improvisation théâtrale puisque les histoires étaient improvisées sur la base d'archétypes de personnages et figures narratives classiques.", themesFrequents: "Déguisement / travestissement, inversement de rôles, quiproquo, jalousie, mariage forcé, amour impossible, ruse, richesse et pauvreté, relation maître et serviteur, vantardise, avarice, désir", phrasesClassiques: ["“Je vais devoir user de ma ruse pour éviter les ennuis !” - Arlequin", "“Je suis entouré de jeunes fous qui ne pensent qu'à l'amour, alors que moi, je pense à ma fortune !” - Pantalone", "“Qui ose défier le grand Capitano ?” - Le capitaine", "“Il faut étudier la situation avec minutie, blablabla…” - Le docteur en quasi monologue", "“Lélio que tu es beau / Isabella que tu es belle” - Les amoureux"], universAssocies: "Vaudeville : Comédies légères dont les intrigues impliquent souvent des quiproquos, des malentendus, des tromperies et des situations absurdes. La plupart du temps autour d'un adultère. Ex: Le Barbier de Séville - Le Mariage de Figaro - le dindon. Opérette : Des pièces basées sur la Commedia dell'arte mais qui incluent des séquences chantées et dansées type opéra. Ex: La vie parisienne.",vocabulaireUnivers: { lexique: "Masque, Lazzi, Canevas, Zanni, Rusé, Intrigue, Amoureux, Serviteur, Maître, Dot" },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 6, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "0e8ec69c", name: "Arlequin", desc: "Un serviteur rusé qui est toujours impliqué dans des intrigues pour aider son maître ou lui-même. Il est espiègle, plein d'énergie, et au centre des scènes comiques. Il est agile et fait des acrobaties." }, { id: "9825ff7e", name: "Colombine", desc: "Malicieuse et intelligente, elle est parfois l'amoureuse d'Arlequin. Elle est impliquée dans les intrigues amoureuses de ses maîtres et joue un rôle clé dans le dénouement des situations." }, { id: "ad47807b", name: "Brighella", desc: "Plus rusé et malveillant qu'Arlequin. Il est un escroc ou un manipulateur qui utilise ses talents pour tromper les autres personnages." }, { id: "654db3e6", name: "Pagliaccio", desc: "Souffre-douleur, il est lent et pas très malin, à l'origine des quiproquos en ratant les requêtes de ses maîtres. Il est grand, parle lentement et souvent la bouche bée." }, { id: "51706f3e", name: "Pantalone", desc: "Un vieil homme avare et lubrique. Souvent le père d'une jeune fille qu'il souhaite marier à un homme riche. Il joue un duo maître-serviteur avec Zanni. Il est joué voûté et avec une canne." }, { id: "2c97dadf", name: "Le Docteur", desc: "Un personnage pédant et prétentieux, souvent un avocat ou un médecin, qui aime étaler sa culture, même si ce qu'il dit n'a souvent aucun sens. Il est généralement ridiculisé pour son ignorance. Il est souvent gros et prend de la place." }, { id: "0cb919b3", name: "Le Capitaine", desc: "Un fanfaron, souvent un soldat, qui prétend être un grand héros de guerre mais qui, en réalité, est un lâche. Il aime se vanter de ses exploits amoureux et militaires, mais est souvent démasqué. Il gonfle le torse, se recoiffe, etc." }, { id: "f6794e75", name: "Isabella", desc: "Une jeune femme noble et belle, souvent l'objet des désirs de nombreux personnages masculins. Elle a une posture élégante et sait user de son charme." }, { id: "39402dab", name: "Lélio", desc: "L'amoureux bienheureux, aimé de celle qu'il aime, toujours aimable, gai, de bonne humeur, avec une pointe de comique. Naïf mais courageux, il provoque des duels." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Comédie romantique", summary: "Ce genre combine les éléments de la comédie et du récit romantique. Il se concentre sur une histoire d'amour et ses péripéties. Tout semble séparer les deux amoureux au début (milieu social, religion, caractères opposés…) mais ils finissent forcément ensemble à la fin. Il comporte des situations légères et ridicules ainsi que des malentendus qui compliquent l'évolution de la relation amoureuse.", themesFrequents: "Recherche de l'âme soeur, coup de foudre, évolution des personnages, seconde chance, pardon et réconciliation, rivalité amoureuse, différences culturelles ou sociales.", phrasesClassiques: ["“Je n'ai jamais cru en l'amour au premier regard jusqu'à ce que je te voie.” - Pretty Woman", "“Je suis venu ici aujourd'hui pour te dire que je t'aime.” - Quand Harry rencontre Sally", "“Je suis une star de cinéma, et toi, tu es un simple libraire.” - Coup de foudre à Notting Hill", "“C'est toi que je veux.” - La proposition", "“Je t'aime, et c'est tout ce qui compte.” - Le mariage de mon meilleur ami"],vocabulaireUnivers: { lexique: "Coup de foudre, Âme soeur, Rupture, Confident(e), Mariage, Déclaration, Rendez-vous, désirer, S'attacher", personnages: "Alex, Tim, Mark\nJane, Paige, Rosie, Eliza\nPrénoms des années 80/90", expressions: "Ne passons pas à côté de quelque chose de bien\nMa vie est trop simple, viens la compliquer avec moi\nNous étions fait pour ne faire qu'un...", styleDiscours: "DISCOURS PÉTILLANT, MODERNE, EMOTIONNEL", tips: "hyper-analyse des sentiments : On passe beaucoup de temps à décortiquer ce qu'un SMS ou un regard veut dire. Exemple : \"Je suis juste une fille, debout devant un garçon, et qui lui demande de l'aimer.\"" },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 2, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "45b14b80", name: "Le Protagoniste Romantique", desc: "C'est le personnage principal, une personne charmante, drôle et légèrement maladroite en matière de relations amoureuses. Il peut être à la recherche de l'amour ou se retrouver dans une situation où l'amour le surprend. Ex: Bridget Jones dans Le journal de Bridget Jones." }, { id: "8d5a8077", name: "L'Intérêt Amoureux", desc: "Ce personnage est séduisant, mystérieux ou charismatique, et il est l'objet du désir du protagoniste. Il peut initialement sembler inaccessible ou avoir des défauts qui compliquent la relation. Ex: Edward Lewis dans Pretty Woman." }, { id: "94494bbd", name: "Le Meilleur Ami du Protagoniste", desc: "Il joue le rôle de confident et de soutien moral. Il offre des conseils, apporte de l'humour et aide souvent à faire avancer l'intrigue: convaincre le protagoniste de reconquérir son amour, etc. Ex: Carrie Bradshaw dans Sex and the City." }, { id: "114b80cb", name: "Le Rival Amoureux", desc: "Il entre en compétition avec le protagoniste, il peut être un ancien partenaire (un ex) ou quelqu'un de nouveau dans la vie de l'intérêt amoureux. Ex: Warner Huntington III dans La Revanche d'une blonde." }, { id: "01dedb84", name: "Le Parent Protecteur", desc: "Un parent qui est sceptique ou protecteur vis-à-vis de la relation du protagoniste avec l'intérêt amoureux, souvent pour créer des obstacles ou des conflits. Il fait un peu peur, et peut avoir des choses de valeur que le protagoniste va casser. Ex: George Banks dans Le Père de la mariée." }, { id: "0eeea410", name: "Le Colocataire loufoque ou le Collègue Intrigant", desc: "Quelqu'un avec qui le protagoniste partage un espace ou un environnement de travail, ajoutant souvent une touche d'humour ou un élément de tension supplémentaire. Ex: Spike le colocataire et Honey la soeur du héros dans Coup de foudre à Notting Hill." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Comédie musicale", canCloseShow: true, summary: "La comédie musicale est un genre qui combine la musique, le chant, la danse, et le théâtre. Il ne se caractérise pas par un style narratif particulier mais peut aborder tout de même certains schémas de l'univers onirique, tragédie ou aventure. L'accent est donné sur l'expression exagérée des émotions des personnages. La comédie musicale est la version moderne de l'opéra qui reprend les mêmes codes.", themesFrequents: "Thèmes universels tels que: l'amour, la romance, le rêve, l'identité, l'ambition, la quête de la célébrité, la famille, le pouvoir du collectif, le sacrifice ou le devoir, la rédemption, le pardon, la liberté, conflit entre tradition et modernité, passage à l'âge adulte, la guerre, le deuil, l'amitié, la loyauté.", phrasesClassiques: [], universAssocies: "Opéra : Les thèmes abordés sont plus sérieux et baroques, ils se rapprochent de l'onirique et de la tragédie. Ex: Carmen - La bohème - Rigoletto - La Traviata - Faust - Don Giovanni - Madame Butterfly. Disney et assimilés : Des films d'animation dont les histoires sont tirées des univers oniriques mais où les thèmes sont plus légers et simplifiés. Ex: Le roi lion, Blanche-Neige, Cendrillon, Aladdin. Bollywood : industrie cinématographique en langue hindi basée à Mumbai. Thèmes légers, romance, action ou aventure, ancré dans la culture indienne. Ex: Devdas - Lagaan - Fanaa - Veer-Zaara",vocabulaireUnivers: { lexique: "Numéro, Choeur, Duo, Choisir, Final, Auditions, Famille, Choix, Partition, Répéter, Cachette, Défi", personnages: "Masculin : Robin / Danny / Billy\nFéminin : Vivian / Mia / Maria\nprénoms un peu désuets et courts", expressions: "Max d'émotions : poussées à 200 % \"c'est le plus beau jour de ma vie\" / \"je n'ai jamais ressentie une telle douleur dans mon coeur...\"\nEssayer de garder un rythme/une musicalité même en parlant.", styleDiscours: "DISCOURS ENTHOUSIASTE RYTHMÉ POSITIF", tips: "Transition fluide : on reprend sa dernière phrase pour commence à chanter..." },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 6, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "1d5f8a3c", name: "L'ingénue romantique", desc: "Héroïne pure et pleine d'espoir, exprime ses sentiments en chanson dès qu'elle est seule." }, { id: "8e2b4f70", name: "Le héros au grand cœur", desc: "Personnage principal charismatique, souvent d'origine modeste, qui chante ses rêves et ses doutes." }, { id: "b60a9d3e", name: "La diva", desc: "Star capricieuse et flamboyante, exige d'être au centre de chaque numéro, rivale jalouse de l'ingénue." }, { id: "4f7c1e85", name: "Le meilleur ami comique", desc: "Anime les scènes de groupe, apporte l'humour et lance souvent le numéro de danse." }, { id: "9a3d6b21", name: "Le méchant charismatique", desc: "Antagoniste élégant et théâtral, possède son propre grand numéro de chant." }, { id: "2c8f5e94", name: "Le mentor bienveillant", desc: "Guide expérimenté (professeur de danse, imprésario, figure parentale) qui pousse le héros à se révéler." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Drame", summary: "Genre narratif qui se concentre sur les aspects émotionnels et psychologiques des personnages, explorant des thèmes profonds et complexes liés à la condition humaine. L'univers de ces œuvres est réaliste avec une narration lente axée sur les personnages et une mise en scène sobre. Les situations ne sont pas extraordinaires, on parle d'éléments de la vie quotidienne.", themesFrequents: "Famille, secrets, maladie, dilemmes moraux, procès, deuil, injustice, conflit générationnel, solitude, inégalités économiques, le temps et la mémoire (nostalgie, souvenirs…).", phrasesClassiques: ["“J'aurais préféré avoir une fille au lieu d'un garçon.” - Un tramway nommé désir", "“Je suis fou de toi, Clarisse, ça me tue.” - La vie d'Adèle", "“Le bonheur, ce n'est pas grand-chose, juste du chagrin qui se repose.” - La haine", "“La première nuit, c'est la plus difficile.” - Les évadés", "“Je suis la loi ici.” - Midnight Express"], universAssocies: "La prison : maltraitement, violence, enfermement, isolement, difficulté de réinsertion… Ex: La ligne verte - Les évadés - Luke la main froide - Midnight Express. Les procès : procès criminels ou problèmes de société. Ex: Philadelphia - Loving - Anatomie d'une chute - la série The Staircase",vocabulaireUnivers: { lexique: "tragique, inévitable, espoir, combattre, maladie, triste, ensemble, population, Mensonge, Choisir, Combattre, Lutter", personnages: "Des prénoms ordinaires, simples, usuels, contemporains à l'histoire.", expressions: "Syntaxe de l'hésitation : je pensais que...\nLe non-dit (Sous-texte) : On évite de nommer le problème directement. Exemple : La maison est si vide. (Tu me manques)", styleDiscours: "DISCOURS ORGANIQUE : VÉRITÉ ÉMOTIONNELLE", tips: "User du monologue intérieur : découvrir l'âme profonde du personnage. Ton confessionnel / presque sacré / avec des comparaisons à la nature, aux saisons./ à un objet cassé" },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 3, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "6d1a8f52", name: "Le héros tourmenté", desc: "Rongé par un dilemme moral ou un secret, il est en quête de rédemption." }, { id: "b47e0c93", name: "La victime", desc: "Subit l'injustice, la maladie ou la violence ; catalyseur de l'empathie du récit." }, { id: "1f9c3d76", name: "Le membre de la famille dysfonctionnelle", desc: "Porteur de non-dits, de rancunes ou de secrets enfouis depuis longtemps." }, { id: "e582a6f1", name: "La figure d'autorité juridique ou carcérale", desc: "Juge, avocat, gardien de prison ; incarne le système et ses failles." }, { id: "3c7b4e08", name: "Le confident", desc: "Psychologue, ami proche ou aumônier ; recueille les aveux et pousse à la vérité." }, { id: "a960f2d4", name: "L'antagoniste ordinaire", desc: "Pas un « méchant » classique, mais quelqu'un dont l'égoïsme ou la lâcheté cause la souffrance des autres." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Histoire et sociétés", summary: "Cet univers s'efforce de transporter le spectateur ou le lecteur dans une autre époque, en offrant une représentation riche et détaillée du passé ou d'une société, tout en apportant une réflexion moderne. On se rapproche des documentaires et des biographies.", themesFrequents: "La Préhistoire : hommes des cavernes, découverte du feu et des outils, chasse, mammouths, dinosaures (même si c'est anachronique…), survie difficile, art rupestre. L'Égypte antique : hiérarchie rigide (pharaon, scribe, esclave), mythologie, sable et désert, grandes constructions, hiéroglyphe, momies. La Rome antique : Jules César, armée romaine, conquête de territoires, le Sénat, gladiateurs dans le Colisée. La Grèce antique : les héros et épopées, mythologie, jeux olympiques, philosophie, démocratie. Le Moyen-Âge : féodalité, christianisme et inquisition, chevalerie, sièges de châteaux forts, croisade, la peste noire. Les vikings : drakkars, raids violents, mythologie (Odin, Thor), le Valhalla, les runes. Le Japon féodal : samouraïs, ninja, batailles entre seigneurs, cérémonie du thé. La Renaissance : le Roi Soleil, le palais de Versailles, mousquetaires, Léonard de Vinci. Les grandes découvertes : caravelles, conquistador, pirate, Nouveau Monde. Révolutions : Guillotine, Siècle des Lumières, la Terreur, prise de la Bastille. Années folles : les Etats-Unis, la prohibition, jazz, gangster. Sociétés : les Inuit, la noblesse russe, la Polynésie, les touaregs, les zoulous, les romani, les sherpas…", phrasesClassiques: [],vocabulaireUnivers: { lexique: "Époque, Coutume, Rituel, Hiérarchie, Conquête, Royaume, Tribu, Cérémonie, Artefact, Légende, Ancêtres, Tradition" },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 2, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "d84c1a97", name: "Le chef / la cheffe", desc: "Roi, pharaon, chef de tribu, seigneur : incarne le pouvoir et la tradition." }, { id: "0f6e3b52", name: "Le/la sage ou prêtre(sse)", desc: "Gardien(ne) du savoir et des rites, conseille ou prédit l'avenir." }, { id: "7b9a5d10", name: "Le guerrier / la guerrière", desc: "Protège ou conquiert au nom de son peuple, incarne l'honneur ou la violence de l'époque." }, { id: "c2508e64", name: "L'étranger / l'explorateur", desc: "Voyageur, marchand ou envahisseur venu d'ailleurs, bouscule les traditions locales." }, { id: "4a1d7f83", name: "Le/la rebelle", desc: "Refuse l'ordre établi, pousse au changement ou à la révolte (esclave, hérétique, révolutionnaire)." }, { id: "9e0c6b25", name: "L'artisan / le peuple", desc: "Représente la vie quotidienne, le travail et les coutumes populaires de l'époque." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Aventure", canOpenShow: true, summary: "Type de récit centré sur l'action et l'exploration dans des lieux exotiques. Des personnages partent en quête et vivent des épreuves pour atteindre un objectif tel qu'un trésor, sauver quelqu'un, ou vaincre un ennemi. Le rythme de l'histoire est soutenu avec un enchaînement rapide des événements, où le suspense et le danger sont omniprésents. Ces histoires se passent souvent dans des périodes spécifiques : grandes découvertes, guerres mondiales…", themesFrequents: "La quête, les trésors, le voyage, la découverte, la liberté, l'héroïsme, la survie, l'amitié et la loyauté, le sacrifice, les lieux exotiques (désert, jungle, savane), encore inconnus (centre de la Terre, abysses, espace) ou extrêmes (sommets montagneux, intérieur d'un volcan), archéologie, choc des cultures, racisme.", phrasesClassiques: ["“Le trésor n'est pas toujours ce qu'il semble être.” - Pirates des caraïbes", "“Nan mais ça va pas ! Pourquoi vous hurlez comme ça ?” - Indiana Jones"], universAssocies: "Pirate : corsaires, îles abandonnées, crânes, tempêtes, abordage, capitaine, perroquet, jambe de bois, légende, carte au trésor, malédiction, combat au sabre, canonnade. Ex: Pirates des Caraïbes - L'île au trésor - Hook, la série Black Sails.",vocabulaireUnivers: { lexique: "Replique, Boussolle, Quête, Sarcophage, Liane, Hydravion, Carte, Cité perdue, Expédition, danger, découvrir, étrange", personnages: "Un prénom ET un nom de famille : Dona Leeron / Finn Lector / Lana Denver ... Astuce : mêler 2 prénoms anglophones simples", expressions: "On ne s'arrête pas, où on est mort\nAttention c'est sûrement piégé\n....... avec verbes d'actions", styleDiscours: "DISCOURS DIRECT / AVEC DE L'IRONIE", tips: "Le personnage principal commente souvent sa propre malchance ou le danger qu'il combat\nEx : Des serpents...pourquoi fallait-il que cela soit des serpents..." },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 2, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "42613350", name: "L'aventurier", desc: "Personnage principal aux capacités de survie et ingéniosité exceptionnelle. Il est très courageux et motivé par la découverte, l'appât du gain, la renommée ou bien une cause juste. Il est souvent bourru, il rit face au danger et est blasé. Ex: Indiana Jones." }, { id: "90b71288", name: "Le sidekick rigolo", desc: "Compagnon loyal de l'aventurier. Il lui apporte soutien et compétences particulières. Il est comique et léger, c'est un contrepoint au caractère sombre de l'aventurier. Ex: demi-lune dans Indiana Jones." }, { id: "a69568a8", name: "Guide animal / légendaire", desc: "Une créature fidèle ou magique qui accompagne le héros, dotée d'une intelligence ou de pouvoirs particuliers. Peut être un animal totem, une créature mythique. Ex: Abu dans Aladdin." }, { id: "58e2b3e2", name: "Le vilain", desc: "Un adversaire puissant et charismatique. Il peut être un tyran, un rival, ou une entité maléfique cherchant à contrecarrer la quête du héros." }, { id: "13310856", name: "Le déchu / dépossédé", desc: "Un personnage qui a perdu un bien (paysan à qui on impose des taxes) ou un statut (noble à qui on a usurpé le trône) et qui demande de l'aide, ce qui lance la quête." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Action", canOpenShow: true, summary: "Caractérisé par des séquences spectaculaires, qui mettent l'accent sur l'adrénaline, les combats, les poursuites et les situations de danger intense, ce genre est conçu pour captiver le spectateur à travers un rythme rapide et des moments de tension extrême. Les scènes tournent autour de défis physiques et la narration est simple et dynamique. La violence est un élément clef du genre.", themesFrequents: "Cape et épée : intrigues politiques, rivalités entre le roi et la noblesse, duels. Péplum : grandes batailles, gladiateurs, généraux. Espionnage : trahisons, double-jeux, mystères, assassinats. Braquage : casse spectaculaire avec équipe de braqueurs spécialisés. Arts martiaux : scènes de combat chorégraphiées. Superhéro : pouvoirs extraordinaires, justicier, super méchant, multivers.", phrasesClassiques: ["“Il n'y a pas de plan B.”", "“Cette fois, c'est personnel.”", "“Tu peux courir, mais tu ne peux pas te cacher.”", "“Lâche ton arme, et personne ne sera blessé.”"], universAssocies: "Cape et épée, Péplum, Espionnage, Braquage, Arts martiaux, Superhéro (voir thèmes fréquents pour le détail de ces univers).",vocabulaireUnivers: { lexique: "Cible, Mission, Explosif, Embuscade, Filature, Otage, Extraction, Complice, Trahison, Riposte, Sabotage, Compte à rebours" },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 5, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "a12f5c3e", name: "Le protecteur aux nerfs d'acier", desc: "Ancien agent aux compétences redoutables, prêt à tout pour retrouver et sauver un proche kidnappé." }, { id: "d84e91b7", name: "Le fugitif traqué à tort", desc: "Accusé injustement d'un crime qu'il n'a pas commis, il fuit la police tout en cherchant le vrai coupable." }, { id: "6b3a70f4", name: "Le limier increvable", desc: "Enquêteur ou marshal acharné, ne renonce jamais à sa traque, même face au doute sur la culpabilité de sa cible." }, { id: "f2c8de55", name: "L'ennemi juré", desc: "Héros et méchant prennent littéralement l'identité l'un de l'autre, brouillant la frontière entre le bien et le mal." }, { id: "39a6b1c0", name: "Le flic solitaire aux méthodes radicales", desc: "Policier qui enfreint les règles pour démanteler un réseau criminel, souvent seul contre tous." }, { id: "7e04fd2a", name: "Le parrain du crime organisé", desc: "Chef charismatique et impitoyable d'un réseau de trafic ou de gangsters." }, { id: "c95b3e81", name: "L'homme (ou la femme) ordinaire pris dans l'extraordinaire", desc: "Civil propulsé malgré lui dans une situation de danger extrême, doit improviser pour survivre." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Guerre", summary: "Comme son nom l'indique ce genre traite de conflits militaires de grande envergure, que ce soit dans des périodes historiques (batailles rangées, guerres mondiales, guérilla, indépendances…) ou bien dans des univers fictionnels proches de la réalité. Bien que certaines scènes puissent être spectaculaires et se rapprocher du genre de l'action, et que certains aspects de la vie militaire et de la camaraderie sont romancés, les œuvres du genre guerre sont surtout focalisées sur dépeindre les réalités de la guerre et créer une empathie du spectateur.", themesFrequents: "Le sacrifice, l'héroïsme, le courage, la camaraderie, les horreurs de la guerre, la perte de l'innocence, le patriotisme, le devoir, l'impact sur les civils, la mémoire, les blessures de guerre, l'invalidité, le pourquoi de la guerre, l'identification avec l'ennemi.", phrasesClassiques: ["“J'adore l'odeur du napalm au petit matin.” - Apocalypse Now", "“On ne peut pas s'arrêter maintenant, on est trop loin.” - Il faut sauver le soldat Ryan", "“La guerre ne rend pas les hommes meilleurs, elle les détruit.” - Les sentiers de la gloire", "“Nous sommes nés pour nous battre, nous sommes nés pour mourir.” - Full Metal Jacket", "“Ce ne sont pas les armes qui font la guerre, ce sont les hommes.” - Le Jour le plus long", "“Et que dire de la peur? Comment la surmonter?” - La Ligne rouge"],vocabulaireUnivers: { lexique: "Tranchée, Bataillon, Munitions, des Vivres, Etats-Major, Assauts, Soldat, Stratégie, Arsenal, Blochaus, Cessez-le feu, gradé", personnages: "Joseph / Marcel / Lucien\nGermaine / Marcelle / Lucie\nprénoms contemporain à l'époque de la guerre", expressions: "Faire vivre le grade et le lien : \"tu es mon frère d'armes.\" \"oui sergent\" \"caporal...\"\nLangage militaire : ordres secs / noms de code\nParfois poétique pour humaniser : lettres/ mots aux famille \" dis à ma mère que ....\"", styleDiscours: "DISCOURS ABRUPT TECHNIQUE", tips: "Economie des mots - Phrases courtes et hachées\n\"Couvrez moi!\" \"Secteur nord\" \"A Terre\"" },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 5, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "d764f85d", name: "Le commandant", desc: "Un officier charismatique chargé de prendre des décisions difficiles pour le groupe. Il incarne l'autorité et la stratégie sur le champ de bataille. Ex: Colonel Kurtz dans Apocalypse Now." }, { id: "b30809f9", name: "Le soldat héroïque", desc: "Personnage central qui incarne le courage, le sacrifice, la loyauté et la camaraderie. Il est au cœur de l'action et se pose des questions sur le pourquoi de la guerre. Ex: Capitaine John H. Miller dans Il faut sauver le soldat Ryan." }, { id: "6606d4ea", name: "La recrue innocente", desc: "Un jeune soldat, souvent inexpérimenté, qui découvre la dure réalité de la guerre. Il représente la perte de l'innocence et l'impact psychologique du conflit. Ex: Soldat Chris Taylor dans Platoon." }, { id: "c00019ac", name: "Le vétéran désabusé", desc: "Un soldat plus âgé et expérimenté, cynique, qui a vu trop de combats. Il sert de mentor pour les plus jeunes, tout en exprimant la fatigue morale de la guerre. Ex: Sergent Tom Highway dans Le Maître de Guerre." }, { id: "f61e975c", name: "Le médecin", desc: "Un personnage dédié à soigner les blessés, souvent un médecin militaire ou un infirmier. Il incarne la compassion et la lutte pour préserver la vie au milieu de la destruction. Ex: Capitaine Benjamin Franklin \"Hawkeye\" Pierce dans MASH." }, { id: "54c5d420", name: "Le dissident", desc: "Un soldat pacifiste qui remet en question la légitimité ou la moralité de la guerre. Il s'oppose aux décisions militaires ou refuse de combattre, ce qui lui vaut des punitions. Ex: Sergent James Ryan dans Il faut sauver le soldat Ryan." }, { id: "0e339f88", name: "L'ennemi déshumanisé", desc: "Personnage peu développé qui représente l'opposition. Ex: Les Allemands dans Dunkerque." }, { id: "42f844e3", name: "L'autorité", desc: "Le gouvernement ou une organisation militaire supérieure, qui est loin des combats et donc vue de manière négative par les militaires qui la considère hors sujet. Ex: Les supérieurs hiérarchiques dans Les sentiers de la gloire" }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Sports", summary: "Les œuvres à propos du sport ne se limitent pas à montrer des compétitions, mais explorent les dimensions humaines du sport, telles que le caractère, la moralité, l'identité, et le dépassement de soi. On suit l'épopée d'athlètes pour arriver au sommet de leur discipline.", themesFrequents: "Le sacrifice, la compétition, la rivalité, l'entraînement, la discipline, la stratégie, l'effort physique, l'ambition, l'esprit d'équipe, l'individualisme, l'exposition médiatique, la richesse, les blessures.", phrasesClassiques: ["“Ce n'est pas la taille du chien dans le combat qui compte, c'est la taille du combat dans le chien.” - Le plus beau des combats", "“Le football, c'est 10 % de talent et 90 % de travail.” - L'enfer du dimanche", "“La douleur disparaît, la fierté reste.” - Les Chariots de feu", "“Gagner, c'est tout ce qui compte.” - Friday Night Lights", "“Ce n'est pas seulement un match, c'est notre vie.” - Miracle", "“Un champion, c'est quelqu'un qui se relève quand il ne peut plus.” - Rocky II"],vocabulaireUnivers: { lexique: "Entraînement, Adversaire, Titre, Record, Blessure, Coach, Stratégie, Dépassement de soi, Podium, Supporters, Sacrifice, Revanche" },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 2, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "5b39e5bc", name: "L'athlète talentueux ou outsider", desc: "Personnage central, c'est un athlète doué (ou pas, il peut être sous-estimé au début de l'histoire) qui doit surmonter des défis sportifs pour réussir. Ex: Rocky Balboa joué par Sylvester Stallone" }, { id: "475b9dbb", name: "L'entraîneur", desc: "Dur et rigoureux, parfois aussi grand stratège, il accompagne l'athlète dans son ascension. Ex: King Richard joué par Will Smith dans La méthode Williams." }, { id: "c89c758d", name: "Le rival", desc: "Un concurrent qui pousse le protagoniste à se dépasser. Ce rival est aussi talentueux que le héros. Il peut devenir un ami du héros au cours de l'histoire. Ex: Tom dans Olive et Tom." }, { id: "367fe860", name: "Les coéquipiers", desc: "Personnages qui soutiennent le protagoniste, surtout si le sport dépeint est un sport collectif. Ex: L'équipe de Rugby des Springboks conduite par Matt Damon dans Invictus." }, { id: "a1269c58", name: "L'administrateur", desc: "Représentant les instances dirigeantes du sport (comme un président de club, un directeur ou un organisateur de tournoi), il pose des obstacles bureaucratiques et budgétaires. Ex: Paul Taggart dans L'Enfer du dimanche." }, { id: "0f0196a7", name: "La famille soutien ou fardeau", desc: "Des proches qui peuvent être un soutien émotionnel essentiel ou, au contraire, une source de tension, de doutes, ou de conflits internes pour l'athlète. Ex: Adrian Balboa dans Rocky." }, { id: "3708bbb9", name: "Les supporters / les médias", desc: "en arrière-plan, les supporters et médias jouent un rôle symbolique important, représentant la pression sociale ou l'aspiration à rendre fiers les siens. Ex: Les fans des Boston Red Sox dans Fever Pitch." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Soap opera", canOpenShow: true, summary: "Univers reposant uniquement sur des séries télévisées mettant en scène des drames joués de façon excessive. Le terme \"soap opera\" vient des premières émissions radiophoniques sponsorisées par des marques de savon (soap) aux États-Unis dans les années 1930, avec “opera” pour signifier le côté dramatique à l'excès. Les intrigues tournent autour des relations amoureuses et de l'argent et sont souvent super alambiquées. Le genre se caractérise par des épisodes à répétition avec toujours les mêmes histoires, mais une évolution des personnages. Les personnages archétypes sont assez classiques et ont déjà été abordés dans les univers comme la Comédie Romantique ou la Télé-Réalité : héros / méchant / séducteur / manipulateur / patriarche - matriarche / le meilleur ami / le justicier / l'ex-femme ou ex-mari. Ils ont des noms américains (Brenda, John, Pamela, Ryan) et des personnalités hautes en couleur.", themesFrequents: "Révélations de secrets : secrets de famille ou identités cachées (enfant illégitime, héritier caché, imposteur). Mariages et interruptions : cérémonies de mariage avec un personnage qui fait irruption avec une révélation. Triangles amoureux : déclarations d'amour et histoires extraconjugales. Décès / résurrections : personnages qui disparaissent et réapparaissent de façon surprenante. Grossesses : drames familiaux, tests de paternité, héritage… Vengeances et complots : trahisons amoureuses ou business. Cliffhangers : fin d'épisode juste après une révélation. Confessions : les pardons sont difficiles, d'où amertumes et vengeances sur plusieurs épisodes.", phrasesClassiques: ["“Tu m'as menti depuis le début!”", "“Je ne te pardonnerai jamais!” - “Tu vas me le payer”", "“Comment as-tu pu me faire ça?” - “Ce que tu fais est impardonnable”", "“Ce n'est pas ce que tu crois!”", "“Je te l'avais bien dit !”", "“Il y a quelque chose que tu dois savoir...” - “Nous devons parler.”", "“Je suis ton père/mère.” - “C'est fini entre nous.” - “Je ne suis pas celui/celle que tu crois.”", "“Je ne peux pas continuer comme ça.”", "“Tu n'aurais jamais dû revenir.”"],vocabulaireUnivers: { lexique: "trahison, mariage, divorce, héritage, Cocktail, Ranch/propriété, vengance, testament, hôpital, verre, test de paternité, honneur", personnages: "Victor / James / Stefan\nVictoria / Sue Helen / Kelly\nPrénoms américains des années 80/90's", expressions: "Rythme lent : On se parle avec une intensité dramatique des choses simples. Les pauses sont longues et chargées de regards\nLes personnages se nomment sans cesse (\"Écoute-moi bien, Victoria...\").", styleDiscours: "REDONDANT, EXPLICATIF ET INTENSITÉ EMOTIONS", tips: "Explication du passé : Comme le public change, les personnages rappellent souvent les faits précédents (\"Souviens-toi que c'est moi qui t'ai sauvé quand ton propre père t'a renié !\")." },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 3, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "0b8e5d21", name: "Le patriarche / la matriarche", desc: "Chef de famille autoritaire, détient fortune et secrets, dicte le destin des autres." }, { id: "7a3f9c46", name: "Le séducteur / la séductrice", desc: "Charme et manipule pour arriver à ses fins, multiplie conquêtes et trahisons." }, { id: "d216b8e9", name: "Le manipulateur / la manipulatrice", desc: "Tire les ficelles dans l'ombre, orchestre complots et chantages." }, { id: "4e9a0f73", name: "L'ex-mari / l'ex-femme", desc: "Resurgit pour raviver un triangle amoureux et déstabiliser le couple en place." }, { id: "c15d8a62", name: "Le héros loyal", desc: "Personnage droit qui tente de préserver la famille malgré les trahisons autour de lui." }, { id: "9f2e6b04", name: "Le meilleur ami confident", desc: "Recueille les confidences et sert de témoin aux rebondissements." }, { id: "5b0c7d18", name: "L'enfant caché / l'héritier surprise", desc: "Révélation choc qui bouleverse l'équilibre familial et l'héritage." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Télé-réalité", summary: "Les émissions de télé-réalité mettent en compétition des candidats aux personnalités bien marquées dans un jeu ou une discipline (cuisine, chant, danse). Les candidats ne sont pas censés jouer de personnages mais leur propre personnalité. Les valeurs mises en avant sont rarement positives, on cherche le conflit. Le public ainsi que des jurys ou bien un présentateur interviennent dans le déroulé de la compétition. On peut inclure les jeux télévisés ainsi que les télé-crochets.", themesFrequents: "Compétition, talent, relations amoureuses, sexe, transformation personnelle, confinement, voyage, célébrité, argent, jeu de hasard, vie quotidienne, voyeurisme, alliance et trahison, survie.", phrasesClassiques: ["“Non mais allô quoi!” - Les Anges de la télé-réalité", "“Je suis pas venue ici pour souffrir, ok?” - Les Ch'tis", "“C'est la guerre des clans!” - Koh-Lanta", "“C'est pas Versailles ici!” - Secret Story", "“Je suis célibataire, je prends tout ce qui bouge.” - Loft Story", "“On n'est pas chez les Bisounours.” - Star Academy.", "“Tu les emmerdes avec un grand A” - Loft Story 2", "“C'est pas au vieux singe qu'on apprend à faire des limaces” - Secret Story 2", "“C'est une fille qui n'a pas sa langue dans sa bouche” - Secret Story 4", "“Je suis têtue comme une moule” - Secret Story 3"],vocabulaireUnivers: { lexique: "Confessionnal, Buzz, Clash, Secret, Prime, Villa, Camera, Appel famille, Nominé, Menteur, Crush, Hater", personnages: "Prénoms courants 2010/2020\nKévin / Julien / Anthony / Issam\nJessica / Mila / Hillary / Samantha", expressions: "Parler jeune/familier / Tic de langage : en vrai / J'avoue / claqué au sol...\nSyntaxe pauvre : Phrases souvent mal construites, basées sur l'émotion brute. Tension. On abuse des superlatifs (\"C'est la pire trahison de ma vie\").", styleDiscours: "PAUVRE, CENTRE SUR L'EGO POUR FAIRE DU BUZZ", tips: "Le style change entre la vie de groupe (cris, phrases hachées) et le confessionnal où le candidat adopte un ton de narrateur, souvent au présent pour rendre l'action plus \"vraie\"" },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 2, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "1b7ae101", name: "Le stratège", desc: "candidat calculateur et manipulateur qui fait tout pour gagner la compétition. Il passe pour un intellectuel et peut se montrer méprisant. Il forme des alliances avec tout le monde et est prêt à trahir n'importe qui. Ex: Bastien Grimal dans Secret Story 10." }, { id: "d97166cf", name: "Le séducteur", desc: "dragueur invétéré, il a un corps parfait (ou en tout cas qu'il considère parfait). Il multiplie les romances avec les candidats et crée des conflits sur les relations. Ex: Loana dans Loft Story." }, { id: "18250cea", name: "Le compétiteur", desc: "fort, endurant, charismatique, il gagne les épreuves et peut être considéré comme un leader. Il est vite considéré comme un rival à éliminer quand on approche des finales. Ex: Moundir dans Koh-Lanta." }, { id: "91771c11", name: "Le comique", desc: "un blagueur léger qui se moque de tout le monde. Ex: Patrice joué par Kad Merad dans Le flambeau." }, { id: "c4bd5825", name: "L'outsider / drama queen", desc: "la victime de l'émission qui se sent persécutée par les autres candidats et en profite pour faire des scandales ou bien. Ex: Nabilla dans Les Anges de la Télé-Réalité 5." }, { id: "6e616bfb", name: "Le bon copain", desc: "candidat apprécié par tout le monde, il essaye de régler les conflits et d'apaiser les tensions. Il est le confident préféré des autres candidats. Il est honnête, sincère et bienveillant ce qui le fait gagner le cœur du public. Ex: Anaïs Camizuli dans Secret Story 7." }, { id: "41483b25", name: "Le provocateur", desc: "source perpétuelle de conflit, il va chercher les ennuis avec tous les candidats. Ex: Jean-Pascal dans La Star Academy, évidemment, auteur de la chanson L'agitateur" }, { id: "aa0722ca", name: "Le naïf", desc: "on lui fait croire n'importe quoi, il paraît innocent, on le prend sous son aile. Ex: Raphaël Pépin dans Les Anges de la Télé-Réalité." }, { id: "befaa2f5", name: "Le “perché”", desc: "mystique, spirituelle ou bien artiste perdu dans son monde, personne ne le comprend tout à fait. Il provoque la perplexité ou la méfiance auprès des candidats. Ex: Cindy Sander dans Les anges de la téléréalité, avec sa sublime chanson Papillon de lumière" }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Cape et Épée", summary: "Le genre Cape et Épée met en scène des héros courageux évoluant dans une Europe inspirée des XVIᵉ et XVIIᵉ siècles. Il mêle aventures, duels spectaculaires, intrigues de cour, complots politiques et romances passionnées. Les personnages vivent selon un fort code d'honneur où le courage, la loyauté et l'élégance comptent autant que la victoire.", themesFrequents: "L'honneur, la loyauté, la vengeance, les complots politiques, les rivalités entre nobles, l'amitié, le sacrifice, les conspirations, la défense du royaume, les identités secrètes, les romances impossibles, les serments et la justice personnelle.", phrasesClassiques: ["« Un pour tous, tous pour un ! »", "« Défendez votre honneur, l'épée à la main ! »", "« Je ne combats jamais un adversaire désarmé. »", "« Vous répondrez de cette insulte au lever du soleil ! »", "« Mon épée est au service du roi. »"], universAssocies: "Aventure : exploration, poursuites, trésors et voyages. Historique : intrigues inspirées de personnages et d'événements réels. Pirates : combats à l'épée, abordages et quête de liberté. Romance : passions contrariées, lettres secrètes et amours impossibles.",vocabulaireUnivers: { lexique: "Panache, Galanterie, Embuscade, Lame, Duel, Honneur, Dame, Remords, briguer, commodités, appartement de bain, galant", personnages: "Henry, Aristide, Phillipe, Charles...\nAntoinette, Mirabelle, Aurore, Flore, Constance\nDonner des titres de noblesse : Madame de ....., Le comte du ....., la duchesse, le maréchal", expressions: "vouvoiement même entre proche\nEn garde...\nUn pour tous, tous pour un\nCesser de rêvassez aux astres...", styleDiscours: "", tips: "Sens de la répartie : Rajouter plein de mots et d'expression pour dire des choses simples\nJe vais vous tuer : Vous allez voir de plus que prêt ma lame effleurer votre âme." },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 6, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "a774b17d", name: "Le jeune bretteur", desc: "Courageux, fougueux et parfois impulsif, il rêve de devenir un grand héros et de défendre son honneur. Il excelle à l'épée mais manque encore d'expérience. Ex : D'Artagnan dans Les Trois Mousquetaires." }, { id: "2ea482e7", name: "Le mousquetaire fidèle", desc: "Soldat d'élite loyal envers le roi et ses compagnons. Il privilégie l'amitié, le devoir et le panache." }, { id: "569e4272", name: "Le cardinal ou le ministre manipulateur", desc: "Stratège politique qui agit dans l'ombre pour accroître son pouvoir. Il préfère les intrigues aux combats directs. Ex : le Cardinal de Richelieu." }, { id: "01715f8e", name: "Le noble arrogant", desc: "Fier de son rang, excellent escrimeur, il provoque facilement les autres en duel." }, { id: "9e33d29d", name: "La dame de cour", desc: "Élégante, intelligente et influente. Elle cache parfois des secrets ou joue un rôle décisif dans les intrigues." }, { id: "748024ee", name: "Le fidèle valet", desc: "Dévoué, débrouillard et souvent comique. Il aide son maître à sortir des situations les plus périlleuses." }, { id: "4fa1ee77", name: "Le maître d'armes", desc: "Vétéran expérimenté qui transmet son savoir et rappelle les valeurs de l'honneur." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Péplum", summary: "Le péplum est un genre épique se déroulant dans l'Antiquité, principalement sous les civilisations grecque, romaine ou égyptienne. Il met en scène des héros plus grands que nature confrontés à des guerres, des conquêtes, des intrigues politiques ou à la volonté des dieux. Les décors sont grandioses : temples, palais, arènes, déserts et champs de bataille. Le destin des personnages est souvent lié à la gloire, au pouvoir ou à l'honneur.", themesFrequents: "La conquête, l'honneur, la gloire, la guerre, la vengeance, les intrigues de palais, le pouvoir, le destin, la foi envers les dieux, la liberté face à la tyrannie, les sacrifices héroïques, les révoltes d'esclaves.", phrasesClassiques: ["« Les dieux en seront témoins ! »", "« Rome ne pliera jamais ! »", "« La victoire ou une mort glorieuse ! »", "« Que les dieux guident nos armes. »", "« Aujourd'hui, nous entrerons dans l'Histoire ! »"], universAssocies: "Mythologie : dieux, héros légendaires, monstres et prophéties. Tragédie grecque : destin inévitable, conflits moraux et intervention divine. Historique : reconstitution de grandes civilisations et de personnages ayant réellement existé. Cape et épée : héros guidés par l'honneur, combats spectaculaires et aventures épiques.",vocabulaireUnivers: { lexique: "glaive, toge, légionnaire, Sénat, arènes, gladiateur, oracle, sesterce/écu, char, éphèbe, temple, thermes, forum, galère, citoyen, scribe", personnages: "prénoms masculins en -US\nprénoms féminins en -IA ou -INE\nPrénoms composés pour les hommes de type : Marcus Victor / Valérius le grand...", expressions: "Salut à toi, noble..../ Avé\nPar les dieux\nCeux qui vont mourir te saluent !\nPour la gloire de Rome", styleDiscours: "LANGAGE SOLENNEL ARCHAÏQUE ou THÉÂTRAL", tips: "L'inversion sujet-verbe : Grand est ton courage / Fidèle est ton amitié !\nMétaphores à la nature : associer un personnage/un tempérament à un animal noble" },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 5, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "71fd6954", name: "Le général victorieux", desc: "Stratège brillant et chef respecté, il mène ses soldats vers la victoire mais peut être tenté par le pouvoir. Ex : Maximus dans Gladiator." }, { id: "4ba3f023", name: "L'empereur ou le roi", desc: "Souverain charismatique ou tyrannique qui dirige son peuple. Il est souvent au cœur des intrigues politiques." }, { id: "5c0207ce", name: "Le gladiateur", desc: "Combattant forcé ou volontaire qui cherche sa liberté ou sa vengeance dans les arènes. Son courage inspire le peuple." }, { id: "3ff4865a", name: "Le sénateur ou le conseiller", desc: "Fin politicien qui influence le pouvoir par les alliances, les discours et les manipulations." }, { id: "d71562ea", name: "La prêtresse ou l'oracle", desc: "Interprète la volonté des dieux et annonce les prophéties qui guideront ou condamneront les héros." }, { id: "4f389360", name: "L'esclave rebelle", desc: "Refuse sa condition et rêve de liberté. Son combat peut déclencher une révolution. Ex : Spartacus." }, { id: "9fb503ca", name: "Le conquérant étranger", desc: "Chef d'un peuple rival ou envahisseur, parfois ennemi, parfois futur allié." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Espionnage", summary: "L'espionnage met en scène des agents secrets évoluant dans un monde où les apparences sont trompeuses. Les intrigues reposent sur des missions secrètes, des doubles jeux, des organisations clandestines et des enjeux internationaux. Les héros utilisent autant leur intelligence, leur discrétion et leur sang-froid que leurs compétences en combat. Le suspense est omniprésent et la confiance est une denrée rare.", themesFrequents: "Les missions secrètes, les complots internationaux, les doubles agents, la manipulation, les technologies de pointe, la surveillance, la guerre froide, le terrorisme, les organisations secrètes, la loyauté, la trahison, les identités cachées, le sacrifice au nom d'une nation.", phrasesClassiques: ["« Ce message s'autodétruira dans cinq secondes. »", "« Vous êtes grillé. »", "« Faites-moi confiance... pour cette fois. »", "« La mission passe avant tout. »", "« Personne ne doit savoir que vous êtes ici. »"], universAssocies: "Action : poursuites, fusillades, explosions et combats spectaculaires. Polar : enquêtes, indices, filatures et manipulation. Thriller : tension permanente, complots et suspense psychologique. Technothriller : cyberattaques, intelligence artificielle, surveillance numérique et espionnage électronique.",vocabulaireUnivers: { lexique: "taupe, exfiltration, nettoyer, Mallette, microfilm, légende, surveiller, drône, Renseignement, neutraliser, intérrogatoire, protocole", personnages: "Alec / Victor / Luca / Igor / Malik\nIngrid / Sloane / Irina / Nour\nà adapter au lieu géographique", expressions: "des termes techniques et des abréviations ex : \"Le QG attend le rapport sur l'opération Echo\".\nOn parle en \"mots de passe\" ou en métaphores pour ne pas être compris. Sans adjectif", styleDiscours: "DISCOURS CODÉ, SANS SENTIMENT", tips: "Dans les scènes d'interrogatoire ou de rencontre entre deux agents ennemis, le ton est extrêmement poli, ce qui renforce la menace.\n« Monsieur, nous apprécierions grandement que vous nous remettiez ces documents avant que la situation ne devienne... inconfortable pour tout le monde. »" },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 2, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "55559226", name: "L'agent secret", desc: "Calme, intelligent et extrêmement compétent, il excelle dans l'infiltration, le combat et l'improvisation. Il garde son sang-froid en toutes circonstances. Ex : James Bond." }, { id: "3c08020d", name: "Le maître espion", desc: "Responsable de l'agence, il coordonne les missions depuis l'ombre et fournit les informations essentielles." }, { id: "b84fc8ff", name: "Le génie des gadgets", desc: "Inventeur brillant qui équipe les agents de technologies innovantes et parfois improbables. Ex : Q dans James Bond." }, { id: "544ef8c5", name: "L'agent double", desc: "Il travaille pour plusieurs camps à la fois. Ses véritables intentions restent mystérieuses jusqu'au dénouement." }, { id: "5ab8aa32", name: "Le grand méchant", desc: "Chef d'une organisation criminelle ou terroriste cherchant à contrôler le monde, faire chanter les gouvernements ou provoquer une crise internationale." }, { id: "b8ed3098", name: "L'informateur", desc: "Personnage discret qui transmet des renseignements précieux, souvent au péril de sa vie." }, { id: "5ab13dfe", name: "Le tueur professionnel", desc: "Redoutable adversaire envoyé pour éliminer l'agent. Il est méthodique, silencieux et particulièrement dangereux." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Arts martiaux", summary: "L'univers des arts martiaux met en scène des combattants qui cherchent à perfectionner leur corps, leur esprit et leur technique. Les histoires se déroulent souvent dans des dojos, des temples, des écoles rivales ou lors de grands tournois. Les combats sont chorégraphiés, spectaculaires et reposent autant sur la discipline, le respect et la maîtrise de soi que sur la force brute.", themesFrequents: "Le dépassement de soi, la discipline, l'honneur, la maîtrise des émotions, la transmission d'un savoir, la vengeance, la rivalité entre écoles, l'équilibre entre force et sagesse, la persévérance, la justice, la rédemption.", phrasesClassiques: ["« Le plus grand combat est celui contre toi-même. »", "« La force sans maîtrise ne vaut rien. »", "« Vide ton esprit. »", "« Respecte ton adversaire avant de le combattre. »", "« Un vrai maître n'a plus besoin de prouver sa force. »"], universAssocies: "Sport : compétitions, entraînements et tournois. Action : combats chorégraphiés, poursuites et cascades. Aventure : voyage initiatique, découverte de nouveaux maîtres et de techniques oubliées. Samouraïs / Chine impériale : arts martiaux traditionnels, philosophie orientale et récits historiques.",vocabulaireUnivers: { lexique: "Dojo, Ceinture, Maître, Discipline, Technique, Combat, Honneur, Tournoi, Ki, Méditation, École rivale, Entraînement" },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 6, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "feea4bb4", name: "Le maître", desc: "Sage, patient et exigeant, il enseigne autant une philosophie de vie qu'une technique de combat. Il pousse ses élèves à révéler leur véritable potentiel. Ex : Maître Miyagi dans Karate Kid." }, { id: "d6c4ad51", name: "Le jeune disciple", desc: "Motivé mais inexpérimenté, il progresse grâce à l'entraînement et apprend à contrôler ses émotions." }, { id: "5b45d361", name: "Le rival", desc: "Talentueux, arrogant ou simplement très ambitieux, il pousse le héros à se dépasser. Il peut devenir un allié après avoir été vaincu." }, { id: "06c73e62", name: "Le grand champion", desc: "Combattant presque invincible, souvent vainqueur de nombreux tournois. Il représente l'objectif ultime à atteindre." }, { id: "06a0847d", name: "Le maître déchu", desc: "Ancien expert devenu amer ou corrompu. Il utilise son savoir à de mauvaises fins et devient l'antagoniste." }, { id: "6f86c578", name: "Le compagnon fidèle", desc: "Ami du héros, il apporte soutien, humour et encouragements pendant les épreuves." }, { id: "c7d7d02a", name: "Le vieux sage", desc: "Ancien maître retiré du monde, possédant une connaissance exceptionnelle qu'il accepte de transmettre au héros." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Super-héros", summary: "L'univers des super-héros met en scène des personnages dotés de pouvoirs extraordinaires, de technologies exceptionnelles ou de capacités hors du commun, qui choisissent de protéger la population contre des menaces dépassant les moyens des humains ordinaires. Derrière les combats spectaculaires se cachent souvent des dilemmes moraux, des identités secrètes et la difficulté de concilier une vie normale avec des responsabilités extraordinaires.", themesFrequents: "Le bien contre le mal, la responsabilité liée au pouvoir, l'identité secrète, le sacrifice, la justice, la vengeance, la rédemption, la protection des innocents, les catastrophes à grande échelle, les mutations, les origines des pouvoirs, le travail d'équipe, l'acceptation de sa différence.", phrasesClassiques: ["« Un grand pouvoir implique de grandes responsabilités. »", "« La ville compte sur nous. »", "« Tu n'es pas obligé d'être un héros... mais tu peux choisir de le devenir. »", "« Aujourd'hui, c'est nous qui protégeons le monde. »", "« Tant qu'il restera de l'espoir, je me battrai. »"], universAssocies: "Science-fiction : technologies futuristes, mutations, extraterrestres et intelligence artificielle. Action : combats spectaculaires, poursuites et destructions à grande échelle. Espionnage : organisations secrètes, missions confidentielles et agents spéciaux. Comics : univers partagés, héros récurrents, origines mythiques et affrontements entre super-vilains.",vocabulaireUnivers: { lexique: "Pouvoir, Identité secrète, Mission, Cape, Repaire, Origine, Némésis, Sauvetage, Catastrophe, Mutation, Justice, Sacrifice" },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 2, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "82208b44", name: "Le super-héros", desc: "Courageux, altruiste et prêt à se sacrifier pour protéger les autres. Malgré ses pouvoirs, il reste profondément humain et confronté à ses propres faiblesses. Ex : Superman." }, { id: "5917fbee", name: "Le mentor", desc: "Ancien héros ou scientifique qui guide le protagoniste et l'aide à maîtriser ses capacités." }, { id: "40e3d4fc", name: "Le super-vilain", desc: "Ennemi principal doté de pouvoirs comparables ou supérieurs à ceux du héros. Il poursuit souvent une vision extrême du monde. Ex : Le Joker, Thanos, Magneto." }, { id: "81b21f13", name: "Le partenaire fidèle", desc: "Allié ou coéquipier qui accompagne le héros dans ses missions et lui apporte un soutien moral ou tactique." }, { id: "18cbe6c9", name: "Le scientifique de génie", desc: "Inventeur ou chercheur responsable de technologies révolutionnaires ou de l'origine des pouvoirs." }, { id: "5cfbd378", name: "Le citoyen ordinaire", desc: "Famille, ami ou journaliste qui représente la vie normale du héros et rappelle ce qu'il cherche à protéger." }, { id: "291a5a85", name: "L'équipe de héros", desc: "Plusieurs héros aux pouvoirs complémentaires qui unissent leurs forces face à une menace trop importante pour un seul individu." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Vaudeville", summary: "Le vaudeville est une comédie fondée sur les quiproquos, les mensonges, les tromperies et les situations qui s'emballent progressivement. Les intrigues tournent souvent autour de l'amour, de l'adultère, des mariages et des secrets. Le rythme est généralement rapide et les personnages passent leur temps à essayer de cacher quelque chose tout en découvrant les secrets des autres.", themesFrequents: "L'adultère, les mensonges, les quiproquos, les amants cachés, les portes qui claquent, les mariages arrangés, les secrets, les déguisements, les malentendus, les voisins encombrants, les différences sociales, les situations compromettantes.", phrasesClassiques: ["« Ce n'est pas ce que vous croyez ! »", "« Je peux tout vous expliquer ! »", "« Surtout, ne dites rien à ma femme ! »", "« Mais qu'est-ce que vous faites ici ?! »", "« Il faut absolument que personne ne nous voie ensemble ! »"], universAssocies: "Comédie de boulevard : appartements bourgeois, portes qui claquent, adultères et quiproquos. Commedia dell'arte : personnages très typés, ruses, déguisements et intrigues amoureuses. Opérette : comédie légère mêlant dialogues, chants et danses.",vocabulaireUnivers: { lexique: "dépendances, amant/maitresse, placard, plumeau, malentendu, valet/soubrette, jardinet, appartement, Mensonge, Robe de chambre, baldaquin, dentelles", personnages: "Masculin : Hugues, Hubert, Ambroise\nFéminin : Angélique, Bénédicte, Graziella\nprénoms un peu bourgeois/ Aristo", expressions: "Des exclamations de panique : \"Ciel !\" etc.\nExpression toujours dans l'excès.\nMalentendu permanent : utiliser le double sens\nDébit rapide : on se coupe la parole.", styleDiscours: "DISCOURS RAPIDE NERVEUX MENSONGER", tips: "L'aparté : briser le 4ème mur pour faire des confidences et livrer ses angoisses au public\nex : \"S'il ouvre le placard, je suis un homme mort\"" },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 3, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "964bbb94", name: "Le mari trompé", desc: "Personnage souvent naïf qui ne comprend pas immédiatement ce qui se passe autour de lui. Il peut être le dernier à découvrir l'adultère." }, { id: "bd188e3f", name: "L'amant / l'amante", desc: "Personnage qui doit constamment se cacher, inventer des excuses et éviter de rencontrer la mauvaise personne au mauvais moment." }, { id: "5f0b9c22", name: "L'épouse soupçonneuse", desc: "Elle remarque les incohérences et cherche à découvrir la vérité. Ses soupçons provoquent souvent de nouvelles catastrophes." }, { id: "15b888cf", name: "Le séducteur", desc: "Charmeur et sûr de lui, il accumule les conquêtes et considère les problèmes amoureux comme un jeu." }, { id: "1540181c", name: "Le domestique complice", desc: "Il connaît tous les secrets de la maison et doit aider les personnages à maintenir leurs mensonges. Il peut être plus intelligent que ses maîtres." }, { id: "8322aa2c", name: "Le voisin encombrant", desc: "Il arrive toujours au mauvais moment et complique involontairement la situation." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Dessin animé", summary: "Le dessin animé est un univers où les règles de la réalité peuvent être librement détournées. Les personnages sont souvent très expressifs, les émotions sont amplifiées et les objets peuvent prendre vie. Le comique physique, les transformations, les poursuites et les situations impossibles occupent une place importante. Le dessin animé peut aussi prendre la forme d'un conte merveilleux ou d'une grande aventure.", themesFrequents: "L'amitié, la famille, l'aventure, la découverte, la différence, le courage, le bien contre le mal, la quête, la magie, l'humour, la rivalité, la transformation, le dépassement de soi.", phrasesClassiques: ["« Ça va mal finir, cette histoire ! »", "« J'ai un plan ! »", "« Qu'est-ce qui pourrait mal tourner ? »", "« Cette fois, c'est personnel ! »", "« Il faut sauver le monde ! »"], universAssocies: "Conte : héros, magie, créatures fantastiques et morale. Comédie : gags visuels, personnages excentriques et situations absurdes. Aventure : quête, voyage, trésor et découverte de mondes inconnus. Fantasy : magie, créatures fantastiques et royaumes imaginaires.",vocabulaireUnivers: { lexique: "ami, dinosaure, parents, dispute, Secret, pouvoir, banzai, univers, Attention, Aimer, méchant, rigolo", personnages: "prénoms long (3 syllabes mini) selon pays de l'action\nFille en -ine\nEx : Audeline / Tomasitoni / Karusété", expressions: "Utiliser des onomatopées verbales : Whaou! Zut! Pof \"Et bim\"\nAvec adjectifs forts et des métaphores visuelles : absolument/ génialement/etc.", styleDiscours: "DISCOURS TRES EXPRESSIF ET DIDACTIQUE", tips: "C'est un style où il est +++ de changer sa voix ou d'avoir un tic de parole (zézaiement/ bégaiement et/ou une phrase fétiche à répéter." },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 6, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "05519a65", name: "Le héros maladroit", desc: "Personnage sympathique mais pas toujours très compétent. Il provoque involontairement les catastrophes et finit pourtant par sauver la situation." }, { id: "e3c9a05c", name: "Le héros courageux", desc: "Personnage déterminé qui accepte une grande mission et doit affronter des épreuves pour protéger les autres." }, { id: "b971b752", name: "Le meilleur ami comique", desc: "Compagnon fidèle et souvent maladroit qui apporte humour et légèreté." }, { id: "3ba61202", name: "Le méchant extravagant", desc: "Antagoniste très expressif, dont les ambitions sont parfois absurdes. Il possède souvent un plan démesuré." }, { id: "08daaff5", name: "L'animal compagnon", desc: "Animal parlant ou particulièrement expressif qui accompagne le héros et peut devenir un véritable partenaire." }, { id: "0051cb0b", name: "Le personnage sage", desc: "Mentor qui possède les connaissances nécessaires pour guider le héros." }, { id: "4ca18ba9", name: "Le personnage secondaire loufoque", desc: "Personnage excentrique dont le comportement décalé provoque régulièrement des gags." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Pirate", summary: "L'univers pirate met en scène des marins vivant en dehors des règles, parcourant les mers à la recherche de richesses, de liberté ou d'aventure. Il mélange abordages, trésors, cartes mystérieuses, îles inconnues, batailles navales et légendes. L'univers repose fortement sur l'imaginaire collectif : navires, sabres, canons, perroquets, capitaines, tempêtes et trésors maudits.", themesFrequents: "La liberté, le trésor, l'aventure, la piraterie, les mutineries, la loyauté, la trahison, les malédictions, les cartes secrètes, les îles mystérieuses, les batailles navales, la vengeance, la découverte de terres inconnues.", phrasesClassiques: ["« À l'abordage ! »", "« Cap sur l'île au trésor ! »", "« Mille sabords ! »", "« Le trésor est à nous ! »", "« Une mutinerie ?! Sur mon navire ?! »", "« Cette carte nous mènera à la fortune ! »"], universAssocies: "Aventure : exploration, trésors, voyages et territoires inconnus. Cape et épée : combats au sabre, héros charismatiques et aventures rocambolesques. Fantasy : magie, créatures marines, malédictions et trésors surnaturels. Grandes découvertes : caravelles, Nouveau Monde, tempêtes, batailles navales et exploration.",vocabulaireUnivers: { lexique: "flibustier, galion, sabord, Marée, requin, tortues, grog, coutelas, Vigie, Parlementer, Saborder, Tonneau", personnages: "Anne / Mary / Lady\nJack / Morgan / Jimmy / Sam\nà associer avec une expression : le rouge / Crochet / Sans dent / La tempête", expressions: "En argot des mers : imagé\nAvec des jurons : Mille Sabord ! Par le tonnerre !\nMétaphore de la mer : tout est ramené à la mer \"il va sombrer\" \"Réduis la voilure\" = calme toi", styleDiscours: "DISCOURS RUGUEUX ET FIER", tips: "oralité \"bas de plafond\" : On simule souvent une élocution un peu traînante, rocailleuse, comme si le personnage avait trop bu de rhum ou perdu des dents" },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 2, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "bf12ff74", name: "Le capitaine pirate", desc: "Chef charismatique de l'équipage, courageux et parfois imprévisible. Il possède un grand sens de la liberté et peut être obsédé par un trésor ou une vengeance." }, { id: "20b86e6e", name: "Le second", desc: "Bras droit du capitaine, il maintient l'ordre à bord et peut devenir son rival en cas de désaccord." }, { id: "8bbb78fc", name: "Le vieux marin", desc: "Ancien pirate couvert de cicatrices, il connaît les légendes de la mer et raconte les dangers qu'il a rencontrés." }, { id: "8655d6b4", name: "Le jeune mousse", desc: "Nouveau venu sur le navire, il découvre progressivement la vie de pirate et peut devenir le héros de l'histoire." }, { id: "78469a9f", name: "Le pirate rival", desc: "Capitaine ennemi cherchant le même trésor. Il peut être plus cruel, plus riche ou simplement plus rusé." }, { id: "e85fe186", name: "Le gouverneur / officier de marine", desc: "Représentant de l'autorité qui cherche à capturer les pirates et à faire respecter la loi." }, { id: "cbf6a084", name: "La mystérieuse gardienne du trésor", desc: "Personnage qui connaît le secret d'une île, d'une malédiction ou d'un trésor légendaire." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Contes et légendes", summary: "Les contes et légendes plongent les personnages dans un monde où le merveilleux et le quotidien peuvent se rencontrer. Ils reposent souvent sur des histoires transmises de génération en génération et mettent en scène des héros, des créatures fantastiques, des épreuves et des enseignements. La structure est généralement simple et symbolique : un personnage quitte son monde ordinaire, rencontre des obstacles et revient transformé.", themesFrequents: "Le bien contre le mal, la quête, la magie, la malédiction, l'amour, la jalousie, la ruse, le courage, la récompense, la punition, le passage à l'âge adulte, le destin, les épreuves initiatiques.", phrasesClassiques: ["« Il était une fois... »", "« Il y a bien longtemps, dans un royaume lointain... »", "« Trois jours et trois nuits plus tard... »", "« Mais le héros ignorait encore que... »", "« Et c'est ainsi que tout commença... »", "« Ils vécurent heureux et eurent beaucoup d'enfants. »"], universAssocies: "Onirique : frontière floue entre réalité et imaginaire, logique des rêves et événements merveilleux. Fantasy : magie, créatures fantastiques, quêtes héroïques et royaumes imaginaires. Mythologique : dieux, héros, monstres, prophéties et récits fondateurs. Fantastique : monde réaliste dans lequel apparaissent progressivement des éléments surnaturels.",vocabulaireUnivers: { lexique: "orgre, maratre, sortilège, chaumière, épreuve, philtre, vœu, trésor, Carosse, Destin, Epine, Joyaux", personnages: "Simples et chantants : Aurore, Belle, Blanche / Arthur, Henry, Eric\nà adapter au lieu géographique", expressions: "Le conteur : à l'imparfait\nIl y a souvent des chiffres \" les 3 épreuves\" \"les 5 soeurs\".\nSimplicité psychologie : bon, mauvais, méchant, rusé..", styleDiscours: "DISCOURS INCANTATOIRE", tips: "La structure répétitive (Le ternaire) : Le langage utilise souvent des parallélismes de construction. Les choses arrivent souvent trois fois, avec une gradation dans les mots.\nExemple : « Elle frappa à la première porte, et personne ne répondit. Elle frappa à la seconde, et un silence lui répondit. Elle frappa à la troisième..." },  level: "", playersMin: 2, playersMax: 6, energy: "", duration: 6, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], thematiques: [], archetypes: [{ id: "d421b14c", name: "Le héros / l'héroïne", desc: "Personnage souvent jeune ou ordinaire qui doit accomplir une mission extraordinaire. Il ou elle grandit grâce aux épreuves." }, { id: "a51a478f", name: "La figure maléfique", desc: "Sorcière, ogre, démon ou créature qui cherche à empêcher le héros d'accomplir sa quête." }, { id: "e1c9b509", name: "Le sage", desc: "Vieille femme, ermite, magicien ou animal parlant qui donne au héros un conseil ou un objet magique." }, { id: "ed0339cb", name: "Le personnage royal", desc: "Roi, reine, prince ou princesse. Il peut être la personne à sauver, celle qui donne la quête ou le personnage que le héros doit devenir." }, { id: "bac00cb5", name: "L'animal merveilleux", desc: "Créature qui aide le héros grâce à sa ruse, ses pouvoirs ou ses connaissances." }, { id: "7277adb3", name: "Le personnage trompeur", desc: "Personnage qui dissimule son identité ou manipule les autres. Il peut être aussi bien allié qu'ennemi." }, { id: "7974b149", name: "La créature fantastique", desc: "Dragon, loup-garou, géant, fée, sirène, troll, ogre ou autre être surnaturel." }], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"] },
  { name: "Sitcom", summary: "Série humoristique avec personnages récurrents et situations du quotidien.", vocabulaireUnivers: { lexique: "Cafet, Ami, Chelou, Ca me gave, Je croyais, Secret, Rendez-vous, Concert, Beau/belle, gratte, se défoncer, taffer", personnages: "Joe / Mike / Jimmy / Lam\nLizzy / Kelly / Lin\nPrénoms courts des années 90/2000", expressions: "Rythme Set-up / Punchline : Une phrase prépare la blague, la suivante la donne.\nEn chambrant tout le temps = langage de complicité.\nVoc du quotidien : boulot, dates ratés et ragots.", styleDiscours: "ARTIFICIEL, OPTIMISÉ POUR LE RIRE", tips: "Les réactions sont toujours \"trop\". On n'est pas juste surpris, on est sidéré. Le vocabulaire est quotidien mais chargé d'adjectifs intensifs\n\"C'est littéralement la pire chose qui soit jamais arrivée dans l'histoire de l'humanité !\"." }, level: "", playersMin: 3, playersMax: 6, energy: "Forte", duration: 6, tags: ["Univers"], objectives: ["Univers", "ambiance musicale"], showTypes: ["Concept original"], famillesObjectifs: ["Travail des univers"], thematiques: [], archetypes: [{ id: "f4a1e630", name: "Le groupe d'amis soudé", desc: "Bande aux personnalités bien tranchées qui vit ses petits drames du quotidien ensemble." }, { id: "8d5c2b97", name: "Le meilleur ami maladroit", desc: "Source de gags et de situations embarrassantes, toujours à côté de la plaque." }, { id: "2a7f9e40", name: "Le/la coloc ou voisin(e) envahissant(e)", desc: "Imprévisible, avec ses habitudes bizarres, s'incruste sans cesse." }, { id: "e0b6d381", name: "Le patron / la patronne excentrique", desc: "Figure d'autorité au travail, ridicule ou totalement décalée." }, { id: "6c9a4f15", name: "Le couple en dents de scie", desc: "Se sépare et se remet ensemble sans cesse, alimente les intrigues amoureuses." }, { id: "b31e0c58", name: "Le/la rabat-joie rationnel(le)", desc: "Voix de la raison qui sert de contrepoint aux frasques du groupe." }] },
  { name: "Triathlon", canCloseShow: true, summary: "Une impro selon 3 genres différents en fonction du sifflet du MC", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 4, tags: ["Narration"], objectives: ["MC", "intervention MC", "genre", "univers"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Civilisation perdue", summary: "Scène selon les codes d'une civilisation perdue : Versailles, Grèce antique, Rome, Vikings, Japon médiéval, aztèque, Egypte ancienne...", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Narration"], objectives: ["civilisation", "histoire", "Versailles", "Grèce antique", "Rome", "Vikings", "Japon médiéval", "aztèque", "Egypte ancienne"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "À la manière de...", summary: "Scène selon les codes d'un•e auteur•e ou réalisateur•ice : Tarantino, Miyazaki, Spielberg, Tim Burton, Marcel Pagnol", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Narration"], objectives: ["cinéma", "film", "Tarantino", "Miyazaki", "Spielberg", "Tim Burton", "Marcel Pagnol"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Point de vue", canOpenShow: true, summary: "Les joueurs en ligne vont jouer/raconter à leur tour le point de vue d'un personnage de la même histoire", level: "Débutant", playersMin: 4, playersMax: 8, energy: "Faible", duration: 6, tags: ["Narration"], objectives: ["mot", "écoute", "relation", "personnage", "voix"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Comment en est-on arrivé là ?", summary: "Le MC lit un fait divers du journal et les joueurs doivent expliquer comment c'est arrivé en impro.", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Narration"], objectives: ["thème", "journal", "fait divers"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "3 débuts", summary: "3 débuts d'impro sont proposés au public. Le public choisit lequel on va poursuivre", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Narration"], objectives: ["public", "intervention public", "caucus", "imprévu"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Punch-out", summary: "Le public donne une phrase qui va terminer l'impro", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Narration"], objectives: ["thème", "public", "intervention public", "imprévu"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "L'absent", summary: "Le personnage principal de l'impro est absent et on ne le voit jamais", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Narration"], objectives: ["entrées/sorties."], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Feuilleton en plusieurs parties", summary: "Plusieurs impros qui déploient une même histoire tout au long du spectacle", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Narration"], objectives: ["feuilleton", "plusieurs parties"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Objets parlants", summary: "On incarne des objets dans un cadre donné : les mets de la table de Noël / les objets dans un garage...", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Forte", duration: 4, tags: ["Narration"], objectives: ["voix", "personnage", "corps"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Composition de personnage", summary: "Un joueur doit jouer un personnage dont les traits sont choisis par le public", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Narration"], objectives: ["personnage"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Flashback", canCloseShow: true, summary: "Quand un joueur dit « ça me rappelle quand... » on fait un flashback", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 4, tags: ["Narration"], objectives: ["ça me rappelle", "tu te souviens", "écoute", "imagination"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Bis repetita", summary: "2 équipes de 2 joueurs. Quand une équipe joue l'autre freeze. L'autre équipe recommence quand elle veut mais doit réutiliser la dernière phrase dite par l'autre binôme", level: "Confirmé", playersMin: 4, playersMax: 4, energy: "Forte", duration: 5, tags: ["Narration"], objectives: ["binôme", "duo", "écoute"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Répondeur", summary: "Un joueur (ou le public) fait un répondeur et les autres joueurs lui laissent des messages", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Faible", duration: 5, tags: ["Narration"], objectives: ["voix"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Zone d'émotions", summary: "L'espace est divisé en 3 zones. Une émotion est choisie pour chaque zone par le public. Quand l'improvisateur passe sur cette zone son personnage doit ressentir cette émotion.", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 4, tags: ["Contrainte d'espace"], objectives: ["émotion", "zone"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Zone temporelle", summary: "L'espace est divisé en 3 zones: passé, présent et futur.", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 4, tags: ["Contrainte d'espace"], objectives: ["zone", "époque", "histoire"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Banc public", summary: "Sur la scène 3 chaises disposées comme si c'était un banc. La scène se passe dans un parc. 2 personnages vont se rencontrer puis 1 part, l'autre reste et rencontre 1 autre personnage. Etc.", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Contrainte d'espace"], objectives: ["chaise", "personnage", "rencontre", "regard"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Travelling", summary: "On suit le personnage qui sort de la scène. Et la scène continue dans un autre lieu.", level: "Avancé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 3, tags: ["Contrainte d'espace"], objectives: ["lieu", "entrées/sorties"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "3 étages", summary: "On joue dans un bâtiment à 3 étages. Au sifflet du MC on change d'étage", level: "Débutant", playersMin: 6, playersMax: 8, energy: "Forte", duration: 5, tags: ["Contrainte d'espace"], objectives: ["lieu", "entrées/sorties", "intervention MC", "MC"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Huit-clos", summary: "Les joueurs sont dans un espace clos et ne peuvent pas sortir", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Contrainte d'espace"], objectives: ["lieu", "relation", "plateforme"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "La corde", summary: "On jette une corde sur la scène, où on dessine un espace fermé avec la corde. Les joueurs doivent jouer uniquement dans cet espace", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Contrainte d'espace"], objectives: ["lieu", "espace", "imprévu"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Doublage américain", summary: "2 joueurs font les voix de 2 autres joueurs qui jouent", level: "Confirmé", playersMin: 4, playersMax: 4, energy: "Forte", duration: 4, tags: ["Contrainte vocale"], objectives: ["corps", "physique", "voix", "écoute", "mime", "acceptation"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Accents", summary: "Suisse, allemand, anglais, italien, espagnol, québécois, campagnard, belge 1. Chaque joueur se voit attribuer un accent 2. Tout le monde a le même accent et le MC change l'accent pendant l'impro", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Forte", duration: 3, tags: ["Contrainte vocale"], objectives: ["MC", "intervention MC", "voix"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Élimination / inversion de lettres", summary: "1. Une lettre est retirée et aucun joueur ne doit la prononcer sinon il est remplacé par un autre joueur 2. Deux lettres sont inversées comme les P par les T. Si erreur remplacement de joueur", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 3, tags: ["Contrainte vocale"], objectives: ["jeu", "mot", "voix"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Gromelot", summary: "Langage inventé GRMLB", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Forte", duration: 3, tags: ["Contrainte vocale"], objectives: ["emotion", "corps", "physique", "gromelot", "voix"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Traducteur", summary: "1 joueur va faire une conférence d'expert en Gromelot. Un autre joueur va traduire.\nVariante : à 4 dont 2 traducteurs. - 2 politiciens qui se rencontrent - blind date", level: "Confirmé", playersMin: 2, playersMax: 4, energy: "Forte", duration: 3, tags: ["Contrainte vocale"], objectives: ["écoute", "voix", "gromelot", "argumentation"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "1 seul mot", summary: "Chaque joueur ne peut dire et répéter qu'un seul mot qu'on leur a donné", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 3, tags: ["Contrainte vocale"], objectives: ["mot", "voix", "emotion", "silence"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "1 mot chacun", summary: "Scène normale mais les joueurs ne peuvent dire qu'un seul mot l'un après l'autre.", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 3, tags: ["Contrainte vocale"], objectives: ["mot", "voix", "emotion", "silence"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Compter de 1 à 50", summary: "Les joueurs remplacent leurs répliques par un comptage de 1 à 50. Ex: A = \"Unnn\" B = \"deux... Trois !\" A = \" quatres, cinq , six...\"", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 3, tags: ["Contrainte vocale"], objectives: ["voix", "emotion", "silence"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Parlotte / Monologue", summary: "Le MC désigne un joueur qui ne peut plus s'arrêter de parler jusqu'à ce que le MC l'arrête et la scène continue", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 3, tags: ["Contrainte vocale"], objectives: ["MC", "intervention MC", "voix", "mot", "argumentation"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "ABCDaire", summary: "Chaque réplique doit commencer par la bonne lettre de l'alphabet dans l'ordre : A…. Puis B…. Ect. La scène prend fin quand la dernière réplique commençant par la lettre Z est terminée.", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 3, tags: ["Contrainte vocale"], objectives: ["mot", "voix"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Que des questions", summary: "Les joueurs ne doivent parler qu'en questions. Sinon ils sont remplacés", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Forte", duration: 3, tags: ["Contrainte vocale"], objectives: ["jeu", "mot", "voix"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Pas de question", summary: "Si un joueur dit une question il sort et est remplacé par un autre qui reprend son personnage.", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Forte", duration: 3, tags: ["Contrainte vocale"], objectives: ["jeu", "mot", "voix"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Points d'exclamation", summary: "Chaque phrase doit se terminer par un point d'exclamation !", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 3, tags: ["Contrainte vocale"], objectives: ["voix", "émotion"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Doublage vidéo", summary: "Une vidéo d'un dialogue est diffusée. Les comédiens doivent doubler en direct les répliques de l'extrait.", level: "Confirmé", playersMin: 2, playersMax: 2, energy: "Faible", duration: 1.5, durationLabel: "1 min 30", tags: ["Contrainte vocale"], objectives: ["voix", "vidéo", "film"], advice: "Matériel : vidéo, ordinateur, rétroprojecteur ou écran", thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Carré hollandais", canCloseShow: true, summary: "4 joueurs qui tournent au sifflet du MC", level: "Débutant", playersMin: 4, playersMax: 4, energy: "Forte", duration: 6, tags: ["Contrainte physique"], objectives: ["MC", "intervention MC", "jeu", "physique", "corps"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Sans limite d'espace", summary: "Les joueurs peuvent jouer partout dans la salle et ne sont pas limités à la scène", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 3, tags: ["Contrainte physique"], objectives: ["physique", "corps"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Roman photo", summary: "Plusieurs joueurs font des poses et 1 ou 2 autres joueurs les commentent comme s'ils expliquaient des photos. Ils changent de photo en disant « clic-clac ».", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Contrainte physique"], objectives: ["narration", "argumentation", "physique", "corps"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Assis-debout-penché", summary: "3 joueurs. Il faut qu'à tout moment 1 joueur soit assis, 1 debout et 1 penché", level: "Débutant", playersMin: 3, playersMax: 3, energy: "Forte", duration: 3, tags: ["Contrainte physique"], objectives: ["physique", "corps", "ecoute", "observation"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Immobile", summary: "Les joueurs ne peuvent pas bouger. Juste des expressions faciales", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Faible", duration: 3, tags: ["Contrainte physique"], objectives: ["émotion", "voix", "physique"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Privé des sens", summary: "1. Les joueurs sont aveuglés ou rendus sourds 2. 1 ne voit pas, 1 n'entend pas et 1 ne parle pas", level: "Confirmé", playersMin: 3, playersMax: 8, energy: "Modérée", duration: 3, tags: ["Contrainte physique"], objectives: ["physique", "corps", "écoute", "sens"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Contact", summary: "Quand un joueur veut parler à un autre joueur il est obligé d'être en contact avec lui.", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Forte", duration: 3, tags: ["Contrainte physique"], objectives: ["physique", "corps", "relation", "contact", "emotion"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Grimace", summary: "Les joueurs vont figer une grimace sur leur tête et jouer des personnages en conservant cette grimace. Ne pas jouer de personnages idiots, ils ne sont pas conscients de la distorsion de leurs visages.", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 3, tags: ["Contrainte physique"], objectives: ["physique", "corps", "personnage"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Contée", summary: "1 conteur raconte une histoire qui est jouée par les autres joueurs La formulette d'introduction • il était une fois • cric crac cric crac faites silence faites silence c'est la queue du chat qui danse ! • rapprochez votre coeur et vos oreilles, l'histoire s'approche elle veut vous dire quelque chose Les motifs narratifs • les répétitions par 3 • les personnages contraires (protagoniste/antag) • la morale à la fin La structure • il était une fois... • et tous les jours... • mais un jour... • et depuis ce jour... La diction • voix théâtrale • rythme lent avec silence Univers • fantastique = pas forcément fantasy, la magie ne va pas de soi, les perso n'y croient pas forcément • ancien temps ou bien moderne • personnages populaires", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Faible", duration: 5, tags: ["Contrainte de style"], objectives: ["narration", "voix", "enjeux", "plateforme"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Rimée", summary: "Les joueurs doivent avoir des répliques qui riment entre elles.", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 3, tags: ["Contrainte de style"], objectives: ["mot", "voix"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Apartés/ confessional", summary: "À tout moment un joueur peut aller sur le devant de la scène et faire un aparté", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Contrainte de style"], objectives: ["personnage", "écoute"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Épistolaire", summary: "Les joueurs s'écrivent par lettres, SMS ou mails interposés", level: "Avancé", playersMin: 2, playersMax: 8, energy: "Faible", duration: 4, tags: ["Contrainte de style"], objectives: ["mot", "relation"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Dont vous êtes le héros", summary: "Le MC arrête l'impro et donne le choix au public sur la suite de l'impro", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 4, tags: ["Conduite par le MC"], objectives: ["MC", "intervention MC", "public", "intervention public", "imprévu", "adaptation"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "DVD", summary: "Le MC peut faire pause, ralenti, bande annonce, changement de langue, commentaire du réalisateur", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 4, tags: ["Conduite par le MC"], objectives: ["MC", "intervention MC", "imprévu", "adaptation"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Exagérée", summary: "Au sifflet du MC le joueur exagère sa proposition", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Forte", duration: 3, tags: ["Conduite par le MC"], objectives: ["MC", "intervention MC", "imprévu", "adaptation", "corps", "physique"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Change", summary: "Au sifflet du MC le joueur changé sa réplique", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 3, tags: ["Conduite par le MC"], objectives: ["MC", "intervention MC", "imprévu", "adaptation", "corps", "physique"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Show me that", canCloseShow: true, summary: "Le MC demande à ce que les joueurs jouent qqchose qu'ils ont dit", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Forte", duration: 3, tags: ["Conduite par le MC"], objectives: ["MC", "intervention MC", "corps", "physique", "imprevu"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Débat", summary: "1. Tous les joueurs sur scène doivent résoudre un débat 2. 2 joueurs débattent et 2 autres donnent des mots à caser.", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["De groupe"], objectives: ["argumentation", "mot", "écoute"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Carnage", summary: "Tous les joueurs doivent venir mourir.", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Forte", duration: 4, tags: ["De groupe"], objectives: ["physique", "entrees/sorties"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Interview d'expert", summary: "1 expert est sur scène. On demande un thème d'expertise au public, ou par interprétation de petit papier. Les autres joueurs sont assis dans le public et lui posent des questions comme si c'était une conférence de presse.", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 5, tags: ["De groupe"], objectives: ["public", "intervention public", "argumentation", "personnage"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Je remake mal / J'imite mal", canOpenShow: true, summary: "On demande à un joueur d'imiter une personnalité ou de remaker un film", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Forte", duration: 3, tags: ["Solo/duo et début/fin de spectacle"], objectives: ["personnage", "cinéma", "film"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Toaster", canCloseShow: true, summary: "Les joueurs s'accroupissent, quand le MC fait « ting » un nombre de joueurs aléatoire saute et commence une impro", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Forte", duration: 3, tags: ["Solo/duo et début/fin de spectacle"], objectives: ["MC", "intervention MC", "imprévu", "spontanéité"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Schizophrenia / Un pour tous", canOpenShow: true, summary: "Le joueur doit faire plusieurs perso", level: "Avancé", playersMin: 1, playersMax: 1, energy: "Forte", duration: 4, tags: ["Solo/duo et début/fin de spectacle"], objectives: ["personnage", "voix"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Zapping / Videowave / Scroll", canCloseShow: true, summary: "Des couples de joueurs jouent des emissions de télévision, ou des chaînes youtube au sifflet du MC", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Forte", duration: 4, tags: ["Solo/duo et début/fin de spectacle"], objectives: ["MC", "intervention MC", "binôme", "duo", "imprévu"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Mitraillette", canOpenShow: true, summary: "Impros solos ou duo à la suite", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 2, tags: ["Solo/duo et début/fin de spectacle"], objectives: ["binôme", "duo", "imprévu", "spontanéité"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Spot publicitaire", summary: "Une pub sur un objet donné par le public ou le MC. Trouver un slogan à la fin.", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 2, tags: ["Public"], objectives: ["public", "intervention public", "argumentation"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Procès", summary: "On fait le procès d'une personne du public. Procureur, avocat, témoins", level: "Confirmé", playersMin: 3, playersMax: 8, energy: "Modérée", duration: 5, tags: ["Public"], objectives: ["public", "intervention public", "argumentation", "personnage"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Téléphone arabe du public", summary: "Au début du spectacle le public se fait passer une phrase et ça continue pendant le spectacle. A la fin on récupère la phrase de début et c'est le début de l'impro. La phrase de fin sera la dernière de l'impro.", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Public"], objectives: ["public", "intervention public", "feuilleton", "imprévu"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Accessoires", summary: "On pose des objets du public sur le devant de la scène et les joueurs doivent les utiliser mais avec des usages détournés", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Forte", duration: 4, tags: ["Public"], objectives: ["public", "intervention public", "imprévu", "adaptation"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Pilier", summary: "Un membre du public finit les phrases des joueurs", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 4, tags: ["Public"], objectives: ["public", "intervention public", "écoute", "imprévu", "adaptation"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Petits papier", canCloseShow: true, summary: "Les joueurs doivent dire les mots qu'il y a sur les papiers du public à l'intérieur d'une impro cohérente. On peut les écrire sur un tableau", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 4, tags: ["Public"], objectives: ["public", "intervention public", "mot", "imprévu"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Journée du public", summary: "Une personne du public raconte sa journée et on l'a joue", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Public"], objectives: ["public", "intervention public", "narration"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Horoscope", summary: "On lit l'horoscope d'une personne du public puis on le joue", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Public"], objectives: ["public", "intervention public", "narration"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Voyage dans le temps", canCloseShow: true, summary: "Au sifflet de l'arbitre la scène change de période temporelle. Moyen âge, futur, révolution française, antiquité, préhistoire", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 4, tags: ["Répétition"], objectives: ["MC", "intervention MC", "zone", "époque", "histoire"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Cyclothymique", canCloseShow: true, summary: "On refait plusieurs fois une scène mais le MC donne une émotion générale pour tous les acteurs à chaque répétition. Joie débordante Colère explosive Tristesse profonde Panique Fierté Envie Frustration Honte Excitation Peur irrationnelle Sérénité Doute Amour excessif Dégoût Ennui total Euphorie Confusion Nostalgie Suspicion", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 2, tags: ["Répétition"], objectives: ["MC", "intervention MC", "emotion"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Best-of", canCloseShow: true, summary: "Un meddley de toutes les impros qui ont été jouées.", level: "Avancé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 2, tags: ["Répétition"], objectives: ["écoute", "mémoire", "imprévu"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Budget", summary: "On refait 3 fois l'impro avec des budgets différents (petit film indépendant, téléfilm, hollywood)", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 6, tags: ["Répétition"], objectives: ["imagination", "personnage", "adaptation"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Peau de chagrin", summary: "La même impro de plus en plus vite : 3 minutes puis 1 minutes puis 30 secondes puis 10 seconde.", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 3, tags: ["Répétition"], objectives: ["rythme", "physique"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Monstre à 3 têtes", summary: "3 improvisateurs se coagulent pour jouer un perso qui parlera uniquement avec la voix des 3 improvisateurs", level: "Confirmé", playersMin: 3, playersMax: 3, energy: "Forte", duration: 3, tags: ["Débile"], objectives: ["voix", "corps", "écoute", "personnage", "cohésion"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Chaises musicales", summary: "4 joueurs 3 chaises. 1 personnage par chaise. Le joueur doit jouer le personnage de la chaise. Quand la musique démarre on marche autour des chaises, quand ça s'arrête on s'assoit", level: "Débutant", playersMin: 4, playersMax: 4, energy: "Forte", duration: 4, tags: ["Débile"], objectives: ["personnage", "jeu", "physique", "chaise"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Jumeaux maléfiques", summary: "2 joueurs jouent, 2 autres peuvent dire MECHANT et prendre leur place pour faire qqchose de mal puis redonner sa place au joueur d'avant", level: "Confirmé", playersMin: 4, playersMax: 4, energy: "Forte", duration: 4, tags: ["Débile"], objectives: ["imprévu", "personnage", "mime"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Tournez manège", summary: "3 personnages tentent de séduire un 4eme personnage qui leur pose des questions à la manière de l'émission tournez manège. Personnage connus choisis du public.", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 5, tags: ["Débile"], objectives: ["MC", "intervention MC", "personnage", "rencontre"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Le balais", summary: "Un balais au milieu de la scène. Le joueur qui parle doit empoigner le balais puis le relâcher quand il a finit. Un autre doit l'attraper avant qu'il touche le sol et parler", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Forte", duration: 3, tags: ["Débile"], objectives: ["jeu", "physique", "écoute"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Vishnu / Clef de bras", summary: "2 joueurs font les mains de 2 autres dans leur dos", level: "Débutant", playersMin: 4, playersMax: 4, energy: "Forte", duration: 4, tags: ["Débile"], objectives: ["corps", "physique", "écoute", "binôme", "duo"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Bibliothèque", summary: "1 joueur reçoit un livre. Il ne peut dire des répliques uniquement tirées de ce livre.", level: "Avancé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 3, tags: ["Débile"], objectives: ["mot", "voix", "jeu"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "LOL qui rit sort", summary: "V1= Si un joueur rigole ou fait rigoler le public il sort. V2 = Si un joueur ou le public rigole la scène se termine.", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Forte", duration: 3, tags: ["Débile"], objectives: ["jeu", "imprévu"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Sans caucus", summary: "Pas de caucus sur cette impro", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Spéciales match"], objectives: ["imprévu", "écoute", "match"], thematiques: [], archetypes: [], showTypes: ["Match"], famillesObjectifs: [] },
  { name: "Caucus inversé", summary: "Les 2 équipes échangent leur caucus", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Spéciales match"], objectives: ["caucus", "imprévu", "écoute", "Match"], thematiques: [], archetypes: [], showTypes: ["Match"], famillesObjectifs: [] },
  { name: "Défi", summary: "Chaque équipe lance un défi spécial que l'autre doit remplir", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 4, tags: ["Spéciales match"], objectives: ["caucus", "jeu", "imprévu", "match"], thematiques: [], archetypes: [], showTypes: ["Match"], famillesObjectifs: [] },
  { name: "Poursuite", summary: "2 joueurs poursuivent l'impro que 2 joueurs ont commencé au sifflet du MC", level: "Confirmé", playersMin: 4, playersMax: 4, energy: "Modérée", duration: 4, tags: ["Spéciales match"], objectives: ["MC", "intervention MC", "binôme", "duo", "écoute", "match"], thematiques: [], archetypes: [], showTypes: ["Match"], famillesObjectifs: [] },
  { name: "Super-pouvoir secret", summary: "Chaque joueur a un super pouvoir que les autres ne connaissent pas. Le public ou les joueurs devinent à la fin.", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Devinettes"], objectives: ["personnage", "écoute", "jeu"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "À poil et à plumes / Animal totem", summary: "Chaque joueur s'inspire d'un animal qu'on lui a assigné. Le public ou les joueurs devinent à la fin. ATTENTION ce ne doit pas être des traits évidents et physiques. À la fin les spectateurs devinent. Peut être fait avec des situations imposées • blind date • question pour un champion • entretien d'embauche • plombier qui vient réparer", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Devinettes"], objectives: ["personnage", "corps", "physique"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Objectif inconnu", summary: "On doit faire : 1. faire quelque-chose à un joueur 2. aller à un endroit 3. dire quelque-chose sans qu'il ne le sache", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Devinettes"], objectives: ["personnage", "imprévu", "jeu"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Qui suis-je ?", summary: "1 joueur quitte la pièce. On choisit une personnalité connue pour ce joueur. Une scène est jouée avec ce joueur et les autres doivent lui faire comprendre qui il est.", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Devinettes"], objectives: ["personnage", "écoute", "jeu"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Dicton", summary: "1 joueur quitte la pièce. On choisit un dicton connu comme \"qui va à la chasse perd sa place\". Le joueur rentre et joue une scène avec les autres. Les autres joueurs doivent lui faire dire le dicton.", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Devinettes"], objectives: ["mot", "écoute", "jeu"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Raconte - mime - raconte", summary: "1 personne raconte une histoire puis une autre doit la mimer puis une autr la reraconte", level: "Débutant", playersMin: 2, playersMax: 8, energy: "Faible", duration: 4, tags: ["Devinettes"], objectives: ["narration", "écoute", "corps"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Jukebox", summary: "1. Les joueurs ne parlent qu'avec des paroles de chanson 2. Le joueur doit parler sur des mélodies d'un artiste donné", level: "Avancé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 3, tags: ["Musicales"], objectives: ["voix", "musique", "chant"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Ça mérite une chanson", canCloseShow: true, summary: "Le MC arrête l'impro et dit \"ça mérite une chanson\", les joueurs doivent improviser la chanson", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 3, tags: ["Musicales"], objectives: ["MC", "intervention MC", "voix", "musique", "chant"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Duel musical / Chanson solo", summary: "Chantée en solo sur un thème musical", level: "Avancé", playersMin: 1, playersMax: 1, energy: "Forte", duration: 2, tags: ["Musicales"], objectives: ["voix", "Musique", "chant"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Chantée", summary: "Impro où les joueurs doivent chanter. Ça marche mieux si fond musical imposé", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Forte", duration: 4, tags: ["Musicales"], objectives: ["voix", "musique", "chant"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Libre", canOpenShow: true, summary: "Scène libre, sans contrainte imposée ni thème particulier.", level: "", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: [], objectives: [], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: [] },
  { name: "Muette sur fond musical", summary: "Les joueurs jouent une scène entière sans parler, en s'appuyant uniquement sur un fond musical pour guider leurs émotions et leurs actions.", level: "Confirmé", playersMin: 2, playersMax: 8, energy: "Modérée", duration: 4, tags: ["Musicales"], objectives: ["mime", "musique", "corps", "émotion", "physique"], thematiques: [], archetypes: [], showTypes: ["Cabaret", "Match", "Concept original"], famillesObjectifs: ["Jouer avec la musique"] },
].map((c) => ({ id: uid(), rules: "", thematiques: [], duration: 6, archetypes: [], ...c }));

/* Fiches détaillées fournies par l'utilisateur — remplacent les catégories existantes du même
   nom (voir RENOMMAGES_CATEGORIES_DETAIL pour les variantes de nom), ou sont ajoutées si absentes.
   Cette fusion ne s'applique qu'une fois (voir data._categoriesDetailV1) pour ne pas écraser les
   modifications faites ensuite dans l'appli. */
const CATEGORIES_DETAILLEES = [
              ];

// Variantes de nom déjà présentes dans l'appli à faire correspondre aux fiches ci-dessus.
const RENOMMAGES_CATEGORIES_DETAIL = {
  "policière": "Policier",
  "post apocalyptique": "Post-Apocalyptique",
  "science fiction": "Science-fiction",
};

/* Exercices d'échauffement fournis par l'utilisateur. Tous marqués warmup:true (moment
   suggéré = Début). players:0 signifie "illimité". Format de jeu déduit du déroulé :
   "En cercle" si l'exercice se joue en cercle, "Tour à tour avec spectateur" si un·e
   joueur·se est mis·e en avant pendant que le reste regarde/réagit, sinon "Solo simultané". */
const EXERCICES_ECHAUFFEMENT = [
  { title: "Cercle de taichi", groupe: "Relaxation", summary: "Sur un fond musical de taichi le leader fait des gestes très lents d'échauffement et tous les autres le suivent. Au bout de quelques mouvements le leader passe le lead en projetant l'énergie avec ses bras vers un autre participant.", level: "Débutant", objectives: ["Relaxation", "Déconnexion", "Cohésion", "Cercle", "Musique"], players: 0, duration: 6, energy: "Faible", material: "Musique", format: "En cercle", warmup: false },
  { title: "Cercle yoga des yeux", groupe: "Relaxation", summary: "Tout le monde regarde le 1er leader qui va fixer à son tour une autre personne. Tout le monde tourne son regard vers cette nouvelle personne. Au bout de 10 sec cette personne fixe une autre personne et tout le monde tourne son regard vers elle. Etc.", level: "Débutant", objectives: ["Relaxation", "Déconnexion", "Cohésion", "Cercle"], players: 0, duration: 6, energy: "Faible", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Oui des yeux", groupe: "Relaxation", summary: "Les joueurs forment un cercle, espacés régulièrement. L'objectif est d'échanger sa place avec un autre participant, mais uniquement si ce dernier a donné son accord avec les yeux. A cherche le regard de B, B répond, A se met en marche vers B ; B doit vite croiser le regard de C et se diriger vers lui avant que A n'arrive. Etc.", level: "Confirmé", objectives: ["Relaxation", "Cohésion", "Écoute", "Cercle"], players: 0, duration: 7, energy: "Faible", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Miroir à deux", groupe: "Relaxation", summary: "Par binôme un leader fait des gestes très lents et l'autre essaye de mimer parfaitement les gestes de l'autre. Puis le suiveur prend le lead sans rien dire, de façon fluide.", level: "Débutant", objectives: ["Relaxation", "Écoute"], players: 0, duration: 5, energy: "Faible", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Cercle pression dans les mains", groupe: "Relaxation", summary: "On se tient tous la main et on fait passer une pression de main dans le même sens. On ne peut pas changer de sens. Le leader peut envoyer plusieurs pressions dans les 2 sens.", level: "Débutant", objectives: ["Relaxation", "Concentration", "Cercle"], players: 0, duration: 5, energy: "Faible", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Massage facial", groupe: "Relaxation", summary: "On crochète les index et on passe sur le front, puis un peu partout en étirant la peau.", level: "Débutant", objectives: ["Relaxation"], players: 0, duration: 3, energy: "Faible", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "La vie d'un arbre", groupe: "Relaxation", summary: "Sur un bruitage de forêt. On ressent ses racines et on étend ses branches. Bruit de vent léger on bouge lentement ses branches de plus en plus fort. Bruit de tempête on se secoue dans tous les sens. Retour au calme.", level: "Débutant", objectives: ["Relaxation", "Musique"], players: 0, duration: 4, energy: "Faible", material: "Musique", format: "Solo simultané", warmup: false },
  { title: "Trio d'échauffement", groupe: "Relaxation", summary: "Les joueurs sont répartis en trio. 1 receveur est placé au milieu, détendu, les yeux fermés. Les 2 autres tapotent le corps du receveur en commençant par le haut de la tête, de façon synchronisée, selon les retours du receveur (plus fort / moins fort). Puis de toutes petites touches du bout des doigts, en grandes inspirations.", level: "Débutant", objectives: ["Relaxation", "Écoute"], players: 0, duration: 5, energy: "Faible", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Respiration en chœur", groupe: "Relaxation", summary: "En cercle. Une personne propose un rythme de respiration puis tout le monde le reproduit ensemble.", level: "Débutant", objectives: ["Relaxation", "Écoute", "Cercle"], players: 0, duration: 5, energy: "Faible", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Blocs de glace", groupe: "Relaxation", summary: "Les joueurs, figés de la tête aux pieds comme dans un bloc de glace, se libèrent progressivement segment par segment au rythme d'une fonte lente du haut vers le bas.", level: "Débutant", objectives: ["Relaxation", "Déconnexion"], players: 0, duration: 4, energy: "Faible", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Rencontre des noms de famille", groupe: "Groupe, prénoms et confiance", summary: "En marche. Quand on rencontre quelqu'un on lance le dialogue : « Hey c'est toi ! » / « Oui c'est moi, [Nom] ! » / « Aaah cette bonne vieille/ce bon vieux [Nom] ! » etc., en se saluant par le nom de famille avant de se quitter.", level: "Débutant", objectives: ["Confiance", "Prénom", "Cohésion"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Killer / Bang / Cowboy", groupe: "Groupe, prénoms et confiance", summary: "En cercle le prof annonce le prénom d'un participant. Cette personne se baisse et les 2 autres à ses côtés se tirent dessus en disant BANG. Le plus lent est éliminé. Si une mort est jouée de façon convaincante on peut ressusciter.", level: "Débutant", objectives: ["Prénom", "Cohésion", "Cercle"], players: 0, duration: 8, energy: "Forte", material: "Aucun", format: "En cercle" },
  { title: "Cascade de prénoms", groupe: "Groupe, prénoms et confiance", summary: "En cercle. On dit son prénom chacun son tour, puis celui de son voisin de gauche, puis celui de son 2e voisin de gauche, etc.", level: "Débutant", objectives: ["Prénom", "Cohésion", "Cercle"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Prénom + geste", groupe: "Groupe, prénoms et confiance", summary: "En cercle on dit son prénom avec un geste. Tout le groupe reprend ensemble. Puis le 2e le fait aussi, le groupe reprend le 1er puis le 2e. Etc. Variante : un geste par syllabe.", level: "Débutant", objectives: ["Prénom", "Cohésion", "Cercle"], players: 0, duration: 4, energy: "Modérée", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Échange de prénoms", groupe: "Groupe, prénoms et confiance", summary: "Déambulation. Dès qu'on croise quelqu'un on échange son prénom avec cette personne, puis on transmet le prénom reçu au prochain croisement. Variante : avec prénom + geste, si fait en cercle avant.", level: "Débutant", objectives: ["Prénom", "Cohésion", "Cercle"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Cercle des prénoms", groupe: "Groupe, prénoms et confiance", summary: "En cercle, on annonce le prénom de quelqu'un sans le montrer du doigt, puis cette personne doit pointer du doigt quelqu'un d'autre sans dire son prénom. Etc.", level: "Débutant", objectives: ["Prénom", "Cohésion", "Cercle"], players: 0, duration: 4, energy: "Modérée", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Le chat des prénoms", groupe: "Groupe, prénoms et confiance", summary: "Le chat essaye d'attraper les souris. Quand il se rapproche de la souris, la souris donne le nom d'une autre souris. Le chat doit alors essayer d'attraper cette souris.", level: "Débutant", objectives: ["Prénom"], players: 0, duration: 5, energy: "Forte", material: "Aucun", format: "Solo simultané" },
  { title: "Le solitaire", groupe: "Groupe, prénoms et confiance", summary: "En binômes autour du cercle. 1 personne est seule et doit appeler le prénom de quelqu'un du cercle. Cette personne traverse le cercle pour la rejoindre mais son binôme essaye de l'en empêcher en la retenant.", level: "Débutant", objectives: ["Prénom", "Cercle"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Les piou-piou", groupe: "Groupe, prénoms et confiance", summary: "Les yeux fermés les joueurs sont dispersés dans la salle et disent \"piou piou\" comme des oisillons égarés. Ils avancent lentement en gardant les yeux fermés et se regroupent pour ne plus avoir peur. Variante : en binômes avec un son de reconnaissance propre à chaque binôme, dispersés au hasard puis à retrouver.", level: "Débutant", objectives: ["Cohésion", "Écoute"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "Solo simultané" },
  { title: "Poignées de main secrètes", groupe: "Groupe, prénoms et confiance", summary: "Les joueurs sont divisés en binômes. Chaque binôme invente une poignée de main excentrique. Puis tout le monde ferme les yeux, se déplace dans la salle et tente de faire cette poignée de main à qui il croise. Quand ils trouvent leur binôme ils ouvrent les yeux et se mettent sur le côté.", level: "Débutant", objectives: ["Cohésion", "Écoute", "Concentration"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Céci-portes", groupe: "Groupe, prénoms et confiance", summary: "Le groupe se divise en 2. La 1ère moitié crée des binômes et forme des portes, chacune créant 3 sons (ok pour passer, prévenir d'une collision, féliciter le passage). La 2e partie ferme les yeux et tente de passer 5 portes avant d'ouvrir les yeux.", level: "Débutant", objectives: ["Cohésion", "Écoute", "Concentration"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Guide d'aveugle", groupe: "Groupe, prénoms et confiance", summary: "Par binôme, un des deux ferme les yeux et l'autre le guide à travers la pièce en lui posant la main sur le dos, en confiance et à bonne allure. Variantes : doigt sous le menton avec échange d'aveugle au signal, dos à dos, ou guide uniquement à la voix sans contact.", level: "Débutant", objectives: ["Cohésion", "Écoute", "Concentration", "Confiance"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Qui fait ma statue ?", groupe: "Groupe, prénoms et confiance", summary: "Deux groupes égaux. Le groupe 1 forme une statue collective avec au moins un contact, puis ferme les yeux. Le groupe 2 reproduit la même image en miroir. Yeux fermés, le groupe 1 vient identifier au toucher qui le représente dans la 2e statue. Puis on inverse.", level: "Débutant", objectives: ["Cohésion", "Écoute", "Jeu"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Le dauphin", groupe: "Groupe, prénoms et confiance", summary: "Une personne sort de la pièce. Le groupe choisit une pose qu'elle devra retrouver en bougeant. Le groupe s'enthousiasme si elle s'approche, reste neutre ou triste si elle s'éloigne (comme le jeu chaud-froid).", level: "Débutant", objectives: ["Cohésion", "Écoute", "Jeu"], players: 0, duration: 4, energy: "Modérée", material: "Aucun", format: "Tour à tour avec spectateur", warmup: false },
  { title: "Tous ceux qui", groupe: "Groupe, prénoms et confiance", summary: "En cercle, 1 personne au milieu dit \"tous ceux qui...\" avec une action qu'elle n'a jamais faite. Ceux qui l'ont faite entrent dans le cercle, la personne qui a annoncé en sort, et une autre reste au centre pour annoncer une nouvelle action.", level: "Débutant", objectives: ["Cohésion", "Jeu", "Cercle"], players: 0, duration: 4, energy: "Modérée", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Je suis le seul à...", groupe: "Groupe, prénoms et confiance", summary: "En cercle ou en déambulation, 1 personne dit une phrase qu'elle pense être la seule à avoir vécue, en levant la main. Si d'autres lèvent aussi la main, elle ajoute des détails jusqu'à être effectivement la seule.", level: "", objectives: ["Cohésion", "Jeu", "Cercle"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Ligne d'affinité", groupe: "Groupe, prénoms et confiance", summary: "On fait une ligne. 1 personne se met face à la ligne et annonce des choses qu'elle adore, déteste, ou un avis. Ceux qui pensent comme elle avancent d'un pas, reculent sinon, restent au milieu si neutres. À 2 pas de recul on sort de la ligne, à 3 pas d'avance on gagne et on devient l'annonceur.", level: "", objectives: ["Cohésion", "Jeu"], players: 0, duration: 6, energy: "Faible", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "La corde imaginaire", groupe: "Groupe, prénoms et confiance", summary: "Tug-o-war (tir à la corde par équipe) imaginaire. On joue le fait de tirer ensemble, de forcer, de perdre ou gagner du terrain. Finalement une équipe gagne.", level: "", objectives: ["Cohésion", "Jeu", "Écoute"], players: 0, duration: 3, energy: "Forte", material: "Aucun", format: "Solo simultané" },
  { title: "Cercles fluides", groupe: "Groupe, prénoms et confiance", summary: "Les joueurs forment un cercle en se tenant la main et se penchent vers l'avant puis l'arrière, sans lever les talons, de façon alternée pour faire une vague. Variantes : sur la droite/gauche, ou resserrement puis éloignement fluide jusqu'à se toucher du bout des doigts.", level: "", objectives: ["Cohésion", "Écoute", "Relaxation", "Cercle"], players: 0, duration: 3, energy: "Faible", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Chaises, lignes, dragons", groupe: "Groupe, prénoms et confiance", summary: "Par binômes assis dos à dos, bras croisés dans le dos, les joueurs tentent de se lever ensemble, puis à 3, 4, jusqu'à tout le groupe. Variantes progressives : ligne assise sur les genoux du précédent, rythme \"gauche droite\" synchronisé formant un cercle, puis dragon en ligne où le premier attrape la \"queue\" du dernier.", level: "Confirmé", objectives: ["Cohésion", "Écoute", "Cercle"], players: 0, duration: 6, energy: "Faible", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Hypnotiseur", groupe: "Groupe, prénoms et confiance", summary: "Par binôme, un hypnotiseur tient sa main ouverte, l'autre reste à 20cm et la suit. L'hypnotiseur balade l'autre, peut refermer la main pour le réveiller puis recommencer. Variantes : échange des rôles à la fermeture de main, en groupe de 3 avec 2 mains, ou chaîne d'hypnose.", level: "Confirmé", objectives: ["Cohésion", "Écoute"], players: 0, duration: 6, energy: "Faible", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Effet de groupe", groupe: "Groupe, prénoms et confiance", summary: "On fait vivre des lieux grâce à des mouvements et réactions communes : vague, voiture, grand 8, cinéma, bateau.", level: "Confirmé", objectives: ["Cohésion", "Écoute", "Mime"], players: 0, duration: 8, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Montagne russe d'émotions", groupe: "Groupe, prénoms et confiance", summary: "En cercle ou déambulation, on donne au groupe des émotions (joie, tristesse, colère, peur, rire) qu'il doit faire monter en intensité ensemble, une émotion après l'autre.", level: "Confirmé", objectives: ["Émotions", "Cercle"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Suivez le suiveur", groupe: "Groupe, prénoms et confiance", summary: "En cercle, les joueurs relax analysent une personne désignée et reproduisent ses actions en miroir, sans forcer. Variante \"HOP HAAAA\" : séquence de saut et expiration reprise en même temps par tout le monde. Autre variante : chacun observe tout le monde et reproduit ce qui est proposé.", level: "Débutant", objectives: ["Cohésion", "Écoute", "Mime", "Cercle"], players: 0, duration: 6, energy: "Faible", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Banc de poisson", groupe: "Groupe, prénoms et confiance", summary: "Tous les joueurs en file indienne marchent ensemble. Le 1er donne une démarche particulière que tout le monde doit reproduire exactement en même temps.", level: "Débutant", objectives: ["Cohésion", "Écoute", "Mime"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Les gens collants", groupe: "Groupe, prénoms et confiance", summary: "Le groupe marche tranquillement dans l'espace. Au signal, un individu se détache et fait face au groupe qui se réunit rapidement en bloc compact. Cette personne exprime un sentiment corporel, le groupe lui répond sur le même registre, comme une seule personne.", level: "Débutant", objectives: ["Cohésion", "Écoute", "Émotions"], players: 0, duration: 7, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Gros câlin", groupe: "Groupe, prénoms et confiance", summary: "2 lignes de joueurs. A ne regarde pas B, prend de grandes inspirations puis regarde B quand détendu. Les deux montent l'émotion de soulagement jusqu'à se jeter dans les bras l'un de l'autre, puis se rasseoir.", level: "Débutant", objectives: ["Cohésion", "Écoute", "Émotions"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Solo grincheux", groupe: "Physique", summary: "Tout le monde danse de façon décomplexée. Le prof appelle une personne qui s'arrête et regarde les autres d'un air offusqué. Le groupe la motive à danser jusqu'à ce qu'elle se laisse aller.", level: "Confirmé", objectives: ["Physique", "Danse", "Cohésion", "Musique"], players: 0, duration: 4, energy: "Forte", material: "Musique", format: "Tour à tour avec spectateur" },
  { title: "Les plus mauvais danseurs", groupe: "Physique", summary: "Tout le monde danse le plus n'importe comment possible.", level: "Débutant", objectives: ["Physique", "Danse", "Cohésion", "Musique"], players: 0, duration: 3, energy: "Forte", material: "Musique", format: "Solo simultané" },
  { title: "Points moteurs", groupe: "Physique", summary: "Par binôme, A fixe un fil imaginaire sur un endroit du corps de B et le mène avec ce fil ; B suit. A peut couper le fil ou en fixer un nouveau ailleurs.", level: "Débutant", objectives: ["Physique", "Écoute"], players: 0, duration: 3, energy: "Faible", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Cercle des grimaces", groupe: "Physique", summary: "La 1ère personne invente une grimace avec un son, le groupe la reprend. La 2e en ajoute une autre + son, le groupe fait les deux. Etc.", level: "Débutant", objectives: ["Physique", "Écoute", "Mime", "Cercle"], players: 0, duration: 6, energy: "Faible", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Cercle des mouvements", groupe: "Physique", summary: "Chaque personne du cercle invente un mouvement avec un son, repris par le groupe au fil des tours qui reviennent, jusqu'à essayer d'accélérer sur la 2e session.", level: "Débutant", objectives: ["Physique", "Écoute", "Mime", "Cercle"], players: 0, duration: 7, energy: "Forte", material: "Aucun", format: "En cercle" },
  { title: "Le chat et la souris", groupe: "Physique", summary: "Au ralenti (avec mort dramatique en variante), ou en binômes liés bras dessus bras dessous : un chat doit attraper une souris qui peut se lier à un autre binôme, faisant changer qui est la souris. Variante : la chaîne de chats grandit ; ou tout le monde est chat et souris à la fois.", level: "Confirmé", objectives: ["Physique", "Mime", "Jeu", "Émotions"], players: 0, duration: 7, energy: "Forte", material: "Aucun", format: "Solo simultané" },
  { title: "Voler la chaise", groupe: "Physique", summary: "Des chaises sont réparties dans la pièce, une de moins que de participants. Une personne doit s'asseoir sur la chaise restante en l'atteignant très lentement, les autres l'en empêchant en s'y asseyant avant. On ne peut pas se rasseoir sur la chaise qu'on vient de quitter.", level: "Débutant", objectives: ["Physique", "Jeu", "Musique"], players: 0, duration: 6, energy: "Faible", material: "Chaises", format: "Solo simultané", warmup: false },
  { title: "Consignes sur chaises", groupe: "Physique", summary: "Chaque joueur a une chaise dans l'espace. Au signal \"1\" on s'assoit de façon rigide, au signal \"2\" de façon différente à chaque fois (la chaise peut bouger aussi). D'autres consignes peuvent être ajoutées.", level: "Débutant", objectives: ["Physique", "Jeu"], players: 0, duration: 6, energy: "Modérée", material: "Chaises", format: "Solo simultané", warmup: false },
  { title: "Course de chaise", groupe: "Physique", summary: "2 équipes d'au moins 3 personnes, 2 lignes de 4 chaises dont une vide. Les joueurs se passent la chaise vide pour que le premier de la ligne la place devant lui, et ainsi de suite jusqu'à la ligne d'arrivée.", level: "Débutant", objectives: ["Physique", "Jeu"], players: 6, duration: 6, energy: "Modérée", material: "Aucun", format: "Solo simultané" },
  { title: "Course de papier journal", groupe: "Physique", summary: "Chaque joueur a une feuille de papier journal. Pour avancer vers l'arrivée il doit déchirer une partie du papier et y placer son pied, sans jamais dépasser.", level: "Débutant", objectives: ["Physique", "Jeu"], players: 0, duration: 6, energy: "Modérée", material: "Journal", format: "Solo simultané" },
  { title: "Peinture corporelle", groupe: "Physique", summary: "Tout le monde s'allonge au sol et imagine que son corps est badigeonné de peinture, essayant de peindre le sol un maximum, puis des murs imaginaires.", level: "Débutant", objectives: ["Physique", "Relaxation", "Musique"], players: 0, duration: 5, energy: "Faible", material: "Musique", format: "Solo simultané", warmup: false },
  { title: "Douche imaginaire", groupe: "Physique", summary: "On se savonne partout comme si on était sous la douche (habillé).", level: "Débutant", objectives: ["Physique", "Relaxation"], players: 0, duration: 3, energy: "Faible", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Les 12 tibétains", groupe: "Physique", summary: "En cercle, les comédiens suivent le prof sur une série de mouvements enchaînés (salut polska, moulin de l'archer, poupée de chiffon, papillon manchot, skate disco, interrupteur clignotant, balance penchée, lever du soleil, la poupe et la proue, hélice de bateau, déhanché militaire, envol du cygne).", level: "Confirmé", objectives: ["Physique", "Relaxation", "Déconnexion", "Cercle", "Musique"], players: 0, duration: 8, energy: "Faible", material: "Musique", format: "En cercle", warmup: false },
  { title: "Clap clap", groupe: "Physique", summary: "Séquence de claps dans les mains. Quand on se trompe on lève les bras en disant \"j'ai raté !\". Variante : en cercle.", level: "Débutant", objectives: ["Rythme", "Écoute", "Physique", "Cercle"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Rythme cuisse direction à 2", groupe: "Physique", summary: "On suit un rythme en tapant sur ses cuisses et on indique une direction avec les bras. Même direction que l'autre = on tape dans ses mains (2 fois si la direction était le bas). Variante : en cercle.", level: "Confirmé", objectives: ["Rythme", "Écoute", "Physique", "Cercle"], players: 0, duration: 5, energy: "Forte", material: "Aucun", format: "Solo simultané" },
  { title: "1-2-3-4 tête-épaule-hanche-pieds", groupe: "Physique", summary: "En rythme on dit \"1-2-3-4\" puis on remplace progressivement chaque chiffre par le geste correspondant (toucher la tête, les épaules, les hanches, les pieds).", level: "Confirmé", objectives: ["Rythme", "Écoute", "Physique"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Parcours du combattant", groupe: "Physique", summary: "En ligne, la 1ère personne mime un obstacle de parcours du combattant puis se remet en bout de ligne. La 2e refait l'obstacle du 1er et en mime un 2e, etc. Une fois tout le monde passé, on refait un tour en encourageant comme une compétition.", level: "Confirmé", objectives: ["Physique", "Mémoire", "Écoute", "Mime"], players: 0, duration: 10, energy: "Modérée", material: "Aucun", format: "Tour à tour avec spectateur", warmup: false },
  { title: "Ouverture de porte", groupe: "Physique", summary: "Même principe que le parcours du combattant : la 1ère personne mime l'ouverture d'une porte puis se remet en bout de ligne, la 2e refait la 1ère porte puis en ouvre une 2e, etc.", level: "Confirmé", objectives: ["Physique", "Mémoire", "Écoute", "Mime"], players: 0, duration: 10, energy: "Modérée", material: "Aucun", format: "Tour à tour avec spectateur", warmup: false },
  { title: "Le grand samouraï", groupe: "Physique", summary: "Le groupe se met en ligne devant le prof, qui tient un immense sabre imaginaire et tente de trancher dans le groupe. Les participants évitent en sautant, se baissant, s'écartant... jusqu'à élimination.", level: "Confirmé", objectives: ["Physique", "Écoute", "Concentration", "Jeu"], players: 0, duration: 6, energy: "Forte", material: "Aucun", format: "Solo simultané" },
  { title: "Volley-mot", groupe: "Physique", summary: "La salle est divisée en terrain de volley imaginaire, 2 équipes s'affrontent. En tapant la balle on dit un mot en visant une personne, qui doit renvoyer une association d'idée. Silence, cafouillage ou mot déjà dit = élimination. Variante : on raconte une histoire mot après mot.", level: "Débutant", objectives: ["Physique", "Écoute", "Concentration", "Jeu", "Imagination"], players: 0, duration: 8, energy: "Forte", material: "Aucun", format: "Solo simultané" },
  { title: "Expert en monstre", groupe: "Physique", summary: "Deux joueurs : l'expert imite des monstres avec des démarches folles et sons bizarres, l'autre l'imite parfaitement. Le but de l'expert est de multiplier les monstres, puis on échange les rôles.", level: "Confirmé", objectives: ["Physique", "Écoute", "Concentration", "Imagination", "Mime"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Le nœud humain", groupe: "Physique", summary: "Tous les participants se tiennent la main et doivent s'enrouler ensemble pour former le nœud le plus compliqué possible, sans jamais lâcher les mains, puis le défaire.", level: "Débutant", objectives: ["Physique", "Cohésion"], players: 0, duration: 5, energy: "Faible", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Plateau en équilibre", groupe: "Physique", summary: "Des personnes rentrent au fur et à mesure sur le plateau imaginaire, qui doit toujours rester en équilibre (comme s'il reposait sur une grosse boule).", level: "Débutant", objectives: ["Physique", "Cohésion", "Mime"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Ça marche", groupe: "Physique", summary: "Les joueurs sont en cercle et marchent sur place, adaptant leur démarche à des scénarios donnés (être suivi, marcher vers l'être aimé, être poursuivi par une créature, viser une friandise hors de portée, sprint final d'un marathon filmé, etc.).", level: "Confirmé", objectives: ["Physique", "Mime", "Cercle"], players: 0, duration: 7, energy: "Modérée", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Gonflé comme un ballon", groupe: "Physique", summary: "En cercle, tout le monde se dégonfle puis se regonfle avec de longues inspirations. Variante par binômes : un joueur poupée gonflable se gonfle à fond, l'autre le dégonfle en tirant un bouchon imaginaire puis le regonfle lentement à la pompe.", level: "Débutant", objectives: ["Physique", "Relaxation", "Cercle"], players: 0, duration: 5, energy: "Faible", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Body mask", groupe: "Physique", summary: "Chaque personne crée une sculpture portant son nom. Le groupe mémorise toutes les sculptures puis marche dans l'espace ; quand le prof annonce un nom, tout le monde reprend la sculpture correspondante, sans aide du créateur.", level: "Débutant", objectives: ["Physique", "Mémoire", "Écoute", "Mime", "Prénom"], players: 0, duration: 7, energy: "Faible", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Radeau et passager", groupe: "Physique", summary: "2 joueurs dos à dos : l'un est le radeau et porte l'autre sur son dos. Les autres joueurs sont des vagues qui aident le passager à monter et soutiennent son corps. Le radeau avance ensuite comme s'il roulait sur les vagues.", level: "Débutant", objectives: ["Physique", "Cohésion"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Même mouvements", groupe: "Physique", summary: "Par binôme, les joueurs se déplacent en essayant de se synchroniser (pose figée, neutre, marche à différentes cadences, course, arrêt, ralenti...). Variante : un leader désigné, le groupe entier se déplace comme lui.", level: "Confirmé", objectives: ["Physique", "Cohésion", "Écoute"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Rire & corps", groupe: "Physique", summary: "Par 2, une personne fait un rire tandis que l'autre en fait le corps, en variant les types de rires et en incluant respirations et soupirs.", level: "Confirmé", objectives: ["Physique", "Cohésion", "Écoute", "Mime"], players: 0, duration: 4, energy: "Modérée", material: "Aucun", format: "Solo simultané" },
  { title: "Statues et mouches", groupe: "Physique", summary: "Un groupe forme des statues figées dans l'espace, l'autre est des mouches qui vrombissent et se déplacent près d'elles. Au signal, chaque mouche se pose sur la statue la plus proche en la touchant du nez, puis reprend son vol à un autre niveau.", level: "Confirmé", objectives: ["Physique", "Imagination", "Mime", "Musique"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "Solo simultané" },
  { title: "Requin", groupe: "Physique", summary: "Sur des cubes ou surfaces d'équilibre dispersés, tout le monde mime nager après un naufrage. Au cri de \"REQUIN\", tous se réfugient sur une surface. Au fil du jeu, on enlève des surfaces et le groupe se resserre sur les îlots restants.", level: "Débutant", objectives: ["Physique", "Jeu", "Concentration", "Contact"], players: 0, duration: 5, energy: "Modérée", material: "Cube ou tabouret", format: "Solo simultané" },
  { title: "Assassin et détective", groupe: "Physique", summary: "En rond, les yeux fermés, le prof désigne discrètement un tueur et un détective. Les participants se dispersent et se regardent dans les yeux ; le tueur élimine par clin d'œil (mort théâtrale), le détective doit le démasquer. On peut ensuite ajouter des personnages à incarner (bébés, animaux...).", level: "Débutant", objectives: ["Physique", "Jeu", "Mime", "Émotions"], players: 0, duration: 10, energy: "Modérée", material: "Aucun", format: "En cercle" },
  { title: "Attention une haie !", groupe: "Physique", summary: "En cercle, tout le monde court sur place. Selon l'annonce de l'animateur, le groupe réagit ensemble : \"une haie\" (sauter en disant \"Haie\"), \"un arbre\" (se baisser en disant \"Ouh\"), \"un écureuil\" (le caresser en disant \"Qu'il est mignon\"), \"une tomate\" (la recevoir en disant \"Sploutch\").", level: "Débutant", objectives: ["Physique", "Mime", "Voix", "Concentration", "Cercle"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Vire-langues", groupe: "Vocal", summary: "Faire répéter au groupe des phrases difficiles à prononcer (virelangues), un par un ou tous ensemble, pour travailler l'articulation.", level: "Confirmé", objectives: ["Voix"], players: 0, duration: 4, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Sons de bouches", groupe: "Vocal", summary: "En cercle, les comédiens font le train, la mouche, le criquet, Ohm... avec le volume sonore géré par la main du prof.", level: "Débutant", objectives: ["Voix"], players: 0, duration: 4, energy: "Faible", material: "Aucun", format: "En cercle", warmup: false },
  { title: "A E I O U", groupe: "Vocal", summary: "On enchaîne A E I O U en ajoutant une consonne, dans l'ordre alphabétique.", level: "Débutant", objectives: ["Voix"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Voyelles + poses", groupe: "Vocal", summary: "Les joueurs se répartissent dans la pièce. Chacun choisit une voyelle et la fait résonner, puis change de position en se contorsionnant et fait résonner une autre voyelle à chaque nouvelle pose.", level: "Confirmé", objectives: ["Voix", "Corps"], players: 0, duration: 5, energy: "Faible", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Voyelles binômes", groupe: "Vocal", summary: "Par binôme face à face, A choisit une voyelle et la fait résonner selon la distance avec B (proche = bas, loin = fort). B joue ensuite avec la distance (avancer/reculer) et A adapte le volume en conséquence.", level: "Confirmé", objectives: ["Voix", "Corps"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "L'étranger", groupe: "Vocal", summary: "Un joueur est séparé du groupe à l'autre bout de la pièce. Le groupe répète des \"oh\" étonnés qui s'accélèrent et se transforment en \"HEY\" de plus en plus forts à mesure qu'il se rapproche.", level: "Confirmé", objectives: ["Voix", "Émotions"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "Tour à tour avec spectateur", warmup: false },
  { title: "Compter crescendo", groupe: "Vocal", summary: "On compte ensemble jusqu'à 10 de plus en plus fort, puis on redescend de moins en moins fort.", level: "Débutant", objectives: ["Voix"], players: 0, duration: 4, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Ma me mu mo mu, Sa se si so su", groupe: "Vocal", summary: "En cercle, chacun dit à son tour MA ME MI MO MU en voix forte puis sa se si so su en voix basse, en suivant sans relever les erreurs des autres.", level: "Avancé", objectives: ["Voix"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Loop Humaine", groupe: "Vocal", summary: "En cercle, un premier comédien lance un son en boucle, puis un deuxième, etc., jusqu'à créer une musique uniquement vocale et collective.", level: "Confirmé", objectives: ["Voix", "Rythme", "Musique"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Phrasé inventé", groupe: "Vocal", summary: "Une même phrase est répétée avec un phrasé inspiré de propositions (éléments naturels, machines, instruments, animaux, ambiances) données par le coach ou le public.", level: "Confirmé", objectives: ["Voix", "Personnages"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "Solo simultané", warmup: false },
  { title: "Les vampires sont parmi nous !", groupe: "Déconnexion", summary: "Les yeux fermés, les joueurs marchent dans l'espace. L'animateur touche l'un d'entre eux qui devient vampire et doit \"vampiriser\" les autres ; le jeu s'arrête quand tout le monde est vampire.", level: "Débutant", objectives: ["Déconnexion", "Jeu", "Personnages"], players: 0, duration: 8, energy: "Forte", material: "Aucun", format: "Solo simultané" },
  { title: "Œuf - Poule - Dino", groupe: "Déconnexion", summary: "Tout le monde commence Œuf. Par duels de shi-fu-mi, le gagnant évolue en Poule puis Dino puis Super Dino, le perdant devenant son supporter, jusqu'à ce qu'il ne reste qu'un seul Super Dino.", level: "Confirmé", objectives: ["Déconnexion", "Jeu", "Personnages", "Prénom"], players: 0, duration: 6, energy: "Forte", material: "Aucun", format: "Solo simultané" },
  { title: "Chaise avec mouvements cumulés", groupe: "Déconnexion", summary: "Une chaise est au milieu de la salle. Chaque joueur s'y assoit à son tour, refait les gestes/bruits des précédents et en ajoute un nouveau, avec élimination.", level: "Confirmé", objectives: ["Déconnexion", "Jeu", "Écoute", "Physique"], players: 0, duration: 6, energy: "Forte", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "1-2-3 j'ai raté", groupe: "Déconnexion", summary: "Par binôme, on compte chacun son tour 1, 2, 3 le plus vite possible en essayant de se mettre en danger. Le perdant lève les bras en disant \"j'ai raté\" puis change de binôme.", level: "Confirmé", objectives: ["Déconnexion", "Jeu"], players: 0, duration: 6, energy: "Forte", material: "Aucun", format: "Solo simultané" },
  { title: "Ping-pong King-kong Ding-dong", groupe: "Déconnexion", summary: "Par binôme, quand l'un dit \"ping\" l'autre répond \"pong\", pareil pour King-kong et Ding-dong. En cas d'erreur on lève les bras, on dit \"j'ai raté\" et on change de binôme.", level: "Débutant", objectives: ["Déconnexion", "Jeu"], players: 0, duration: 6, energy: "Forte", material: "Aucun", format: "Solo simultané" },
  { title: "1-2-3 Nenoeil", groupe: "Cercle", summary: "En cercle, tout le monde regarde par terre puis dit ensemble \"1-2-3 Nenoeil\" en fixant une personne. Si deux joueurs se fixent réciproquement, ils se rejoignent au centre, se tapent dans la main et sortent du cercle.", level: "Débutant", objectives: ["Cercle", "Cohésion", "Jeu"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Change de place des yeux", groupe: "Cercle", summary: "Un joueur A cherche le regard d'un autre B pour se déplacer vers lui et prendre sa place. B doit alors vite croiser le regard d'un autre joueur avant que A n'arrive, et ainsi de suite.", level: "Débutant", objectives: ["Cercle", "Cohésion"], players: 0, duration: 5, energy: "Faible", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Poisson - Ours - Gorille", groupe: "Cercle", summary: "Chacun choisit en secret un animal (poisson, ours ou gorille). Au signal, tout le monde le mime ; on élimine les animaux en minorité jusqu'à ce que tout le monde converge vers le même.", level: "Confirmé", objectives: ["Cercle", "Jeu", "Mime"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "En cercle" },
  { title: "Sous-marin", groupe: "Cercle", summary: "Le prof indique un chiffre et un objet. Le nombre de participants indiqué va au centre du cercle prendre des poses pour reproduire l'objet.", level: "Débutant", objectives: ["Cercle", "Jeu", "Mime", "Cohésion"], players: 0, duration: 6, energy: "Forte", material: "Aucun", format: "En cercle" },
  { title: "Chouba / Ya", groupe: "Cercle", summary: "Jeu d'énergie avec 3 mouvements de base (Chouba/Ya, Bloc, Wiz), auquel on peut ajouter librement d'autres mouvements (expressions, ascenseur, boule de bowling, rio, anniversaire...).", level: "Débutant", objectives: ["Cercle", "Jeu", "Mime", "Cohésion", "Concentration", "Écoute", "Énergie"], players: 0, duration: 7, energy: "Forte", material: "Aucun", format: "En cercle" },
  { title: "Lancer de couteaux", groupe: "Cercle", summary: "On mime l'envoi d'un objet énergique (un couteau, un bébé, un chat...) que l'autre doit réceptionner avec attention avant de le relancer.", level: "Débutant", objectives: ["Cercle", "Mime", "Cohésion", "Concentration", "Écoute", "Énergie"], players: 0, duration: 6, energy: "Forte", material: "Aucun", format: "En cercle" },
  { title: "Shi-Fu-Ha", groupe: "Cercle", summary: "Un joueur envoie l'énergie en disant SHI, le receveur la reçoit en levant les bras et disant FU, ses deux voisins le tranchent en disant HA, puis la personne tranchée relance l'énergie en disant SHI.", level: "Confirmé", objectives: ["Cercle", "Jeu", "Mime", "Concentration", "Écoute", "Énergie", "Voix"], players: 0, duration: 6, energy: "Forte", material: "Aucun", format: "En cercle" },
  { title: "Jeu qui rend fou", groupe: "Cercle", summary: "On fait tourner l'énergie en comptant ensemble de 1 à 7 avec un geste particulier au 7, puis on change le mouvement d'un des chiffres. En cas d'erreur : course autour du cercle, élimination ou gage.", level: "Débutant", objectives: ["Cercle", "Jeu", "Concentration", "Énergie", "Physique"], players: 0, duration: 6, energy: "Forte", material: "Aucun", format: "En cercle" },
  { title: "Cercle de claps", groupe: "Cercle", summary: "On fait tourner l'énergie en clapant dans les mains, selon des rythmes différents donnés par le prof.", level: "Débutant", objectives: ["Cercle", "Concentration", "Énergie"], players: 0, duration: 3, energy: "Forte", material: "Aucun", format: "En cercle" },
  { title: "Pointeur", groupe: "Cercle", summary: "Tout le monde a la main levée. On pointe successivement une personne en disant un mot d'une catégorie secrète, jusqu'à ce que tout le monde ait baissé le bras ; on relance ensuite plusieurs cycles en même temps.", level: "Débutant", objectives: ["Cercle", "Concentration", "Imagination"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Boules de couleur", groupe: "Cercle", summary: "On se lance des boules de couleur imaginaires.", level: "Confirmé", objectives: ["Cercle", "Concentration", "Écoute"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "En cercle" },
  { title: "Graal sacré", groupe: "Cercle", summary: "Une personne apporte le Graal sacré à une autre avec une réplique rituelle reprise par le groupe. On peut ensuite amener le Graal avec des intentions différentes que le receveur et ses voisins doivent amplifier.", level: "Confirmé", objectives: ["Cercle", "Émotions", "Voix", "Personnages"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Oh yeah !", groupe: "Cercle", summary: "Une personne dit \"oh yeah !\" avec une intention à une autre qui doit la reproduire, avant que le reste du cercle n'amplifie ensemble la même intention.", level: "Confirmé", objectives: ["Cercle", "Émotions", "Voix", "Cohésion"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "En cercle" },
  { title: "Balle imaginaire claquement", groupe: "Cercle", summary: "On s'envoie une balle imaginaire en claquant des doigts à l'envoi et à la réception, parfois en l'air pour que quelqu'un d'autre la récupère.", level: "Confirmé", objectives: ["Cercle", "Concentration", "Cohésion", "Écoute"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "En cercle" },
  { title: "Ça fait 8 choses", groupe: "Cercle", summary: "Une catégorie est donnée ; le joueur suivant doit citer 8 éléments de cette catégorie, comptés en chœur par le groupe, avant de proposer une nouvelle catégorie.", level: "Confirmé", objectives: ["Cercle", "Imagination", "Voix"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "En cercle" },
  { title: "Je suis Superman parce que...", groupe: "Cercle", summary: "Un joueur s'élance au centre du cercle et complète la phrase \"Je suis Superman parce que...\" avec la toute première idée qui lui vient, sans filtre, trois fois de suite.", level: "Confirmé", objectives: ["Cercle", "Imagination", "Lâcher-prise"], players: 0, duration: 7, energy: "Modérée", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Association d'idées", groupe: "Cercle", summary: "On associe des idées en chaîne les unes après les autres, puis on retrouve la séquence complète, ou on alterne avec un temps limité une fois sur deux.", level: "Débutant", objectives: ["Cercle", "Imagination", "Lâcher-prise"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "En cercle", warmup: false },
  { title: "Help association d'idée", groupe: "Cercle", summary: "Une personne va au centre du cercle faire des associations d'idées ; dès qu'elle bloque un peu, une autre lui tape sur l'épaule et prend le relais.", level: "Confirmé", objectives: ["Cercle", "Imagination", "Lâcher-prise", "Confiance", "Cohésion", "Écoute"], players: 0, duration: 7, energy: "Modérée", material: "Aucun", format: "Tour à tour avec spectateur", warmup: false },
  { title: "Les noms de l'entreprise", groupe: "Cercle", summary: "Une personne présente tous les participants comme les membres de son équipe (entreprise ou autre), en leur inventant des prénoms, noms ou surnoms.", level: "Confirmé", objectives: ["Cercle", "Imagination", "Personnages"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "Tour à tour avec spectateur", warmup: false },
  { title: "Animaux de passage", groupe: "Cercle", summary: "Une série de démarches d'animaux (canard, oie, moineau, abeilles) tourne dans le cercle, de plus en plus vite, en nommant ou en inventant de nouveaux animaux.", level: "Confirmé", objectives: ["Cercle", "Physique", "Mime", "Personnages", "Concentration"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "En cercle" },
  { title: "Commandements", groupe: "Cercle", summary: "Le groupe réagit à des ordres (Go = marcher en rond, Stop, Clap, Tour = 180°), avec des variantes absurdes ou des démarches d'animaux.", level: "Débutant", objectives: ["Physique", "Concentration"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "Solo simultané" },
  { title: "On s'imite", groupe: "Cercle", summary: "Chaque personne choisit une autre personne du cercle (sans doublon) et doit imiter son comportement physique au plus proche.", level: "Débutant", objectives: ["Cercle", "Physique", "Concentration", "Observation", "Cohésion"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "En cercle" },
  { title: "Gestes en chœur", groupe: "Cercle", summary: "Le premier joueur du cercle fait un geste simple, repris progressivement par tout le monde à mesure que chaque joueur y ajoute le sien.", level: "Débutant", objectives: ["Cercle", "Physique", "Concentration", "Observation", "Cohésion"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "En cercle" },
  { title: "Passage d'émotions", groupe: "Cercle", summary: "En cercle, les joueurs se passent une émotion en se connectant les uns aux autres, voire en l'amplifiant au fil du passage.", level: "Débutant", objectives: ["Cercle", "Émotions", "Concentration", "Observation", "Cohésion"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "En cercle" },
  { title: "Rangement rapide", groupe: "Marche", summary: "Le groupe se range selon un critère donné (ordre alphabétique des prénoms, taille, mois de naissance, couleur des yeux, forme...), avec des critères de plus en plus absurdes.", level: "Débutant", objectives: ["Déambulation", "Concentration", "Jeu", "Cohésion"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "Déambulation", warmup: false },
  { title: "2 camp", groupe: "Marche", summary: "Les participants se répartissent en 2 camps dans des zones opposées de la salle selon leur préférence annoncée par le prof (petits pois/tomates, sport/musique, Espagne/Allemagne...).", level: "Débutant", objectives: ["Déambulation", "Concentration", "Jeu", "Cohésion", "Musique"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "Déambulation" },
  { title: "Sur consignes", groupe: "Marche", summary: "En déambulation, le groupe réagit à des consignes variées : chiffres, vitesses, terrains imaginaires (boue, neige, verglas...), émotions, ennemi/protecteur, triangle secret, idolâtrer...", level: "Débutant", objectives: ["Déambulation", "Concentration", "Cohésion", "Imagination", "Émotions", "Personnages", "Lieux", "Mime"], players: 0, duration: 10, energy: "Modérée", material: "Aucun", format: "Déambulation", warmup: false },
  { title: "Grille environnement", groupe: "Marche", summary: "La salle est divisée en environnements imaginaires (sable brûlant, verglas, marécage, slackline, gravier...) que les joueurs traversent en changeant de direction à 90°, parfois en mimant une action simple.", level: "Confirmé", objectives: ["Déambulation", "Concentration", "Lieux", "Mime", "Imagination"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "Déambulation", warmup: false },
  { title: "Compter jusqu'à 10", groupe: "Marche", summary: "Un chiffre par personne ; on recommence depuis le début si deux personnes parlent en même temps (variantes : alphabet, mode compétition entre 2 équipes).", level: "Confirmé", objectives: ["Déambulation", "Cohésion"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "Déambulation", warmup: false },
  { title: "Épeler des mots", groupe: "Marche", summary: "Une lettre par personne ; on recommence depuis le début si deux personnes parlent en même temps.", level: "Débutant", objectives: ["Déambulation", "Concentration", "Cohésion"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "Déambulation", warmup: false },
  { title: "Les bougies", groupe: "Marche", summary: "Chaque participant a un chiffre. Quand il est appelé, il fond lentement comme une bougie ; les autres viennent l'aider à se relever.", level: "Débutant", objectives: ["Déambulation", "Mime", "Cohésion"], players: 0, duration: 5, energy: "Faible", material: "Aucun", format: "Déambulation", warmup: false },
  { title: "Oui on y va !", groupe: "Marche", summary: "Un participant annonce une action (\"on fait du vélo !\"), tout le monde répond \"oui on y va !\" et mime l'action.", level: "Débutant", objectives: ["Déambulation", "Mime", "Imagination", "Cohésion"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "Déambulation", warmup: false },
  { title: "Se passer des objets mimés", groupe: "Marche", summary: "Le prof donne des objets à mimer à certains participants, qui doivent les faire passer sans dire ce que c'est, juste en mimant.", level: "Débutant", objectives: ["Déambulation", "Mime", "Imagination", "Écoute", "Acceptation"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "Déambulation" },
  { title: "Les répliques", groupe: "Marche", summary: "Au clap, un joueur dit une réplique ; à 2 claps, 2 répliques se répondent, etc. On recommence si deux personnes parlent en même temps.", level: "Confirmé", objectives: ["Déambulation", "Mime", "Imagination", "Écoute", "Acceptation"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "Déambulation", warmup: false },
  { title: "Démarches de personnages", groupe: "Marche", summary: "Le prof donne des personnages archétypaux que les participants incarnent progressivement, en ajoutant un point moteur, une respiration, un rire puis un objet.", level: "Confirmé", objectives: ["Déambulation", "Imagination", "Personnages", "Mime"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "Déambulation", warmup: false },
  { title: "Démarches d'univers", groupe: "Marche", summary: "Au fil de musiques inspirées d'univers différents, les comédiens adoptent l'attitude adaptée à l'univers sonore proposé, en changeant d'univers toutes les 40 secondes.", level: "Confirmé", objectives: ["Déambulation", "Imagination", "Personnages", "Mime", "Univers", "Musique"], players: 0, duration: 6, energy: "Modérée", material: "Musique", format: "Déambulation", warmup: false },
  { title: "Bouge / bouge pas", groupe: "Marche", summary: "Le groupe est séparé en sous-groupes ; il doit toujours y avoir une seule personne en mouvement, les autres immobiles, en essayant de piéger les autres.", level: "Confirmé", objectives: ["Déambulation", "Jeu", "Écoute", "Cohésion", "Musique"], players: 0, duration: 6, energy: "Modérée", material: "Musique", format: "Déambulation", warmup: false },
].map((e) => ({ id: uid(), warmup: true, application: false, showTypes: [], groupSize: 2, phase: "Échauffement", ...e }));

/* Exercices pré-impro fournis par l'utilisateur. */
const EXERCICES_PRE_IMPRO = [
  { title: "M. Loyal et son freakshow", summary: "En cercle, une personne présente un monstre de foire imaginaire ; la personne à sa gauche doit alors jouer ce personnage au centre du cercle pendant que le groupe réagit (applaudit, est surpris, dégoûté...).", level: "Confirmé", objectives: ["Imagination", "Lâcher-prise", "Personnages", "Mime", "Émotions", "Cercle", "Physique"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "En cercle" },
  { title: "Cercle de présentation folle", summary: "Un joueur va au centre du cercle, regarde gravement les autres puis fait un son débile avant de saluer ; tout le monde imite gravement puis fait le même son, très fier. Variantes : ajouter un grand geste, une marche loufoque, ou une pose en réaction.", level: "Confirmé", objectives: ["Imagination", "Lâcher-prise", "Personnages", "Mime", "Émotions", "Physique", "Cercle", "Cohésion"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "En cercle" },
  { title: "Amplification par demi-cercle", summary: "En demi-cercle, le joueur le plus à gauche lance une réaction d'émotion peu intense ; chaque joueur suivant la refait en l'amplifiant jusqu'au dernier, au maximum d'intensité, puis on décale tout le monde d'un cran.", level: "Confirmé", objectives: ["Imagination", "Mime", "Émotions", "Observation"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Amplification de personnage", summary: "Par 2, le joueur A joue un rôle donné par l'animateur sur quelques phrases, puis B le copie en l'amplifiant (gestes, attitude, posture), puis A amplifie encore, et ainsi de suite.", level: "Confirmé", objectives: ["Mime", "Personnages", "Écoute", "Observation"], players: 0, duration: 5, energy: "Forte", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Bataille de caucus", summary: "2 ou 3 équipes reçoivent un thème et cherchent un maximum d'idées (caucus). Le prof passe voir chaque équipe à tour de rôle, qui doit présenter ses idées une par une ; l'équipe qui n'en a plus a perdu.", level: "Débutant", objectives: ["Imagination", "Jeu"], players: 0, duration: 8, energy: "Modérée", material: "Aucun", format: "En groupe simultané" },
  { title: "Le goaler", summary: "En ligne, un participant fait face au groupe (le goal). Les autres lui apportent chacun leur tour une proposition de début de scène, que le goal doit accepter en une phrase. On change de goal après plusieurs passages.", level: "Débutant", objectives: ["Imagination", "Écoute", "Acceptation"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Impro clap", summary: "En cercle, 2 joueurs démarrent une impro en variant leurs poses et mouvements. Dès qu'un joueur du cercle est inspiré, il clap : les deux au centre s'arrêtent et il remplace l'un d'eux pour repartir sur une nouvelle histoire (ou en reprenant le mot/la phrase sur lequel il a clappé).", level: "Débutant", objectives: ["Imagination", "Écoute", "Observation", "Cercle", "Physique", "Mime"], players: 0, duration: 10, energy: "Forte", material: "Aucun", format: "En cercle" },
  { title: "Qu'est-ce que tu fais ?", summary: "En cercle, un joueur mime une action au centre. Un autre le rejoint et demande \"qu'est-ce que tu fais ?\" ; il répond une action différente que le second se met alors à mimer, avant qu'un troisième vienne lui poser la même question, et ainsi de suite.", level: "Débutant", objectives: ["Imagination", "Écoute", "Observation", "Cercle", "Physique", "Personnages"], players: 0, duration: 6, energy: "Forte", material: "Aucun", format: "En cercle" },
  { title: "Je suis un arbre", summary: "En cercle, un joueur dit \"je suis un arbre\" et prend la pose au centre ; un deuxième ajoute un élément en lien (\"je suis une pomme\"), un troisième encore un autre. Le premier arrivé choisit ensuite lequel des deux autres éléments il garde, et le cycle recommence avec cet objet seul.", level: "Débutant", objectives: ["Imagination", "Écoute", "Observation", "Cercle", "Physique", "Acceptation", "Personnages"], players: 0, duration: 7, energy: "Forte", material: "Aucun", format: "En cercle" },
  { title: "Qui-qui-où", summary: "En cercle, un joueur annonce le nom et l'occupation de son personnage. Un second arrive et annonce sa relation au premier. Le premier précise alors un lieu où se trouvent les deux personnages, et le second lance la première réplique.", level: "Confirmé", objectives: ["Imagination", "Écoute", "Cercle", "Acceptation", "Personnages", "Lieux"], players: 0, duration: 7, energy: "Modérée", material: "Aucun", format: "En cercle" },
  { title: "Je t'aime / je t'aime aussi mais...", summary: "En cercle, une personne s'avance vers une autre et dit \"je t'aime parce que...\" avec un élément très précis ; l'autre répond \"je t'aime aussi mais...\" avec un autre élément précis.", level: "Confirmé", objectives: ["Imagination", "Écoute", "Cercle", "Acceptation", "Émotions"], players: 0, duration: 7, energy: "Modérée", material: "Aucun", format: "En cercle" },
  { title: "Écoute extrême", summary: "En groupes de 4, un joueur assis écoute un autre parler pendant qu'un troisième lui fait des massages et qu'un quatrième lui pose des calculs simples. Après 30 secondes, il doit répéter ce qu'a dit celui qui lui parlait en face.", level: "Avancé", objectives: ["Concentration", "Écoute", "Imagination"], players: 0, duration: 3, energy: "Forte", material: "Aucun", format: "En groupe simultané" },
  { title: "Le Président", summary: "Un joueur (le Président) est assis en pleine conversation téléphonique. À tour de rôle, 4-5 joueurs viennent l'interrompre pour lui donner une nouvelle et demander ses instructions. Après les 5 passages, il rappelle un conseiller et donne ses instructions pour chacune des informations reçues.", level: "Avancé", objectives: ["Imagination", "Personnages", "Enjeux", "Acceptation"], players: 5, duration: 4, energy: "Modérée", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Définitions 3 syllabes", summary: "Un joueur dit une syllabe, celui à sa droite en ajoute une autre, un troisième une dernière pour former un mot inventé de 3 syllabes ; le quatrième joueur doit en donner la définition.", level: "Débutant", objectives: ["Imagination", "Cercle"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "En cercle" },
  { title: "Logo de t-shirt", summary: "Un joueur décrit à un autre le logo imaginaire présent sur son t-shirt ; l'autre doit alors inventer le slogan écrit en dessous.", level: "Débutant", objectives: ["Imagination", "Cercle"], players: 0, duration: 4, energy: "Forte", material: "Aucun", format: "En cercle" },
  { title: "La chaise en 5 façons", summary: "Autour d'une chaise placée au centre, un joueur reçoit une action et doit l'effectuer de 5 façons différentes, en faisant le tour de la chaise entre chaque façon, devant le reste du groupe.", level: "Confirmé", objectives: ["Imagination", "Physique"], players: 0, duration: 8, energy: "Modérée", material: "Chaise", format: "Tour à tour avec spectateur" },
  { title: "Progression en 4 chaises", summary: "4 joueurs sont assis sur 4 chaises numérotées. Le public donne une action ou une émotion du quotidien : la chaise 1 la joue normalement, la chaise 4 la joue en super exagéré, les autres graduellement entre les deux.", level: "Confirmé", objectives: ["Imagination", "Physique"], players: 4, duration: 8, energy: "Modérée", material: "4 chaises", format: "En groupe simultané" },
  { title: "Tableaux à deviner", summary: "Un groupe de joueurs se place en scène en prenant des poses pour reconstituer un tableau ou un film connu (le radeau de la méduse, la Cène...) qu'un joueur doit deviner.", level: "Débutant", objectives: ["Imagination", "Physique", "Jeu"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "En groupe simultané" },
  { title: "Machine", summary: "À partir d'un titre de machine imaginaire donné (ex. machine à faire des serpents), les joueurs se placent les uns après les autres avec un mouvement et un son répétitifs pour former une machine collective.", level: "Débutant", objectives: ["Imagination", "Physique", "Voix", "Mime"], players: 0, duration: 4, energy: "Forte", material: "Aucun", format: "En groupe simultané" },
  { title: "Course au ralenti + public", summary: "Tous les joueurs démarrent une course au ralenti maximum, le plus expressif possible, pendant que certains jouent le public qui les accompagne. Variante : en relais.", level: "Débutant", objectives: ["Imagination", "Physique", "Mime", "Musique"], players: 0, duration: 4, energy: "Modérée", material: "Musique (type \"Les Chariots de feu\")", format: "En groupe simultané" },
  { title: "Bataille au ralenti", summary: "Comme la course au ralenti, mais sous forme de bataille à l'arme blanche entre 2 clans, joué au ralenti et de façon très expressive.", level: "Débutant", objectives: ["Imagination", "Physique", "Mime", "Musique"], players: 0, duration: 4, energy: "Modérée", material: "Musique (type \"Les Chariots de feu\")", format: "En groupe simultané" },
  { title: "Devinettes", groupe: "Physique", summary: "Peut se faire de différentes façons, le but étant de faire deviner des choses au public : des lieux (le MC donne un lieu aux joueurs sans que le public sache ; ils le jouent en muet jusqu'à ce que quelqu'un du public trouve), des tableaux ou des films (les joueurs prennent des poses sur scène que le public doit reconnaître), ou des œuvres — films, livres (les joueurs jouent une scène dans l'univers de l'œuvre sans être trop évident).", level: "Débutant", objectives: ["Imagination", "Mime", "Jeu"], players: 0, duration: 5, energy: "Forte", material: "Aucun", format: "Tour à tour avec spectateur", warmup: true, stageWarmup: true },
  { title: "Pluie de compliments", groupe: "Groupe, prénoms et confiance", summary: "Les joueurs doivent aller dans le public et faire une déclaration d'amour ou de compliments à un maximum de spectateurs.", level: "Débutant", objectives: ["Confiance", "Jeu", "Cohésion"], players: 0, duration: 3, energy: "Forte", material: "Aucun", format: "Déambulation", warmup: true, stageWarmup: true },
  { title: "Tous pour 1", summary: "Le groupe serré ne communique que par gestes et bruits. Un leader tient un objet, fait un geste et un bruit que tout le monde reproduit, puis en fait un nouveau ; après 1min30 il passe l'objet à un nouveau leader qui recommence avec un nouvel objet.", level: "Confirmé", objectives: ["Imagination", "Physique", "Mime", "Voix"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "En groupe simultané" },
  { title: "Soultrain d'imitation", summary: "2 lignes de joueurs se font face. Les deux joueurs aux extrémités s'approchent l'un de l'autre en s'imitant et en amplifiant le trait imité, puis se retournent et traversent la ligne en amplifiant encore leur personnage.", level: "Confirmé", objectives: ["Imagination", "Physique", "Mime", "Personnages", "Écoute", "Observation"], players: 0, duration: 6, energy: "Forte", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Matière et Observateur", summary: "Un joueur incarne une matière qui bouge dans tous les sens ; l'observateur clap pour l'arrêter et décrit ce qu'il voit. Variante : la matière répond oui/non pour valider ou relancer la description.", level: "Confirmé", objectives: ["Imagination", "Physique", "Mime", "Personnages", "Observation"], players: 0, duration: 7, energy: "Modérée", material: "Aucun", format: "Solo simultané" },
  { title: "Cadeaux mimés", summary: "2 lignes de joueurs se font face. Ceux d'un côté offrent un objet mimé (poids, volume, texture) à ceux d'en face, qui doivent deviner et remercier pour l'objet nommé. Variante : expliquer aussi pourquoi cet objet compte beaucoup.", level: "Confirmé", objectives: ["Imagination", "Mime", "Personnages", "Observation", "Émotions", "Acceptation", "Cercle", "Objet", "Écoute"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "Solo simultané" },
  { title: "Déclaration", summary: "En cercle, une personne décrit un personnage et une situation puis s'arrête juste avant sa réplique ; la personne suivante dans le cercle donne alors la réplique du personnage.", level: "Confirmé", objectives: ["Imagination", "Personnages", "Observation", "Émotions", "Acceptation", "Cercle"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "En cercle" },
  { title: "Devine lieu grâce à objet", summary: "Un joueur reçoit un lieu et doit mimer une action avec un objet propre à ce lieu jusqu'à ce que le groupe devine ; si besoin, un autre joueur qui a compris peut venir mimer une nouvelle action avec un autre objet du même lieu.", level: "Confirmé", objectives: ["Imagination", "Personnages", "Observation", "Mime", "Objet", "Cercle", "Lieux"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Super-pouvoir et inconvénients", summary: "En cercle, un joueur donne un super-pouvoir, celui à sa gauche en donne l'inconvénient, puis le suivant propose un nom de super-héros, et le cycle continue tout autour du cercle.", level: "Confirmé", objectives: ["Imagination", "Personnages", "Univers", "Écoute", "Acceptation"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "En cercle" },
  { title: "Tu es...", summary: "Un joueur fait face à 4-5 autres qui lui donnent chacun une proposition commençant par \"Tu es...\" ; il doit interpréter et accepter chaque proposition reçue.", level: "Confirmé", objectives: ["Imagination", "Personnages", "Écoute", "Acceptation"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "Tour à tour avec spectateur" },
].map((e) => ({ id: uid(), warmup: false, application: false, showTypes: [], phase: "Pré-impro", ...e }));

/* Exercices Impro fournis par l'utilisateur. */
const EXERCICES_IMPRO = [
  { title: "L'aide", groupe: "Acceptation et écoute", summary: "En cercle, un participant effectue une action seul (bâtir une maison, escalader une montagne...) puis se retrouve en difficulté ; un autre vient l'aider et la tâche s'achève à deux.", level: "Débutant", objectives: ["Cercle", "Écoute", "Acceptation", "Mime"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "En cercle" },
  { title: "Soirée mondaine", groupe: "Acceptation et écoute", summary: "Des groupes de 2 à 4 personnes discutent à une soirée sur un même thème. Quand son numéro est appelé, un groupe poursuit sa discussion pendant que les autres s'arrêtent, jusqu'à ce que les groupes s'équilibrent seuls. Variante : réincorporer des éléments des autres discussions.", level: "Débutant", objectives: ["Écoute", "Acceptation", "Mime", "Personnages"], players: 0, duration: 8, energy: "Modérée", material: "Aucun", format: "En groupe simultané" },
  { title: "Le feu de camp", groupe: "Acceptation et écoute", summary: "Tous les joueurs sont assis en cercle, yeux fermés. Le prof tourne et touche l'épaule d'un joueur qui commence une histoire, puis touche un autre qui la continue, et ainsi de suite.", level: "Débutant", objectives: ["Écoute", "Acceptation", "Imagination", "Cercle"], players: 0, duration: 7, energy: "Faible", material: "Aucun", format: "En cercle" },
  { title: "Histoire en oui et", groupe: "Acceptation et écoute", summary: "En ligne de 3 à 5 joueurs, on raconte une histoire une phrase à la fois, chaque phrase devant commencer par \"Oui et...\", \"Et comme si ça ne suffisait pas...\" ou \"Parce que...\".", level: "Débutant", objectives: ["Écoute", "Acceptation", "Imagination"], players: 0, duration: 5, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Oui et", groupe: "Acceptation et écoute", summary: "En cercle, des scènes à 2 se jouent au centre ; chaque phrase doit commencer par \"Oui et...\" afin d'accepter, utiliser et enrichir toutes les propositions faites.", level: "Débutant", objectives: ["Écoute", "Acceptation", "Imagination", "Cercle"], players: 0, duration: 6, energy: "Faible", material: "Aucun", format: "En cercle" },
  { title: "Histoire 1 mot à la fois", groupe: "Acceptation et écoute", summary: "En cercle, on construit une histoire chacun son tour, un mot à la fois. Si l'histoire tourne en rond, quelqu'un peut dire ENCORE ; si elle semble terminée, quelqu'un peut dire FIN. Variante : 2 puis 3 mots à la fois.", level: "Débutant", objectives: ["Écoute", "Acceptation", "Imagination", "Cercle"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "En cercle" },
  { title: "3 chaises", groupe: "Acceptation et écoute", summary: "3 joueurs assis sur 3 chaises ne savent pas qui ils sont ni où ils sont ; ils jouent une scène qui se termine quand ils partent ensemble. Variante : la même scène sans parler, par choix.", level: "Débutant", objectives: ["Écoute", "Acceptation", "Imagination", "Observation"], players: 3, duration: 4, energy: "Faible", material: "3 chaises", format: "Tour à tour avec spectateur" },
  { title: "Les spectateurs", groupe: "Acceptation et écoute", summary: "Le groupe se place en lignes, tourné dans la même direction comme un vrai public, pour \"regarder\" ensemble un événement imaginaire annoncé par l'animateur (décollage de fusée, match de tennis...). Variantes : cinéma imaginaire commenté, ou juste \"il se passe quelque chose ici\".", level: "Débutant", objectives: ["Écoute", "Acceptation", "Émotions"], players: 0, duration: 5, energy: "Modérée", material: "Aucun", format: "En groupe simultané" },
  { title: "Gromelo alterné", groupe: "Acceptation et écoute", summary: "Une scène où les joueurs doivent passer du gromelo (langage inventé) au langage courant au signal de l'animateur.", level: "Avancé", objectives: ["Écoute", "Acceptation", "Imagination", "Observation"], players: 0, duration: 8, energy: "Modérée", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Fusionner 2 mimes", groupe: "Acceptation et écoute", summary: "2 joueurs sur scène font chacun un mime différent. Dès qu'ils pensent avoir compris (ou pas) le mime de l'autre, ils tentent une réplique qui fusionne les deux mimes, puis peuvent poursuivre en impro.", level: "Avancé", objectives: ["Écoute", "Acceptation", "Imagination", "Observation", "Mime", "Cohésion"], players: 0, duration: 8, energy: "Modérée", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Lieu en mouvement", groupe: "Acceptation et écoute", summary: "Impro de 2 à 4 joueurs se déroulant dans un lieu en mouvement (voiture, grand 8, bateau en tempête, vaisseau spatial...) que tous les joueurs doivent faire vivre ensemble physiquement.", level: "Avancé", objectives: ["Écoute", "Acceptation", "Imagination", "Observation", "Mime", "Cohésion", "Lieux", "Physique"], players: 2, duration: 8, energy: "Modérée", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Manipulation collective", groupe: "Acceptation et écoute", summary: "Un groupe d'au moins 3 joueurs manipule ensemble un objet imaginaire imposant (filet de pêche, piano, voiture en panne...) sans meneur désigné : c'est l'objet lui-même qui dicte les actions et les corps se répondent en permanence. Variante : ajouter une contrainte environnementale (vent, pluie, bateau qui tangue).", level: "Avancé", objectives: ["Écoute", "Acceptation", "Imagination", "Observation", "Mime", "Objet", "Cohésion"], players: 3, duration: 8, energy: "Modérée", material: "Aucun", format: "En groupe simultané" },
  { title: "2 scènes simultanées", groupe: "Acceptation et écoute", summary: "4 joueurs répartis en 2 binômes jouent une scène chacun ; quand un binôme est mobile, l'autre reste immobile. Variante : les joueurs parlent et doivent relier les deux scènes entre elles.", level: "Avancé", objectives: ["Écoute", "Acceptation", "Observation", "Cohésion"], players: 4, duration: 8, energy: "Faible", material: "Aucun", format: "En groupe simultané" },
  { title: "Devine la règle", groupe: "Acceptation et écoute", summary: "Scène à 2 joueurs. Le coach donne en secret une règle de comportement à chacun (soupirer en parlant de nourriture, rire à son prénom...) ainsi qu'une plateforme claire. Les joueurs jouent la scène tout en essayant de deviner la règle de l'autre.", level: "Avancé", objectives: ["Écoute", "Acceptation", "Observation", "Mime", "Jeu"], players: 0, duration: 10, energy: "Modérée", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Rester connecté à son perso", groupe: "Acceptation et écoute", summary: "Une scène normale se joue, mais un personnage qui ne parle pas doit murmurer en continu ce qu'il pense ; personne ne reste silencieux. Variante : penser ces pensées en silence plutôt que de les murmurer.", level: "Avancé", objectives: ["Écoute", "Acceptation", "Observation", "Personnages", "Voix", "Émotions"], players: 0, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Entrer dans un café", groupe: "Premières impro", summary: "Un ou plusieurs joueurs sont déjà installés dans un café. Un autre entre avec une situation imposée par le coach (écrivain célèbre, poursuivi par un vampire, rendez-vous amoureux...) et doit l'incarner immédiatement tout en laissant vivre le lieu et les interactions.", level: "Confirmé", objectives: ["Entrées/Sorties", "Engagement", "Personnages", "Écoute", "Lieux", "Observation"], players: 3, duration: 15, energy: "Modérée", material: "Chaises optionnelles", format: "Tour à tour avec spectateur" },
  { title: "Blind Date", groupe: "Premières impro", summary: "Deux joueurs improvisent un premier rendez-vous amoureux, en version classique, en gromelot, avec une émotion imposée, ou en s'inspirant d'un animal totem.", level: "Débutant", objectives: ["Relation", "Écoute", "Personnages"], players: 0, duration: 12, energy: "Modérée", material: "Chaises optionnelles", format: "Tour à tour avec spectateur" },
  { title: "On ne parle pas de ce qu'on fait", groupe: "Premières impro", summary: "Les joueurs partagent une même activité ou un même lieu et doivent le faire vivre par leurs actions, gestes et objets, sans jamais nommer ce qu'ils font.", level: "Débutant", objectives: ["Mime", "Observation", "Lieux", "Physique", "Objet", "Cohésion"], players: 2, duration: 12, energy: "Modérée", material: "Chaises optionnelles", format: "Tour à tour avec spectateur" },
  { title: "Posture confiante", groupe: "Premières impro", summary: "Les joueurs travaillent leur présence scénique en adoptant une posture assurée et engagée, pour entrer sur scène avec confiance quelle que soit la situation proposée.", level: "Tous", objectives: ["Posture", "Confiance", "Physique"], players: 2, duration: 7, energy: "Faible", material: "Aucun", format: "Solo simultané" },
  { title: "Avocat du diable", groupe: "Posture confiante", summary: "Un ou plusieurs joueurs défendent avec le plus grand sérieux une affirmation volontairement absurde proposée par les autres, en construisant une argumentation logique et crédible malgré l'absurdité.", level: "Confirmé", objectives: ["Argumentation", "Acceptation", "Engagement", "Créativité"], players: 5, duration: 12, energy: "Forte", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Débit rapide - 1 minute", groupe: "Posture confiante", summary: "Chaque joueur parle une minute devant le groupe sans s'arrêter, en gardant un débit soutenu et sans laisser de silence.", level: "Tous", objectives: ["Voix", "Lâcher-prise", "Confiance", "Spontanéité"], players: 0, duration: 10, energy: "Forte", material: "Chronomètre", format: "Tour à tour avec spectateur" },
  { title: "Histoires en trois mots avec des piranhas", groupe: "Posture confiante", summary: "Le groupe raconte une histoire connue (ou pas) au prof, chaque joueur n'ayant droit qu'à 3 mots avant de passer la main. À la moindre faiblesse (cafouillage, silence), le prof actionne une trappe imaginaire et des piranhas dévorent le joueur.", level: "Débutant", objectives: ["Écoute", "Narration", "Lâcher-prise", "Engagement", "Spontanéité"], players: 0, duration: 8, energy: "Forte", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Le gros titre du journal", groupe: "Posture confiante", summary: "Dans une cuisine, un joueur fait la vaisselle pendant que l'autre, assis, lit à voix haute le gros titre du journal puis l'article entier, sans hésiter ni bafouiller.", level: "Confirmé", objectives: ["Voix", "Concentration", "Imagination", "Écoute", "Spontanéité"], players: 0, duration: 6, energy: "Modérée", material: "Aucun", format: "En groupe simultané" },
  { title: "Lire des lettres", groupe: "Posture confiante", summary: "Deux joueurs jouent une épistolaire inversée : ils lisent à voix haute les lettres qu'ils reçoivent mais pas celles qu'ils écrivent, sans hésiter ni bafouiller.", level: "Confirmé", objectives: ["Narration", "Écoute", "Voix", "Relation", "Spontanéité"], players: 2, duration: 7, energy: "Faible", material: "Aucun", format: "Solo simultané" },
  { title: "La troupe de danse", groupe: "Jouer avec la musique", summary: "Les joueurs incarnent une troupe de danse professionnelle et improvisent une chorégraphie collective avec conviction, comme si tout avait été parfaitement répété.", level: "Débutant", objectives: ["Écoute", "Cohésion", "Physique", "Confiance", "Spontanéité", "Rythme", "Musique"], players: 0, duration: 6, energy: "Forte", material: "Musique", format: "Tour à tour avec spectateur" },
  { title: "Le rituel", groupe: "Posture confiante", summary: "Des objets sont disposés aléatoirement dans la salle. Le groupe joue un rituel annuel que tout le monde connaît par cœur, sans place au doute sur son rôle dans le rituel. Un fond musical est possible.", level: "Débutant", objectives: ["Physique", "Écoute", "Engagement", "Cohésion", "Spontanéité", "Rythme", "Musique"], players: 0, duration: 4, energy: "Modérée", material: "Quelques objets et musique", format: "En groupe simultané" },
  { title: "Le qui-où-quoi en 3 répliques", groupe: "Plateforme", summary: "2 joueurs reçoivent un thème et doivent faire comprendre au public le qui (rôles et relation), le où (lieu) et le quoi (enjeu) en seulement 3 répliques ; sinon on recommence l'impro, sinon on peut poursuivre un peu.", level: "Confirmé", objectives: ["Plateforme", "Écoute", "Observation", "Lieux", "Relation", "Personnages", "Enjeux"], players: 0, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "La file d'attente", groupe: "Plateforme", summary: "La scène se passe dans une file d'attente (cinéma, médecin, allocations...) ; les joueurs doivent simplement discuter entre eux et créer du lien.", level: "Confirmé", objectives: ["Plateforme", "Écoute", "Observation", "Relation", "Personnages", "Lieux"], players: 2, duration: 12, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Carrousel de personnages", groupe: "Plateforme", summary: "4 joueurs : A joue une scène avec B selon une relation donnée (amour, famille, amis, collègue, administratif, criminel), puis A sort et C entre jouer une nouvelle relation avec B qui garde son personnage ; on continue ainsi avec C-D puis D-A.", level: "Confirmé", objectives: ["Plateforme", "Écoute", "Observation", "Relation", "Personnages"], players: 4, duration: 12, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "La petite ville", groupe: "Plateforme", summary: "Comme le carrousel de personnages, des scènes à 2 joueurs s'enchaînent avec différentes relations dans une ville nommée au début ; on change de scène une fois le lieu, la relation et sa direction fixés.", level: "Confirmé", objectives: ["Plateforme", "Écoute", "Observation", "Relation", "Personnages"], players: 4, duration: 12, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "La visite guidée / l'audio-guide", groupe: "Plateforme", summary: "Un joueur présente à un autre un musée, un lieu historique ou un appartement à vendre en détaillant les objets ; l'autre peut poser des questions ou modifier les paramètres de l'\"audio-guide\" (vitesse, langue, répétition...).", level: "Débutant", objectives: ["Plateforme", "Écoute", "Observation", "Spontanéité", "Imagination", "Lieux"], players: 0, duration: 7, energy: "Forte", material: "Aucun", format: "En groupe simultané" },
  { title: "Manipulation d'objets dans un lieu", groupe: "Plateforme", summary: "Scène à 2-3 joueurs qui doivent manipuler des objets dans le lieu et remanipuler ceux des autres joueurs.", level: "Confirmé", objectives: ["Plateforme", "Écoute", "Observation", "Spontanéité", "Imagination", "Lieux", "Mime", "Objet"], players: 0, duration: 7, energy: "Modérée", material: "Aucun", format: "En groupe simultané" },
  { title: "On parle pas de ce qu'on fait", groupe: "Plateforme", summary: "2 joueurs reçoivent une même occupation ou un même lieu ; ils doivent jouer, mimer les actions et faire vivre le lieu sans jamais dire ce qu'ils font. Variante à 3-4 : activité collective, toujours en mouvement, sans inaction.", level: "Avancé", objectives: ["Plateforme", "Observation", "Spontanéité", "Imagination", "Lieux", "Mime", "Objet"], players: 0, duration: 10, energy: "Faible", material: "Aucun", format: "En groupe simultané" },
  { title: "Rencontre annulée", groupe: "Plateforme", summary: "Un joueur seul prépare un lieu pour un rendez-vous en disposant des objets, puis reçoit un appel annonçant l'annulation ; il réagit à la nouvelle en remettant les objets à leur place.", level: "Confirmé", objectives: ["Plateforme", "Spontanéité", "Imagination", "Lieux", "Mime", "Objet"], players: 0, duration: 6, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Meubler un espace", groupe: "Plateforme", summary: "Un joueur manipule un maximum d'objets chers dans un lieu en 30 secondes puis sort ; un deuxième entre et dérange (ou détruit) ces objets ; le premier revient, constate et réagit.", level: "Confirmé", objectives: ["Plateforme", "Spontanéité", "Imagination", "Lieux", "Mime", "Objet", "Mémoire", "Observation"], players: 0, duration: 6, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Visite guidée aveugle", groupe: "Plateforme", summary: "Le joueur A ferme les yeux et évolue dans un monde décrit par B avec le plus de détails possibles, y compris les sensations, pas seulement les objets.", level: "Confirmé", objectives: ["Plateforme", "Spontanéité", "Imagination", "Lieux", "Voix", "Sensations", "Émotions"], players: 0, duration: 6, energy: "Forte", material: "Aucun", format: "En groupe simultané" },
  { title: "Scène painting (construction du lieu)", groupe: "Plateforme", summary: "Une équipe place chacun son tour un objet, un son ou une texture pour construire collectivement un lieu, avec une attitude scénique ; une fois le lieu installé, les joueurs entrent l'habiter sans forcément chercher à faire une scène. Variantes : trois tours stricts (objets, sons, actions), ou ajouts en cours de jeu.", level: "Avancé", objectives: ["Plateforme", "Écoute", "Observation", "Sensations", "Objet", "Mime", "Lieux", "Personnages", "Posture"], players: 4, duration: 12, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Scène painting (échange d'objets)", groupe: "Plateforme", summary: "Les joueurs manipulent des objets dans un lieu donné et doivent, au signal de l'animateur, s'échanger ces objets entre eux. Variante : parler sans jamais dire ce qu'on fait.", level: "Avancé", objectives: ["Plateforme", "Écoute", "Observation", "Objet", "Mime", "Lieux"], players: 0, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Parlez moi... (Lieu ou relation)", groupe: "Plateforme", summary: "Des scènes où les joueurs ne peuvent parler que du lieu, ou que de leur relation, selon la consigne donnée.", level: "Avancé", objectives: ["Plateforme", "Écoute", "Observation", "Objet", "Mime", "Lieux", "Relation", "Personnages"], players: 0, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Allons à la banque", groupe: "Plateforme", summary: "Les joueurs sont répartis face au public. L'un annonce un lieu (\"Allons à la banque\") et tous doivent agir sans jamais rester inactifs, en visualisant précisément leurs objets (poids, dimensions, résistance). On travaille la technique du mime plus que le personnage ; en débrief, on demande ce que faisait chacun.", level: "Confirmé", objectives: ["Plateforme", "Écoute", "Observation", "Objet", "Mime", "Lieux", "Relation", "Personnages", "Émotions"], players: 4, duration: 10, energy: "Faible", material: "Aucun", format: "En groupe simultané" },
  { title: "Scènes avec figurants", groupe: "Plateforme", summary: "Des scènes à 3, 4 ou 5 joueurs entrent ensemble faire vivre un lieu ; un enjeu émerge des échanges et la scène s'y concentre, tout en continuant à faire vivre le lieu. Variante : deux personnages principaux avec une relation donnée, entourés de figurants qui font vivre le lieu.", level: "Avancé", objectives: ["Plateforme", "Écoute", "Observation", "Mime", "Lieux", "Relation", "Personnages", "Émotions", "Enjeux"], players: 3, duration: 13, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Manipuler un objet avant de parler", groupe: "Plateforme", summary: "Scène normale, mais chaque personnage doit manipuler un objet différent (éventuellement déjà manipulé par un autre) avant de pouvoir parler.", level: "Débutant", objectives: ["Plateforme", "Écoute", "Observation", "Mime", "Objet"], players: 2, duration: 8, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Extended story spine", groupe: "Enjeux", summary: "En cercle, on construit une histoire à plusieurs : \"il était une fois...\", puis \"et tous les jours...\" (autant de fois que voulu), puis un \"Et un jour...\" lance la bascule, suivi de \"Et grâce/à cause de ça...\", et un joueur conclut par \"Et finalement...\".", level: "Débutant", objectives: ["Plateforme", "Écoute", "Enjeux", "Narration", "Cercle"], players: 5, duration: 8, energy: "Faible", material: "Aucun", format: "En cercle" },
  { title: "Le où-qui-quoi successif", groupe: "Enjeux", summary: "3 joueurs : le premier pose le lieu (mime ou répliques), le second entre dès qu'il a compris pour poser la relation entre les personnages, le troisième entre dès qu'il perçoit un enjeu pour l'accentuer.", level: "Confirmé", objectives: ["Plateforme", "Enjeux", "Narration", "Lieux", "Mime", "Relation", "Personnages"], players: 3, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Rien, rien, quelque chose", groupe: "Enjeux", summary: "2 joueurs jouent normalement ; le public lève la main dès qu'il perçoit un début de jeu ou d'enjeu (\"quelque chose\"). Le but est de retarder au maximum son apparition.", level: "Avancé", objectives: ["Plateforme", "Enjeux", "Narration"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Propositions faibles et fortes", groupe: "Enjeux", summary: "Les joueurs ne font que des propositions faibles jusqu'à ce que le prof annonce \"proposition forte\".", level: "Avancé", objectives: ["Plateforme", "Enjeux", "Narration", "Spontanéité"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Henri... je sais", groupe: "Enjeux", summary: "Un joueur dit \"Henri...\", l'autre répond \"Je sais...\" en avouant un problème le concernant, et on continue ainsi en enchaînant les aveux.", level: "Débutant", objectives: ["Plateforme", "Enjeux", "Narration", "Spontanéité"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Remarquer et répéter", groupe: "Enjeux", summary: "2 joueurs jouent la plateforme normalement ; dès qu'un \"quelque chose\" apparaît chez l'autre, on le remarque s'il est physique, on le répète s'il est verbal.", level: "Avancé", objectives: ["Plateforme", "Enjeux", "Observation"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Phrases imposées", groupe: "Enjeux", summary: "Scène avec des débuts de phrases imposés : \"parce que...\" / \"Je sais que...\" / \"Et en plus...\".", level: "Confirmé", objectives: ["Plateforme", "Enjeux"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Débuts de phrases...", groupe: "Enjeux", summary: "Une fois la plateforme installée, les joueurs piochent un papier avec un début de phrase (ressenti, attachement, tension, dévoilement, anecdote) qui les oblige à apporter détails et intensité à la scène.", level: "Confirmé", objectives: ["Plateforme", "Enjeux", "Personnages", "Relation"], players: 2, duration: 10, energy: "Faible", material: "Papiers avec débuts de phrase", format: "Tour à tour avec spectateur" },
  { title: "Le désaccord", groupe: "Monter les enjeux", summary: "2 joueurs démarrent un désaccord sur un thème simple et le font évoluer selon les indications du coach : cordial, insistant, moqueur, agacé, énervé, jusqu'à l'abandon de l'un des deux.", level: "Confirmé", objectives: ["Plateforme", "Enjeux", "Personnages", "Relation", "Émotions"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Le scandale familial", groupe: "Monter les enjeux", summary: "3-4 joueurs jouent un dîner familial ; un joueur désigné fait \"un scandale\" (monologue à intensité émotionnelle croissante) puis la discussion reprend presque normalement. Variante : scandales de bonheur, de tristesse...", level: "Confirmé", objectives: ["Plateforme", "Enjeux", "Personnages", "Relation", "Émotions"], players: 3, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Table de resto inversées", groupe: "Monter les enjeux", summary: "4 joueurs, 2 tables de restaurant : sur l'une se développe un enjeu négatif, sur l'autre un enjeu positif.", level: "Confirmé", objectives: ["Plateforme", "Enjeux", "Personnages", "Relation", "Émotions"], players: 4, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Scènes avec \"la vérité c'est que...\"", groupe: "Monter les enjeux", summary: "2 ou 3 joueurs en scène ; à un moment, un joueur dit \"la vérité c'est que...\" ou \"c'est très important pour moi parce que...\". Variante : la phrase est piochée sur un papier.", level: "Confirmé", objectives: ["Plateforme", "Enjeux", "Relation", "Émotions"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Scènes d'entrées et sorties", groupe: "Monter les enjeux", summary: "Scène longue à plusieurs passages travaillant l'ellipse, le tag out, les balances et les entrées en devant de scène.", level: "Avancé", objectives: ["Entrées/Sorties"], players: 3, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Miroir, miroir en ligne, ascenseur", groupe: "Observation, mimétisme et complicité", summary: "2 lignes de joueurs : une ligne leader, l'autre suiveuse en miroir. Variantes : changer de leader librement, se tenir la main, ou jeu de l'ascenseur (entrées successives avec gestes repris).", level: "Confirmé", objectives: ["Observation", "Écoute", "Complicité", "Cohésion"], players: 0, duration: 10, energy: "Modérée", material: "Aucun", format: "En groupe simultané" },
  { title: "Sortir du conflit", groupe: "Observation, mimétisme et complicité", summary: "Une scène à 2 démarre par un conflit ; l'objectif est d'en sortir en utilisant \"la vérité c'est que\", \"moi aussi\", \"je sais pourquoi tu réagis comme ça\" ou une anecdote commune.", level: "Confirmé", objectives: ["Observation", "Écoute", "Complicité", "Cohésion", "Relation", "Spontanéité"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Scènes avec \"moi aussi\"", groupe: "Observation, mimétisme et complicité", summary: "2 inconnus se rencontrent dans un lieu donné ; ils doivent se dire \"moi aussi\" souvent et rester dans le mimétisme de l'attitude de l'autre.", level: "Confirmé", objectives: ["Observation", "Écoute", "Complicité", "Cohésion", "Relation", "Spontanéité"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Les 2 chaises", groupe: "Simplicité / jeu juste", summary: "2 joueurs manipulent 2 chaises qui incarnent les personnages principaux, en les déplaçant l'une après l'autre avec des changements de position subtils.", level: "Confirmé", objectives: ["Observation", "Complicité", "Spontanéité", "Jouer juste"], players: 2, duration: 10, energy: "Faible", material: "Deux chaises", format: "Tour à tour avec spectateur" },
  { title: "No man's land", groupe: "Simplicité / jeu juste", summary: "Dans un lieu de transit imposé (file d'attente, hall de gare...), des personnages arrivent et habitent l'espace sans créer d'enjeu, avec sobriété, regards et silences.", level: "Confirmé", objectives: ["Observation", "Jouer juste", "Silence"], players: 0, duration: 10, energy: "Faible", material: "Aucun", format: "En groupe simultané" },
  { title: "Inspiration sur pose chaise", groupe: "Simplicité / jeu juste", summary: "2 joueurs prennent une pose (avec ou sans chaises) avant de démarrer l'impro, qui commence quand une idée inspirée par la pose émerge.", level: "Confirmé", objectives: ["Spontanéité", "Jouer juste"], players: 2, duration: 10, energy: "Faible", material: "Deux chaises", format: "Tour à tour avec spectateur" },
  { title: "2 phrases", groupe: "Simplicité / jeu juste", summary: "Scène où les joueurs ne peuvent dire que 2 phrases ; il faut utiliser gestes, silences, soupirs et bruits pour le reste.", level: "Confirmé", objectives: ["Spontanéité", "Jouer juste", "Émotions", "Écoute", "Observation", "Silence"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Scènes avec silence", groupe: "Simplicité / jeu juste", summary: "L'animateur force des silences après les propositions fortes, avec des phrases déclencheuses comme \"la vérité c'est que...\" ou \"le plus important pour moi c'est...\".", level: "Confirmé", objectives: ["Spontanéité", "Jouer juste", "Émotions", "Écoute", "Observation", "Silence", "Enjeux"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Scènes 1 masque", groupe: "Masque", summary: "Scène solo masquée sur des situations imposées : entretien d'embauche, réunion de gang, jugement, chef d'orchestre, anniversaire surprise.", level: "Avancé", objectives: ["Spontanéité", "Jouer juste", "Écoute", "Observation", "Silence", "Corps", "Masque"], players: 1, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Scènes avec 2 masques", groupe: "Masque", summary: "Scène masquée à 2 sur des situations imposées : rendez-vous, banc public, wagon de train, adieux, distribution de tracts, ascenseur bloqué, etc.", level: "Avancé", objectives: ["Spontanéité", "Jouer juste", "Écoute", "Observation", "Silence", "Corps", "Masque"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Masque et sans masque", groupe: "Masque", summary: "Scène à 2 sur des situations imposées (date en retard, auto-école, interrogatoire, thérapie de couple...), jouée avec ou sans masque.", level: "Avancé", objectives: ["Spontanéité", "Jouer juste", "Écoute", "Observation", "Silence", "Corps", "Masque"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Essaye de faire mieux", groupe: "Jeu du corps", summary: "3 joueurs : A fait une action simple de façon impressionnante, B puis C doivent la refaire encore plus impressionnante. L'attitude compte plus que l'action.", level: "Confirmé", objectives: ["Corps", "Physique", "Mime", "Objet", "Écoute", "Observation"], players: 3, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Sculpter son partenaire", groupe: "Jeu du corps", summary: "Par binôme, le sculpteur bouge son partenaire pour lui faire prendre des poses qu'il maintient. Variante : une pose peut inspirer un son que le sculpté amplifie jusqu'à ce qu'il commence à réfléchir.", level: "Débutant", objectives: ["Corps", "Physique", "Mime", "Observation", "Confiance"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Gromelot canapé", groupe: "Jeu du corps", summary: "Scène à 3+ en gromelot : une soirée canapé où chacun raconte à tour de rôle une blague en y mettant tout son corps pour faire rire les autres, qui réagissent honnêtement. Variantes : poème, potin, histoire qui fait peur.", level: "Confirmé", objectives: ["Corps", "Physique", "Mime", "Observation", "Émotions"], players: 3, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Gromelot partir/rester", groupe: "Jeu du corps", summary: "En gromelot, A veut quitter la pièce le plus vite possible, B veut le faire rester le plus longtemps possible.", level: "Confirmé", objectives: ["Corps", "Physique", "Mime", "Observation", "Émotions", "Cohésion", "Acceptation"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Gromelot speed dating", groupe: "Jeu du corps", summary: "Une scène de speed dating jouée entièrement en gromelot.", level: "Confirmé", objectives: ["Corps", "Physique", "Mime", "Observation", "Émotions", "Cohésion", "Acceptation"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Bataille pour la chaise", groupe: "Jeu du corps", summary: "3 joueurs (possible en gromelot) tentent de s'asseoir sur l'unique chaise en scène par tous les moyens honnêtes, alliances et trahisons comprises.", level: "Confirmé", objectives: ["Corps", "Physique", "Mime", "Observation", "Émotions", "Cohésion", "Acceptation", "Jeu"], players: 3, duration: 10, energy: "Faible", material: "Une chaise", format: "Tour à tour avec spectateur" },
  { title: "La pièce", groupe: "Jeu du corps", summary: "2 joueurs à un abribus ; une pièce posée aléatoirement doit être subtilisée sans que l'autre ne s'en aperçoive. Possible en muet, gromelot ou masque.", level: "Confirmé", objectives: ["Corps", "Physique", "Mime", "Observation", "Émotions", "Cohésion", "Acceptation", "Masque"], players: 2, duration: 10, energy: "Faible", material: "Deux chaises", format: "Tour à tour avec spectateur" },
  { title: "Gromelot énergies", groupe: "Jeu du corps", summary: "A entre neutre, B entre avec une énergie que A adopte puis A sort ; le cycle se répète en faisant évoluer et se transmettre les énergies entre les deux joueurs jusqu'à ce qu'ils quittent la scène dans la même énergie.", level: "Confirmé", objectives: ["Corps", "Physique", "Mime", "Observation", "Émotions", "Cohésion", "Acceptation", "Énergie"], players: 2, duration: 10, energy: "Faible", material: "Deux chaises", format: "Tour à tour avec spectateur" },
  { title: "La muette (scène)", groupe: "Jeu du corps", summary: "Scène (avec ou sans situation donnée) où les joueurs ne peuvent pas parler mais doivent penser leur texte très fort, comme projeté mentalement.", level: "Confirmé", objectives: ["Corps", "Physique", "Mime", "Observation", "Émotions", "Cohésion"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Musée", groupe: "Jeu du corps", summary: "4-5 joueurs en ligne figent leur corps pour représenter au mieux une émotion donnée, comme un tableau. Variante : incarner des personnages (roi, mendiant, serviteur...).", level: "Confirmé", objectives: ["Corps", "Physique", "Mime", "Observation", "Émotions"], players: 4, duration: 10, energy: "Faible", material: "Aucun", format: "En groupe simultané" },
  { title: "5 éléments", groupe: "Clown", summary: "Un joueur enchaîne 5 éléments physiques en prenant une grande inspiration entre chaque. Variante \"min to max\" : une énergie choisie s'intensifie à chaque élément.", level: "Confirmé", objectives: ["Corps", "Physique", "Mime", "Émotions", "Clown", "Silence"], players: 1, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Suiveur bêta", groupe: "Clown", summary: "En binôme, un meneur et un suiveur : le suiveur copie les mouvements du meneur mais reste une personne à part (peut ne pas tout copier, se moquer, arrêter de suivre), tout en laissant le meneur rester meneur à la fin.", level: "Confirmé", objectives: ["Corps", "Physique", "Mime", "Émotions", "Clown", "Observation", "Écoute"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "2 énergies", groupe: "Clown", summary: "2 joueurs choisissent chacun un objet et 2 énergies. Ils entrent tour à tour, copient l'énergie de l'autre et changent de registre au fur et à mesure des imitations croisées.", level: "Confirmé", objectives: ["Corps", "Physique", "Mime", "Émotions", "Clown", "Observation", "Écoute"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "La bonne façon de faire", groupe: "Les statuts", summary: "3 joueurs : le Boss (statut haut) montre comment utiliser un objet, le Négociateur (statut moyen) refait presque pareil, le Bouffon (statut bas) peut rater complètement. Variantes : action plus complexe, statuts évolutifs.", level: "Confirmé", objectives: ["Corps", "Physique", "Mime", "Observation", "Écoute", "Personnages", "Relation", "Statut"], players: 3, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Festival des statuts", groupe: "Les statuts", summary: "Après une explication des statuts hauts et bas, tout le groupe joue en simultané des statuts hauts ou bas selon les indications du prof, dans une ambiance de fête avec groupes de parole.", level: "Débutant", objectives: ["Corps", "Physique", "Mime", "Observation", "Écoute", "Personnages", "Relation", "Statut"], players: 0, duration: 8, energy: "Modérée", material: "Aucun", format: "En groupe simultané" },
  { title: "En marche", groupe: "Les statuts", summary: "Tout le monde cherche à avoir un statut plus haut que la personne croisée, chaque interaction servant à l'asseoir. Sur consigne, un sous-groupe doit au contraire viser le plus bas statut possible.", level: "Débutant", objectives: ["Corps", "Physique", "Mime", "Observation", "Écoute", "Personnages", "Relation", "Statut"], players: 0, duration: 8, energy: "Modérée", material: "Aucun", format: "En groupe simultané" },
  { title: "Tableaux de statuts", groupe: "Les statuts", summary: "Des équipes de 3 forment des tableaux vivants montrant qui a le statut le plus haut et le plus bas, 3 tableaux par équipe.", level: "Confirmé", objectives: ["Corps", "Physique", "Mime", "Observation", "Statut", "Jeu"], players: 3, duration: 8, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Jouer des scènes simples avec statuts", groupe: "Les statuts", summary: "Le prof donne des indications de statuts pour une scène imposée (entretien d'embauche, attente, parents et enfant en retard...).", level: "Débutant", objectives: ["Personnages", "Mime", "Observation", "Statut"], players: 2, duration: 8, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Empiler les statuts", groupe: "Les statuts", summary: "Des joueurs entrent successivement avec des statuts de plus en plus élevés.", level: "Avancé", objectives: ["Observation", "Statut", "Écoute", "Personnages"], players: 3, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Bataille de statuts", groupe: "Les statuts", summary: "Scène à 2 ou 3 où l'objectif donné par le prof est d'obtenir le statut le plus haut ou le plus bas.", level: "Confirmé", objectives: ["Observation", "Statut", "Écoute", "Jeu", "Acceptation", "Personnages"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Évolution de statuts", groupe: "Les statuts", summary: "Les joueurs démarrent avec un statut donné et doivent le faire évoluer au cours de l'impro.", level: "Avancé", objectives: ["Observation", "Statut", "Écoute", "Acceptation", "Personnages"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Rôles inversés", groupe: "Les statuts", summary: "Scène à 2 avec une relation impliquant déjà une hiérarchie de statut (cambrioleur/otage, prince/palefrenier...) ; au signal du coach, les statuts s'inversent, parfois deux fois.", level: "Avancé", objectives: ["Observation", "Statut", "Écoute", "Acceptation", "Personnages"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Cartes de statuts", groupe: "Les statuts", summary: "On distribue des cartes numérotées de 1 à 5 ; chaque joueur doit incarner le statut correspondant à sa carte. Variante : 2 cartes par personne.", level: "Avancé", objectives: ["Observation", "Statut", "Écoute", "Acceptation", "Personnages"], players: 3, duration: 10, energy: "Faible", material: "Cartes numérotées", format: "Tour à tour avec spectateur" },
  { title: "Statuts avec un objet", groupe: "Les statuts", summary: "Scène solo où le joueur manipule un objet avec un statut haut ou bas.", level: "Avancé", objectives: ["Observation", "Écoute", "Acceptation", "Statut", "Personnages"], players: 1, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Blind date émotion imposée", groupe: "Incarner les émotions", summary: "2 joueurs jouent un premier rendez-vous avec un caractère ou une émotion imposée.", level: "Confirmé", objectives: ["Observation", "Écoute", "Acceptation", "Personnages", "Émotions"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Orchestre d'émotions", groupe: "Incarner les émotions", summary: "6 joueurs en ligne reçoivent chacun une émotion ; un chef d'orchestre les pointe pour qu'ils la verbalisent sans mot, en dirigeant démarrages, arrêts et intensité.", level: "Débutant", objectives: ["Personnages", "Émotions", "Silence", "Jouer juste"], players: 6, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Interruption", groupe: "Incarner les émotions", summary: "A, concentrée sur une action précise, est interrompue puis reprise à répétition par B qui entre et sort de scène ; à chaque interruption l'émotion de A s'intensifie jusqu'à ce qu'elle chasse B.", level: "Confirmé", objectives: ["Émotions", "Jouer juste", "Écoute"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Les prénoms", groupe: "Incarner les émotions", summary: "2 ou 3 joueurs ne peuvent prononcer que les prénoms des autres pendant toute la scène.", level: "Débutant", objectives: ["Émotions", "Jouer juste", "Écoute", "Silence", "Observation", "Prénom"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Objet récalcitrant", groupe: "Incarner les émotions", summary: "Un joueur lutte avec un objet qui lui résiste (coffre rouillé, fermeture éclair, pot de confiture...). Variante à 2 : la résistance de l'objet révèle les enjeux relationnels.", level: "Confirmé", objectives: ["Émotions", "Jouer juste", "Écoute", "Observation", "Relation", "Objet"], players: 1, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Valise d'émotions", groupe: "Incarner les émotions", summary: "Un joueur reçoit une émotion, ouvre une valise au milieu de la scène et y trouve un objet qui lui fait ressentir cette émotion ; il doit jouer avec, donner des détails et creuser son ressenti.", level: "Confirmé", objectives: ["Émotions", "Jouer juste", "Observation", "Objet", "Spontanéité", "Imagination"], players: 1, duration: 10, energy: "Faible", material: "Une valise", format: "Tour à tour avec spectateur" },
  { title: "Martin venez dans mon bureau", groupe: "Incarner les émotions", summary: "Assis sur une chaise face au public, le joueur dit \"Martin venez dans mon bureau\" de 5 façons différentes (enjoué, amoureux, en colère...).", level: "Débutant", objectives: ["Émotions", "Jouer juste"], players: 1, duration: 10, energy: "Faible", material: "Une chaise", format: "Tour à tour avec spectateur" },
  { title: "Poses d'émotion", groupe: "Incarner les émotions", summary: "Par paire, A prend une pose exprimant puissamment une émotion avec tout son corps, B l'aide à aller plus loin. Variantes : ligne de 4-5 joueurs interprétant chacun une pose différemment, ou passage à \"l'explosion\" en mouvement.", level: "Confirmé", objectives: ["Émotions", "Jouer juste", "Observation", "Corps"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Chaise en face à face émotion", groupe: "Incarner les émotions", summary: "Binôme assis face à face ; une émotion donnée monte progressivement, les deux joueurs devant rester au même niveau d'intensité.", level: "Débutant", objectives: ["Émotions", "Jouer juste", "Observation", "Corps", "Écoute", "Mime", "Imitation"], players: 2, duration: 10, energy: "Faible", material: "Deux chaises", format: "Tour à tour avec spectateur" },
  { title: "Avancer face à face émotion", groupe: "Incarner les émotions", summary: "2 lignes de joueurs : A avance vers B en jouant une émotion (roue des émotions possible) ; A devine celle de B en disant \"ça va tu as l'air...\", B répond \"Oui et tu sais exactement pourquoi...\" et A justifie l'émotion.", level: "Débutant", objectives: ["Émotions", "Jouer juste", "Observation", "Écoute", "Imitation"], players: 0, duration: 10, energy: "Modérée", material: "Aucun", format: "Solo simultané" },
  { title: "Émotions inversées", groupe: "Incarner les émotions", summary: "A face à B : A doit dire \"je t'aime\" mais avec un corps qui exprime la haine, et inversement pour B.", level: "Confirmé", objectives: ["Émotions", "Jouer juste", "Observation", "Écoute", "Mime", "Imitation"], players: 0, duration: 10, energy: "Modérée", material: "Aucun", format: "Solo simultané" },
  { title: "Devine mon émotion", groupe: "Incarner les émotions", summary: "Un joueur doit faire deviner sans parler une émotion donnée par le prof.", level: "Débutant", objectives: ["Émotions", "Jouer juste"], players: 1, duration: 8, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Fais moi deviner mon émotion", groupe: "Incarner les émotions", summary: "Scène à 2 : un joueur fait deviner à l'autre sa propre émotion en jouant des réactions à celle-ci.", level: "Débutant", objectives: ["Émotions", "Jouer juste"], players: 0, duration: 6, energy: "Forte", material: "Aucun", format: "Solo simultané" },
  { title: "Les prisonniers affamés", groupe: "Incarner les émotions", summary: "2 joueurs au sol jouent des prisonniers affamés, énumérant des aliments l'un après l'autre avec un enthousiasme croissant, jusqu'à finir debout au max d'intensité. Variante : autres émotions.", level: "Confirmé", objectives: ["Émotions", "Jouer juste", "Spontanéité", "Imagination", "Personnages"], players: 2, duration: 8, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Le secret", groupe: "Incarner les émotions", summary: "Les joueurs démarrent une impro avec un secret qu'ils ne révéleront jamais, mais utilisent en sous-texte (envie pressante, ruine, RDV amoureux, danger...).", level: "Confirmé", objectives: ["Émotions", "Jouer juste", "Spontanéité", "Imagination", "Personnages"], players: 3, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Contamination d'émotions", groupe: "Incarner les émotions", summary: "Les joueurs entrent un à un ; le premier neutre pose la plateforme, chaque nouvel arrivant apporte une émotion qui \"contamine\" progressivement les autres déjà en scène.", level: "Avancé", objectives: ["Émotions", "Jouer juste", "Personnages", "Plateforme", "Lieux"], players: 4, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Rencontre 2 perso point moteur", groupe: "Approfondir le personnage", summary: "2 joueurs choisissent un point moteur à des coins opposés de la pièce, marchent avec, et démarrent une scène quand ils se rencontrent.", level: "Avancé", objectives: ["Écoute", "Observation", "Personnages"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Le mantra", groupe: "Approfondir le personnage", summary: "En déambulation, chacun pense un mantra fort (\"je suis...\") et le fait traverser son corps des pieds au visage, puis fait rire et parler son personnage. Variantes : interactions entre personnages, situations du quotidien.", level: "Avancé", objectives: ["Écoute", "Observation", "Personnages", "Déambulation"], players: 0, duration: 10, energy: "Modérée", material: "Aucun", format: "Déambulation" },
  { title: "Adjectif-adjectif-nom", groupe: "Approfondir le personnage", summary: "Un joueur commence un monologue de personnage pendant que 3 autres disent simultanément un adjectif, un autre adjectif et un nom pour le nommer.", level: "Confirmé", objectives: ["Écoute", "Observation", "Personnages", "Voix", "Jouer juste"], players: 4, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Profession + adjectif", groupe: "Approfondir le personnage", summary: "Une personne pense une profession, une autre un adjectif ; ils disent les deux mots en même temps et on joue une scène avec ce personnage résultant.", level: "Débutant", objectives: ["Personnages", "Adaptation"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Conviction personnelle", groupe: "Approfondir le personnage", summary: "En déambulation, chacun énonce une conviction personnelle que tout le monde arrête d'écouter ; on se met ensuite en réserve et on joue des scènes centrées sur un personnage né d'une conviction.", level: "Confirmé", objectives: ["Personnages", "Adaptation", "Déambulation", "Écoute", "Acceptation"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Déambulation" },
  { title: "Jouer les situations", groupe: "Approfondir le personnage", summary: "Le prof propose un dilemme fort à incarner sur scène (mariage et ancien amour, secret de famille, dilemme moral...).", level: "Confirmé", objectives: ["Personnages", "Adaptation", "Émotions", "Jouer juste"], players: 3, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Formules pour approfondir le perso", groupe: "Approfondir le personnage", summary: "Par binômes, A dit un mot au hasard et B doit lancer une formule (métaphore, crédo, anecdote, secret) et broder autour, en s'entraînant à la spontanéité plutôt qu'au sens.", level: "Confirmé", objectives: ["Personnages", "Adaptation", "Émotions"], players: 0, duration: 10, energy: "Modérée", material: "Aucun", format: "Solo simultané" },
  { title: "Le voyage intérieur", groupe: "Approfondir le personnage", summary: "Assis sur une chaise, sans parler ni bouger, le joueur se fait un monologue intérieur visible sur son visage et son regard, dans un lieu donné.", level: "Confirmé", objectives: ["Personnages", "Émotions", "Jouer juste", "Silence"], players: 1, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Parler tout seul", groupe: "Approfondir le personnage", summary: "Un joueur se parle tout seul en scène. Variante : d'autres joueurs présents ne parlent pas et réalisent que le personnage se parle à lui-même.", level: "Confirmé", objectives: ["Personnages", "Émotions", "Jouer juste", "Silence"], players: 1, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Vieillissement", groupe: "Approfondir le personnage", summary: "Une scène se joue dans un lieu fixe pendant que les personnages, débutant enfants, vieillissent par tranches de 10 ans sur les consignes du coach.", level: "Confirmé", objectives: ["Personnages", "Lieux"], players: 1, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Micro-trottoir", groupe: "Approfondir le personnage", summary: "Un joueur journaliste interroge des passants sur un sujet donné ; chaque interviewé doit incarner un personnage fort révélé par ses réponses.", level: "Débutant", objectives: ["Personnages", "Spontanéité", "Déambulation"], players: 0, duration: 10, energy: "Faible", material: "Aucun", format: "Déambulation" },
  { title: "Jeux télévisés / reality show", groupe: "Approfondir le personnage", summary: "Un présentateur reçoit 3-4 candidats qui se présentent en incarnant des personnages marqués, sur le modèle d'un jeu télé. Variante : vidéo de présentation façon télé-réalité vantant ses exploits.", level: "Confirmé", objectives: ["Personnages", "Spontanéité", "Univers", "Téléréalité"], players: 3, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Pose et personnage", groupe: "Approfondir le personnage", summary: "Un joueur prend diverses poses ; au \"stop\" du coach, il incarne un personnage inspiré de la pose figée, avec une voix particulière, et répond à ses questions.", level: "Confirmé", objectives: ["Personnages", "Spontanéité", "Voix", "Posture"], players: 1, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Carte de visite", groupe: "Approfondir le personnage", summary: "Le joueur pioche une carte de visite et crée un personnage et un lieu à partir d'elle ; un second joueur vient solliciter ses services.", level: "Débutant", objectives: ["Personnages", "Spontanéité", "Voix", "Posture", "Écoute", "Acceptation"], players: 2, duration: 10, energy: "Faible", material: "Cartes de visite", format: "Tour à tour avec spectateur" },
  { title: "Perso décrit par un autre", groupe: "Approfondir le personnage", summary: "A décrit à B un personnage C (physique, façon d'être, défauts, phobies...) ; C entre en scène en collant à la description et B interagit avec lui.", level: "Confirmé", objectives: ["Personnages", "Spontanéité", "Voix", "Posture"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Grand magasin", groupe: "Approfondir le personnage", summary: "A joue un vendeur qui vend absolument tout ; B fait 3 entrées successives avec 3 personnages différents venant acheter un objet, en restant bref à chaque fois.", level: "Confirmé", objectives: ["Personnages", "Écoute", "Acceptation", "Objet", "Spontanéité"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Clients et SAV", groupe: "Approfondir le personnage", summary: "Un joueur reçoit 3 clients qui veulent obtenir quelque chose (retour SAV, parents d'élèves, recrutement, génie exauçant des vœux...).", level: "Débutant", objectives: ["Personnages", "Écoute", "Acceptation", "Objet", "Spontanéité"], players: 4, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Regard public", groupe: "Regard", summary: "Scène normale sans regarder le public. Variantes : toujours regarder le public, ou tous les joueurs le regardent une seule fois ensemble.", level: "Confirmé", objectives: ["Regard"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Même regard", groupe: "Regard", summary: "2-3 joueuses doivent toujours regarder la même chose : le même endroit, se regarder entre elles, ou regarder le public.", level: "Débutant", objectives: ["Regard", "Écoute", "Observation", "Imitation"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Perso regard", groupe: "Regard", summary: "Une scène à 2 se joue puis une troisième joueuse entre sans être jamais regardée par les deux autres. Variante : elle est au contraire toujours regardée.", level: "Confirmé", objectives: ["Regard", "Écoute", "Observation"], players: 3, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Public en cercle", groupe: "Regard", summary: "Le public est placé à 360° autour de la scène ; les joueurs doivent se tourner régulièrement dans toutes les directions pour que chacun profite du jeu.", level: "Confirmé", objectives: ["Regard", "Corps"], players: 3, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Début de scène contact", groupe: "Le contact", summary: "A se place les yeux fermés au centre ; B pense à une relation entre eux, s'avance, touche A d'une certaine façon puis sort. A doit deviner la relation ressentie.", level: "Débutant", objectives: ["Contact", "Confiance", "Cohésion", "Écoute", "Acceptation"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Inspiration par le toucher", groupe: "Le contact", summary: "2 joueurs prennent une pose en étant en contact physique, qui doit lancer la scène.", level: "Confirmé", objectives: ["Contact", "Imagination"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Tag out", groupe: "Le contact", summary: "Un endroit du corps difficile à atteindre est désigné ; un joueur touché à cet endroit doit quitter la scène de façon justifiée, le dernier restant devant la terminer.", level: "Confirmé", objectives: ["Contact", "Acceptation", "Entrées/Sorties", "Observation", "Écoute"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Photo de famille", groupe: "Le contact", summary: "4-6 joueurs prennent chacun leur tour une pose sur une photo de famille, en annonçant \"Nous sommes les [NOM]\" ; le public doit deviner qui est qui. Variantes : photo de mariage, d'entreprise.", level: "Débutant", objectives: ["Contact", "Relation", "Personnages", "Jeu"], players: 4, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Tu as raison", groupe: "Gérer l'instable et l'obstacle", summary: "Un joueur refuse toutes les propositions de l'autre, qui doit composer avec en disant \"je sais pourquoi tu fais ça\" ou \"tu as raison de...\".", level: "Confirmé", objectives: ["Imprévu", "Acceptation", "Écoute"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Histoire avec AAAAAH", groupe: "Gérer l'instable et l'obstacle", summary: "Par 2, un joueur raconte une histoire le plus vite possible jusqu'à être bloqué et dire \"AAAAAH\". Variante à 3 : histoire phrase par phrase, on recommence à chaque blocage.", level: "Confirmé", objectives: ["Imprévu", "Acceptation", "Écoute"], players: 2, duration: 10, energy: "Modérée", material: "Aucun", format: "En groupe simultané" },
  { title: "Scène avec AAAAAH", groupe: "Gérer l'instable et l'obstacle", summary: "Une scène à 2 se joue jusqu'à ce qu'un joueur ressente un \"AAAAAH\".", level: "Avancé", objectives: ["Imprévu", "Acceptation", "Écoute"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Gérer le AAAAAH", groupe: "Gérer l'instable et l'obstacle", summary: "Trois façons de réagir au \"AAAAAH\" en scène : répéter, faire silence, ou remarquer.", level: "Avancé", objectives: ["Imprévu", "Acceptation", "Écoute", "Silence"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Provoquer le AAAAAH", groupe: "Gérer l'instable et l'obstacle", summary: "Scène à 2 où A multiplie les propositions fortes voire absurdes pour provoquer un \"AAAAAH\" chez B.", level: "Avancé", objectives: ["Imprévu", "Acceptation", "Écoute", "Silence"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Demander une faveur", groupe: "Gérer l'instable et l'obstacle", summary: "A demande une faveur à B qui résiste ; A doit argumenter et expliquer la raison de sa demande.", level: "Confirmé", objectives: ["Imprévu", "Acceptation", "Écoute", "Jeu de la scène"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Le brevet", groupe: "Gérer l'instable et l'obstacle", summary: "A veut faire enregistrer le brevet d'une invention inédite auprès de B, responsable réticent ; A doit argumenter l'intérêt de son invention.", level: "Confirmé", objectives: ["Imprévu", "Acceptation", "Écoute", "Personnages", "Jeu de la scène"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Bonne raison de boire", groupe: "Gérer l'instable et l'obstacle", summary: "Sur un comptoir de bar, A (client) veut s'enivrer et B (barman) l'aide à dérouler sa \"bonne raison\" de boire.", level: "Confirmé", objectives: ["Imprévu", "Acceptation", "Écoute", "Personnages", "Lieux", "Jeu de la scène"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Acceptation physique", groupe: "Comédie du jeu de la scène", summary: "A propose un lieu, une activité ou un environnement, et B accepte physiquement la proposition. Variante avec \"Oui et\" : ajouter des éléments sans revenir sur le passé, le futur ou d'autres personnes.", level: "Confirmé", objectives: ["Plateforme", "Lieux", "Personnages", "Acceptation", "Jeu de la scène"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Plate-forme crédible", groupe: "Comédie du jeu de la scène", summary: "A et B sont eux-mêmes sur scène et discutent ; C arrête la scène dès qu'il sent qu'ils \"jouent\" plutôt que d'être naturels, on en discute puis on continue. Variantes : plateforme ou personnages archétypaux donnés.", level: "Avancé", objectives: ["Plateforme", "Lieux", "Personnages", "Acceptation", "Jeu de la scène", "Jouer juste"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Le flash", groupe: "Comédie du jeu de la scène", summary: "A a un thème et dit une phrase ; B répond \"ça me fait penser à...\" en identifiant ce qui est intéressant dans l'idée et l'utilise pour répondre, puis A fait de même.", level: "Confirmé", objectives: ["Plateforme", "Écoute", "Jeu de la scène", "Acceptation"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Repérer le jeu", groupe: "Comédie du jeu de la scène", summary: "2 joueurs installent le qui-quoi-où pendant que le groupe observe et lève la main dès qu'un élément inhabituel apparaît ; l'élément est ensuite répété plusieurs fois par les deux joueurs avant d'être exploité pour créer un motif de jeu.", level: "Avancé", objectives: ["Plateforme", "Écoute", "Jeu de la scène", "Acceptation"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Refaire un sketch", groupe: "Comédie du jeu de la scène", summary: "Analyser des sketchs connus pour en dégager le jeu de scène (en 6 mots maximum si possible), puis le rejouer dans une situation différente.", level: "Confirmé", objectives: ["Plateforme", "Jeu de la scène"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Anecdote", groupe: "Comédie du jeu de la scène", summary: "Un joueur raconte une anecdote inspirée d'un thème ; les autres identifient les éléments intéressants qui pourraient devenir des jeux de scène.", level: "Confirmé", objectives: ["Jeu de la scène", "Cercle", "Lieux", "Plateforme"], players: 0, duration: 10, energy: "Faible", material: "Aucun", format: "En cercle" },
  { title: "Jeu de scène avec association d'idées", groupe: "Comédie du jeu de la scène", summary: "À partir d'un mot du public, on enchaîne des associations d'idées drôles ou enrichissantes (13 à 20 mots) avant de revenir au mot initial, sur 3 cycles.", level: "Confirmé", objectives: ["Jeu de la scène", "Cercle"], players: 0, duration: 10, energy: "Faible", material: "Aucun", format: "En cercle" },
  { title: "Invocation", groupe: "Comédie du jeu de la scène", summary: "À partir d'un objet donné par le public, les joueurs disent chacun leur tour \"C'EST\" (description), puis \"TU ES\" (personnifié), \"VOUS ÊTES\" (déifié, voix grandiloquente) et enfin \"JE SUIS\" en résumant à l'essentiel, jusqu'à un \"JE SUIS L'OBJET\" collectif final.", level: "Avancé", objectives: ["Jeu de la scène", "Cercle", "Objet"], players: 0, duration: 10, energy: "Faible", material: "Aucun", format: "En cercle" },
  { title: "Backline", groupe: "Comédie du jeu de la scène", summary: "2 joueurs installent le qui-quoi-où jusqu'à trouver le premier élément inhabituel qui lance le jeu ; les joueurs en réserve peuvent ensuite entrer par deux (tag out) pour élever le jeu.", level: "Avancé", objectives: ["Jeu de la scène", "Plateforme"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Action / Détails / Émotions", groupe: "Sentir ce qui manque", summary: "En groupe de 4, un joueur \"directeur de scène\" distribue la parole aux 3 autres selon les besoins de l'histoire : Action (donner des actions), Détails (lieu, personnage) ou Émotions (ressenti du personnage). Variante à 2 joueurs dirigés.", level: "Avancé", objectives: ["Jeu de la scène", "Imprévu", "Émotions", "Personnages", "Lieux", "Objet", "Mime"], players: 4, duration: 12, energy: "Faible", material: "Aucun", format: "En groupe simultané" },
  { title: "Relier 2 phrases", groupe: "Match et caucus", summary: "2 lignes face à face ; chaque premier prépare une phrase, A et B se rejoignent, disent leur phrase puis A doit en trouver une pour relier les deux avant que B conclue.", level: "Confirmé", objectives: ["Caucus", "Écoute", "Observation", "Acceptation", "Match"], players: 0, duration: 10, energy: "Modérée", material: "Aucun", format: "En groupe simultané" },
  { title: "Démarches de perso (en marche)", groupe: "Travail des univers", summary: "En déambulation, le groupe adopte la posture et la démarche de personnages donnés par le coach, avec rire, respiration et une phrase caractéristiques, en alternant avec une démarche neutre au clap.", level: "Confirmé", objectives: ["Univers", "Personnages", "Posture", "Déambulation"], players: 0, duration: 10, energy: "Forte", material: "Aucun", format: "Déambulation" },
  { title: "Brainstorm univers", groupe: "Travail des univers", summary: "Le groupe donne collectivement tous les éléments qu'on trouve dans un univers choisi. Variante individuelle : chaque joueur a 10 secondes pour son propre univers.", level: "Confirmé", objectives: ["Univers", "Personnages", "Cercle", "Imagination", "Lieux", "Plateforme", "Objet"], players: 0, duration: 10, energy: "Forte", material: "Aucun", format: "En cercle" },
  { title: "Ça fait 8 choses (univers)", groupe: "Travail des univers", summary: "En cercle, chacun son tour un joueur donne 8 éléments tirés d'un univers donné, comptés en chœur jusqu'à \"ça fait 8 choses !\".", level: "Confirmé", objectives: ["Univers", "Personnages", "Imagination", "Lieux", "Objet"], players: 0, duration: 10, energy: "Forte", material: "Aucun", format: "En cercle" },
  { title: "Univers secret", groupe: "Travail des univers", summary: "2-3 joueurs reçoivent chacun un univers en secret et jouent un personnage qui en est issu, sur une plateforme simple (arrêt de bus, café, date...).", level: "Confirmé", objectives: ["Univers", "Personnages", "Imagination"], players: 2, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Univers en expansion", groupe: "Impro longue", summary: "Les joueurs jouent une première scène courte puis la rejouent en doublant sa durée.", level: "Confirmé", objectives: ["impro longue", "rythme"], players: 3, duration: 10, energy: "Faible", material: "Aucun", format: "Tour à tour avec spectateur" },
  { title: "Cricri Cracra", groupe: "Vocal", summary: "Le leader chante et fait la chorégraphie, la troupe reprend en chœur.", level: "Confirmé", objectives: ["Voix", "Corps", "Musique"], players: 0, duration: 5, energy: "Forte", material: "Aucun", format: "Solo simultané", warmup: true, dualUse: true },
  { title: "Clap-Bouge-Chante", groupe: "Cercle", summary: "Cercle de claps effectué en même temps, puis en se déplaçant dans l'espace, puis en chantant tous ensemble une chanson connue.", level: "Débutant", objectives: ["Cercle", "Énergie", "Concentration", "Musique"], players: 0, duration: 5, energy: "Forte", material: "Aucun", format: "En cercle", warmup: true, dualUse: true },
  { title: "Chef d'orchestre", groupe: "Vocal", summary: "Les participants sont divisés en groupes qui choisissent un son. Le chef d'orchestre peut allumer/éteindre, augmenter/diminuer ou lancer un solo.", level: "Avancé", objectives: ["Voix", "Rythme"], players: 0, duration: 5, energy: "Faible", material: "Aucun", format: "Solo simultané", dualUse: true },
  { title: "Et si dieu était...", groupe: "Vocal", summary: "Une personne chante \"et si dieu était XXX\" puis tout le monde chante \"Hallelujah\" ; la personne suivante du cercle finit la phrase en rimant si possible, et tout le monde reprend \"Hallelujah\".", level: "Débutant", objectives: ["Voix", "Rythme", "Imagination", "Musique"], players: 0, duration: 4, energy: "Modérée", material: "Aucun", format: "En cercle", dualUse: true },
  { title: "Solo danseur", groupe: "Physique", summary: "Tout le monde danse timidement. Quand le prof appelle un prénom, les autres s'arrêtent et regardent la personne danser, qui prend alors de l'assurance et danse plus fort, avant que tout le monde ne se remette à danser progressivement.", level: "Débutant", objectives: ["Physique", "Danse", "Cohésion", "Musique"], players: 0, duration: 4, energy: "Forte", material: "Musique", format: "Tour à tour avec spectateur", warmup: true, dualUse: true },
].map((e) => ({ id: uid(), warmup: false, application: false, showTypes: [], phase: "Impro", ...e }));

function mergeDetailedCategories(data) {
  if (data._categoriesDetailV1) return data;
  let categories = [...data.categories];
  for (const detail of CATEGORIES_DETAILLEES) {
    const targetNorm = detail.name.toLowerCase();
    let idx = categories.findIndex((c) => c.name.toLowerCase() === targetNorm);
    if (idx === -1) {
      idx = categories.findIndex((c) => RENOMMAGES_CATEGORIES_DETAIL[c.name.toLowerCase()] === detail.name);
    }
    if (idx >= 0) {
      categories[idx] = {
        ...categories[idx],
        ...detail,
        id: categories[idx].id,
        thematiques: categories[idx].thematiques,
        archetypes: categories[idx].archetypes,
        rules: categories[idx].rules,
      };
    } else {
      categories.push({ id: uid(), thematiques: [], archetypes: [], rules: "", ...detail });
    }
  }
  return { ...data, categories, _categoriesDetailV1: true };
}

function mergeMissingCategories(data) {
  const existingNames = new Set(data.categories.map((c) => c.name));
  const toAdd = CATEGORIES_A_FUSIONNER.filter((c) => !existingNames.has(c.name));
  let categories = data.categories;
  if (toAdd.length > 0) categories = [...data.categories, ...toAdd];

  let showTypes = data.showTypes;
  if (showTypes?.includes("Longue forme")) {
    showTypes = showTypes.map((t) => (t === "Longue forme" ? "Format long" : t));
  }
  if (showTypes?.includes("Cabaret") && showTypes[0] !== "Cabaret") {
    showTypes = ["Cabaret", ...showTypes.filter((t) => t !== "Cabaret")];
  }
  let showConcepts = data.showConcepts;
  if (showConcepts?.some((sc) => sc.type === "Longue forme")) {
    showConcepts = showConcepts.map((sc) => (sc.type === "Longue forme" ? { ...sc, type: "Format long" } : sc));
  }
  let exercises = data.exercises;
  if (exercises?.some((e) => e.showTypes?.includes("Longue forme"))) {
    exercises = exercises.map((e) =>
      e.showTypes?.includes("Longue forme")
        ? { ...e, showTypes: e.showTypes.map((t) => (t === "Longue forme" ? "Format long" : t)) }
        : e
    );
  }
  if (exercises?.some((e) => e.title?.includes("(exemple)"))) {
    exercises = exercises.filter((e) => !e.title?.includes("(exemple)"));
  }
  const existingExerciseTitles = new Set((exercises || []).map((e) => e.title));
  const exercisesToAdd = [...EXERCICES_ECHAUFFEMENT, ...EXERCICES_PRE_IMPRO, ...EXERCICES_IMPRO].filter((e) => !existingExerciseTitles.has(e.title));
  if (exercisesToAdd.length > 0) exercises = [...(exercises || []), ...exercisesToAdd];
  if (exercises?.some((e) => !e.phase)) {
    exercises = exercises.map((e) => (e.phase ? e : { ...e, phase: e.warmup ? "Échauffement" : "Impro" }));
  }
  if (exercises?.some((e) => e.phase === "Échauffement" && e.application)) {
    exercises = exercises.map((e) => (e.phase === "Échauffement" && e.application ? { ...e, application: false } : e));
  }

  let objectifs = data.objectifs;
  if (objectifs) {
    const missingObjectifs = ["Écoute", "Acceptation", "Confiance", "Cohésion", "Personnages", "Émotions", "Corps", "Voix", "Narration", "Préparation spectacle", "Relaxation", "Déconnexion", "Prénom", "Jeu", "Physique", "Danse", "Rythme", "Mémoire", "Imagination", "Mime", "Concentration", "Énergie", "Cercle", "Lâcher-prise", "Observation", "Déambulation", "Lieux", "Univers", "Enjeux", "Objet", "Entrées/Sorties", "Engagement", "Relation", "Posture", "Argumentation", "Créativité", "Spontanéité", "Plateforme", "Sensations", "Contact", "Complicité", "Jouer juste", "Silence", "Masque", "Clown", "Statut", "Imitation", "Adaptation", "Regard", "Imprévu", "Jeu de la scène", "Caucus", "Match", "Téléréalité", "Musique"].filter((o) => !objectifs.includes(o));
    if (missingObjectifs.length > 0) objectifs = [...objectifs, ...missingObjectifs];
  }

  // Fusion des anciens "thèmes" et "ambiances" (catégories + exercices) en une seule liste "thématiques".
  let thematiques = data.thematiques;
  if (!thematiques) {
    thematiques = [...new Set([...(data.themes || []), ...(data.ambiances || [])])];
  }
  const missingThematiques = ["Cinéma", "Vacances"].filter((t) => !thematiques.includes(t));
  if (missingThematiques.length > 0) thematiques = [...thematiques, ...missingThematiques];

  if (categories?.some((c) => c.themes !== undefined || c.ambiances !== undefined)) {
    categories = categories.map((c) => {
      if (c.themes === undefined && c.ambiances === undefined) return c;
      const { themes: ct, ambiances: ca, ...rest } = c;
      return { ...rest, thematiques: [...new Set([...(ct || []), ...(ca || [])])] };
    });
  }
  if (exercises?.some((e) => e.themes !== undefined || e.thematiques === undefined)) {
    exercises = exercises.map((e) => {
      if (e.thematiques !== undefined) return e;
      const { themes: et, ...rest } = e;
      return { ...rest, thematiques: et || [] };
    });
  }

  // Favoris + "créé par l'utilisateur" (par défaut false pour tout le contenu déjà présent).
  if (categories?.some((c) => c.favorite === undefined || c.createdByUser === undefined || c.tags === undefined)) {
    categories = categories.map((c) => ({ favorite: false, createdByUser: false, tags: [], ...c }));
  }
  if (exercises?.some((e) => e.favorite === undefined || e.createdByUser === undefined)) {
    exercises = exercises.map((e) => ({ favorite: false, createdByUser: false, ...e }));
  }

  // L'Ambassadeur se joue en petits groupes simultanés, pas en tour à tour avec le reste
  // en public : on corrige le format pour ne plus compter de temps d'attente.
  if (exercises?.some((e) => e.title === "Ambassadeur" && e.format === "Tour à tour avec spectateur")) {
    exercises = exercises.map((e) => (e.title === "Ambassadeur" ? { ...e, format: "En groupe simultané" } : e));
  }

  // Coche le format "Déambulation" sur tous les exercices/échauffements tagués "Déambulation".
  if (exercises?.some((e) => e.objectives?.includes("Déambulation") && e.format !== "Déambulation")) {
    exercises = exercises.map((e) => (e.objectives?.includes("Déambulation") ? { ...e, format: "Déambulation" } : e));
  }

  // Si une fiche porte un tag qui n'existe pas encore dans la liste globale des objectifs (ex.
  // créé à la volée depuis le champ "Tags" d'une fiche), on l'y ajoute automatiquement pour qu'il
  // devienne un tag réutilisable partout dans l'appli.
  if (exercises) {
    const knownObjectifs = new Set(objectifs || []);
    const newTags = [];
    exercises.forEach((e) => (e.objectives || []).forEach((tag) => {
      if (!knownObjectifs.has(tag) && !newTags.includes(tag)) newTags.push(tag);
    }));
    if (newTags.length > 0) objectifs = [...(objectifs || []), ...newTags];
  }

  // Ajoute une seule fois le tag "Cercle" aux échauffements qui mentionnent "cercle" dans leur
  // titre/description, pour les données déjà enregistrées (ne se réexécute plus ensuite, pour
  // ne pas revenir sur un retrait manuel du tag par la suite).
  let cercleTagV1 = data._cercleTagV1;
  if (!cercleTagV1 && exercises) {
    exercises = exercises.map((e) => {
      const text = `${e.title || ""} ${e.summary || ""}`.toLowerCase();
      if (text.includes("cercle") && !(e.objectives || []).includes("Cercle")) {
        return { ...e, objectives: ["Cercle"] };
      }
      return e;
    });
    cercleTagV1 = true;
  }

  // Ajoute une seule fois le tag "Musique" aux exercices/échauffements qui mentionnent "danse",
  // "chant" ou "musique", ou dont le matériel requiert de la musique.
  let musiqueTagV1 = data._musiqueTagV1;
  if (!musiqueTagV1 && exercises) {
    exercises = exercises.map((e) => {
      const text = normalize(`${e.title || ""} ${e.summary || ""}`);
      const materialText = normalize(e.material || "");
      const match = text.includes("danse") || text.includes("chant") || text.includes("musique") || materialText.includes("musique");
      if (match && !(e.objectives || []).includes("Musique")) {
        return { ...e, objectives: ["Musique"] };
      }
      return e;
    });
    musiqueTagV1 = true;
  }

  // Ajoute une seule fois "Musique" comme matériel aux catégories déjà taguées "Musique" qui n'ont
  // pas encore de matériel renseigné (ex. "Muette sur fond musical" nécessite de la musique) — ne se
  // réexécute plus ensuite, pour ne pas revenir sur un retrait manuel du matériel par la suite.
  let materialMusiqueV1 = data._materialMusiqueV1;
  if (!materialMusiqueV1 && categories) {
    categories = categories.map((c) => {
      if ((c.objectives || []).some((o) => o.toLowerCase() === "musique") && !c.material) {
        return { ...c, material: "Musique" };
      }
      return c;
    });
    materialMusiqueV1 = true;
  }

  // Fusionne une seule fois les tags identiques à la casse/accents près (ex. "Écoute"/"écoute"/
  // "ecoute") en une seule forme canonique : priorité à la forme déjà présente dans la liste globale
  // des tags, sinon à la variante accentuée (capitalisée). Ne se réexécute plus ensuite, pour ne pas
  // revenir sur un renommage manuel ultérieur.
  let tagCaseAccentMergeV1 = data._tagCaseAccentMergeV1;
  if (!tagCaseAccentMergeV1) {
    const hasAccent = (s) => /[àâäéèêëïîôöùûüÿçÀÂÄÉÈÊËÏÎÔÖÙÛÜŸÇ]/.test(s || "");
    const allTags = new Set();
    (objectifs || []).forEach((t) => allTags.add(t));
    (exercises || []).forEach((e) => (e.objectives || []).forEach((t) => allTags.add(t)));
    (categories || []).forEach((c) => (c.objectives || []).forEach((t) => allTags.add(t)));

    const groups = {};
    allTags.forEach((t) => { const n = normalize(t); (groups[n] = groups[n] || []).push(t); });

    const objectifsSet = new Set(objectifs || []);
    const canonicalOf = {};
    Object.values(groups).forEach((variants) => {
      if (variants.length < 2) { canonicalOf[variants[0]] = variants[0]; return; }
      const inMaster = variants.find((v) => objectifsSet.has(v));
      const chosen = inMaster || (() => {
        const accented = variants.find((v) => hasAccent(v)) || variants[0];
        return accented.charAt(0).toUpperCase() + accented.slice(1);
      })();
      variants.forEach((v) => { canonicalOf[v] = chosen; });
    });

    if (objectifs) objectifs = [...new Set(objectifs.map((t) => canonicalOf[t] || t))];
    if (exercises) {
      exercises = exercises.map((e) => {
        if (!e.objectives || e.objectives.length === 0) return e;
        const mapped = [...new Set(e.objectives.map((t) => canonicalOf[t] || t))];
        if (mapped.length === e.objectives.length && mapped.every((t, i) => t === e.objectives[i])) return e;
        return { ...e, objectives: mapped };
      });
    }
    if (categories) {
      categories = categories.map((c) => {
        if (!c.objectives || c.objectives.length === 0) return c;
        const mapped = [...new Set(c.objectives.map((t) => canonicalOf[t] || t))];
        if (mapped.length === c.objectives.length && mapped.every((t, i) => t === c.objectives[i])) return c;
        return { ...c, objectives: mapped };
      });
    }
    tagCaseAccentMergeV1 = true;
  }

  // Marque une seule fois la fiche "Machine" comme utilisable en échauffement et éligible comme
  // échauffement de scène pour ouvrir un spectacle — ne se réexécute plus ensuite, pour ne pas
  // revenir sur un décochage manuel ultérieur.
  let stageWarmupMachineV1 = data._stageWarmupMachineV1;
  if (!stageWarmupMachineV1 && exercises) {
    exercises = exercises.map((e) =>
      e.title === "Machine" && !e.stageWarmup ? { ...e, warmup: true, stageWarmup: true } : e
    );
    stageWarmupMachineV1 = true;
  }

  // Idem pour "Course au ralenti + public" et "Bataille au ralenti".
  const STAGE_WARMUP_BATCH2 = ["Course au ralenti + public", "Bataille au ralenti"];
  let stageWarmupBatch2V1 = data._stageWarmupBatch2V1;
  if (!stageWarmupBatch2V1 && exercises) {
    exercises = exercises.map((e) =>
      STAGE_WARMUP_BATCH2.includes(e.title) && !e.stageWarmup ? { ...e, warmup: true, stageWarmup: true } : e
    );
    stageWarmupBatch2V1 = true;
  }

  // Corrige une seule fois l'énergie de la fiche "Devinettes" (Modérée → Forte) — ne se réexécute
  // plus ensuite, pour ne pas revenir sur une modification manuelle ultérieure.
  let devinettesEnergyV1 = data._devinettesEnergyV1;
  if (!devinettesEnergyV1 && exercises) {
    exercises = exercises.map((e) =>
      e.title === "Devinettes" && e.energy !== "Forte" ? { ...e, energy: "Forte" } : e
    );
    devinettesEnergyV1 = true;
  }

  // Marque une seule fois les catégories adaptées pour ouvrir un spectacle (Libre, Mitraillette,
  // Point de vue, Univers Action/Aventure/Soap opera/Fantasy, Je remake mal / J'imite mal,
  // Schizophrenia / Un pour tous) — ne se réexécute plus ensuite, pour ne pas revenir sur un
  // décochage manuel ultérieur.
  const CAN_OPEN_SHOW_DEFAULTS = ["Libre", "Mitraillette", "Point de vue", "Action", "Aventure", "Soap opera", "Fantasy", "Je remake mal / J'imite mal", "Schizophrenia / Un pour tous"];
  let canOpenShowDefaultsV1 = data._canOpenShowDefaultsV1;
  if (!canOpenShowDefaultsV1 && categories) {
    categories = categories.map((c) =>
      CAN_OPEN_SHOW_DEFAULTS.includes(c.name) && !c.canOpenShow ? { ...c, canOpenShow: true } : c
    );
    canOpenShowDefaultsV1 = true;
  }

  // Marque une seule fois les catégories adaptées pour terminer un spectacle (Petits papier,
  // Triathlon, Voyage dans le temps, Cyclothymique, Carré hollandais, Show me that, Flashback,
  // Zapping / Videowave / Scroll, Toaster, Ça mérite une chanson, Comédie musicale, Best-of) — ne
  // se réexécute plus ensuite, pour ne pas revenir sur un décochage manuel ultérieur.
  const CAN_CLOSE_SHOW_DEFAULTS = ["Petits papier", "Triathlon", "Voyage dans le temps", "Cyclothymique", "Carré hollandais", "Show me that", "Flashback", "Zapping / Videowave / Scroll", "Toaster", "Ça mérite une chanson", "Comédie musicale", "Best-of"];
  let canCloseShowDefaultsV1 = data._canCloseShowDefaultsV1;
  if (!canCloseShowDefaultsV1 && categories) {
    categories = categories.map((c) =>
      CAN_CLOSE_SHOW_DEFAULTS.includes(c.name) && !c.canCloseShow ? { ...c, canCloseShow: true } : c
    );
    canCloseShowDefaultsV1 = true;
  }

  // Marque une seule fois des lieux évocateurs pour chaque catégorie "Univers" (page Générer des
  // idées, onglet Univers, bouton "Lieux") — ne se réexécute plus ensuite, pour ne pas revenir sur
  // une modification manuelle ultérieure.
  const UNIVERS_LIEUX = {
    "Science-Fiction": ["Vaisseau spatial", "Station orbitale", "Exoplanète colonisée", "Laboratoire secret", "Métropole futuriste", "Zone de quarantaine", "Colonie extraterrestre", "Bunker post-apocalyptique"],
    "Western": ["Saloon", "Ranch", "Diligence", "Mine d'or", "Cimetière", "Gare", "Chantier du chemin de fer", "Terres sacrées indiennes"],
    "Fantasy": ["Château fort", "Forêt enchantée", "Donjon", "Montagne sacrée", "Royaume oublié", "Taverne du village", "Tour du sorcier", "Rivière ensorcelée"],
    "Tragédie": ["Temple des dieux", "Palais royal", "Oracle de Delphes", "L'Olympe", "Amphithéâtre", "Thermes", "Oppidum", "Terres d'exil"],
    "Polar": ["Planque", "Morgue", "Poste de police", "Ruelle sombre", "Bar interlope", "Scène de crime", "Bureau du détective", "Terrain vague"],
    "Gangster": ["Bar clandestin", "Quartier mal famé", "Bureau enfumé", "Planque", "Casino", "Arrière-boutique", "Restaurant italien", "Entrepôt du port"],
    "Horreur": ["Maison hantée", "Maison abandonnée", "Caverne", "Île déserte", "Jungle", "Cimetière", "Forêt sombre", "Sous-sol"],
    "Comédie": ["Théâtre", "Piste de cirque", "Salon familial", "Bureau", "Café du coin", "Appartement partagé", "Fête entre amis"],
    "Commedia dell'arte": ["Place du village", "Maison du maître", "Marché", "Taverne", "Balcon", "Jardin", "Auberge"],
    "Comédie romantique": ["Café de rendez-vous", "Librairie", "Restaurant", "Aéroport", "Appartement", "Parc", "Rooftop", "Salle de mariage"],
    "Comédie musicale": ["Café de rendez-vous", "Librairie", "Restaurant", "Aéroport", "Appartement", "Parc", "Rooftop", "Salle de mariage"],
    "Drame": ["Prison", "Tribunal", "Chambre d'hôpital", "Cuisine familiale", "Cimetière", "Salle d'attente", "Appartement modeste", "Couloir du tribunal"],
    "Histoire et sociétés": ["Grotte préhistorique", "Pyramides d'Égypte", "Colisée romain", "Château fort médiéval", "Village viking", "Palais de Versailles", "Bastille", "Cabaret des Années folles"],
    "Aventure": ["Jungle", "Désert", "Cité perdue", "Volcan", "Sommet montagneux", "Abysses", "Temple englouti", "Grotte au trésor"],
    "Action": ["Toit d'immeuble", "Entrepôt", "Banque", "Autoroute", "Base secrète", "Aéroport", "Ruelle"],
    "Guerre": ["Tranchée", "Blockhaus", "État-major", "Champ de bataille", "Camp militaire", "Hôpital de campagne", "Village en ruines"],
    "Sports": ["Stade", "Vestiaire", "Terrain d'entraînement", "Ring de boxe", "Piste", "Tribune", "Podium"],
    "Soap opera": ["Ranch familial", "Manoir", "Hôpital", "Salle de tribunal", "Réception de mariage", "Bureau du patriarche", "Piscine", "Salon cocktail"],
    "Télé-réalité": ["Villa télé-réalité", "Confessionnal", "Plateau télé", "Piscine", "Cuisine commune", "Chambre partagée", "Salle du prime"],
    "Cape et Épée": ["Palais royal", "Cour du roi", "Jardins du château", "Auberge", "Antichambre", "Caserne des mousquetaires", "Salle d'armes", "Ruelle au clair de lune"],
    "Péplum": ["Arènes", "Sénat", "Temple", "Thermes", "Forum", "Galère", "Palais impérial", "Colisée"],
    "Espionnage": ["Quartier général", "Ambassade", "Aéroport international", "Planque", "Salle d'interrogatoire", "Casino", "Poste-frontière", "Laboratoire secret"],
    "Arts martiaux": ["Dojo", "Temple", "École rivale", "Arène du tournoi", "Montagne d'entraînement", "Jardin zen", "Salle des maîtres"],
    "Super-héros": ["Gratte-ciel", "Toit d'immeuble", "Ruelle sombre", "Laboratoire secret", "Quartier général des héros", "Centre-ville en ruines", "Base secrète du vilain"],
    "Vaudeville": ["Appartement bourgeois", "Placard", "Chambre à baldaquin", "Jardinet", "Salon", "Couloir aux portes multiples", "Dépendances", "Cabinet de toilette"],
    "Dessin animé": ["Forêt enchantée", "Royaume magique", "Maison familiale", "École", "Île mystérieuse", "Village coloré", "Grotte magique"],
    "Pirate": ["Navire pirate", "Île au trésor", "Taverne du port", "Cale du navire", "Crique cachée", "Épave", "Grotte au trésor", "Quai du port"],
    "Contes et légendes": ["Chaumière", "Château enchanté", "Forêt profonde", "Royaume lointain", "Carrosse", "Tour de la sorcière", "Puits magique", "Clairière"],
    "Sitcom": ["Appartement partagé", "Cafétéria", "Bureau", "Cuisine familiale", "Bar du quartier", "Canapé du salon", "Couloir de bureau"],
  };
  let universLieuxV1 = data._universLieuxV1;
  if (!universLieuxV1 && categories) {
    categories = categories.map((c) =>
      UNIVERS_LIEUX[c.name] && !c.lieux ? { ...c, lieux: UNIVERS_LIEUX[c.name] } : c
    );
    universLieuxV1 = true;
  }

  // Corrige une seule fois les lieux de "Comédie musicale" pour qu'ils correspondent à ceux de
  // "Comédie romantique" (au lieu des lieux d'origine déjà enregistrés) — ne se réexécute plus
  // ensuite, pour ne pas revenir sur une modification manuelle ultérieure.
  let comedieMusicaleLieuxV1 = data._comedieMusicaleLieuxV1;
  if (!comedieMusicaleLieuxV1 && categories) {
    categories = categories.map((c) =>
      c.name === "Comédie musicale" ? { ...c, lieux: UNIVERS_LIEUX["Comédie musicale"] } : c
    );
    comedieMusicaleLieuxV1 = true;
  }

  // Remplace une seule fois les archétypes de personnages des catégories "Univers" Action (vide à
  // l'origine) et Comédie musicale (anciens archétypes génériques) — ne se réexécute plus ensuite,
  // pour ne pas revenir sur une modification manuelle ultérieure.
  const UNIVERS_ARCHETYPES_V2 = {
    "Action": [
      { id: "a12f5c3e", name: "Le protecteur aux nerfs d'acier", desc: "Ancien agent aux compétences redoutables, prêt à tout pour retrouver et sauver un proche kidnappé." },
      { id: "d84e91b7", name: "Le fugitif traqué à tort", desc: "Accusé injustement d'un crime qu'il n'a pas commis, il fuit la police tout en cherchant le vrai coupable." },
      { id: "6b3a70f4", name: "Le limier increvable", desc: "Enquêteur ou marshal acharné, ne renonce jamais à sa traque, même face au doute sur la culpabilité de sa cible." },
      { id: "f2c8de55", name: "L'ennemi juré", desc: "Héros et méchant prennent littéralement l'identité l'un de l'autre, brouillant la frontière entre le bien et le mal." },
      { id: "39a6b1c0", name: "Le flic solitaire aux méthodes radicales", desc: "Policier qui enfreint les règles pour démanteler un réseau criminel, souvent seul contre tous." },
      { id: "7e04fd2a", name: "Le parrain du crime organisé", desc: "Chef charismatique et impitoyable d'un réseau de trafic ou de gangsters." },
      { id: "c95b3e81", name: "L'homme (ou la femme) ordinaire pris dans l'extraordinaire", desc: "Civil propulsé malgré lui dans une situation de danger extrême, doit improviser pour survivre." },
    ],
    "Comédie musicale": [
      { id: "1d5f8a3c", name: "L'ingénue romantique", desc: "Héroïne pure et pleine d'espoir, exprime ses sentiments en chanson dès qu'elle est seule." },
      { id: "8e2b4f70", name: "Le héros au grand cœur", desc: "Personnage principal charismatique, souvent d'origine modeste, qui chante ses rêves et ses doutes." },
      { id: "b60a9d3e", name: "La diva", desc: "Star capricieuse et flamboyante, exige d'être au centre de chaque numéro, rivale jalouse de l'ingénue." },
      { id: "4f7c1e85", name: "Le meilleur ami comique", desc: "Anime les scènes de groupe, apporte l'humour et lance souvent le numéro de danse." },
      { id: "9a3d6b21", name: "Le méchant charismatique", desc: "Antagoniste élégant et théâtral, possède son propre grand numéro de chant." },
      { id: "2c8f5e94", name: "Le mentor bienveillant", desc: "Guide expérimenté (professeur de danse, imprésario, figure parentale) qui pousse le héros à se révéler." },
    ],
  };
  let universArchetypesV2 = data._universArchetypesV2;
  if (!universArchetypesV2 && categories) {
    categories = categories.map((c) =>
      UNIVERS_ARCHETYPES_V2[c.name] ? { ...c, archetypes: UNIVERS_ARCHETYPES_V2[c.name] } : c
    );
    universArchetypesV2 = true;
  }

  // Ajoute une seule fois des archétypes de personnages pour les catégories "Univers" qui n'en
  // avaient aucun ou un seul (Drame, Soap opera, Sitcom, Histoire et sociétés) — ne se réexécute
  // plus ensuite, pour ne pas revenir sur une modification manuelle ultérieure.
  const UNIVERS_ARCHETYPES_V3 = {
    "Drame": [
      { id: "6d1a8f52", name: "Le héros tourmenté", desc: "Rongé par un dilemme moral ou un secret, il est en quête de rédemption." },
      { id: "b47e0c93", name: "La victime", desc: "Subit l'injustice, la maladie ou la violence ; catalyseur de l'empathie du récit." },
      { id: "1f9c3d76", name: "Le membre de la famille dysfonctionnelle", desc: "Porteur de non-dits, de rancunes ou de secrets enfouis depuis longtemps." },
      { id: "e582a6f1", name: "La figure d'autorité juridique ou carcérale", desc: "Juge, avocat, gardien de prison ; incarne le système et ses failles." },
      { id: "3c7b4e08", name: "Le confident", desc: "Psychologue, ami proche ou aumônier ; recueille les aveux et pousse à la vérité." },
      { id: "a960f2d4", name: "L'antagoniste ordinaire", desc: "Pas un « méchant » classique, mais quelqu'un dont l'égoïsme ou la lâcheté cause la souffrance des autres." },
    ],
    "Soap opera": [
      { id: "0b8e5d21", name: "Le patriarche / la matriarche", desc: "Chef de famille autoritaire, détient fortune et secrets, dicte le destin des autres." },
      { id: "7a3f9c46", name: "Le séducteur / la séductrice", desc: "Charme et manipule pour arriver à ses fins, multiplie conquêtes et trahisons." },
      { id: "d216b8e9", name: "Le manipulateur / la manipulatrice", desc: "Tire les ficelles dans l'ombre, orchestre complots et chantages." },
      { id: "4e9a0f73", name: "L'ex-mari / l'ex-femme", desc: "Resurgit pour raviver un triangle amoureux et déstabiliser le couple en place." },
      { id: "c15d8a62", name: "Le héros loyal", desc: "Personnage droit qui tente de préserver la famille malgré les trahisons autour de lui." },
      { id: "9f2e6b04", name: "Le meilleur ami confident", desc: "Recueille les confidences et sert de témoin aux rebondissements." },
      { id: "5b0c7d18", name: "L'enfant caché / l'héritier surprise", desc: "Révélation choc qui bouleverse l'équilibre familial et l'héritage." },
    ],
    "Sitcom": [
      { id: "f4a1e630", name: "Le groupe d'amis soudé", desc: "Bande aux personnalités bien tranchées qui vit ses petits drames du quotidien ensemble." },
      { id: "8d5c2b97", name: "Le meilleur ami maladroit", desc: "Source de gags et de situations embarrassantes, toujours à côté de la plaque." },
      { id: "2a7f9e40", name: "Le/la coloc ou voisin(e) envahissant(e)", desc: "Imprévisible, avec ses habitudes bizarres, s'incruste sans cesse." },
      { id: "e0b6d381", name: "Le patron / la patronne excentrique", desc: "Figure d'autorité au travail, ridicule ou totalement décalée." },
      { id: "6c9a4f15", name: "Le couple en dents de scie", desc: "Se sépare et se remet ensemble sans cesse, alimente les intrigues amoureuses." },
      { id: "b31e0c58", name: "Le/la rabat-joie rationnel(le)", desc: "Voix de la raison qui sert de contrepoint aux frasques du groupe." },
    ],
    "Histoire et sociétés": [
      { id: "d84c1a97", name: "Le chef / la cheffe", desc: "Roi, pharaon, chef de tribu, seigneur : incarne le pouvoir et la tradition." },
      { id: "0f6e3b52", name: "Le/la sage ou prêtre(sse)", desc: "Gardien(ne) du savoir et des rites, conseille ou prédit l'avenir." },
      { id: "7b9a5d10", name: "Le guerrier / la guerrière", desc: "Protège ou conquiert au nom de son peuple, incarne l'honneur ou la violence de l'époque." },
      { id: "c2508e64", name: "L'étranger / l'explorateur", desc: "Voyageur, marchand ou envahisseur venu d'ailleurs, bouscule les traditions locales." },
      { id: "4a1d7f83", name: "Le/la rebelle", desc: "Refuse l'ordre établi, pousse au changement ou à la révolte (esclave, hérétique, révolutionnaire)." },
      { id: "9e0c6b25", name: "L'artisan / le peuple", desc: "Représente la vie quotidienne, le travail et les coutumes populaires de l'époque." },
    ],
  };
  let universArchetypesV3 = data._universArchetypesV3;
  if (!universArchetypesV3 && categories) {
    categories = categories.map((c) =>
      UNIVERS_ARCHETYPES_V3[c.name] ? { ...c, archetypes: UNIVERS_ARCHETYPES_V3[c.name] } : c
    );
    universArchetypesV3 = true;
  }

  // Ajoute une seule fois un lexique de vocabulaire pour les catégories "Univers" qui n'en avaient
  // pas encore — ne se réexécute plus ensuite, pour ne pas revenir sur une modification manuelle
  // ultérieure.
  const UNIVERS_LEXIQUE_V1 = {
    "Commedia dell'arte": "Masque, Lazzi, Canevas, Zanni, Rusé, Intrigue, Amoureux, Serviteur, Maître, Dot",
    "Histoire et sociétés": "Époque, Coutume, Rituel, Hiérarchie, Conquête, Royaume, Tribu, Cérémonie, Artefact, Légende, Ancêtres, Tradition",
    "Action": "Cible, Mission, Explosif, Embuscade, Filature, Otage, Extraction, Complice, Trahison, Riposte, Sabotage, Compte à rebours",
    "Sports": "Entraînement, Adversaire, Titre, Record, Blessure, Coach, Stratégie, Dépassement de soi, Podium, Supporters, Sacrifice, Revanche",
    "Arts martiaux": "Dojo, Ceinture, Maître, Discipline, Technique, Combat, Honneur, Tournoi, Ki, Méditation, École rivale, Entraînement",
    "Super-héros": "Pouvoir, Identité secrète, Mission, Cape, Repaire, Origine, Némésis, Sauvetage, Catastrophe, Mutation, Justice, Sacrifice",
  };
  let universLexiqueV1 = data._universLexiqueV1;
  if (!universLexiqueV1 && categories) {
    categories = categories.map((c) =>
      UNIVERS_LEXIQUE_V1[c.name] && !c.vocabulaireUnivers
        ? { ...c, vocabulaireUnivers: { lexique: UNIVERS_LEXIQUE_V1[c.name] } }
        : c
    );
    universLexiqueV1 = true;
  }

  // Supprime une seule fois le concept de spectacle "Amour" (fiche vide, sans catégories, retirée à
  // la demande) — ne se réexécute plus ensuite, pour ne pas revenir sur un concept recréé
  // manuellement sous le même nom.
  let removedAmourConceptV1 = data._removedAmourConceptV1;
  if (!removedAmourConceptV1 && showConcepts) {
    showConcepts = showConcepts.filter((sc) => !(sc.theme === "Amour" && (sc.categoryIds || []).length === 0));
    removedAmourConceptV1 = true;
  }

  // Le niveau "Expert" est retiré de l'appli : on convertit les fiches déjà enregistrées vers "Avancé".
  if (exercises?.some((e) => e.level === "Expert")) {
    exercises = exercises.map((e) => (e.level === "Expert" ? { ...e, level: "Avancé" } : e));
  }
  if (categories?.some((c) => c.level === "Expert")) {
    categories = categories.map((c) => (c.level === "Expert" ? { ...c, level: "Avancé" } : c));
  }

  if (
    categories === data.categories &&
    showTypes === data.showTypes &&
    showConcepts === data.showConcepts &&
    exercises === data.exercises &&
    objectifs === data.objectifs &&
    thematiques === data.thematiques &&
    cercleTagV1 === data._cercleTagV1 &&
    musiqueTagV1 === data._musiqueTagV1 &&
    materialMusiqueV1 === data._materialMusiqueV1 &&
    tagCaseAccentMergeV1 === data._tagCaseAccentMergeV1 &&
    stageWarmupMachineV1 === data._stageWarmupMachineV1 &&
    stageWarmupBatch2V1 === data._stageWarmupBatch2V1 &&
    devinettesEnergyV1 === data._devinettesEnergyV1 &&
    canOpenShowDefaultsV1 === data._canOpenShowDefaultsV1 &&
    canCloseShowDefaultsV1 === data._canCloseShowDefaultsV1 &&
    universLieuxV1 === data._universLieuxV1 &&
    comedieMusicaleLieuxV1 === data._comedieMusicaleLieuxV1 &&
    universArchetypesV2 === data._universArchetypesV2 &&
    universArchetypesV3 === data._universArchetypesV3 &&
    universLexiqueV1 === data._universLexiqueV1 &&
    removedAmourConceptV1 === data._removedAmourConceptV1
  ) return data;
  return { ...data, categories, showTypes, showConcepts, exercises, objectifs, thematiques, _cercleTagV1: cercleTagV1, _musiqueTagV1: musiqueTagV1, _materialMusiqueV1: materialMusiqueV1, _tagCaseAccentMergeV1: tagCaseAccentMergeV1, _stageWarmupMachineV1: stageWarmupMachineV1, _stageWarmupBatch2V1: stageWarmupBatch2V1, _devinettesEnergyV1: devinettesEnergyV1, _canOpenShowDefaultsV1: canOpenShowDefaultsV1, _canCloseShowDefaultsV1: canCloseShowDefaultsV1, _universLieuxV1: universLieuxV1, _comedieMusicaleLieuxV1: comedieMusicaleLieuxV1, _universArchetypesV2: universArchetypesV2, _universArchetypesV3: universArchetypesV3, _universLexiqueV1: universLexiqueV1, _removedAmourConceptV1: removedAmourConceptV1 };
}

/* ---------- Persistence ---------- */
function useAppData() {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);
  // Dernière valeur qu'on vient d'envoyer nous-même, pour ignorer l'écho Realtime de notre propre
  // écriture (Supabase Realtime notifie aussi l'auteur du changement).
  const lastSentRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("impro-data");
        if (res && res.value) {
          lastSentRef.current = res.value;
          setData(mergeDetailedCategories(mergeMissingCategories(JSON.parse(res.value))));
        } else {
          setData(mergeDetailedCategories(mergeMissingCategories(SEED)));
        }
      } catch {
        setData(mergeDetailedCategories(mergeMissingCategories(SEED)));
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loaded || !data) return;
    const t = setTimeout(() => {
      const json = JSON.stringify(data);
      lastSentRef.current = json;
      window.storage.set("impro-data", json).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [data, loaded]);

  // Synchronisation temps réel : quand un·e autre membre de la troupe modifie les données, on
  // récupère la nouvelle valeur et on met à jour l'état local (sauf si c'est l'écho de notre propre
  // dernière écriture).
  useEffect(() => {
    if (!loaded) return;
    const channel = supabase
      .channel("app_data-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "app_data", filter: "id=eq.main" },
        (payload) => {
          const incoming = payload.new && payload.new.value;
          if (incoming === undefined) return;
          const incomingJson = JSON.stringify(incoming);
          if (incomingJson === lastSentRef.current) return;
          lastSentRef.current = incomingJson;
          setData(mergeDetailedCategories(mergeMissingCategories(incoming)));
        }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [loaded]);

  return [data, setData, loaded];
}

/* ---------- Small UI atoms ---------- */
function TagPill({ label, color, onRemove }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs mr-1 mb-1"
      style={{ background: color + "22", color, border: `1px solid ${color}55`, fontFamily: FONT_MONO }}
    >
      {label}
      {onRemove && (
        <button onClick={onRemove} className="ml-0.5 opacity-70 hover:opacity-100">
          <X size={11} />
        </button>
      )}
    </span>
  );
}

function IndexCard({ children, style, className = "", onClick }) {
  return (
    <div
      className={`relative rounded-xl p-4 mb-3 ${className}`}
      onClick={onClick}
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.cardEdge}`,
        boxShadow: "0 4px 10px rgba(30,42,56,0.15)",
        ...style,
      }}
    >
      <div
        className="absolute -top-1 left-3 right-3 h-2 opacity-[0.35]"
        style={{
          backgroundImage: `radial-gradient(circle, ${COLORS.ink} 1px, transparent 1.3px)`,
          backgroundSize: "8px 8px",
        }}
      />
      {children}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between mb-4">
      <div>
        <div className="flex items-center gap-2">
          <Icon size={20} color={COLORS.accent} />
          <h2 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="text-2xl font-semibold">
            {title}
          </h2>
        </div>
        {subtitle && (
          <p style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-sm mt-1">
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

function Btn({ children, onClick, variant = "solid", small, type = "button", disabled }) {
  const base = "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm transition disabled:opacity-40";
  const style =
    variant === "solid"
      ? { background: COLORS.ink, color: COLORS.paper }
      : variant === "accent"
      ? { background: COLORS.accent, color: "#fff" }
      : { background: "transparent", color: COLORS.ink, border: `1px solid ${COLORS.ink}55` };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${small ? "text-xs px-2 py-1" : ""}`}
      style={{ fontFamily: FONT_BODY, ...style }}
    >
      {children}
    </button>
  );
}

/* Question Oui/Non avec pastille verte + coche sur le choix sélectionné. */
function OuiNonField({ label, value, onChange }) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        {[{ v: true, l: "Oui" }, { v: false, l: "Non" }].map((o) => {
          const isSelected = value === o.v;
          return (
            <div key={o.l} className="relative">
              <button
                type="button"
                onClick={() => onChange(o.v)}
                className="px-3 py-1 rounded-full text-sm"
                style={{
                  fontFamily: FONT_BODY,
                  background: isSelected ? "#3B6E5E" : "transparent",
                  color: isSelected ? "#fff" : COLORS.ink,
                  border: `1px solid ${isSelected ? "#3B6E5E" : COLORS.accent}`,
                }}
              >
                {o.l}
              </button>
              {isSelected && (
                <span
                  className="absolute flex items-center justify-center rounded-full"
                  style={{ top: -6, right: -6, width: 16, height: 16, background: "#3B6E5E", border: "1px solid #fff" }}
                >
                  <Check size={10} color="#fff" />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Field>
  );
}

function Field({ label, children }) {
  return (
    <label className="block mb-3">
      <span
        className="block text-xs uppercase tracking-wide mb-1"
        style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

const inputStyle = {
  fontFamily: FONT_BODY,
  background: "#fff",
  border: `1px solid ${COLORS.cardEdge}`,
  color: COLORS.text,
};
const inputClass = "w-full rounded-sm px-2 py-1.5 text-sm outline-none focus:ring-2";

/* Champ mot de passe avec un œil cliquable à droite pour basculer entre masqué et affiché en clair. */
function PasswordInput({ value, onChange, onKeyDown, placeholder }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        className={inputClass}
        style={{ ...inputStyle, paddingRight: 34 }}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex items-center px-2"
        tabIndex={-1}
        title={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
      >
        {visible ? <EyeOff size={16} color={COLORS.textSoft} /> : <Eye size={16} color={COLORS.textSoft} />}
      </button>
    </div>
  );
}

function MultiTagPicker({ allOptions, selected, onChange, color = COLORS.brass, placeholder }) {
  const [draft, setDraft] = useState("");
  const add = (val) => {
    const v = val.trim();
    if (!v || selected.includes(v)) return;
    onChange([...selected, v]);
    setDraft("");
  };
  return (
    <div>
      <div className="flex flex-wrap mb-1">
        {selected.map((s) => (
          <TagPill key={s} label={s} color={color} onRemove={() => onChange(selected.filter((x) => x !== s))} />
        ))}
      </div>
      <div className="flex flex-wrap gap-1 mb-1">
        {allOptions.filter((o) => !selected.includes(o)).map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => add(o)}
            className="text-xs px-2 py-0.5 rounded-full border"
            style={{ fontFamily: FONT_MONO, borderColor: COLORS.cardEdge, color: COLORS.textSoft }}
          >
            + {o}
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(draft); } }}
          placeholder={placeholder}
          className={inputClass}
          style={inputStyle}
        />
        <Btn small onClick={() => add(draft)}><Plus size={12} /></Btn>
      </div>
    </div>
  );
}

/* Sélecteur multiple avec recherche dans un menu déroulant (pour les objectifs des générateurs). */
function SearchableMultiSelect({ allOptions, selected, onChange, placeholder = "Chercher un objectif…", onCreate, createLabel }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const sortedOptions = [...allOptions].sort((a, b) => a.localeCompare(b, "fr"));
  const filtered = sortedOptions.filter((o) => !selected.includes(o) && matchesKeywords(query, o));
  // Insensible casse/accents/pluriel (voir tagOverlap) : évite de proposer "+ Ajouter" pour une
  // variante d'un tag déjà existant (ex. "Clowns" alors que "Clown" existe déjà).
  const exactExists = allOptions.some((o) => tagOverlap(o, query));

  const add = (val, isNew) => {
    const v = val.trim();
    if (!v || selected.includes(v)) return;
    if (isNew) onCreate?.(v);
    onChange([...selected, v]);
    setQuery("");
  };

  return (
    <div className="relative">
      <div className="flex flex-wrap mb-1">
        {selected.map((s) => (
          <TagPill key={s} label={s} color={COLORS.brass} onRemove={() => onChange(selected.filter((x) => x !== s))} />
        ))}
      </div>
      <input
        className={inputClass}
        style={inputStyle}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
      />
      {open && (
        <div
          className="absolute z-20 left-0 right-0 mt-1 rounded-sm max-h-48 overflow-y-auto"
          style={{ background: "#fff", border: `1px solid ${COLORS.cardEdge}`, boxShadow: "0 6px 14px rgba(0,0,0,0.12)" }}
        >
          {filtered.length === 0 && !query.trim() && (
            <div className="px-3 py-2 text-sm" style={{ color: COLORS.textSoft, fontFamily: FONT_BODY }}>Tape pour chercher un objectif…</div>
          )}
          {filtered.map((o) => (
            <button
              key={o}
              type="button"
              onMouseDown={() => add(o)}
              className="block w-full text-left px-3 py-1.5 text-sm"
              style={{ fontFamily: FONT_BODY, color: COLORS.text }}
            >
              {o}
            </button>
          ))}
          {query.trim() && !exactExists && (
            <button
              type="button"
              onMouseDown={() => add(query, true)}
              className="block w-full text-left px-3 py-1.5 text-sm border-t"
              style={{ fontFamily: FONT_MONO, color: COLORS.accent, borderColor: COLORS.cardEdge }}
            >
              {createLabel ? createLabel(query.trim()) : `+ Ajouter "${query.trim()}"`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* Menu déroulant avec recherche, sélection UNIQUE (pas de tags) — ex. filtre thématique. */
function SearchableSingleSelect({ allOptions, value, onChange, placeholder = "Chercher…", allowCreate = false, onCreate, createLabel }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = [...allOptions].sort((a, b) => a.localeCompare(b, "fr")).filter((o) => matchesKeywords(query, o));
  const trimmedQuery = query.trim();
  // Insensible casse/accents/pluriel (voir tagOverlap) : évite de proposer "+ Ajouter" pour une
  // variante d'une option déjà existante.
  const exactExists = allOptions.some((o) => tagOverlap(o, trimmedQuery));

  return (
    <div className="relative">
      <input
        className={inputClass}
        style={inputStyle}
        value={open ? query : (value || "")}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { setQuery(""); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={value || placeholder}
      />
      {open && (
        <div
          className="absolute z-20 left-0 right-0 mt-1 rounded-sm max-h-48 overflow-y-auto"
          style={{ background: "#fff", border: `1px solid ${COLORS.cardEdge}`, boxShadow: "0 6px 14px rgba(0,0,0,0.12)" }}
        >
          <button
            type="button"
            onMouseDown={() => { onChange(""); setQuery(""); setOpen(false); }}
            className="block w-full text-left px-3 py-1.5 text-sm border-b"
            style={{ fontFamily: FONT_MONO, color: COLORS.textSoft, borderColor: COLORS.cardEdge }}
          >
            Tous
          </button>
          {filtered.map((o) => (
            <button
              key={o}
              type="button"
              onMouseDown={() => { onChange(o); setQuery(""); setOpen(false); }}
              className="block w-full text-left px-3 py-1.5 text-sm"
              style={{ fontFamily: FONT_BODY, color: COLORS.text }}
            >
              {o}
            </button>
          ))}
          {allowCreate && trimmedQuery && !exactExists && (
            <button
              type="button"
              onMouseDown={() => {
                onCreate?.(trimmedQuery);
                onChange(trimmedQuery);
                setQuery("");
                setOpen(false);
              }}
              className="block w-full text-left px-3 py-1.5 text-sm border-t"
              style={{ fontFamily: FONT_MONO, color: COLORS.accent, borderColor: COLORS.cardEdge }}
            >
              {createLabel ? createLabel(trimmedQuery) : `+ Créer "${trimmedQuery}"`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* Recherche + sélection d'un exercice de la bibliothèque (pour ajouter ou remplacer manuellement). */
function ExercisePicker({ exercises, excludeIds = [], onSelect, onCancel, priorityFamilies = [] }) {
  const [query, setQuery] = useState("");
  const q = normalize(query);
  const detectedNiveau = detectNiveauQuery(query);
  const options = exercises
    .filter((e) => !excludeIds.includes(e.id) && matchesKeywords(query, e.title, e.groupe, (e.objectives || []).join(" "), (e.thematiques || []).join(" "), e.phase, e.level))
    .sort((a, b) => {
      // Si la recherche tapée correspond à un niveau, les fiches de ce niveau remontent en premier.
      if (detectedNiveau) {
        const aMatch = a.level === detectedNiveau ? 0 : 1;
        const bMatch = b.level === detectedNiveau ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
      }
      // On ne force l'ordre par famille que tant que la recherche est vide ; dès qu'on tape une
      // lettre, la liste retombe sur l'ordre normal de correspondance au texte tapé. Dans les deux
      // cas, les résultats sont ensuite triés par ordre alphabétique.
      if (!q && priorityFamilies.length > 0) {
        const aMatch = priorityFamilies.includes(a.groupe) ? 0 : 1;
        const bMatch = priorityFamilies.includes(b.groupe) ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
      }
      return a.title.localeCompare(b.title, "fr");
    });

  return (
    <IndexCard>
      <div className="flex justify-end mb-2">
        <Btn variant="ghost" onClick={onCancel}><X size={14} /> Annuler</Btn>
      </div>
      <Field label="Chercher un exercice dans la bibliothèque">
        <input
          className={inputClass}
          style={inputStyle}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Titre, famille ou tag…"
          autoFocus
        />
      </Field>
      <div className="max-h-64 overflow-y-auto">
        {options.length === 0 && <Empty text="Aucun exercice ne correspond." />}
        {options.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => onSelect(e)}
            className="block w-full text-left py-1.5 border-b"
            style={{ borderColor: COLORS.cardEdge }}
          >
            <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="text-sm font-medium flex items-center gap-1">
              {e.title}
              {e.favorite && <Star size={12} color={COLORS.brass} fill={COLORS.brass} />}
            </div>
            <div style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs">
              {e.level}{e.level ? " · " : ""}{e.duration} min{e.objectives?.length > 0 ? ` · ${e.objectives.join(", ")}` : ""}
            </div>
          </button>
        ))}
      </div>
    </IndexCard>
  );
}

/* Recherche + sélection d'une catégorie de la bibliothèque (pour le "Temps d'impro" du cours). */
function CategoryPicker({ categories, excludeIds = [], onSelect, onCancel }) {
  const [query, setQuery] = useState("");
  const q = normalize(query);
  const detectedNiveau = detectNiveauQuery(query);
  const options = categories
    .filter((c) => !excludeIds.includes(c.id) && matchesKeywords(query, c.name, (c.tags || []).join(" "), (c.objectives || []).join(" "), (c.thematiques || []).join(" "), c.level))
    .sort((a, b) => {
      if (detectedNiveau) {
        const aMatch = a.level === detectedNiveau ? 0 : 1;
        const bMatch = b.level === detectedNiveau ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
      }
      return a.name.localeCompare(b.name, "fr");
    });

  return (
    <IndexCard>
      <div className="flex justify-end mb-2">
        <Btn variant="ghost" onClick={onCancel}><X size={14} /> Annuler</Btn>
      </div>
      <Field label="Chercher une catégorie dans la bibliothèque">
        <input
          className={inputClass}
          style={inputStyle}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nom, genre ou tag…"
          autoFocus
        />
      </Field>
      <div className="max-h-64 overflow-y-auto">
        {options.length === 0 && <Empty text="Aucune catégorie ne correspond." />}
        {options.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c)}
            className="block w-full text-left py-1.5 border-b"
            style={{ borderColor: COLORS.cardEdge }}
          >
            <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="text-sm font-medium flex items-center gap-1">
              {c.name}
              {c.favorite && <Star size={12} color={COLORS.brass} fill={COLORS.brass} />}
            </div>
            <div style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs">
              {c.level}{c.level ? " · " : ""}{c.duration || 5} min
            </div>
          </button>
        ))}
      </div>
    </IndexCard>
  );
}

/* ---------- Tabs ---------- */
const TABS = [
  { key: "accueil", label: "Accueil", icon: Home },
  { key: "bibliotheque", label: "Bibliothèque", icon: Library },
  { key: "profil", label: "Mon profil", icon: UserCircle },
];
// Onglets qui relèvent de la Bibliothèque (hub + toutes ses sous-pages) — sert à n'afficher
// le bouton "Remonter en haut" que sur ces pages-là.
const LIBRARY_TABS = ["bibliotheque", "exercices", "exercices-crees", "categories", "categories-crees", "spectacles", "spectacles-crees", "plans", "favoris", "moderation", "messages", "mes-messages", "messages-envoyes", "comptes", "valides", "parametres"];

/* Bouton "← Bibliothèque" (ou autre cible), en haut à gauche des sous-pages de la Bibliothèque —
   même style visuel que les BackBtn internes utilisés pour la navigation par famille/tag. */
function LibraryBackBtn({ onClick, label = "Bibliothèque" }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 mb-3 text-sm" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
      <ChevronLeft size={16} /> {label}
    </button>
  );
}

/* Bouton flottant "Remonter en haut", discret, qui n'apparaît qu'après un peu de scroll et reste
   visible à l'écran (position fixe) pendant le défilement. */
/* Icônes réseaux sociaux, discrètes, en bas de chaque page. */
// Ouvre le lien dans un nouvel onglet via window.open (en plus de target="_blank", qui suffit sur la
// plupart des navigateurs mais pas de façon fiable partout, notamment dans certains navigateurs
// intégrés mobiles) — empêche la navigation par défaut du lien pour ne garder que cet appel explicite.
const openInNewTab = (url) => (e) => {
  e.preventDefault();
  window.open(url, "_blank", "noopener,noreferrer");
};

function SocialFooter() {
  return (
    <div className="flex items-center justify-center gap-4 py-6">
      <a
        href="https://www.facebook.com/lesidephiles"
        target="_blank"
        rel="noopener noreferrer"
        onClick={openInNewTab("https://www.facebook.com/lesidephiles")}
        title="Les Idéphiles sur Facebook"
        aria-label="Les Idéphiles sur Facebook"
        style={{ opacity: 0.5 }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = 1)}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = 0.5)}
      >
        <Facebook size={18} color={COLORS.textSoft} />
      </a>
      <a
        href="https://www.instagram.com/les_idephiles/"
        target="_blank"
        rel="noopener noreferrer"
        onClick={openInNewTab("https://www.instagram.com/les_idephiles/")}
        title="Les Idéphiles sur Instagram"
        aria-label="Les Idéphiles sur Instagram"
        style={{ opacity: 0.5 }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = 1)}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = 0.5)}
      >
        <Instagram size={18} color={COLORS.textSoft} />
      </a>
    </div>
  );
}

function BackToTopButton() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!visible) return null;
  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Remonter en haut de la page"
      title="Remonter en haut"
      style={{
        position: "fixed",
        right: 16,
        bottom: 24,
        width: 40,
        height: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "9999px",
        background: COLORS.ink,
        color: COLORS.paper,
        opacity: 0.8,
        border: `1px solid ${COLORS.brass}`,
        boxShadow: "0 2px 8px rgba(0,0,0,0.28)",
        zIndex: 30,
      }}
    >
      <ChevronUp size={18} />
    </button>
  );
}

/* ---------- Main App ---------- */
export default function ImproApp() {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap";
    document.head.appendChild(link);
    return () => document.head.removeChild(link);
  }, []);

  // Charge jsPDF dès le démarrage de l'appli (et pas seulement sur la page "Plans de cours") pour que
  // le téléchargement PDF direct depuis "Créer un cours"/"Créer un spectacle" soit prêt sans attendre.
  useEffect(() => {
    if (window.jspdf) return;
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.async = true;
    document.body.appendChild(script);
  }, []);

  const [data, setData, loaded] = useAppData();
  const [tab, setTabRaw] = useState(() => window.location.hash.slice(1) || "accueil");
  const tabRef = useRef(tab);
  useEffect(() => { tabRef.current = tab; }, [tab]);
  // Relie la navigation interne (onglets) à l'historique du navigateur : chaque changement d'onglet
  // pousse une entrée d'historique, pour que "page précédente" dans le navigateur ramène à l'onglet
  // précédent de l'appli au lieu de quitter la page.
  useEffect(() => {
    window.history.replaceState({ tab: tabRef.current }, "", `#${tabRef.current}`);
    const onPopState = (e) => setTabRaw(e.state?.tab || window.location.hash.slice(1) || "accueil");
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setTab = useCallback((next) => {
    if (next === tabRef.current) return;
    window.history.pushState({ tab: next }, "", `#${next}`);
    setTabRaw(next);
  }, []);
  // Remonte en haut de page à chaque changement d'onglet (Accueil/Bibliothèque/Créer un cours…) —
  // même logique que dans les pages famille, pour ne jamais arriver au milieu d'une page.
  useEffect(() => { window.scrollTo(0, 0); }, [tab]);
  // Session réelle Supabase Auth + profil (nom d'utilisateur, troupe, ville, is_admin).
  const auth = useAuthUser();
  // "Mode utilisateur" (bouton du profil Admin) : simule une session non-admin sans compte réel,
  // pour tester rapidement le point de vue d'un membre lambda — voir TEST_USER_NAME.
  const [simulateMember, setSimulateMember] = useState(false);
  const currentUser = simulateMember ? TEST_USER_NAME : auth.currentUser;
  const isAdmin = auth.isAdmin && !simulateMember;
  const [librarySearchSeed, setLibrarySearchSeed] = useState(""); // pré-remplit la recherche en arrivant depuis la Bibliothèque
  const [coursPlan, setCoursPlan] = useState(null); // levé ici pour survivre à la navigation + permettre de "reprendre"
  const [spectaclePlan, setSpectaclePlan] = useState(null); // idem, pour "Reprendre le dernier spectacle généré"
  const [echauffementPlan, setEchauffementPlan] = useState(null); // idem, pour "Reprendre le dernier échauffement généré"
  const goToLibrarySection = (targetTab, query) => {
    setLibrarySearchSeed(query);
    setTab(targetTab);
  };

  const update = useCallback((fn) => setData((prev) => fn(structuredClone(prev))), [setData]);
  // Vue "publique" des données : masque les exercices/catégories créés par la communauté tant qu'ils
  // n'ont pas été validés par l'Admin, ainsi que ceux refusés — utilisée partout où le contenu doit
  // rester fiable (génération de cours/spectacle/échauffement, recherche, tirage aléatoire, favoris,
  // plans enregistrés). Les pages "Exercices créés"/"Catégories créées" et l'édition directe
  // continuent d'utiliser `data` (non filtré) puisque c'est justement là que la validation a lieu, et
  // où le créateur d'une fiche refusée peut encore la retrouver.
  const publicData = useMemo(() => {
    if (!data) return data;
    return {
      ...data,
      exercises: data.exercises.filter((e) => !e.pending && !e.rejected),
      categories: data.categories.filter((c) => !c.pending && !c.rejected),
      showConcepts: data.showConcepts.filter((sc) => !sc.pending && !sc.rejected),
    };
  }, [data]);

  if (!loaded || !data) {
    return (
      <div style={{ background: COLORS.paper, fontFamily: FONT_BODY }} className="min-h-screen flex items-center justify-center">
        <span style={{ color: COLORS.textSoft }}>Chargement…</span>
      </div>
    );
  }

  return (
    <div style={{ background: COLORS.paper, minHeight: "100vh" }}>
      {/* Top bar */}
      <div style={{ background: COLORS.ink }} className="px-4 py-3 sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <Sparkles size={18} color={COLORS.brass} />
          <span style={{ fontFamily: FONT_DISPLAY, color: COLORS.paper }} className="text-lg font-semibold">
            Pocket impro, l'assistant des Idéphiles
          </span>
        </div>
        <div className="flex gap-1 mt-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
          {TABS.map((t) => {
            const active = tab === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs whitespace-nowrap shrink-0"
                style={{
                  fontFamily: FONT_BODY,
                  background: active ? COLORS.brass : "transparent",
                  color: active ? COLORS.ink : COLORS.paper + "cc",
                  border: `1px solid ${active ? COLORS.brass : "#ffffff33"}`,
                }}
              >
                <Icon size={13} /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5">
        {auth.passwordRecovery ? (
          <ResetPasswordScreen onDone={() => { auth.clearPasswordRecovery(); setTab("profil"); }} />
        ) : (
        <>
        {tab === "accueil" && <Accueil setTab={setTab} hasCoursPlan={!!coursPlan} hasSpectaclePlan={!!spectaclePlan} hasEchauffementPlan={!!echauffementPlan} />}
        {tab === "gen-cours" && <GenerateurCoursTab data={publicData} allData={data} update={update} plan={coursPlan} setPlan={setCoursPlan} currentUser={currentUser} setTab={setTab} />}
        {tab === "gen-spectacle" && <GenerateurSpectacleTab data={publicData} allData={data} update={update} plan={spectaclePlan} setPlan={setSpectaclePlan} currentUser={currentUser} setTab={setTab} />}
        {tab === "gen-echauffement" && <GenerateurEchauffementTab data={publicData} update={update} plan={echauffementPlan} setPlan={setEchauffementPlan} currentUser={currentUser} />}
        {tab === "gen-idees" && <GenererIdeesTab setTab={setTab} data={publicData} />}
        {tab === "bibliotheque" && <BibliothequeTab data={publicData} update={update} setTab={setTab} isAdmin={isAdmin} currentUser={currentUser} goToLibrarySection={goToLibrarySection} />}
        {tab === "exercices" && <ExercicesTab data={data} update={update} isAdmin={isAdmin} currentUser={currentUser} profile={auth.profile} initialSearchQuery={librarySearchSeed} setTab={setTab} />}
        {tab === "exercices-crees" && <ExercicesTab data={data} update={update} isAdmin={isAdmin} currentUser={currentUser} profile={auth.profile} onlyUserCreated setTab={setTab} />}
        {tab === "categories" && <CategoriesTab data={data} update={update} isAdmin={isAdmin} currentUser={currentUser} profile={auth.profile} initialSearchQuery={librarySearchSeed} setTab={setTab} />}
        {tab === "categories-crees" && <CategoriesTab data={data} update={update} isAdmin={isAdmin} currentUser={currentUser} profile={auth.profile} onlyUserCreated setTab={setTab} />}
        {tab === "spectacles" && <SpectaclesTab data={data} update={update} setTab={setTab} currentUser={currentUser} isAdmin={isAdmin} />}
        {tab === "spectacles-crees" && <SpectaclesTab data={data} update={update} setTab={setTab} currentUser={currentUser} isAdmin={isAdmin} onlyUserCreated />}
        {tab === "entrainement" && <EntrainementTab data={publicData} />}
        {tab === "plans" && <PlansTab data={publicData} update={update} setTab={setTab} />}
        {tab === "moderation" && <ModerationTab data={data} update={update} setTab={setTab} isAdmin={isAdmin} />}
        {tab === "messages" && <MessagesTab data={data} update={update} setTab={setTab} isAdmin={isAdmin} />}
        {tab === "comptes" && <ComptesTab data={data} update={update} isAdmin={isAdmin} setTab={setTab} />}
        {tab === "valides" && <ValidesTab data={data} isAdmin={isAdmin} setTab={setTab} />}
        {tab === "mes-messages" && <MesMessagesTab data={data} update={update} setTab={setTab} currentUser={currentUser} />}
        {tab === "messages-envoyes" && <MessagesEnvoyesTab data={data} update={update} setTab={setTab} currentUser={currentUser} isAdmin={isAdmin} />}
        {tab === "favoris" && <FavorisTab data={publicData} update={update} isAdmin={isAdmin} currentUser={currentUser} setTab={setTab} />}
        {tab === "profil" && <ProfilTab data={data} update={update} setTab={setTab} currentUser={currentUser} isAdmin={isAdmin} profile={auth.profile} realIsAdmin={auth.isAdmin} simulateMember={simulateMember} setSimulateMember={setSimulateMember} />}
        {tab === "parametres" && <ParametresTab setTab={setTab} currentUser={currentUser} profile={auth.profile} />}
        </>
        )}
      </div>
      <SocialFooter />
      {LIBRARY_TABS.includes(tab) && <BackToTopButton />}
    </div>
  );
}

/* ---------- Accueil ---------- */
/* ---------- Générer des idées ---------- */
const IDEES_LIEUX = [
  "Boulangerie", "Salle de classe", "Cabinet médical", "Ascenseur bloqué", "Aéroport", "Cimetière", "Camping",
  "Cuisine de restaurant", "Salon de coiffure", "Vestiaire de sport", "Bureau open space", "Gare ferroviaire",
  "Supermarché", "Station-service", "Piscine municipale", "Cave à vin", "Grenier", "Sous-sol d'immeuble",
  "Parking souterrain", "Laverie automatique", "Hôpital", "Commissariat de police", "Tribunal", "Prison",
  "Caserne de pompiers", "Salle de mariage", "Studio de tatouage", "Salon de thé", "Marché aux puces", "Zoo",
  "Cirque", "Manège forain", "Plateau de tournage", "Salle de concert", "Loge d'artiste", "Coulisses de théâtre",
  "Bibliothèque", "Musée", "Galerie d'art", "Auto-école", "Salle d'attente", "Ambassade", "Aéroport privé", "Yacht",
  "Sous-marin", "Station spatiale", "Château fort", "Donjon", "Grotte", "Île déserte", "Forêt enchantée",
  "Château hanté", "Saloon western", "Marché médiéval", "Temple antique", "Pyramide égyptienne", "Village viking",
  "Taverne de pirates", "Cabane dans les arbres", "Serre botanique", "Laboratoire scientifique",
  "Salle des machines", "Cockpit d'avion", "Salle de contrôle", "Studio de radio", "Plateau de télévision",
  "Salle de rédaction", "Atelier de couturier", "Forge de forgeron", "Champ de bataille",
  "Salle de classe médiévale", "Boîte de nuit", "Casino", "Buanderie d'hôtel", "Cuisine d'un food truck",
  "Salle de sport", "Vestiaire de piscine", "Sacristie d'église", "Confessionnal", "Marché aux poissons",
  "Chantier naval"
];
const IDEES_RELATIONS = [
  "Frère et sœur", "Père et fils", "Mère et fille", "Grand-parent et petit-enfant", "Beau-parent et beau-fils",
  "Demi-frères", "Cousins", "Oncle et neveu", "Couple marié", "Ex-amants", "Amants secrets", "Premier rendez-vous",
  "Fiancés", "Amour à sens unique", "Rivaux en amour", "Patron et employé", "Collègues de bureau",
  "Associés en affaires", "Mentor et élève", "Professeur et élève", "Médecin et patient", "Avocat et client",
  "Client et vendeur", "Policier et suspect", "Meilleurs amis", "Amis d'enfance", "Voisins", "Colocataires",
  "Ennemis jurés", "Rivaux professionnels", "Maître et serviteur", "Chef et subalterne", "Otage et ravisseur",
  "Bourreau et victime", "Inconnus forcés de collaborer", "Ancien couple qui se recroise",
  "Belle-mère et belle-fille", "Parrain et filleul", "Idole et fan", "Escroc et victime"
];
const IDEES_EMOTIONS = [
  "Joie", "Tristesse", "Colère", "Peur", "Surprise", "Dégoût", "Honte", "Fierté", "Jalousie", "Culpabilité",
  "Anxiété", "Panique", "Excitation", "Ennui", "Nostalgie", "Espoir", "Désespoir", "Amour", "Haine", "Méfiance",
  "Confiance", "Confusion", "Curiosité", "Soulagement", "Frustration", "Admiration", "Mépris", "Tendresse",
  "Solitude", "Extase", "Terreur", "Timidité", "Agacement", "Émerveillement", "Regret", "Envie", "Compassion",
  "Indifférence", "Impatience", "Vengeance", "Gratitude", "Épuisement", "Détermination", "Vertige", "Suspicion",
  "Euphorie", "Angoisse", "Serenité", "Rage", "Humiliation"
];
const IDEES_METIERS = [
  "Boulanger", "Coiffeur", "Médecin", "Infirmier", "Pompier", "Policier", "Avocat", "Juge", "Professeur", "Facteur",
  "Chauffeur de taxi", "Pilote d'avion", "Steward", "Serveur", "Cuisinier", "Chef étoilé", "Boucher", "Poissonnier",
  "Fleuriste", "Jardinier", "Agriculteur", "Vétérinaire", "Dentiste", "Pharmacien", "Architecte", "Maçon",
  "Électricien", "Plombier", "Menuisier", "Peintre en bâtiment", "Mécanicien", "Garagiste", "Vendeur", "Caissier",
  "Comédien", "Musicien", "Danseur", "Chanteur", "Peintre artiste", "Sculpteur", "Écrivain", "Journaliste",
  "Photographe", "Réalisateur", "Cascadeur", "Mannequin", "Couturier", "Bijoutier", "Horloger",
  "Boulanger pâtissier", "Guide touristique", "Marin", "Capitaine de bateau", "Pêcheur", "Douanier", "Militaire",
  "Espion", "Détective privé", "Videur de boîte de nuit", "Videur de banque", "Banquier", "Comptable", "Notaire",
  "Maire", "Diplomate", "Espion secret", "Astronaute", "Scientifique", "Chercheur", "Enseignant-chercheur",
  "Bibliothécaire", "Archéologue", "Explorateur", "Alpiniste", "Dresseur d'animaux", "Dompteur de cirque", "Clown",
  "Magicien", "Voyante", "Sorcier", "Chevalier", "Roi"
];
const IDEE_CATEGORIES = [
  { key: "lieux", label: "Lieux", list: IDEES_LIEUX },
  { key: "relations", label: "Relations", list: IDEES_RELATIONS },
  { key: "emotions", label: "Émotions", list: IDEES_EMOTIONS },
  { key: "metiers", label: "Métiers", list: IDEES_METIERS },
  { key: "mots", label: "Mots", underConstruction: true },
  { key: "themes", label: "Thèmes", underConstruction: true },
];

function GenererIdeesTab({ setTab, data }) {
  // Un tirage par catégorie, indépendant des autres (objet plutôt qu'une seule valeur) : cliquer sur
  // une catégorie ne doit plus effacer le tirage déjà affiché pour une autre — chacun reste visible
  // jusqu'à ce qu'on le ferme explicitement avec sa croix.
  const [picked, setPicked] = useState({}); // { [cat.key]: value }
  // "Normal" (tirages existants) ou "Univers" (tirages liés à un univers de catégorie précis).
  const [mode, setMode] = useState("normal");
  const [universId, setUniversId] = useState("");
  // Un tirage par bouton (Personnage/Lieu/Vocabulaire), indépendant des autres — même principe que
  // "picked" ci-dessus : chacun reste affiché sous son propre bouton jusqu'à sa croix.
  const [universResults, setUniversResults] = useState({}); // { [type]: value }

  const draw = (cat) => setPicked((prev) => ({ ...prev, [cat.key]: cat.list[Math.floor(Math.random() * cat.list.length)] }));
  const dismiss = (key) => setPicked((prev) => { const next = { ...prev }; delete next[key]; return next; });

  // Catégories de la famille "Univers" (Western, Fantasy, Polar…), triées alphabétiquement pour le menu.
  const universCategories = (data?.categories || [])
    .filter((c) => c.tags?.includes("Univers"))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const UNIVERS_ALL_ID = "__tous__";
  const isAllUnivers = universId === UNIVERS_ALL_ID;
  const selectedUnivers = isAllUnivers ? null : universCategories.find((c) => c.id === universId);
  const hasSelection = isAllUnivers || !!selectedUnivers;

  const UNIVERS_TYPE_LABEL = { lieu: "Lieu", personnage: "Personnage", mot: "Lexique" };
  const UNIVERS_BUTTONS = [
    { key: "personnage", label: "Personnage" },
    { key: "lieu", label: "Lieu" },
    { key: "mot", label: "Lexique" },
  ];
  const capitalizeFirst = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const listForType = (c, type) => {
    if (type === "lieu") return c.lieux || [];
    if (type === "personnage") return (c.archetypes || []).map((a) => a.name);
    if (type === "mot") return (c.vocabulaireUnivers?.lexique || "").split(",").map((s) => s.trim()).filter(Boolean);
    return [];
  };
  // Historique des propositions déjà tirées, par univers ("tous" y compris) et par type — pour ne
  // jamais répéter une proposition tant que les autres n'ont pas toutes été vues au moins une fois.
  const [universUsed, setUniversUsed] = useState({}); // { [`${universId}::${type}`]: Set<string> }
  const drawUnivers = (type) => {
    if (!hasSelection) return;
    // "Tous" mélange les listes de tous les univers ensemble.
    const list = isAllUnivers ? universCategories.flatMap((c) => listForType(c, type)) : listForType(selectedUnivers, type);
    if (list.length === 0) { setUniversResults((prev) => ({ ...prev, [type]: null })); return; }
    const key = `${universId}::${type}`;
    const usedBefore = universUsed[key] || new Set();
    // Une fois toutes les propositions déjà vues, on repart d'une ardoise neuve plutôt que de bloquer.
    const available = list.filter((v) => !usedBefore.has(v));
    const pool = available.length > 0 ? available : list;
    let value = pool[Math.floor(Math.random() * pool.length)];
    const nextUsed = available.length > 0 ? new Set(usedBefore) : new Set();
    nextUsed.add(value);
    setUniversUsed((prev) => ({ ...prev, [key]: nextUsed }));
    // Le vocabulaire est parfois saisi en minuscules dans les fiches (ex. "dégainer", "ruée") :
    // on met toujours une majuscule au premier mot du tirage affiché.
    if (type === "mot" && value) value = capitalizeFirst(value);
    setUniversResults((prev) => ({ ...prev, [type]: value }));
  };
  const dismissUnivers = (type) => setUniversResults((prev) => { const next = { ...prev }; delete next[type]; return next; });

  return (
    <div>
      <button onClick={() => setTab("accueil")} className="flex items-center gap-1 mb-3 text-sm" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
        <ChevronLeft size={16} /> Accueil
      </button>
      <SectionHeader icon={Sparkles} title="Générer des idées" subtitle="Un tirage aléatoire pour se lancer." />
      <div className="flex justify-between mb-4">
        <button
          onClick={() => setMode("normal")}
          className="text-center py-1.5 text-sm px-3 rounded-sm"
          style={{ fontFamily: FONT_DISPLAY, background: mode === "normal" ? COLORS.accent : "transparent", color: mode === "normal" ? "#fff" : COLORS.accent, border: `1px solid ${COLORS.accent}` }}
        >
          Normal
        </button>
        <button
          onClick={() => setMode("univers")}
          className="text-center py-1.5 text-sm px-3 rounded-sm"
          style={{ fontFamily: FONT_DISPLAY, background: mode === "univers" ? COLORS.accent : "transparent", color: mode === "univers" ? "#fff" : COLORS.accent, border: `1px solid ${COLORS.accent}` }}
        >
          Univers
        </button>
      </div>
      {mode === "normal" ? (
        <div className="flex flex-col gap-3 mb-4">
          {IDEE_CATEGORIES.map((cat) => (
            <div key={cat.key}>
              <button
                onClick={() => !cat.underConstruction && draw(cat)}
                disabled={cat.underConstruction}
                className="w-full flex items-center justify-center gap-2 rounded-sm px-4 py-4 text-lg font-medium transition disabled:opacity-60"
                style={{
                  fontFamily: FONT_DISPLAY,
                  background: cat.underConstruction ? COLORS.cardEdge : COLORS.accent,
                  color: cat.underConstruction ? COLORS.textSoft : "#fff",
                  cursor: cat.underConstruction ? "default" : "pointer",
                }}
              >
                <Shuffle size={20} /> {cat.label}{cat.underConstruction ? " (en travaux)" : ""}
              </button>
              {picked[cat.key] !== undefined && (
                <IndexCard className="mt-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <span style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase">{cat.label}</span>
                      <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="text-xl font-semibold mt-1">{picked[cat.key]}</h3>
                    </div>
                    <button onClick={() => dismiss(cat.key)} title="Cacher"><X size={16} color={COLORS.textSoft} /></button>
                  </div>
                </IndexCard>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mb-4">
          <Field label="Choisir un univers">
            <select
              className={inputClass}
              style={inputStyle}
              value={universId}
              onChange={(e) => { setUniversId(e.target.value); setUniversResults({}); }}
            >
              <option value="">Choisir un univers…</option>
              {universCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value={UNIVERS_ALL_ID}>Tous</option>
            </select>
          </Field>
          <div className="flex flex-col gap-3 mt-3 mb-4">
            {UNIVERS_BUTTONS.map((btn) => (
              <div key={btn.key}>
                <button
                  onClick={() => hasSelection && drawUnivers(btn.key)}
                  disabled={!hasSelection}
                  className="w-full flex items-center justify-center gap-2 rounded-sm px-4 py-4 text-lg font-medium transition disabled:opacity-60"
                  style={{
                    fontFamily: FONT_DISPLAY,
                    background: hasSelection ? COLORS.accent : COLORS.cardEdge,
                    color: hasSelection ? "#fff" : COLORS.textSoft,
                    cursor: hasSelection ? "pointer" : "default",
                  }}
                >
                  <Shuffle size={20} /> {btn.label}
                </button>
                {universResults[btn.key] !== undefined && (
                  <IndexCard className="mt-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <span style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase">
                          {isAllUnivers ? "Tous les univers" : selectedUnivers?.name} · {UNIVERS_TYPE_LABEL[btn.key]}
                        </span>
                        <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="text-xl font-semibold mt-1">
                          {universResults[btn.key] || "Pas encore de données pour cet univers"}
                        </h3>
                      </div>
                      <button onClick={() => dismissUnivers(btn.key)} title="Cacher"><X size={16} color={COLORS.textSoft} /></button>
                    </div>
                  </IndexCard>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Accueil({ setTab, hasCoursPlan, hasSpectaclePlan, hasEchauffementPlan }) {
  const generators = [
    { label: "Créer un cours", tab: "gen-cours", icon: BookOpen },
    { label: "Créer un spectacle", tab: "gen-spectacle", icon: Theater },
    { label: "Créer un échauffement", tab: "gen-echauffement", icon: Flame },
    { label: "Générer des idées", tab: "gen-idees", icon: Sparkles },
    { label: "Catégorie aléatoire", tab: "entrainement", icon: Shuffle },
    { label: "Explorer", tab: "bibliotheque", icon: Library },
  ];
  return (
    <div>
      <h1 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="text-3xl font-semibold mb-1">
        Ta boîte à outils d'impro
      </h1>
      <p style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-sm mb-5">
        Tu es improvisateur et tu veux gagner du temps ? Crée tes cours, tes spectacles et échauffements en quelques clics !
      </p>
      {hasCoursPlan && (
        <button onClick={() => setTab("gen-cours")} className="flex items-center gap-3 px-4 py-3 rounded-sm mb-2"
          style={{ background: COLORS.brass, color: COLORS.ink }}>
          <Sparkles size={18} color={COLORS.ink} />
          <span style={{ fontFamily: FONT_DISPLAY }} className="font-medium">Reprendre le dernier cours généré</span>
          <ChevronRight size={16} className="ml-auto" />
        </button>
      )}
      {hasSpectaclePlan && (
        <button onClick={() => setTab("gen-spectacle")} className="flex items-center gap-3 px-4 py-3 rounded-sm mb-2"
          style={{ background: COLORS.brass, color: COLORS.ink }}>
          <Sparkles size={18} color={COLORS.ink} />
          <span style={{ fontFamily: FONT_DISPLAY }} className="font-medium">Reprendre le dernier spectacle généré</span>
          <ChevronRight size={16} className="ml-auto" />
        </button>
      )}
      {hasEchauffementPlan && (
        <button onClick={() => setTab("gen-echauffement")} className="flex items-center gap-3 px-4 py-3 rounded-sm mb-2"
          style={{ background: COLORS.brass, color: COLORS.ink }}>
          <Sparkles size={18} color={COLORS.ink} />
          <span style={{ fontFamily: FONT_DISPLAY }} className="font-medium">Reprendre le dernier échauffement généré</span>
          <ChevronRight size={16} className="ml-auto" />
        </button>
      )}
      <div className="flex flex-col gap-2">
        {generators.map((g) => (
          <button key={g.tab} onClick={() => setTab(g.tab)} className="flex items-center gap-3 px-4 py-3 rounded-sm"
            style={{ background: COLORS.ink, color: COLORS.paper }}>
            <g.icon size={18} color={COLORS.brass} />
            <span style={{ fontFamily: FONT_DISPLAY }} className="font-medium">{g.label}</span>
            <ChevronRight size={16} className="ml-auto" />
          </button>
        ))}
      </div>
      <p className="text-xs text-center mt-6" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
        Prochainement : Créer un ambassadeur
      </p>
    </div>
  );
}

/* ---------- Bibliothèque (hub) ---------- */
function BibliothequeTab({ data, update, setTab, isAdmin, currentUser, goToLibrarySection }) {
  const [query, setQuery] = useState("");
  const q = normalize(query);
  const detectedNiveau = detectNiveauQuery(query);
  // Trie par ordre alphabétique en priorité, puis remonte les fiches du niveau détecté dans la
  // recherche (tri stable : l'ordre alphabétique est conservé au sein de chaque groupe de niveau).
  const sortByNiveau = (arr, getLevel, getLabel) => {
    const alpha = [...arr].sort((a, b) => getLabel(a).localeCompare(getLabel(b), "fr"));
    if (!detectedNiveau) return alpha;
    return alpha.sort((a, b) => (getLevel(a) === detectedNiveau ? 0 : 1) - (getLevel(b) === detectedNiveau ? 0 : 1));
  };
  const matchedExercises = sortByNiveau(q ? data.exercises.filter((e) => matchesKeywords(query, e.title, e.groupe, (e.objectives || []).join(" "), (e.thematiques || []).join(" "), e.level)) : [], (e) => e.level, (e) => e.title);
  const matchedCategories = sortByNiveau(q ? data.categories.filter((c) => matchesKeywords(query, c.name, (c.tags || []).join(" "), (c.objectives || []).join(" "), (c.thematiques || []).join(" "), c.level)) : [], (c) => c.level, (c) => c.name);
  const matchedObjectifs = q ? data.objectifs.filter((o) => matchesKeywords(query, o)) : [];
  const matchedThematiques = q ? data.thematiques.filter((t) => matchesKeywords(query, t)) : [];
  const familles = [...new Set(data.exercises.map((e) => e.groupe).filter(Boolean))];
  const matchedFamilles = q ? familles.filter((g) => matchesKeywords(query, g)) : [];

  const [editingExerciseId, setEditingExerciseId] = useState(null);
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [toastMsg, showToast] = useToast();

  const toggleFavExercise = (id) => {
    if (!currentUser) { showToast("Désolé, il te faut un compte pour enregistrer tes créations !", { type: "notice" }); return; }
    update((d) => { const e = d.exercises.find((x) => x.id === id); if (e) e.favorite = !e.favorite; return d; });
  };
  const toggleFavCategory = (id) => {
    if (!currentUser) { showToast("Désolé, il te faut un compte pour enregistrer tes créations !", { type: "notice" }); return; }
    update((d) => { const c = d.categories.find((x) => x.id === id); if (c) c.favorite = !c.favorite; return d; });
  };

  const sections = [
    { label: "Exercices", desc: `${data.exercises.length} fiche(s)`, tab: "exercices", icon: Users },
    { label: "Catégories", desc: `${data.categories.length} fiche(s) — types de scène, thématiques, archétypes`, tab: "categories", icon: Tag },
    { label: "Concepts de spectacle", desc: `${data.showConcepts.length} fiche(s)`, tab: "spectacles", icon: Theater },
  ];

  return (
    <div>
      <Toast toast={toastMsg} />
      <SectionHeader icon={Library} title="Bibliothèque" subtitle="Toutes les ressources de Pocket Impro, au même endroit. Tu souhaites suggérer un nouvel exercice, échauffement ou une nouvelle catégorie ? Crée un compte et c'est parti !" />
      <Field label="Chercher la fiche d'un exercice ou d'une catégorie">
        <input
          className={inputClass}
          style={inputStyle}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nom de l'exercice ou de la catégorie…"
        />
      </Field>

      {q && (
        <div className="mb-4">
          {matchedFamilles.map((g) => (
            <button key={`fam-${g}`} onClick={() => goToLibrarySection("exercices", g)} className="w-full text-left">
              <IndexCard style={{ cursor: "pointer" }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Tag size={18} color={COLORS.accent} />
                    <div>
                      <span style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase">Famille d'objectifs</span>
                      <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">{g}</div>
                    </div>
                  </div>
                  <ChevronRight size={16} color={COLORS.textSoft} />
                </div>
              </IndexCard>
            </button>
          ))}
          {matchedObjectifs.map((o) => (
            <button key={`obj-${o}`} onClick={() => goToLibrarySection("exercices", o)} className="w-full text-left">
              <IndexCard style={{ cursor: "pointer" }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Tag size={18} color={COLORS.accent} />
                    <div>
                      <span style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase">Tag</span>
                      <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">{o}</div>
                    </div>
                  </div>
                  <ChevronRight size={16} color={COLORS.textSoft} />
                </div>
              </IndexCard>
            </button>
          ))}
          {matchedThematiques.map((t) => (
            <button key={`them-${t}`} onClick={() => goToLibrarySection("categories", t)} className="w-full text-left">
              <IndexCard style={{ cursor: "pointer" }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Tag size={18} color={themeColor(t, data.thematiques)} />
                    <div>
                      <span style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase">Thématique</span>
                      <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">{t}</div>
                    </div>
                  </div>
                  <ChevronRight size={16} color={COLORS.textSoft} />
                </div>
              </IndexCard>
            </button>
          ))}
          {matchedExercises.length === 0 && matchedCategories.length === 0 && matchedObjectifs.length === 0 && matchedThematiques.length === 0 && (
            <Empty text="Aucun exercice ni catégorie ne correspond." />
          )}
          {matchedExercises.map((ex) =>
            editingExerciseId === ex.id ? (
              <ExerciseForm
                familiesList={toutesLesFamillesWithCustom(data)}
                onCreateFamily={(name) => addCustomFamily(update, name)}
                key={ex.id}
                initial={ex}
                showTypes={data.showTypes}
                objectifsList={data.objectifs}
        showTypesList={data.showTypes}
                thematiquesList={data.thematiques}
                onSave={(f) => { update((d) => { const i = d.exercises.findIndex((x) => x.id === ex.id); d.exercises[i] = { ...f, id: ex.id }; return d; }); setEditingExerciseId(null); }}
                onCancel={() => setEditingExerciseId(null)}
              />
            ) : (
              <IndexCard key={ex.id}>
                <div className="flex justify-between items-start">
                  <span style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase">Exercice · {ex.phase}</span>
                  <div className="flex gap-1">
                    <button onClick={() => toggleFavExercise(ex.id)} title="Favori">
                      <Star size={22} color={ex.favorite ? COLORS.brass : COLORS.textSoft} fill={ex.favorite ? COLORS.brass : "none"} />
                    </button>
                    {isAdmin && <Btn small variant="ghost" onClick={() => setEditingExerciseId(ex.id)}>Modifier</Btn>}
                    {isAdmin && (
                      <Btn small variant="ghost" onClick={() => update((d) => { d.exercises = d.exercises.filter((x) => x.id !== ex.id); return d; })}>
                        Supprimer
                      </Btn>
                    )}
                  </div>
                </div>
                <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="text-lg font-medium">{ex.title}</h3>
                <p style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-sm my-1">{ex.summary}</p>
                <div className="flex flex-wrap gap-1 text-xs" style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }}>
                  <span>{ex.level}</span>·<span>{ex.players > 0 ? `${ex.players} élève${ex.players > 1 ? "s" : ""}` : "Illimité"}</span>·<span>{ex.duration} min</span>
                  {ex.energy && <span>· énergie {ex.energy}</span>}
                  {ex.material && ex.material !== "Aucun" && <span>· {ex.material}</span>}
                  {ex.objectives?.length > 0 && <span>· {ex.objectives.join(", ")}</span>}
                  {ex.thematiques?.length > 0 && <span>· Thématique : {ex.thematiques.join(", ")}</span>}
                </div>
              </IndexCard>
            )
          )}
          {matchedCategories.map((c) =>
            editingCategoryId === c.id ? (
              <CategoryForm
                familiesList={familiesObjectifsWithCustom(data)}
                onCreateFamily={(name) => addCustomFamily(update, name)}
                key={c.id}
                initial={c}
                thematiquesList={data.thematiques}
        objectifsList={data.objectifs}
        showTypesList={data.showTypes}
                onSave={(f) => { update((d) => { const i = d.categories.findIndex((x) => x.id === c.id); d.categories[i] = { ...f, id: c.id }; return d; }); setEditingCategoryId(null); }}
                onCancel={() => setEditingCategoryId(null)}
              />
            ) : (
              <IndexCard key={c.id}>
                <div className="flex justify-between items-start">
                  <span style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase">Catégorie</span>
                  <div className="flex gap-1">
                    <button onClick={() => toggleFavCategory(c.id)} title="Favori">
                      <Star size={22} color={c.favorite ? COLORS.brass : COLORS.textSoft} fill={c.favorite ? COLORS.brass : "none"} />
                    </button>
                    {isAdmin && <Btn small variant="ghost" onClick={() => setEditingCategoryId(c.id)}>Modifier</Btn>}
                    {isAdmin && (
                      <Btn small variant="ghost" onClick={() => update((d) => { d.categories = d.categories.filter((x) => x.id !== c.id); return d; })}>
                        Supprimer
                      </Btn>
                    )}
                  </div>
                </div>
                <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="text-lg font-medium">{c.name}</h3>
                <p style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-sm my-1">{c.summary}</p>
                <div className="flex flex-wrap gap-1 text-xs mb-1" style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }}>
                  <span>{c.durationLabel || `${c.duration || 5} min`}</span>
                  {c.level && <span>· {c.level}</span>}
                  {c.playersMin && <span>· {playersLabel(c)}</span>}
                  {c.energy && <span>· énergie {c.energy}</span>}
                  {c.material && c.material !== "Aucun" && <span>· {c.material}</span>}
                </div>
                <div className="flex flex-wrap">
                  {c.thematiques.map((t) => <TagPill key={t} label={t} color={themeColor(t, data.thematiques)} />)}
                </div>
                {c.archetypes.length > 0 && (
                  <div className="mt-1 text-xs" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
                    <span style={{ fontFamily: FONT_MONO }}>Archétypes : </span>{c.archetypes.map((a) => a.name).join(" · ")}
                  </div>
                )}
              </IndexCard>
            )
          )}
        </div>
      )}

      {sections.map((s) => (
        <button key={s.tab} onClick={() => setTab(s.tab)} className="w-full text-left">
          <IndexCard style={{ cursor: "pointer" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <s.icon size={18} color={COLORS.accent} />
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">{s.label}</div>
                  <div style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-xs">{s.desc}</div>
                </div>
              </div>
              <ChevronRight size={16} color={COLORS.textSoft} />
            </div>
          </IndexCard>
        </button>
      ))}
    </div>
  );
}

/* ---------- Mon profil ---------- */
/* ---------- Favoris ---------- */
function FavorisTab({ data, update, isAdmin, currentUser, setTab }) {
  const favExercises = data.exercises.filter((e) => e.favorite);
  const favCategories = data.categories.filter((c) => c.favorite);
  const [editingExerciseId, setEditingExerciseId] = useState(null);
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [toastMsg, showToast] = useToast();

  const toggleFavExercise = (id) => {
    if (!currentUser) { showToast("Désolé, il te faut un compte pour enregistrer tes créations !", { type: "notice" }); return; }
    update((d) => { const e = d.exercises.find((x) => x.id === id); if (e) e.favorite = !e.favorite; return d; });
  };
  const toggleFavCategory = (id) => {
    if (!currentUser) { showToast("Désolé, il te faut un compte pour enregistrer tes créations !", { type: "notice" }); return; }
    update((d) => { const c = d.categories.find((x) => x.id === id); if (c) c.favorite = !c.favorite; return d; });
  };

  return (
    <div>
      <Toast toast={toastMsg} />
      {setTab && <LibraryBackBtn onClick={() => setTab("bibliotheque")} />}
      <SectionHeader icon={Star} title="Favoris" subtitle="Tes exercices et catégories étoilés." />
      {favExercises.length === 0 && favCategories.length === 0 && <Empty text="Aucun favori pour l'instant — clique sur l'étoile d'une fiche pour l'ajouter ici." />}

      {favExercises.length > 0 && (
        <>
          <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase">Exercices</span>
          {favExercises.map((ex) =>
            editingExerciseId === ex.id ? (
              <ExerciseForm
                familiesList={toutesLesFamillesWithCustom(data)}
                onCreateFamily={(name) => addCustomFamily(update, name)}
                key={ex.id}
                initial={ex}
                showTypes={data.showTypes}
                objectifsList={data.objectifs}
        showTypesList={data.showTypes}
                thematiquesList={data.thematiques}
                onSave={(f) => { update((d) => { const i = d.exercises.findIndex((x) => x.id === ex.id); d.exercises[i] = { ...f, id: ex.id }; return d; }); setEditingExerciseId(null); }}
                onCancel={() => setEditingExerciseId(null)}
              />
            ) : (
              <IndexCard key={ex.id}>
                <div className="flex justify-between items-start">
                  <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="text-lg font-medium">{ex.title}</h3>
                  <div className="flex gap-1">
                    <button onClick={() => toggleFavExercise(ex.id)} title="Retirer des favoris"><Star size={22} color={COLORS.brass} fill={COLORS.brass} /></button>
                    {isAdmin && <button onClick={() => setEditingExerciseId(ex.id)}><Pencil size={14} color={COLORS.textSoft} /></button>}
                  </div>
                </div>
                <p style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-sm my-1">{ex.summary}</p>
                <div className="flex flex-wrap gap-1 text-xs" style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }}>
                  <span>{ex.level}</span>·<span>{ex.duration} min</span>
                  {ex.objectives?.length > 0 && <span>· {ex.objectives.join(", ")}</span>}
                </div>
              </IndexCard>
            )
          )}
        </>
      )}

      {favCategories.length > 0 && (
        <>
          <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase">Catégories</span>
          {favCategories.map((c) =>
            editingCategoryId === c.id ? (
              <CategoryForm
                familiesList={familiesObjectifsWithCustom(data)}
                onCreateFamily={(name) => addCustomFamily(update, name)}
                key={c.id}
                initial={c}
                thematiquesList={data.thematiques}
        objectifsList={data.objectifs}
        showTypesList={data.showTypes}
                onSave={(f) => { update((d) => { const i = d.categories.findIndex((x) => x.id === c.id); d.categories[i] = { ...f, id: c.id }; return d; }); setEditingCategoryId(null); }}
                onCancel={() => setEditingCategoryId(null)}
              />
            ) : (
              <IndexCard key={c.id}>
                <div className="flex justify-between items-start">
                  <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="text-lg font-medium">{c.name}</h3>
                  <div className="flex gap-1">
                    <button onClick={() => toggleFavCategory(c.id)} title="Retirer des favoris"><Star size={22} color={COLORS.brass} fill={COLORS.brass} /></button>
                    {isAdmin && <button onClick={() => setEditingCategoryId(c.id)}><Pencil size={14} color={COLORS.textSoft} /></button>}
                  </div>
                </div>
                <p style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-sm my-1">{c.summary}</p>
                <div className="flex flex-wrap">
                  {c.thematiques.map((t) => <TagPill key={t} label={t} color={themeColor(t, data.thematiques)} />)}
                </div>
              </IndexCard>
            )
          )}
        </>
      )}
    </div>
  );
}

/* Écran de récupération de mot de passe : affiché à la place du contenu normal (voir ImproApp,
   auth.passwordRecovery) quand on arrive via le lien reçu par email — Supabase a déjà établi une
   session temporaire à ce stade, il ne reste plus qu'à définir le nouveau mot de passe. */
function ResetPasswordScreen({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (password.length < 6) { setError("Le mot de passe doit faire au moins 6 caractères."); return; }
    if (password !== confirm) { setError("Les deux mots de passe ne correspondent pas."); return; }
    setBusy(true);
    setError("");
    const { error: err } = await updatePassword(password);
    setBusy(false);
    if (err) { setError("Impossible d'enregistrer ce mot de passe pour le moment. Réessaie plus tard."); return; }
    onDone();
  };

  return (
    <div>
      <SectionHeader icon={LogIn} title="Nouveau mot de passe" subtitle="Choisis un nouveau mot de passe pour ton compte." />
      <IndexCard>
        <Field label="Nouveau mot de passe">
          <PasswordInput value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }} />
        </Field>
        <Field label="Confirme le mot de passe">
          <PasswordInput value={confirm} onChange={(e) => { setConfirm(e.target.value); setError(""); }} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        </Field>
        {error && <p className="text-xs mb-2" style={{ color: COLORS.accent, fontFamily: FONT_BODY }}>{error}</p>}
        <Btn variant="accent" onClick={submit} disabled={busy}><Check size={14} /> Enregistrer le mot de passe</Btn>
      </IndexCard>
    </div>
  );
}

function ProfilTab({ data, update, setTab, currentUser, isAdmin, profile, realIsAdmin, simulateMember, setSimulateMember }) {
  const [mode, setMode] = useState("login"); // "login" | "signup" | "signup-done" | "forgot" | "forgot-sent"
  const [loginEmail, setLoginEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotError, setForgotError] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);
  const sendForgotPassword = async () => {
    const email = forgotEmail.trim();
    if (!email) { setForgotError("Merci de renseigner ton adresse mail."); return; }
    setForgotBusy(true);
    setForgotError("");
    const { error } = await resetPasswordForEmail(email);
    setForgotBusy(false);
    if (error) {
      setForgotError(
        error.message?.toLowerCase().includes("rate limit")
          ? "Trop de tentatives récentes — Supabase limite le nombre d'emails envoyés par heure. Réessaie dans quelques minutes."
          : `Impossible d'envoyer l'email pour le moment (${error.message || "erreur inconnue"}). Réessaie plus tard.`
      );
      return;
    }
    setMode("forgot-sent");
  };

  const [signupEmail, setSignupEmail] = useState("");
  const [signupUsername, setSignupUsername] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupTroupe, setSignupTroupe] = useState("");
  const [signupVille, setSignupVille] = useState("");
  const [signupError, setSignupError] = useState("");
  const [signupBusy, setSignupBusy] = useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deleteAccount = async () => {
    setDeleteBusy(true);
    setDeleteError("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setDeleteBusy(false); return; }
    // On ne supprime que la fiche compte (pseudo/troupe/ville) : les exercices/catégories déjà
    // validés gardent creatorUsername en texte simple (pas de lien vivant vers le compte), donc ils
    // restent visibles dans la bibliothèque comme annoncé à l'utilisateur.
    const { error } = await supabase.from("profiles").delete().eq("id", user.id);
    if (error) {
      setDeleteError("Impossible de supprimer le compte pour le moment. Réessaie plus tard.");
      setDeleteBusy(false);
      return;
    }
    await signOut();
    setDeleteBusy(false);
    setDeleteConfirmOpen(false);
  };

  const nbFavoris = data.exercises.filter((e) => e.favorite).length + data.categories.filter((c) => c.favorite).length;

  const stats = [
    { label: "Plans de cours enregistrés", n: data.coursePlans.length, icon: ClipboardList, tab: "plans" },
    { label: "Spectacles enregistrés", n: data.spectaclePlans.length, icon: Theater, tab: "plans" },
    { label: "Catégories créées", n: data.categories.filter((c) => c.creatorUsername === currentUser).length, icon: Tag, tab: "categories-crees" },
    { label: "Exercices créés", n: data.exercises.filter((e) => e.creatorUsername === currentUser).length, icon: Users, tab: "exercices-crees" },
    { label: "Concepts de spectacle créés", n: data.showConcepts.filter((sc) => sc.creatorUsername === currentUser).length, icon: Theater, tab: "spectacles-crees" },
    { label: "Favoris", n: nbFavoris, icon: Star, tab: "favoris" },
  ];

  const nbPending = data.exercises.filter((e) => e.pending).length + data.categories.filter((c) => c.pending).length;
  const nbUnreadMessages = (data.messages || []).filter((m) => m.type !== "notif" && !m.read).length;
  const nbUnreadReplies = (data.messages || []).filter((m) =>
    (m.from === currentUser && m.reply && m.replySeen === false) ||
    (m.type === "notif" && m.to === currentUser && m.seen === false)
  ).length;

  const [contactOpen, setContactOpen] = useState(false);
  const [contactText, setContactText] = useState("");
  const [contactSent, setContactSent] = useState(false);
  const sendContactMessage = () => {
    const text = contactText.trim();
    if (!text) return;
    update((d) => {
      if (!d.messages) d.messages = [];
      d.messages.push({
        id: uid(),
        from: currentUser,
        troupe: profile?.troupe || "",
        text,
        createdAt: Date.now(),
        read: false,
      });
      return d;
    });
    setContactText("");
    setContactOpen(false);
    setContactSent(true);
  };

  // Créations validées par l'Admin depuis la dernière visite du créateur — affichées une seule fois,
  // puis marquées comme vues (approvalSeen: true) pour ne pas réapparaître.
  const newlyApproved = currentUser
    ? [
        ...data.exercises.filter((e) => e.creatorUsername === currentUser && !e.pending && !e.rejected && e.approvalSeen === false).map((e) => ({ kind: "exercice", article: "Ton", title: e.title, id: e.id })),
        ...data.categories.filter((c) => c.creatorUsername === currentUser && !c.pending && !c.rejected && c.approvalSeen === false).map((c) => ({ kind: "catégorie", article: "Ta", title: c.name, id: c.id })),
        ...data.showConcepts.filter((sc) => sc.creatorUsername === currentUser && !sc.pending && !sc.rejected && sc.approvalSeen === false).map((sc) => ({ kind: "concept de spectacle", article: "Ton", title: `${sc.theme} · ${sc.type}`, id: sc.id })),
      ]
    : [];
  const dismissApproved = () => update((d) => {
    d.exercises.forEach((e) => { if (e.creatorUsername === currentUser && !e.pending && !e.rejected && e.approvalSeen === false) e.approvalSeen = true; });
    d.categories.forEach((c) => { if (c.creatorUsername === currentUser && !c.pending && !c.rejected && c.approvalSeen === false) c.approvalSeen = true; });
    d.showConcepts.forEach((sc) => { if (sc.creatorUsername === currentUser && !sc.pending && !sc.rejected && sc.approvalSeen === false) sc.approvalSeen = true; });
    return d;
  });

  // Créations refusées par l'Admin depuis la dernière visite du créateur — même principe, affichées
  // une seule fois. Le détail de la raison, lui, reste consultable dans les messages (notifyCreatorRejected).
  const newlyRejected = currentUser
    ? [
        ...data.exercises.filter((e) => e.creatorUsername === currentUser && e.rejected && e.approvalSeen === false).map((e) => ({ kind: "exercice", title: e.title, id: e.id })),
        ...data.categories.filter((c) => c.creatorUsername === currentUser && c.rejected && c.approvalSeen === false).map((c) => ({ kind: "catégorie", title: c.name, id: c.id })),
        ...data.showConcepts.filter((sc) => sc.creatorUsername === currentUser && sc.rejected && sc.approvalSeen === false).map((sc) => ({ kind: "concept de spectacle", title: `${sc.theme} · ${sc.type}`, id: sc.id })),
      ]
    : [];
  const dismissRejected = () => update((d) => {
    d.exercises.forEach((e) => { if (e.creatorUsername === currentUser && e.rejected && e.approvalSeen === false) e.approvalSeen = true; });
    d.categories.forEach((c) => { if (c.creatorUsername === currentUser && c.rejected && c.approvalSeen === false) c.approvalSeen = true; });
    d.showConcepts.forEach((sc) => { if (sc.creatorUsername === currentUser && sc.rejected && sc.approvalSeen === false) sc.approvalSeen = true; });
    return d;
  });

  const login = async () => {
    const email = loginEmail.trim();
    if (!email || !password) { setLoginError("Merci de remplir les 2 champs."); return; }
    setLoginBusy(true);
    const { error } = await signIn({ email, password });
    setLoginBusy(false);
    if (error) {
      setLoginError(
        error.message === "Email not confirmed"
          ? "Confirme d'abord ton adresse mail (lien reçu par email) avant de te connecter."
          : "Email ou mot de passe incorrect."
      );
      return;
    }
    setLoginError("");
    setPassword("");
  };

  const signup = async () => {
    const email = signupEmail.trim();
    const uname = signupUsername.trim();
    if (!email || !uname || !signupPassword) {
      setSignupError("Merci de remplir les 3 champs.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setSignupError("Adresse mail invalide.");
      return;
    }
    if (normalize(uname) === "admin") {
      setSignupError("Cet identifiant est réservé.");
      return;
    }
    setSignupBusy(true);
    const { error } = await signUp({ email, password: signupPassword, username: uname, troupe: signupTroupe.trim(), ville: signupVille.trim() });
    setSignupBusy(false);
    if (error) {
      setSignupError(
        error.message?.includes("already registered") ? "Cette adresse mail a déjà un compte."
        : error.message?.includes("duplicate") || error.message?.includes("username") ? "Cet identifiant est déjà utilisé."
        : error.message?.includes("rate limit") ? "Trop d'inscriptions récentes, réessaie dans quelques minutes."
        : error.message || "Erreur lors de l'inscription."
      );
      return;
    }
    setMode("signup-done");
    setSignupEmail(""); setSignupUsername(""); setSignupPassword(""); setSignupTroupe(""); setSignupVille(""); setSignupError("");
  };

  return (
    <div>
      <SectionHeader
        icon={UserCircle}
        title="Mon profil"
        subtitle="Ton activité dans l'appli."
        action={
          realIsAdmin && !simulateMember ? (
            <Btn small variant="accent" onClick={() => setSimulateMember(true)}><UserCircle size={13} /> Mode utilisateur</Btn>
          ) : realIsAdmin && simulateMember ? (
            <Btn small variant="accent" onClick={() => setSimulateMember(false)}><LogIn size={13} /> Repasser en Admin</Btn>
          ) : null
        }
      />

      {newlyApproved.length > 0 && (
        <IndexCard style={{ background: COLORS.brass + "22", borderColor: COLORS.brass }}>
          <p className="text-sm mb-2" style={{ fontFamily: FONT_BODY, color: COLORS.ink }}>
            🎉 {newlyApproved.length === 1 ? (
              <>{newlyApproved[0].article} {newlyApproved[0].kind} « <b>{newlyApproved[0].title}</b> » a été validé{newlyApproved[0].kind === "catégorie" ? "e" : ""} et est maintenant {newlyApproved[0].kind === "concept de spectacle" ? "public dans la liste des concepts de spectacle" : `publi${newlyApproved[0].kind === "catégorie" ? "que" : "c"} dans la bibliothèque`} !</>
            ) : (
              <>Tes créations suivantes ont été validées et sont maintenant publiques dans la bibliothèque : {newlyApproved.map((n, i) => (
                <span key={n.id}>{i > 0 && ", "}« <b>{n.title}</b> »</span>
              ))}.</>
            )}
          </p>
          <Btn small variant="ghost" onClick={dismissApproved}><Check size={13} /> OK, compris</Btn>
        </IndexCard>
      )}

      {newlyRejected.length > 0 && (
        <IndexCard style={{ background: COLORS.accent + "11", borderColor: COLORS.accent }}>
          <p className="text-sm mb-2" style={{ fontFamily: FONT_BODY, color: COLORS.ink }}>
            {newlyRejected.length === 1 ? (() => {
              const isFem = newlyRejected[0].kind === "catégorie";
              const noun = newlyRejected[0].kind === "catégorie" ? "catégorie" : newlyRejected[0].kind === "concept de spectacle" ? "concept de spectacle" : "exercice";
              return (
                <>Désolé ! {isFem ? "Ta" : "Ton"} {noun} « <b>{newlyRejected[0].title}</b> » n'a pas été validé{isFem ? "e" : ""} par la modération. Consulte tes messages pour en connaître la raison. Tu peux tout de même {isFem ? `utiliser ta ${noun}` : `utiliser ton ${noun}`}, mais {isFem ? "elle" : "il"} ne sera pas rendu{isFem ? "e" : ""} public{isFem ? "que" : ""}.</>
              );
            })() : (
              <>Désolé, tes créations suivantes n'ont pas été validées par la modération : {newlyRejected.map((n, i) => (
                <span key={n.id}>{i > 0 && ", "}« <b>{n.title}</b> »</span>
              ))}. Consulte tes messages pour en connaître la raison. Tu peux tout de même les utiliser, mais elles ne seront pas rendues publiques.</>
            )}
          </p>
          <Btn small variant="ghost" onClick={dismissRejected}><Check size={13} /> OK, compris</Btn>
        </IndexCard>
      )}

      <IndexCard>
        {currentUser ? (
          <div className="flex items-center justify-between">
            <span style={{ fontFamily: FONT_BODY, color: COLORS.text }} className="text-sm">
              Connecté·e en tant que <b>{currentUser}</b>
              {isAdmin
                ? " — tu peux ajouter/modifier/supprimer des exercices et catégories."
                : simulateMember
                ? " — mode utilisateur simulé, pour tester le point de vue d'un compte non-admin."
                : "."}
              {(() => {
                const extra = [profile?.troupe, profile?.ville].filter(Boolean).join(" · ");
                return extra ? <span style={{ color: COLORS.textSoft }}> {extra}</span> : null;
              })()}
            </span>
            <div className="flex gap-1 shrink-0">
              <Btn small variant="ghost" onClick={() => { setSimulateMember(false); signOut(); }}><LogOut size={14} /> Déconnexion</Btn>
            </div>
          </div>
        ) : mode === "signup-done" ? (
          <>
            <p className="text-sm mb-3" style={{ fontFamily: FONT_BODY, color: COLORS.text }}>
              Compte créé ✓ Vérifie ta boîte mail et clique sur le lien de confirmation avant de pouvoir te connecter.
            </p>
            <button
              onClick={() => setMode("login")}
              className="block text-xs underline"
              style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}
            >
              Retour à la connexion
            </button>
          </>
        ) : mode === "login" ? (
          <>
            <Field label="Adresse mail">
              <input type="email" className={inputClass} style={inputStyle} value={loginEmail} onChange={(e) => { setLoginEmail(e.target.value); setLoginError(""); }} placeholder="toi@exemple.com" />
            </Field>
            <Field label="Mot de passe">
              <PasswordInput
                value={password}
                onChange={(e) => { setPassword(e.target.value); setLoginError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") login(); }}
              />
            </Field>
            {loginError && <p className="text-xs mb-2" style={{ color: COLORS.accent, fontFamily: FONT_BODY }}>{loginError}</p>}
            <Btn variant="accent" onClick={login} disabled={loginBusy}><LogIn size={14} /> Se connecter</Btn>
            <button
              onClick={() => { setMode("forgot"); setForgotEmail(loginEmail); setForgotError(""); }}
              className="block mt-3 text-xs underline"
              style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}
            >
              Mot de passe oublié ?
            </button>
            <button
              onClick={() => { setMode("signup"); setLoginError(""); }}
              className="block mt-1 text-xs underline"
              style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}
            >
              Pas encore de compte ? Créer un compte
            </button>
          </>
        ) : mode === "forgot" ? (
          <>
            <p className="text-sm mb-3" style={{ fontFamily: FONT_BODY, color: COLORS.text }}>
              Indique ton adresse mail : tu recevras un lien pour choisir un nouveau mot de passe.
            </p>
            <Field label="Adresse mail">
              <input
                type="email"
                className={inputClass}
                style={inputStyle}
                value={forgotEmail}
                onChange={(e) => { setForgotEmail(e.target.value); setForgotError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") sendForgotPassword(); }}
                placeholder="toi@exemple.com"
              />
            </Field>
            {forgotError && <p className="text-xs mb-2" style={{ color: COLORS.accent, fontFamily: FONT_BODY }}>{forgotError}</p>}
            <Btn variant="accent" onClick={sendForgotPassword} disabled={forgotBusy}><Mail size={14} /> Envoyer le lien</Btn>
            <button
              onClick={() => { setMode("login"); setForgotError(""); }}
              className="block mt-3 text-xs underline"
              style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}
            >
              Retour à la connexion
            </button>
          </>
        ) : mode === "forgot-sent" ? (
          <>
            <p className="text-sm mb-3" style={{ fontFamily: FONT_BODY, color: COLORS.text }}>
              Email envoyé ✓ Clique sur le lien reçu pour choisir un nouveau mot de passe.
            </p>
            <button
              onClick={() => setMode("login")}
              className="block text-xs underline"
              style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}
            >
              Retour à la connexion
            </button>
          </>
        ) : (
          <>
            <Field label="Adresse mail">
              <input type="email" className={inputClass} style={inputStyle} value={signupEmail} onChange={(e) => { setSignupEmail(e.target.value); setSignupError(""); }} placeholder="toi@exemple.com" />
            </Field>
            <Field label="Identifiant">
              <input className={inputClass} style={inputStyle} value={signupUsername} onChange={(e) => { setSignupUsername(e.target.value); setSignupError(""); }} />
            </Field>
            <Field label="Mot de passe">
              <PasswordInput
                value={signupPassword}
                onChange={(e) => { setSignupPassword(e.target.value); setSignupError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") signup(); }}
              />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Nom de la troupe (optionnel)">
                <input className={inputClass} style={inputStyle} value={signupTroupe} onChange={(e) => setSignupTroupe(e.target.value)} placeholder="Les Idéphiles" />
              </Field>
              <Field label="Ville (optionnel)">
                <input className={inputClass} style={inputStyle} value={signupVille} onChange={(e) => setSignupVille(e.target.value)} placeholder="Montpellier" />
              </Field>
            </div>
            {signupError && <p className="text-xs mb-2" style={{ color: COLORS.accent, fontFamily: FONT_BODY }}>{signupError}</p>}
            <Btn variant="accent" onClick={signup} disabled={signupBusy}><LogIn size={14} /> Créer mon compte</Btn>
            <button
              onClick={() => { setMode("login"); setSignupError(""); }}
              className="block mt-3 text-xs underline"
              style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}
            >
              J'ai déjà un compte ? Se connecter
            </button>
          </>
        )}
      </IndexCard>

      {!isAdmin && currentUser && (
        <button onClick={() => setTab("parametres")} className="w-full text-left mt-2">
          <IndexCard style={{ cursor: "pointer" }}>
            <div className="flex items-center gap-3">
              <Pencil size={18} color={COLORS.textSoft} />
              <div>
                <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">Paramètres</div>
                <div style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-xs">
                  Identifiant et troupe(s).
                </div>
              </div>
            </div>
          </IndexCard>
        </button>
      )}

      {isAdmin && (
        <button onClick={() => setTab("moderation")} className="w-full text-left mt-4">
          <IndexCard style={{ cursor: "pointer", borderColor: nbPending > 0 ? COLORS.accent : COLORS.cardEdge }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertTriangle size={18} color={nbPending > 0 ? COLORS.accent : COLORS.textSoft} />
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">À valider</div>
                  <div style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-xs">
                    Exercices et catégories proposés par la communauté, en attente de validation.
                  </div>
                </div>
              </div>
              <span
                className="text-sm px-2 py-0.5 rounded-full"
                style={{
                  fontFamily: FONT_MONO,
                  background: nbPending > 0 ? COLORS.accent : COLORS.cardEdge + "55",
                  color: nbPending > 0 ? "#fff" : COLORS.textSoft,
                }}
              >
                {nbPending}
              </span>
            </div>
          </IndexCard>
        </button>
      )}

      {isAdmin && (
        <button onClick={() => setTab("messages")} className="w-full text-left mt-2">
          <IndexCard style={{ cursor: "pointer", borderColor: nbUnreadMessages > 0 ? COLORS.accent : COLORS.cardEdge }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Mail size={18} color={nbUnreadMessages > 0 ? COLORS.accent : COLORS.textSoft} />
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">Messages reçus</div>
                  <div style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-xs">
                    Messages et suggestions envoyés par les troupes utilisatrices.
                  </div>
                </div>
              </div>
              <span
                className="text-sm px-2 py-0.5 rounded-full"
                style={{
                  fontFamily: FONT_MONO,
                  background: nbUnreadMessages > 0 ? COLORS.accent : COLORS.cardEdge + "55",
                  color: nbUnreadMessages > 0 ? "#fff" : COLORS.textSoft,
                }}
              >
                {nbUnreadMessages}
              </span>
            </div>
          </IndexCard>
        </button>
      )}

      {isAdmin && (
        <button onClick={() => setTab("messages-envoyes")} className="w-full text-left mt-2">
          <IndexCard style={{ cursor: "pointer" }}>
            <div className="flex items-center gap-3">
              <Mail size={18} color={COLORS.textSoft} />
              <div>
                <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">Messages envoyés</div>
                <div style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-xs">
                  Réponses données et messages envoyés directement aux comptes.
                </div>
              </div>
            </div>
          </IndexCard>
        </button>
      )}

      {isAdmin && (
        <button onClick={() => setTab("comptes")} className="w-full text-left mt-2">
          <IndexCard style={{ cursor: "pointer" }}>
            <div className="flex items-center gap-3">
              <Contact size={18} color={COLORS.textSoft} />
              <div>
                <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">Comptes</div>
                <div style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-xs">
                  Pseudo, troupe et nombre d'exercices créés par chaque compte inscrit.
                </div>
              </div>
            </div>
          </IndexCard>
        </button>
      )}

      {isAdmin && (
        <button onClick={() => setTab("valides")} className="w-full text-left mt-2">
          <IndexCard style={{ cursor: "pointer" }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Check size={18} color={COLORS.textSoft} />
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">Validés</div>
                  <div style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-xs">
                    Exercices, catégories et concepts de spectacle proposés par les troupes et validés par la modération.
                  </div>
                </div>
              </div>
              <span
                className="text-sm px-2 py-0.5 rounded-full"
                style={{ fontFamily: FONT_MONO, background: COLORS.cardEdge + "55", color: COLORS.textSoft }}
              >
                {data.exercises.filter((e) => !e.pending && !e.rejected && e.creatorUsername).length
                  + data.categories.filter((c) => !c.pending && !c.rejected && c.creatorUsername).length
                  + data.showConcepts.filter((sc) => !sc.pending && !sc.rejected).length}
              </span>
            </div>
          </IndexCard>
        </button>
      )}

      {!isAdmin && currentUser && (
        <div className="grid grid-cols-2 gap-3 mb-4 mt-4">
          {stats.map((s) => (
            <button key={s.label} onClick={() => setTab(s.tab)} className="text-left">
              <IndexCard style={{ cursor: "pointer" }}>
                <s.icon size={16} color={COLORS.accent} />
                <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="text-2xl mt-1">{s.n}</div>
                <div style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase">{s.label}</div>
              </IndexCard>
            </button>
          ))}
        </div>
      )}

      {!isAdmin && currentUser && (
        <button onClick={() => setTab("mes-messages")} className="w-full text-left mt-4">
          <IndexCard style={{ cursor: "pointer", borderColor: nbUnreadReplies > 0 ? COLORS.accent : COLORS.cardEdge }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Mail size={18} color={nbUnreadReplies > 0 ? COLORS.accent : COLORS.textSoft} />
                <div>
                  <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">Messages reçus</div>
                  <div style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-xs">
                    Tes messages envoyés à l'Admin et ses réponses.
                  </div>
                </div>
              </div>
              <span
                className="text-sm px-2 py-0.5 rounded-full"
                style={{
                  fontFamily: FONT_MONO,
                  background: nbUnreadReplies > 0 ? COLORS.accent : COLORS.cardEdge + "55",
                  color: nbUnreadReplies > 0 ? "#fff" : COLORS.textSoft,
                }}
              >
                {nbUnreadReplies}
              </span>
            </div>
          </IndexCard>
        </button>
      )}

      {!isAdmin && currentUser && (
        <button onClick={() => setTab("messages-envoyes")} className="w-full text-left mt-2">
          <IndexCard style={{ cursor: "pointer" }}>
            <div className="flex items-center gap-3">
              <Mail size={18} color={COLORS.textSoft} />
              <div>
                <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">Messages envoyés</div>
                <div style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-xs">
                  Tes messages envoyés à l'Admin.
                </div>
              </div>
            </div>
          </IndexCard>
        </button>
      )}

      {!isAdmin && currentUser && (
        <IndexCard style={{ marginTop: 16 }}>
          <div className="flex items-center gap-3 mb-1">
            <Mail size={18} color={COLORS.accent} />
            <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">Contacter l'Admin</div>
          </div>
          <p className="text-xs mb-2" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
            Une suggestion pour l'appli, un bug, une question ? Envoie un message directement à l'équipe.
          </p>
          {contactSent && !contactOpen && (
            <p className="text-xs mb-2" style={{ fontFamily: FONT_BODY, color: COLORS.brass }}>
              Message envoyé ✓ Merci pour ton retour !
            </p>
          )}
          {!contactOpen ? (
            <Btn small variant="accent" onClick={() => { setContactOpen(true); setContactSent(false); }}><Mail size={13} /> Écrire un message</Btn>
          ) : (
            <>
              <textarea
                className={inputClass}
                style={inputStyle}
                rows={3}
                value={contactText}
                onChange={(e) => setContactText(e.target.value)}
                placeholder="Ton message pour l'Admin…"
              />
              <div className="flex gap-2 mt-2">
                <Btn small variant="accent" onClick={sendContactMessage}><Check size={13} /> Envoyer</Btn>
                <Btn small variant="ghost" onClick={() => { setContactOpen(false); setContactText(""); }}><X size={13} /> Annuler</Btn>
              </div>
            </>
          )}
        </IndexCard>
      )}

      {!realIsAdmin && currentUser && !deleteConfirmOpen && (
        <div className="flex justify-end mt-6">
          <Btn small variant="accent" onClick={() => { setDeleteConfirmOpen(true); setDeleteError(""); }}>
            Supprimer mon compte
          </Btn>
        </div>
      )}
      {!realIsAdmin && currentUser && deleteConfirmOpen && (
        <IndexCard style={{ borderColor: COLORS.accent, background: COLORS.accent + "11", marginTop: 24 }}>
          <p className="text-sm mb-3" style={{ fontFamily: FONT_BODY, color: COLORS.ink }}>
            Êtes-vous sûr de vouloir supprimer votre compte ? Votre compte n'existera plus mais vos contributions validées resteront dans la communauté.
          </p>
          {deleteError && <p className="text-xs mb-2" style={{ color: COLORS.accent, fontFamily: FONT_BODY }}>{deleteError}</p>}
          <div className="flex gap-2 justify-end">
            <Btn small variant="ghost" onClick={() => setDeleteConfirmOpen(false)} disabled={deleteBusy}>Non</Btn>
            <Btn small variant="accent" onClick={deleteAccount} disabled={deleteBusy}>Oui</Btn>
          </div>
        </IndexCard>
      )}
    </div>
  );
}

/* ---------- Paramètres (utilisateur non-admin : identifiant + troupe(s), un même comédien pouvant
   appartenir à plusieurs troupes) ---------- */
function ParametresTab({ setTab, currentUser, profile }) {
  const [username, setUsername] = useState(currentUser || "");
  const [troupes, setTroupes] = useState(() => (profile?.troupe || "").split(",").map((t) => t.trim()).filter(Boolean));
  const [troupeInput, setTroupeInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const addTroupe = () => {
    const v = troupeInput.trim();
    if (!v || troupes.includes(v)) { setTroupeInput(""); return; }
    setTroupes([...troupes, v]);
    setTroupeInput("");
    setSaved(false);
  };
  const removeTroupe = (t) => { setTroupes(troupes.filter((x) => x !== t)); setSaved(false); };

  const save = async () => {
    const uname = username.trim();
    if (!uname) { setError("L'identifiant ne peut pas être vide."); return; }
    setBusy(true);
    setError("");
    setSaved(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setBusy(false); return; }
    const { error: err } = await supabase
      .from("profiles")
      .update({ username: uname, troupe: troupes.join(", ") })
      .eq("id", user.id);
    setBusy(false);
    if (err) {
      setError(
        err.message?.includes("duplicate") || err.message?.includes("username")
          ? "Cet identifiant est déjà utilisé."
          : "Impossible d'enregistrer pour le moment. Réessaie plus tard."
      );
      return;
    }
    setSaved(true);
  };

  if (!currentUser) {
    return (
      <div>
        {setTab && <LibraryBackBtn label="Mon profil" onClick={() => setTab("profil")} />}
        <Empty text="Connecte-toi pour accéder aux paramètres." />
      </div>
    );
  }

  return (
    <div>
      {setTab && <LibraryBackBtn label="Mon profil" onClick={() => setTab("profil")} />}
      <SectionHeader icon={Pencil} title="Paramètres" subtitle="Identifiant et troupe(s)." />
      <IndexCard>
        <Field label="Identifiant">
          <input className={inputClass} style={inputStyle} value={username} onChange={(e) => { setUsername(e.target.value); setSaved(false); }} />
        </Field>
        <Field label="Troupe(s) — un même comédien peut appartenir à plusieurs troupes">
          {troupes.length > 0 && (
            <div className="flex flex-wrap mb-1">
              {troupes.map((t) => <TagPill key={t} label={t} color={COLORS.brass} onRemove={() => removeTroupe(t)} />)}
            </div>
          )}
          <div className="flex gap-1">
            <input
              className={inputClass}
              style={inputStyle}
              value={troupeInput}
              onChange={(e) => setTroupeInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTroupe(); } }}
              placeholder="Ajouter une troupe…"
            />
            <Btn small onClick={addTroupe}><Plus size={12} /></Btn>
          </div>
        </Field>
        {error && <p className="text-xs mb-2" style={{ color: COLORS.accent, fontFamily: FONT_BODY }}>{error}</p>}
        {saved && <p className="text-xs mb-2" style={{ color: COLORS.brass, fontFamily: FONT_BODY }}>Déconnecte puis reconnecte toi pour mettre à jour tes changements.</p>}
        <Btn variant="accent" onClick={save} disabled={busy}><Check size={14} /> Enregistrer</Btn>
      </IndexCard>
    </div>
  );
}

/* ---------- Exercices ---------- */
function ExerciseForm({ initial, showTypes, objectifsList, thematiquesList, familiesList, onCreateFamily, isAdmin, creatorTroupe, creatorUsername, onSave, onCancel }) {
  const [f, setF] = useState(
    initial || { title: "", summary: "", level: "Débutant", objectives: [], thematiques: [], players: 2, duration: 10, format: "Solo simultané", groupSize: 2, warmup: false, stageWarmup: false, application: false, showTypes: [], phase: "Impro", favorite: false, createdByUser: true, showTroupeOnCard: false }
  );
  const isCommunitySubmission = !initial && !isAdmin;
  return (
    <IndexCard>
      <Field label="Titre">
        <input className={inputClass} style={inputStyle} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </Field>
      <Field label="Résumé">
        <textarea className={inputClass} style={inputStyle} rows={2} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
      </Field>
      <Field label="Section de la bibliothèque">
        <select className={inputClass} style={inputStyle} value={f.phase || "Impro"} onChange={(e) => setF({ ...f, phase: e.target.value })}>
          {SECTIONS_EXERCICE.map((s) => <option key={s}>{s}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Niveau">
          <select className={inputClass} style={inputStyle} value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>
            {NIVEAUX.map((o) => <option key={o}>{o}</option>)}
          </select>
        </Field>
        <Field label="Nombre d'élèves (0 = illimité)">
          <select className={inputClass} style={inputStyle} value={f.players} onChange={(e) => setF({ ...f, players: Number(e.target.value) })}>
            <option value={0}>Illimité</option>
            {STUDENTS_COUNTS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Format de jeu">
        <select className={inputClass} style={inputStyle} value={f.format || "Solo simultané"} onChange={(e) => setF({ ...f, format: e.target.value })}>
          {FORMATS_JEU.map((o) => <option key={o}>{o}</option>)}
        </select>
        <p className="text-xs mt-1" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
          {f.format === "Tour à tour avec spectateur"
            ? "Un sous-groupe joue pendant que les autres regardent."
            : f.format === "En groupe simultané"
            ? "Plusieurs sous-groupes jouent en parallèle en même temps — exercice bruyant, à isoler entre deux exercices plus calmes."
            : f.format === "En cercle"
            ? "Tout le groupe est réuni en cercle et participe ensemble."
            : "Tout le groupe fait la même chose en même temps."}
        </p>
      </Field>
      {f.format === "Tour à tour avec spectateur" && (
        <Field label="Taille du sous-groupe qui joue à la fois">
          <input type="number" min={1} className={inputClass} style={inputStyle} value={f.groupSize || 2} onChange={(e) => setF({ ...f, groupSize: Number(e.target.value) })} />
        </Field>
      )}
      <Field label="Famille d'objectif travaillé">
        <SearchableSingleSelect
          allOptions={familiesList || TOUTES_LES_FAMILLES}
          value={f.groupe || ""}
          onChange={(v) => setF({ ...f, groupe: v })}
          placeholder="Chercher une famille…"
          allowCreate
          onCreate={onCreateFamily}
          createLabel={(v) => `+ Créer la famille "${v}"…`}
        />
      </Field>
      <Field label="Tags">
        <SearchableMultiSelect allOptions={objectifsList} selected={f.objectives} onChange={(v) => setF({ ...f, objectives: v })} placeholder="Chercher ou créer un tag…" />
      </Field>
      <Field label="Durée (minutes)">
        <input type="number" min={1} className={inputClass} style={inputStyle} value={f.duration} onChange={(e) => setF({ ...f, duration: Number(e.target.value) })} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Énergie">
          <select className={inputClass} style={inputStyle} value={f.energy || ""} onChange={(e) => setF({ ...f, energy: e.target.value })}>
            <option value="">Non précisée</option>
            {ENERGIES.map((en) => <option key={en}>{en}</option>)}
          </select>
        </Field>
        <Field label="Matériel">
          <input className={inputClass} style={inputStyle} value={f.material || ""} onChange={(e) => setF({ ...f, material: e.target.value })} placeholder="Aucun, Musique, Chaises…" />
        </Field>
      </div>
      <Field label="Utilisable en échauffement">
        <label className="flex items-center gap-2 text-sm" style={{ fontFamily: FONT_BODY, color: COLORS.text }}>
          <input type="checkbox" checked={f.warmup} onChange={(e) => setF({ ...f, warmup: e.target.checked })} />
          Oui, cet exercice peut servir d'échauffement rapide
        </label>
      </Field>
      {f.warmup && (
        <>
          <Field label="Échauffement de scène">
            <label className="flex items-center gap-2 text-sm" style={{ fontFamily: FONT_BODY, color: COLORS.text }}>
              <input type="checkbox" checked={!!f.stageWarmup} onChange={(e) => setF({ ...f, stageWarmup: e.target.checked })} />
              Cet échauffement peut servir d'échauffement de scène pour commencer un spectacle.
            </label>
          </Field>
          <Field label="Types de spectacle concernés (vide = tous)">
            <MultiTagPicker allOptions={showTypes} selected={f.showTypes} onChange={(v) => setF({ ...f, showTypes: v })} placeholder="Ajouter un type…" />
          </Field>
        </>
      )}
      {isCommunitySubmission && (
        <IndexCard style={{ background: COLORS.cardEdge + "33" }}>
          <p className="text-xs" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
            Pocket impro est avant tout un outil de partage entre troupes : ta création sera d'abord
            soumise à la validation de l'équipe, puis rendue publique dans la bibliothèque une fois validée.
          </p>
          {creatorTroupe && (
            <label className="flex items-center gap-2 text-sm mt-2" style={{ fontFamily: FONT_BODY, color: COLORS.text }}>
              <input type="checkbox" checked={!!f.showTroupeOnCard} onChange={(e) => setF({ ...f, showTroupeOnCard: e.target.checked })} />
              Afficher mon nom ({creatorUsername}) et le nom de ma troupe ({creatorTroupe}) sur la fiche
            </label>
          )}
        </IndexCard>
      )}
      <div className="flex gap-2 mt-2">
        <Btn variant="accent" onClick={() => onSave(f)}><Check size={14} /> Enregistrer</Btn>
        <Btn variant="ghost" onClick={onCancel}><X size={14} /> Annuler</Btn>
      </div>
    </IndexCard>
  );
}

// Bascule bien visible entre le classement par famille et par objectif précis (et/ou "Tout"),
// affichée en haut de page — partagée par Échauffements, Impro et Catégories.
function ClassementToggle({ active, onFamilles, onTags, onTout }) {
  return (
    <div>
      <div className="text-xs uppercase mb-1" style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }}>Trier</div>
      <div className="inline-flex rounded-sm overflow-hidden" style={{ border: `1px solid ${COLORS.accent}` }}>
        <button
          onClick={onFamilles}
          className="text-center py-1.5 text-sm px-3"
          style={{ fontFamily: FONT_DISPLAY, background: active === "familles" ? COLORS.accent : "transparent", color: active === "familles" ? "#fff" : COLORS.accent }}
        >
          Par famille
        </button>
        {onTags && (
          <button
            onClick={onTags}
            className="text-center py-1.5 text-sm px-3"
            style={{ fontFamily: FONT_DISPLAY, background: active === "tags" ? COLORS.accent : "transparent", color: active === "tags" ? "#fff" : COLORS.accent, borderLeft: `1px solid ${COLORS.accent}` }}
          >
            Par tags
          </button>
        )}
        {onTout && (
          <button
            onClick={onTout}
            className="text-center py-1.5 text-sm px-3"
            style={{ fontFamily: FONT_DISPLAY, background: active === "tout" ? COLORS.accent : "transparent", color: active === "tout" ? "#fff" : COLORS.accent, borderLeft: `1px solid ${COLORS.accent}` }}
          >
            Tout
          </button>
        )}
      </div>
    </div>
  );
}

/* Bloc "raison du refus" affiché sous une fiche en attente quand l'Admin clique sur "Refuser" — la
   raison est optionnelle mais, si renseignée, est jointe au message envoyé au créateur. */
function RejectReasonBox({ reason, setReason, onConfirm, onCancel }) {
  return (
    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
      <textarea
        className={inputClass}
        style={inputStyle}
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Raison du refus (optionnelle, envoyée au créateur)…"
      />
      <div className="flex gap-2 mt-1">
        <Btn small variant="accent" onClick={onConfirm}><Check size={13} /> Confirmer le refus</Btn>
        <Btn small variant="ghost" onClick={onCancel}>Annuler</Btn>
      </div>
    </div>
  );
}

function ExercicesTab({ data, update, isAdmin, currentUser, profile, onlyUserCreated, initialSearchQuery, setTab }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [view, setView] = useState({ type: "hub" }); // hub | echauffement-groupes | echauffement-groupe | echauffement-tags | echauffement-tag | preimpro | impro-groupes | impro-groupe | impro-tags | impro-tag
  // Remonte en haut de page à chaque changement de sous-page (ex. clic sur une famille) — sinon
  // la nouvelle page s'ouvre au même niveau de défilement que la précédente, ce qui n'est pas intuitif.
  useEffect(() => { window.scrollTo(0, 0); }, [view.type, view.groupe, view.tag]);
  const [tagQuery, setTagQuery] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState(null); // titre en doublon détecté
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || "");
  const [subQuery, setSubQuery] = useState(""); // recherche locale dans une sous-section (tag, pré-impro, impro)
  const [showAllEchauffements, setShowAllEchauffements] = useState(false);
  const [showAllPreImpro, setShowAllPreImpro] = useState(false);
  const [showAllImpro, setShowAllImpro] = useState(false);
  const [toastMsg, showToast] = useToast();

  const canCreate = isAdmin || !!currentUser;

  const baseExercises = onlyUserCreated ? data.exercises.filter((e) => e.creatorUsername === currentUser) : data.exercises.filter((e) => !e.pending && !e.rejected);

  // Stampe les champs de modération/attribution sur une nouvelle fiche : les créations Admin sont
  // publiées directement, les créations d'un compte utilisateur restent "pending" jusqu'à validation.
  // `approvalSeen` sert à afficher une seule fois le message "ta création a été validée" au créateur.
  const stampNewExercise = (f) => {
    const { showTroupeOnCard, ...rest } = f;
    return {
      ...rest,
      pending: !isAdmin,
      creatorUsername: isAdmin ? "" : (currentUser || ""),
      creatorTroupe: !isAdmin && showTroupeOnCard && profile?.troupe ? profile.troupe : "",
      approvalSeen: isAdmin,
    };
  };

  const saveNewExercise = (f) => {
    const isDuplicate = data.exercises.some((e) => normalize(e.title) === normalize(f.title));
    if (isDuplicate) {
      setDuplicateWarning(f);
      return;
    }
    update((d) => { d.exercises.push({ ...stampNewExercise(f), id: uid(), createdByUser: true }); return d; });
    setAdding(false);
    showToast(isAdmin ? "Exercice ajouté ✓" : "Exercice envoyé pour validation ✓");
  };
  const confirmAddDuplicate = () => {
    if (!duplicateWarning) return;
    update((d) => { d.exercises.push({ ...stampNewExercise(duplicateWarning), id: uid(), createdByUser: true }); return d; });
    setDuplicateWarning(null);
    setAdding(false);
  };
  const approveExercise = (id) => update((d) => {
    const e = d.exercises.find((x) => x.id === id);
    if (e) { e.pending = false; notifyCreatorApproved(d, e, "exercice"); }
    return d;
  });
  const rejectExercise = (id, reason) => update((d) => {
    const e = d.exercises.find((x) => x.id === id);
    if (e) { e.pending = false; e.rejected = true; notifyCreatorRejected(d, e, "exercice", reason); }
    return d;
  });
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const toggleFavorite = (id) => {
    if (!currentUser) { showToast("Désolé, il te faut un compte pour enregistrer tes créations !", { type: "notice" }); return; }
    update((d) => {
      const ex = d.exercises.find((x) => x.id === id);
      if (ex) ex.favorite = !ex.favorite;
      return d;
    });
  };

  const renderCard = (ex) =>
    editing === ex.id ? (
      <ExerciseForm
        familiesList={toutesLesFamillesWithCustom(data)}
        onCreateFamily={(name) => addCustomFamily(update, name)}
        key={ex.id}
        initial={ex}
        showTypes={data.showTypes}
        objectifsList={data.objectifs}
        showTypesList={data.showTypes}
        thematiquesList={data.thematiques}
        onSave={(f) => { update((d) => { const i = d.exercises.findIndex((x) => x.id === ex.id); d.exercises[i] = { ...f, id: ex.id }; return d; }); setEditing(null); }}
        onCancel={() => setEditing(null)}
      />
    ) : (
      <IndexCard key={ex.id}>
        <div className="flex justify-between items-start">
          <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="text-lg font-medium">{ex.title}</h3>
          <div className="flex gap-1">
            <button onClick={() => toggleFavorite(ex.id)} title="Favori">
              <Star size={22} color={ex.favorite ? COLORS.brass : COLORS.textSoft} fill={ex.favorite ? COLORS.brass : "none"} />
            </button>
            {isAdmin && ex.pending && (
              <>
                <Btn small variant="ghost" onClick={() => approveExercise(ex.id)}><Check size={13} /> Valider</Btn>
                <Btn small variant="ghost" onClick={() => { setRejectingId(ex.id); setRejectReason(""); }}><X size={13} /> Refuser</Btn>
              </>
            )}
            {isAdmin && <Btn small variant="ghost" onClick={() => setEditing(ex.id)}>Modifier</Btn>}
            {isAdmin && (
              <Btn small variant="ghost" onClick={() => update((d) => { d.exercises = d.exercises.filter((x) => x.id !== ex.id); return d; })}>
                Supprimer
              </Btn>
            )}
            {!isAdmin && (ex.pending || ex.rejected) && ex.creatorUsername === currentUser && (
              <Btn small variant="ghost" onClick={() => update((d) => { d.exercises = d.exercises.filter((x) => x.id !== ex.id); return d; })}>
                Supprimer
              </Btn>
            )}
          </div>
        </div>
        {ex.pending && (
          <p className="text-xs mb-1" style={{ fontFamily: FONT_MONO, color: COLORS.accent }}>
            En attente de validation — pas encore visible dans la bibliothèque publique.
          </p>
        )}
        {rejectingId === ex.id && (
          <RejectReasonBox
            reason={rejectReason}
            setReason={setRejectReason}
            onConfirm={() => { rejectExercise(ex.id, rejectReason.trim()); setRejectingId(null); setRejectReason(""); }}
            onCancel={() => { setRejectingId(null); setRejectReason(""); }}
          />
        )}
        <p style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-sm my-1">{ex.summary}</p>
        <div className="flex flex-wrap gap-1 mt-1 text-xs" style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }}>
          <span>{ex.level}</span>·<span>{ex.players > 0 ? `${ex.players} élève${ex.players > 1 ? "s" : ""}` : "Illimité"}</span>·<span>{ex.duration} min</span>
          {ex.energy && <span>· énergie {ex.energy}</span>}
          {ex.material && ex.material !== "Aucun" && <span>· {ex.material}</span>}
          {ex.objectives?.length > 0 && <>·<span>{ex.objectives.join(", ")}</span></>}
          {ex.thematiques?.length > 0 && <>·<span>Thématique : {ex.thematiques.join(", ")}</span></>}
          {ex.warmup && <span style={{ color: COLORS.accent }}>· Échauffement</span>}
          {ex.format === "Tour à tour avec spectateur" && <span style={{ color: COLORS.textSoft }}>· Tour à tour avec spectateur</span>}
          {ex.format === "En groupe simultané" && <span style={{ color: COLORS.accent }}>· En groupe simultané (bruyant)</span>}
          {ex.format === "En cercle" && <span style={{ color: COLORS.textSoft }}>· En cercle</span>}
          {ex.creatorTroupe && <span>· {ex.creatorUsername} — Troupe {ex.creatorTroupe}</span>}
        </div>
      </IndexCard>
    );

  const echauffements = baseExercises.filter((e) => e.phase === "Échauffement");
  const preImpro = baseExercises.filter((e) => e.phase === "Pré-impro");
  const impro = baseExercises.filter((e) => e.phase !== "Échauffement" && e.phase !== "Pré-impro");

  const grouped = {};
  echauffements.forEach((e) => {
    const objs = e.objectives?.length ? e.objectives : ["Sans objectif"];
    objs.forEach((o) => { (grouped[o] = grouped[o] || []).push(e); });
  });
  const objectifKeys = Object.keys(grouped).sort((a, b) => a.localeCompare(b, "fr"));

  const groupedPreImpro = {};
  preImpro.forEach((e) => {
    const objs = e.objectives?.length ? e.objectives : ["Sans objectif"];
    objs.forEach((o) => { (groupedPreImpro[o] = groupedPreImpro[o] || []).push(e); });
  });
  const objectifKeysPreImpro = Object.keys(groupedPreImpro).sort((a, b) => a.localeCompare(b, "fr"));

  const groupedImpro = {};
  impro.forEach((e) => {
    const objs = e.objectives?.length ? e.objectives : ["Sans objectif"];
    objs.forEach((o) => { (groupedImpro[o] = groupedImpro[o] || []).push(e); });
  });
  const objectifKeysImpro = Object.keys(groupedImpro).sort((a, b) => a.localeCompare(b, "fr"));

  // Classement "large" (groupe) : familles triées par ordre alphabétique sur cette page ; l'ordre
  // des exercices À L'INTÉRIEUR de chaque famille reste celui fourni par l'utilisateur.
  const echGroupOrderRaw = [];
  const groupedEchByGroupe = {};
  echauffements.forEach((e) => {
    const g = e.groupe || "Sans classement";
    if (!groupedEchByGroupe[g]) { groupedEchByGroupe[g] = []; echGroupOrderRaw.push(g); }
    groupedEchByGroupe[g].push(e);
  });
  const echGroupOrder = [...echGroupOrderRaw].sort((a, b) => a.localeCompare(b, "fr"));

  const improGroupOrderRaw = [];
  const groupedImproByGroupe = {};
  impro.forEach((e) => {
    const g = e.groupe || "Sans classement";
    if (!groupedImproByGroupe[g]) { groupedImproByGroupe[g] = []; improGroupOrderRaw.push(g); }
    groupedImproByGroupe[g].push(e);
  });
  const improGroupOrder = [...improGroupOrderRaw].sort((a, b) => a.localeCompare(b, "fr"));

  const BackBtn = ({ onClick, label }) => (
    <button onClick={onClick} className="flex items-center gap-1 mb-3 text-sm" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
      <ChevronLeft size={16} /> {label}
    </button>
  );

  const HubRow = ({ label, count, onClick, icon: Icon }) => (
    <button onClick={onClick} className="w-full text-left">
      <IndexCard style={{ cursor: "pointer" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Icon size={18} color={COLORS.accent} />
            <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">{label}</div>
          </div>
          <div className="flex items-center gap-2">
            <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs">{count}</span>
            <ChevronRight size={16} color={COLORS.textSoft} />
          </div>
        </div>
      </IndexCard>
    </button>
  );

  const addForm = adding && (
    <ExerciseForm
      familiesList={toutesLesFamillesWithCustom(data)}
      onCreateFamily={(name) => addCustomFamily(update, name)}
      showTypes={data.showTypes}
      objectifsList={data.objectifs}
        showTypesList={data.showTypes}
      thematiquesList={data.thematiques}
      isAdmin={isAdmin}
      creatorTroupe={profile?.troupe || ""}
      creatorUsername={currentUser}
      onSave={saveNewExercise}
      onCancel={() => setAdding(false)}
    />
  );

  const duplicatePrompt = duplicateWarning && (
    <IndexCard>
      <p className="text-sm mb-2" style={{ fontFamily: FONT_BODY, color: COLORS.text }}>
        Un exercice s'appelle déjà "{duplicateWarning.title}". Ajouter quand même ?
      </p>
      <div className="flex gap-2">
        <Btn variant="accent" onClick={confirmAddDuplicate}><Check size={14} /> Ajouter quand même</Btn>
        <Btn variant="ghost" onClick={() => setDuplicateWarning(null)}><X size={14} /> Annuler</Btn>
      </div>
    </IndexCard>
  );

  const adminNotice = !isAdmin && (
    <p className="text-xs mb-3 italic" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
      {currentUser
        ? "Tu peux proposer un exercice — connecte-toi en tant qu'Admin (onglet Mon profil) pour modifier ou supprimer une fiche existante."
        : "Connecte-toi ou crée un compte (onglet Mon profil) pour proposer un exercice."}
    </p>
  );

  const header = (
    <>
      {setTab && <LibraryBackBtn label={onlyUserCreated ? "Mon profil" : "Bibliothèque"} onClick={() => setTab(onlyUserCreated ? "profil" : "bibliotheque")} />}
      <SectionHeader
        icon={Users}
        title={onlyUserCreated ? "Exercices créés" : "Exercices"}
        subtitle="La base d'exercices pour construire tes cours."
      />
    </>
  );

  // Page "Exercices créés" (accessible depuis Mon profil) : liste simple des exercices proposés
  // par CE compte, sans reprendre toute la navigation par famille/tags de la bibliothèque générale.
  if (onlyUserCreated) {
    return (
      <div>
        {header}
        <Toast toast={toastMsg} />
        {duplicatePrompt}
        {baseExercises.length === 0 ? (
          <Empty text="Aucun exercice créé pour l'instant." />
        ) : (
          baseExercises.map(renderCard)
        )}
      </div>
    );
  }

  if (view.type === "echauffement-groupe") {
    const exos = groupedEchByGroupe[view.groupe] || [];
    const sq = normalize(subQuery);
    const filteredExos = [...(sq ? echauffements.filter((e) => matchesKeywords(subQuery, e.title, e.groupe, (e.thematiques || []).join(" "), (e.objectives || []).join(" "), e.level)) : exos)].sort((a, b) => a.title.localeCompare(b.title, "fr"));
    return (
      <div>
        <BackBtn label="Échauffements" onClick={() => { setView({ type: "echauffement-groupes" }); setSubQuery(""); }} />
        <SectionHeader icon={Flame} title={view.groupe} subtitle={`${exos.length} exercice(s) d'échauffement`} />
        <Toast toast={toastMsg} />
        {adminNotice}
        <div className="flex justify-end mb-3">
          {canCreate && !adding && <Btn small variant="accent" onClick={() => setAdding(true)}><Plus size={13} /> {isAdmin ? "Ajouter" : "Soumettre"} un exercice</Btn>}
        </div>
        {addForm}
        <input
          className={inputClass}
          style={{ ...inputStyle, marginBottom: 12 }}
          value={subQuery}
          onChange={(e) => setSubQuery(e.target.value)}
          placeholder="Chercher un exercice dans cette section…"
        />
        {filteredExos.length === 0 ? <Empty text="Aucun exercice dans cette section." /> : filteredExos.map(renderCard)}
      </div>
    );
  }

  if (view.type === "echauffement-groupes") {
    const q = normalize(tagQuery);
    const matchingFamilies = q ? echGroupOrder.filter((g) => matchesKeywords(tagQuery, g)) : [];
    const matchingTags = q ? objectifKeys.filter((o) => matchesKeywords(tagQuery, o)) : [];
    const matchedByName = q ? echauffements.filter((e) => matchesKeywords(tagQuery, e.title, e.groupe, (e.thematiques || []).join(" "), (e.objectives || []).join(" "), e.level)) : [];
    return (
      <div>
        <BackBtn label="Exercices" onClick={() => setView({ type: "hub" })} />
        <SectionHeader icon={Flame} title="Échauffements" subtitle="Classement par grande famille d'objectifs d'échauffement." />
        <div className="flex items-end justify-between gap-2 mb-3">
          <ClassementToggle active="familles" onFamilles={() => {}} onTout={() => { setShowAllEchauffements(true); setView({ type: "echauffement-tags" }); setTagQuery(""); }} />
          {canCreate && !adding && <Btn small variant="accent" onClick={() => setAdding(true)}><Plus size={13} /> {isAdmin ? "Ajouter" : "Soumettre"} un exercice</Btn>}
        </div>
        <Toast toast={toastMsg} />
        {adminNotice}
        {addForm}
        <input
          className={inputClass}
          style={{ ...inputStyle, marginBottom: 12 }}
          value={tagQuery}
          onChange={(e) => setTagQuery(e.target.value)}
          placeholder="Nom d'exercice, famille d'objectifs ou tag…"
        />
        {matchingFamilies.map((g) => (
          <HubRow key={`fam-${g}`} label={g} count={groupedEchByGroupe[g].length} icon={Tag} onClick={() => { setView({ type: "echauffement-groupe", groupe: g }); setSubQuery(""); setTagQuery(""); }} />
        ))}
        {matchingTags.map((o) => (
          <HubRow key={`tag-${o}`} label={o} count={grouped[o].length} icon={Tag} onClick={() => { setView({ type: "echauffement-tag", tag: o }); setSubQuery(""); setTagQuery(""); }} />
        ))}
        {matchedByName.length > 0 && (
          <div className="mb-4">
            <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase">Exercices correspondants</span>
            {matchedByName.map(renderCard)}
          </div>
        )}
        {!q && (
          <>
            {echGroupOrder.length === 0 && <Empty text="Aucun échauffement pour l'instant." />}
            {echGroupOrder.map((g) => (
              <HubRow key={g} label={g} count={groupedEchByGroupe[g].length} icon={Tag} onClick={() => { setView({ type: "echauffement-groupe", groupe: g }); setSubQuery(""); }} />
            ))}
          </>
        )}
      </div>
    );
  }

  if (view.type === "echauffement-tag") {
    const exos = grouped[view.tag] || [];
    const sq = normalize(subQuery);
    const filteredExos = [...(sq ? echauffements.filter((e) => matchesKeywords(subQuery, e.title, e.groupe, (e.thematiques || []).join(" "), (e.objectives || []).join(" "), e.level)) : exos)].sort((a, b) => a.title.localeCompare(b.title, "fr"));
    return (
      <div>
        <BackBtn label="Échauffements" onClick={() => { setView({ type: "echauffement-tags" }); setSubQuery(""); }} />
        <SectionHeader icon={Flame} title={view.tag} subtitle={`${exos.length} exercice(s) d'échauffement`} />
        <Toast toast={toastMsg} />
        {adminNotice}
        {canCreate && !adding && <Btn small variant="accent" onClick={() => setAdding(true)}><Plus size={13} /> {isAdmin ? "Ajouter" : "Soumettre"} un exercice</Btn>}
        {addForm}
        <input
          className={inputClass}
          style={{ ...inputStyle, marginBottom: 12 }}
          value={subQuery}
          onChange={(e) => setSubQuery(e.target.value)}
          placeholder="Chercher un exercice dans cette section…"
        />
        {filteredExos.length === 0 ? <Empty text="Aucun exercice pour ce tag." /> : filteredExos.map(renderCard)}
      </div>
    );
  }

  if (view.type === "echauffement-tags") {
    const q = normalize(tagQuery);
    const matchingTags = q ? objectifKeys.filter((o) => matchesKeywords(tagQuery, o)) : [];
    const displayedKeys = q
      ? [
          ...objectifKeys.filter((o) => matchesKeywords(tagQuery, o)),
          ...objectifKeys.filter((o) => !matchesKeywords(tagQuery, o)),
        ]
      : objectifKeys;
    const matchedByTitle = q ? echauffements.filter((e) => matchesKeywords(tagQuery, e.title, e.groupe, (e.thematiques || []).join(" "), (e.objectives || []).join(" "), e.level)) : [];
    return (
      <div>
        <BackBtn label="Échauffements" onClick={() => setView({ type: "echauffement-groupes" })} />
        <SectionHeader icon={Flame} title="Échauffements par objectif" subtitle="Choisis un objectif pour voir les exercices correspondants." />
        <div className="flex items-end justify-between gap-2 mb-3">
          <ClassementToggle active="tout" onFamilles={() => { setShowAllEchauffements(false); setView({ type: "echauffement-groupes" }); setTagQuery(""); }} onTout={() => setShowAllEchauffements(true)} />
          {canCreate && !adding && <Btn small variant="accent" onClick={() => setAdding(true)}><Plus size={13} /> {isAdmin ? "Ajouter" : "Soumettre"} un exercice</Btn>}
        </div>
        <Toast toast={toastMsg} />
        {adminNotice}
        {addForm}
        <input
          className={inputClass}
          style={{ ...inputStyle, marginBottom: 12 }}
          value={tagQuery}
          onChange={(e) => setTagQuery(e.target.value)}
          placeholder="Rechercher un objectif ou le titre d'un exercice…"
        />
        {matchingTags.length > 0 && matchingTags.map((obj) => (
          <HubRow key={obj} label={obj} count={grouped[obj].length} icon={Tag} onClick={() => { setView({ type: "echauffement-tag", tag: obj }); setSubQuery(""); }} />
        ))}
        {matchedByTitle.length > 0 && (
          <div className="mb-4">
            <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase">Exercices correspondants</span>
            {matchedByTitle.slice().sort((a, b) => a.title.localeCompare(b.title, "fr")).map(renderCard)}
          </div>
        )}
        {showAllEchauffements ? (
          echauffements.length === 0 ? <Empty text="Aucun échauffement pour l'instant." /> : (
            <div className="mt-3">
              {[...echauffements].sort((a, b) => a.title.localeCompare(b.title, "fr")).map(renderCard)}
            </div>
          )
        ) : (
          <>
            {objectifKeys.length === 0 && <Empty text="Aucun échauffement pour l'instant." />}
            {!q && groupByLetter(displayedKeys).map(({ letter, items }) => (
              <div key={letter}>
                <div style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase mt-3 mb-1">{letter}</div>
                {items.map((obj) => (
                  <HubRow key={obj} label={obj} count={grouped[obj].length} icon={Tag} onClick={() => { setView({ type: "echauffement-tag", tag: obj }); setSubQuery(""); }} />
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  if (view.type === "preimpro") {
    const sq = normalize(subQuery);
    const filteredExos = (sq ? preImpro.filter((e) => matchesKeywords(subQuery, e.title, e.groupe, (e.thematiques || []).join(" "), (e.objectives || []).join(" "), e.level)) : preImpro)
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title, "fr"));
    return (
      <div>
        <BackBtn label="Exercices" onClick={() => { setView({ type: "hub" }); setSubQuery(""); }} />
        <SectionHeader icon={Sparkles} title="Exercices pré-impro" subtitle="Classés par ordre alphabétique." />
        <Toast toast={toastMsg} />
        {adminNotice}
        <div className="flex justify-end mb-3">
          {canCreate && !adding && <Btn small variant="accent" onClick={() => setAdding(true)}><Plus size={13} /> {isAdmin ? "Ajouter" : "Soumettre"} un exercice</Btn>}
        </div>
        {addForm}
        <input
          className={inputClass}
          style={{ ...inputStyle, marginBottom: 12 }}
          value={subQuery}
          onChange={(e) => setSubQuery(e.target.value)}
          placeholder="Chercher un exercice…"
        />
        {filteredExos.length === 0 ? <Empty text="Aucun exercice pré-impro pour l'instant." /> : filteredExos.map(renderCard)}
      </div>
    );
  }

  if (view.type === "impro-groupe") {
    const exos = groupedImproByGroupe[view.groupe] || [];
    const sq = normalize(subQuery);
    const filteredExos = [...(sq ? impro.filter((e) => matchesKeywords(subQuery, e.title, e.groupe, (e.thematiques || []).join(" "), (e.objectives || []).join(" "), e.level)) : exos)].sort((a, b) => a.title.localeCompare(b.title, "fr"));
    return (
      <div>
        <BackBtn label="Exercices Impro" onClick={() => { setView({ type: "impro-groupes" }); setSubQuery(""); }} />
        <SectionHeader icon={Theater} title={view.groupe} subtitle={`${exos.length} exercice(s) impro`} />
        <Toast toast={toastMsg} />
        {adminNotice}
        <div className="flex justify-end mb-3">
          {canCreate && !adding && <Btn small variant="accent" onClick={() => setAdding(true)}><Plus size={13} /> {isAdmin ? "Ajouter" : "Soumettre"} un exercice</Btn>}
        </div>
        {addForm}
        <input
          className={inputClass}
          style={{ ...inputStyle, marginBottom: 12 }}
          value={subQuery}
          onChange={(e) => setSubQuery(e.target.value)}
          placeholder="Chercher un exercice dans cette section…"
        />
        {filteredExos.length === 0 ? <Empty text="Aucun exercice dans cette section." /> : filteredExos.map(renderCard)}
      </div>
    );
  }

  if (view.type === "impro-groupes") {
    const q = normalize(tagQuery);
    const matchingFamilies = q ? improGroupOrder.filter((g) => matchesKeywords(tagQuery, g)) : [];
    const matchingTags = q ? objectifKeysImpro.filter((o) => matchesKeywords(tagQuery, o)) : [];
    const matchedByName = q ? impro.filter((e) => matchesKeywords(tagQuery, e.title, e.groupe, (e.thematiques || []).join(" "), (e.objectives || []).join(" "), e.level)) : [];
    return (
      <div>
        <BackBtn label="Exercices" onClick={() => setView({ type: "hub" })} />
        <SectionHeader icon={Theater} title="Exercices Impro" subtitle="Classement par grande famille d'objectifs de travail." />
        <div className="flex items-end justify-between gap-2 mb-3">
          <ClassementToggle active="familles" onFamilles={() => {}} onTout={() => { setShowAllImpro(true); setView({ type: "impro-tags" }); setTagQuery(""); }} />
          {canCreate && !adding && <Btn small variant="accent" onClick={() => setAdding(true)}><Plus size={13} /> {isAdmin ? "Ajouter" : "Soumettre"} un exercice</Btn>}
        </div>
        <Toast toast={toastMsg} />
        {adminNotice}
        {addForm}
        <input
          className={inputClass}
          style={{ ...inputStyle, marginBottom: 12 }}
          value={tagQuery}
          onChange={(e) => setTagQuery(e.target.value)}
          placeholder="Nom d'exercice, famille d'objectifs ou tag…"
        />
        {matchingFamilies.map((g) => (
          <HubRow key={`fam-${g}`} label={g} count={groupedImproByGroupe[g].length} icon={Tag} onClick={() => { setView({ type: "impro-groupe", groupe: g }); setSubQuery(""); setTagQuery(""); }} />
        ))}
        {matchingTags.map((o) => (
          <HubRow key={`tag-${o}`} label={o} count={groupedImpro[o].length} icon={Tag} onClick={() => { setView({ type: "impro-tag", tag: o }); setSubQuery(""); setTagQuery(""); }} />
        ))}
        {matchedByName.length > 0 && (
          <div className="mb-4">
            <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase">Exercices correspondants</span>
            {matchedByName.map(renderCard)}
          </div>
        )}
        {!q && (
          <>
            {improGroupOrder.length === 0 && <Empty text="Aucun exercice impro pour l'instant." />}
            {improGroupOrder.map((g) => (
              <HubRow key={g} label={g} count={groupedImproByGroupe[g].length} icon={Tag} onClick={() => { setView({ type: "impro-groupe", groupe: g }); setSubQuery(""); }} />
            ))}
          </>
        )}
      </div>
    );
  }

  if (view.type === "impro-tags") {
    const q = normalize(tagQuery);
    const matchingTagsImpro = q ? objectifKeysImpro.filter((o) => matchesKeywords(tagQuery, o)) : [];
    const displayedKeysImpro = q
      ? [
          ...objectifKeysImpro.filter((o) => matchesKeywords(tagQuery, o)),
          ...objectifKeysImpro.filter((o) => !matchesKeywords(tagQuery, o)),
        ]
      : objectifKeysImpro;
    const matchedByTitleImpro = q ? impro.filter((e) => matchesKeywords(tagQuery, e.title, e.groupe, (e.thematiques || []).join(" "), (e.objectives || []).join(" "), e.level)) : [];
    return (
      <div>
        <BackBtn label="Exercices Impro" onClick={() => setView({ type: "impro-groupes" })} />
        <SectionHeader icon={Theater} title="Exercices Impro par objectif" subtitle="Choisis un objectif pour voir les exercices correspondants." />
        <div className="flex items-end justify-between gap-2 mb-3">
          <ClassementToggle active="tout" onFamilles={() => { setShowAllImpro(false); setView({ type: "impro-groupes" }); setTagQuery(""); }} onTout={() => setShowAllImpro(true)} />
          {canCreate && !adding && <Btn small variant="accent" onClick={() => setAdding(true)}><Plus size={13} /> {isAdmin ? "Ajouter" : "Soumettre"} un exercice</Btn>}
        </div>
        <Toast toast={toastMsg} />
        {adminNotice}
        {addForm}
        <input
          className={inputClass}
          style={{ ...inputStyle, marginBottom: 12 }}
          value={tagQuery}
          onChange={(e) => setTagQuery(e.target.value)}
          placeholder="Rechercher un objectif ou le titre d'un exercice…"
        />
        {matchingTagsImpro.length > 0 && matchingTagsImpro.map((obj) => (
          <HubRow key={obj} label={obj} count={groupedImpro[obj].length} icon={Tag} onClick={() => { setView({ type: "impro-tag", tag: obj }); setSubQuery(""); }} />
        ))}
        {matchedByTitleImpro.length > 0 && (
          <div className="mb-4">
            <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase">Exercices correspondants</span>
            {matchedByTitleImpro.slice().sort((a, b) => a.title.localeCompare(b.title, "fr")).map(renderCard)}
          </div>
        )}
        {showAllImpro ? (
          impro.length === 0 ? <Empty text="Aucun exercice impro pour l'instant." /> : (
            <div>{[...impro].sort((a, b) => a.title.localeCompare(b.title, "fr")).map(renderCard)}</div>
          )
        ) : (
          <>
            {objectifKeysImpro.length === 0 && <Empty text="Aucun exercice impro pour l'instant." />}
            {!q && groupByLetter(displayedKeysImpro).map(({ letter, items }) => (
              <div key={letter}>
                <div style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase mt-3 mb-1">{letter}</div>
                {items.map((obj) => (
                  <HubRow key={obj} label={obj} count={groupedImpro[obj].length} icon={Tag} onClick={() => { setView({ type: "impro-tag", tag: obj }); setSubQuery(""); }} />
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  if (view.type === "impro-tag") {
    const exos = groupedImpro[view.tag] || [];
    const sq = normalize(subQuery);
    const filteredExos = [...(sq ? impro.filter((e) => matchesKeywords(subQuery, e.title, e.groupe, (e.thematiques || []).join(" "), (e.objectives || []).join(" "), e.level)) : exos)].sort((a, b) => a.title.localeCompare(b.title, "fr"));
    return (
      <div>
        <BackBtn label="Exercices Impro" onClick={() => { setView({ type: "impro-tags" }); setSubQuery(""); }} />
        <SectionHeader icon={Theater} title={view.tag} subtitle={`${exos.length} exercice(s) impro`} />
        <Toast toast={toastMsg} />
        {adminNotice}
        {canCreate && !adding && <Btn small variant="accent" onClick={() => setAdding(true)}><Plus size={13} /> {isAdmin ? "Ajouter" : "Soumettre"} un exercice</Btn>}
        {addForm}
        <input
          className={inputClass}
          style={{ ...inputStyle, marginBottom: 12 }}
          value={subQuery}
          onChange={(e) => setSubQuery(e.target.value)}
          placeholder="Chercher un exercice dans cette section…"
        />
        {filteredExos.length === 0 ? <Empty text="Aucun exercice pour ce tag." /> : filteredExos.map(renderCard)}
      </div>
    );
  }

  return (
    <div>
      {header}
      <Toast toast={toastMsg} />
      {adminNotice}
      {canCreate && !adding && (
        <div className="flex justify-end mb-3">
          <Btn small variant="accent" onClick={() => setAdding(true)}><Plus size={13} /> {isAdmin ? "Ajouter" : "Soumettre"} un exercice</Btn>
        </div>
      )}
      {addForm}
      {duplicatePrompt}
      <Field label="Chercher la fiche d'un exercice">
        <input
          className={inputClass}
          style={inputStyle}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Nom de l'exercice ou objectif…"
        />
      </Field>
      {searchQuery.trim() && (
        <div className="mb-4">
          {(() => {
            const matchingEch = objectifKeys.filter((o) => matchesKeywords(searchQuery, o));
            const matchingPre = objectifKeysPreImpro.filter((o) => matchesKeywords(searchQuery, o));
            const matchingImp = objectifKeysImpro.filter((o) => matchesKeywords(searchQuery, o));
            const matchingEchFam = echGroupOrder.filter((g) => matchesKeywords(searchQuery, g));
            const matchingImpFam = improGroupOrder.filter((g) => matchesKeywords(searchQuery, g));
            const results = baseExercises.filter((e) => matchesKeywords(searchQuery, e.title, e.groupe, (e.objectives || []).join(" "), (e.thematiques || []).join(" "), e.level)).sort((a, b) => a.title.localeCompare(b.title, "fr"));
            return (
              <>
                {matchingEchFam.map((g) => (
                  <button key={`echfam-${g}`} onClick={() => { setView({ type: "echauffement-groupe", groupe: g }); setSubQuery(""); }} className="w-full text-left">
                    <IndexCard style={{ cursor: "pointer" }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Flame size={18} color={COLORS.accent} />
                          <div>
                            <span style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase">Famille d'objectifs — Échauffements</span>
                            <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">{g}</div>
                          </div>
                        </div>
                        <ChevronRight size={16} color={COLORS.textSoft} />
                      </div>
                    </IndexCard>
                  </button>
                ))}
                {matchingImpFam.map((g) => (
                  <button key={`impfam-${g}`} onClick={() => { setView({ type: "impro-groupe", groupe: g }); setSubQuery(""); }} className="w-full text-left">
                    <IndexCard style={{ cursor: "pointer" }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Theater size={18} color={COLORS.accent} />
                          <div>
                            <span style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase">Famille d'objectifs — Impro</span>
                            <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">{g}</div>
                          </div>
                        </div>
                        <ChevronRight size={16} color={COLORS.textSoft} />
                      </div>
                    </IndexCard>
                  </button>
                ))}
                {matchingEch.map((o) => (
                  <button key={`ech-${o}`} onClick={() => { setView({ type: "echauffement-tag", tag: o }); setSubQuery(""); }} className="w-full text-left">
                    <IndexCard style={{ cursor: "pointer" }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Flame size={18} color={COLORS.accent} />
                          <div>
                            <span style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase">Échauffements</span>
                            <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">{o}</div>
                          </div>
                        </div>
                        <ChevronRight size={16} color={COLORS.textSoft} />
                      </div>
                    </IndexCard>
                  </button>
                ))}
                {matchingImp.map((o) => (
                  <button key={`imp-${o}`} onClick={() => { setView({ type: "impro-tag", tag: o }); setSubQuery(""); }} className="w-full text-left">
                    <IndexCard style={{ cursor: "pointer" }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Theater size={18} color={COLORS.accent} />
                          <div>
                            <span style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase">Impro</span>
                            <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">{o}</div>
                          </div>
                        </div>
                        <ChevronRight size={16} color={COLORS.textSoft} />
                      </div>
                    </IndexCard>
                  </button>
                ))}
                {results.length === 0 && matchingEch.length === 0 && matchingPre.length === 0 && matchingImp.length === 0 && matchingEchFam.length === 0 && matchingImpFam.length === 0 ? (
                  <Empty text="Aucun exercice ne correspond." />
                ) : (
                  results.map(renderCard)
                )}
              </>
            );
          })()}
        </div>
      )}
      <HubRow label="Échauffements" count={echauffements.length} icon={Flame} onClick={() => setView({ type: "echauffement-groupes" })} />
      <HubRow label="Exercices pré-impro" count={preImpro.length} icon={Sparkles} onClick={() => setView({ type: "preimpro" })} />
      <HubRow label="Exercices Impro" count={impro.length} icon={Theater} onClick={() => setView({ type: "impro-groupes" })} />
    </div>
  );
}

function Empty({ text }) {
  return <p style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-sm italic">{text}</p>;
}

/* Petit message de confirmation flottant, auto-masqué après quelques secondes. */
function Toast({ toast }) {
  if (!toast) return null;
  const { message, type = "success" } = toast;
  const isNotice = type === "notice";
  return (
    <div
      style={{
        position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)", zIndex: 60,
        background: isNotice ? "#B3382C" : "#3B6E5E", color: "#fff",
        padding: isNotice ? "12px 20px" : "8px 16px", borderRadius: isNotice ? 14 : 999,
        fontFamily: FONT_BODY, fontSize: isNotice ? 15 : 14, fontWeight: isNotice ? 700 : 400,
        boxShadow: isNotice ? "0 6px 20px rgba(0,0,0,0.4)" : "0 4px 12px rgba(0,0,0,0.25)",
        display: "flex", alignItems: "center", gap: isNotice ? 8 : 6,
        maxWidth: "90vw", whiteSpace: "normal", textAlign: "center", lineHeight: 1.3,
        border: isNotice ? "2px solid #fff" : "none",
      }}
    >
      {isNotice ? <AlertTriangle size={18} style={{ flexShrink: 0 }} /> : <Check size={14} style={{ flexShrink: 0 }} />}
      {message}
    </div>
  );
}
// Petit hook pour afficher un Toast pendant ~2,5s (~4,5s pour un type "notice", plus long à lire)
// après une action réussie ou un point d'attention (repli de tirage épuisé, etc.).
// Fige la position de scroll au moment de l'appel à `save()` et la réimpose juste après le prochain
// rendu (puis encore une fois au frame suivant et 300ms plus tard, pour couvrir la fermeture animée
// du clavier virtuel mobile). Sert à éviter le saut vers le bas de page quand la fermeture d'un
// picker (recherche d'exercice/catégorie) réduit soudainement la hauteur du document : sans ça, le
// navigateur clampe le scroll à la nouvelle hauteur, ce qui envoie l'utilisateur tout en bas.
function usePreserveScroll() {
  const scrollYRef = useRef(null);
  useLayoutEffect(() => {
    if (scrollYRef.current === null) return;
    const y = scrollYRef.current;
    scrollYRef.current = null;
    window.scrollTo(0, y);
    requestAnimationFrame(() => window.scrollTo(0, y));
    const t = setTimeout(() => window.scrollTo(0, y), 300);
    return () => clearTimeout(t);
  });
  return () => { scrollYRef.current = window.scrollY; };
}

function useToast() {
  const [toast, setToast] = useState(null);
  const show = (message, opts = {}) => {
    const type = opts.type || "success";
    setToast({ message, type });
    setTimeout(() => setToast(null), opts.duration || (type === "notice" ? 4500 : 2500));
  };
  return [toast, show];
}

/* Regroupe une liste de libellés (tags) par première lettre, pour un affichage type répertoire. */
function groupByLetter(items) {
  const groups = {};
  items.forEach((item) => {
    const stripped = normalize(item);
    const letter = stripped ? stripped[0].toUpperCase() : "#";
    (groups[letter] = groups[letter] || []).push(item);
  });
  return Object.keys(groups).sort().map((letter) => ({ letter, items: groups[letter] }));
}

/* ---------- Catégories ---------- */
function CategoryForm({ initial, thematiquesList, objectifsList, showTypesList, familiesList, onCreateFamily, isAdmin, creatorTroupe, creatorUsername, onSave, onCancel }) {
  const [f, setF] = useState(
    initial || {
      name: "", summary: "", rules: "", thematiques: [], tags: [], duration: 5, archetypes: [],
      level: "", playersMin: 2, playersMax: 6, energy: "", material: "", codes: [], advice: "", durationLabel: "",
      objectives: [], showTypes: [], favorite: false, createdByUser: true, showTroupeOnCard: false, canOpenShow: false, canCloseShow: false,
    }
  );
  const [newArch, setNewArch] = useState({ name: "", desc: "" });
  const isCommunitySubmission = !initial && !isAdmin;

  return (
    <IndexCard>
      <Field label="Titre"><input className={inputClass} style={inputStyle} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Description"><textarea className={inputClass} style={inputStyle} rows={2} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></Field>
      <Field label="Genre (Intervention MC, Mot, Physique...)">
        <MultiTagPicker allOptions={CATEGORY_TAGS} selected={f.tags || []} onChange={(v) => setF({ ...f, tags: v })} placeholder="Ajouter un genre…" />
      </Field>
      <Field label="Tags précis (mots-clés de recherche, utilisés aussi pour prioriser cette catégorie en fin de cours)">
        <SearchableMultiSelect allOptions={objectifsList} selected={f.objectives || []} onChange={(v) => setF({ ...f, objectives: v })} placeholder="Chercher ou créer un tag…" />
      </Field>
      <Field label="Types de spectacle (Cabaret, Match...)">
        <MultiTagPicker allOptions={showTypesList || []} selected={f.showTypes || []} onChange={(v) => setF({ ...f, showTypes: v })} placeholder="Ajouter un type de spectacle…" />
      </Field>
      <Field label="Ouverture de spectacle">
        <label className="flex items-center gap-2 text-sm" style={{ fontFamily: FONT_BODY, color: COLORS.text }}>
          <input type="checkbox" checked={!!f.canOpenShow} onChange={(e) => setF({ ...f, canOpenShow: e.target.checked })} />
          Cette catégorie peut-elle servir pour commencer un spectacle ?
        </label>
      </Field>
      <Field label="Fermeture de spectacle">
        <label className="flex items-center gap-2 text-sm" style={{ fontFamily: FONT_BODY, color: COLORS.text }}>
          <input type="checkbox" checked={!!f.canCloseShow} onChange={(e) => setF({ ...f, canCloseShow: e.target.checked })} />
          Cette catégorie peut servir pour terminer un spectacle
        </label>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Nombre de joueurs min">
          <select className={inputClass} style={inputStyle} value={f.playersMin || 2} onChange={(e) => setF({ ...f, playersMin: Number(e.target.value) })}>
            {PLAYERS_COUNTS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Nombre de joueurs max">
          <select className={inputClass} style={inputStyle} value={f.playersMax || 6} onChange={(e) => setF({ ...f, playersMax: Number(e.target.value) })}>
            {PLAYERS_COUNTS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Niveau">
          <select className={inputClass} style={inputStyle} value={f.level || ""} onChange={(e) => setF({ ...f, level: e.target.value })}>
            <option value="">Non précisé</option>
            {NIVEAUX.map((n) => <option key={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Énergie">
          <select className={inputClass} style={inputStyle} value={f.energy || ""} onChange={(e) => setF({ ...f, energy: e.target.value })}>
            <option value="">Non précisée</option>
            {ENERGIES.map((en) => <option key={en}>{en}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Durée suggérée (minutes)">
        <input type="number" min={1} className={inputClass} style={inputStyle} value={f.duration} onChange={(e) => setF({ ...f, duration: Number(e.target.value) })} />
      </Field>
      <Field label="Matériel">
        <input className={inputClass} style={inputStyle} value={f.material || ""} onChange={(e) => setF({ ...f, material: e.target.value })} placeholder="Aucun, Musique, Chaises…" />
      </Field>
      <Field label="Famille d'objectif pédagogique">
        <SearchableMultiSelect
          allOptions={familiesList || OBJECTIFS_PEDAGOGIQUES_RESUME}
          selected={f.famillesObjectifs || []}
          onChange={(v) => setF({ ...f, famillesObjectifs: v })}
          placeholder="Chercher une famille d'objectifs…"
          onCreate={onCreateFamily}
          createLabel={(v) => `+ Créer la famille "${v}"…`}
        />
      </Field>
      <Field label="Archétypes liés à cette catégorie">
        {f.archetypes.map((a) => (
          <div key={a.id} className="flex justify-between items-start text-sm mb-1 border-b pb-1" style={{ borderColor: COLORS.cardEdge }}>
            <div><b style={{ color: COLORS.ink }}>{a.name}</b>{a.desc && <span style={{ color: COLORS.textSoft }}> — {a.desc}</span>}</div>
            <button onClick={() => setF({ ...f, archetypes: f.archetypes.filter((x) => x.id !== a.id) })}><X size={13} /></button>
          </div>
        ))}
        <div className="flex flex-col gap-1 mt-1">
          <input placeholder="Nom de l'archétype" className={inputClass} style={inputStyle} value={newArch.name} onChange={(e) => setNewArch({ ...newArch, name: e.target.value })} />
          <div className="flex gap-1">
            <input placeholder="Description (optionnel)" className={inputClass} style={inputStyle} value={newArch.desc} onChange={(e) => setNewArch({ ...newArch, desc: e.target.value })} />
            <Btn small onClick={() => { if (!newArch.name.trim()) return; setF({ ...f, archetypes: [...f.archetypes, { ...newArch, id: uid() }] }); setNewArch({ name: "", desc: "" }); }}>
              <Plus size={12} />
            </Btn>
          </div>
        </div>
      </Field>
      {isCommunitySubmission && (
        <IndexCard style={{ background: COLORS.cardEdge + "33" }}>
          <p className="text-xs" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
            Pocket impro est avant tout un outil de partage entre troupes : ta création sera d'abord
            soumise à la validation de l'équipe, puis rendue publique dans la bibliothèque une fois validée.
          </p>
          {creatorTroupe && (
            <label className="flex items-center gap-2 text-sm mt-2" style={{ fontFamily: FONT_BODY, color: COLORS.text }}>
              <input type="checkbox" checked={!!f.showTroupeOnCard} onChange={(e) => setF({ ...f, showTroupeOnCard: e.target.checked })} />
              Afficher mon nom ({creatorUsername}) et le nom de ma troupe ({creatorTroupe}) sur la fiche
            </label>
          )}
        </IndexCard>
      )}
      <div className="flex gap-2 mt-2">
        <Btn variant="accent" onClick={() => onSave(f)}><Check size={14} /> Enregistrer</Btn>
        <Btn variant="ghost" onClick={onCancel}><X size={14} /> Annuler</Btn>
      </div>
    </IndexCard>
  );
}

function CategoriesTab({ data, update, isAdmin, currentUser, onlyUserCreated, initialSearchQuery, setTab }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || "");
  const [view, setView] = useState({ type: "hub" }); // hub | tag
  // Remonte en haut de page à chaque changement de sous-page (ex. clic sur une famille) — sinon
  // la nouvelle page s'ouvre au même niveau de défilement que la précédente, ce qui n'est pas intuitif.
  useEffect(() => { window.scrollTo(0, 0); }, [view.type, view.tag]);
  const [duplicateWarning, setDuplicateWarning] = useState(null);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [subQuery, setSubQuery] = useState(""); // recherche locale dans une sous-section (tag)
  const [toastMsg, showToast] = useToast();
  const [fullSheetId, setFullSheetId] = useState(null); // fiche complète (univers) actuellement ouverte

  const baseCategories = onlyUserCreated ? data.categories.filter((c) => c.creatorUsername === currentUser) : data.categories.filter((c) => !c.pending && !c.rejected);

  const canCreate = isAdmin || !!currentUser;

  const toggleFavorite = (id) => {
    if (!currentUser) { showToast("Désolé, il te faut un compte pour enregistrer tes créations !", { type: "notice" }); return; }
    update((d) => {
      const c = d.categories.find((x) => x.id === id);
      if (c) c.favorite = !c.favorite;
      return d;
    });
  };

  // Stampe les champs de modération/attribution : les créations Admin sont publiées directement,
  // les créations d'un compte utilisateur restent "pending" jusqu'à validation. `approvalSeen` sert
  // à afficher une seule fois le message "ta création a été validée" au créateur.
  const stampNewCategory = (f) => {
    const { showTroupeOnCard, ...rest } = f;
    return {
      ...rest,
      pending: !isAdmin,
      creatorUsername: isAdmin ? "" : (currentUser || ""),
      creatorTroupe: !isAdmin && showTroupeOnCard && profile?.troupe ? profile.troupe : "",
      approvalSeen: isAdmin,
    };
  };

  const saveNewCategory = (f) => {
    const isDuplicate = data.categories.some((c) => normalize(c.name) === normalize(f.name));
    if (isDuplicate) { setDuplicateWarning(f); return; }
    update((d) => { d.categories.push({ ...stampNewCategory(f), id: uid(), createdByUser: true }); return d; });
    setAdding(false);
    showToast(isAdmin ? "Catégorie ajoutée ✓" : "Catégorie envoyée pour validation ✓");
  };
  const confirmAddDuplicate = () => {
    if (!duplicateWarning) return;
    update((d) => { d.categories.push({ ...stampNewCategory(duplicateWarning), id: uid(), createdByUser: true }); return d; });
    setDuplicateWarning(null);
    setAdding(false);
  };
  const approveCategory = (id) => update((d) => {
    const c = d.categories.find((x) => x.id === id);
    if (c) { c.pending = false; notifyCreatorApproved(d, c, "catégorie"); }
    return d;
  });
  const rejectCategory = (id, reason) => update((d) => {
    const c = d.categories.find((x) => x.id === id);
    if (c) { c.pending = false; c.rejected = true; notifyCreatorRejected(d, c, "catégorie", reason); }
    return d;
  });
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  const renderCard = (c) =>
    editing === c.id ? (
      <CategoryForm
        familiesList={familiesObjectifsWithCustom(data)}
        onCreateFamily={(name) => addCustomFamily(update, name)}
        key={c.id}
        initial={c}
        thematiquesList={data.thematiques}
        objectifsList={data.objectifs}
        showTypesList={data.showTypes}
        onSave={(f) => { update((d) => { const i = d.categories.findIndex((x) => x.id === c.id); d.categories[i] = { ...f, id: c.id }; return d; }); setEditing(null); }}
        onCancel={() => setEditing(null)}
      />
    ) : (
      <IndexCard key={c.id} style={{ cursor: "pointer" }} onClick={() => setFullSheetId(fullSheetId === c.id ? null : c.id)}>
        <div className="flex justify-between items-start">
          <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="text-lg font-medium flex items-center gap-1">
            {c.name}
            <ChevronDown
              size={15}
              color={COLORS.textSoft}
              style={{ transform: fullSheetId === c.id ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
            />
          </h3>
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => toggleFavorite(c.id)} title="Favori">
              <Star size={22} color={c.favorite ? COLORS.brass : COLORS.textSoft} fill={c.favorite ? COLORS.brass : "none"} />
            </button>
            {isAdmin && c.pending && (
              <>
                <Btn small variant="ghost" onClick={() => approveCategory(c.id)}><Check size={13} /> Valider</Btn>
                <Btn small variant="ghost" onClick={() => { setRejectingId(c.id); setRejectReason(""); }}><X size={13} /> Refuser</Btn>
              </>
            )}
            {isAdmin && <Btn small variant="ghost" onClick={() => setEditing(c.id)}>Modifier</Btn>}
            {isAdmin && (
              <Btn small variant="ghost" onClick={() => update((d) => { d.categories = d.categories.filter((x) => x.id !== c.id); return d; })}>
                Supprimer
              </Btn>
            )}
            {!isAdmin && (c.pending || c.rejected) && c.creatorUsername === currentUser && (
              <Btn small variant="ghost" onClick={() => update((d) => { d.categories = d.categories.filter((x) => x.id !== c.id); return d; })}>
                Supprimer
              </Btn>
            )}
          </div>
        </div>
        {c.pending && (
          <p className="text-xs mb-1" style={{ fontFamily: FONT_MONO, color: COLORS.accent }}>
            En attente de validation — pas encore visible dans la bibliothèque publique.
          </p>
        )}
        {rejectingId === c.id && (
          <RejectReasonBox
            reason={rejectReason}
            setReason={setRejectReason}
            onConfirm={() => { rejectCategory(c.id, rejectReason.trim()); setRejectingId(null); setRejectReason(""); }}
            onCancel={() => { setRejectingId(null); setRejectReason(""); }}
          />
        )}
        {(c.tags || []).length > 0 && (
          <span
            className="inline-block text-xs px-2 py-0.5 rounded-full mt-1 mb-1"
            style={{ fontFamily: FONT_MONO, background: "#B3382C", color: "#fff" }}
          >
            {c.tags.join(" · ")}
          </span>
        )}
        <p style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-sm my-1">{c.summary}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs mb-1" style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }}>
          <span>{c.durationLabel || `${c.duration || 5} min`}</span>
          {c.level && <span>· {c.level}</span>}
          {c.playersMin && <span>· {playersLabel(c)}</span>}
          {c.energy && <span>· énergie {c.energy}</span>}
          {c.material && c.material !== "Aucun" && <span>· {c.material}</span>}
          {c.creatorTroupe && <span>· {c.creatorUsername} — Troupe {c.creatorTroupe}</span>}
        </div>
        <div className="flex flex-wrap">
          {c.thematiques.map((t) => <TagPill key={t} label={t} color={themeColor(t, data.thematiques)} />)}
        </div>
        {(c.objectives || []).filter((o) => o !== "Univers").length > 0 && (
          <div className="mt-1 text-xs" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
            <span style={{ fontFamily: FONT_MONO }}>Tags précis : </span>
            {c.objectives.filter((o) => o !== "Univers").join(" · ")}
          </div>
        )}
        {(c.codes || []).length > 0 && (
          <div className="mt-1 text-xs" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
            <span style={{ fontFamily: FONT_MONO }}>Codes de jeu : </span>{c.codes.join(" · ")}
          </div>
        )}
        {c.advice && (
          <div className="mt-1 text-xs italic" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
            {c.advice}
          </div>
        )}
        {c.archetypes.length > 0 && (
          <div className="mt-2 text-xs" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
            <span style={{ fontFamily: FONT_MONO }}>Archétypes : </span>
            {c.archetypes.map((a) => a.name).join(" · ")}
          </div>
        )}
        {fullSheetId === c.id && (
          <div className="mt-2 text-sm" style={{ fontFamily: FONT_BODY, color: COLORS.text }}>
            {c.themesFrequents && (
              <div className="mb-2">
                <div style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase mb-1">Thèmes fréquents</div>
                <p style={{ color: COLORS.textSoft }}>{c.themesFrequents}</p>
              </div>
            )}
            {c.archetypes.length > 0 && (
              <div className="mb-2">
                <div style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase mb-1">Archétypes de personnages</div>
                {c.archetypes.map((a) => (
                  <p key={a.id} className="mb-1" style={{ color: COLORS.textSoft }}>
                    <b style={{ color: COLORS.ink }}>{a.name}</b> — {a.desc}
                  </p>
                ))}
              </div>
            )}
            {(c.phrasesClassiques || []).length > 0 && (
              <div className="mb-2">
                <div style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase mb-1">Phrases classiques</div>
                {c.phrasesClassiques.map((p, i) => (
                  <p key={i} className="mb-1 italic" style={{ color: COLORS.textSoft }}>{p}</p>
                ))}
              </div>
            )}
            {c.universAssocies && (
              <div className="mb-2">
                <div style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase mb-1">Univers associés</div>
                <p style={{ color: COLORS.textSoft }}>{c.universAssocies}</p>
              </div>
            )}
            {c.vocabulaireUnivers && (
              <div className="mb-2">
                <div style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase mb-1">Vocabulaire de l'univers</div>
                {c.vocabulaireUnivers.lexique && (
                  <p className="mb-1" style={{ color: COLORS.textSoft }}><b style={{ color: COLORS.ink }}>Lexique : </b>{c.vocabulaireUnivers.lexique}</p>
                )}
                {c.vocabulaireUnivers.personnages && (
                  <p className="mb-1" style={{ color: COLORS.textSoft, whiteSpace: "pre-line" }}><b style={{ color: COLORS.ink }}>Noms de personnages : </b>{c.vocabulaireUnivers.personnages}</p>
                )}
                {c.vocabulaireUnivers.expressions && (
                  <p className="mb-1" style={{ color: COLORS.textSoft, whiteSpace: "pre-line" }}><b style={{ color: COLORS.ink }}>Expressions : </b>{c.vocabulaireUnivers.expressions}</p>
                )}
                {c.vocabulaireUnivers.styleDiscours && (
                  <p className="mb-1 font-semibold" style={{ color: COLORS.ink }}>{c.vocabulaireUnivers.styleDiscours}</p>
                )}
                {c.vocabulaireUnivers.tips && (
                  <p className="mb-1 italic" style={{ color: COLORS.textSoft, whiteSpace: "pre-line" }}><b style={{ color: COLORS.ink, fontStyle: "normal" }}>Tips : </b>{c.vocabulaireUnivers.tips}</p>
                )}
              </div>
            )}
          </div>
        )}
      </IndexCard>
    );

  const adminNotice = !isAdmin && (
    <p className="text-xs mb-3 italic" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
      {currentUser
        ? "Tu peux proposer une catégorie — connecte-toi en tant qu'Admin (onglet Mon profil) pour modifier ou supprimer une fiche existante."
        : "Connecte-toi ou crée un compte (onglet Mon profil) pour proposer une catégorie."}
    </p>
  );
  const addForm = adding && (
    <CategoryForm
      familiesList={familiesObjectifsWithCustom(data)}
      onCreateFamily={(name) => addCustomFamily(update, name)}
      thematiquesList={data.thematiques}
        objectifsList={data.objectifs}
        showTypesList={data.showTypes}
      isAdmin={isAdmin}
      creatorTroupe={profile?.troupe || ""}
      creatorUsername={currentUser}
      onSave={saveNewCategory}
      onCancel={() => setAdding(false)}
    />
  );
  const duplicatePrompt = duplicateWarning && (
    <IndexCard>
      <p className="text-sm mb-2" style={{ fontFamily: FONT_BODY, color: COLORS.text }}>
        Une catégorie s'appelle déjà "{duplicateWarning.name}". Ajouter quand même ?
      </p>
      <div className="flex gap-2">
        <Btn variant="accent" onClick={confirmAddDuplicate}><Check size={14} /> Ajouter quand même</Btn>
        <Btn variant="ghost" onClick={() => setDuplicateWarning(null)}><X size={14} /> Annuler</Btn>
      </div>
    </IndexCard>
  );

  const BackBtn = ({ onClick, label }) => (
    <button onClick={onClick} className="flex items-center gap-1 mb-3 text-sm" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
      <ChevronLeft size={16} /> {label}
    </button>
  );
  const HubRow = ({ label, count, onClick }) => (
    <button onClick={onClick} className="w-full text-left">
      <IndexCard style={{ cursor: "pointer" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Tag size={18} color={COLORS.accent} />
            <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">{label}</div>
          </div>
          <div className="flex items-center gap-2">
            <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs">{count}</span>
            <ChevronRight size={16} color={COLORS.textSoft} />
          </div>
        </div>
      </IndexCard>
    </button>
  );

  const grouped = {};
  baseCategories.forEach((c) => {
    // La catégorie "Libre" (sans genre) a sa propre section dédiée plutôt qu'un générique
    // "Sans section" — c'est la seule catégorie de la bibliothèque sans genre renseigné.
    const tags = c.tags?.length ? c.tags : ["Libre"];
    tags.forEach((t) => { (grouped[t] = grouped[t] || []).push(c); });
  });
  const tagKeys = [
    ...CATEGORY_TAGS.filter((t) => grouped[t]),
    ...Object.keys(grouped).filter((t) => !CATEGORY_TAGS.includes(t)),
  ];

  // Page "Catégories créées" (accessible depuis Mon profil) : liste simple des catégories proposées
  // par CE compte, sans reprendre toute la navigation par famille/tags de la bibliothèque générale.
  if (onlyUserCreated) {
    return (
      <div>
        {setTab && <LibraryBackBtn label="Mon profil" onClick={() => setTab("profil")} />}
        <SectionHeader
          icon={Tag}
          title="Catégories créées"
          subtitle="Genres de scène (Muette, ADC, Show me that…), avec thématiques et archétypes liés."
        />
        <Toast toast={toastMsg} />
        {duplicatePrompt}
        {baseCategories.length === 0 ? (
          <Empty text="Aucune catégorie créée pour l'instant." />
        ) : (
          baseCategories.map(renderCard)
        )}
      </div>
    );
  }

  if (view.type === "tag") {
    const catsAll = grouped[view.tag] || [];
    const sq = normalize(subQuery);
    const cats = [...(sq ? catsAll.filter((c) => matchesKeywords(subQuery, c.name, (c.tags || []).join(" "), (c.objectives || []).join(" "), (c.thematiques || []).join(" "), c.level)) : catsAll)].sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return (
      <div>
        <BackBtn label="Catégories" onClick={() => { setView({ type: "hub" }); setSubQuery(""); }} />
        <SectionHeader icon={Tag} title={view.tag} subtitle={`${catsAll.length} catégorie(s)`} />
        <Toast toast={toastMsg} />
        {adminNotice}
        <div className="flex justify-end mb-3">
          {canCreate && !adding && <Btn small variant="accent" onClick={() => setAdding(true)}><Plus size={13} /> {isAdmin ? "Ajouter" : "Soumettre"} une catégorie</Btn>}
        </div>
        {addForm}
        <input
          className={inputClass}
          style={{ ...inputStyle, marginBottom: 12 }}
          value={subQuery}
          onChange={(e) => setSubQuery(e.target.value)}
          placeholder="Chercher une catégorie dans cette section…"
        />
        {cats.length === 0 ? <Empty text="Aucune catégorie pour cette section." /> : cats.map(renderCard)}
      </div>
    );
  }

  return (
    <div>
      {setTab && <LibraryBackBtn label={onlyUserCreated ? "Mon profil" : "Bibliothèque"} onClick={() => setTab(onlyUserCreated ? "profil" : "bibliotheque")} />}
      <SectionHeader
        icon={Tag}
        title={onlyUserCreated ? "Catégories créées" : "Catégories"}
        subtitle="Genres de scène (Muette, ADC, Show me that…), avec thématiques et archétypes liés."
      />
      <Toast toast={toastMsg} />
      {adminNotice}
      {addForm}
      {duplicatePrompt}
      <div className="flex items-end justify-between gap-2 mb-3">
        <ClassementToggle active={showAllCategories ? "tout" : "familles"} onFamilles={() => setShowAllCategories(false)} onTout={() => setShowAllCategories(true)} />
        {canCreate && !adding && <Btn small variant="accent" onClick={() => setAdding(true)}><Plus size={13} /> {isAdmin ? "Ajouter" : "Soumettre"} une catégorie</Btn>}
      </div>
      <Field label="Chercher la fiche d'une catégorie">
        <input
          className={inputClass}
          style={inputStyle}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Nom de la catégorie ou section (ex. musical)…"
        />
      </Field>
      {searchQuery.trim() && (() => {
        const matchingSections = tagKeys.filter((t) => matchesKeywords(searchQuery, t));
        const results = baseCategories.filter((c) => matchesKeywords(searchQuery, c.name, (c.tags || []).join(" "), (c.objectives || []).join(" "), (c.thematiques || []).join(" "), c.level)).sort((a, b) => a.name.localeCompare(b.name, "fr"));
        return (
          <div className="mb-4">
            {matchingSections.map((t) => (
              <HubRow key={t} label={t} count={grouped[t].length} onClick={() => setView({ type: "tag", tag: t })} />
            ))}
            {results.length > 0 && (
              <div className="mb-4">
                {matchingSections.length > 0 && <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase">Catégories correspondantes</span>}
                {results.map(renderCard)}
              </div>
            )}
            {matchingSections.length === 0 && results.length === 0 && <Empty text="Aucune catégorie ne correspond." />}
          </div>
        );
      })()}
      {tagKeys.length === 0 && <Empty text="Aucune catégorie pour l'instant." />}
      {!searchQuery.trim() && (
        showAllCategories ? (
          baseCategories.length === 0 ? <Empty text="Aucune catégorie pour l'instant." /> : <div className="mt-3">{[...baseCategories].sort((a, b) => a.name.localeCompare(b.name, "fr")).map(renderCard)}</div>
        ) : (
          groupByLetter(tagKeys).map(({ letter, items }) => (
            <div key={letter}>
              <div style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase mt-3 mb-1">{letter}</div>
              {items.map((t) => (
                <HubRow key={t} label={t} count={grouped[t].length} onClick={() => setView({ type: "tag", tag: t })} />
              ))}
            </div>
          ))
        )
      )}
    </div>
  );
}

/* ---------- Concepts de spectacle ---------- */
function SpectaclesTab({ data, update, setTab, currentUser, isAdmin, onlyUserCreated }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ theme: "", description: "", type: "", categoryIds: [] });
  const [catSearch, setCatSearch] = useState("");

  const canCreate = isAdmin || !!currentUser;
  // Seules les catégories déjà validées peuvent être combinées dans un nouveau concept.
  const approvedCategories = data.categories.filter((c) => !c.pending && !c.rejected);
  const conceptTypes = [...new Set([...data.showTypes, "Format Long"])];
  const matchingCats = catSearch
    ? approvedCategories.filter((c) => !draft.categoryIds.includes(c.id) && matchesKeywords(catSearch, c.name, (c.tags || []).join(" "), (c.thematiques || []).join(" ")))
    : [];

  // Concepts visibles : validés pour tout le monde, + ceux du créateur courant (même en attente ou
  // refusés, pour qu'il puisse toujours les retrouver), + tout pour l'Admin (contexte de modération).
  // "Mes concepts créés" (onlyUserCreated) : uniquement les siens, quel que soit leur statut.
  const visibleConcepts = onlyUserCreated
    ? data.showConcepts.filter((sc) => sc.creatorUsername === currentUser)
    : data.showConcepts.filter((sc) => (!sc.pending && !sc.rejected) || sc.creatorUsername === currentUser || isAdmin);

  const resetDraft = () => { setDraft({ theme: "", description: "", type: "", categoryIds: [] }); setCatSearch(""); };
  const saveConcept = () => {
    update((d) => {
      d.showConcepts.push({
        ...draft,
        id: uid(),
        pending: !isAdmin,
        creatorUsername: isAdmin ? "" : (currentUser || ""),
        approvalSeen: isAdmin,
      });
      return d;
    });
    setAdding(false);
    resetDraft();
  };

  return (
    <div>
      {setTab && <LibraryBackBtn label={onlyUserCreated ? "Mon profil" : "Bibliothèque"} onClick={() => setTab(onlyUserCreated ? "profil" : "bibliotheque")} />}
      <SectionHeader
        icon={Theater}
        title={onlyUserCreated ? "Concepts de spectacle créés" : "Concepts de spectacle"}
        subtitle={onlyUserCreated ? "Tes concepts de spectacle proposés, quel que soit leur statut de validation." : "Tu as un concept de spectacle à partager à la communauté ? Crée le ici !"}
        action={canCreate ? <Btn variant="accent" small onClick={() => setAdding(true)}><Plus size={13} /> Soumettre un concept</Btn> : null}
      />
      <IndexCard style={{ borderColor: COLORS.accent, background: COLORS.accent + "15", marginBottom: 12 }} className="flex items-center gap-2">
        <AlertTriangle size={18} color={COLORS.accent} />
        <span style={{ fontFamily: FONT_BODY, color: COLORS.accent }} className="text-xs font-medium">
          Page en travaux — tu peux quand même l'utiliser et la tester librement.
        </span>
      </IndexCard>

      {!canCreate && (
        <p className="text-xs mb-3 italic" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
          Connecte-toi ou crée un compte (onglet Mon profil) pour proposer un concept de spectacle.
        </p>
      )}

      {adding && (
        <IndexCard>
          <Field label="Titre">
            <input className={inputClass} style={inputStyle} value={draft.theme} onChange={(e) => setDraft({ ...draft, theme: e.target.value })} placeholder="Titre du concept…" />
          </Field>
          <Field label="Description (optionnel)">
            <textarea className={inputClass} style={inputStyle} rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Décris le concept…" />
          </Field>
          <Field label="Type de spectacle">
            <select className={inputClass} style={inputStyle} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
              <option value="">Choisir un type</option>
              {conceptTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Catégories (optionnel)">
            {draft.categoryIds.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {draft.categoryIds.map((id) => {
                  const c = approvedCategories.find((x) => x.id === id);
                  if (!c) return null;
                  return (
                    <span key={id} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ fontFamily: FONT_MONO, background: COLORS.brass + "22", color: COLORS.brass }}>
                      {c.name}
                      <button type="button" onClick={() => setDraft({ ...draft, categoryIds: draft.categoryIds.filter((x) => x !== id) })}>
                        <X size={11} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <input
              className={inputClass}
              style={inputStyle}
              value={catSearch}
              onChange={(e) => setCatSearch(e.target.value)}
              placeholder="Chercher une catégorie à ajouter…"
            />
            {catSearch && (
              <div className="max-h-48 overflow-y-auto mt-1">
                {matchingCats.length === 0 && <Empty text="Aucune catégorie ne correspond." />}
                {matchingCats.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="block w-full text-left py-1.5 border-b text-sm"
                    style={{ borderColor: COLORS.cardEdge, fontFamily: FONT_BODY, color: COLORS.text }}
                    onClick={() => { setDraft({ ...draft, categoryIds: [...draft.categoryIds, c.id] }); setCatSearch(""); }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </Field>
          <div className="flex gap-2 mt-2">
            <Btn variant="accent" onClick={saveConcept} disabled={!draft.theme.trim()}>
              <Check size={14} /> Enregistrer
            </Btn>
            <Btn variant="ghost" onClick={() => { setAdding(false); resetDraft(); }}><X size={14} /> Annuler</Btn>
          </div>
        </IndexCard>
      )}

      {visibleConcepts.map((sc) => {
        const cats = data.categories.filter((c) => sc.categoryIds.includes(c.id));
        const archetypes = cats.flatMap((c) => c.archetypes.map((a) => ({ ...a, category: c.name })));
        return (
          <IndexCard key={sc.id}>
            <div className="flex justify-between items-start">
              <div>
                <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">{sc.theme}</h3>
                {sc.type && <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs">{sc.type}</span>}
              </div>
              {(isAdmin || (sc.creatorUsername === currentUser && (sc.pending || sc.rejected))) && (
                <button onClick={() => update((d) => { d.showConcepts = d.showConcepts.filter((x) => x.id !== sc.id); return d; })}>
                  <Trash2 size={14} color={COLORS.accent} />
                </button>
              )}
            </div>
            {sc.pending && (
              <p className="text-xs mb-1" style={{ fontFamily: FONT_MONO, color: COLORS.accent }}>
                En attente de validation — pas encore visible dans la liste publique.
              </p>
            )}
            {sc.rejected && (
              <p className="text-xs mb-1" style={{ fontFamily: FONT_MONO, color: COLORS.accent }}>
                Non validé par la modération — visible uniquement par toi.
              </p>
            )}
            {sc.description && (
              <p className="text-sm mt-1" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>{sc.description}</p>
            )}
            <div className="mt-2 text-sm" style={{ fontFamily: FONT_BODY, color: COLORS.text }}>
              <b>Catégories :</b> {cats.length ? cats.map((c) => c.name).join(", ") : "—"}
            </div>
            {archetypes.length > 0 && (
              <div className="mt-1 text-xs" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
                <b style={{ fontFamily: FONT_MONO }}>Archétypes suggérés : </b>
                {archetypes.map((a) => `${a.name} (${a.category})`).join(" · ")}
              </div>
            )}
          </IndexCard>
        );
      })}
      {visibleConcepts.length === 0 && !adding && <Empty text={onlyUserCreated ? "Tu n'as pas encore créé de concept de spectacle." : "Aucun concept de spectacle pour l'instant."} />}
    </div>
  );
}

/* ---------- Générateur : cours ---------- */
function pickRandom(arr) { return arr.length ? arr[Math.floor(Math.random() * arr.length)] : null; }
// Mélange Fisher-Yates : contrairement à `arr.sort(() => Math.random() - 0.5)` (biais bien connu —
// le nombre d'appels du comparateur dépend de l'implémentation de tri, ce qui ne donne pas une
// permutation uniforme), chaque position a exactement la même probabilité de recevoir chaque élément.
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// Comme pickRandom, mais tire d'abord une famille (genre) au hasard avec un poids ÉGAL entre
// familles, puis une catégorie dans cette famille — évite qu'une famille avec beaucoup de
// catégories (ex. "Univers", 29 fiches) monopolise le tirage face aux familles plus petites.
function pickRandomByFamily(arr) {
  if (!arr.length) return null;
  const byFamily = {};
  arr.forEach((c) => { const fam = (c.tags && c.tags[0]) || "?"; (byFamily[fam] = byFamily[fam] || []).push(c); });
  const families = Object.keys(byFamily);
  const fam = families[Math.floor(Math.random() * families.length)];
  return pickRandom(byFamily[fam]);
}

const truncate = (s, n = 90) => (s && s.length > n ? s.slice(0, n).trim() + "…" : s);
// Pastille de couleur pour l'énergie d'une catégorie (Créer un spectacle) : bleu = Faible,
// vert = Modérée, rouge = Forte.
const ENERGY_DOT = { Faible: "🔵", Modérée: "🟢", Forte: "🔴" };
// Affiche "illimité" plutôt qu'une plage numérique quand la fiche a été renseignée comme telle :
// la conversion des données d'origine ("illimité", "illimité minimum N"…) utilise systématiquement
// playersMax=8 comme convention interne pour "pas de maximum précisé".
const playersLabel = (c) => {
  if (!c.playersMin) return null;
  if (c.playersMax === 8) return c.playersMin > 2 ? `illimité (minimum ${c.playersMin})` : "illimité";
  return `${c.playersMin}-${c.playersMax} joueurs`;
};
// Même convention que playersLabel (playersMax=8 = "pas de maximum précisé"), mais formatée pour
// suivre le préfixe "Nombre de joueurs :" affiché sur les cartes générées (sans redire "joueurs").
const playersCountText = (c) => {
  if (!c.playersMin) return "Illimité";
  if (c.playersMax === 8) return c.playersMin > 2 ? `Illimité (minimum ${c.playersMin})` : "Illimité";
  return c.playersMin === c.playersMax ? `${c.playersMin}` : `${c.playersMin} à ${c.playersMax}`;
};

function reorderArray(arr, fromIndex, insertAt) {
  const copy = [...arr];
  const [moved] = copy.splice(fromIndex, 1);
  const target = fromIndex < insertAt ? insertAt - 1 : insertAt;
  copy.splice(target, 0, moved);
  return copy;
}

/* Détecte un pointeur "fin" (souris/trackpad) par opposition à un écran tactile — sert à n'afficher
   le bouton "Déplacer" (poignée de glisser-déposer explicite) que sur ordinateur : au tactile, la
   carte entière reste saisissable n'importe où par appui long, comme avant. */
function useIsFinePointer() {
  const [isFine, setIsFine] = useState(() => window.matchMedia("(pointer: fine)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine)");
    const handler = () => setIsFine(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isFine;
}

/* Poignée de glisser-déposer visible uniquement sur ordinateur (voir useIsFinePointer) : le clic
   maintenu doit partir de ce bouton précis (repéré par le wrapper via [data-drag-handle]) plutôt que
   n'importe où sur la carte, pour ne pas gêner la lecture/le clic sur le reste de la carte à la souris. */
function DragHandleLabel() {
  const isFinePointer = useIsFinePointer();
  if (!isFinePointer) return null;
  return (
    <button
      type="button"
      data-drag-handle
      title="Maintenir le clic pour déplacer la carte"
      className="text-xs uppercase shrink-0"
      style={{ fontFamily: FONT_MONO, color: COLORS.textSoft, cursor: "grab" }}
    >
      Déplacer
    </button>
  );
}

/* Glisser-déposer générique par appui long (mobile + souris) : saisir un item n'importe où sur sa
   carte après 400ms d'appui immobile, le déplacer (une carte flottante suit le doigt), défilement
   automatique près des bords de l'écran, dépôt tolérant sur la moitié haute/basse d'une autre carte.
   `onReorder(listKey, fromIndex, insertAt)` doit utiliser un setState fonctionnel pour rester à jour. */
function useDragReorder(onReorder) {
  const [dragged, setDragged] = useState(null); // { listKey, index }
  const [dragPos, setDragPos] = useState(null);
  const pressTimer = useRef(null);
  const hoverRef = useRef(null);

  const cancelPress = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  };

  const startPress = (listKey, index, e) => {
    const startX = e.clientX;
    const startY = e.clientY;
    let lastY = e.clientY;
    let lastTime = performance.now();
    let velocity = 0;
    let manualScrolling = false;
    let longPressFired = false;
    let rafId = null;

    cancelPress();
    pressTimer.current = setTimeout(() => {
      longPressFired = true;
      pressTimer.current = null;
      setDragged({ listKey, index });
    }, 400);

    const handleMove = (ev) => {
      if (longPressFired) return;
      // Le défilement manuel simulé ci-dessous ne sert qu'à compenser touchAction:"none" (qui bloque
      // le défilement tactile natif pendant l'attente du appui long). À la souris, il n'y a pas ce
      // problème : un léger mouvement pendant l'appui ne doit pas être interprété comme une intention
      // de défiler la page, sinon ça annule le glisser-déposer dès qu'on bouge un peu la souris.
      if (e.pointerType === "mouse") return;
      const dx = Math.abs(ev.clientX - startX);
      const dy = Math.abs(ev.clientY - startY);
      if (!manualScrolling && (dx > 10 || dy > 10)) { manualScrolling = true; cancelPress(); }
      if (manualScrolling) {
        const now = performance.now();
        const dt = Math.max(now - lastTime, 1);
        const delta = lastY - ev.clientY;
        window.scrollBy(0, delta);
        velocity = delta / dt;
        lastY = ev.clientY;
        lastTime = now;
      }
    };
    const handleUp = () => {
      cancelPress();
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      if (manualScrolling && Math.abs(velocity) > 0.05) {
        let v = velocity * 16;
        const step = () => {
          window.scrollBy(0, v);
          v *= 0.94;
          if (Math.abs(v) > 0.5) rafId = requestAnimationFrame(step);
        };
        rafId = requestAnimationFrame(step);
      }
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  };

  useEffect(() => {
    if (!dragged) return;
    const prevTouchAction = document.documentElement.style.touchAction;
    document.documentElement.style.touchAction = "none";
    const EDGE = 70;
    const SPEED = 12;
    let edgeDir = 0;
    let edgeInterval = null;
    const stopEdgeScroll = () => { if (edgeInterval) { clearInterval(edgeInterval); edgeInterval = null; } edgeDir = 0; };
    const startEdgeScroll = (dir) => {
      if (edgeDir === dir) return;
      stopEdgeScroll();
      edgeDir = dir;
      edgeInterval = setInterval(() => window.scrollBy(0, dir * SPEED), 16);
    };
    const handleMove = (e) => {
      setDragPos({ x: e.clientX, y: e.clientY });
      if (e.clientY < EDGE) startEdgeScroll(-1);
      else if (e.clientY > window.innerHeight - EDGE) startEdgeScroll(1);
      else stopEdgeScroll();
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cardEl = el?.closest("[data-drop-card]");
      if (!cardEl) return;
      const listKey = cardEl.getAttribute("data-list");
      const index = Number(cardEl.getAttribute("data-index"));
      const rect = cardEl.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      hoverRef.current = { listKey, index: before ? index : index + 1 };
    };
    const handleUp = () => {
      stopEdgeScroll();
      if (hoverRef.current && hoverRef.current.listKey === dragged.listKey) {
        onReorder(dragged.listKey, dragged.index, hoverRef.current.index);
      }
      hoverRef.current = null;
      setDragged(null);
      setDragPos(null);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      stopEdgeScroll();
      document.documentElement.style.touchAction = prevTouchAction;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [dragged, onReorder]);

  return { dragged, dragPos, startPress };
}

/* Carte flottante générique qui suit le doigt pendant un glissement (voir useDragReorder). */
function DragGhost({ x, y, title, subtitle }) {
  return (
    <div
      style={{
        position: "fixed",
        left: x - 90,
        top: y - 22,
        zIndex: 100,
        pointerEvents: "none",
        transform: "rotate(-2deg) scale(0.85)",
        boxShadow: "0 10px 24px rgba(0,0,0,0.35)",
        width: 170,
      }}
    >
      <IndexCard style={{ marginBottom: 0, padding: 8, background: COLORS.card, border: `1px solid ${COLORS.brass}` }}>
        <div className="flex gap-2.5">
          <Pointer size={13} color={COLORS.textSoft} />
          <div>
            <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="text-sm font-medium">{title}</h3>
            {subtitle && <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs">{subtitle}</span>}
          </div>
        </div>
      </IndexCard>
    </div>
  );
}

function buildCours(exercises, categories, { niveau, tempsTotal, nbEchauffements, nbExercices, nbImpro, objectifs, thematiques, participants, joueursSeConnaissent, faireAmbassadeur, recentIds, integrerFavoris }) {
  const themesFiltre = thematiques || [];
  // Priorité 1 : l'exercice est classé dans une des familles résumées cochées (champ `groupe`).
  // Priorité 2 (repli) : l'exercice porte un tag d'objectif précis associé à une de ces familles.
  const matchesFamily = (e) => objectifs.length > 0 && objectifs.includes(e.groupe);
  const matchesTags = (e) => objectifs.length > 0 && objectifs.some((fam) => (FAMILLE_VERS_TAGS[fam] || []).some((tag) => e.objectives?.includes(tag)));
  const matches = (e) => {
    const objOk = objectifs.length === 0 || matchesFamily(e) || matchesTags(e);
    const themeOk = themesFiltre.length === 0 || e.thematiques?.some((t) => themesFiltre.includes(t));
    return objOk && themeOk;
  };
  const byLevel = (e) => !niveau || e.level === niveau;
  // Le niveau coché est prioritaire (voir byLevel ci-dessus), mais un niveau adjacent reste
  // autorisé (Débutant coché → Confirmé accepté, mais pas Avancé ; Avancé coché → Confirmé
  // accepté, mais pas Débutant). Les fiches sans niveau précisé restent toujours autorisées.
  const NIVEAU_ORDER = ["Débutant", "Confirmé", "Avancé"];
  const niveauIdx = niveau ? NIVEAU_ORDER.indexOf(niveau) : -1;
  const allowedLevel = (e) => {
    if (!niveau || !e.level) return true;
    const idx = NIVEAU_ORDER.indexOf(e.level);
    return idx === -1 || Math.abs(idx - niveauIdx) <= 1;
  };
  // players = nombre minimum de joueurs requis (0 = illimité/aucun minimum) : on écarte les
  // exercices/catégories qui demandent plus de joueurs que le groupe n'en compte.
  const fitsGroup = (e) => !e.players || e.players <= participants;
  const fitsGroupCat = (c) => !c.playersMin || c.playersMin <= participants;
  const recent = recentIds || new Set();
  // Le temps de chaque section est calculé en interne à partir du temps total et du niveau (plus
  // de temps d'échauffement pour Débutant, moins pour Avancé) — l'utilisateur ne choisit plus une
  // durée par section mais directement un NOMBRE d'échauffements/exercices/catégories ; ce temps
  // calculé est ensuite réparti à parts égales entre les éléments retenus (la durée suggérée
  // d'une fiche n'entre jamais en jeu).
  const floorTo5 = (n) => Math.floor(n / 5) * 5;
  const baseTemps = Math.max((tempsTotal || 0) - DEBRIEF_MIN, 0);
  const echPct = niveau === "Débutant" ? 0.35 : niveau === "Avancé" ? 0.2 : 0.3;
  const restePct = 1 - echPct;
  const tempsEchauffement = floorTo5(baseTemps * echPct);
  const tempsImpro = floorTo5(baseTemps * restePct * (3 / 7));
  let tempsExercices = floorTo5(baseTemps * restePct * (4 / 7));
  tempsExercices += floorTo5(baseTemps - (tempsEchauffement + tempsExercices + tempsImpro));
  // Nombre d'éléments par section : choisi directement par l'utilisateur (menus déroulants), imposé
  // tel quel (min = max = ce nombre, 0 accepté pour omettre complètement la section), plutôt que
  // déduit automatiquement d'une fourchette.
  const minEchauffements = Math.max(0, nbEchauffements);
  const maxEchauffements = minEchauffements;
  const minExercices = Math.max(0, nbExercices);
  const maxExercices = minExercices;
  const minImpro = Math.max(0, nbImpro);
  const maxImpro = minImpro;
  // Force le nombre d'éléments retenus dans la fourchette [min, max] (en piochant d'autres
  // éléments du pool si besoin pour atteindre le minimum), puis répartit le budget de la section
  // à parts égales entre eux — la durée affichée sur chaque carte remplace alors sa durée suggérée.
  const enforceCountAndRedistribute = (arr, pool, usedSet, minCount, maxCount, totalBudget) => {
    const trimmed = arr.length > maxCount ? arr.slice(maxCount) : [];
    let items = arr.slice(0, maxCount);
    trimmed.forEach((it) => usedSet.delete(it.id));
    const remainingPool = prioritizeFresh(pool.filter((e) => !usedSet.has(e.id) && !items.find((it) => it.id === e.id)));
    let i = 0;
    while (items.length < minCount && i < remainingPool.length) {
      items.push(remainingPool[i]);
      usedSet.add(remainingPool[i].id);
      i++;
    }
    if (items.length === 0) return items;
    const per = Math.floor(totalBudget / items.length);
    const remainder = totalBudget - per * items.length;
    return items.map((it, idx) => ({ ...it, actualDuration: Math.max(MIN_CARD_DURATION, per + (idx < remainder ? 1 : 0)) }));
  };
  // Priorise les éléments non utilisés lors de la dernière génération (anti-répétition), puis,
  // si demandé, les favoris — sans jamais passer avant la correspondance thématique/objectifs,
  // qui reste gérée par les paliers (matched > other > lastResort) plus haut dans l'appel.
  const prioritizeFresh = (arr) => {
    const shuffled = shuffleArray(arr);
    return shuffled.sort((a, b) => {
      const freshDiff = (recent.has(a.id) ? 1 : 0) - (recent.has(b.id) ? 1 : 0);
      if (freshDiff !== 0) return freshDiff;
      if (!integrerFavoris) return 0;
      return (a.favorite ? 0 : 1) - (b.favorite ? 0 : 1);
    });
  };

  // Sous 5 participants, on écarte les échauffements de la famille "Cercle" (peu adaptés à un
  // petit groupe) — même règle que sur la page "Créer un échauffement".
  // "Ambassadeur" est exclu du pool normal : il n'est ajouté que via la règle dédiée plus bas
  // (dernier échauffement, uniquement si la case "Inclure un ambassadeur" est cochée).
  const warmupAll = exercises.filter((e) => e.warmup && e.title !== "Ambassadeur" && fitsGroup(e) && allowedLevel(e) && (participants >= 5 || e.groupe !== "Cercle"));
  // Les fiches marquées "dualUse" (fusion d'un doublon échauffement/exercice — même contenu
  // utile dans les deux sections) restent éligibles ici même si elles sont aussi cochées comme
  // échauffement ; les ~40 autres échauffements actifs, eux, restent réservés à l'échauffement.
  const middlePool = exercises.filter((e) => (!e.warmup || e.dualUse) && !e.application && fitsGroup(e) && allowedLevel(e));
  // Attache la durée réellement utilisée (éventuellement compressée de ±2 min pour tenir dans le
  // budget) à une copie de l'exercice/catégorie, pour que les cartes affichent la bonne durée.
  const withActual = (item, remainingBefore) => ({ ...item, actualDuration: Math.min(item.duration ?? (item.duration || 5), remainingBefore) });

  // Échauffements : remplissent le budget "Temps d'échauffement" choisi par l'utilisateur, en
  // épuisant d'abord ceux qui correspondent aux objectifs/niveau avant de se rabattre sur les autres.
  const used = new Set();
  const fillFromPool = (pool, remaining, maxCount = Infinity) => {
    const picked = [];
    const shuffled = prioritizeFresh(pool);
    for (const e of shuffled) {
      if (picked.length >= maxCount) break;
      if (used.has(e.id)) continue;
      picked.push(withActual(e, remaining)); used.add(e.id); remaining = consumeBudget(e.duration, remaining);
    }
    return { picked, remaining };
  };
  // Sélectionne jusqu'à `minCount` exercices tagués `tag`, en priorité pour garantir un minimum,
  // sans jamais dépasser `maxCount` éléments au total dans la section.
  const fillMinTag = (pool, remaining, tag, minCount, maxCount = Infinity) => {
    const tagPool = pool.filter((e) => e.objectives?.includes(tag));
    const picked = [];
    const shuffled = prioritizeFresh(tagPool);
    for (const e of shuffled) {
      if (picked.length >= minCount || picked.length >= maxCount) break;
      if (used.has(e.id)) continue;
      picked.push(withActual(e, remaining)); used.add(e.id); remaining = consumeBudget(e.duration, remaining);
    }
    return { picked, remaining };
  };
  let warmups = [];
  let remainingWarmupBudget = tempsEchauffement;
  const warmupRoom = () => Math.max(0, maxEchauffements - warmups.length);

  // Pioche un échauffement au hasard dans une (ou plusieurs, au choix) famille(s) donnée(s) ; la
  // durée suggérée n'entre pas en jeu dans le choix (seulement dans l'affichage provisoire avant
  // redistribution finale) — renvoie true si un échauffement a bien été ajouté.
  const pickFamilyWarmup = (families) => {
    const fams = Array.isArray(families) ? families : [families];
    const pool = warmupAll.filter((e) => fams.includes(e.groupe) && !used.has(e.id));
    // Dans cette famille de pacing (ex. "Physique"), priorise une fiche qui correspond AUSSI à
    // l'objectif pédagogique coché (tags précis, FAMILLE_VERS_TAGS) — la structure de l'échauffement
    // (1 relaxation, 1 groupe/déconnexion, 1 physique/vocal/marche, 1 cercle) reste la même, mais
    // chaque créneau va vers une fiche en lien avec ce qu'on veut travailler, quand c'est possible.
    const prioritized = pool.filter((e) => matchesFamily(e) || matchesTags(e));
    const pick = pickRandom(prioritizeFresh(prioritized.length > 0 ? prioritized : pool));
    if (!pick) return false;
    warmups.push(withActual(pick, remainingWarmupBudget));
    used.add(pick.id);
    remainingWarmupBudget = consumeBudget(pick.duration, remainingWarmupBudget);
    return true;
  };

  // À partir de 4 échauffements, on impose un ordre précis : Relaxation, puis Groupe/prénoms/
  // confiance ou Déconnexion (Groupe/prénoms/confiance forcé si les joueurs ne se connaissent
  // pas), puis Physique, Vocal ou Marche, puis Cercle.
  if (maxEchauffements >= 4) {
    if (warmupRoom() > 0) pickFamilyWarmup("Relaxation");
    if (warmupRoom() > 0) {
      if (joueursSeConnaissent === false) pickFamilyWarmup("Groupe, prénoms et confiance");
      else pickFamilyWarmup(Math.random() < 0.5 ? "Groupe, prénoms et confiance" : "Déconnexion");
    }
    if (warmupRoom() > 0) {
      const options = shuffleArray(["Physique", "Vocal", "Marche"]);
      for (const fam of options) { if (pickFamilyWarmup(fam)) break; }
    }
    if (warmupRoom() > 0) pickFamilyWarmup("Cercle");
  }

  // Si les joueurs ne se connaissent pas, on garantit au moins un échauffement de la famille
  // "Groupe, prénoms et confiance" (déjà couvert ci-dessus si on a au moins 4 échauffements).
  if (joueursSeConnaissent === false && !warmups.some((e) => e.groupe === "Groupe, prénoms et confiance") && warmupRoom() > 0) {
    pickFamilyWarmup("Groupe, prénoms et confiance");
  }

  // Au-delà de 6 participants, on garantit au moins un échauffement de la famille "Cercle" (plus
  // adapté aux grands groupes), même s'il n'y a pas assez d'échauffements pour l'ordre ci-dessus.
  if (participants > 6 && !warmups.some((e) => e.groupe === "Cercle") && warmupRoom() > 0) {
    pickFamilyWarmup("Cercle");
  }

  // L'échauffement doit toujours contenir au moins un exercice "Physique" et un "Voix".
  let mandatoryStep = fillMinTag(warmupAll, remainingWarmupBudget, "Physique", 1, warmupRoom());
  warmups = [...warmups, ...mandatoryStep.picked]; remainingWarmupBudget = mandatoryStep.remaining;
  mandatoryStep = fillMinTag(warmupAll, remainingWarmupBudget, "Voix", 1, warmupRoom());
  warmups = [...warmups, ...mandatoryStep.picked]; remainingWarmupBudget = mandatoryStep.remaining;

  let step = fillFromPool(warmupAll.filter((e) => matchesFamily(e) && byLevel(e)), remainingWarmupBudget, warmupRoom());
  warmups = [...warmups, ...step.picked]; remainingWarmupBudget = step.remaining;
  if (warmupRoom() > 0) {
    step = fillFromPool(warmupAll.filter(matchesFamily), remainingWarmupBudget, warmupRoom());
    warmups = [...warmups, ...step.picked]; remainingWarmupBudget = step.remaining;
  }
  if (warmupRoom() > 0) {
    step = fillFromPool(warmupAll.filter((e) => matchesTags(e) && byLevel(e)), remainingWarmupBudget, warmupRoom());
    warmups = [...warmups, ...step.picked]; remainingWarmupBudget = step.remaining;
  }
  if (warmupRoom() > 0) {
    step = fillFromPool(warmupAll.filter(matchesTags), remainingWarmupBudget, warmupRoom());
    warmups = [...warmups, ...step.picked]; remainingWarmupBudget = step.remaining;
  }
  if (warmupRoom() > 0) {
    step = fillFromPool(warmupAll, remainingWarmupBudget, warmupRoom());
    warmups = [...warmups, ...step.picked]; remainingWarmupBudget = step.remaining;
  }
  if (warmups.length === 0 && tempsEchauffement > 0 && maxEchauffements > 0) {
    const single = pickRandom(warmupAll);
    if (single) { warmups = [withActual(single, tempsEchauffement)]; used.add(single.id); }
  }

  // Si demandé, l'exercice "Ambassadeur" est toujours placé en dernier échauffement — peu importe
  // la famille/l'objectif choisi, cette règle passe par-dessus la sélection habituelle. S'il n'y a
  // plus de place (nombre d'échauffements déjà atteint), on retire le dernier choisi pour lui faire
  // de la place plutôt que de dépasser le nombre demandé. Si 0 échauffement est demandé, on
  // n'ajoute pas non plus l'Ambassadeur : la section reste bien vide comme voulu.
  if (faireAmbassadeur && maxEchauffements > 0) {
    const ambassadeur = exercises.find((e) => e.title === "Ambassadeur" && !used.has(e.id) && fitsGroup(e));
    if (ambassadeur) {
      if (warmups.length >= maxEchauffements && warmups.length > 0) {
        const removed = warmups.pop();
        used.delete(removed.id);
      }
      warmups.push(withActual(ambassadeur, remainingWarmupBudget));
      used.add(ambassadeur.id);
    }
  }

  // Exercices principaux : remplissent le budget "Temps d'exercices".
  let budget = tempsExercices;
  const middle = [];

  // Équilibrage du rythme : alterne simultané / chacun-son-tour et plafonne le temps d'attente cumulé
  const waitCapMin = tempsExercices * 0.35;
  let cumulativeWait = 0;
  let lastFormat = null;

  const familyPool = middlePool.filter(matchesFamily);
  const tagPool = middlePool.filter((e) => !matchesFamily(e) && matchesTags(e));
  const otherPool = middlePool.filter((e) => !matchesFamily(e) && !matchesTags(e));
  const familyCandidates = [...familyPool.filter(byLevel), ...familyPool];
  const tagCandidates = [...tagPool.filter(byLevel), ...tagPool];
  const otherCandidates = [...otherPool.filter(byLevel), ...otherPool];
  // Dernier recours si la bibliothèque "corps de cours" (Pré-impro/Impro) est vide ou insuffisante :
  // on réutilise d'autres échauffements plutôt que de laisser le cours trop court.
  const lastResortCandidates = warmupAll;

  const pickFromPool = (pool) => {
    let choicePool = pool.filter((e) => !used.has(e.id));
    if (choicePool.length === 0) return null;

    const wantsCalmAfterTakeTurns = lastFormat === "Tour à tour avec spectateur" || cumulativeWait >= waitCapMin;
    const wantsCalmAfterNoisy = lastFormat === "En groupe simultané";
    if (wantsCalmAfterTakeTurns) {
      const nonTakeTurns = choicePool.filter((e) => (e.format || "Solo simultané") !== "Tour à tour avec spectateur");
      if (nonTakeTurns.length > 0) choicePool = nonTakeTurns;
    }
    if (wantsCalmAfterNoisy) {
      const nonNoisy = choicePool.filter((e) => (e.format || "Solo simultané") !== "En groupe simultané");
      if (nonNoisy.length > 0) choicePool = nonNoisy;
    }
    const fresh = choicePool.filter((e) => !recent.has(e.id));
    const candidates = fresh.length > 0 ? fresh : choicePool;
    if (integrerFavoris) {
      const favs = candidates.filter((e) => e.favorite);
      if (favs.length > 0) return pickRandom(favs);
    }
    return pickRandom(candidates);
  };

  while (middle.length < maxExercices) {
    // On épuise d'abord les exercices classés dans la famille cochée, puis ceux qui portent un
    // tag précis associé à cette famille, puis le reste de la bibliothèque, puis en dernier
    // recours d'autres échauffements, pour ne jamais laisser de temps non couvert.
    const pick = pickFromPool(familyCandidates) || pickFromPool(tagCandidates) || pickFromPool(otherCandidates) || pickFromPool(lastResortCandidates);
    if (!pick) break; // plus aucun exercice, quel qu'il soit, ne tient dans le temps restant

    middle.push(withActual(pick, budget));
    used.add(pick.id);
    budget = consumeBudget(pick.duration, budget);
    lastFormat = pick.format || "Solo simultané";
    if (lastFormat === "Tour à tour avec spectateur") cumulativeWait += computeWaitMinutes(pick, participants);
  }

  // Catégories d'impro jouées en cours : remplissent le budget "Temps d'impro", en préférant
  // celles qui correspondent au niveau avant de se rabattre sur les autres.
  const categoriesDispo = categories.filter((c) => fitsGroupCat(c) && allowedLevel(c));
  const usedCat = new Set();
  const fillCategories = (pool, remaining, maxCount = Infinity, weightByFamily = true) => {
    const picked = [];
    if (weightByFamily) {
      // Tire d'abord une famille au hasard avec un poids ÉGAL entre familles (peu importe leur
      // nombre de catégories), puis une catégorie dans cette famille — sinon une famille avec
      // beaucoup de fiches (ex. "Univers", 29) écrase les familles plus petites (ex. "Contrainte
      // de style", 4) au tirage. Réservé aux pools larges et non filtrés par pertinence (le reste
      // de la bibliothèque) : sur un petit pool déjà filtré par tag/famille d'objectif, pondérer
      // par genre favoriserait à tort une catégorie seule dans sa famille (elle aurait alors le
      // même poids qu'une famille de 5 fiches) — voir weightByFamily=false plus bas.
      const byFamily = {};
      for (const c of pool) {
        if (usedCat.has(c.id)) continue;
        const fam = (c.tags && c.tags[0]) || "?";
        (byFamily[fam] = byFamily[fam] || []).push(c);
      }
      Object.keys(byFamily).forEach((fam) => { byFamily[fam] = prioritizeFresh(byFamily[fam]); });
      const families = Object.keys(byFamily);
      while (families.length > 0 && picked.length < maxCount) {
        const famIdx = Math.floor(Math.random() * families.length);
        const fam = families[famIdx];
        const list = byFamily[fam];
        const c = list[0];
        const dur = c.duration || 5;
        picked.push({ ...c, actualDuration: Math.min(dur, remaining) });
        usedCat.add(c.id);
        remaining = consumeBudget(dur, remaining);
        list.shift();
        if (list.length === 0) families.splice(famIdx, 1);
      }
    } else {
      // Tirage plat : chaque catégorie du pool a exactement la même probabilité, peu importe son
      // genre — pour les pools déjà filtrés par pertinence (famille d'objectif ou tag précis coché).
      const shuffled = prioritizeFresh(pool.filter((c) => !usedCat.has(c.id)));
      for (const c of shuffled) {
        if (picked.length >= maxCount) break;
        const dur = c.duration || 5;
        picked.push({ ...c, actualDuration: Math.min(dur, remaining) });
        usedCat.add(c.id);
        remaining = consumeBudget(dur, remaining);
      }
    }
    return { picked, remaining };
  };
  let impro = [];
  let remainingImproBudget = tempsImpro;
  // "Jouer avec la musique" et "Impro longue" garantissent au moins une catégorie Univers parmi
  // les catégories d'impro (les scènes d'univers se prêtent bien à un moment musical, et "Impro
  // longue" n'a encore aucune catégorie qui lui soit propre — une scène d'univers, plus étoffée,
  // s'y prête naturellement) — remplie en priorité absolue, avant même la correspondance par
  // famille/tag habituelle.
  if ((objectifs.includes("Jouer avec la musique") || objectifs.includes("Impro longue")) && maxImpro > 0) {
    const universPool = categoriesDispo.filter((c) => c.tags?.includes("Univers"));
    let universGuarantee = fillCategories(universPool.filter((c) => byLevel(c)), remainingImproBudget, 1, false);
    impro = [...impro, ...universGuarantee.picked]; remainingImproBudget = universGuarantee.remaining;
    if (impro.length === 0) {
      universGuarantee = fillCategories(universPool, remainingImproBudget, 1, false);
      impro = [...impro, ...universGuarantee.picked]; remainingImproBudget = universGuarantee.remaining;
    }
  }
  // Priorité aux catégories directement classées dans une des familles d'objectifs cochées
  // (nouveau champ famillesObjectifs), avec repli sur l'ancienne correspondance par genre
  // "Univers" pour "Travail des univers" (catégories pas encore reclassées avec le nouveau champ).
  const matchesFamilyCat = (c) => objectifs.some((o) => c.famillesObjectifs?.includes(o)) || (objectifs.includes("Travail des univers") && c.tags?.includes("Univers"));
  // Repli manuel (avant le tag précis) : catégories choisies à la main par la troupe pour
  // certaines familles, indépendamment de leurs tags (FAMILLE_VERS_CATEGORIES_PRIORITAIRES).
  const priorityNames = objectifs.flatMap((o) => FAMILLE_VERS_CATEGORIES_PRIORITAIRES[o] || []);
  const matchesPriorityCat = (c) => priorityNames.includes(c.name);
  // Repli supplémentaire (avant le reste de la bibliothèque) : catégories dont les tags précis
  // (champ objectives, ex. "écoute", "imprévu") recoupent les tags précis associés à la famille
  // d'objectif cochée (FAMILLE_VERS_TAGS_CATEGORIES — peut différer des tags utilisés pour les
  // exercices, ex. "Jouer avec la musique" cible "chant"/"ambiance musicale" plutôt que "Voix").
  // Utile pour les catégories pas encore classées dans une famille d'objectif pédagogique.
  const targetPreciseTags = objectifs.flatMap((o) => FAMILLE_VERS_TAGS_CATEGORIES[o] || []);
  const matchesTagCat = (c) => targetPreciseTags.length > 0 && c.objectives?.some((k) => targetPreciseTags.some((t) => tagOverlap(k, t)));
  if (objectifs.length > 0 && impro.length < maxImpro) {
    let universStep = fillCategories(categoriesDispo.filter((c) => matchesFamilyCat(c) && byLevel(c)), remainingImproBudget, maxImpro - impro.length, false);
    impro = [...impro, ...universStep.picked]; remainingImproBudget = universStep.remaining;
    if (impro.length < maxImpro) {
      universStep = fillCategories(categoriesDispo.filter(matchesFamilyCat), remainingImproBudget, maxImpro - impro.length, false);
      impro = [...impro, ...universStep.picked]; remainingImproBudget = universStep.remaining;
    }
    if (impro.length < maxImpro) {
      let priorityStep = fillCategories(categoriesDispo.filter((c) => matchesPriorityCat(c) && byLevel(c)), remainingImproBudget, maxImpro - impro.length, false);
      impro = [...impro, ...priorityStep.picked]; remainingImproBudget = priorityStep.remaining;
      if (impro.length < maxImpro) {
        priorityStep = fillCategories(categoriesDispo.filter(matchesPriorityCat), remainingImproBudget, maxImpro - impro.length, false);
        impro = [...impro, ...priorityStep.picked]; remainingImproBudget = priorityStep.remaining;
      }
    }
    if (impro.length < maxImpro) {
      let tagStep = fillCategories(categoriesDispo.filter((c) => matchesTagCat(c) && byLevel(c)), remainingImproBudget, maxImpro - impro.length, false);
      impro = [...impro, ...tagStep.picked]; remainingImproBudget = tagStep.remaining;
      if (impro.length < maxImpro) {
        tagStep = fillCategories(categoriesDispo.filter(matchesTagCat), remainingImproBudget, maxImpro - impro.length, false);
        impro = [...impro, ...tagStep.picked]; remainingImproBudget = tagStep.remaining;
      }
    }
  }
  // Si aucune catégorie ne correspond du tout à la/aux famille(s) d'objectif cochée(s) — ex.
  // "Posture confiante" ou "Enjeux", qui n'ont encore aucune catégorie rattachée — on propose
  // "Libre" en priorité (catégorie sans contrainte, sans famille) avant de retomber sur un tirage
  // complètement aléatoire dans le reste de la bibliothèque.
  if (objectifs.length > 0 && impro.length === 0 && maxImpro > 0) {
    const libre = categoriesDispo.find((c) => c.name === "Libre" && !usedCat.has(c.id));
    if (libre) {
      const dur = libre.duration || 5;
      impro = [{ ...libre, actualDuration: Math.min(dur, remainingImproBudget), matchInfo: { type: "exhausted" } }];
      usedCat.add(libre.id);
      remainingImproBudget = consumeBudget(dur, remainingImproBudget);
    }
  }
  let catStep = fillCategories(categoriesDispo.filter((c) => byLevel(c)), remainingImproBudget, maxImpro - impro.length);
  impro = [...impro, ...catStep.picked]; remainingImproBudget = catStep.remaining;
  if (impro.length < maxImpro) {
    catStep = fillCategories(categoriesDispo, remainingImproBudget, maxImpro - impro.length);
    impro = [...impro, ...catStep.picked]; remainingImproBudget = catStep.remaining;
  }
  if (impro.length === 0 && tempsImpro > 0 && maxImpro > 0) {
    const single = pickRandomByFamily(categoriesDispo);
    if (single) impro = [{ ...single, actualDuration: single.duration || 5 }];
  }

  warmups = enforceCountAndRedistribute(warmups, warmupAll, used, minEchauffements, maxEchauffements, tempsEchauffement);
  const middleFinal = enforceCountAndRedistribute(middle, middlePool, used, minExercices, maxExercices, tempsExercices);
  impro = enforceCountAndRedistribute(impro, categoriesDispo, usedCat, minImpro, maxImpro, tempsImpro);

  // Attache à chaque échauffement/exercice la raison de sa présence quand une famille est cochée :
  // vient-il directement de cette famille (champ groupe), ou d'un repli sur un tag précis associé ?
  // Sert à distinguer visuellement les deux cas sur les cartes du cours généré.
  const attachMatchInfo = (arr) => arr.map((e) => {
    if (objectifs.length === 0) return { ...e, matchInfo: null };
    if (objectifs.includes(e.groupe)) return { ...e, matchInfo: { type: "family" } };
    const matchedTag = objectifs.flatMap((fam) => FAMILLE_VERS_TAGS[fam] || []).find((tag) => e.objectives?.includes(tag));
    return { ...e, matchInfo: matchedTag ? { type: "tag", tag: matchedTag } : null };
  });
  // Même principe pour les catégories : famille d'objectif pédagogique cochée (famillesObjectifs,
  // ou repli genre "Univers"), sinon repli sur un tag précis (objectives) recoupant les tags de la
  // famille cochée (correspondance souple via tagOverlap, contrairement au match exact des exercices).
  const attachMatchInfoCat = (arr) => arr.map((c) => {
    if (objectifs.length === 0) return { ...c, matchInfo: null };
    if (matchesFamilyCat(c)) return { ...c, matchInfo: { type: "family" } };
    if (matchesPriorityCat(c)) return { ...c, matchInfo: { type: "priority" } };
    const matchedTag = targetPreciseTags.find((t) => c.objectives?.some((k) => tagOverlap(k, t)));
    return { ...c, matchInfo: matchedTag ? { type: "tag", tag: matchedTag } : null };
  });

  return { warmups: attachMatchInfo(warmups), middle: attachMatchInfo(middleFinal), impro: attachMatchInfoCat(impro), debrief: DEBRIEF_MIN };
}



function GenerateurCoursTab({ data, allData, update, goTo, plan, setPlan, currentUser, setTab }) {
  // Fiches en attente/refusées du créateur courant : jamais proposées par le tirage automatique,
  // mais ajoutées au pool de recherche manuelle des pickers pour qu'il puisse quand même les ajouter
  // lui-même à son cours (voir notifyCreatorRejected).
  const myPendingExercises = currentUser ? (allData?.exercises || []).filter((e) => e.creatorUsername === currentUser && (e.pending || e.rejected)) : [];
  const myPendingCategories = currentUser ? (allData?.categories || []).filter((c) => c.creatorUsername === currentUser && (c.pending || c.rejected)) : [];
  const pickerExercises = myPendingExercises.length > 0 ? [...data.exercises, ...myPendingExercises] : data.exercises;
  const pickerCategories = myPendingCategories.length > 0 ? [...data.categories, ...myPendingCategories] : data.categories;
  const [niveau, setNiveau] = useState("");
  const [participants, setParticipants] = useState(8);
  const [joueursSeConnaissent, setJoueursSeConnaissent] = useState(true);
  const [faireAmbassadeur, setFaireAmbassadeur] = useState(true);
  const [integrerFavoris, setIntegrerFavoris] = useState(false);
  const [tempsTotal, setTempsTotal] = useState(120);
  const [nbEchauffements, setNbEchauffements] = useState(4);
  const [nbExercices, setNbExercices] = useState(3);
  const [nbImpro, setNbImpro] = useState(2);
  const [objectifs, setObjectifs] = useState([]);
  const [thematiques, setThematiques] = useState([]);
  const [name, setName] = useState("");
  const [toastMsg, showToast] = useToast();
  // Historique de toutes les fiches déjà affichées dans ce cours (génération initiale + fiches
  // sorties d'une carte via "Aléatoire") — exclues du tirage suivant en plus de la fiche courante,
  // même si elles ont un tag correspondant : on ne veut plus jamais revoir une fiche déjà montrée
  // une fois dans cette session, quitte à épuiser les correspondances plus vite. Repart à zéro à
  // chaque nouvelle génération (voir generate()).
  const recentSwapIdsRef = useRef([]);
  const pushRecentSwap = (id) => {
    if (!id || recentSwapIdsRef.current.includes(id)) return;
    recentSwapIdsRef.current = [...recentSwapIdsRef.current, id];
  };

  // Calcule un nombre par défaut d'échauffements/exercices/catégories, calé sur la référence
  // d'un cours de 90 minutes (3-4 échauffements, 2-3 exercices, 1-2 catégories, ajusté par le
  // niveau pour les échauffements), mis à l'échelle avec la durée totale choisie. L'utilisateur
  // peut ensuite librement changer ces nombres dans les menus déroulants.
  const suggestCounts = (t, niveauOverride) => {
    const lvl = niveauOverride !== undefined ? niveauOverride : niveau;
    const scale = t / 90;
    const echBase = lvl === "Débutant" ? 5 : lvl === "Avancé" ? 3 : 4;
    const countStep = t === 120 ? 1 : t === 60 ? -1 : null;
    const ech = countStep !== null ? Math.max(1, echBase + countStep) : Math.max(1, Math.round(echBase * scale));
    const exo = countStep !== null ? Math.max(1, 3 + countStep) : Math.max(1, Math.round(3 * scale));
    const impro = countStep !== null ? Math.max(1, 2 + countStep) : Math.max(1, Math.round(2 * scale));
    setNbEchauffements(ech);
    setNbExercices(exo);
    setNbImpro(impro);
  };
  const applyTempsTotal = (t, niveauOverride) => {
    setTempsTotal(t);
    suggestCounts(t, niveauOverride);
  };
  const onChangeNiveau = (val) => {
    setNiveau(val);
    suggestCounts(tempsTotal, val);
  };
  const nombresPossibles = Array.from({ length: 11 }, (_, i) => i); // 0 à 10

  const [picker, setPicker] = useState(null); // { mode: "add" } | { mode: "replace", slot, idx }
  const [catPicker, setCatPicker] = useState(null); // { mode: "add" } | { mode: "replace", idx }
  const [expandedId, setExpandedId] = useState(null); // affiche la fiche complète de l'exercice/catégorie
  const [recentIds, setRecentIds] = useState(new Set()); // exercices/catégories de la dernière génération

  const handleCardTap = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };
  const toggleFavEx = (id) => {
    if (!currentUser) { showToast("Désolé, il te faut un compte pour enregistrer tes créations !", { type: "notice" }); return; }
    update((d) => { const e = d.exercises.find((x) => x.id === id); if (e) e.favorite = !e.favorite; return d; });
    setPlan((prev) => {
      if (!prev) return prev;
      const flip = (arr) => arr.map((e) => (e.id === id ? { ...e, favorite: !e.favorite } : e));
      return { ...prev, warmups: flip(prev.warmups), middle: flip(prev.middle) };
    });
  };
  const toggleFavCat = (id) => {
    if (!currentUser) { showToast("Désolé, il te faut un compte pour enregistrer tes créations !", { type: "notice" }); return; }
    update((d) => { const c = d.categories.find((x) => x.id === id); if (c) c.favorite = !c.favorite; return d; });
    setPlan((prev) => {
      if (!prev) return prev;
      return { ...prev, impro: prev.impro.map((c) => (c.id === id ? { ...c, favorite: !c.favorite } : c)) };
    });
  };

  const generate = () => {
    const newPlan = buildCours(data.exercises, data.categories, { niveau, tempsTotal, nbEchauffements, nbExercices, nbImpro, objectifs, thematiques, participants, joueursSeConnaissent, faireAmbassadeur, recentIds, integrerFavoris });
    setPlan(newPlan);
    setRecentIds(new Set([...newPlan.warmups, ...newPlan.middle, ...newPlan.impro].map((x) => x.id)));
    // Un nouveau cours repart avec un historique "déjà affichées" vierge, mais y intègre tout de
    // suite ses propres fiches : elles comptent comme déjà vues pour les prochains clics Aléatoire.
    recentSwapIdsRef.current = [...newPlan.warmups, ...newPlan.middle, ...newPlan.impro].map((x) => x.id);
  };

  const usedIds = () => new Set([...(plan?.warmups || []).map((e) => e.id), ...(plan?.middle || []).map((e) => e.id)]);
  const usedCatIds = () => new Set((plan?.impro || []).map((c) => c.id));

  const saveScroll = usePreserveScroll();
  const pickManually = (ex) => {
    if (!plan || !picker) return;
    saveScroll();
    if (picker.mode === "add") {
      setPlan({ ...plan, middle: [...plan.middle, ex] });
    } else if (picker.slot === "warmup") {
      // On garde le temps réservé pour ce créneau (resserré pour tenir dans la durée du cours),
      // plutôt que la durée brute de la fiche choisie, pour ne pas faire dériver le total affiché.
      // La durée indiquée sur une fiche n'est qu'une suggestion pour qui s'entraîne seul·e ; dans un
      // cours généré, on garde tel quel le temps réservé pour ce créneau, peu importe la fiche choisie.
      const oldBudget = plan.warmups[picker.idx]?.actualDuration ?? plan.warmups[picker.idx]?.duration ?? 5;
      const exWithDuration = { ...ex, actualDuration: oldBudget };
      setPlan({ ...plan, warmups: plan.warmups.map((e, i) => (i === picker.idx ? exWithDuration : e)) });
    } else {
      const oldBudget = plan.middle[picker.idx]?.actualDuration ?? plan.middle[picker.idx]?.duration ?? 5;
      const exWithDuration = { ...ex, actualDuration: oldBudget };
      setPlan({ ...plan, middle: plan.middle.map((e, i) => (i === picker.idx ? exWithDuration : e)) });
    }
    setPicker(null);
  };

  const pickCatManually = (cat) => {
    if (!plan || !catPicker) return;
    saveScroll();
    if (catPicker.mode === "add") {
      setPlan({ ...plan, impro: [...plan.impro, cat] });
    } else {
      // Idem : on garde le temps réservé pour ce créneau plutôt que la durée brute de la fiche.
      const oldBudget = plan.impro[catPicker.idx]?.actualDuration ?? plan.impro[catPicker.idx]?.duration ?? 5;
      const catWithDuration = { ...cat, actualDuration: oldBudget };
      setPlan({ ...plan, impro: plan.impro.map((c, i) => (i === catPicker.idx ? catWithDuration : c)) });
    }
    setCatPicker(null);
  };

  const replace = (slot, idx) => {
    if (!plan) return;
    // Même principe de priorité que la génération initiale (buildCours) : famille cochée (champ
    // groupe) en premier, puis repli sur un tag précis associé à cette famille (FAMILLE_VERS_TAGS),
    // puis thématique, puis le reste — avec le même badge de raison (matchInfo) sur la carte.
    const familyMatches = (e) => objectifs.length > 0 && objectifs.includes(e.groupe);
    const tagMatches = (e) => objectifs.length > 0 && objectifs.some((fam) => (FAMILLE_VERS_TAGS[fam] || []).some((tag) => e.objectives?.includes(tag)));
    const themeMatches = (e) => thematiques.length > 0 && thematiques.some((t) => e.thematiques?.includes(t));
    const currentId = slot === "warmup" ? plan.warmups[idx]?.id : plan.middle[idx]?.id;
    // La carte qu'on remplace est toujours exclue du pool, même en dernier recours — on ne doit
    // jamais pouvoir retomber sur exactement la même fiche qu'avant le clic. On exclut aussi les
    // dernières fiches sorties d'une carte via ce bouton (recentSwapIdsRef) : sinon, une fiche qui
    // est la SEULE correspondance d'un tag/famille cochée fait l'aller-retour à chaque clic.
    const used = new Set([...plan.warmups.map((e) => e.id), ...plan.middle.map((e) => e.id), currentId, ...recentSwapIdsRef.current]);
    // Parmi les familles déjà présentes ailleurs dans le cours (hors la carte qu'on remplace),
    // on priorise ensuite une proposition dont la famille n'y figure pas encore, pour varier.
    const groupesInUse = new Set(
      [...plan.warmups, ...plan.middle].filter((e) => e.id !== currentId).map((e) => e.groupe).filter(Boolean)
    );
    const pickWithDiversity = (candidates) => {
      const diverse = candidates.filter((e) => !groupesInUse.has(e.groupe));
      return pickRandom(diverse.length > 0 ? diverse : candidates);
    };
    const poolBase = slot === "warmup"
      ? data.exercises.filter((e) => e.warmup && !used.has(e.id))
      : data.exercises.filter((e) => (!e.warmup || e.dualUse) && !e.application && !used.has(e.id));
    const byFamily = poolBase.filter(familyMatches);
    const byTag = poolBase.filter((e) => !familyMatches(e) && tagMatches(e));
    const byTheme = poolBase.filter((e) => !familyMatches(e) && !tagMatches(e) && themeMatches(e));
    const source = byFamily.length > 0 ? byFamily : byTag.length > 0 ? byTag : byTheme.length > 0 ? byTheme : poolBase;
    // Repli "épuisé" (aucune correspondance famille/tag/thématique restante) : tirage vraiment
    // aléatoire et uniforme dans tout le pool restant, sans pondération ni filtre de diversité —
    // ceux-ci n'ont de sens que pour départager des candidats déjà pertinents.
    const pick = source === poolBase ? pickRandom(poolBase) : pickWithDiversity(source);
    if (!pick) return;
    pushRecentSwap(currentId);
    let matchInfo = null;
    if (source === byFamily) matchInfo = { type: "family" };
    else if (source === byTag) {
      const matchedTag = objectifs.flatMap((fam) => FAMILLE_VERS_TAGS[fam] || []).find((tag) => pick.objectives?.includes(tag));
      matchInfo = matchedTag ? { type: "tag", tag: matchedTag } : null;
    } else if (source === poolBase && (objectifs.length > 0 || thematiques.length > 0)) {
      matchInfo = { type: "exhausted" };
    }
    // On garde le temps réservé pour ce créneau (resserré pour tenir dans la durée du cours),
    // plutôt que la durée brute de la fiche tirée, pour ne pas faire dériver le total affiché.
    const oldList = slot === "warmup" ? plan.warmups : plan.middle;
    const oldBudget = oldList[idx]?.actualDuration ?? oldList[idx]?.duration ?? 5;
    const withMatch = { ...pick, matchInfo, actualDuration: oldBudget };
    if (slot === "warmup") setPlan({ ...plan, warmups: plan.warmups.map((e, i) => (i === idx ? withMatch : e)) });
    else setPlan({ ...plan, middle: plan.middle.map((e, i) => (i === idx ? withMatch : e)) });
  };
  const remove = (slot, idx) => {
    if (!plan) return;
    if (slot === "warmup") setPlan({ ...plan, warmups: plan.warmups.filter((_, i) => i !== idx) });
    else setPlan({ ...plan, middle: plan.middle.filter((_, i) => i !== idx) });
  };
  const replaceCat = (idx) => {
    if (!plan) return;
    const currentId = plan.impro[idx]?.id;
    // La carte qu'on remplace est toujours exclue du pool, même en dernier recours — on ne doit
    // jamais pouvoir retomber sur exactement la même fiche qu'avant le clic. On exclut aussi les
    // dernières fiches sorties d'une carte via ce bouton (recentSwapIdsRef) : sinon, une fiche qui
    // est la SEULE correspondance d'un tag/famille cochée fait l'aller-retour à chaque clic (ex.
    // "Contact", seule catégorie taguée "Contact", reviendrait un clic sur deux).
    const used = new Set([...plan.impro.map((c) => c.id), currentId, ...recentSwapIdsRef.current]);
    const pool = data.categories.filter((c) => !used.has(c.id));
    // Priorité à la famille d'objectif cochée (champ famillesObjectifs, ou repli par genre), puis
    // aux catégories dont les tags précis (objectives) recoupent les tags précis associés à cette
    // famille (FAMILLE_VERS_TAGS_CATEGORIES, peut différer des tags exercices), puis à la
    // thématique cochée, puis au reste de la bibliothèque.
    const targetTags = objectifs.map((o) => FAMILLE_VERS_CATEGORY_TAG[o]).filter(Boolean);
    const byFamily = objectifs.length > 0 ? pool.filter((c) => objectifs.some((o) => c.famillesObjectifs?.includes(o)) || targetTags.some((t) => c.tags?.includes(t))) : [];
    const priorityNames = objectifs.flatMap((o) => FAMILLE_VERS_CATEGORIES_PRIORITAIRES[o] || []);
    const byPriority = priorityNames.length > 0 ? pool.filter((c) => priorityNames.includes(c.name)) : [];
    const targetPreciseTags = objectifs.flatMap((o) => FAMILLE_VERS_TAGS_CATEGORIES[o] || []);
    const byTag = targetPreciseTags.length > 0 ? pool.filter((c) => c.objectives?.some((k) => targetPreciseTags.some((t) => tagOverlap(k, t)))) : [];
    const byThematique = thematiques.length > 0 ? pool.filter((c) => thematiques.some((t) => c.thematiques?.includes(t))) : [];
    const source = byFamily.length > 0 ? byFamily : byPriority.length > 0 ? byPriority : byTag.length > 0 ? byTag : byThematique.length > 0 ? byThematique : pool;
    // Tirage plat et uniforme dans tous les cas : sur un pool déjà filtré par pertinence (famille
    // ou tag précis coché), pondérer par genre favoriserait à tort une catégorie seule dans sa
    // famille (elle ressortirait aussi souvent qu'une famille de 5 fiches) ; sur le repli complet
    // (rien ne correspond plus), l'utilisateur a demandé un tirage vraiment aléatoire.
    const pick = pickRandom(source);
    if (!pick) return;
    pushRecentSwap(currentId);
    let matchInfo = null;
    if (source === byFamily) matchInfo = { type: "family" };
    else if (source === byPriority) matchInfo = { type: "priority" };
    else if (source === byTag) {
      const matchedTag = targetPreciseTags.find((t) => pick.objectives?.some((k) => tagOverlap(k, t)));
      matchInfo = matchedTag ? { type: "tag", tag: matchedTag } : null;
    } else if (source === pool && (objectifs.length > 0 || thematiques.length > 0)) {
      matchInfo = { type: "exhausted" };
    }
    // Idem : on garde le temps réservé pour ce créneau plutôt que la durée brute de la fiche tirée.
    const oldBudget = plan.impro[idx]?.actualDuration ?? plan.impro[idx]?.duration ?? 5;
    setPlan({ ...plan, impro: plan.impro.map((c, i) => (i === idx ? { ...pick, matchInfo, actualDuration: oldBudget } : c)) });
  };
  const removeCat = (idx) => {
    if (!plan) return;
    setPlan({ ...plan, impro: plan.impro.filter((_, i) => i !== idx) });
  };

  const onReorderCours = useCallback((listKey, fromIndex, insertAt) => {
    setPlan((prev) => (prev ? { ...prev, [listKey]: reorderArray(prev[listKey], fromIndex, insertAt) } : prev));
  }, []);
  const { dragged, dragPos, startPress } = useDragReorder(onReorderCours);
  const draggedItem = dragged ? plan?.[dragged.listKey]?.[dragged.index] : null;
  const draggedTitle = draggedItem ? (dragged.listKey === "impro" ? draggedItem.name : draggedItem.title) : null;

  const items = plan ? [
    ...plan.warmups.map((ex, i) => ({ kind: "exercise", label: plan.warmups.length > 1 ? `Échauffement ${i + 1}` : "Échauffement", ex, slot: "warmup", idx: i })),
    ...plan.middle.map((ex, i) => ({ kind: "exercise", label: `Exercice ${i + 1}`, ex, slot: "middle", idx: i })),
    ...plan.impro.map((cat, i) => ({ kind: "category", label: plan.impro.length > 1 ? `Catégorie d'impro ${i + 1}` : "Catégorie d'impro", cat, idx: i })),
  ] : [];
  const totalMin = items.reduce((s, it) => s + (it.kind === "category" ? (it.cat.actualDuration ?? it.cat.duration ?? 5) : (it.ex.actualDuration ?? it.ex.duration)), 0) + DEBRIEF_MIN;
  const totalWait = items.filter((it) => it.kind === "exercise").reduce((s, it) => s + computeWaitMinutes(it.ex, participants), 0);
  // Durées effectivement retenues (resserrées pour tenir dans le temps demandé) — transmises au PDF
  // pour qu'il affiche exactement les mêmes durées/total que cet écran (voir exportCoursePlanPDF).
  const durationsById = {};
  items.forEach((it) => {
    if (it.kind === "exercise") durationsById[it.ex.id] = it.ex.actualDuration ?? it.ex.duration;
    else durationsById[it.cat.id] = it.cat.actualDuration ?? it.cat.duration ?? 5;
  });

  return (
    <div>
      {dragged && dragPos && draggedItem && (
        <DragGhost
          x={dragPos.x}
          y={dragPos.y}
          title={draggedTitle}
          subtitle={`${dragged.listKey === "impro" ? (draggedItem.duration || 5) : draggedItem.duration} min`}
        />
      )}
      <SectionHeader icon={BookOpen} title="Créer un cours" subtitle="Une séance complète, à ajuster ensuite." />
      <p className="text-sm mb-3" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
        Il est possible que tu n'aies pas le temps de faire tous les exercices proposés, n'hésite pas à en supprimer ou en ajouter lors de ton cours. Improvise et adapte !
      </p>
      <Toast toast={toastMsg} />
      <IndexCard>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Niveau">
            <select className={inputClass} style={inputStyle} value={niveau} onChange={(e) => onChangeNiveau(e.target.value)}>
              <option value="">Tous niveaux</option>
              {NIVEAUX.map((n) => <option key={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="Participants">
            <select className={inputClass} style={inputStyle} value={participants} onChange={(e) => setParticipants(Number(e.target.value))}>
              {STUDENTS_COUNTS.slice(0, 20).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
        </div>
        <OuiNonField label="Les joueurs se connaissent ?" value={joueursSeConnaissent} onChange={setJoueursSeConnaissent} />
        <OuiNonField label="Inclure un ambassadeur (jeu de mime) ?" value={faireAmbassadeur} onChange={setFaireAmbassadeur} />
        <OuiNonField label="Intégrer mes favoris ?" value={integrerFavoris} onChange={setIntegrerFavoris} />
        <Field label="Temps total du cours">
          <select className="rounded-sm px-2 py-1.5 text-sm outline-none focus:ring-2" style={{ ...inputStyle, width: "auto" }} value={tempsTotal} onChange={(e) => applyTempsTotal(Number(e.target.value))}>
            {TEMPS_TOTAL_OPTIONS.map((t) => <option key={t} value={t}>{t} min</option>)}
          </select>
        </Field>
        <Field label="Nombre d'échauffements">
          <select className="rounded-sm px-2 py-1.5 text-sm outline-none focus:ring-2" style={{ ...inputStyle, width: "auto" }} value={nbEchauffements} onChange={(e) => setNbEchauffements(Number(e.target.value))}>
            {nombresPossibles.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Nombre d'exercices">
          <select className="rounded-sm px-2 py-1.5 text-sm outline-none focus:ring-2" style={{ ...inputStyle, width: "auto" }} value={nbExercices} onChange={(e) => setNbExercices(Number(e.target.value))}>
            {nombresPossibles.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Nombre de catégories d'impro">
          <select className="rounded-sm px-2 py-1.5 text-sm outline-none focus:ring-2" style={{ ...inputStyle, width: "auto" }} value={nbImpro} onChange={(e) => setNbImpro(Number(e.target.value))}>
            {nombresPossibles.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <p className="text-xs mb-2" style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }}>
          Durée totale estimée : {tempsTotal} min (feedbacks inclus {DEBRIEF_MIN} minutes)
        </p>
        <Field label="Objectif pédagogique (optionnel)">
          <SearchableMultiSelect allOptions={familiesObjectifsWithCustom(data)} selected={objectifs} onChange={setObjectifs} />
        </Field>
        <Btn variant="accent" onClick={generate}><Sparkles size={14} /> Créer</Btn>
      </IndexCard>

      {plan && (
        <>
          {items.map((it) => {
            if (it.kind === "category") {
              const c = it.cat;
              const isDraggedItem = dragged && dragged.listKey === "impro" && dragged.index === it.idx;
              const isExpanded = expandedId === c.id;
              const card = (
                <IndexCard>
                  <div className="flex justify-between items-start">
                    <div className="flex-1" onClick={() => handleCardTap(c.id)} style={{ cursor: "pointer" }}>
                      <span style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase">{it.label}</span>
                      <div className="flex items-center gap-1.5">
                        <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">{c.name}</h3>
                        <button onClick={(e) => { e.stopPropagation(); toggleFavCat(c.id); }} title="Favori">
                          <Star size={18} color={c.favorite ? COLORS.brass : COLORS.textSoft} fill={c.favorite ? COLORS.brass : "none"} />
                        </button>
                      </div>
                      {/* Hauteur toujours réservée (même sans tag, comme pour "Libre") pour éviter que la
                          carte suivante ne se décale et que le clic sur "Aléatoire" d'une carte voisine
                          n'atterrisse par erreur sur un autre bouton après le remplacement. */}
                      <div className="flex flex-wrap items-center mt-1 mb-1" style={{ minHeight: 22 }}>
                        {(c.tags || []).length > 0 && (
                          <span
                            className="inline-block text-xs px-2 py-0.5 rounded-full"
                            style={{ fontFamily: FONT_MONO, background: "#B3382C", color: "#fff" }}
                          >
                            {c.tags.join(" · ")}
                          </span>
                        )}
                        {c.matchInfo?.type === "family" && (
                          <span
                            className="inline-block text-xs px-2 py-0.5 rounded-full ml-1"
                            style={{ fontFamily: FONT_MONO, background: COLORS.accent, color: "#fff" }}
                          >
                            famille d'objectif
                          </span>
                        )}
                        {c.matchInfo?.type === "tag" && (
                          <span
                            className="inline-block text-xs px-2 py-0.5 rounded-full ml-1"
                            style={{ fontFamily: FONT_MONO, color: COLORS.accent, border: `1px solid ${COLORS.accent}` }}
                          >
                            via tag : {c.matchInfo.tag}
                          </span>
                        )}
                        {c.matchInfo?.type === "priority" && (
                          <span
                            className="inline-block text-xs px-2 py-0.5 rounded-full ml-1"
                            style={{ fontFamily: FONT_MONO, background: COLORS.brass, color: "#fff" }}
                          >
                            recommandée
                          </span>
                        )}
                        {c.matchInfo?.type === "exhausted" && (
                          <span
                            className="inline-block text-xs px-2 py-0.5 rounded-full ml-1"
                            style={{ fontFamily: FONT_MONO, color: "#B3382C", border: "1px solid #B3382C" }}
                          >
                            tags correspondants épuisés
                          </span>
                        )}
                      </div>
                      <p
                        style={{
                          fontFamily: FONT_BODY, color: COLORS.textSoft,
                          ...(isExpanded ? {} : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: "2.6em" }),
                        }}
                        className="text-sm"
                      >
                        {c.summary}
                      </p>
                      {isExpanded && (
                        <div className="mt-1 text-xs" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
                          <div>{c.level || "Niveau non précisé"}</div>
                          {c.archetypes?.length > 0 && <div>Archétypes : {c.archetypes.map((a) => a.name).join(", ")}</div>}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 items-end">
                      <Btn small variant="ghost" onClick={() => replaceCat(it.idx)}>Aléatoire</Btn>
                      <Btn small variant="ghost" onClick={() => setCatPicker({ mode: "replace", idx: it.idx })}>Changer</Btn>
                    </div>
                  </div>
                  <div className="flex justify-between items-center mt-2">
                    <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs">
                      {c.actualDuration ?? c.duration ?? 5} min · Nombre de joueurs : {playersCountText(c)}
                    </span>
                    <div className="flex items-center gap-3">
                      <DragHandleLabel />
                      <button onClick={() => removeCat(it.idx)} title="Supprimer"><Trash2 size={22} color={COLORS.accent} /></button>
                    </div>
                  </div>
                </IndexCard>
              );
              return (
                <React.Fragment key={it.label}>
                  <div
                    data-drop-card="true"
                    data-list="impro"
                    data-index={it.idx}
                    onPointerDown={(e) => { if (e.pointerType === "mouse" && !e.target.closest("[data-drag-handle]")) return; startPress("impro", it.idx, e); }}
                    style={{ position: "relative", opacity: isDraggedItem ? 0.4 : 1, userSelect: "none", WebkitUserSelect: "none", touchAction: "none" }}
                  >
                    {card}
                  </div>
                  {catPicker?.mode === "replace" && catPicker.idx === it.idx && (
                    <CategoryPicker
                      categories={pickerCategories}
                      excludeIds={[...usedCatIds()]}
                      onSelect={pickCatManually}
                      onCancel={() => setCatPicker(null)}
                    />
                  )}
                </React.Fragment>
              );
            }
            const wait = computeWaitMinutes(it.ex, participants);
            const listKey = it.slot === "warmup" ? "warmups" : it.slot === "middle" ? "middle" : null;
            const isDraggedItem = dragged && listKey && dragged.listKey === listKey && dragged.index === it.idx;
            const isExpanded = expandedId === it.ex.id;
            const card = (
              <IndexCard>
                <div className="flex justify-between items-start">
                  <div className="flex-1" onClick={() => handleCardTap(it.ex.id)} style={{ cursor: "pointer" }}>
                    <span style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase">{it.label}</span>
                    <div className="flex items-center gap-1.5">
                      <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">{it.ex.title}</h3>
                      <button onClick={(e) => { e.stopPropagation(); toggleFavEx(it.ex.id); }} title="Favori">
                        <Star size={18} color={it.ex.favorite ? COLORS.brass : COLORS.textSoft} fill={it.ex.favorite ? COLORS.brass : "none"} />
                      </button>
                    </div>
                    {/* Hauteur toujours réservée (même sans badge) pour éviter que la carte suivante ne
                        se décale et que le clic sur "Aléatoire" d'une carte voisine n'atterrisse par
                        erreur sur un autre bouton après le remplacement. */}
                    <div className="flex flex-wrap items-center mt-1 mb-1" style={{ minHeight: 22 }}>
                      {it.ex.groupe && (
                        <span
                          className="inline-block text-xs px-2 py-0.5 rounded-full"
                          style={{ fontFamily: FONT_MONO, background: COLORS.accent, color: "#fff" }}
                        >
                          {it.ex.groupe}
                        </span>
                      )}
                      {it.slot !== "warmup" && it.ex.matchInfo?.type === "tag" && (
                        <span
                          className="inline-block text-xs px-2 py-0.5 rounded-full ml-1"
                          style={{ fontFamily: FONT_MONO, color: COLORS.accent, border: `1px solid ${COLORS.accent}` }}
                        >
                          via tag : {it.ex.matchInfo.tag}
                        </span>
                      )}
                      {it.slot !== "warmup" && it.ex.matchInfo?.type === "exhausted" && (
                        <span
                          className="inline-block text-xs px-2 py-0.5 rounded-full ml-1"
                          style={{ fontFamily: FONT_MONO, color: "#B3382C", border: "1px solid #B3382C" }}
                        >
                          tags correspondants épuisés
                        </span>
                      )}
                      {it.slot !== "warmup" && it.ex.phase === "Pré-impro" && (
                        <span
                          className="inline-block text-xs px-2 py-0.5 rounded-full ml-1"
                          style={{ fontFamily: FONT_MONO, background: "#B3382C", color: "#fff" }}
                        >
                          Exercice pré-impro
                        </span>
                      )}
                    </div>
                    <p
                      style={{
                        fontFamily: FONT_BODY, color: COLORS.textSoft,
                        ...(isExpanded ? {} : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: "2.6em" }),
                      }}
                      className="text-sm"
                    >
                      {it.ex.summary}
                    </p>
                    {isExpanded && (
                      <div className="mt-1 text-xs" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
                        <div>{it.ex.level || "Niveau non précisé"}</div>
                        {it.ex.objectives?.length > 0 && <div>Objectifs : {it.ex.objectives.join(", ")}</div>}
                        {it.ex.energy && <div>Énergie : {it.ex.energy}</div>}
                        {it.ex.material && it.ex.material !== "Aucun" && <div>Matériel : {it.ex.material}</div>}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 items-end">
                    <Btn small variant="ghost" onClick={() => replace(it.slot, it.idx)}>Aléatoire</Btn>
                    <Btn small variant="ghost" onClick={() => setPicker({ mode: "replace", slot: it.slot, idx: it.idx, groupe: it.ex.groupe })}>Changer</Btn>
                  </div>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <div className="flex items-center gap-2">
                    <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs">
                      {it.ex.actualDuration ?? it.ex.duration} min · Nombre de joueurs : {it.ex.players > 0 ? it.ex.players : "Illimité"}
                    </span>
                    {(it.ex.format || "Solo simultané") === "Tour à tour avec spectateur" ? (
                      <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ fontFamily: FONT_MONO, background: COLORS.brass + "33", color: COLORS.brass }}>
                        🟠 chacun son tour{wait > 0 ? ` · ~${wait} min d'attente/élève` : ""}
                      </span>
                    ) : it.ex.format === "En groupe simultané" ? (
                      <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ fontFamily: FONT_MONO, background: COLORS.accent + "33", color: COLORS.accent }}>
                        🔴 groupe simultané (bruyant)
                      </span>
                    ) : (
                      <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ fontFamily: FONT_MONO, background: "#3B6E5E33", color: "#3B6E5E" }}>
                        🟢 tout le monde actif
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <DragHandleLabel />
                    <button onClick={() => remove(it.slot, it.idx)} title="Supprimer"><Trash2 size={22} color={COLORS.accent} /></button>
                  </div>
                </div>
              </IndexCard>
            );
            const inlinePicker = picker?.mode === "replace" && picker.slot === it.slot && picker.idx === it.idx && (
              <ExercisePicker
                exercises={pickerExercises}
                excludeIds={[...usedIds()]}
                onSelect={pickManually}
                onCancel={() => setPicker(null)}
                priorityFamilies={objectifs.length > 0 ? objectifs : (picker.groupe ? [picker.groupe] : [])}
              />
            );
            if (!listKey) return <React.Fragment key={it.label}>{card}{inlinePicker}</React.Fragment>;
            return (
              <React.Fragment key={it.label}>
                <div
                  data-drop-card="true"
                  data-list={listKey}
                  data-index={it.idx}
                  onPointerDown={(e) => { if (e.pointerType === "mouse" && !e.target.closest("[data-drag-handle]")) return; startPress(listKey, it.idx, e); }}
                  style={{ position: "relative", opacity: isDraggedItem ? 0.4 : 1, userSelect: "none", WebkitUserSelect: "none", touchAction: "none" }}
                >
                  {card}
                </div>
                {inlinePicker}
              </React.Fragment>
            );
          })}
          {picker?.mode === "add" && (
            <ExercisePicker
              exercises={pickerExercises}
              excludeIds={[...usedIds()]}
              onSelect={pickManually}
              onCancel={() => setPicker(null)}
              priorityFamilies={objectifs.length > 0 ? objectifs : []}
            />
          )}
          <div className="flex gap-2 mb-2">
            <Btn variant="accent" onClick={() => setPicker({ mode: "add" })}><Plus size={14} /> Ajouter un exercice</Btn>
          </div>
          {catPicker?.mode === "add" && (
            <CategoryPicker
              categories={pickerCategories}
              excludeIds={[...usedCatIds()]}
              onSelect={pickCatManually}
              onCancel={() => setCatPicker(null)}
            />
          )}
          <div className="flex gap-2">
            <Btn variant="accent" onClick={() => setCatPicker({ mode: "add" })}><Plus size={14} /> Ajouter une catégorie d'impro</Btn>
          </div>
          <IndexCard className="mt-2">
            <span style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase">Débrief</span>
            <p style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-sm">Temps d'échange collectif en fin de séance — {DEBRIEF_MIN} min.</p>
          </IndexCard>
          <div className="text-right text-sm mb-2" style={{ fontFamily: FONT_MONO, color: COLORS.ink }}>
            Durée totale : {totalMin} min
            {totalWait > 0 && <span style={{ color: COLORS.brass }}> · ~{totalWait} min d'attente max/élève</span>}
          </div>
          <div className="flex gap-2 mb-2">
            <Btn
              variant="ghost"
              onClick={() => exportCoursePlanPDF(
                {
                  name: name || "Plan de cours",
                  exerciseIds: items.filter((it) => it.kind === "exercise").map((it) => it.ex.id),
                  categoryIds: items.filter((it) => it.kind === "category").map((it) => it.cat.id),
                  durationsById,
                },
                data
              )}
            >
              <Download size={14} /> Télécharger en PDF
            </Btn>
          </div>
          {currentUser ? (
            <div className="flex gap-2">
              <input className={inputClass} style={{ ...inputStyle, flex: 1 }} placeholder="Nom du cours" value={name} onChange={(e) => setName(e.target.value)} />
              <Btn variant="accent" disabled={!name} onClick={() => {
                update((d) => {
                  d.coursePlans.push({
                    id: uid(), name,
                    exerciseIds: items.filter((it) => it.kind === "exercise").map((it) => it.ex.id),
                    categoryIds: items.filter((it) => it.kind === "category").map((it) => it.cat.id),
                    durationsById,
                  });
                  return d;
                });
                setName(""); setPlan(null);
                showToast("Cours enregistré ✓");
              }}>
                <Save size={14} /> Enregistrer
              </Btn>
            </div>
          ) : (
            <p className="text-xs italic" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
              {setTab ? (
                <>Connecte-toi ou crée un compte (<button onClick={() => setTab("profil")} className="underline" style={{ color: COLORS.accent }}>onglet Mon profil</button>) pour enregistrer ce cours dans tes Plans de cours.</>
              ) : (
                "Connecte-toi ou crée un compte (onglet Mon profil) pour enregistrer ce cours dans tes Plans de cours."
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Générateur : spectacle ---------- */
const SPECTACLE_INTRO_MIN = 5;
const SPECTACLE_SALUT_MIN = 5;
const SPECTACLE_ENTRACTE_MIN = 15;
// Temps de transition réservé entre deux catégories (présentation de la catégorie suivante par le MC).
const SPECTACLE_TRANSITION_MIN = 3;
// Durée moyenne réaliste d'une catégorie jouée en spectacle, pour déduire un nombre de catégories
// cohérent avec la durée voulue — en scène, une catégorie dépasse rarement 4 min (plutôt 3-4 min),
// sauf les catégories Univers qui peuvent aller jusqu'à 6 min.
const SPECTACLE_CATEGORY_AVG_MIN = 3.5;

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function minutesToTime(total) {
  const t = ((Math.round(total) % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
// Options du menu déroulant "heure de début", toutes les 15 min de 9h à 22h (créneaux réalistes
// pour un spectacle — pas besoin de couvrir toute la journée).
const SPECTACLE_START_TIME_OPTIONS = Array.from({ length: 53 }, (_, i) => minutesToTime(9 * 60 + i * 15));

// Calcule, à partir d'une heure de début, l'heure estimée de chaque catégorie en appliquant les
// mêmes règles de timing que le générateur : 5 min d'intro, ~2 min de transition entre deux
// catégories consécutives (sauf la première de chaque partie), puis l'entracte (si coché) entre
// les deux parties. Utilisé à la fois par l'écran (GenerateurSpectacleTab) et par l'export PDF,
// pour être certain que les heures affichées correspondent exactement.
function computeSpectacleSchedule(firstDurations, secondDurations, entracteOn, startTime, stageWarmupMinutes = 0) {
  if (!startTime) return null;
  // L'échauffement de scène (s'il est activé) passe juste après l'introduction, jamais avant :
  // le spectacle commence toujours par l'introduction.
  const introStart = timeToMinutes(startTime);
  const stageWarmupStart = stageWarmupMinutes > 0 ? introStart + SPECTACLE_INTRO_MIN : null;
  let cursor = introStart + SPECTACLE_INTRO_MIN + (stageWarmupMinutes || 0);
  const firstTimes = firstDurations.map((dur, i) => {
    if (i > 0) cursor += SPECTACLE_TRANSITION_MIN;
    const t = cursor;
    cursor += dur;
    return t;
  });
  let entracteStart = null;
  if (entracteOn) {
    entracteStart = cursor;
    cursor += SPECTACLE_ENTRACTE_MIN;
  }
  const secondTimes = secondDurations.map((dur, i) => {
    if (i > 0) cursor += SPECTACLE_TRANSITION_MIN;
    const t = cursor;
    cursor += dur;
    return t;
  });
  return { firstTimes, secondTimes, entracteStart, salutStart: cursor, stageWarmupStart, introStart };
}

function buildSpectacle(categories, { format, niveau, duree, entracteOn, integrerFavoris, stageWarmupMinutes = 0 }) {
  // Le niveau coché est prioritaire, mais un niveau adjacent reste autorisé (Débutant coché →
  // Confirmé accepté, pas Avancé ; Avancé coché → Confirmé accepté, pas Débutant). Les fiches
  // sans niveau précisé restent toujours autorisées.
  const NIVEAU_ORDER = ["Débutant", "Confirmé", "Avancé"];
  const niveauIdx = niveau ? NIVEAU_ORDER.indexOf(niveau) : -1;
  const allowedLevel = (c) => {
    if (!niveau || !c.level) return true;
    const idx = NIVEAU_ORDER.indexOf(c.level);
    return idx === -1 || Math.abs(idx - niveauIdx) <= 1;
  };
  const byLevel = (c) => !niveau || c.level === niveau;
  const categoriesNiveau = categories.filter(allowedLevel);
  // La catégorie "Libre" est retirée des pools normaux : elle n'est plus piochée par hasard comme
  // les autres, mais insérée volontairement à un rythme fixe (voir pickFor plus bas), pour toutes
  // les durées de spectacle.
  const libre = categories.find((c) => c.name === "Libre");
  // "Best-of" est retirée des pools normaux au même titre que "Libre" : l'appli ne doit jamais la
  // proposer ailleurs qu'en clôture de spectacle ou d'entracte (voir pickCloser plus bas).
  const bestOf = categories.find((c) => c.name === "Best-of");
  const categoriesSansLibre = categoriesNiveau.filter((c) => c.id !== libre?.id && c.id !== bestOf?.id);
  // Priorité aux catégories classées pour ce type de spectacle (champ showTypes, à renseigner sur
  // les fiches catégorie) ; le reste de la bibliothèque comble ensuite le temps restant.
  const familyPool = format ? categoriesSansLibre.filter((c) => c.showTypes?.includes(format)) : [];
  const otherPool = categoriesSansLibre.filter((c) => !familyPool.includes(c));
  // Catégories marquées comme pouvant ouvrir un spectacle (champ canOpenShow) : piochées en
  // priorité pour la toute première catégorie de chaque demi-spectacle (voir pickFor plus bas).
  const openerPool = categoriesNiveau.filter((c) => c.canOpenShow);
  const openerFamilyPool = format ? openerPool.filter((c) => c.showTypes?.includes(format)) : [];
  const openerOtherPool = openerPool.filter((c) => !openerFamilyPool.includes(c));
  // Catégories marquées comme pouvant terminer un spectacle (champ canCloseShow, "Best-of" y
  // compris) : piochées en priorité pour la toute dernière catégorie du demi-spectacle concerné
  // (2e partie s'il y a un entracte, spectacle entier sinon — voir wantsCloser plus bas).
  const closerPool = categoriesNiveau.filter((c) => c.canCloseShow);
  const closerFamilyPool = format ? closerPool.filter((c) => c.showTypes?.includes(format)) : [];
  const closerOtherPool = closerPool.filter((c) => !closerFamilyPool.includes(c));
  // Introduction et salut final réservent toujours 5 min chacun ; l'entracte, si coché, réserve
  // 15 min fixes. Le temps restant est ce qui est disponible pour les catégories jouées (et les
  // transitions entre elles).
  const overhead = SPECTACLE_INTRO_MIN + SPECTACLE_SALUT_MIN + (entracteOn ? SPECTACLE_ENTRACTE_MIN : 0) + (stageWarmupMinutes || 0);
  const categoryBudget = Math.max(0, duree - overhead);
  const budget1 = entracteOn ? Math.round(categoryBudget / 2) : categoryBudget;
  const budget2 = entracteOn ? categoryBudget - budget1 : 0;
  // La durée moyenne d'une catégorie inclut la transition vers la suivante, pour ne pas surestimer
  // le nombre de catégories qui tiennent réellement dans le temps imparti. Nombre de catégories
  // ciblé par demi-spectacle, déduit du budget disponible — la bibliothèque (pool disponible,
  // contraintes de diversité) fait naturellement varier ce nombre de ± 1 par entracte (± 2 sur
  // l'ensemble du spectacle), sans qu'il soit besoin de l'imposer.
  const avgWithTransition = SPECTACLE_CATEGORY_AVG_MIN + SPECTACLE_TRANSITION_MIN;
  let maxCount1 = Math.max(1, Math.round(budget1 / avgWithTransition));
  let maxCount2 = entracteOn ? Math.max(1, Math.round(budget2 / avgWithTransition)) : 0;
  // Pour un spectacle de 120 min avec entracte, on ne dépasse jamais 8 catégories par demi-spectacle
  // (le calcul ci-dessus vise naturellement plutôt 6-7, mais ce plafond garde une marge de sécurité).
  if (duree === 120 && entracteOn) {
    maxCount1 = Math.min(maxCount1, 8);
    maxCount2 = Math.min(maxCount2, 8);
  }

  const pickFor = (budget, exclude, maxCount, wantsCloser) => {
    let b = budget, picked = [];
    const localUsed = new Set(exclude);
    // Budget/transition tels qu'ils étaient juste avant la dernière catégorie effectivement
    // piochée par la boucle ci-dessous — utilisés pour éventuellement la remplacer par une
    // catégorie de clôture (voir wantsCloser après la boucle).
    let lastPickBudget = null, lastPickTransition = 0;
    // Pioche une catégorie "normale" (hors Libre) dans le pool prioritaire (classé pour ce type de
    // spectacle), puis dans le reste de la bibliothèque si besoin — mêmes règles de diversité
    // qu'avant (pas deux catégories de suite avec la même énergie marquée ou le même genre).
    const pickNormal = (transition) => {
      const last = picked[picked.length - 1];
      const tryPool = (pool) => {
        const remaining = pool.filter((c) => !localUsed.has(c.id));
        const candidates = remaining.filter((c) => {
          if (last) {
            if ((last.energy === "Forte" || last.energy === "Faible") && c.energy === last.energy) return false;
            if (last.tags?.[0] && c.tags?.[0] === last.tags[0]) return false;
          }
          return true;
        });
        // Repli si la contrainte élimine tous les candidats (ex. fin de bibliothèque) : mieux vaut
        // enchaîner malgré tout que de laisser un trou dans le spectacle.
        const pool2 = candidates.length > 0 ? candidates : remaining;
        let prioritized = pool2.filter(byLevel);
        if (prioritized.length === 0) prioritized = pool2;
        const ordered = integrerFavoris
          ? [...prioritized].sort((a, b2) => (a.favorite ? 0 : 1) - (b2.favorite ? 0 : 1))
          : shuffleArray(prioritized);
        for (const c of ordered) {
          const dur = c.duration || 5;
          if (fitsBudget(dur + transition, b)) return c;
        }
        return null;
      };
      return tryPool(familyPool) || tryPool(otherPool);
    };
    // Pioche la toute première catégorie du demi-spectacle dans le pool "ouverture de spectacle"
    // (fiches marquées canOpenShow, "Libre" y compris) — mêmes règles de niveau/favoris/format que
    // pickNormal, mais sans contrainte de diversité puisqu'il n'y a pas encore de catégorie précédente.
    const pickOpener = () => {
      const tryPool = (pool) => {
        const remaining = pool.filter((c) => c === libre || !localUsed.has(c.id));
        let prioritized = remaining.filter(byLevel);
        if (prioritized.length === 0) prioritized = remaining;
        const ordered = integrerFavoris
          ? [...prioritized].sort((a, b2) => (a.favorite ? 0 : 1) - (b2.favorite ? 0 : 1))
          : shuffleArray(prioritized);
        for (const c of ordered) {
          const dur = c.duration || 5;
          if (fitsBudget(dur, b)) return c;
        }
        return null;
      };
      return tryPool(openerFamilyPool) || tryPool(openerOtherPool);
    };
    // Pioche une catégorie de clôture (fiches marquées canCloseShow, "Best-of" y compris) — mêmes
    // règles que pickNormal, mais sans contrainte de diversité (appelée après coup, une fois la
    // dernière catégorie du demi-spectacle connue).
    const pickCloser = (transition) => {
      const tryPool = (pool) => {
        const remaining = pool.filter((c) => c === bestOf || !localUsed.has(c.id));
        let prioritized = remaining.filter(byLevel);
        if (prioritized.length === 0) prioritized = remaining;
        const ordered = integrerFavoris
          ? [...prioritized].sort((a, b2) => (a.favorite ? 0 : 1) - (b2.favorite ? 0 : 1))
          : shuffleArray(prioritized);
        for (const c of ordered) {
          const dur = c.duration || 5;
          if (fitsBudget(dur + transition, b)) return c;
        }
        return null;
      };
      return tryPool(closerFamilyPool) || tryPool(closerOtherPool);
    };
    while (b > 0 && picked.length < maxCount) {
      // Chaque catégorie après la première consomme aussi ~2 min de transition (présentation de
      // la catégorie suivante), en plus de sa propre durée.
      const transition = picked.length > 0 ? SPECTACLE_TRANSITION_MIN : 0;
      // On s'arrête dès qu'il ne reste plus assez de temps pour donner une durée correcte à une
      // catégorie de plus, plutôt que d'en ajouter une et l'écraser à 0 ou 1 minute.
      if (b - transition < MIN_CARD_DURATION) break;
      // Une catégorie générée sur 3 (positions 3, 6, 9…) est la catégorie "Libre" — pour toutes
      // les durées de spectacle. Si elle ne rentre pas dans le budget restant à ce moment-là, on
      // retombe simplement sur une catégorie normale plutôt que de casser le rythme.
      const wantsLibre = libre && (picked.length + 1) % 3 === 0 && fitsBudget((libre.duration || 5) + transition, b);
      const chosen = picked.length === 0
        ? pickOpener() || (wantsLibre ? libre : pickNormal(transition))
        : (wantsLibre ? libre : pickNormal(transition));
      if (!chosen) break;
      const dur = chosen.duration || 5;
      // Durée réellement affichée : celle de la fiche (typiquement 3-4 min, jusqu'à 6 pour les
      // catégories Univers), resserrée seulement si besoin pour tenir dans le temps restant.
      picked.push({ ...chosen, actualDuration: Math.max(MIN_CARD_DURATION, Math.min(dur, Math.max(0, b - transition))) });
      lastPickBudget = b;
      lastPickTransition = transition;
      // "Libre" et "Best-of" restent volontairement hors de `exclude`/`localUsed` : elles peuvent
      // revenir à chaque 3e position (Libre) ou en clôture (Best-of), sans jamais être "épuisées".
      if (chosen !== libre && chosen !== bestOf) { exclude.add(chosen.id); localUsed.add(chosen.id); }
      b = consumeBudget(dur + transition, b);
    }
    // Si on veut terminer ce demi-spectacle par une catégorie de clôture (2e partie s'il y a un
    // entracte, spectacle entier sinon — voir wantsCloser), on tente de remplacer la dernière
    // catégorie piochée par une catégorie marquée canCloseShow, à budget équivalent — sans rien
    // changer si la dernière catégorie l'est déjà, ou si aucune ne rentre dans ce créneau.
    if (wantsCloser && picked.length > 0) {
      const lastIdx = picked.length - 1;
      const lastItem = picked[lastIdx];
      if (!lastItem.canCloseShow) {
        const lastIsSpecial = lastItem.id === libre?.id || lastItem.id === bestOf?.id;
        if (!lastIsSpecial) { exclude.delete(lastItem.id); localUsed.delete(lastItem.id); }
        b = lastPickBudget;
        const closer = pickCloser(lastPickTransition);
        if (closer) {
          const dur = closer.duration || 5;
          picked[lastIdx] = { ...closer, actualDuration: Math.max(MIN_CARD_DURATION, Math.min(dur, Math.max(0, lastPickBudget - lastPickTransition))) };
          if (closer !== libre && closer !== bestOf) { exclude.add(closer.id); localUsed.add(closer.id); }
        } else if (!lastIsSpecial) {
          exclude.add(lastItem.id); localUsed.add(lastItem.id);
        }
      }
    }
    return picked;
  };

  const exclude = new Set();
  // La catégorie de clôture est priorisée sur la 2e partie s'il y a un entracte (fin de spectacle),
  // ou sur la partie unique sinon — jamais sur la 1re partie quand il y a un entracte (elle se
  // termine juste par l'entracte, pas par le spectacle).
  const first = pickFor(budget1, exclude, maxCount1, !entracteOn);
  const second = entracteOn ? pickFor(budget2, exclude, maxCount2, true) : [];
  return { first, second, budget1, budget2 };
}

function DropZone() {
  return <div style={{ height: 10 }} />;
}

function GenerateurSpectacleTab({ data, allData, update, plan, setPlan, currentUser, setTab }) {
  // Catégories en attente/refusées du créateur courant : jamais proposées par le tirage automatique,
  // mais ajoutées au pool de recherche manuelle du picker pour qu'il puisse quand même les ajouter
  // lui-même à son spectacle (voir notifyCreatorRejected).
  const myPendingCategories = currentUser ? (allData?.categories || []).filter((c) => c.creatorUsername === currentUser && (c.pending || c.rejected)) : [];
  const pickerCategories = myPendingCategories.length > 0 ? [...data.categories, ...myPendingCategories] : data.categories;
  const [format, setFormat] = useState("Cabaret");
  const [duree, setDuree] = useState(120);
  const [comediens, setComediens] = useState(4);
  const [niveau, setNiveau] = useState("");
  const [entracteOn, setEntracteOn] = useState(true);
  const [integrerFavoris, setIntegrerFavoris] = useState(false);
  const [startTime, setStartTime] = useState("20:00");
  const [commencerEchauffementScene, setCommencerEchauffementScene] = useState(false);
  const result = plan;
  const setResult = setPlan;
  const [toastMsg, showToast] = useToast();
  const [name, setName] = useState("");
  const [catPicker, setCatPicker] = useState(null); // { part, idx }
  const [stageWarmupPicker, setStageWarmupPicker] = useState(false);
  const [expandedId, setExpandedId] = useState(null); // affiche la description complète d'une carte
  const handleCardTap = (id) => setExpandedId(expandedId === id ? null : id);

  const generate = () => {
    // L'échauffement de scène (si coché) est tiré en premier, car sa durée réduit le temps
    // disponible pour les catégories (voir buildSpectacle) — il doit toujours passer avant
    // l'introduction et n'est jamais réinséré après l'entracte.
    const stageWarmupPool = data.exercises.filter((e) => e.stageWarmup);
    const stageWarmup = commencerEchauffementScene ? pickRandom(stageWarmupPool) : null;
    const built = buildSpectacle(data.categories, { format, niveau, duree, entracteOn, integrerFavoris, stageWarmupMinutes: stageWarmup?.duration || 0 });
    const withMode = (arr) => arr.map((c) => ({ ...c, matchMode: "Mixte" }));
    setResult({ ...built, first: withMode(built.first), second: withMode(built.second), stageWarmup });
  };

  const replaceStageWarmup = () => {
    if (!result) return;
    const used = new Set(result.stageWarmup ? [result.stageWarmup.id] : []);
    const pool = data.exercises.filter((e) => e.stageWarmup && !used.has(e.id));
    const pick = pickRandom(pool.length > 0 ? pool : data.exercises.filter((e) => e.stageWarmup));
    if (!pick) return;
    setResult({ ...result, stageWarmup: pick });
  };
  const pickStageWarmupManually = (ex) => {
    if (!result) return;
    setResult({ ...result, stageWarmup: ex });
    setStageWarmupPicker(false);
  };
  const removeStageWarmup = () => {
    if (!result) return;
    setResult({ ...result, stageWarmup: null });
  };

  const setMatchMode = (part, idx, mode) => {
    if (!result) return;
    setResult({ ...result, [part]: result[part].map((c, i) => (i === idx ? { ...c, matchMode: mode } : c)) });
  };

  const toggleFavCat = (id) => {
    if (!currentUser) { showToast("Désolé, il te faut un compte pour enregistrer tes créations !", { type: "notice" }); return; }
    update((d) => { const c = d.categories.find((x) => x.id === id); if (c) c.favorite = !c.favorite; return d; });
    setResult((prev) => {
      if (!prev) return prev;
      const flip = (arr) => arr.map((c) => (c.id === id ? { ...c, favorite: !c.favorite } : c));
      return { ...prev, first: flip(prev.first), second: flip(prev.second) };
    });
  };

  const removeCat = (part, idx) => {
    if (!result) return;
    const copy = { ...result, [part]: result[part].filter((_, i) => i !== idx) };
    setResult(copy);
  };
  const NIVEAU_ORDER = ["Débutant", "Confirmé", "Avancé"];
  const replaceCat = (part, idx) => {
    if (!result) return;
    const used = new Set([...result.first, ...result.second].map((c) => c.id));
    // "Best-of" ne doit jamais être proposée par l'appli ailleurs qu'en clôture de spectacle ou
    // d'entracte (dernière catégorie de la 2e partie s'il y a un entracte, ou dernière catégorie
    // de l'unique partie sinon) — jamais sur un autre créneau, même via "Aléatoire".
    const isCloserSlot = part === "second"
      ? entracteOn && idx === result.second.length - 1
      : !entracteOn && idx === result.first.length - 1;
    let pool = data.categories.filter((c) => !used.has(c.id) && (isCloserSlot || c.name !== "Best-of"));
    if (niveau) {
      const niveauIdx = NIVEAU_ORDER.indexOf(niveau);
      pool = pool.filter((c) => !c.level || NIVEAU_ORDER.indexOf(c.level) === -1 || Math.abs(NIVEAU_ORDER.indexOf(c.level) - niveauIdx) <= 1);
    }
    // La toute première catégorie de chaque partie priorise les catégories cochées "peut ouvrir un
    // spectacle" ; une fois ce vivier épuisé, on retombe sur le reste de la bibliothèque (Best-of
    // reste de toute façon exclue ici, ce n'est jamais un créneau de clôture).
    if (idx === 0) {
      const openerPool = pool.filter((c) => c.canOpenShow);
      if (openerPool.length > 0) pool = openerPool;
    }
    const byFormat = format ? pool.filter((c) => c.showTypes?.includes(format)) : [];
    const pick = pickRandom(byFormat.length > 0 ? byFormat : pool);
    if (!pick) return;
    // On garde le temps réservé pour ce créneau (resserré pour tenir dans la durée du spectacle),
    // plutôt que la durée brute de la fiche tirée, pour ne pas faire dériver le total affiché.
    const oldBudget = result[part][idx]?.actualDuration ?? result[part][idx]?.duration ?? 5;
    const copy = { ...result, [part]: result[part].map((c, i) => (i === idx ? { ...pick, matchMode: "Mixte", actualDuration: oldBudget } : c)) };
    setResult(copy);
  };
  const saveScroll = usePreserveScroll();
  const pickCatManually = (cat) => {
    if (!result || !catPicker) return;
    saveScroll();
    let copy;
    if (catPicker.mode === "add") {
      const catWithMode = { ...cat, matchMode: "Mixte" };
      copy = { ...result, [catPicker.part]: [...result[catPicker.part], catWithMode] };
    } else {
      // Idem : on garde le temps réservé pour ce créneau plutôt que la durée brute de la fiche.
      const oldBudget = result[catPicker.part][catPicker.idx]?.actualDuration ?? result[catPicker.part][catPicker.idx]?.duration ?? 5;
      const catWithMode = { ...cat, matchMode: "Mixte", actualDuration: oldBudget };
      copy = { ...result, [catPicker.part]: result[catPicker.part].map((c, i) => (i === catPicker.idx ? catWithMode : c)) };
    }
    setResult(copy);
    setCatPicker(null);
  };
  const onReorder = useCallback((listKey, fromIndex, insertAt) => {
    setResult((prev) => (prev ? { ...prev, [listKey]: reorderArray(prev[listKey], fromIndex, insertAt) } : prev));
  }, []);
  const { dragged, dragPos, startPress } = useDragReorder(onReorder);
  const draggedCat = dragged ? result?.[dragged.listKey]?.[dragged.index] : null;

  const allCats = result ? [...result.first, ...result.second] : [];
  // Durées effectivement retenues (resserrées pour tenir dans le temps demandé) — transmises au PDF
  // pour qu'il affiche exactement les mêmes durées/total que cet écran (voir exportSpectaclePlanPDF).
  const durationsById = {};
  const matchModeById = {};
  allCats.forEach((c) => {
    durationsById[c.id] = c.actualDuration ?? c.duration ?? 5;
    if (format === "Match") matchModeById[c.id] = c.matchMode || "Mixte";
  });
  // Heures estimées de passage de chaque catégorie, calculées à partir de l'heure de début choisie
  // (nulles si aucune heure n'a été précisée) — voir computeSpectacleSchedule.
  const schedule = result && startTime
    ? computeSpectacleSchedule(
        result.first.map((c) => c.actualDuration ?? c.duration ?? 5),
        result.second.map((c) => c.actualDuration ?? c.duration ?? 5),
        entracteOn,
        startTime,
        result.stageWarmup?.duration || 0
      )
    : null;

  return (
    <div>
      {dragged && dragPos && draggedCat && (
        <DragGhost x={dragPos.x} y={dragPos.y} title={draggedCat.name} subtitle={`${draggedCat.duration || 5} min`} />
      )}
      <SectionHeader icon={Theater} title="Créer un spectacle" subtitle="Un déroulé complet, prêt à ajuster." />
      <p className="text-sm mb-3" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
        Il est possible que tu n'aies pas le temps de faire toutes les catégories proposées, n'hésite pas à en supprimer ou en ajouter lors de ton spectacle. Improvise et adapte !
      </p>
      <Toast toast={toastMsg} />
      <IndexCard>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Format">
            <select
              className={inputClass} style={inputStyle} value={format}
              onChange={(e) => {
                const val = e.target.value;
                setFormat(val);
                if (val === "Cabaret") setComediens(4);
                else if (val === "Match") setComediens(8);
              }}
            >
              <option value="">Choisir un format</option>
              {data.showTypes.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Niveau">
            <select className={inputClass} style={inputStyle} value={niveau} onChange={(e) => setNiveau(e.target.value)}>
              <option value="">Tous niveaux</option>
              {NIVEAUX.map((n) => <option key={n}>{n}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Durée totale">
            <select
              className="rounded-sm px-2 py-1.5 text-sm outline-none focus:ring-2" style={{ ...inputStyle, width: "auto" }} value={duree}
              onChange={(e) => {
                const v = Number(e.target.value);
                setDuree(v);
                // Décoche l'entracte par défaut sur les formats courts (30/60 min) : une pause de
                // 15 min y prend une part disproportionnée du temps disponible. L'utilisateur peut
                // toujours la recocher manuellement.
                if (v === 30 || v === 60) setEntracteOn(false);
              }}
            >
              {[30, 60, 90, 120].map((t) => <option key={t} value={t}>{t} min</option>)}
            </select>
          </Field>
          <Field label="Nombre de comédiens">
            <select className={inputClass} style={inputStyle} value={comediens} onChange={(e) => setComediens(Number(e.target.value))}>
              {STUDENTS_COUNTS.slice(0, 10).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
        </div>
        <OuiNonField label="Commencer par un échauffement de scène ?" value={commencerEchauffementScene} onChange={setCommencerEchauffementScene} />
        <OuiNonField label="Intégrer mes favoris ?" value={integrerFavoris} onChange={setIntegrerFavoris} />
        <OuiNonField label="Avec entracte (15 min réservées) ?" value={entracteOn} onChange={setEntracteOn} />
        <Field label="À quelle heure commence ton spectacle ?">
          <select className={inputClass} style={inputStyle} value={startTime} onChange={(e) => setStartTime(e.target.value)}>
            <option value="">Heure non précisée</option>
            {SPECTACLE_START_TIME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Btn variant="accent" onClick={generate}><Sparkles size={14} /> Créer</Btn>
      </IndexCard>

      {result && (
        <>
          {/* Le spectacle commence toujours par l'introduction : aucune catégorie (ni l'échauffement de
              scène) n'est jamais placée avant elle. L'échauffement de scène, s'il est activé, passe en
              tout premier juste après. */}
          <IndexCard><span style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase">Introduction — {SPECTACLE_INTRO_MIN} min{schedule ? ` — ${minutesToTime(schedule.introStart)}` : ""}</span></IndexCard>
          <DropZone />
          {result.stageWarmup && (
            <>
              {schedule && (
                <div className="text-xs font-semibold mb-1" style={{ fontFamily: FONT_MONO, color: COLORS.brass, marginTop: -6, lineHeight: 1 }}>
                  🕐 {minutesToTime(schedule.stageWarmupStart)}
                </div>
              )}
              <IndexCard>
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1">
                    <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">{result.stageWarmup.title}</h3>
                    <div className="flex flex-wrap items-center mt-1 mb-1" style={{ minHeight: 22 }}>
                      <span className="inline-block text-xs px-2 py-0.5 rounded-full" style={{ fontFamily: FONT_MONO, background: COLORS.brass, color: "#fff" }}>
                        Échauffement de scène
                      </span>
                      {result.stageWarmup.groupe && (
                        <span className="inline-block text-xs px-2 py-0.5 rounded-full ml-1" style={{ fontFamily: FONT_MONO, background: COLORS.accent, color: "#fff" }}>
                          {result.stageWarmup.groupe}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs mb-1" style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }}>
                      <span>{result.stageWarmup.duration} min</span>
                      {result.stageWarmup.energy && <span>· {ENERGY_DOT[result.stageWarmup.energy] || ""} énergie {result.stageWarmup.energy}</span>}
                    </div>
                    <p style={{ fontFamily: FONT_BODY, color: COLORS.textSoft, minHeight: "2.6em" }} className="text-sm">
                      {result.stageWarmup.summary}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 items-end">
                    <Btn small variant="ghost" onClick={replaceStageWarmup}>Aléatoire</Btn>
                    <Btn small variant="ghost" onClick={() => setStageWarmupPicker(true)}>Modifier</Btn>
                  </div>
                </div>
                <div className="flex justify-end items-center mt-2">
                  <button onClick={removeStageWarmup} title="Supprimer"><Trash2 size={22} color={COLORS.accent} /></button>
                </div>
              </IndexCard>
              {stageWarmupPicker && (
                <ExercisePicker
                  exercises={data.exercises}
                  excludeIds={[result.stageWarmup.id]}
                  onSelect={pickStageWarmupManually}
                  onCancel={() => setStageWarmupPicker(false)}
                />
              )}
              <DropZone />
            </>
          )}
          {result.first.map((c, i) => (
            <React.Fragment key={`${c.id}-${i}`}>
              <div
                data-drop-card="true"
                data-list="first"
                data-index={i}
                onPointerDown={(e) => { if (e.pointerType === "mouse" && !e.target.closest("[data-drag-handle]")) return; startPress("first", i, e); }}
                style={{
                  position: "relative",
                  opacity: dragged?.part === "first" && dragged.index === i ? 0.4 : 1,
                  userSelect: "none", WebkitUserSelect: "none", touchAction: "none",
                }}
              >
                {/* Seule la dernière catégorie avant l'entracte (ou la dernière du spectacle si pas
                    d'entracte) affiche son heure — pas chaque carte, pour ne pas surcharger l'écran. */}
                {schedule && i === result.first.length - 1 && (
                  <div className="text-xs font-semibold mb-1" style={{ fontFamily: FONT_MONO, color: COLORS.brass, marginTop: -6, lineHeight: 1 }}>
                    🕐 {minutesToTime(schedule.firstTimes[i])}
                  </div>
                )}
                <IndexCard>
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1" onClick={() => handleCardTap(c.id)} style={{ cursor: "pointer" }}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">{c.name}</h3>
                          <button onClick={(e) => { e.stopPropagation(); toggleFavCat(c.id); }} title="Favori">
                            <Star size={18} color={c.favorite ? COLORS.brass : COLORS.textSoft} fill={c.favorite ? COLORS.brass : "none"} />
                          </button>
                        </div>
                        {format === "Match" && (
                          <div className="flex rounded-sm overflow-hidden shrink-0" style={{ border: `1px solid ${COLORS.accent}` }} onClick={(e) => e.stopPropagation()}>
                            {["Mixte", "Comparé"].map((mode) => (
                              <button
                                key={mode}
                                onClick={() => setMatchMode("first", i, mode)}
                                className="text-xs px-2 py-1"
                                style={{ fontFamily: FONT_MONO, background: (c.matchMode || "Mixte") === mode ? COLORS.accent : "transparent", color: (c.matchMode || "Mixte") === mode ? "#fff" : COLORS.accent }}
                              >
                                {mode}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* Hauteur toujours réservée (même sans tag, comme pour "Libre") pour éviter que la
                          carte suivante ne se décale et que le clic sur "Aléatoire" d'une carte voisine
                          n'atterrisse par erreur sur un autre bouton après le remplacement. */}
                      <div className="mt-1 mb-1" style={{ minHeight: 22 }}>
                        {(c.tags || []).length > 0 ? (
                          <span
                            className="inline-block text-xs px-2 py-0.5 rounded-full"
                            style={{ fontFamily: FONT_MONO, background: "#B3382C", color: "#fff" }}
                          >
                            {c.tags.join(" · ")}
                          </span>
                        ) : c.name === "Libre" && (
                          <span
                            className="inline-block text-xs px-2 py-0.5 rounded-full"
                            style={{ fontFamily: FONT_MONO, background: COLORS.brass, color: "#fff" }}
                          >
                            Libre
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs mb-1" style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }}>
                        <span>{c.actualDuration ?? c.duration ?? 5} min</span>
                        {c.energy && <span>· {ENERGY_DOT[c.energy] || ""} énergie {c.energy}</span>}
                        <span>· Nombre de joueurs : {playersCountText(c)}</span>
                      </div>
                      <p
                        style={{
                          fontFamily: FONT_BODY, color: COLORS.textSoft,
                          // Hauteur minimale de 2 lignes réservée même pour les résumés courts (ex. "Libre"),
                          // pour éviter un décalage des cartes suivantes qui ferait rater le bon bouton en cas
                          // de clics rapprochés sur "Aléatoire".
                          ...(expandedId === c.id ? {} : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: "2.6em" }),
                        }}
                        className="text-sm"
                      >
                        {c.summary}
                      </p>
                      {expandedId === c.id && (
                        <div className="mt-1 text-xs" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
                          <div>{c.level || "Niveau non précisé"}</div>
                          {c.archetypes?.length > 0 && <div>Archétypes : {c.archetypes.map((a) => a.name).join(", ")}</div>}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 items-end">
                      <Btn small variant="ghost" onClick={() => replaceCat("first", i)}>Aléatoire</Btn>
                      <Btn small variant="ghost" onClick={() => setCatPicker({ part: "first", idx: i })}>Modifier</Btn>
                    </div>
                  </div>
                  <div className="flex justify-end items-center mt-2">
                    <div className="flex items-center gap-3">
                      <DragHandleLabel />
                      <button onClick={() => removeCat("first", i)} title="Supprimer"><Trash2 size={22} color={COLORS.accent} /></button>
                    </div>
                  </div>
                </IndexCard>
              </div>
              {catPicker?.part === "first" && catPicker.idx === i && catPicker.mode !== "add" && (
                <CategoryPicker
                  categories={pickerCategories}
                  excludeIds={allCats.map((c) => c.id)}
                  onSelect={pickCatManually}
                  onCancel={() => setCatPicker(null)}
                />
              )}
              <DropZone />
            </React.Fragment>
          ))}
          {/* Ce bouton n'a d'utilité que lorsqu'il y a un entracte : sans entracte, le second bouton
              "Ajouter une catégorie" (part="first" aussi dans ce cas) suffit déjà en bas de page. */}
          {entracteOn && (
            <div className="mb-2">
              <Btn small variant="accent" onClick={() => setCatPicker({ mode: "add", part: "first" })}><Plus size={13} /> Ajouter une catégorie</Btn>
            </div>
          )}
          {entracteOn && (
            <IndexCard style={{ background: COLORS.brass, border: `2px solid ${COLORS.ink}`, textAlign: "center", padding: "14px" }}>
              <span style={{ fontFamily: FONT_MONO, color: COLORS.card }} className="text-lg font-bold uppercase tracking-wide">
                Entracte — {SPECTACLE_ENTRACTE_MIN} min{schedule ? ` — ${minutesToTime(schedule.entracteStart)}` : ""}
              </span>
            </IndexCard>
          )}
          <DropZone />
          {result.second.map((c, i) => (
            <React.Fragment key={`${c.id}-${i}`}>
              <div
                data-drop-card="true"
                data-list="second"
                data-index={i}
                onPointerDown={(e) => { if (e.pointerType === "mouse" && !e.target.closest("[data-drag-handle]")) return; startPress("second", i, e); }}
                style={{
                  position: "relative",
                  opacity: dragged?.part === "second" && dragged.index === i ? 0.4 : 1,
                  userSelect: "none", WebkitUserSelect: "none", touchAction: "none",
                }}
              >
                {/* Seules la première catégorie après l'entracte et la dernière du spectacle affichent
                    leur heure — pas chaque carte. */}
                {schedule && (i === 0 || i === result.second.length - 1) && (
                  <div className="text-xs font-semibold mb-1" style={{ fontFamily: FONT_MONO, color: COLORS.brass, marginTop: -6, lineHeight: 1 }}>
                    🕐 {minutesToTime(schedule.secondTimes[i])}
                  </div>
                )}
                <IndexCard>
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1" onClick={() => handleCardTap(c.id)} style={{ cursor: "pointer" }}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">{c.name}</h3>
                          <button onClick={(e) => { e.stopPropagation(); toggleFavCat(c.id); }} title="Favori">
                            <Star size={18} color={c.favorite ? COLORS.brass : COLORS.textSoft} fill={c.favorite ? COLORS.brass : "none"} />
                          </button>
                        </div>
                        {format === "Match" && (
                          <div className="flex rounded-sm overflow-hidden shrink-0" style={{ border: `1px solid ${COLORS.accent}` }} onClick={(e) => e.stopPropagation()}>
                            {["Mixte", "Comparé"].map((mode) => (
                              <button
                                key={mode}
                                onClick={() => setMatchMode("second", i, mode)}
                                className="text-xs px-2 py-1"
                                style={{ fontFamily: FONT_MONO, background: (c.matchMode || "Mixte") === mode ? COLORS.accent : "transparent", color: (c.matchMode || "Mixte") === mode ? "#fff" : COLORS.accent }}
                              >
                                {mode}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* Hauteur toujours réservée (même sans tag, comme pour "Libre") pour éviter que la
                          carte suivante ne se décale et que le clic sur "Aléatoire" d'une carte voisine
                          n'atterrisse par erreur sur un autre bouton après le remplacement. */}
                      <div className="mt-1 mb-1" style={{ minHeight: 22 }}>
                        {(c.tags || []).length > 0 ? (
                          <span
                            className="inline-block text-xs px-2 py-0.5 rounded-full"
                            style={{ fontFamily: FONT_MONO, background: "#B3382C", color: "#fff" }}
                          >
                            {c.tags.join(" · ")}
                          </span>
                        ) : c.name === "Libre" && (
                          <span
                            className="inline-block text-xs px-2 py-0.5 rounded-full"
                            style={{ fontFamily: FONT_MONO, background: COLORS.brass, color: "#fff" }}
                          >
                            Libre
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs mb-1" style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }}>
                        <span>{c.actualDuration ?? c.duration ?? 5} min</span>
                        {c.energy && <span>· {ENERGY_DOT[c.energy] || ""} énergie {c.energy}</span>}
                        <span>· Nombre de joueurs : {playersCountText(c)}</span>
                      </div>
                      <p
                        style={{
                          fontFamily: FONT_BODY, color: COLORS.textSoft,
                          // Hauteur minimale de 2 lignes réservée même pour les résumés courts (ex. "Libre"),
                          // pour éviter un décalage des cartes suivantes qui ferait rater le bon bouton en cas
                          // de clics rapprochés sur "Aléatoire".
                          ...(expandedId === c.id ? {} : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: "2.6em" }),
                        }}
                        className="text-sm"
                      >
                        {c.summary}
                      </p>
                      {expandedId === c.id && (
                        <div className="mt-1 text-xs" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
                          <div>{c.level || "Niveau non précisé"}</div>
                          {c.archetypes?.length > 0 && <div>Archétypes : {c.archetypes.map((a) => a.name).join(", ")}</div>}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 items-end">
                      <Btn small variant="ghost" onClick={() => replaceCat("second", i)}>Aléatoire</Btn>
                      <Btn small variant="ghost" onClick={() => setCatPicker({ part: "second", idx: i })}>Modifier</Btn>
                    </div>
                  </div>
                  <div className="flex justify-end items-center mt-2">
                    <div className="flex items-center gap-3">
                      <DragHandleLabel />
                      <button onClick={() => removeCat("second", i)} title="Supprimer"><Trash2 size={22} color={COLORS.accent} /></button>
                    </div>
                  </div>
                </IndexCard>
              </div>
              {catPicker?.part === "second" && catPicker.idx === i && catPicker.mode !== "add" && (
                <CategoryPicker
                  categories={pickerCategories}
                  excludeIds={allCats.map((c) => c.id)}
                  onSelect={pickCatManually}
                  onCancel={() => setCatPicker(null)}
                />
              )}
              <DropZone />
            </React.Fragment>
          ))}
          <div className="mb-2">
            <Btn small variant="accent" onClick={() => setCatPicker({ mode: "add", part: entracteOn ? "second" : "first" })}><Plus size={13} /> Ajouter une catégorie</Btn>
          </div>
          {catPicker?.mode === "add" && (
            <CategoryPicker
              categories={pickerCategories}
              excludeIds={allCats.map((c) => c.id)}
              onSelect={pickCatManually}
              onCancel={() => setCatPicker(null)}
            />
          )}
          <IndexCard><span style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase">Salut final — {SPECTACLE_SALUT_MIN} min{schedule ? ` — ${minutesToTime(schedule.salutStart)}` : ""}</span></IndexCard>

          <div className="flex gap-2 mt-2 mb-2">
            <Btn
              variant="ghost"
              onClick={() => exportSpectaclePlanPDF(
                {
                  name: name || "Spectacle",
                  format, duree,
                  categoryIds: allCats.map((c) => c.id),
                  durationsById,
                  matchModeById,
                  entracte: entracteOn ? { duree: SPECTACLE_ENTRACTE_MIN, firstCount: result.first.length } : null,
                  startTime: startTime || null,
                  stageWarmup: result.stageWarmup ? { title: result.stageWarmup.title, duration: result.stageWarmup.duration } : null,
                },
                data
              )}
            >
              <Download size={14} /> Télécharger en PDF
            </Btn>
          </div>
          {currentUser ? (
            <div className="flex gap-2">
              <input className={inputClass} style={{ ...inputStyle, flex: 1 }} placeholder="Nom du spectacle" value={name} onChange={(e) => setName(e.target.value)} />
              <Btn variant="accent" disabled={!name} onClick={() => {
                update((d) => {
                  d.spectaclePlans.push({
                    id: uid(), name, format, duree,
                    categoryIds: allCats.map((c) => c.id),
                    durationsById,
                    matchModeById,
                    entracte: entracteOn ? { duree: SPECTACLE_ENTRACTE_MIN, firstCount: result.first.length } : null,
                    startTime: startTime || null,
                    stageWarmup: result.stageWarmup ? { title: result.stageWarmup.title, duration: result.stageWarmup.duration } : null,
                  });
                  return d;
                });
                setName(""); setResult(null);
                showToast("Spectacle enregistré ✓");
              }}>
                <Save size={14} /> Enregistrer
              </Btn>
            </div>
          ) : (
            <p className="text-xs italic" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
              {setTab ? (
                <>Connecte-toi ou crée un compte (<button onClick={() => setTab("profil")} className="underline" style={{ color: COLORS.accent }}>onglet Mon profil</button>) pour enregistrer ce spectacle dans tes Plans de cours.</>
              ) : (
                "Connecte-toi ou crée un compte (onglet Mon profil) pour enregistrer ce spectacle dans tes Plans de cours."
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- Générateur : échauffement ---------- */
function GenerateurEchauffementTab({ data, update, plan, setPlan, currentUser }) {
  const [temps, setTemps] = useState(10);
  const [participants, setParticipants] = useState(4);
  const [niveau, setNiveau] = useState("");
  const [contexte, setContexte] = useState(CONTEXTES_ECHAUFFEMENT[0]);
  const [spectaclePersonnaliseId, setSpectaclePersonnaliseId] = useState("");
  const [joueursSeConnaissent, setJoueursSeConnaissent] = useState(true);
  const [tags, setTags] = useState([]); // objectifs OU thématiques mélangés, un seul menu de recherche
  const list = plan;
  const setList = setPlan;
  const [expandedId, setExpandedId] = useState(null);
  const [picker, setPicker] = useState(null); // { mode: "add" } | { mode: "replace", idx }
  const [toastMsg, showToast] = useToast();

  const generate = () => {
    const matches = (e) => tags.length === 0 || tags.includes(e.groupe);
    const byLevel = (e) => !niveau || e.level === niveau;
    // Sous 5 participants, on écarte les échauffements tagués "Cercle" (peu adaptés à un petit groupe).
    const byGroupSize = (e) => participants >= 5 || !e.objectives?.includes("Cercle");
    const warmupAll = data.exercises.filter((e) => e.warmup && byGroupSize(e));
    const matchedPool = warmupAll.filter(matches);
    const otherPool = warmupAll.filter((e) => !matches(e));
    let budget = temps, picked = [];

    const fillFrom = (pool) => {
      // Priorise les exercices qui correspondent aux tags cochés ; une fois ces possibilités
      // épuisées, continue avec le reste du pool fourni.
      const shuffled = shuffleArray([...pool.filter(byLevel), ...pool]);
      for (const e of shuffled) {
        // On s'arrête dès qu'il ne reste plus assez de budget pour une durée correcte, plutôt que
        // de retenir un exercice de plus et l'écraser à 0 ou 1 minute.
        if (budget < MIN_CARD_DURATION) break;
        if (picked.find((p) => p.id === e.id)) continue;
        if (fitsBudget(e.duration, budget)) { picked.push({ ...e, actualDuration: Math.min(e.duration, budget) }); budget = consumeBudget(e.duration, budget); }
      }
    };
    // Si les joueurs ne se connaissent pas, on intègre en priorité un échauffement de la famille
    // "Groupe, prénoms et confiance" (dès que le budget le permet).
    if (joueursSeConnaissent === false && budget >= MIN_CARD_DURATION) {
      const famillePool = warmupAll.filter((e) => e.groupe === "Groupe, prénoms et confiance" && fitsBudget(e.duration, budget));
      const famillePick = pickRandom(famillePool);
      if (famillePick) { picked.push({ ...famillePick, actualDuration: Math.min(famillePick.duration, budget) }); budget = consumeBudget(famillePick.duration, budget); }
    }
    // Au-delà de 6 participants, on intègre obligatoirement un échauffement de la famille "Cercle"
    // (plus adapté aux grands groupes) dès que le budget le permet.
    if (participants > 6 && budget >= MIN_CARD_DURATION) {
      const cerclePool = warmupAll.filter((e) => e.groupe === "Cercle" && !picked.find((p) => p.id === e.id) && fitsBudget(e.duration, budget));
      const cerclePick = pickRandom(cerclePool);
      if (cerclePick) { picked.push({ ...cerclePick, actualDuration: Math.min(cerclePick.duration, budget) }); budget = consumeBudget(cerclePick.duration, budget); }
    }
    // On épuise d'abord les exercices qui matchent les tags cochés, puis on comble avec le reste
    // de la bibliothèque pour respecter le temps disponible demandé. Si un échauffement "Groupe,
    // prénoms et confiance" a déjà été ajouté ci-dessus (joueurs qui ne se connaissent pas), on
    // évite d'en reproposer un autre dans cette génération automatique — un clic sur "Aléatoire"
    // pourra quand même en repiocher un ensuite, à la demande de l'utilisateur.
    const alreadyHasGroupeFamily = joueursSeConnaissent === false && picked.some((p) => p.groupe === "Groupe, prénoms et confiance");
    const matchedPoolForFill = alreadyHasGroupeFamily ? matchedPool.filter((e) => e.groupe !== "Groupe, prénoms et confiance") : matchedPool;
    const otherPoolForFill = alreadyHasGroupeFamily ? otherPool.filter((e) => e.groupe !== "Groupe, prénoms et confiance") : otherPool;
    fillFrom(matchedPoolForFill);
    if (budget > 0) fillFrom(otherPoolForFill);
    // On propose toujours au moins 2 échauffements, même si le temps choisi est très court.
    if (picked.length < 2) {
      const remaining = [...warmupAll].filter((e) => !picked.find((p) => p.id === e.id)).sort((a, b) => a.duration - b.duration);
      for (const e of remaining) {
        if (picked.length >= 2) break;
        picked.push({ ...e, actualDuration: e.duration });
      }
    }
    setList(picked);
  };

  const total = (list || []).reduce((s, e) => s + Number(e.actualDuration ?? e.duration ?? 0), 0);

  const handleCardTap = (id) => setExpandedId(expandedId === id ? null : id);
  const toggleFavorite = (id) => {
    if (!currentUser) { showToast("Désolé, il te faut un compte pour enregistrer tes créations !", { type: "notice" }); return; }
    update((d) => { const e = d.exercises.find((x) => x.id === id); if (e) e.favorite = !e.favorite; return d; });
    setList((prev) => prev.map((e) => (e.id === id ? { ...e, favorite: !e.favorite } : e)));
  };
  const remove = (idx) => setList((prev) => prev.filter((_, i) => i !== idx));
  const replace = (idx) => {
    const used = new Set(list.map((e) => e.id));
    const pool = data.exercises.filter((e) => e.warmup && !used.has(e.id) && (participants >= 5 || !e.objectives?.includes("Cercle")));
    // Priorité aux exercices classés dans la famille d'objectifs cochée ; si aucune famille n'est
    // cochée ou que les possibilités sont épuisées, on continue avec le reste.
    const matched = tags.length > 0 ? pool.filter((e) => tags.includes(e.groupe)) : [];
    const pick = pickRandom(matched.length > 0 ? matched : pool);
    // On garde le temps réservé pour ce créneau (resserré pour tenir dans la durée de l'échauffement),
    // plutôt que la durée brute de la fiche tirée, pour ne pas faire dériver le total affiché.
    if (pick) setList((prev) => prev.map((e, i) => {
      if (i !== idx) return e;
      const oldBudget = e?.actualDuration ?? e?.duration ?? 5;
      return { ...pick, actualDuration: oldBudget };
    }));
  };
  const saveScroll = usePreserveScroll();
  const pickManually = (ex) => {
    if (!picker) return;
    saveScroll();
    if (picker.mode === "add") {
      setList((prev) => [...prev, ex]);
    } else {
      setList((prev) => prev.map((e, i) => {
        if (i !== picker.idx) return e;
        const oldBudget = e?.actualDuration ?? e?.duration ?? 5;
        return { ...ex, actualDuration: oldBudget };
      }));
    }
    setPicker(null);
  };

  return (
    <div>
      <Toast toast={toastMsg} />
      <SectionHeader icon={Flame} title="Créer un échauffement" subtitle="Une préparation rapide, immédiatement utilisable." />
      <p className="text-sm mb-3" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
        Il est possible que tu n'aies pas le temps de faire tous les échauffements proposés, n'hésite pas à en supprimer ou en ajouter lors de ton échauffement. Improvise et adapte !
      </p>
      <IndexCard style={{ borderColor: COLORS.accent, background: COLORS.accent + "15", marginBottom: 12 }} className="flex items-center gap-2">
        <AlertTriangle size={18} color={COLORS.accent} />
        <span style={{ fontFamily: FONT_BODY, color: COLORS.accent }} className="text-xs font-medium">
          Page en travaux — tu peux quand même l'utiliser et la tester librement.
        </span>
      </IndexCard>
      <IndexCard>
        <Field label="Temps disponible">
          <div className="flex gap-2">
            {DUREES_ECHAUFFEMENT.map((t) => (
              <button key={t} onClick={() => setTemps(t)} className="px-2 py-1 rounded text-xs" style={{ fontFamily: FONT_MONO, background: temps === t ? COLORS.accent : "transparent", color: temps === t ? "#fff" : COLORS.ink, border: `1px solid ${COLORS.accent}` }}>
                {t} min
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Participants">
            <select className={inputClass} style={inputStyle} value={participants} onChange={(e) => setParticipants(Number(e.target.value))}>
              {STUDENTS_COUNTS.slice(0, 20).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="Niveau">
            <select className={inputClass} style={inputStyle} value={niveau} onChange={(e) => setNiveau(e.target.value)}>
              <option value="">Tous niveaux</option>
              {NIVEAUX.map((n) => <option key={n}>{n}</option>)}
            </select>
          </Field>
        </div>
        <OuiNonField label="Les joueurs se connaissent ?" value={joueursSeConnaissent} onChange={setJoueursSeConnaissent} />
        <Field label="Contexte">
          <div className="flex flex-wrap gap-2">
            {CONTEXTES_ECHAUFFEMENT.map((c) => (
              <button key={c} onClick={() => setContexte(c)} className="px-2 py-1 rounded-full text-xs" style={{ fontFamily: FONT_BODY, background: contexte === c ? COLORS.brass : "transparent", color: contexte === c ? COLORS.ink : COLORS.textSoft, border: `1px solid ${COLORS.cardEdge}` }}>
                {c}
              </button>
            ))}
          </div>
        </Field>
        {contexte === "Spectacle personnalisé" && (
          <Field label="Quel spectacle ?">
            <select className={inputClass} style={inputStyle} value={spectaclePersonnaliseId} onChange={(e) => setSpectaclePersonnaliseId(e.target.value)}>
              <option value="">Choisir un spectacle enregistré…</option>
              {data.spectaclePlans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Famille d'objectifs (optionnel)">
          <SearchableMultiSelect allOptions={FAMILLES_ECHAUFFEMENT} selected={tags} onChange={setTags} placeholder="Chercher une famille d'objectifs…" />
        </Field>
        <Btn variant="accent" onClick={generate}><Sparkles size={14} /> Créer</Btn>
      </IndexCard>

      {list && (list.length === 0 ? (
        <Empty text="Aucun exercice d'échauffement ne correspond — élargis les filtres ou ajoutes-en dans la bibliothèque." />
      ) : (
        <>
          {list.map((e, idx) => {
            const isExpanded = expandedId === e.id;
            return (
              <React.Fragment key={e.id}>
              <IndexCard>
                <div className="flex justify-between items-start">
                  <div className="flex-1" onClick={() => handleCardTap(e.id)} style={{ cursor: "pointer" }}>
                    <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">{e.title}</h3>
                    {/* Hauteur toujours réservée (même sans badge) pour éviter que la carte suivante ne
                        se décale et que le clic sur "Aléatoire" d'une carte voisine n'atterrisse par
                        erreur sur un autre bouton après le remplacement. */}
                    <div className="mt-1 mb-1" style={{ minHeight: 22 }}>
                      {e.groupe && (
                        <span
                          className="inline-block text-xs px-2 py-0.5 rounded-full"
                          style={{ fontFamily: FONT_MONO, background: COLORS.accent, color: "#fff" }}
                        >
                          {e.groupe}
                        </span>
                      )}
                    </div>
                    <p
                      style={{
                        fontFamily: FONT_BODY, color: COLORS.textSoft,
                        ...(isExpanded ? {} : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: "2.6em" }),
                      }}
                      className="text-sm"
                    >
                      {e.summary}
                    </p>
                    {isExpanded && (
                      <div className="mt-1 text-xs" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
                        <div>{e.level || "Niveau non précisé"}</div>
                        {e.objectives?.length > 0 && <div>Objectifs : {e.objectives.join(", ")}</div>}
                        {e.energy && <div>Énergie : {e.energy}</div>}
                        {e.material && e.material !== "Aucun" && <div>Matériel : {e.material}</div>}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 items-end">
                    <Btn small variant="ghost" onClick={() => replace(idx)}>Aléatoire</Btn>
                    <Btn small variant="ghost" onClick={() => setPicker({ mode: "replace", idx })}>Changer</Btn>
                  </div>
                </div>
                <div className="flex justify-between items-center mt-2">
                  <div className="flex items-center gap-2">
                    <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs">
                      {e.actualDuration ?? e.duration} min · Nombre de joueurs : {e.players > 0 ? e.players : "Illimité"}
                    </span>
                    <button onClick={() => toggleFavorite(e.id)} title="Favori">
                      <Star size={22} color={e.favorite ? COLORS.brass : COLORS.textSoft} fill={e.favorite ? COLORS.brass : "none"} />
                    </button>
                  </div>
                  <button onClick={() => remove(idx)} title="Supprimer"><Trash2 size={22} color={COLORS.accent} /></button>
                </div>
              </IndexCard>
              {picker?.mode === "replace" && picker.idx === idx && (
                <ExercisePicker
                  exercises={data.exercises.filter((e) => e.warmup)}
                  excludeIds={list.map((e) => e.id)}
                  onSelect={pickManually}
                  onCancel={() => setPicker(null)}
                />
              )}
              </React.Fragment>
            );
          })}
          {picker?.mode === "add" && (
            <ExercisePicker
              exercises={data.exercises.filter((e) => e.warmup)}
              excludeIds={list.map((e) => e.id)}
              onSelect={pickManually}
              onCancel={() => setPicker(null)}
            />
          )}
          <Btn variant="accent" onClick={() => setPicker({ mode: "add" })}><Plus size={14} /> Ajouter un exercice</Btn>
          <div className="text-right text-sm mt-2" style={{ fontFamily: FONT_MONO, color: COLORS.ink }}>Durée totale : {total} min</div>
        </>
      ))}
    </div>
  );
}

/* ---------- Catégorie aléatoire ---------- */
function EntrainementTab({ data }) {
  const [niveauFilter, setNiveauFilter] = useState("");
  const [picked, setPicked] = useState(null);

  // Même règle d'adjacence que Créer un cours/spectacle : le niveau coché autorise ce niveau et le
  // niveau adjacent (Débutant coché → Confirmé accepté, pas Avancé), les fiches sans niveau précisé
  // restent toujours autorisées.
  const NIVEAU_ORDER = ["Débutant", "Confirmé", "Avancé"];
  const niveauIdx = niveauFilter ? NIVEAU_ORDER.indexOf(niveauFilter) : -1;
  const pool = useMemo(() => data.categories.filter((c) => {
    if (!niveauFilter || !c.level) return true;
    const idx = NIVEAU_ORDER.indexOf(c.level);
    return idx === -1 || Math.abs(idx - niveauIdx) <= 1;
  }), [data.categories, niveauFilter, niveauIdx]);

  const draw = () => {
    if (pool.length === 0) { setPicked(null); return; }
    setPicked(pool[Math.floor(Math.random() * pool.length)]);
  };

  return (
    <div>
      <SectionHeader icon={Shuffle} title="Catégorie aléatoire" subtitle="Tire une catégorie au hasard pour t'entraîner." />
      <Field label="Niveau (optionnel)">
        <select className={inputClass} style={inputStyle} value={niveauFilter} onChange={(e) => setNiveauFilter(e.target.value)}>
          <option value="">Tous niveaux</option>
          {NIVEAUX.map((n) => <option key={n}>{n}</option>)}
        </select>
      </Field>
      <Btn variant="accent" onClick={draw}><Shuffle size={14} /> Tirer une catégorie</Btn>
      {picked && (
        <IndexCard className="mt-4">
          <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="text-xl font-semibold">{picked.name}</h3>
          <div className="flex flex-wrap gap-1 text-xs mt-1 mb-1" style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }}>
            <span>{picked.durationLabel || `${picked.duration || 5} min`}</span>
            {picked.playersMin && <span>· {playersLabel(picked)}</span>}
            {picked.energy && <span>· énergie {picked.energy}</span>}
          </div>
          <p style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-sm my-1">{picked.summary}</p>
          {picked.archetypes.length > 0 && (
            <p className="text-xs" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
              <b style={{ fontFamily: FONT_MONO }}>Archétypes : </b>{picked.archetypes.map((a) => a.name).join(" · ")}
            </p>
          )}
        </IndexCard>
      )}
      {picked === null && pool.length === 0 && <p className="text-sm italic mt-3" style={{ color: COLORS.textSoft }}>Aucune catégorie ne correspond à ce filtre.</p>}
    </div>
  );
}


/* ---------- Modération : exercices et catégories proposés par la communauté ---------- */
function ModerationTab({ data, update, setTab, isAdmin }) {
  const [rejectingExId, setRejectingExId] = useState(null);
  const [rejectingCatId, setRejectingCatId] = useState(null);
  const [rejectingConceptId, setRejectingConceptId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  if (!isAdmin) {
    return (
      <div>
        {setTab && <LibraryBackBtn label="Mon profil" onClick={() => setTab("profil")} />}
        <Empty text="Réservé à l'Admin." />
      </div>
    );
  }

  const pendingExercises = data.exercises.filter((e) => e.pending);
  const pendingCategories = data.categories.filter((c) => c.pending);
  const pendingConcepts = data.showConcepts.filter((sc) => sc.pending);

  const approveExercise = (id) => update((d) => {
    const e = d.exercises.find((x) => x.id === id);
    if (e) { e.pending = false; notifyCreatorApproved(d, e, "exercice"); }
    return d;
  });
  const rejectExercise = (id, reason) => update((d) => {
    const e = d.exercises.find((x) => x.id === id);
    if (e) { e.pending = false; e.rejected = true; notifyCreatorRejected(d, e, "exercice", reason); }
    return d;
  });
  const approveCategory = (id) => update((d) => {
    const c = d.categories.find((x) => x.id === id);
    if (c) { c.pending = false; notifyCreatorApproved(d, c, "catégorie"); }
    return d;
  });
  const rejectCategory = (id, reason) => update((d) => {
    const c = d.categories.find((x) => x.id === id);
    if (c) { c.pending = false; c.rejected = true; notifyCreatorRejected(d, c, "catégorie", reason); }
    return d;
  });
  const approveShowConcept = (id) => update((d) => {
    const sc = d.showConcepts.find((x) => x.id === id);
    if (sc) { sc.pending = false; notifyCreatorApproved(d, sc, "concept de spectacle"); }
    return d;
  });
  const rejectShowConcept = (id, reason) => update((d) => {
    const sc = d.showConcepts.find((x) => x.id === id);
    if (sc) { sc.pending = false; sc.rejected = true; notifyCreatorRejected(d, sc, "concept de spectacle", reason); }
    return d;
  });

  return (
    <div>
      {setTab && <LibraryBackBtn label="Mon profil" onClick={() => setTab("profil")} />}
      <SectionHeader
        icon={AlertTriangle}
        title="À valider"
        subtitle="Exercices, catégories et concepts de spectacle proposés par la communauté, en attente de validation."
      />

      {pendingExercises.length === 0 && pendingCategories.length === 0 && pendingConcepts.length === 0 && (
        <Empty text="Rien à valider pour le moment — toutes les propositions de la communauté ont été traitées." />
      )}

      {pendingExercises.length > 0 && (
        <>
          <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase">Exercices ({pendingExercises.length})</span>
          {pendingExercises.map((ex) => (
            <IndexCard key={ex.id}>
              <div className="flex justify-between items-start">
                <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="text-lg font-medium">{ex.title}</h3>
                <div className="flex gap-1">
                  <Btn small variant="ghost" onClick={() => approveExercise(ex.id)}><Check size={13} /> Valider</Btn>
                  <Btn small variant="ghost" onClick={() => { setRejectingExId(ex.id); setRejectReason(""); }}><X size={13} /> Refuser</Btn>
                </div>
              </div>
              {rejectingExId === ex.id && (
                <RejectReasonBox
                  reason={rejectReason}
                  setReason={setRejectReason}
                  onConfirm={() => { rejectExercise(ex.id, rejectReason.trim()); setRejectingExId(null); setRejectReason(""); }}
                  onCancel={() => { setRejectingExId(null); setRejectReason(""); }}
                />
              )}
              <p style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-sm my-1">{ex.summary}</p>
              <div className="flex flex-wrap gap-1 mt-1 text-xs" style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }}>
                <span>{ex.level}</span>·<span>{ex.players > 0 ? `${ex.players} élève${ex.players > 1 ? "s" : ""}` : "Illimité"}</span>·<span>{ex.duration} min</span>
                {ex.phase && <span>· {ex.phase}</span>}
                {ex.creatorTroupe && <span>· {ex.creatorUsername} — Troupe {ex.creatorTroupe}</span>}
              </div>
            </IndexCard>
          ))}
        </>
      )}

      {pendingCategories.length > 0 && (
        <>
          <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase mt-3 block">Catégories ({pendingCategories.length})</span>
          {pendingCategories.map((c) => (
            <IndexCard key={c.id}>
              <div className="flex justify-between items-start">
                <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="text-lg font-medium">{c.name}</h3>
                <div className="flex gap-1">
                  <Btn small variant="ghost" onClick={() => approveCategory(c.id)}><Check size={13} /> Valider</Btn>
                  <Btn small variant="ghost" onClick={() => { setRejectingCatId(c.id); setRejectReason(""); }}><X size={13} /> Refuser</Btn>
                </div>
              </div>
              {rejectingCatId === c.id && (
                <RejectReasonBox
                  reason={rejectReason}
                  setReason={setRejectReason}
                  onConfirm={() => { rejectCategory(c.id, rejectReason.trim()); setRejectingCatId(null); setRejectReason(""); }}
                  onCancel={() => { setRejectingCatId(null); setRejectReason(""); }}
                />
              )}
              <p style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-sm my-1">{c.summary}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs" style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }}>
                <span>{c.durationLabel || `${c.duration || 5} min`}</span>
                {c.level && <span>· {c.level}</span>}
                {c.playersMin && <span>· {playersLabel(c)}</span>}
                {c.material && c.material !== "Aucun" && <span>· {c.material}</span>}
                {c.creatorTroupe && <span>· {c.creatorUsername} — Troupe {c.creatorTroupe}</span>}
              </div>
            </IndexCard>
          ))}
        </>
      )}

      {pendingConcepts.length > 0 && (
        <>
          <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase mt-3 block">Concepts de spectacle ({pendingConcepts.length})</span>
          {pendingConcepts.map((sc) => {
            const cats = data.categories.filter((c) => sc.categoryIds.includes(c.id));
            return (
              <IndexCard key={sc.id}>
                <div className="flex justify-between items-start">
                  <div>
                    <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">{sc.theme}</h3>
                    {sc.type && <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs">{sc.type}</span>}
                  </div>
                  <div className="flex gap-1">
                    <Btn small variant="ghost" onClick={() => approveShowConcept(sc.id)}><Check size={13} /> Valider</Btn>
                    <Btn small variant="ghost" onClick={() => { setRejectingConceptId(sc.id); setRejectReason(""); }}><X size={13} /> Refuser</Btn>
                  </div>
                </div>
                {rejectingConceptId === sc.id && (
                  <RejectReasonBox
                    reason={rejectReason}
                    setReason={setRejectReason}
                    onConfirm={() => { rejectShowConcept(sc.id, rejectReason.trim()); setRejectingConceptId(null); setRejectReason(""); }}
                    onCancel={() => { setRejectingConceptId(null); setRejectReason(""); }}
                  />
                )}
                {sc.description && (
                  <p className="text-sm mt-1" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>{sc.description}</p>
                )}
                <div className="mt-2 text-sm" style={{ fontFamily: FONT_BODY, color: COLORS.text }}>
                  <b>Catégories :</b> {cats.length ? cats.map((c) => c.name).join(", ") : "—"}
                </div>
                {sc.creatorUsername && <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs">{sc.creatorUsername}</span>}
              </IndexCard>
            );
          })}
        </>
      )}
    </div>
  );
}

/* ---------- Messages reçus (contact utilisateurs -> Admin) ---------- */
function MessagesTab({ data, update, setTab, isAdmin }) {
  // Exclut les notifications automatiques (validation/refus) envoyées PAR l'Admin aux créateurs —
  // cette boîte ne montre que les messages reçus DES troupes utilisatrices.
  const messages = [...(data.messages || [])].filter((m) => m.type !== "notif").sort((a, b) => b.createdAt - a.createdAt);

  // Marque tous les messages comme lus à l'ouverture de la page.
  useEffect(() => {
    if (!isAdmin) return;
    const hasUnread = (data.messages || []).some((m) => m.type !== "notif" && !m.read);
    if (hasUnread) {
      update((d) => { (d.messages || []).forEach((m) => { if (m.type !== "notif") m.read = true; }); return d; });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isAdmin) {
    return (
      <div>
        {setTab && <LibraryBackBtn label="Mon profil" onClick={() => setTab("profil")} />}
        <Empty text="Réservé à l'Admin." />
      </div>
    );
  }

  const deleteMessage = (id) => update((d) => { d.messages = (d.messages || []).filter((m) => m.id !== id); return d; });
  const sendReply = (id, text) => update((d) => {
    const m = (d.messages || []).find((mm) => mm.id === id);
    if (m) { m.reply = text; m.repliedAt = Date.now(); m.replySeen = false; }
    return d;
  });

  const formatDate = (ts) => new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      {setTab && <LibraryBackBtn label="Mon profil" onClick={() => setTab("profil")} />}
      <SectionHeader
        icon={Mail}
        title="Messages reçus"
        subtitle="Suggestions et retours envoyés par les troupes utilisatrices."
      />

      {messages.length === 0 && <Empty text="Aucun message pour le moment." />}

      {messages.map((m) => (
        <MessageCard key={m.id} message={m} onDelete={() => deleteMessage(m.id)} onReply={(text) => sendReply(m.id, text)} formatDate={formatDate} />
      ))}
    </div>
  );
}

/* ---------- Comptes (vue Admin en lecture seule : pseudo, troupe, exercices créés — pas d'email,
   pas d'accès au compte lui-même) ---------- */
function ComptesTab({ data, update, isAdmin, setTab }) {
  const [profiles, setProfiles] = useState(null); // null = chargement en cours
  const [error, setError] = useState("");
  const [messageOpenFor, setMessageOpenFor] = useState(null); // username en cours de composition
  const [messageText, setMessageText] = useState("");
  const [messageSentFor, setMessageSentFor] = useState(null);

  const sendMessage = (p) => {
    const text = messageText.trim();
    if (!text) return;
    update((d) => {
      d.messages = d.messages || [];
      d.messages.push({
        id: uid(),
        type: "notif",
        to: p.username,
        troupe: p.troupe || "",
        text,
        createdAt: Date.now(),
        seen: false,
      });
      return d;
    });
    setMessageText("");
    setMessageOpenFor(null);
    setMessageSentFor(p.username);
  };

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    supabase
      .from("profiles")
      .select("username, troupe")
      .order("username")
      .then(({ data: rows, error: err }) => {
        if (cancelled) return;
        if (err) { setError("Impossible de charger les comptes."); return; }
        setProfiles(rows || []);
      });
    return () => { cancelled = true; };
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div>
        {setTab && <LibraryBackBtn label="Mon profil" onClick={() => setTab("profil")} />}
        <Empty text="Réservé à l'Admin." />
      </div>
    );
  }

  return (
    <div>
      {setTab && <LibraryBackBtn label="Mon profil" onClick={() => setTab("profil")} />}
      <SectionHeader
        icon={Contact}
        title="Comptes"
        subtitle="Pseudo, troupe et nombre d'exercices créés par chaque compte inscrit."
      />

      {error && <Empty text={error} />}
      {!error && profiles === null && <Empty text="Chargement…" />}
      {!error && profiles !== null && profiles.length === 0 && <Empty text="Aucun compte pour le moment." />}

      {profiles && profiles.map((p) => {
        const nbExercices = data.exercises.filter((e) => e.creatorUsername === p.username).length;
        const composing = messageOpenFor === p.username;
        return (
          <IndexCard key={p.username}>
            <div className="flex items-center justify-between">
              <div>
                <div style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">{p.username}</div>
                <div style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase">
                  {p.troupe ? `Troupe ${p.troupe}` : "Sans troupe renseignée"}
                </div>
              </div>
              <span
                className="text-sm px-2 py-0.5 rounded-full"
                style={{ fontFamily: FONT_MONO, background: COLORS.cardEdge + "55", color: COLORS.textSoft }}
              >
                {nbExercices} exercice{nbExercices > 1 ? "s" : ""}
              </span>
            </div>

            {!composing ? (
              <div className="mt-2">
                <Btn
                  small
                  variant="ghost"
                  onClick={() => { setMessageOpenFor(p.username); setMessageText(""); setMessageSentFor(null); }}
                >
                  <Mail size={13} /> Envoyer un message
                </Btn>
                {messageSentFor === p.username && (
                  <span className="text-xs ml-2" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>Message envoyé.</span>
                )}
              </div>
            ) : (
              <div className="mt-2">
                <textarea
                  className={inputClass}
                  style={inputStyle}
                  rows={3}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder={`Message à ${p.username}…`}
                  autoFocus
                />
                <div className="flex gap-2 mt-2">
                  <Btn small variant="accent" onClick={() => sendMessage(p)}><Check size={13} /> Envoyer</Btn>
                  <Btn small variant="ghost" onClick={() => setMessageOpenFor(null)}><X size={13} /> Annuler</Btn>
                </div>
              </div>
            )}
          </IndexCard>
        );
      })}
    </div>
  );
}

/* ---------- Validés (vue Admin : tous les exercices/catégories/concepts de spectacle actuellement
   publics dans la bibliothèque, avec recherche) ---------- */
function ValidesTab({ data, isAdmin, setTab }) {
  const [query, setQuery] = useState("");

  if (!isAdmin) {
    return (
      <div>
        {setTab && <LibraryBackBtn label="Mon profil" onClick={() => setTab("profil")} />}
        <Empty text="Réservé à l'Admin." />
      </div>
    );
  }

  // Ne garde que les fiches proposées par une troupe utilisatrice — les fiches créées par
  // l'Admin lui-même (creatorUsername vide) n'ont pas à figurer dans cette liste de suivi.
  const validExercises = data.exercises.filter((e) => !e.pending && !e.rejected && e.creatorUsername);
  const validCategories = data.categories.filter((c) => !c.pending && !c.rejected && c.creatorUsername);
  const validConcepts = data.showConcepts.filter((sc) => !sc.pending && !sc.rejected);

  const q = query.trim();
  const shownExercises = q ? validExercises.filter((e) => matchesKeywords(q, e.title)) : validExercises;
  const shownCategories = q ? validCategories.filter((c) => matchesKeywords(q, c.name)) : validCategories;
  const shownConcepts = q ? validConcepts.filter((sc) => matchesKeywords(q, sc.theme)) : validConcepts;

  const creatorLabel = (item) => `${item.creatorUsername} — ${item.creatorTroupe ? `Troupe ${item.creatorTroupe}` : "Sans troupe renseignée"}`;

  const Row = ({ label, sub, creator }) => (
    <div className="text-sm py-1.5 border-b" style={{ borderColor: COLORS.cardEdge, fontFamily: FONT_BODY, color: COLORS.text }}>
      <div className="flex justify-between items-center">
        <span>{label}</span>
        {sub && <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs">{sub}</span>}
      </div>
      {creator && <div style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs mt-0.5">{creator}</div>}
    </div>
  );

  return (
    <div>
      {setTab && <LibraryBackBtn label="Mon profil" onClick={() => setTab("profil")} />}
      <SectionHeader
        icon={Check}
        title="Validés"
        subtitle="Exercices, catégories et concepts de spectacle proposés par les troupes et validés par la modération."
      />
      <Field label="Chercher parmi les fiches validées">
        <input className={inputClass} style={inputStyle} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nom de la fiche…" />
      </Field>

      <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase block mt-4 mb-1">
        Exercices ({shownExercises.length}{q ? ` / ${validExercises.length}` : ""})
      </span>
      <IndexCard>
        {shownExercises.length === 0 && <Empty text="Aucun exercice ne correspond." />}
        {shownExercises.map((e) => <Row key={e.id} label={e.title} sub={`${e.duration} min`} creator={creatorLabel(e)} />)}
      </IndexCard>

      <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase block mt-4 mb-1">
        Catégories ({shownCategories.length}{q ? ` / ${validCategories.length}` : ""})
      </span>
      <IndexCard>
        {shownCategories.length === 0 && <Empty text="Aucune catégorie ne correspond." />}
        {shownCategories.map((c) => <Row key={c.id} label={c.name} sub={`${c.durationLabel || `${c.duration || 5} min`}`} creator={creatorLabel(c)} />)}
      </IndexCard>

      <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase block mt-4 mb-1">
        Concepts de spectacle ({shownConcepts.length}{q ? ` / ${validConcepts.length}` : ""})
      </span>
      <IndexCard>
        {shownConcepts.length === 0 && <Empty text="Aucun concept de spectacle ne correspond." />}
        {shownConcepts.map((sc) => <Row key={sc.id} label={sc.theme} sub={sc.type} creator={sc.creatorUsername ? creatorLabel(sc) : null} />)}
      </IndexCard>
    </div>
  );
}

/* Carte d'un message reçu par l'Admin, avec réponse éditable (envoyée/modifiée à la volée). */
function MessageCard({ message: m, onDelete, onReply, formatDate }) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState(m.reply || "");

  const submit = () => {
    const text = replyText.trim();
    if (!text) return;
    onReply(text);
    setReplyOpen(false);
  };

  return (
    <IndexCard>
      <div className="flex justify-between items-start">
        <div>
          <span style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">{m.from}</span>
          {m.troupe && <span style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-xs"> — Troupe {m.troupe}</span>}
        </div>
        <button onClick={onDelete} title="Supprimer">
          <Trash2 size={14} color={COLORS.accent} />
        </button>
      </div>
      <p style={{ fontFamily: FONT_BODY, color: COLORS.text }} className="text-sm my-1 whitespace-pre-wrap">{m.text}</p>
      <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs">{formatDate(m.createdAt)}</span>

      {m.reply && !replyOpen && (
        <div className="mt-2 pl-3" style={{ borderLeft: `2px solid ${COLORS.brass}` }}>
          <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase">Ta réponse</span>
          <p style={{ fontFamily: FONT_BODY, color: COLORS.text }} className="text-sm whitespace-pre-wrap">{m.reply}</p>
        </div>
      )}

      {!replyOpen ? (
        <div className="mt-2">
          <Btn small variant="ghost" onClick={() => { setReplyText(m.reply || ""); setReplyOpen(true); }}>
            <Mail size={13} /> {m.reply ? "Modifier la réponse" : "Répondre"}
          </Btn>
        </div>
      ) : (
        <div className="mt-2">
          <textarea
            className={inputClass}
            style={inputStyle}
            rows={3}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Ta réponse…"
          />
          <div className="flex gap-2 mt-2">
            <Btn small variant="accent" onClick={submit}><Check size={13} /> Envoyer</Btn>
            <Btn small variant="ghost" onClick={() => { setReplyOpen(false); setReplyText(m.reply || ""); }}><X size={13} /> Annuler</Btn>
          </div>
        </div>
      )}
    </IndexCard>
  );
}

/* ---------- Mes messages (utilisateur -> réponses de l'Admin) ---------- */
function MesMessagesTab({ data, update, setTab, currentUser }) {
  // Deux sortes de fiches ici : les messages que l'utilisateur a lui-même envoyés à l'Admin (avec
  // sa réponse éventuelle), et les notifications automatiques que l'Admin lui envoie (validation ou
  // refus d'un exercice/catégorie proposé) — voir notifyCreatorApproved/notifyCreatorRejected.
  const messages = [...(data.messages || [])]
    .filter((m) => m.from === currentUser || (m.type === "notif" && m.to === currentUser))
    .sort((a, b) => b.createdAt - a.createdAt);

  // Marque les réponses et notifications comme vues à l'ouverture de la page.
  useEffect(() => {
    const hasUnseen = messages.some((m) => (m.reply && m.replySeen === false) || (m.type === "notif" && m.seen === false));
    if (hasUnseen) {
      update((d) => {
        (d.messages || []).forEach((m) => {
          if (m.from === currentUser && m.reply) m.replySeen = true;
          if (m.type === "notif" && m.to === currentUser) m.seen = true;
        });
        return d;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatDate = (ts) => new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const deleteMessage = (id) => update((d) => { d.messages = (d.messages || []).filter((m) => m.id !== id); return d; });

  return (
    <div>
      {setTab && <LibraryBackBtn label="Mon profil" onClick={() => setTab("profil")} />}
      <SectionHeader
        icon={Mail}
        title="Messages reçus"
        subtitle="Tes messages envoyés à l'Admin, ses réponses, et les notifications de validation."
      />

      {messages.length === 0 && <Empty text="Tu n'as reçu ni envoyé aucun message pour le moment." />}

      {messages.map((m) =>
        m.type === "notif" ? (
          <IndexCard key={m.id}>
            <div className="flex justify-between items-start">
              <span style={{ fontFamily: FONT_MONO, color: COLORS.accent }} className="text-xs uppercase">Message de l'Admin</span>
              <button onClick={() => deleteMessage(m.id)} title="Supprimer">
                <Trash2 size={14} color={COLORS.accent} />
              </button>
            </div>
            <p style={{ fontFamily: FONT_BODY, color: COLORS.text }} className="text-sm my-1 whitespace-pre-wrap">{m.text}</p>
            <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs">{formatDate(m.createdAt)}</span>
          </IndexCard>
        ) : (
          <IndexCard key={m.id}>
            <div className="flex justify-between items-start">
              <p style={{ fontFamily: FONT_BODY, color: COLORS.text }} className="text-sm whitespace-pre-wrap flex-1">{m.text}</p>
              <button onClick={() => deleteMessage(m.id)} title="Supprimer">
                <Trash2 size={14} color={COLORS.accent} />
              </button>
            </div>
            <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs">{formatDate(m.createdAt)}</span>
            {m.reply ? (
              <div className="mt-2 pl-3" style={{ borderLeft: `2px solid ${COLORS.brass}` }}>
                <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase">Réponse de l'Admin</span>
                <p style={{ fontFamily: FONT_BODY, color: COLORS.text }} className="text-sm whitespace-pre-wrap">{m.reply}</p>
              </div>
            ) : (
              <p className="text-xs mt-2" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>En attente de réponse…</p>
            )}
          </IndexCard>
        )
      )}
    </div>
  );
}

/* ---------- Messages envoyés (Admin : réponses données + messages directs ; utilisateur : messages
   envoyés à l'Admin) ---------- */
function MessagesEnvoyesTab({ data, update, setTab, currentUser, isAdmin }) {
  const formatDate = (ts) => new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  if (isAdmin) {
    // Supprimer une "réponse" n'efface que la réponse (le message original reste dans la boîte de
    // réception, à nouveau "en attente de réponse") ; supprimer un message "direct" (notif) le
    // retire complètement.
    const deleteReply = (originalId) => update((d) => {
      const msg = (d.messages || []).find((mm) => mm.id === originalId);
      if (msg) { delete msg.reply; delete msg.repliedAt; delete msg.replySeen; }
      return d;
    });
    const deleteDirect = (id) => update((d) => { d.messages = (d.messages || []).filter((mm) => mm.id !== id); return d; });

    const replied = (data.messages || [])
      .filter((m) => m.reply)
      .map((m) => ({ id: m.id + "-reply", originalId: m.id, kind: "reply", to: m.from, troupe: m.troupe, text: m.reply, createdAt: m.repliedAt, context: m.text }));
    const direct = (data.messages || [])
      .filter((m) => m.type === "notif")
      .map((m) => ({ id: m.id, kind: "direct", to: m.to, troupe: m.troupe, text: m.text, createdAt: m.createdAt }));
    const sent = [...replied, ...direct].sort((a, b) => b.createdAt - a.createdAt);

    return (
      <div>
        {setTab && <LibraryBackBtn label="Mon profil" onClick={() => setTab("profil")} />}
        <SectionHeader
          icon={Mail}
          title="Messages envoyés"
          subtitle="Réponses données et messages envoyés directement aux comptes."
        />
        {sent.length === 0 && <Empty text="Aucun message envoyé pour le moment." />}
        {sent.map((m) => (
          <IndexCard key={m.id}>
            <div className="flex justify-between items-start">
              <div>
                <span style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="font-medium">À {m.to}</span>
                {m.troupe && <span style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }} className="text-xs"> — Troupe {m.troupe}</span>}
              </div>
              <button onClick={() => (m.kind === "reply" ? deleteReply(m.originalId) : deleteDirect(m.id))} title="Supprimer">
                <Trash2 size={14} color={COLORS.accent} />
              </button>
            </div>
            {m.context && (
              <p className="text-xs mt-1 pl-3" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft, borderLeft: `2px solid ${COLORS.cardEdge}` }}>
                En réponse à : « {m.context} »
              </p>
            )}
            <p style={{ fontFamily: FONT_BODY, color: COLORS.text }} className="text-sm my-1 whitespace-pre-wrap">{m.text}</p>
            <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs">{formatDate(m.createdAt)}</span>
          </IndexCard>
        ))}
      </div>
    );
  }

  const deleteMessage = (id) => update((d) => { d.messages = (d.messages || []).filter((mm) => mm.id !== id); return d; });
  const sent = [...(data.messages || [])].filter((m) => m.from === currentUser).sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div>
      {setTab && <LibraryBackBtn label="Mon profil" onClick={() => setTab("profil")} />}
      <SectionHeader icon={Mail} title="Messages envoyés" subtitle="Tes messages envoyés à l'Admin." />
      {sent.length === 0 && <Empty text="Tu n'as envoyé aucun message pour le moment." />}
      {sent.map((m) => (
        <IndexCard key={m.id}>
          <div className="flex justify-between items-start">
            <p style={{ fontFamily: FONT_BODY, color: COLORS.text }} className="text-sm whitespace-pre-wrap flex-1">{m.text}</p>
            <button onClick={() => deleteMessage(m.id)} title="Supprimer">
              <Trash2 size={14} color={COLORS.accent} />
            </button>
          </div>
          <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs">{formatDate(m.createdAt)}</span>
          {m.reply ? (
            <div className="mt-2 pl-3" style={{ borderLeft: `2px solid ${COLORS.brass}` }}>
              <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs uppercase">Réponse de l'Admin</span>
              <p style={{ fontFamily: FONT_BODY, color: COLORS.text }} className="text-sm whitespace-pre-wrap">{m.reply}</p>
            </div>
          ) : (
            <p className="text-xs mt-2" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>En attente de réponse…</p>
          )}
        </IndexCard>
      ))}
    </div>
  );
}

/* ---------- Plans de cours ---------- */
/* Export PDF d'un plan de cours — fonction autonome (utilisée par PlansTab ET directement depuis
   la page "Créer un cours", pour permettre le téléchargement même sans être connecté). */
function exportCoursePlanPDF(plan, data) {
  const JsPDF = window.jspdf?.jsPDF;
  if (!JsPDF) {
    alert("Le générateur PDF est encore en train de se charger, réessaie dans quelques secondes.");
    return;
  }
  const catIds = plan.categoryIds || [];
  const doc = new JsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 15;
  const maxWidth = pageWidth - marginX * 2;
  let y = 18;
  const addLine = (text, { size = 11, bold = false, gap = 7 } = {}) => {
    doc.setFontSize(size);
    doc.setFont(undefined, bold ? "bold" : "normal");
    doc.splitTextToSize(text, maxWidth).forEach((line) => {
      if (y > 280) { doc.addPage(); y = 18; }
      doc.text(line, marginX, y);
      y += gap;
    });
  };

  // Durées réellement retenues au moment de la génération (peuvent différer légèrement de la durée
  // "nominale" de la fiche, resserrées pour tenir dans le temps demandé) — voir `durationsById`,
  // renseigné par l'écran du générateur (et conservé dans les plans enregistrés). À défaut (plans
  // enregistrés avant ce champ), on retombe sur la durée nominale de la fiche.
  const durationsById = plan.durationsById || {};
  const exDuration = (e) => Number(durationsById[e.id] ?? e.duration ?? 0);
  const catDuration = (c) => Number(durationsById[c.id] ?? c.duration ?? 5);

  addLine(`Plan de cours : ${plan.name}`, { size: 16, bold: true, gap: 10 });
  const exercisesFound = plan.exerciseIds.map((id) => data.exercises.find((e) => e.id === id)).filter(Boolean);
  const totalDuration =
    exercisesFound.reduce((s, e) => s + exDuration(e), 0) +
    catIds.reduce((s, id) => { const c = data.categories.find((x) => x.id === id); return c ? s + catDuration(c) : s; }, 0) +
    DEBRIEF_MIN;
  addLine(`Durée totale estimée : ${totalDuration} min (feedbacks inclus ${DEBRIEF_MIN} minutes)`, { size: 11, gap: 10 });

  // Regroupées par phase (échauffement / pré-impro / impro), dans cet ordre, comme sur l'écran du
  // générateur — plutôt qu'une simple liste à plat qui mélangeait tout.
  const PHASE_LABELS = { "Échauffement": "Échauffement", "Pré-impro": "Exercice pré-impro", "Impro": "Exercice d'impro" };
  const missingIds = plan.exerciseIds.filter((id) => !data.exercises.find((e) => e.id === id));
  SECTIONS_EXERCICE.forEach((phase) => {
    const list = exercisesFound.filter((e) => (e.phase || "Impro") === phase);
    if (list.length === 0) return;
    addLine(PHASE_LABELS[phase], { size: 13, bold: true, gap: 8 });
    list.forEach((e, i) => {
      addLine(`${i + 1}. ${e.title} — ${exDuration(e)} min — ${e.format || "Solo simultané"}`, { bold: true, gap: 6 });
      addLine(e.summary, { size: 10, gap: 9 });
    });
  });
  missingIds.forEach(() => addLine("(exercice supprimé)", { gap: 8 }));

  if (catIds.length > 0) {
    addLine("Catégories d'impro jouées :", { bold: true, gap: 8 });
    catIds.forEach((id, i) => {
      const c = data.categories.find((x) => x.id === id);
      if (!c) { addLine(`${i + 1}. (catégorie supprimée)`, { gap: 8 }); return; }
      addLine(`${i + 1}. ${c.name} — ${catDuration(c)} min`, { bold: true, gap: 6 });
      addLine(c.summary, { size: 10, gap: 9 });
    });
  }

  doc.save(`${plan.name || "plan-de-cours"}.pdf`);
}

/* Export PDF d'un déroulé de spectacle — fonction autonome (utilisée par PlansTab ET directement
   depuis la page "Créer un spectacle", pour permettre le téléchargement même sans être connecté). */
function exportSpectaclePlanPDF(plan, data) {
  const JsPDF = window.jspdf?.jsPDF;
  if (!JsPDF) {
    alert("Le générateur PDF est encore en train de se charger, réessaie dans quelques secondes.");
    return;
  }
  const catIds = plan.categoryIds || [];
  const doc = new JsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 15;
  const maxWidth = pageWidth - marginX * 2;
  let y = 18;
  const addLine = (text, { size = 11, bold = false, gap = 7 } = {}) => {
    doc.setFontSize(size);
    doc.setFont(undefined, bold ? "bold" : "normal");
    doc.splitTextToSize(text, maxWidth).forEach((line) => {
      if (y > 280) { doc.addPage(); y = 18; }
      doc.text(line, marginX, y);
      y += gap;
    });
  };

  const durationsById = plan.durationsById || {};
  const catDuration = (c) => Number(durationsById[c.id] ?? c.duration ?? 5);
  const matchModeById = plan.matchModeById || {};

  addLine(`Spectacle : ${plan.name}`, { size: 16, bold: true, gap: 10 });
  addLine(`Format : ${plan.format || "non précisé"} — Durée totale estimée : ${plan.duree} min`, { size: 11, gap: 10 });

  const entracte = plan.entracte;
  // Emplacement exact (nombre de catégories avant l'entracte), tel que défini par le générateur —
  // plus fiable que l'ancienne estimation par cumul de durée (`placementMin`), qui pouvait ne jamais
  // être atteinte exactement et reléguait l'entracte tout à la fin du PDF. `placementMin` reste géré
  // en repli pour les spectacles déjà enregistrés avant l'ajout de `firstCount`.
  let placementIdx = catIds.length;
  if (entracte && typeof entracte.firstCount === "number") {
    placementIdx = entracte.firstCount;
  } else if (entracte) {
    let cum = 0;
    for (let i = 0; i < catIds.length; i++) {
      const c = data.categories.find((x) => x.id === catIds[i]);
      cum += Number(c?.duration || 5);
      if (cum >= entracte.placementMin) { placementIdx = i + 1; break; }
    }
  }

  // Bloc entracte mis en valeur : espace avant/après + texte plus grand et centré, pour qu'il
  // ressorte visuellement au milieu du déroulé plutôt que de se confondre avec les catégories.
  const addEntracteBlock = (startMin) => {
    if (y > 270) { doc.addPage(); y = 18; }
    y += 6;
    doc.setFontSize(15);
    doc.setFont(undefined, "bold");
    const label = `— Entracte (${entracte.duree} min)${startMin != null ? ` — ${minutesToTime(startMin)}` : ""} —`;
    doc.text(label, pageWidth / 2, y, { align: "center" });
    y += 13;
  };

  // Heures estimées de chaque catégorie, si une heure de début a été précisée sur l'écran de
  // génération — voir computeSpectacleSchedule (même calcul que sur l'écran, pour que les heures
  // affichées ici correspondent exactement à celles vues avant l'export).
  const schedule = plan.startTime
    ? computeSpectacleSchedule(
        catIds.slice(0, placementIdx).map((id) => Number(durationsById[id] ?? 5)),
        catIds.slice(placementIdx).map((id) => Number(durationsById[id] ?? 5)),
        !!entracte,
        plan.startTime,
        plan.stageWarmup?.duration || 0
      )
    : null;

  // Le spectacle commence toujours par l'introduction ; l'échauffement de scène (s'il est activé)
  // passe juste après, jamais avant.
  addLine(`Introduction${schedule ? ` — ${minutesToTime(schedule.introStart)}` : ""}`, { bold: true, gap: 9 });

  if (plan.stageWarmup) {
    const timeLabel = schedule ? ` — ${minutesToTime(schedule.stageWarmupStart)}` : "";
    addLine(`Échauffement de scène : ${plan.stageWarmup.title}${timeLabel} — ${plan.stageWarmup.duration} min`, { bold: true, gap: 9 });
  }

  catIds.forEach((id, i) => {
    if (entracte && i === placementIdx) {
      addEntracteBlock(schedule ? schedule.entracteStart : null);
    }
    const timeLabel = schedule ? ` — ${minutesToTime(i < placementIdx ? schedule.firstTimes[i] : schedule.secondTimes[i - placementIdx])}` : "";
    const c = data.categories.find((x) => x.id === id);
    if (!c) { addLine(`${i + 1}. (catégorie supprimée)${timeLabel}`, { gap: 8 }); return; }
    const modeLabel = plan.format === "Match" ? ` (${matchModeById[id] || "Mixte"})` : "";
    addLine(`${i + 1}. ${c.name}${modeLabel}${timeLabel} — ${catDuration(c)} min`, { bold: true, gap: 6 });
    addLine(c.summary, { size: 10, gap: 9 });
    if (c.archetypes?.length > 0) {
      addLine(`Archétypes : ${c.archetypes.map((a) => a.name).join(", ")}`, { size: 9, gap: 9 });
    }
  });

  if (entracte && placementIdx >= catIds.length) {
    addEntracteBlock(schedule ? schedule.entracteStart : null);
  }

  addLine(`Salut final${schedule ? ` — ${minutesToTime(schedule.salutStart)}` : ""}`, { bold: true, gap: 9 });

  doc.save(`${plan.name || "spectacle"}.pdf`);
}

function PlansTab({ data, update, setTab }) {
  useEffect(() => {
    if (window.jspdf) return;
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    script.async = true;
    document.body.appendChild(script);
  }, []);

  const exportPlan = (plan) => exportCoursePlanPDF(plan, data);

  const exportSpectaclePlan = (plan) => exportSpectaclePlanPDF(plan, data);


  return (
    <div>
      {setTab && <LibraryBackBtn onClick={() => setTab("bibliotheque")} />}
      <SectionHeader icon={ClipboardList} title="Plans de cours" subtitle="Retrouve et exporte les plans générés." />
      {data.coursePlans.map((plan) => (
        <IndexCard key={plan.id}>
          <div className="flex justify-between items-start">
            <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="text-lg font-medium">{plan.name}</h3>
            <button onClick={() => exportPlan(plan)} title="Exporter en PDF" className="p-1 -m-1"><Download size={24} color={COLORS.ink} /></button>
          </div>
          <ol className="text-sm mt-1 list-decimal list-inside" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
            {plan.exerciseIds.map((id) => {
              const e = data.exercises.find((x) => x.id === id);
              return <li key={id}>{e ? `${e.title} (${e.duration} min)` : "(exercice supprimé)"}</li>;
            })}
            {(plan.categoryIds || []).map((id) => {
              const c = data.categories.find((x) => x.id === id);
              return <li key={id}>{c ? `${c.name} (${c.duration || 5} min) — catégorie d'impro` : "(catégorie supprimée)"}</li>;
            })}
          </ol>
          <div className="flex justify-end mt-2">
            <button onClick={() => update((d) => { d.coursePlans = d.coursePlans.filter((x) => x.id !== plan.id); return d; })} title="Supprimer" className="p-1 -m-1">
              <Trash2 size={22} color={COLORS.accent} />
            </button>
          </div>
        </IndexCard>
      ))}

      <SectionHeader icon={Theater} title="Spectacles enregistrés" subtitle="Les déroulés de spectacle que tu as sauvegardés." />
      {data.spectaclePlans.length === 0 && <Empty text="Aucun spectacle enregistré pour l'instant." />}
      {data.spectaclePlans.map((plan) => (
        <IndexCard key={plan.id}>
          <div className="flex justify-between items-start">
            <div>
              <h3 style={{ fontFamily: FONT_DISPLAY, color: COLORS.ink }} className="text-lg font-medium">{plan.name}</h3>
              <span style={{ fontFamily: FONT_MONO, color: COLORS.textSoft }} className="text-xs">{plan.format} · {plan.duree} min</span>
            </div>
            <button onClick={() => exportSpectaclePlan(plan)} title="Exporter en PDF" className="p-1 -m-1"><Download size={24} color={COLORS.ink} /></button>
          </div>
          <ol className="text-sm mt-1 list-decimal list-inside" style={{ fontFamily: FONT_BODY, color: COLORS.textSoft }}>
            {(plan.categoryIds || []).map((id) => {
              const c = data.categories.find((x) => x.id === id);
              return <li key={id}>{c ? `${c.name} (${c.duration || 5} min)` : "(catégorie supprimée)"}</li>;
            })}
          </ol>
          <div className="flex justify-end mt-2">
            <button onClick={() => update((d) => { d.spectaclePlans = d.spectaclePlans.filter((x) => x.id !== plan.id); return d; })} title="Supprimer" className="p-1 -m-1">
              <Trash2 size={22} color={COLORS.accent} />
            </button>
          </div>
        </IndexCard>
      ))}
    </div>
  );
}
