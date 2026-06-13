"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setMatchResult } from "@/app/actions/matches.actions";
import { GoalPicker } from "@/components/predictions/GoalPicker";
import { flagForTeamCode } from "@/utils/team-flags";
import { cn } from "@/utils/utils";
import type { MatchStatus } from "@/types";

// Vista de un partido en el panel admin (Story 7.2). La página servidor mapea los
// datos crudos de public.matches.
export type AdminMatchView = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamCode: string | null;
  awayTeamCode: string | null;
  matchTime: string; // ISO 8601 UTC
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  groupLabel: string | null;
  matchday: number | null;
};

type MatchAdminListProps = {
  matches: AdminMatchView[];
};

// Etiquetas de estado (Championship Gold). Espeja MatchStatus.
const STATUS_LABEL: Record<MatchStatus, string> = {
  scheduled: "Programado",
  live: "En vivo",
  finished: "Finalizado",
  suspended: "Suspendido",
  canceled: "Cancelado",
};

// Transiciones permitidas por estado de ORIGEN (espeja fn_admin_set_match_result).
// El RPC re-valida; esto solo evita ofrecer destinos sin sentido en la UI.
const ALLOWED_TRANSITIONS: Record<MatchStatus, MatchStatus[]> = {
  scheduled: ["scheduled", "live", "finished", "suspended", "canceled"],
  live: ["scheduled", "live", "finished", "suspended", "canceled"],
  finished: ["finished", "live"],
  suspended: ["scheduled", "live", "finished", "suspended", "canceled"],
  canceled: ["scheduled", "canceled"],
};

/** Un estado lleva marcador editable (live/finished). */
function statusUsesScore(status: MatchStatus): boolean {
  return status === "live" || status === "finished";
}

export function MatchAdminList({ matches }: MatchAdminListProps) {
  if (matches.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-center text-card-foreground">
        <h2 className="font-display text-lg font-bold">Sin partidos</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Aún no hay partidos disponibles para gestionar resultados.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {matches.map((match) => (
        <MatchAdminCard key={match.id} match={match} />
      ))}
    </ul>
  );
}

function MatchAdminCard({ match }: { match: AdminMatchView }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  // Estado editable local, sembrado de las props. Se reconcilia con la verdad del
  // servidor al terminar la transición (patrón MemberAdminList).
  const [status, setStatus] = useState<MatchStatus>(match.status);
  const [homeScore, setHomeScore] = useState<number>(match.homeScore ?? 0);
  const [awayScore, setAwayScore] = useState<number>(match.awayScore ?? 0);

  useEffect(() => {
    if (isPending) return;
    setStatus(match.status);
    setHomeScore(match.homeScore ?? 0);
    setAwayScore(match.awayScore ?? 0);
  }, [match.status, match.homeScore, match.awayScore, isPending]);

  // Destinos válidos relativos al estado PERSISTIDO (origen).
  const statusOptions = useMemo(
    () => ALLOWED_TRANSITIONS[match.status],
    [match.status],
  );

  const showScore = statusUsesScore(status);

  const localTime = useMemo(
    () =>
      new Date(match.matchTime).toLocaleString("es", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [match.matchTime],
  );

  const dirty =
    status !== match.status ||
    (showScore &&
      (homeScore !== (match.homeScore ?? 0) ||
        awayScore !== (match.awayScore ?? 0)));

  function executeSave() {
    setError(null);
    setWarning(null);
    startTransition(async () => {
      const result = await setMatchResult({
        matchId: match.id,
        homeScore: showScore ? homeScore : null,
        awayScore: showScore ? awayScore : null,
        status,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setWarning(result.warning ?? null);
      router.refresh();
    });
  }

  function save() {
    const isDestructive = match.status === "finished" && status !== "finished";
    if (isDestructive) {
      setShowConfirm(true);
    } else {
      executeSave();
    }
  }

  return (
    <li
      data-testid="match-admin-row"
      data-match-id={match.id}
      className="flex flex-col gap-3 rounded-md border border-border bg-card p-3 relative"
    >
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-md border border-border bg-card p-5 shadow-2xl space-y-4">
            <h3 className="font-display text-lg font-bold text-white">¿Confirmar cambio destructivo?</h3>
            <p className="text-sm text-muted-foreground">
              Estás revirtiendo un partido finalizado. Esto recalculará de inmediato las posiciones oficiales de la liga y podría remover los puntos acumulados por los usuarios.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowConfirm(false);
                  executeSave();
                }}
                className="flex-1 rounded-sm bg-destructive px-4 py-2.5 text-sm font-semibold text-white hover:bg-destructive/90"
              >
                Sí, cambiar
              </button>
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="flex-1 rounded-sm border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-secondary/80"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Cabecera: equipos + metadatos */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {flagForTeamCode(match.homeTeamCode) && (
              <span aria-hidden="true">
                {flagForTeamCode(match.homeTeamCode)}{" "}
              </span>
            )}
            {match.homeTeam}{" "}
            <span className="text-muted-foreground">vs</span> {match.awayTeam}
            {flagForTeamCode(match.awayTeamCode) && (
              <span aria-hidden="true">
                {" "}
                {flagForTeamCode(match.awayTeamCode)}
              </span>
            )}
          </p>
          <p
            className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground"
            suppressHydrationWarning
          >
            {match.groupLabel ? `Grupo ${match.groupLabel} · ` : ""}
            {match.matchday ? `J${match.matchday} · ` : ""}
            {localTime}
          </p>
        </div>
        <StatusBadge status={match.status} />
      </div>

      {/* Editor de marcador (solo si el estado destino lleva marcador) */}
      {showScore && (
        <div className="flex items-center justify-center gap-4">
          <GoalPicker
            value={homeScore}
            onChange={setHomeScore}
            label={match.homeTeam}
            disabled={isPending}
            max={99}
            side="home"
            testId="admin-home-score"
          />
          <span className="font-display text-lg text-muted-foreground">–</span>
          <GoalPicker
            value={awayScore}
            onChange={setAwayScore}
            label={match.awayTeam}
            disabled={isPending}
            max={99}
            side="away"
            testId="admin-away-score"
          />
        </div>
      )}

      {/* Selector de estado + guardar */}
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`status-${match.id}`}>
          Estado del partido {match.homeTeam} vs {match.awayTeam}
        </label>
        <select
          id={`status-${match.id}`}
          data-testid="admin-status-select"
          value={status}
          onChange={(e) => setStatus(e.target.value as MatchStatus)}
          disabled={isPending}
          className="h-12 flex-1 rounded-sm border border-border bg-background px-3 text-sm font-semibold text-foreground disabled:opacity-50"
        >
          {statusOptions.map((option) => (
            <option key={option} value={option}>
              {STATUS_LABEL[option]}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={save}
          disabled={isPending || !dirty}
          data-testid="admin-save-result"
          className={cn(
            "inline-flex h-12 min-w-[88px] items-center justify-center rounded-sm px-4 text-sm font-semibold disabled:opacity-40",
            "bg-primary text-primary-foreground",
          )}
        >
          {isPending ? "Guardando…" : "Guardar"}
        </button>
      </div>

      {error && (
        <p
          role="status"
          data-testid="admin-result-error"
          className="rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {warning && (
        <p
          role="status"
          className="rounded-sm border border-accent/50 bg-accent/10 px-3 py-2 text-sm text-accent"
        >
          {warning}
        </p>
      )}
    </li>
  );
}

function StatusBadge({ status }: { status: MatchStatus }) {
  const styles: Record<MatchStatus, string> = {
    scheduled: "border-border bg-secondary text-muted-foreground",
    live: "border-accent bg-accent/15 text-accent",
    finished: "border-success bg-success/15 text-success",
    suspended: "border-border bg-secondary text-muted-foreground",
    canceled: "border-destructive bg-destructive/15 text-destructive",
  };
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        styles[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
