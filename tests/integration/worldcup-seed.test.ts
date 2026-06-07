import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { supabaseDbContainerName } from "./local-postgres";

function queryLocalPostgres(sql: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      supabaseDbContainerName(),
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-Atc",
      sql,
    ],
    { encoding: "utf8" },
  ).trim();
}

function runSql(sql: string): void {
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      supabaseDbContainerName(),
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    { input: sql, encoding: "utf8" },
  );
}

function queryLocalPostgresScript(sql: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      supabaseDbContainerName(),
      "psql",
      "-q",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-At",
    ],
    { input: sql, encoding: "utf8" },
  ).trim();
}

describe("World Cup 2026 seed", () => {
  it("siembra exactamente 104 partidos oficiales y no deja partidos demo", () => {
    const [worldCupCount, demoCount] = queryLocalPostgres(`
      select count(*) from public.matches where external_ref like 'wc2026:%';
      select count(*) from public.matches where external_ref like 'demo-%';
    `)
      .split("\n")
      .map(Number);

    expect(worldCupCount).toBe(104);
    expect(demoCount).toBe(0);
  });

  it("mantiene los conteos esperados por fase", () => {
    const counts = Object.fromEntries(
      queryLocalPostgres(`
        select stage, count(*)
        from public.matches
        where external_ref like 'wc2026:%'
        group by stage
        order by stage;
      `)
        .split("\n")
        .map((line) => {
          const [stage, count] = line.split("|");
          return [stage, Number(count)];
        }),
    );

    expect(counts).toEqual({
      final: 1,
      group: 72,
      quarter: 4,
      "round-16": 8,
      "round-32": 16,
      semi: 2,
      "third-place": 1,
    });
  });

  it("siembra 12 grupos con 6 partidos y 3 jornadas de 2 partidos", () => {
    const [groupsWithSixMatches, groupMatchdaysWithTwoMatches] =
      queryLocalPostgres(`
        select count(*)
        from (
          select group_label
          from public.matches
          where external_ref like 'wc2026:%' and stage = 'group'
          group by group_label
          having count(*) = 6
        ) groups;

        select count(*)
        from (
          select group_label, matchday
          from public.matches
          where external_ref like 'wc2026:%' and stage = 'group'
          group by group_label, matchday
          having count(*) = 2
        ) group_matchdays;
      `)
        .split("\n")
        .map(Number);

    expect(groupsWithSixMatches).toBe(12);
    expect(groupMatchdaysWithTwoMatches).toBe(36);
  });

  it("cada equipo aparece exactamente 3 veces en su grupo", () => {
    const [teamsWithThreeMatches, totalTeams] = queryLocalPostgres(`
      with appearances as (
        select group_label, home_team_code as team_code
        from public.matches
        where external_ref like 'wc2026:%' and stage = 'group'
        union all
        select group_label, away_team_code as team_code
        from public.matches
        where external_ref like 'wc2026:%' and stage = 'group'
      ),
      grouped as (
        select group_label, team_code, count(*) as matches_played
        from appearances
        group by group_label, team_code
      )
      select count(*) filter (where matches_played = 3), count(*)
      from grouped;
    `)
      .split("|")
      .map(Number);

    expect(totalTeams).toBe(48);
    expect(teamsWithThreeMatches).toBe(48);
  });

  it("siembra slots de bracket unicos y sources solo en knockout", () => {
    const [
      knockoutSlots,
      distinctSlots,
      minSlot,
      maxSlot,
      knockoutWithSources,
      groupWithSources,
    ] = queryLocalPostgres(`
      select
        count(*) filter (where stage <> 'group' and bracket_slot is not null),
        count(distinct bracket_slot) filter (where stage <> 'group'),
        min(bracket_slot) filter (where stage <> 'group'),
        max(bracket_slot) filter (where stage <> 'group'),
        count(*) filter (
          where stage <> 'group'
            and home_source is not null
            and away_source is not null
        ),
        count(*) filter (
          where stage = 'group'
            and (home_source is not null or away_source is not null)
        )
      from public.matches
      where external_ref like 'wc2026:%';
    `)
      .split("|")
      .map(Number);

    expect(knockoutSlots).toBe(32);
    expect(distinctSlots).toBe(32);
    expect(minSlot).toBe(73);
    expect(maxSlot).toBe(104);
    expect(knockoutWithSources).toBe(32);
    expect(groupWithSources).toBe(0);
  });

  it("convierte el inaugural a UTC", () => {
    const kickoff = queryLocalPostgres(`
      select to_char(match_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      from public.matches
      where external_ref = 'wc2026:grp:A:MEX-RSA';
    `);

    expect(kickoff).toBe("2026-06-11T19:00:00Z");
  });

  it("puede re-ejecutar el seed sin duplicar filas ni borrar resultados", () => {
    const seedSql = readFileSync(
      "supabase/migrations/20260604131000_seed_worldcup_2026.sql",
      "utf8",
    );

    runSql(seedSql);

    const [count, preserved] = queryLocalPostgresScript(`
      begin;

      update public.matches
      set status = 'finished',
          home_score = 2,
          away_score = 1
      where external_ref = 'wc2026:grp:A:MEX-RSA';

      ${seedSql}

      select count(*) from public.matches where external_ref like 'wc2026:%';
      select status || '|' || home_score || '|' || away_score
      from public.matches
      where external_ref = 'wc2026:grp:A:MEX-RSA';

      rollback;
    `).split("\n");

    expect(Number(count)).toBe(104);
    expect(preserved).toBe("finished|2|1");
  });
});
