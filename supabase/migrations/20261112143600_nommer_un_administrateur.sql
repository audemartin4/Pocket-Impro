-- Nommer un administrateur depuis l'appli, sans rouvrir la colonne `is_admin`.
--
-- Le verrou du 2026-08-20 (20260820234319) reste entier : un compte connecté n'écrit toujours que
-- username, troupe et ville. L'écriture de `is_admin` passe par une fonction `security definer`,
-- qui s'exécute avec les droits de son propriétaire — et contourne donc le grant de colonne — mais
-- commence par vérifier qui l'appelle.
--
-- Un seul compte peut nommer : celui d'Aude, dont l'identifiant est écrit en dur ci-dessous. Un
-- administrateur nommé hérite de la modération, pas du pouvoir de nommer : les droits ne se
-- propagent pas d'eux-mêmes. L'identifiant n'est pas un secret — `profiles` est lisible
-- publiquement — ce qui protège, c'est que personne d'autre ne peut présenter ce `auth.uid()`.

create table if not exists public.admin_journal (
  id bigint generated always as identity primary key,
  cible_id uuid not null,
  cible_username text not null,
  valeur boolean not null,
  par_id uuid not null,
  par_username text not null,
  cree_le timestamptz not null default now()
);
comment on table public.admin_journal is 'Qui a nomme ou destitue qui, et quand. Ecrit par public.definir_admin().';

-- Journal interne : il ne passe pas par l'API. RLS active sans aucune policy = invisible côté
-- client ; la fonction, elle, y écrit avec les droits de son propriétaire.
alter table public.admin_journal enable row level security;
revoke all on table public.admin_journal from anon, authenticated;

create or replace function public.peut_nommer_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() = '18b6a5b1-32a6-4d2a-8429-acd7f738c9ea'::uuid;
$$;
comment on function public.peut_nommer_admin() is 'Vrai pour le seul compte autorise a nommer un administrateur. Sert a l''appli pour ne pas afficher un bouton voue a l''echec.';

create or replace function public.definir_admin(cible uuid, valeur boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  appelant uuid := auth.uid();
  nom_cible text;
  nom_appelant text;
  autres_admins int;
begin
  if not coalesce(public.peut_nommer_admin(), false) then
    raise exception 'Seul le compte fondateur peut nommer un administrateur.' using errcode = '42501';
  end if;

  select username into nom_cible from public.profiles where id = cible;
  if nom_cible is null then
    raise exception 'Ce compte n''existe pas.' using errcode = 'P0002';
  end if;

  -- Une bibliothèque sans administrateur n'a plus personne pour valider les propositions ni
  -- corriger une fiche : on refuse de retirer les droits au dernier.
  if valeur is false then
    select count(*) into autres_admins from public.profiles where is_admin and id <> cible;
    if autres_admins = 0 then
      raise exception 'Impossible de retirer les droits au dernier administrateur.' using errcode = '42501';
    end if;
  end if;

  select username into nom_appelant from public.profiles where id = appelant;

  update public.profiles set is_admin = valeur where id = cible;

  insert into public.admin_journal (cible_id, cible_username, valeur, par_id, par_username)
  values (cible, nom_cible, valeur, appelant, coalesce(nom_appelant, '?'));
end;
$$;

revoke all on function public.definir_admin(uuid, boolean) from public, anon;
revoke all on function public.peut_nommer_admin() from public, anon;
grant execute on function public.definir_admin(uuid, boolean) to authenticated;
grant execute on function public.peut_nommer_admin() to authenticated;
