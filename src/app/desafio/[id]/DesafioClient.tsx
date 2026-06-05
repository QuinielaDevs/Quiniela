"use client";

import React, { useState, useTransition } from "react";
import { Coins, Calendar, Trophy, ShieldAlert, Share2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { GoogleSignInButton } from "@/components/google-signin-button";
import { AcceptDuelDialog } from "@/components/duels/AcceptDuelDialog";
import { Button } from "@/components/ui/button";
import { rejectChallenge, cancelChallenge } from "@/app/actions/duels.actions";
import { joinLeagueByInvite } from "@/app/actions/leagues.actions";
import { cn } from "@/utils/utils";

interface ChallengeDetails {
  challenge_id: string;
  points_bet: number;
  type: string;
  status: string;
  league_id: string;
  league_name: string;
  invite_code: string | null;
  creator_id: string;
  creator_display_name: string;
  creator_avatar_url: string | null;
  challenged_id: string | null;
  challenged_display_name: string | null;
  match_id: string;
  home_team: string;
  away_team: string;
  home_team_code: string | null;
  away_team_code: string | null;
  match_time: string;
  match_status: string;
  creator_prediction_home: number | null;
  creator_prediction_away: number | null;
  challenged_prediction_home: number | null;
  challenged_prediction_away: number | null;
}

interface DesafioClientProps {
  challenge: ChallengeDetails;
  currentUserId: string | null;
  isMember: boolean;
  wagerBalance: number;
}

export function DesafioClient({
  challenge,
  currentUserId,
  isMember,
  wagerBalance,
}: DesafioClientProps) {
  const router = useRouter();
  const [isAcceptOpen, setIsAcceptOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isCreator = currentUserId === challenge.creator_id;
  const isChallenged = currentUserId && challenge.challenged_id === currentUserId;

  // Determinar si el usuario actual es un participante del pozo abierto
  // Para los pozos abiertos en el RPC, si el usuario ya se unió, p_challenged.id se resuelve a su user_id,
  // por lo que challenged_id === currentUserId significa que el usuario es el participante.
  const isParticipantOfOpenPool = challenge.type === "open" && isChallenged;

  const dateStr = new Date(challenge.match_time).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  const handleJoinLeague = () => {
    if (!challenge.invite_code) return;
    setActionError(null);
    startTransition(async () => {
      const result = await joinLeagueByInvite(challenge.invite_code!);
      if (result.success) {
        router.refresh();
      } else {
        setActionError(result.error ?? "No se pudo unir a la liga.");
      }
    });
  };

  const handleReject = () => {
    setActionError(null);
    startTransition(async () => {
      const result = await rejectChallenge({ challengeId: challenge.challenge_id });
      if (result.success) {
        router.refresh();
      } else {
        setActionError(result.error ?? "No se pudo rechazar el desafío.");
      }
    });
  };

  const handleCancel = () => {
    setActionError(null);
    startTransition(async () => {
      const result = await cancelChallenge({ challengeId: challenge.challenge_id });
      if (result.success) {
        router.refresh();
      } else {
        setActionError(result.error ?? "No se pudo cancelar el desafío.");
      }
    });
  };

  const handleShareWhatsApp = () => {
    const isDirect = challenge.type === "direct";
    const rivalName = isDirect && challenge.challenged_display_name
      ? challenge.challenged_display_name
      : "un amigo";

    const text = isDirect
      ? `¡Ey ${rivalName}! Te he retado a un duelo 1v1 en PIJA Quiniela para el partido ${challenge.home_team} vs ${challenge.away_team} 🏆. Aposté ${challenge.points_bet} pts de mi saldo. ¿Aceptas el reto o te da miedo perder? Entra aquí para responder: ${window.location.origin}/desafio/${challenge.challenge_id}`
      : `¡Atención grupo! He creado un pozo abierto de ${challenge.points_bet} pts para el partido ${challenge.home_team} vs ${challenge.away_team} en PIJA Quiniela 💥. ¡Entren y demuestren quién es el verdadero Nostradamus de la liga!: ${window.location.origin}/desafio/${challenge.challenge_id}`;

    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  const handleAcceptSuccess = () => {
    router.refresh();
  };

  // Convertir estructura de challenge a formato esperado por AcceptDuelDialog
  const acceptChallengeInfo = {
    id: challenge.challenge_id,
    points_bet: challenge.points_bet,
    type: challenge.type as "direct" | "open",
    creator_id: challenge.creator_id,
    match: {
      id: challenge.match_id,
      home_team: challenge.home_team,
      away_team: challenge.away_team,
      match_time: challenge.match_time,
      status: challenge.match_status,
    },
  };

  const isCompleted = challenge.status === "completed";
  const isActive = challenge.status === "active";
  const isCanceled = challenge.status === "canceled";
  const isPendingChallenge = challenge.status === "pending";

  return (
    <div className="w-full max-w-md mx-auto min-h-svh bg-[#0D1B2A] text-white flex flex-col font-sans pb-16">
      {/* Navbar Superior */}
      <header className="flex items-center justify-between px-4 py-4 border-b border-border/10 bg-[#0D1B2A]/90 backdrop-blur sticky top-0 z-10">
        <Link href="/duels" className="text-muted-foreground hover:text-white flex items-center gap-1 text-sm font-semibold transition-colors">
          <ArrowLeft className="size-4" />
          Duelos
        </Link>
        <span className="font-display font-bold text-accent text-sm tracking-wide uppercase">PIJA Quiniela</span>
        <div className="w-12"></div> {/* Espaciador */}
      </header>

      <main className="flex-1 px-4 py-6 space-y-6 flex flex-col justify-center">
        {/* Encabezado del Reto */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-[#1B263B] border border-border/20 text-[#E9C46A]">
            <Coins className="size-3.5" />
            <span>Apuesta: {challenge.points_bet} pts</span>
          </div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">
            {challenge.type === "direct" ? "Duelo Directo 1v1" : "Pozo Abierto"}
          </h1>
          <p className="text-xs text-muted-foreground">
            Liga: <span className="text-white font-semibold">{challenge.league_name}</span>
          </p>
        </div>

        {/* Tarjeta de Duelo */}
        <div className="bg-[#1B263B] border border-border/10 rounded-lg p-5 space-y-4 shadow-xl">
          {/* Cabecera del partido y tiempo */}
          <div className="flex flex-col gap-1.5 text-center pb-3 border-b border-border/10">
            <span className="text-[11px] text-muted-foreground uppercase font-bold tracking-wider">Fecha del Encuentro</span>
            <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-300">
              <Calendar className="size-3.5 text-[#E9C46A]" />
              <span className="capitalize">{dateStr}</span>
            </div>
            {challenge.match_status !== "scheduled" && (
              <span className="text-xs text-[#10B981] font-bold uppercase">Partido: {challenge.match_status}</span>
            )}
          </div>

          {/* Marcadores e Información de los Equipos */}
          <div className="flex items-center justify-around py-2">
            <div className="flex flex-col items-center text-center space-y-1 w-24">
              {challenge.home_team_code ? (
                <span className="text-4xl font-display uppercase tracking-widest">{challenge.home_team_code}</span>
              ) : (
                <div className="size-10 bg-gray-700/35 rounded-full flex items-center justify-center">⚽</div>
              )}
              <span className="text-xs font-bold truncate max-w-full text-white">{challenge.home_team}</span>
            </div>

            <div className="flex flex-col items-center">
              <span className="text-2xl font-extrabold text-[#E9C46A] tracking-wider">VS</span>
              {isCompleted && (
                <span className="text-xs text-muted-foreground mt-1">Finalizado</span>
              )}
            </div>

            <div className="flex flex-col items-center text-center space-y-1 w-24">
              {challenge.away_team_code ? (
                <span className="text-4xl font-display uppercase tracking-widest">{challenge.away_team_code}</span>
              ) : (
                <div className="size-10 bg-gray-700/35 rounded-full flex items-center justify-center">⚽</div>
              )}
              <span className="text-xs font-bold truncate max-w-full text-white">{challenge.away_team}</span>
            </div>
          </div>

          {/* Sección de Predicciones y Estado de los Jugadores */}
          <div className="bg-[#0D1B2A]/40 rounded-lg p-4 space-y-3 border border-border/10">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
              <span>Participantes y Marcadores</span>
              {isCompleted && challenge.creator_prediction_home !== null && (
                <span className="text-[#E9C46A] text-xs">
                  Resultado Real: {challenge.creator_prediction_home} - {challenge.creator_prediction_away}
                </span>
              )}
            </div>

            {/* Creador */}
            <div className="flex justify-between items-center text-sm py-1 border-b border-border/5">
              <div className="flex items-center gap-2">
                {challenge.creator_avatar_url ? (
                  <img src={challenge.creator_avatar_url} alt="" className="size-6 rounded-full object-cover border border-border/10 bg-background" />
                ) : (
                  <div className="size-6 rounded-full bg-accent/20 flex items-center justify-center text-[10px] font-bold text-accent">C</div>
                )}
                <span className="font-semibold text-gray-200">
                  {challenge.creator_display_name} <span className="text-[10px] text-muted-foreground">(Creador)</span>
                </span>
              </div>
              <span className="font-mono font-bold text-gray-100 text-sm">
                {challenge.creator_prediction_home !== null 
                  ? `${challenge.creator_prediction_home} - ${challenge.creator_prediction_away}` 
                  : "🔒"}
              </span>
            </div>

            {/* Rival / Segundo Participante */}
            {challenge.type === "direct" ? (
              <div className="flex justify-between items-center text-sm py-1">
                <div className="flex items-center gap-2">
                  <div className="size-6 rounded-full bg-blue-500/20 flex items-center justify-center text-[10px] font-bold text-blue-400">R</div>
                  <span className="font-semibold text-gray-200">
                    {challenge.challenged_display_name || "Esperando Rival"}
                  </span>
                </div>
                <span className="font-mono font-bold text-gray-100 text-sm">
                  {isPendingChallenge && !challenge.challenged_prediction_home ? (
                    <span className="text-xs text-muted-foreground font-normal">Pendiente de aceptación</span>
                  ) : challenge.challenged_prediction_home !== null ? (
                    `${challenge.challenged_prediction_home} - ${challenge.challenged_prediction_away}`
                  ) : (
                    "🔒"
                  )}
                </span>
              </div>
            ) : (
              // Pozos abiertos
              <div className="flex justify-between items-center text-sm py-1">
                <div className="flex items-center gap-2">
                  <div className="size-6 rounded-full bg-success/20 flex items-center justify-center text-[10px] font-bold text-success">P</div>
                  <span className="font-semibold text-gray-200">
                    {currentUserId && isParticipantOfOpenPool 
                      ? "Tú (Participando)" 
                      : challenge.challenged_display_name 
                        ? `${challenge.challenged_display_name} (Rival)` 
                        : "Esperando oponentes..."}
                  </span>
                </div>
                <span className="font-mono font-bold text-gray-100 text-sm">
                  {challenge.challenged_prediction_home !== null ? (
                    `${challenge.challenged_prediction_home} - ${challenge.challenged_prediction_away}`
                  ) : currentUserId && isParticipantOfOpenPool ? (
                    "🔒"
                  ) : (
                    <span className="text-xs text-gray-400 font-normal">Abierto</span>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Acciones y Formularios dependiendo del Estado */}
        <div className="space-y-4">
          {actionError && (
            <div className="text-sm font-semibold text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3 text-center">
              {actionError}
            </div>
          )}

          {/* CASO: Reto Cancelado */}
          {isCanceled && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-center">
              <ShieldAlert className="size-8 text-destructive mx-auto mb-2" />
              <h3 className="font-display font-bold text-lg text-white">Desafío Cancelado</h3>
              <p className="text-sm text-muted-foreground mt-1">Este desafío ha sido cancelado por su creador.</p>
            </div>
          )}

          {/* CASO: Reto Finalizado */}
          {isCompleted && (
            <div className="bg-[#1B263B] border border-border/10 rounded-lg p-4 text-center space-y-2">
              <Trophy className="size-8 text-[#E9C46A] mx-auto mb-2" />
              <h3 className="font-display font-bold text-lg text-white">Desafío Finalizado</h3>
              {challenge.status === "completed" && challenge.challenged_prediction_home !== null && (
                <div className="text-sm text-gray-300">
                  ¡El desafío se ha resuelto! Visita la sección de Duelos de tu liga para ver el historial y distribución de puntos.
                </div>
              )}
            </div>
          )}

          {/* CASO: Reto Activo (En Juego) */}
          {isActive && (
            <div className="bg-[#1B263B]/60 border border-border/10 rounded-lg p-4 text-center">
              <ShieldAlert className="size-6 text-[#10B981] mx-auto mb-2" />
              <h3 className="font-display font-bold text-md text-white">Duelo en Juego</h3>
              <p className="text-sm text-muted-foreground mt-1">El partido ha comenzado. Las predicciones de ambos participantes ya son públicas y visibles.</p>
            </div>
          )}

          {/* CASO: Reto Pendiente */}
          {isPendingChallenge && (
            <>
              {/* SUB-CASO: Usuario no autenticado */}
              {!currentUserId && (
                <div className="bg-[#1B263B] border border-border/10 rounded-lg p-5 text-center space-y-4">
                  <h3 className="font-display font-bold text-base">¿Aceptas el reto?</h3>
                  <p className="text-xs text-muted-foreground">Debes iniciar sesión con Google para responder a este desafío en la quiniela.</p>
                  <GoogleSignInButton next={`/desafio/${challenge.challenge_id}`} />
                </div>
              )}

              {/* SUB-CASO: Usuario autenticado pero NO pertenece a la liga */}
              {currentUserId && !isMember && (
                <div className="bg-[#1B263B] border border-[#E9C46A]/20 rounded-lg p-5 text-center space-y-4">
                  <ShieldAlert className="size-8 text-[#E9C46A] mx-auto" />
                  <h3 className="font-display font-bold text-base">Liga Privada</h3>
                  {challenge.type === "open" && challenge.invite_code ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Este desafío pertenece a una liga privada. Únete a la liga para poder unirte a este pozo abierto de apuestas.
                      </p>
                      <Button
                        onClick={handleJoinLeague}
                        disabled={isPending}
                        className="w-full bg-[#E9C46A] hover:bg-[#E9C46A]/90 text-[#0D1B2A] font-extrabold h-12"
                      >
                        {isPending ? "Uniéndote a la liga..." : "Unirse a la Liga para Participar"}
                      </Button>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Este es un desafío directo de una liga privada. Solo el rival designado que sea miembro de la liga puede aceptarlo.
                    </p>
                  )}
                </div>
              )}

              {/* SUB-CASO: Usuario autenticado y miembro de la liga */}
              {currentUserId && isMember && (
                <div className="space-y-3">
                  {/* Si es el creador */}
                  {isCreator && (
                    <div className="flex flex-col gap-3">
                      <Button
                        onClick={handleShareWhatsApp}
                        className="w-full bg-[#10B981] hover:bg-[#10B981]/90 text-white font-extrabold h-12 flex items-center justify-center gap-2"
                      >
                        <Share2 className="size-5" />
                        Compartir en WhatsApp
                      </Button>
                      <Button
                        onClick={handleCancel}
                        disabled={isPending}
                        variant="outline"
                        className="w-full border-border/20 text-destructive hover:bg-destructive/10 font-bold h-12"
                      >
                        {isPending ? "Cancelando..." : "Cancelar Desafío"}
                      </Button>
                    </div>
                  )}

                  {/* Si es el retado directo */}
                  {challenge.type === "direct" && isChallenged && (
                    <div className="grid grid-cols-2 gap-3">
                      <Button
                        onClick={() => setIsAcceptOpen(true)}
                        className="bg-[#E9C46A] hover:bg-[#E9C46A]/90 text-[#0D1B2A] font-extrabold h-12"
                      >
                        Aceptar Duelo
                      </Button>
                      <Button
                        onClick={handleReject}
                        disabled={isPending}
                        variant="outline"
                        className="border-border/20 text-destructive hover:bg-destructive/10 font-bold h-12"
                      >
                        {isPending ? "Rechazando..." : "Rechazar"}
                      </Button>
                    </div>
                  )}

                  {/* Si es un tercero en un duelo directo */}
                  {challenge.type === "direct" && !isCreator && !isChallenged && (
                    <div className="bg-[#1B263B]/60 border border-border/10 rounded-lg p-4 text-center">
                      <p className="text-xs text-muted-foreground">
                        Este es un duelo directo privado entre <strong>{challenge.creator_display_name}</strong> y <strong>{challenge.challenged_display_name || "un oponente"}</strong>. Solo ellos pueden participar.
                      </p>
                    </div>
                  )}

                  {/* Si es pozo abierto y el usuario no se ha unido aún */}
                  {challenge.type === "open" && !isCreator && !isParticipantOfOpenPool && (
                    <Button
                      onClick={() => setIsAcceptOpen(true)}
                      className="w-full bg-[#E9C46A] hover:bg-[#E9C46A]/90 text-[#0D1B2A] font-extrabold h-12"
                    >
                      Unirse al Pozo
                    </Button>
                  )}

                  {/* Si es pozo abierto y ya participa */}
                  {challenge.type === "open" && !isCreator && isParticipantOfOpenPool && (
                    <div className="bg-[#1B263B]/65 border border-border/10 rounded-lg p-4 text-center">
                      <p className="text-xs text-muted-foreground">
                        ¡Ya estás participando en este pozo abierto! Tus predicciones están registradas. El duelo comenzará al llegar el kickoff.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Modal de Aceptación/Unión */}
      <AcceptDuelDialog
        isOpen={isAcceptOpen}
        onClose={() => setIsAcceptOpen(false)}
        challenge={acceptChallengeInfo}
        wagerBalance={wagerBalance}
        onSuccess={handleAcceptSuccess}
      />
    </div>
  );
}
