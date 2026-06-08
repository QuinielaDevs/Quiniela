import { execFileSync } from "node:child_process";

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

describe("Supabase Realtime publication", () => {
  it("incluye public.matches en supabase_realtime", () => {
    const count = queryLocalPostgres(`
      select count(*)
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'matches';
    `);

    expect(Number(count)).toBe(1);
  });
});
