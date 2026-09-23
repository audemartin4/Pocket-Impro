-- Droits d'accès explicites, et fermeture de ce qui n'a jamais servi.
--
-- Deux raisons, l'une de calendrier, l'autre de sécurité.
--
-- 1. À partir du 30 octobre 2026, une table nouvellement créée dans le schéma `public` ne reçoit
--    plus de droits automatiques pour la Data API. Les tables déjà en production gardent les leurs,
--    donc rien ne casse ce jour-là — mais une base recréée (reset local, branche de test, nouveau
--    projet) repartirait sans droits du tout. Cette migration pose donc noir sur blanc ce que
--    chaque rôle a le droit de faire.
--
-- 2. Surtout : `anon` avait DELETE et TRUNCATE sur `app_data`, avec une policy RLS en
--    `using (true)`. La clé anon est publique par construction — elle est dans le JavaScript que
--    tout visiteur télécharge. N'importe qui pouvait donc effacer la ligne `main`, c'est-à-dire la
--    bibliothèque entière de la troupe, depuis la console de son navigateur. Ce droit ne servait à
--    rien : la seule fonction de l'appli qui appelle `delete` sur app_data (window.storage.delete,
--    src/main.jsx) n'est appelée nulle part.
--
-- Ce que l'appli fait réellement, et donc ce qu'on garde :
--   app_data  — SELECT (lecture initiale et relecture avant écriture), INSERT + UPDATE (upsert).
--               Y compris pour `anon` : un visiteur sans compte peut mettre une fiche en favori, et
--               ça réécrit le document partagé. Lui retirer l'écriture casserait l'appli ; ce serait
--               une décision produit, pas un ajustement de droits.
--   profiles  — SELECT pour tous ; UPDATE limité à (username, troupe, ville) et DELETE (« Supprimer
--               mon compte ») pour les comptes connectés seulement.
--
-- À noter : supprimer un exercice, un plan, une manche ou un ambassadeur n'est JAMAIS un DELETE
-- SQL. Tout vit dans une seule ligne de app_data : l'appli réécrit le document entier, c'est un
-- UPDATE. Aucune de ces fonctionnalités n'est touchée ici.

-- ---------------------------------------------------------------------------------------------
-- app_data
-- ---------------------------------------------------------------------------------------------
revoke all on public.app_data from anon, authenticated;
grant select, insert, update on public.app_data to anon, authenticated;
grant all on public.app_data to service_role;

-- Les policies suivent le même chemin. « app_data writable by anyone » était en `for all` :
-- elle autorisait aussi le DELETE, et doublonnait avec « app_data publicly readable ». On la
-- remplace par trois policies explicites — ceinture et bretelles : même si un grant DELETE
-- revenait un jour par accident, aucune policy ne l'autoriserait.
drop policy if exists "app_data writable by anyone" on public.app_data;
drop policy if exists "app_data publicly readable" on public.app_data;

create policy "app_data lisible par tous" on public.app_data
  for select using (true);
create policy "app_data insertable par tous" on public.app_data
  for insert with check (true);
create policy "app_data modifiable par tous" on public.app_data
  for update using (true) with check (true);

-- ---------------------------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------------------------
-- On repart de zéro puis on redonne le strict nécessaire. L'ordre compte : le revoke table d'abord,
-- les grants colonne ensuite — un droit accordé au niveau de la table écrase les restrictions par
-- colonne (c'est exactement la faille qu'avait corrigée 20260820234319).
revoke all on public.profiles from anon, authenticated;

-- Tout le monde lit : les fiches affichent le pseudo et la troupe de leur auteur.
grant select on public.profiles to anon, authenticated;

-- Un compte connecté modifie ses trois champs libres — jamais `is_admin` — et peut supprimer sa
-- propre fiche (la policy RLS « users delete their own profile » la limite à sa ligne).
grant update (username, troupe, ville) on public.profiles to authenticated;
grant delete on public.profiles to authenticated;

-- L'INSERT est en principe superflu : la fiche est créée par le trigger `handle_new_user`, qui
-- tourne en SECURITY DEFINER. On le laisse au rôle connecté, sur les colonnes sûres uniquement,
-- parce que la policy « users insert their own profile » existe et qu'un jour l'appli pourrait s'en
-- servir. `anon` n'en a aucun besoin : à l'inscription, la fiche est créée côté serveur.
grant insert (id, username, troupe, ville) on public.profiles to authenticated;

grant all on public.profiles to service_role;

-- ---------------------------------------------------------------------------------------------
-- app_data_sauvegardes : on ne touche à rien
-- ---------------------------------------------------------------------------------------------
-- Déjà fermée à l'API depuis 20260906134404, alimentée uniquement par le trigger. On se contente de
-- redire l'intention, pour qu'une relecture de ce fichier n'y voie pas un oubli. Le linter Supabase
-- la signale en INFO (« RLS activé sans policy ») : c'est voulu, aucune policy = personne ne passe.
revoke all on table public.app_data_sauvegardes from anon, authenticated;
grant all on public.app_data_sauvegardes to service_role;
