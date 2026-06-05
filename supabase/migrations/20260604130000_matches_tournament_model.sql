-- Migracion: matches_tournament_model
-- Agrega metadatos del formato Mundial 2026 para seed de calendario
-- (Story 7.1): grupos A-L, slots de bracket, sources TBD y sede.

alter table public.matches
  add column if not exists group_label text,
  add column if not exists bracket_slot int,
  add column if not exists home_source text,
  add column if not exists away_source text,
  add column if not exists venue text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'matches_group_label_check'
      and conrelid = 'public.matches'::regclass
  ) then
    alter table public.matches
      add constraint matches_group_label_check
      check (
        group_label is null
        or group_label in ('A','B','C','D','E','F','G','H','I','J','K','L')
      );
  end if;
end;
$$;

create unique index if not exists idx_matches_bracket_slot_unique
  on public.matches (bracket_slot)
  where bracket_slot is not null;

comment on column public.matches.group_label is 'Grupo FIFA 2026 A-L. Null para eliminatorias.';
comment on column public.matches.bracket_slot is 'Numero oficial del partido de eliminatoria en el bracket FIFA 2026 (73-104). Null en fase de grupos.';
comment on column public.matches.home_source is 'Codigo fuente del local para slots TBD de eliminatoria, por ejemplo 1A, 3A/B/C/D/F, W74 o L101.';
comment on column public.matches.away_source is 'Codigo fuente del visitante para slots TBD de eliminatoria, por ejemplo 2B, 3A/B/C/D/F, W74 o L101.';
comment on column public.matches.venue is 'Sede del partido resuelta desde ground/stadiums.json o fallback del calendario fuente.';
comment on column public.matches.stage is 'Fase del torneo: group, round-32, round-16, quarter, semi, third-place o final.';
