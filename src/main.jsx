import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { supabase } from "./supabaseClient.js";
import { APP_DATA_ROW_ID } from "./appDataRow.js";
import { fusionnerBlob } from "./fusionBlob.js";

/**
 * Remplacement de window.storage (API propre à l'environnement "Artifacts" de Claude.ai, sur
 * laquelle ce composant a été développé au départ) — branché ici sur une table Supabase à une seule
 * ligne (`app_data`, id = "main") au lieu de localStorage, pour que toute la troupe partage les
 * mêmes données. App.jsx n'a besoin d'AUCUNE modification pour cette partie : même forme d'API
 * (get/set/delete/list). Voir README.md pour le setup Supabase.
 */
const ROW_ID = APP_DATA_ROW_ID;

/**
 * Dernier état connu de la base par cet onglet : ce qu'il a lu en arrivant, ou écrit en dernier.
 * C'est le point de départ de la fusion — il dit ce que cet onglet a modifié depuis, et donc ce
 * qu'il a le droit d'imposer.
 */
let dernierEtatConnu = null;

window.storage = {
  async get(key) {
    if (key !== "impro-data") return null;
    const { data, error } = await supabase.from("app_data").select("value").eq("id", ROW_ID).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    dernierEtatConnu = data.value;
    return { key, value: JSON.stringify(data.value), shared: true };
  },
  /**
   * Relit la base avant d'écrire, et ne remplace que ce que cet onglet a réellement modifié : sans
   * ça, un onglet resté ouvert renvoie son état ancien et efface le travail des autres.
   */
  async set(key, value) {
    if (key !== "impro-data") return { key, value, shared: true };
    const local = JSON.parse(value);
    const { data: ligne, error: erreurLecture } = await supabase
      .from("app_data").select("value").eq("id", ROW_ID).maybeSingle();
    if (erreurLecture) throw erreurLecture;

    const distant = ligne ? ligne.value : null;
    // Garde-fou : un onglet qui n'a jamais réussi à LIRE la base n'a rien à lui imposer. Sans ce
    // test, une lecture ratée au démarrage (jeton expiré au réveil du téléphone, coupure réseau)
    // faisait repartir l'appli d'une base vide, qu'elle réécrivait 500 ms plus tard par-dessus les
    // données de toute la troupe : c'est ce qui a effacé la banque de manches d'ambassadeur et des
    // plans de cours enregistrés. On adopte l'état de la base au lieu de l'écraser, et l'appli
    // repart de là (useAppData ré-adopte la valeur renvoyée).
    if (distant !== null && dernierEtatConnu === null) {
      dernierEtatConnu = distant;
      return { key, value: JSON.stringify(distant), shared: true };
    }
    const aEcrire = distant === null ? local : fusionnerBlob(dernierEtatConnu, local, distant);

    const { error } = await supabase.from("app_data").upsert({ id: ROW_ID, value: aEcrire });
    if (error) throw error;
    dernierEtatConnu = aEcrire;
    return { key, value: JSON.stringify(aEcrire), shared: true };
  },
  async delete(key) {
    if (key !== "impro-data") return { key, deleted: false, shared: true };
    const { error } = await supabase.from("app_data").delete().eq("id", ROW_ID);
    if (error) throw error;
    return { key, deleted: true, shared: true };
  },
  async list(prefix) {
    const keys = prefix && !"impro-data".startsWith(prefix) ? [] : ["impro-data"];
    return { keys, prefix, shared: true };
  },
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
