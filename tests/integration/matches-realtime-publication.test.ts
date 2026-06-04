import { execFileSync } from "node:child_process";
import { basename } from "node:path";

import { describe, expect, it } from "vitest";

function queryLocalPostgres(sql: string): string {
  const projectName = basename(process.cwd());
  return execFileSync(
    "docker",
    [
      "exec",
      `supabase_db_${projectName}`,
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
