"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserMinus } from "lucide-react";

import {
  removeMember,
  setMemberPaymentStatus,
} from "@/app/actions/leagues.actions";
import { ExpelMemberDialog } from "@/components/standings/ExpelMemberDialog";
import { cn } from "@/utils/utils";
import type { LeagueRole, PaymentStatus } from "@/types";

// Vista de un miembro en el panel admin (Story 3.3). Los datos crudos los mapea
// la página servidor desde league_members + profiles.
export type AdminMemberView = {
  userId: string;
  displayName: string;
  avatarUrl: string;
  role: LeagueRole;
  paymentStatus: PaymentStatus;
};

type MemberAdminListProps = {
  members: AdminMemberView[];
  currentUserId: string;
  leagueId: string;
};

type ExpelTarget = { userId: string; displayName: string } | null;

export function MemberAdminList({
  members,
  currentUserId,
  leagueId,
}: MemberAdminListProps) {
  const router = useRouter();
  const [rows, setRows] = useState<AdminMemberView[]>(members);
  const [error, setError] = useState<string | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [expelTarget, setExpelTarget] = useState<ExpelTarget>(null);
  const [isPending, startTransition] = useTransition();

  // Reconciliar con la verdad del servidor: tras un `router.refresh()` la página
  // re-renderiza y pasa una nueva prop `members`. Como `useState(members)` solo
  // siembra en el montaje, sin esto la lista quedaría desincronizada ante cambios
  // de otro admin. OJO: la página reconstruye `members` con `.map()` en cada
  // render, así que su identidad cambia SIEMPRE; por eso gateamos en `!isPending`
  // para NO pisar un estado optimista en vuelo si ocurre un re-render concurrente
  // mientras la transición sigue pendiente. Al terminar la transición (incluido
  // el refresh), `isPending` baja y reconciliamos con la verdad del servidor.
  useEffect(() => {
    if (!isPending) setRows(members);
  }, [members, isPending]);

  function togglePayment(member: AdminMemberView) {
    const next: PaymentStatus =
      member.paymentStatus === "paid" ? "pending" : "paid";
    setError(null);
    setPendingUserId(member.userId);
    // Optimista: refleja el nuevo estado y revierte si la acción falla.
    setRows((prev) =>
      prev.map((r) =>
        r.userId === member.userId ? { ...r, paymentStatus: next } : r,
      ),
    );

    startTransition(async () => {
      const result = await setMemberPaymentStatus({
        leagueId,
        userId: member.userId,
        status: next,
      });
      setPendingUserId(null);
      if (!result.success) {
        setError(result.error);
        setRows((prev) =>
          prev.map((r) =>
            r.userId === member.userId
              ? { ...r, paymentStatus: member.paymentStatus }
              : r,
          ),
        );
        return;
      }
      router.refresh();
    });
  }

  function confirmExpel() {
    if (!expelTarget) return;
    const targetId = expelTarget.userId;
    setError(null);
    startTransition(async () => {
      const result = await removeMember({ leagueId, userId: targetId });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setRows((prev) => prev.filter((r) => r.userId !== targetId));
      setExpelTarget(null);
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-border bg-card p-6 text-center text-card-foreground">
        <h2 className="font-display text-lg font-bold">Sin miembros</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Invita a tus amigos con el enlace de la liga para empezar.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p
          role="status"
          className="rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {rows.map((member) => {
          const isSelf = member.userId === currentUserId;
          const isPaid = member.paymentStatus === "paid";
          const isRowPending = pendingUserId === member.userId;
          return (
            <li
              key={member.userId}
              className="flex items-center gap-3 rounded-md border border-border bg-card p-3"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={member.avatarUrl || "/assets/avatars/default-player.svg"}
                alt=""
                className="size-9 shrink-0 rounded-full border border-border object-cover"
              />

              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold">
                  {member.displayName}
                </span>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {member.role === "admin" ? "Admin" : "Miembro"}
                </span>
              </div>

              {/* Toggle de pago interactivo (AC #3). */}
              <button
                type="button"
                onClick={() => togglePayment(member)}
                disabled={isPending && isRowPending}
                aria-pressed={isPaid}
                aria-label={`Pago de ${member.displayName}: ${
                  isPaid ? "Pagado" : "Pendiente"
                }. Tocar para alternar.`}
                className={cn(
                  "inline-flex h-12 min-w-[88px] items-center justify-center rounded-full px-3 text-[11px] font-semibold uppercase tracking-wide disabled:opacity-50",
                  isPaid
                    ? "bg-success text-success-foreground"
                    : "bg-destructive text-destructive-foreground",
                )}
              >
                {isPaid ? "Pagado" : "Pendiente"}
              </button>

              {/* Baja (AC #4). Oculta para la propia fila del admin. */}
              {!isSelf && (
                <button
                  type="button"
                  onClick={() =>
                    setExpelTarget({
                      userId: member.userId,
                      displayName: member.displayName,
                    })
                  }
                  aria-label={`Dar de baja a ${member.displayName}`}
                  className="inline-flex size-12 shrink-0 items-center justify-center rounded-full text-destructive"
                >
                  <UserMinus className="size-5" aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <ExpelMemberDialog
        open={expelTarget !== null}
        memberName={expelTarget?.displayName ?? ""}
        pending={isPending}
        onConfirm={confirmExpel}
        onCancel={() => {
          if (!isPending) setExpelTarget(null);
        }}
      />
    </div>
  );
}
