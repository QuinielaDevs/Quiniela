import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Outfit } from "next/font/google";

import { createClient } from "@/utils/supabase/server";
import { getActiveLeagueMembership } from "@/utils/active-league";
import { groupCandidatesByCategory } from "@/utils/awards";
import { cn } from "@/utils/utils";
import type {
  AwardCandidate,
  AwardCategory,
  SpecialPrediction,
} from "@/types";
import { AwardsBoard } from "@/components/awards/AwardsBoard";
import { AppTopNav } from "@/components/layout/AppTopNav";
import { NoLeagueState } from "@/components/join/NoLeagueState";

const outfit = Outfit({ subsets: ["latin"], display: "swap" });

type AwardsPageProps = {
  searchParams: Promise<{ league?: string }>;
};

/**
 * Premios Especiales (/awards) — ruta protegida.
 * El export por defecto es un wrapper NO-async que aísla el acceso a datos
 * dinámicos (sesión/queries/searchParams) dentro de <Suspense>, requisito de
 * `cacheComponents` de Next 16 (mismo patrón que /duels, /standings, /predictions).
 */
export default function AwardsPage(props: AwardsPageProps) {
  return (
    <Suspense fallback={<AwardsFallback />}>
      <AwardsContent {...props} />
    </Suspense>
  );
}

function AwardsFallback() {
  return (
    <>
      <AppTopNav />
      <main
        className={cn(
          "min-h-screen bg-[#0D1B2A] px-4 py-8 text-white lg:px-8",
          outfit.className,
        )}
      >
        <div className="mx-auto w-full max-w-md lg:max-w-5xl">
          <header className="mb-6">
            <h1 className="text-2xl font-bold lg:text-4xl">Premios Especiales</h1>
            <p className="mt-1 text-sm text-white/60">
              Tus apuestas de largo plazo del Mundial. Un tap y queda guardado.
            </p>
          </header>
          <div className="animate-pulse space-y-4">
            <div className="h-10 rounded-lg bg-[#1B263B]" />
            <div className="h-40 rounded-lg bg-[#1B263B]" />
            <div className="h-40 rounded-lg bg-[#1B263B]" />
          </div>
        </div>
      </main>
    </>
  );
}

/**
 * Las predicciones son POR LIGA: el usuario elige la liga (selector) y pronostica
 * Campeón/Goleador/MVP de esa liga. Server Component: resuelve sesión + datos y
 * delega la interacción al AwardsBoard cliente.
 */
async function AwardsContent({ searchParams }: AwardsPageProps) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  // Ligas del usuario (RLS limita league_members a las filas propias).
  const { data: memberships } = await supabase
    .from("league_members")
    .select("league_id, leagues(id, name)")
    .eq("user_id", user.id);

  // El embebido `leagues(...)` de PostgREST puede tiparse como objeto o como
  // array según cómo infiera la cardinalidad supabase-js; normalizamos a objeto.
  const leagues = (memberships ?? [])
    .map((m) => {
      const lg = m.leagues as unknown as
        | { id: string; name: string }
        | { id: string; name: string }[]
        | null;
      return Array.isArray(lg) ? (lg[0] ?? null) : lg;
    })
    .filter((l): l is { id: string; name: string } => l != null)
    .sort((a, b) => a.name.localeCompare(b.name));

  const { league: requestedLeague } = await searchParams;
  const activeMembership = await getActiveLeagueMembership({
    supabase,
    userId: user.id,
  });

  return (
    <>
      <AppTopNav />
      <main
        className={cn(
          "min-h-screen bg-[#0D1B2A] px-4 py-8 text-white lg:px-8",
          outfit.className,
        )}
      >
        <div className="mx-auto w-full max-w-md lg:max-w-5xl">
          <header className="mb-6">
            <h1 className="text-2xl font-bold lg:text-4xl">Premios Especiales</h1>
            <p className="mt-1 text-sm text-white/60">
              Tus apuestas de largo plazo del Mundial. Un tap y queda guardado.
            </p>
          </header>

          {leagues.length === 0 ? (
            <NoLeagueState body="Únete con un código de invitación o crea tu propia quiniela para pronosticar los premios de la Copa." />
          ) : (
            <AwardsForLeague
              leagues={leagues}
              activeLeagueId={activeMembership?.leagueId ?? null}
              requestedLeague={requestedLeague}
              userId={user.id}
            />
          )}
        </div>
      </main>
    </>
  );
}

/**
 * Resuelve la liga activa, carga candidatos + predicciones y pinta el selector de
 * liga (si hay más de una) junto al tablero. Separado para mantener el componente
 * principal centrado en sesión/layout.
 */
async function AwardsForLeague({
  leagues,
  activeLeagueId,
  requestedLeague,
  userId,
}: {
  leagues: Array<{ id: string; name: string }>;
  activeLeagueId: string | null;
  requestedLeague: string | undefined;
  userId: string;
}) {
  const activeLeague =
    leagues.find((l) => l.id === requestedLeague) ??
    leagues.find((l) => l.id === activeLeagueId) ??
    leagues[0];

  // El llamador garantiza leagues.length > 0; este guard satisface a TS.
  if (!activeLeague) return null;

  const supabase = await createClient();

  const [{ data: candidates }, { data: predictions }] = await Promise.all([
    supabase
      .from("award_candidates")
      .select("*")
      .order("category", { ascending: true })
      .order("display_order", { ascending: true }),
    supabase
      .from("special_predictions")
      .select("category, candidate_id")
      .eq("league_id", activeLeague.id)
      .eq("user_id", userId),
  ]);

  const candidatesByCategory = groupCandidatesByCategory(
    (candidates ?? []) as AwardCandidate[],
  );

  const initialSelections: Record<AwardCategory, string | null> = {
    champion: null,
    top_scorer: null,
    mvp: null,
  };
  for (const p of (predictions ?? []) as Pick<
    SpecialPrediction,
    "category" | "candidate_id"
  >[]) {
    initialSelections[p.category as AwardCategory] = p.candidate_id;
  }

  let isLocked = false;
  let activePhaseLabel = "Semifinales en adelante";
  try {
    const { data: activePhaseList, error: rpcError } = await supabase.rpc(
      "fn_get_active_tournament_phase",
    );
    if (rpcError) {
      throw rpcError;
    }
    const activePhase = activePhaseList?.[0];
    if (activePhase) {
      isLocked = activePhase.edits_locked;
      activePhaseLabel = activePhase.label;
    }
  } catch (err) {
    console.error("Error resolving tournament phase on server:", err);
    isLocked = true; // Fail closed for security
  }

  return (
    <>
      {leagues.length > 1 ? (
        <nav
          aria-label="Selecciona la liga"
          className="mb-5 flex flex-wrap gap-2"
        >
          {leagues.map((league) => {
            const isActive = league.id === activeLeague.id;
            return (
              <Link
                key={league.id}
                href={`/awards?league=${league.id}`}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  isActive
                    ? "border-[#E9C46A] bg-[#E9C46A]/10 text-[#E9C46A]"
                    : "border-white/15 text-white/70 hover:border-white/40",
                )}
              >
                {league.name}
              </Link>
            );
          })}
        </nav>
      ) : (
        <p className="mb-5 text-xs uppercase tracking-wide text-white/40">
          Liga: {activeLeague.name}
        </p>
      )}

      <AwardsBoard
        key={activeLeague.id}
        leagueId={activeLeague.id}
        candidatesByCategory={candidatesByCategory}
        initialSelections={initialSelections}
        isLocked={isLocked}
        activePhaseLabel={activePhaseLabel}
      />
    </>
  );
}
