-- handle_new_user est un trigger SECURITY DEFINER (il tourne avec les droits du propriétaire) :
-- sans search_path figé, un schéma malveillant placé devant "public" pourrait détourner la table
-- visée. On fige donc search_path à vide et on qualifie tout en toutes lettres.
-- On retire aussi le droit EXECUTE aux rôles clients : cette fonction ne doit être appelée que par
-- le trigger sur auth.users, jamais via /rest/v1/rpc.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.profiles (id, username, troupe, ville)
  values (new.id, new.raw_user_meta_data->>'username', new.raw_user_meta_data->>'troupe', new.raw_user_meta_data->>'ville');
  return new;
end;
$function$;

revoke execute on function public.handle_new_user() from anon, authenticated, public;
