-- Empêche un membre connecté de s'auto-promouvoir administrateur : la policy RLS
-- "users update their own profile" autorise la mise à jour de sa propre ligne, ce qui incluait
-- jusqu'ici la colonne is_admin. Seul le service_role (dashboard / SQL editor) peut la modifier.
revoke update (is_admin) on public.profiles from authenticated, anon;
