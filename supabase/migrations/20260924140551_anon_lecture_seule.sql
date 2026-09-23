-- `anon` passe en lecture seule sur app_data.
--
-- La migration precedente (20260924133004) avait laisse INSERT et UPDATE a `anon` par prudence :
-- elle ne devait rien changer au fonctionnement, et on croyait qu'un visiteur sans compte pouvait
-- mettre une fiche en favori. Verification faite, c'est faux : les six bascules de favori, la
-- creation de fiches, l'enregistrement d'un plan, les manches d'ambassadeur — tout est deja
-- conditionne a un compte. Aucune fonctionnalite legitime n'ecrit sans compte.
--
-- Ce qui n'etait pas conditionne, en revanche : les corbeilles de l'ecran « Plans ». Un visiteur
-- arrive sur « #plans » voyait tous les plans de cours et de spectacle de la troupe et pouvait en
-- supprimer un d'un seul appui, pour tout le monde. C'est corrige cote appli (garde unique dans
-- `update()`, boutons masques), mais une garde en JavaScript ne protege rien : la cle publique est
-- dans le code que tout visiteur telecharge, et il peut parler a la base sans passer par l'appli.
-- D'ou ce verrou-ci, le seul qui tienne.
--
-- Les comptes connectes (`authenticated`) gardent tous leurs droits : rien ne change pour eux.
--
-- Effet de bord assume : les migrations de donnees de l'appli (`mergeMissingCategories`) tournent
-- au chargement, pour qui que ce soit. Depuis un onglet anonyme, leur enregistrement n'est plus
-- possible — l'appli n'essaie meme plus, elle n'ecrit que si une session existe. La migration
-- s'appliquera donc au premier chargement d'une personne connectee, quelques heures plus tard au
-- pire. Rien ne se perd entre-temps : le document en base reste celui d'avant, et la migration se
-- rejoue a chaque chargement tant qu'elle n'a pas ete enregistree.

revoke insert, update on public.app_data from anon;

-- Les policies RLS suivent, pour que les deux verrous disent la meme chose. Une policy qui autorise
-- ce que le grant interdit n'est pas une faille, mais elle ment sur l'intention : la prochaine
-- personne qui lira ce schema doit voir « les visiteurs lisent, les comptes ecrivent ».
drop policy if exists "app_data insertable par tous" on public.app_data;
drop policy if exists "app_data modifiable par tous" on public.app_data;

create policy "app_data insertable par les comptes" on public.app_data
  for insert to authenticated with check (true);
create policy "app_data modifiable par les comptes" on public.app_data
  for update to authenticated using (true) with check (true);

-- La lecture reste ouverte a tous : la bibliotheque se consulte sans compte, c'est le principe de
-- l'appli.
-- (policy « app_data lisible par tous », inchangee)
