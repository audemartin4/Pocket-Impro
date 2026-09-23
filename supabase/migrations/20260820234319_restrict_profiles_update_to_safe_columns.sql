-- Empêche un membre connecté de s'auto-promouvoir administrateur. La policy RLS
-- "users update their own profile" l'autorise à modifier sa propre ligne, et le droit UPDATE était
-- accordé au niveau de la TABLE entière : n'importe qui pouvait donc passer is_admin = true via
-- l'API REST. Un revoke au niveau colonne seul est sans effet tant que le grant table subsiste, il
-- faut d'abord retirer le droit table puis le re-donner colonne par colonne.
revoke update on public.profiles from anon, authenticated;
grant update (username, troupe, ville) on public.profiles to authenticated;
