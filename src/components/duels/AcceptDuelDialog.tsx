"use client";

import React, { useState, useTransition } from "react";
import { X } from "lucide-react";
import { GoalPicker } from "@/components/predictions/GoalPicker";
import { Button } from "@/components/ui/button";
import { acceptChallenge } from "@/app/actions/duels.actions";
import { cn } from "@/utils/utils";

interface MatchInfo {
  id: string;
  home_team: string;
  away_team: string;
  match_time: string;
  status: string;
}

interface ChallengeInfo {
  id: string;
  points_bet: number;
  type: "direct" | "open";
  creator_id: string;
  match: MatchInfo;
}

interface AcceptDuelDialogProps {
  isOpen: boolean;
  onClose: () => void;
  challenge: ChallengeInfo | null;
  wagerBalance: number;
  onSuccess: () => void;
}

export function AcceptDuelDialog({
  isOpen,
  onClose,
  challenge,
  wagerBalance,
  onSuccess,
}: AcceptDuelDialogProps) {
  const [predictionHome, setPredictionHome] = useState(0);
  const [predictionAway, setPredictionAway] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !challenge) return null;

  const isBalanceInsufficient = challenge.points_bet > wagerBalance;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isBalanceInsufficient) {
      setError("Saldo insuficiente.");
      return;
    }

    setError(null);

    startTransition(async () => {
      const result = await acceptChallenge({
        challengeId: challenge.id,
        predictionHome,
        predictionAway,
      });

      if (result.success) {
        setPredictionHome(0);
        setPredictionAway(0);
        onSuccess();
        onClose();
      } else {
        setError(result.error ?? "No se pudo aceptar el desafío.");
      }
    });
  };

  const dateStr = new Date(challenge.match.match_time).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-md bg-card border border-border rounded-lg shadow-xl relative animate-in fade-in-50 zoom-in-95 duration-200 flex flex-col my-8">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="font-display text-lg font-bold text-accent">
            Aceptar Desafío
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded-full hover:bg-muted transition-colors"
            aria-label="Cerrar modal"
          >
            <X className="size-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Detalle del Partido */}
          <div className="bg-secondary/40 border border-border rounded-md p-4 space-y-2">
            <div className="text-xs uppercase font-bold text-muted-foreground tracking-wider">
              Detalle del Partido
            </div>
            <div className="text-base font-bold text-foreground">
              {challenge.match.home_team} vs {challenge.match.away_team}
            </div>
            <div className="text-xs text-muted-foreground">
              {dateStr}
            </div>
            <div className="pt-2 border-t border-border/40 flex justify-between items-center text-xs">
              <span className="text-muted-foreground font-semibold">Puntos en Juego:</span>
              <span className="text-accent font-bold text-sm">{challenge.points_bet} pts</span>
            </div>
          </div>

          {/* Saldo Disponible */}
          <div className="flex justify-between items-center text-xs px-1">
            <span className="text-muted-foreground uppercase font-semibold">Tu Saldo Disponible:</span>
            <span className="text-accent font-bold">{wagerBalance.toFixed(2)} pts</span>
          </div>

          {/* Advertencia Saldo Insuficiente */}
          {isBalanceInsufficient && (
            <div className="text-xs text-destructive font-semibold bg-destructive/10 border border-destructive/20 rounded-md p-3">
              Saldo insuficiente para unirse a este desafío (Disponible: {wagerBalance.toFixed(2)} pts)
            </div>
          )}

          {/* Predicción (GoalPicker) */}
          <div className="space-y-2.5 pt-2 border-t border-border/60">
            <label className="text-xs uppercase font-semibold text-muted-foreground block text-center">
              Ingresa tu Predicción de Marcador
            </label>
            <div className="flex items-center justify-around bg-secondary/20 border border-border rounded-md p-4">
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-xs font-bold text-foreground max-w-[100px] truncate text-center">
                  {challenge.match.home_team}
                </span>
                <GoalPicker
                  value={predictionHome}
                  onChange={setPredictionHome}
                  label={challenge.match.home_team}
                  disabled={isPending}
                />
              </div>
              <div className="font-display font-bold text-muted-foreground">vs</div>
              <div className="flex flex-col items-center gap-1.5">
                <span className="text-xs font-bold text-foreground max-w-[100px] truncate text-center">
                  {challenge.match.away_team}
                </span>
                <GoalPicker
                  value={predictionAway}
                  onChange={setPredictionAway}
                  label={challenge.match.away_team}
                  disabled={isPending}
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="text-sm font-semibold text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3">
              {error}
            </div>
          )}

          {/* Botón de Confirmación */}
          <div className="pt-2">
            <Button
              type="submit"
              disabled={isPending || isBalanceInsufficient}
              className={cn(
                "w-full h-12 font-extrabold text-base transition-colors",
                "bg-accent text-accent-foreground hover:bg-accent/90 focus-visible:ring-accent",
                "disabled:opacity-50 disabled:pointer-events-none"
              )}
            >
              {isPending ? "Aceptando Duelo..." : "Confirmar Predicción y Aceptar"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
