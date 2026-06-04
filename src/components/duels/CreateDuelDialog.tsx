"use client";

import React, { useState, useTransition } from "react";
import { X, Share2 } from "lucide-react";
import { GoalPicker } from "@/components/predictions/GoalPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createChallenge } from "@/app/actions/duels.actions";
import { cn } from "@/utils/utils";

interface MatchOption {
  id: string;
  home_team: string;
  away_team: string;
  match_time: string;
}

interface MemberOption {
  user_id: string;
  display_name: string;
}

interface CreateDuelDialogProps {
  isOpen: boolean;
  onClose: () => void;
  leagueId: string;
  wagerBalance: number;
  matches: MatchOption[];
  members: MemberOption[];
  onSuccess: () => void;
}

export function CreateDuelDialog({
  isOpen,
  onClose,
  leagueId,
  wagerBalance,
  matches,
  members,
  onSuccess,
}: CreateDuelDialogProps) {
  const [matchId, setMatchId] = useState("");
  const [type, setType] = useState<"direct" | "open">("direct");
  const [challengedId, setChallengedId] = useState("");
  const [pointsBet, setPointsBet] = useState<number>(10);
  const [predictionHome, setPredictionHome] = useState(0);
  const [predictionAway, setPredictionAway] = useState(0);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successChallengeId, setSuccessChallengeId] = useState<string | null>(null);

  if (!isOpen) return null;

  // Filtramos partidos programados
  const sortedMatches = [...matches].sort(
    (a, b) => new Date(a.match_time).getTime() - new Date(b.match_time).getTime()
  );

  // Filtramos miembros excluyendo al creador (se asume que no está en la lista de members o lo filtramos por context)
  const sortedMembers = [...members].sort((a, b) =>
    a.display_name.localeCompare(b.display_name)
  );

  const selectedMatch = matches.find((m) => m.id === matchId);

  const isBalanceInsufficient = pointsBet > wagerBalance;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchId) {
      setError("Por favor selecciona un partido.");
      return;
    }
    if (type === "direct" && !challengedId) {
      setError("Por favor selecciona un rival.");
      return;
    }
    if (pointsBet <= 0) {
      setError("La apuesta debe ser mayor que cero.");
      return;
    }
    if (isBalanceInsufficient) {
      setError("Saldo insuficiente.");
      return;
    }

    setError(null);

    startTransition(async () => {
      const result = await createChallenge({
        leagueId,
        matchId,
        type,
        challengedId: type === "direct" ? challengedId : null,
        pointsBet,
        predictionHome,
        predictionAway,
      });

      if (result.success && result.data) {
        setSuccessChallengeId(result.data);
        onSuccess();
      } else {
        setError(result.error ?? "No se pudo crear el desafío.");
      }
    });
  };

  const handleShareWhatsApp = () => {
    if (!selectedMatch) return;
    const isDirect = type === "direct";
    const rivalName = isDirect
      ? members.find((m) => m.user_id === challengedId)?.display_name ?? "un amigo"
      : "cualquiera de la liga";

    const text = isDirect
      ? `¡Te he retado a un duelo 1v1 en Pija Quiniela para el partido ${selectedMatch.home_team} vs ${selectedMatch.away_team}! Aposté ${pointsBet} pts. ¿Aceptas el reto? Entra aquí: ${window.location.origin}/duels`
      : `¡He creado un pozo abierto de ${pointsBet} pts para el partido ${selectedMatch.home_team} vs ${selectedMatch.away_team} en Pija Quiniela! Entra y demuestra tus conocimientos: ${window.location.origin}/duels`;

    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  const handleReset = () => {
    setMatchId("");
    setType("direct");
    setChallengedId("");
    setPointsBet(10);
    setPredictionHome(0);
    setPredictionAway(0);
    setError(null);
    setSuccessChallengeId(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="w-full max-w-md bg-card border border-border rounded-lg shadow-xl relative animate-in fade-in-50 zoom-in-95 duration-200 flex flex-col my-8">
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="font-display text-lg font-bold text-accent">
            {successChallengeId ? "¡Desafío Creado!" : "Crear Desafío"}
          </h2>
          <button
            onClick={handleReset}
            className="text-muted-foreground hover:text-foreground p-1 rounded-full hover:bg-muted transition-colors"
            aria-label="Cerrar modal"
          >
            <X className="size-5" />
          </button>
        </div>

        {successChallengeId ? (
          /* PANTALLA DE ÉXITO */
          <div className="p-6 flex flex-col items-center text-center space-y-4">
            <div className="size-16 rounded-full bg-success/20 flex items-center justify-center text-success border border-success/40 animate-bounce">
              <span className="text-2xl font-bold">✓</span>
            </div>
            <h3 className="font-display text-xl font-extrabold text-foreground">
              ¡Duelo listo para la acción!
            </h3>
            <p className="text-sm text-muted-foreground">
              Hemos retenido <strong className="text-accent">{pointsBet} pts</strong> en escrow.
              {type === "direct"
                ? " Tu oponente debe aceptar el reto antes del kickoff para activarlo."
                : " Cualquier miembro de la liga podrá unirse a este pozo abierto."}
            </p>

            {selectedMatch && (
              <div className="w-full bg-secondary/40 border border-border rounded-md p-3 text-sm space-y-1">
                <div className="text-xs text-muted-foreground">Partido seleccionado</div>
                <div className="font-semibold text-foreground">
                  {selectedMatch.home_team} vs {selectedMatch.away_team}
                </div>
                <div className="text-xs text-accent">
                  Tu predicción: {predictionHome} - {predictionAway}
                </div>
              </div>
            )}

            <div className="pt-4 w-full space-y-2">
              <Button
                onClick={handleShareWhatsApp}
                className="w-full bg-success hover:bg-success/90 text-white font-bold h-12 flex items-center justify-center gap-2"
              >
                <Share2 className="size-5" />
                Compartir en WhatsApp
              </Button>
              <Button
                onClick={handleReset}
                variant="outline"
                className="w-full h-12 border-border"
              >
                Volver a Duelos
              </Button>
            </div>
          </div>
        ) : (
          /* FORMULARIO DE CREACIÓN */
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Selector de Partido */}
            <div className="space-y-1.5">
              <Label htmlFor="match-select" className="text-xs uppercase font-semibold text-muted-foreground">
                Partido de la Quiniela
              </Label>
              <select
                id="match-select"
                value={matchId}
                onChange={(e) => setMatchId(e.target.value)}
                required
                className="flex h-12 w-full items-center justify-between rounded-sm border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 text-foreground"
              >
                <option value="" disabled>Selecciona un partido...</option>
                {sortedMatches.map((m) => {
                  const dateStr = new Date(m.match_time).toLocaleDateString("es-ES", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  return (
                    <option key={m.id} value={m.id}>
                      {m.home_team} vs {m.away_team} ({dateStr})
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Tipo de Reto */}
            <div className="space-y-1.5">
              <Label className="text-xs uppercase font-semibold text-muted-foreground block">
                Tipo de Reto
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setType("direct")}
                  className={cn(
                    "h-12 border rounded-sm font-semibold transition-all text-sm",
                    type === "direct"
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  )}
                >
                  Directo (1v1)
                </button>
                <button
                  type="button"
                  onClick={() => setType("open")}
                  className={cn(
                    "h-12 border rounded-sm font-semibold transition-all text-sm",
                    type === "open"
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border bg-card text-muted-foreground hover:text-foreground"
                  )}
                >
                  Abierto (Grupal)
                </button>
              </div>
            </div>

            {/* Rival (solo Directo) */}
            {type === "direct" && (
              <div className="space-y-1.5">
                <Label htmlFor="rival-select" className="text-xs uppercase font-semibold text-muted-foreground">
                  Rival del Desafío
                </Label>
                <select
                  id="rival-select"
                  value={challengedId}
                  onChange={(e) => setChallengedId(e.target.value)}
                  required={type === "direct"}
                  className="flex h-12 w-full items-center justify-between rounded-sm border border-input bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 text-foreground"
                >
                  <option value="" disabled>Selecciona un rival...</option>
                  {sortedMembers.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.display_name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Apuesta de Puntos */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <Label htmlFor="points-bet" className="text-xs uppercase font-semibold text-muted-foreground">
                  Puntos a Apostar
                </Label>
                <span className="text-xs text-muted-foreground">
                  Disponible: <strong className="text-accent">{wagerBalance.toFixed(2)} pts</strong>
                </span>
              </div>
              <Input
                id="points-bet"
                type="number"
                min={1}
                value={pointsBet}
                onChange={(e) => setPointsBet(Math.max(1, parseInt(e.target.value) || 0))}
                required
                className="h-12 bg-card border-border text-foreground"
              />
              {isBalanceInsufficient && (
                <p className="text-xs text-destructive font-semibold">
                  Saldo insuficiente para realizar esta apuesta (Disponible: {wagerBalance.toFixed(2)} pts)
                </p>
              )}
            </div>

            {/* Predicción (GoalPicker) */}
            <div className="space-y-2.5 pt-2 border-t border-border/60">
              <Label className="text-xs uppercase font-semibold text-muted-foreground block text-center">
                Tu Predicción de Marcador
              </Label>
              <div className="flex items-center justify-around bg-secondary/20 border border-border rounded-md p-4">
                <div className="flex flex-col items-center gap-1.5">
                  <span className="text-xs font-bold text-foreground max-w-[100px] truncate text-center">
                    {selectedMatch ? selectedMatch.home_team : "Local"}
                  </span>
                  <GoalPicker
                    value={predictionHome}
                    onChange={setPredictionHome}
                    label="Equipo Local"
                    disabled={isPending}
                  />
                </div>
                <div className="font-display font-bold text-muted-foreground">vs</div>
                <div className="flex flex-col items-center gap-1.5">
                  <span className="text-xs font-bold text-foreground max-w-[100px] truncate text-center">
                    {selectedMatch ? selectedMatch.away_team : "Visitante"}
                  </span>
                  <GoalPicker
                    value={predictionAway}
                    onChange={setPredictionAway}
                    label="Equipo Visitante"
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

            {/* Botón de Enviar */}
            <div className="pt-2">
              <Button
                type="submit"
                disabled={isPending || isBalanceInsufficient || !matchId}
                className={cn(
                  "w-full h-12 font-extrabold text-base transition-colors",
                  "bg-accent text-accent-foreground hover:bg-accent/90 focus-visible:ring-accent",
                  "disabled:opacity-50 disabled:pointer-events-none"
                )}
              >
                {isPending ? "Creando Desafío..." : "Confirmar Desafío"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
