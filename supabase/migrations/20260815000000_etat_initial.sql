-- État initial du schéma, reconstruit le 2026-09-24 à partir de la base de production.
--
-- Pourquoi ce fichier existe : `app_data` et `profiles` ont été créées à la main dans l'éditeur SQL
-- de Supabase, en août 2026, sans passer par une migration. Le schéma n'existait donc qu'à un seul
-- endroit — le serveur de production — et n'était reproductible nulle part : pas de branche de test
-- possible, et rien à rejouer si le projet devait être recréé. Ce fichier comble ce trou. Il n'a
-- jamais été « appliqué » au sens strict : il décrit ce qui est déjà en place.
--
-- Il est écrit en `if not exists` / `drop policy if exists` de bout en bout, pour pouvoir être
-- rejoué sur la production sans rien casser comme sur une base vierge.
--
-- Sa date (20260815) est volontairement antérieure aux cinq migrations réelles qui suivent : c'est
-- bien l'état qu'elles ont trouvé en arrivant.
--
-- Il est marqué « déjà appliqué » dans l'historique de la production (l'équivalent d'un
-- `supabase migration repair --status applied 20260815000000`), pour qu'un `supabase db push` ne le
-- rejoue pas : il remettrait la version NON durcie de `handle_new_user`, sans `search_path` figé,
-- et annulerait la migration 20260820234616. Sur une base neuve, en revanche, il s'applique
-- normalement — puis 20260820234616 le durcit juste après, dans l'ordre.

-- ---------------------------------------------------------------------------------------------
-- app_data : tout Pocket Impro dans une seule ligne
-- ---------------------------------------------------------------------------------------------
-- Une ligne = un jeu de données complet. `main` est celui de la troupe ; `dev` sa copie, sur
-- laquelle pointe le serveur de développement (VITE_APP_DATA_ID). Le contenu entier — exercices,
-- catégories, plans, manches, ambassadeurs, favoris, messages — vit dans la colonne `value`.
create table if not exists public.app_data (
  id text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Realtime : c'est ce qui resynchronise les autres navigateurs quand quelqu'un enregistre.
-- `replica identity full` est nécessaire pour que la charge utile contienne la valeur complète.
alter table public.app_data replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_rel pr
    join pg_publication p on p.oid = pr.prpubid
    where p.pubname = 'supabase_realtime' and pr.prrelid = 'public.app_data'::regclass
  ) then
    alter publication supabase_realtime add table public.app_data;
  end if;
end $$;

alter table public.app_data enable row level security;

-- ---------------------------------------------------------------------------------------------
-- profiles : les comptes, distincts des données métier
-- ---------------------------------------------------------------------------------------------
-- Une ligne par compte Supabase Auth. `is_admin` décide des droits de modération ; elle est
-- volontairement hors de portée des clients (voir 20260820234216 et 20260820234319).
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  troupe text default ''::text,
  ville text default ''::text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Lisible par tous : les fiches affichent le pseudo et la troupe de leur auteur.
drop policy if exists "profiles publicly readable" on public.profiles;
create policy "profiles publicly readable" on public.profiles for select using (true);

-- Chacun ne touche qu'à sa propre ligne. Le garde-fou sur `is_admin` n'est PAS ici : une policy ne
-- sait pas raisonner colonne par colonne, c'est le grant qui s'en charge (20260820234319).
drop policy if exists "users insert their own profile" on public.profiles;
create policy "users insert their own profile" on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "users update their own profile" on public.profiles;
create policy "users update their own profile" on public.profiles for update using (auth.uid() = id);

drop policy if exists "users delete their own profile" on public.profiles;
create policy "users delete their own profile" on public.profiles for delete using (auth.uid() = id);

-- La fiche de compte naît avec l'inscription : le formulaire d'inscription range pseudo, troupe et
-- ville dans les métadonnées du compte, ce trigger les recopie ici. Il tourne en SECURITY DEFINER,
-- donc sans aucun droit côté client. Sa version durcie est dans 20260820234616 ; celle-ci est
-- l'originale, gardée pour que l'historique soit lisible.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $function$
begin
  insert into public.profiles (id, username, troupe, ville)
  values (new.id, new.raw_user_meta_data->>'username', new.raw_user_meta_data->>'troupe', new.raw_user_meta_data->>'ville');
  return new;
end;
$function$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------------------------
-- Droits d'accès à la Data API
-- ---------------------------------------------------------------------------------------------
-- À partir du 30 octobre 2026, une table nouvellement créée dans `public` ne reçoit PLUS de droits
-- automatiques : sans les lignes ci-dessous, l'appli répondrait « permission denied » sur une base
-- recréée (reset local, branche de test, nouveau projet). Les droits fins — et le retrait de ce qui
-- ne sert à rien — sont posés par la migration 20260924133004.
grant select, insert, update on public.app_data to anon, authenticated;
grant all on public.app_data to service_role;

grant select on public.profiles to anon, authenticated;
grant all on public.profiles to service_role;
