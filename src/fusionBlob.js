/**
 * Fusion à trois du blob de données.
 *
 * L'appli enregistre tout son état en un seul objet JSON. Écrire cet objet tel quel écrase le
 * travail des autres : un onglet resté ouvert avec un état ancien renvoie sa version et supprime
 * tout ce qui a changé depuis, y compris ce qu'il n'a jamais touché. C'est ainsi qu'un plan de cours
 * enregistré a disparu le 2026-08-28.
 *
 * D'où cette fusion. Trois versions entrent en jeu :
 *   - `base`   : ce que cet onglet avait lu la dernière fois (son point de départ) ;
 *   - `local`  : ce qu'il veut écrire maintenant ;
 *   - `distant`: ce qui se trouve réellement en base à cet instant.
 *
 * La règle est celle de tout outil de fusion : ce que j'ai modifié l'emporte sur ce que je n'ai pas
 * touché, et ce que je n'ai pas touché reprend la version de la base. Les listes d'objets à `id`
 * (exercices, catégories, manches, plans…) se fusionnent élément par élément, ce qui permet à deux
 * personnes d'ajouter chacune la sienne sans s'effacer — et à une suppression de rester une
 * suppression au lieu de revenir par la fenêtre.
 */

const memeChose = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const estListeAvecId = (v) => Array.isArray(v) && v.every((x) => x && typeof x === "object" && typeof x.id === "string");

const parId = (liste) => new Map((liste || []).map((x) => [x.id, x]));

/**
 * Fusion élément par élément d'une liste d'objets identifiés. On garde l'ordre de la base distante,
 * puis on ajoute à la fin ce que cet onglet a créé de son côté.
 */
function fusionnerListe(base, local, distant) {
  const bBase = parId(base);
  const bLocal = parId(local);
  const bDistant = parId(distant);
  const resultat = [];

  for (const item of distant) {
    const id = item.id;
    const dansBase = bBase.has(id);
    const dansLocal = bLocal.has(id);
    // Supprimé ici depuis la lecture : la suppression est un choix, elle l'emporte.
    if (dansBase && !dansLocal) continue;
    if (!dansLocal) { resultat.push(item); continue; } // ajouté par quelqu'un d'autre
    const versionLocale = bLocal.get(id);
    const versionBase = bBase.get(id);
    // Modifié ici → on garde sa version ; sinon on prend celle de la base, plus récente.
    resultat.push(dansBase && !memeChose(versionLocale, versionBase) ? versionLocale : item);
  }
  // Ce que cet onglet a ajouté et que la base ne connaît pas encore.
  for (const item of local) {
    if (!bDistant.has(item.id) && !bBase.has(item.id)) resultat.push(item);
  }
  return resultat;
}

export function fusionnerBlob(base, local, distant) {
  if (!distant || typeof distant !== "object") return local;
  if (!base || typeof base !== "object") return local; // pas de point de départ : on ne sait pas fusionner
  if (memeChose(local, distant)) return local;

  const resultat = { ...distant };
  const cles = new Set([...Object.keys(local || {}), ...Object.keys(distant)]);

  for (const cle of cles) {
    const vBase = base[cle];
    const vLocal = local ? local[cle] : undefined;
    const vDistant = distant[cle];

    if (memeChose(vLocal, vDistant)) { resultat[cle] = vLocal; continue; }
    // Cet onglet n'a pas touché à cette clé : la version de la base fait foi.
    if (memeChose(vLocal, vBase)) { resultat[cle] = vDistant; continue; }
    // Personne d'autre n'y a touché : c'est notre version.
    if (memeChose(vDistant, vBase)) { resultat[cle] = vLocal; continue; }
    // Les deux ont changé. Sur une liste d'objets identifiés, on descend d'un cran.
    if (estListeAvecId(vBase) && estListeAvecId(vLocal) && estListeAvecId(vDistant)) {
      resultat[cle] = fusionnerListe(vBase, vLocal, vDistant);
      continue;
    }
    // Ailleurs (drapeaux de migration, listes de mots, réglages…), le dernier écrivain gagne, mais
    // seulement sur cette clé-là.
    resultat[cle] = vLocal;
  }

  // Une clé supprimée des deux côtés doit rester supprimée.
  for (const cle of Object.keys(resultat)) {
    if (local && !(cle in local) && base && cle in base && !memeChose(base[cle], distant[cle])) continue;
    if (local && !(cle in local) && base && cle in base && memeChose(base[cle], distant[cle])) delete resultat[cle];
  }

  return resultat;
}
