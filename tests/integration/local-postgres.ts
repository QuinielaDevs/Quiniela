import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

let cachedContainerName: string | undefined;

function projectIdFromConfig(): string | undefined {
  try {
    const config = readFileSync("supabase/config.toml", "utf8");
    return config.match(/^\s*project_id\s*=\s*"([^"]+)"/m)?.[1];
  } catch {
    return undefined;
  }
}

export function supabaseDbContainerName(): string {
  if (cachedContainerName) {
    return cachedContainerName;
  }

  const candidates = [
    process.env.SUPABASE_DB_CONTAINER,
    process.env.SUPABASE_PROJECT_ID
      ? `supabase_db_${process.env.SUPABASE_PROJECT_ID}`
      : undefined,
    projectIdFromConfig()
      ? `supabase_db_${projectIdFromConfig()}`
      : undefined,
    `supabase_db_${basename(process.cwd()).toLowerCase()}`,
  ].filter((name): name is string => Boolean(name));

  const uniqueCandidates = [...new Set(candidates)];

  try {
    const runningNames = execFileSync("docker", ["ps", "--format", "{{.Names}}"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    const matchingCandidate = uniqueCandidates.find((name) =>
      runningNames.includes(name),
    );
    const localSupabaseDbNames = runningNames.filter((name) =>
      name.startsWith("supabase_db_"),
    );

    cachedContainerName =
      matchingCandidate ??
      (localSupabaseDbNames.length === 1 ? localSupabaseDbNames[0] : undefined);
  } catch {
    cachedContainerName = undefined;
  }

  cachedContainerName ??=
    uniqueCandidates[0] ?? `supabase_db_${basename(process.cwd()).toLowerCase()}`;
  return cachedContainerName;
}
