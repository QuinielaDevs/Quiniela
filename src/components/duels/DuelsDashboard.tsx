"use client";

import React, { useState, useEffect, useTransition, useRef, useCallback } from "react";
import { Plus, Trophy, Coins, Calendar, User, UserPlus, History, Share2 } from "lucide-react";
import { CreateDuelDialog } from "./CreateDuelDialog";
import { AcceptDuelDialog } from "./AcceptDuelDialog";
import { rejectChallenge, cancelChallenge } from "@/app/actions/duels.actions";
import { Button } from "@/components/ui/button";
import { createClient } from "@/utils/supabase/client";
import { cn } from "@/utils/utils";
import { useRouter } from "next/navigation";

interface MatchInfo {
  id: string;
  home_team: string;
  away_team: string;
  match_time: string;
  status: string;
  home_score?: number | null;
  away_score?: number | null;
}

interface Participant {
  user_id: string;
  prediction_home: number;
  prediction_away: number;
}

export interface Challenge {
  id: string;
  points_bet: number;
  type: "direct" | "open";
  status: "pending" | "active" | "completed" | "canceled";
  creator_id: string;
  challenged_id: string | null;
  winner_ids: string[] | null;
  created_at: string;
  match: MatchInfo;
  challenge_participants: Participant[];
}

interface MemberInfo {
  user_id: string;
  display_name: string;
}

interface DuelsDashboardProps {
  leagueId: string;
  wagerBalance: number;
  initialActiveChallenges: Challenge[];
  matches: MatchInfo[];
  members: MemberInfo[];
  currentUserId: string;
}

export function DuelsDashboard({
  leagueId,
  wagerBalance,
  initialActiveChallenges,
  matches,
  members,
  currentUserId,
}: DuelsDashboardProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"active" | "history">("active");
  const [activeChallenges, setActiveChallenges] = useState<Challenge[]>(initialActiveChallenges);
  const [historyChallenges, setHistoryChallenges] = useState<Challenge[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedChallenge, setSelectedChallenge] = useState<Challenge | null>(null);
  const [isAcceptOpen, setIsAcceptOpen] = useState(false);
  const [isActionPending, startActionTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const requestCountRef = useRef(0);

  const loadHistory = useCallback(async () => {
    const requestId = ++requestCountRef.current;
    setIsHistoryLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("challenges")
        .select(`
          id,
          points_bet,
          type,
          status,
          creator_id,
          challenged_id,
          winner_ids,
          created_at,
          match:matches(id, home_team, away_team, match_time, status, home_score, away_score),
          challenge_participants(user_id, prediction_home, prediction_away)
        `)
        .eq("league_id", leagueId)
        .in("status", ["completed", "canceled"])
        .order("created_at", { ascending: false });

      if (requestId !== requestCountRef.current) return;

      if (!error && data) {
        setHistoryChallenges(data as unknown as Challenge[]);
      }
    } catch (err) {
      console.error("Error al cargar retos históricos:", err);
    } finally {
      if (requestId === requestCountRef.current) {
        setIsHistoryLoading(false);
      }
    }
  }, [leagueId]);

  // Sincronizar retos iniciales si cambian en el server
  useEffect(() => {
    setActiveChallenges(initialActiveChallenges);
  }, [initialActiveChallenges]);

  // Carga de retos históricos bajo demanda
  useEffect(() => {
    if (activeTab === "history" && historyChallenges.length === 0) {
      void loadHistory();
    }
  }, [activeTab, historyChallenges.length, loadHistory]);

  const handleCreateSuccess = () => {
    // Forzamos actualización de datos del servidor (saldo, retos activos, etc.)
    router.refresh();
  };

  const handleOpenAccept = (challenge: Challenge) => {
    setActionError(null);
    setSelectedChallenge(challenge);
    setIsAcceptOpen(true);
  };

  const handleAcceptSuccess = () => {
    router.refresh();
  };

  const handleReject = (challengeId: string) => {
    setActionError(null);
    startActionTransition(async () => {
      const result = await rejectChallenge({ challengeId });
      if (result.success) {
        router.refresh();
      } else {
        setActionError(result.error ?? "No se pudo rechazar el desafío.");
      }
    });
  };

  const handleCancel = (challengeId: string) => {
    setActionError(null);
    startActionTransition(async () => {
      const result = await cancelChallenge({ challengeId });
      if (result.success) {
        router.refresh();
      } else {
        setActionError(result.error ?? "No se pudo cancelar el desafío.");
      }
    });
  };

  // Creación de diccionario de nombres de miembros para mapeo rápido
  const memberMap = new Map<string, string>();
  members.forEach((m) => {
    memberMap.set(m.user_id, m.display_name);
  });
  // Nombre del usuario actual
  const currentUserName = "Tú";

  const getMemberName = (userId: string) => {
    if (userId === currentUserId) return currentUserName;
    return memberMap.get(userId) || "Usuario Quiniela";
  };

  const handleShareWhatsApp = (challenge: Challenge) => {
    const isDirect = challenge.type === "direct";
    const rivalName = isDirect && challenge.challenged_id
      ? getMemberName(challenge.challenged_id)
      : "un amigo";

    const text = isDirect
      ? `¡Ey ${rivalName}! Te he retado a un duelo 1v1 en PIJA Quiniela para el partido ${challenge.match.home_team} vs ${challenge.match.away_team} 🏆. Aposté ${challenge.points_bet} pts de mi saldo. ¿Aceptas el reto o te da miedo perder? Entra aquí para responder: ${window.location.origin}/desafio/${challenge.id}`
      : `¡Atención grupo! He creado un pozo abierto de ${challenge.points_bet} pts para el partido ${challenge.match.home_team} vs ${challenge.match.away_team} en PIJA Quiniela 💥. ¡Entren y demuestren quién es el verdadero Nostradamus de la liga!: ${window.location.origin}/desafio/${challenge.id}`;

    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  // Clasificación de retos activos
  const pendingReceived = activeChallenges.filter(
    (c) => c.status === "pending" && c.type === "direct" && c.challenged_id === currentUserId
  );

  const pendingSent = activeChallenges.filter(
    (c) => c.status === "pending" && c.creator_id === currentUserId
  );

  const openPools = activeChallenges.filter(
    (c) => c.status === "pending" && c.type === "open" && c.creator_id !== currentUserId
  );

  const inGame = activeChallenges.filter((c) => c.status === "active");

  const renderChallengeCard = (challenge: Challenge) => {
    const creatorName = getMemberName(challenge.creator_id);
    const rivalName = challenge.challenged_id
      ? getMemberName(challenge.challenged_id)
      : "Abierto";

    const creatorPred = challenge.challenge_participants.find(
      (p) => p.user_id === challenge.creator_id
    );
    const rivalPred = challenge.challenged_id
      ? challenge.challenge_participants.find((p) => p.user_id === challenge.challenged_id)
      : null;

    const dateStr = new Date(challenge.match.match_time).toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });

    const isCompleted = challenge.status === "completed";
    const isCanceled = challenge.status === "canceled";
    const wonChallenge = challenge.winner_ids && challenge.winner_ids.includes(currentUserId);
    const lostChallenge = challenge.winner_ids && !wonChallenge && challenge.winner_ids.length > 0;
    const tieChallenge = challenge.winner_ids && challenge.winner_ids.length > 1;

    return (
      <div
        key={challenge.id}
        data-testid="duel-card"
        data-challenge-id={challenge.id}
        data-status={challenge.status}
        className={cn(
          "rounded-md border border-border bg-card p-4 flex flex-col gap-3 relative transition-all",
          challenge.status === "active" && "border-primary/45 shadow-sm",
          isCompleted && wonChallenge && "border-success bg-success/5",
          isCompleted && lostChallenge && "border-border opacity-85"
        )}
      >
        {/* Cabecera del Reto */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-accent">
            <Coins className="size-3.5" />
            <span>{challenge.points_bet} pts</span>
          </div>

          <div
            className={cn(
              "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
              challenge.status === "pending" && "bg-secondary text-accent-foreground border border-accent/20",
              challenge.status === "active" && "bg-primary/20 text-primary border border-primary/45",
              isCompleted && wonChallenge && "bg-success/20 text-success border border-success/40",
              isCompleted && lostChallenge && "bg-muted text-muted-foreground",
              isCanceled && "bg-destructive/20 text-destructive"
            )}
          >
            {challenge.status === "pending" && "Pendiente"}
            {challenge.status === "active" && "En Juego"}
            {isCompleted && wonChallenge && (tieChallenge ? "Empate" : "Ganado")}
            {isCompleted && lostChallenge && "Perdido"}
            {isCanceled && "Cancelado"}
          </div>
        </div>

        {/* Rivalidad */}
        <div className="flex items-center gap-2 py-1 border-y border-border/40">
          <User className="size-4 text-muted-foreground" />
          <span className="text-xs text-foreground font-medium">
            <strong>{creatorName}</strong> vs <strong>{rivalName}</strong>
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
            {challenge.type === "direct" ? "1v1" : "Abierto"}
          </span>
        </div>

        {/* Partido */}
        <div className="flex flex-col gap-1">
          <span className="text-sm font-bold text-foreground">
            {challenge.match.home_team} vs {challenge.match.away_team}
          </span>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="size-3.5" />
            <span>{dateStr}</span>
          </div>
        </div>

        {/* Predicciones */}
        <div className="bg-secondary/20 rounded-md p-2 text-xs space-y-1.5 border border-border/40">
          <div className="flex justify-between items-center text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
            <span>Predicciones</span>
            {isCompleted && (
              <span className="text-accent text-[11px] normal-case">
                Resultado: {challenge.match.home_score} - {challenge.match.away_score}
              </span>
            )}
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground font-medium">{creatorName}:</span>
            <span className="font-bold text-foreground font-display">
              {creatorPred ? `${creatorPred.prediction_home} - ${creatorPred.prediction_away}` : "—"}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground font-medium">{rivalName}:</span>
            <span className="font-bold text-foreground font-display">
              {challenge.status === "pending"
                ? "Esperando rival..."
                : rivalPred
                  ? `${rivalPred.prediction_home} - ${rivalPred.prediction_away}`
                  : "—"}
            </span>
          </div>
        </div>

        {/* Acciones del Desafío */}
        {challenge.status === "pending" && (
          <div className="flex gap-2 mt-1">
            {challenge.type === "direct" && challenge.challenged_id === currentUserId && (
              <>
                <Button
                  onClick={() => handleOpenAccept(challenge)}
                  disabled={isActionPending}
                  size="sm"
                  data-testid="accept-duel-button"
                  className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90 font-bold"
                >
                  Aceptar
                </Button>
                <Button
                  onClick={() => handleReject(challenge.id)}
                  disabled={isActionPending}
                  variant="outline"
                  size="sm"
                  data-testid="reject-duel-button"
                  className="flex-1 border-border text-destructive hover:bg-destructive/10 font-bold"
                >
                  Rechazar
                </Button>
              </>
            )}
            {challenge.type === "open" && challenge.creator_id !== currentUserId && (
              <Button
                onClick={() => handleOpenAccept(challenge)}
                disabled={isActionPending}
                size="sm"
                data-testid="join-pool-button"
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90 font-bold"
              >
                Unirse al Pozo
              </Button>
            )}
            {challenge.creator_id === currentUserId && (
              <div className="flex gap-2 w-full">
                <Button
                  onClick={() => handleShareWhatsApp(challenge)}
                  variant="outline"
                  size="sm"
                  className="flex-1 border-border text-success hover:bg-success/10 font-bold flex items-center justify-center gap-1.5"
                >
                  <Share2 className="size-4" />
                  Compartir en WhatsApp
                </Button>
                <Button
                  onClick={() => handleCancel(challenge.id)}
                  disabled={isActionPending}
                  variant="outline"
                  size="sm"
                  data-testid="cancel-duel-button"
                  className="flex-1 border-border text-destructive hover:bg-destructive/10 font-bold"
                >
                  Cancelar
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4" data-testid="duels-dashboard">
      {/* Saldo y CTA */}
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">
              Saldo para Apuestas
            </span>
            <div className="flex items-baseline gap-1 text-accent font-display">
              <span className="text-3xl font-extrabold" data-testid="duel-balance">{wagerBalance.toFixed(2)}</span>
              <span className="text-sm font-semibold">pts</span>
            </div>
          </div>
          <div className="size-12 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-accent">
            <Trophy className="size-6" />
          </div>
        </div>

        <Button
          onClick={() => setIsCreateOpen(true)}
          data-testid="create-duel-button"
          className="w-full bg-accent text-accent-foreground hover:bg-accent/90 font-bold h-12 flex items-center justify-center gap-1.5"
        >
          <Plus className="size-5" />
          Crear Desafío
        </Button>
      </div>

      {actionError && (
        <div className="text-sm font-semibold text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3">
          {actionError}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab("active")}
          className={cn(
            "flex-1 py-3 text-sm font-bold border-b-2 transition-all flex items-center justify-center gap-1.5",
            activeTab === "active"
              ? "border-accent text-accent"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Coins className="size-4" />
          Activos y Pendientes
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={cn(
            "flex-1 py-3 text-sm font-bold border-b-2 transition-all flex items-center justify-center gap-1.5",
            activeTab === "history"
              ? "border-accent text-accent"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <History className="size-4" />
          Historial
        </button>
      </div>

      {/* Contenido de las Tabs */}
      {activeTab === "active" ? (
        /* PANEL ACTIVO */
        <div className="space-y-6">
          {activeChallenges.length === 0 ? (
            <div className="rounded-md border border-border bg-card p-6 text-center text-card-foreground">
              <h3 className="font-display text-lg font-bold text-foreground">Sin duelos activos</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                No tienes apuestas activas. ¡Reta a un amigo para subir la emoción!
              </p>
            </div>
          ) : (
            <>
              {/* 1. Retos Recibidos (Requieren acción del usuario) */}
              {pendingReceived.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="text-xs uppercase font-bold text-primary tracking-wider flex items-center gap-1">
                    <UserPlus className="size-4" />
                    Retos Recibidos
                  </h3>
                  <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                    {pendingReceived.map(renderChallengeCard)}
                  </div>
                </div>
              )}

              {/* 2. Pozos Abiertos (Disponibles para unirse) */}
              {openPools.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="text-xs uppercase font-bold text-accent tracking-wider flex items-center gap-1">
                    <Coins className="size-4" />
                    Pozos Abiertos del Grupo
                  </h3>
                  <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                    {openPools.map(renderChallengeCard)}
                  </div>
                </div>
              )}

              {/* 3. En Juego (Activos) */}
              {inGame.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="text-xs uppercase font-bold text-success tracking-wider flex items-center gap-1">
                    <Trophy className="size-4" />
                    Duelos En Juego
                  </h3>
                  <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                    {inGame.map(renderChallengeCard)}
                  </div>
                </div>
              )}

              {/* 4. Retos Enviados (Esperando respuesta) */}
              {pendingSent.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="text-xs uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-1">
                    <History className="size-4" />
                    Retos Enviados (Pendientes)
                  </h3>
                  <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                    {pendingSent.map(renderChallengeCard)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        /* PANEL HISTORIAL */
        <div className="space-y-4">
          {isHistoryLoading ? (
            <div className="flex flex-col gap-3">
              {[0, 1].map((i) => (
                <div key={i} className="h-44 animate-pulse rounded-md border border-border bg-card" />
              ))}
            </div>
          ) : historyChallenges.length === 0 ? (
            <div className="rounded-md border border-border bg-card p-6 text-center text-card-foreground">
              <h3 className="font-display text-lg font-bold text-foreground">Historial vacío</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                No tienes duelos finalizados ni cancelados en esta liga.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{historyChallenges.map(renderChallengeCard)}</div>
          )}
        </div>
      )}

      {/* Modal de Creación */}
      <CreateDuelDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        leagueId={leagueId}
        wagerBalance={wagerBalance}
        matches={matches}
        members={members}
        onSuccess={handleCreateSuccess}
      />

      {/* Modal de Aceptación */}
      <AcceptDuelDialog
        isOpen={isAcceptOpen}
        onClose={() => {
          setIsAcceptOpen(false);
          setSelectedChallenge(null);
        }}
        challenge={selectedChallenge}
        wagerBalance={wagerBalance}
        onSuccess={handleAcceptSuccess}
      />
    </div>
  );
}
