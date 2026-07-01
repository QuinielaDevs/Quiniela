"use client";

import { useState, useTransition } from "react";
import { resolveAwardWinner } from "@/app/actions/special-predictions.actions";
import { AwardSelector } from "@/components/awards/AwardSelector";
import type { AwardCandidate, AwardCategory } from "@/types";
import { cn } from "@/utils/utils";

interface AwardWinnerAdminListProps {
  candidates: AwardCandidate[];
  initialWinners: Record<AwardCategory, AwardCandidate | null>;
}

export function AwardWinnerAdminList({
  candidates,
  initialWinners,
}: AwardWinnerAdminListProps) {
  const [winners, setWinners] = useState<Record<AwardCategory, AwardCandidate | null>>(initialWinners);
  const [pendingCategory, setPendingCategory] = useState<AwardCategory | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successCategory, setSuccessCategory] = useState<AwardCategory | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSelect(category: AwardCategory, candidateId: string | null) {
    if (isPending) return;

    setError(null);
    setSuccessCategory(null);
    setPendingCategory(category);
    setPendingId(candidateId);

    startTransition(async () => {
      const result = await resolveAwardWinner(category, candidateId);

      if (result.success) {
        const found = candidates.find((c) => c.id === candidateId) || null;
        setWinners((prev) => ({ ...prev, [category]: found }));
        setSuccessCategory(category);
      } else {
        setError(result.error ?? "No se pudo actualizar el ganador.");
      }

      setPendingCategory(null);
      setPendingId(null);
    });
  }

  const categories: Array<{ key: AwardCategory; label: string }> = [
    { key: "champion", label: "Campeón Oficial" },
    { key: "top_scorer", label: "Goleador Oficial" },
    { key: "mvp", label: "MVP Oficial" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded bg-destructive/15 border border-destructive/30 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {categories.map(({ key, label }) => {
          const selected = winners[key];
          const isCatPending = pendingCategory === key;

          return (
            <details
              key={key}
              className="group rounded-md border border-border bg-card"
              data-category={key}
              data-testid="admin-award-card"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-sm font-semibold text-foreground marker:hidden">
                <div className="flex flex-col min-w-0">
                  <span className="font-bold">{label}</span>
                  <span className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {selected ? `Ganador: ${selected.name}` : "Sin resolver"}
                  </span>
                </div>
                <span className={cn(
                  "rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shrink-0",
                  selected ? "border border-success/30 bg-success/10 text-success" : "border border-border bg-background text-muted-foreground"
                )}>
                  {selected ? "Resuelto" : "Pendiente"}
                </span>
              </summary>
              <div className="flex flex-col gap-3 border-t border-border p-3">
                <AwardSelector
                  selectedCandidate={selected}
                  selectedId={selected?.id ?? null}
                  pendingId={isCatPending ? pendingId : null}
                  disabled={isPending}
                  onSelect={(candidateId) => handleSelect(key, candidateId)}
                  category={key}
                />
                
                {selected && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleSelect(key, null)}
                    className="mt-1 text-xs text-destructive hover:underline self-start font-medium"
                  >
                    Limpiar Ganador
                  </button>
                )}

                {successCategory === key && (
                  <p className="text-[11px] text-success font-semibold animate-pulse">
                    ✓ Ganador actualizado con éxito.
                  </p>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
