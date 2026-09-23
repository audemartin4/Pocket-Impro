-- Sauvegarde quotidienne du blob de l'appli.
-- Contexte : tout Pocket Impro tient dans une seule ligne de app_data. Un bug du client a effacé
-- trois fois la banque de manches et des plans de cours enregistrés ; il n'existait aucune copie.
-- On archive donc, à la PREMIÈRE modification de chaque journée, l'état d'avant cette modification :
-- une journée entière de dégâts se répare en recopiant l'archive de la veille.
create table if not exists app_data_sauvegardes (
  id bigserial primary key,
  row_id text not null,
  jour date not null,
  value jsonb not null,
  cree_le timestamptz not null default now(),
  constraint app_data_sauvegardes_unicite unique (row_id, jour)
);

-- Personne ne lit ni n'écrit cette table depuis l'appli : elle n'est alimentée que par le trigger
-- (SECURITY DEFINER) et relue à la main en cas d'incident.
alter table app_data_sauvegardes enable row level security;
revoke all on table app_data_sauvegardes from anon, authenticated;
revoke all on sequence app_data_sauvegardes_id_seq from anon, authenticated;

create or replace function archiver_app_data() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  archive_id bigint;
begin
  -- On n'archive pas les archives.
  if old.id like 'sauvegarde-%' then return new; end if;
  begin
    insert into app_data_sauvegardes (row_id, jour, value)
    values (old.id, current_date, old.value)
    on conflict on constraint app_data_sauvegardes_unicite do nothing
    returning id into archive_id;
    -- Ménage une seule fois par jour, quand une archive vient réellement d'être créée.
    if archive_id is not null then
      delete from app_data_sauvegardes where cree_le < now() - interval '30 days';
    end if;
  exception when others then
    -- Une sauvegarde impossible ne doit JAMAIS empêcher l'appli d'enregistrer le travail en cours.
    null;
  end;
  return new;
end;
$$;

drop trigger if exists app_data_archive on app_data;
create trigger app_data_archive
  before update on app_data
  for each row execute function archiver_app_data();
