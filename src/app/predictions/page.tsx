import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/utils/supabase/server";
import { PredictionsBoardView } from "@/components/predictions/PredictionsBoardView";
import { BottomNavbar } from "@/components/layout/BottomNavbar";

type PredictionsPageProps = {
  searchParams?: Promise<{ joined?: string }>;
};

// Banner de éxito tras unirse a una liga (?joined=1). Acceso dinámico a
// searchParams → vive en un hijo async dentro de <Suspense> (cacheComponents).
async function JoinedBanner({ searchParams }: PredictionsPageProps) {
  const params = searchParams ? await searchParams : undefined;
  if (params?.joined !== "1") return null;

  return (
    <div className="rounded-md border border-success bg-success/15 p-3 px-5 text-sm font-medium text-success">
      ¡Te has unido con éxito! Ya puedes registrar tus pronósticos.
    </div>
  );
}

// Tablero de Pronósticos: resuelve sesión + liga del usuario, lista los partidos
// editables (scheduled) precargando la predicción existente en cada MatchCard.
// El acceso a cookies (getClaims) es dinámico → se consume dentro de <Suspense>.
export async function PredictionsBoard() {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/auth/login");

  // Liga del usuario: la más reciente (un selector multi-liga es trabajo de Epic 3).
  const { data: memberships } = await supabase
    .from("league_members")
    .select("league_id, joined_at")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false })
    .limit(1);

  const leagueId = memberships?.[0]?.league_id;
  if (!leagueId) {
    return (
      <EmptyState
        title="Aún no perteneces a una liga"
        body="Crea tu propia quiniela o únete a una con un enlace de invitación para empezar a pronosticar."
        cta={{ href: "/leagues/new", label: "Crear una liga" }}
      />
    );
  }

  // Partidos programados de todo el torneo + predicciones propias del usuario.
  // Se incluyen los slots TBD de eliminatoria (equipos aún sin resolver) para
  // que el usuario navegue las fases; MatchCard los deja en solo-lectura hasta
  // que el bracket se resuelva (fn_match_editable lo bloquea en DB). La RLS deja
  // al dueño leer sus propias predicciones siempre (no espera al kickoff).
  const [{ data: matches }, { data: predictions }, firstMatchResult] = await Promise.all([
    supabase
      .from("matches")
      .select(
        "id, home_team, away_team, home_team_code, away_team_code, match_time, status, stage, matchday, home_source, away_source, bracket_slot",
      )
      .eq("status", "scheduled")
      .order("match_time", { ascending: true }),
    supabase
      .from("predictions")
      .select(
        "id, match_id, home_score_pred, away_score_pred, multiplier, updated_at",
      )
      .eq("league_id", leagueId)
      .eq("user_id", userId),
    supabase
      .from("matches")
      .select("match_time")
      .order("match_time", { ascending: true })
      .limit(1),
  ]);

  if (!matches || matches.length === 0) {
    return (
      <EmptyState
        title="No hay partidos disponibles aún"
        body="Cuando se programen los próximos partidos aparecerán aquí para que registres tu pronóstico."
      />
    );
  }

  const firstMatchTime = (firstMatchResult.data as { match_time: string }[] | null)?.[0]?.match_time ?? undefined;

  return (
    <PredictionsBoardView
      leagueId={leagueId}
      matches={matches}
      predictions={predictions ?? []}
      firstMatchTime={firstMatchTime}
    />
  );
}

function EmptyState({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="rounded-md border border-border bg-card p-6 text-center text-card-foreground">
      <h2 className="font-display text-lg font-bold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      {cta && (
        <Link
          href={cta.href}
          className="mt-4 inline-flex h-12 items-center justify-center rounded-sm bg-primary px-6 font-semibold text-primary-foreground"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-28 animate-pulse rounded-md border border-border bg-card"
        />
      ))}
    </div>
  );
}

export default function PredictionsPage({
  searchParams,
}: PredictionsPageProps) {
  return (
    <main className="min-h-svh bg-background px-4 py-6 pb-24 text-foreground lg:px-8 lg:py-10">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 lg:max-w-5xl lg:gap-6">
        <header className="space-y-1">
          <p className="font-display text-xs font-semibold uppercase tracking-wide text-accent">
            PIJA Quiniela
          </p>
          <h1 className="font-display text-2xl font-bold lg:text-4xl">
            Pronósticos
          </h1>
        </header>

        <Suspense fallback={null}>
          <JoinedBanner searchParams={searchParams} />
        </Suspense>

        <Suspense fallback={<BoardSkeleton />}>
          <PredictionsBoard />
        </Suspense>
      </div>

      <BottomNavbar />
    </main>
  );
}
