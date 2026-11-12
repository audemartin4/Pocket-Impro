-- Garde-fou contre les écritures destructrices, et attribution de chaque écriture.
--
-- Tout Pocket Impro tient dans une seule ligne de `app_data`, et la base ne connaît qu'une
-- permission : « ce compte peut modifier la ligne ». Les règles qui font qu'un membre ne peut que
-- proposer une fiche vivent dans l'interface, et une interface se contourne depuis la console du
-- navigateur. Surtout, le danger principal n'est pas la malveillance : un bug du client a déjà
-- effacé TROIS FOIS la banque de manches et des plans de cours (voir 20260906134404).
--
-- Ce déclencheur ne cherche pas à savoir si l'auteur a le droit — ce serait rejouer en SQL des
-- règles qui vivent dans App.jsx et changent toutes les semaines, avec la certitude qu'elles
-- divergeraient. Il regarde ce que l'écriture FERAIT, et refuse la catastrophe : une écriture
-- légitime touche une fiche, jamais trente.
--
-- Il arrête la catastrophe, pas la nuisance : quelqu'un qui abîmerait une fiche à la fois passerait
-- au travers. C'est le bon niveau d'effort pour 23 comptes qui sont des troupes d'impro.

alter table public.app_data add column if not exists modifie_par uuid;
alter table public.app_data add column if not exists modifie_le timestamptz;
comment on column public.app_data.modifie_par is 'Compte auteur de la dernière écriture, posé par le déclencheur garde_fou_app_data().';

-- Pas de grant sur ces deux colonnes : les clients n'écrivent que id, updated_at et value
-- (20260924133004). Le déclencheur, lui, les renseigne de toute façon — une signature qu'on peut
-- choisir soi-même ne signe rien.

/* SECURITY INVOKER (le défaut) et non DEFINER, volontairement : la fonction n'a besoin d'aucun
   droit particulier, et c'est ainsi que `current_user` vaut « authenticated » quand l'écriture
   vient de l'appli. En DEFINER il vaudrait « postgres » et le garde-fou ne saurait plus d'où vient
   l'écriture qu'il examine. */
create or replace function public.garde_fou_app_data() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  listes text[] := array[
    'exercises', 'categories', 'showConcepts', 'ambassadeurManches', 'ambassadeurs',
    'coursePlans', 'spectaclePlans', 'objectifs', 'thematiques', 'showTypes',
    'ambassadeurThemes', 'messages', 'favoris'
  ];
  cle text;
  avant int;
  apres int;
begin
  new.modifie_par := auth.uid();
  new.modifie_le := now();

  /* Les écritures faites depuis l'éditeur SQL, une migration ou une restauration de sauvegarde ne
     passent pas par le garde-fou : il protège l'appli d'elle-même, il ne doit jamais empêcher de
     réparer les dégâts qu'il aurait laissé passer. */
  if current_user <> 'authenticated' then
    return new;
  end if;

  if jsonb_typeof(new.value) is distinct from 'object' then
    raise exception 'Écriture refusée : le document doit rester un objet JSON.' using errcode = '23514';
  end if;

  foreach cle in array listes loop
    -- Une clé principale ne disparaît pas du document.
    if (old.value ? cle) and not (new.value ? cle) then
      raise exception 'Écriture refusée : la clé « % » disparaîtrait du document.', cle using errcode = '23514';
    end if;

    /* Une liste ne perd pas plus de 5 éléments d'un coup ET plus d'un cinquième de sa taille. Les
       deux conditions ensemble : sur une liste de 389 exercices, retirer 6 fiches reste permis,
       en retirer 100 non ; sur une liste de 2 plans, en supprimer un reste permis. */
    if jsonb_typeof(old.value -> cle) = 'array' and jsonb_typeof(new.value -> cle) = 'array' then
      avant := jsonb_array_length(old.value -> cle);
      apres := jsonb_array_length(new.value -> cle);
      if apres < avant - 5 and apres < avant * 0.8 then
        raise exception 'Écriture refusée : « % » passerait de % à % éléments.', cle, avant, apres using errcode = '23514';
      end if;
    end if;
  end loop;

  -- Dernier filet, pour ce que les listes ne couvrent pas (univers, listes d'idées, drapeaux).
  if octet_length(new.value::text) < octet_length(old.value::text) / 2 then
    raise exception 'Écriture refusée : le document perdrait plus de la moitié de sa taille.' using errcode = '23514';
  end if;

  return new;
end;
$$;

/* UPDATE seulement : à l'INSERT il n'y a pas d'état antérieur à protéger, et c'est ainsi qu'une
   base vide peut encore être semée. L'appli écrit par upsert, dont le chemin UPDATE déclenche bien
   ceci. Nommé après `app_data_archive` : les déclencheurs d'un même événement s'exécutent dans
   l'ordre alphabétique, l'archive est donc prise avant l'examen — et annulée avec le reste si
   l'écriture est refusée. */
drop trigger if exists app_data_garde_fou on public.app_data;
create trigger app_data_garde_fou
  before update on public.app_data
  for each row execute function public.garde_fou_app_data();
