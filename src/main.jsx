import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { supabase } from "./supabaseClient.js";

/**
 * Remplacement de window.storage (API propre à l'environnement "Artifacts" de Claude.ai, sur
 * laquelle ce composant a été développé au départ) — branché ici sur une table Supabase à une seule
 * ligne (`app_data`, id = "main") au lieu de localStorage, pour que toute la troupe partage les
 * mêmes données. App.jsx n'a besoin d'AUCUNE modification pour cette partie : même forme d'API
 * (get/set/delete/list). Voir README.md pour le setup Supabase.
 */
const ROW_ID = "main";

window.storage = {
  async get(key) {
    if (key !== "impro-data") return null;
    const { data, error } = await supabase.from("app_data").select("value").eq("id", ROW_ID).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { key, value: JSON.stringify(data.value), shared: true };
  },
  async set(key, value) {
    if (key !== "impro-data") return { key, value, shared: true };
    const { error } = await supabase.from("app_data").upsert({ id: ROW_ID, value: JSON.parse(value) });
    if (error) throw error;
    return { key, value, shared: true };
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
