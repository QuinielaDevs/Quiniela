import { Check } from "lucide-react";

import { cn } from "@/utils/utils";
import type { AwardCandidate } from "@/types";

interface CandidatePickerProps {
  candidates: AwardCandidate[];
  selectedId: string | null;
  /** Candidato cuyo guardado está en curso (muestra estado de carga). */
  pendingId: string | null;
  disabled: boolean;
  onSelect: (candidateId: string) => void;
}

/**
 * Listado presentacional de candidatos de UNA categoría. Cada item es un control
 * táctil ≥ 48x48px; el seleccionado se resalta con borde dorado (#E9C46A) y un
 * check verde turf (#10B981). No tiene estado propio: lo controla AwardsBoard.
 */
export function CandidatePicker({
  candidates,
  selectedId,
  pendingId,
  disabled,
  onSelect,
}: CandidatePickerProps) {
  if (candidates.length === 0) {
    return (
      <p className="px-1 py-3 text-sm text-white/60">
        Aún no hay favoritos disponibles.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {candidates.map((candidate) => {
        const isSelected = candidate.id === selectedId;
        const isPending = candidate.id === pendingId;

        return (
          <li key={candidate.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(candidate.id)}
              aria-pressed={isSelected}
              aria-label={`Elegir a ${candidate.name}${
                candidate.team_name ? ` (${candidate.team_name})` : ""
              }`}
              className={cn(
                "flex min-h-[48px] w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E9C46A]",
                "disabled:cursor-not-allowed disabled:opacity-60",
                isSelected
                  ? "border-[#E9C46A] bg-[#E9C46A]/10"
                  : "border-white/10 bg-[#1B263B] hover:border-white/30",
              )}
            >
              {candidate.flag_code ? (
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-white/5 text-xs font-semibold uppercase text-white/70"
                >
                  {candidate.flag_code}
                </span>
              ) : null}

              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium text-white">
                  {candidate.name}
                </span>
                {candidate.team_name ? (
                  <span className="truncate text-xs text-white/60">
                    {candidate.team_name}
                  </span>
                ) : null}
              </span>

              <span className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center">
                {isPending ? (
                  <span
                    aria-hidden
                    className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"
                  />
                ) : isSelected ? (
                  <Check
                    aria-hidden
                    className="h-5 w-5 text-[#10B981]"
                    strokeWidth={3}
                  />
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
