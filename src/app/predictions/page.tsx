import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/utils/supabase/server";
import { PredictionsBoardView } from "@/components/predictions/PredictionsBoardView";
import { WelcomePaymentModal } from "@/components/predictions/WelcomePaymentModal";
import { NoLeagueState } from "@/components/join/NoLeagueState";
import { BottomNavbar } from "@/components/layout/BottomNavbar";
import { AppTopNav } from "@/components/layout/AppTopNav";
import { BrandEyebrow } from "@/components/layout/BrandEyebrow";

import { groupCandidatesByCategory } from "@/utils/awards";
import { getActiveLeagueMembership } from "@/utils/active-league";
import type { AwardCandidate, SpecialPrediction } from "@/types";

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

  const membership = await getActiveLeagueMembership({ supabase, userId });
  const leagueId = membership?.leagueId;
  if (!leagueId) {
    return <NoLeagueState />;
  }

  // Modal de bienvenida + pago: se muestra mientras el pago siga pendiente y la
  // liga lo requiera. El componente cliente lo abre en cada visita (cerrable).
  const league = membership.league;
  const showWelcomePayment =
    Boolean(league?.requiresPayment) &&
    membership.paymentStatus === "pending";

  // Auto-guardado de predicciones por defecto (0-0): garantiza que cada partido
  // editable tenga un pronóstico aunque el usuario no lo toque, de modo que un
  // 0-0 sin modificar cuente como predicción. Idempotente y best-effort: si
  // falla no rompe el render del tablero. Debe ejecutarse ANTES de leer las
  // predicciones para incluir las recién creadas en la misma carga.
  await supabase.rpc("fn_ensure_default_predictions", {
    p_league_id: leagueId,
  });

  // Partidos programados de todo el torneo + predicciones propias del usuario.
  // Se incluyen los slots TBD de eliminatoria (equipos aún sin resolver) para
  // que el usuario navegue las fases; MatchCard los deja en solo-lectura hasta
  // que el bracket se resuelva (fn_match_editable lo bloquea en DB). La RLS deja
  // al dueño leer sus propias predicciones siempre (no espera al kickoff).
  const [
    { data: matches },
    { data: predictions },
    { data: candidates },
    { data: specialPredictions },
    activePhaseResult,
    { data: currentRoundOrdinal },
  ] = await Promise.all([
    supabase
      .from("matches")
      .select(
        "id, home_team, away_team, home_team_code, away_team_code, match_time, status, stage, matchday, home_source, away_source, bracket_slot, venue, group_label",
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
      .from("award_candidates")
      .select("*")
      .order("category", { ascending: true })
      .order("display_order", { ascending: true }),
    supabase
      .from("special_predictions")
      .select("category, candidate_id")
      .eq("league_id", leagueId)
      .eq("user_id", userId),
    supabase.rpc("fn_get_active_tournament_phase"),
    // Jornada en curso (server-authoritative) para el multiplicador predictivo.
    supabase.rpc("fn_current_round_ordinal"),
  ]);

  if (!matches || matches.length === 0) {
    return (
      <EmptyState
        title="No hay partidos disponibles aún"
        body="Cuando se programen los próximos partidos aparecerán aquí para que registres tu pronóstico."
      />
    );
  }

  // Procesar fase activa del torneo para los premios especiales
  let isAwardsLocked = false;
  let activePhaseLabel = "Semifinales en adelante";
  let activePhaseCode = "D";
  
  const activePhase = activePhaseResult?.data?.[0] as { edits_locked: boolean; label: string; phase_code: string } | undefined;
  if (activePhase) {
    isAwardsLocked = activePhase.edits_locked;
    activePhaseLabel = activePhase.label;
    activePhaseCode = activePhase.phase_code;
  }

  const candidatesByCategory = groupCandidatesByCategory(
    (candidates ?? []) as AwardCandidate[],
  );

  const initialSelections = {
    champion: null as string | null,
    top_scorer: null as string | null,
    mvp: null as string | null,
  };
  for (const p of (specialPredictions ?? []) as Pick<
    SpecialPrediction,
    "category" | "candidate_id"
  >[]) {
    if (p.category === "champion" || p.category === "top_scorer" || p.category === "mvp") {
      initialSelections[p.category] = p.candidate_id;
    }
  }

  return (
    <>
      {showWelcomePayment && league && (
        <WelcomePaymentModal
          leagueName={league.name}
          amount={league.paymentAmount}
          instructions={league.paymentInstructions}
        />
      )}
      <PredictionsBoardView
        leagueId={leagueId}
        matches={matches}
        predictions={predictions ?? []}
        candidatesByCategory={candidatesByCategory}
        initialSelections={initialSelections}
        isAwardsLocked={isAwardsLocked}
        activePhaseLabel={activePhaseLabel}
        activePhaseCode={activePhaseCode}
        currentRoundOrdinal={currentRoundOrdinal ?? 0}
      />
    </>
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
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
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
    <>
      <AppTopNav />
      <main className="min-h-svh bg-background px-4 py-6 pb-24 text-foreground lg:px-8 lg:pt-8 lg:pb-10">
        <div className="mx-auto flex w-full max-w-md flex-col gap-4 lg:max-w-6xl lg:gap-6">
          <header className="space-y-1">
            <BrandEyebrow />
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
    </>
  );
}
