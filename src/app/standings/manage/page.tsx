import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/utils/supabase/server";
import { BottomNavbar } from "@/components/layout/BottomNavbar";
import {
  MemberAdminList,
  type AdminMemberView,
} from "@/components/standings/MemberAdminList";
import type { LeagueRole, PaymentStatus } from "@/types";

// Fila de league_members embebiendo el perfil (FK user_id → profiles.id).
type ManageMemberRow = {
  user_id: string;
  role: LeagueRole;
  payment_status: PaymentStatus;
  joined_at: string;
  profiles: { display_name: string; avatar_url: string } | null;
};

// Panel rápido de administración (Story 3.3). Resuelve sesión + liga activa,
// EXIGE rol admin (defensa server-side), carga los miembros y delega la gestión
// interactiva (toggle de pago / expulsión) a MemberAdminList.
// Accesos dinámicos a cookies (getClaims) → dentro de <Suspense> (cacheComponents).
export async function ManageBoard() {
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId) redirect("/auth/login");

  // Liga del usuario: la más reciente (igual que /standings).
  const { data: memberships } = await supabase
    .from("league_members")
    .select("league_id, joined_at")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false })
    .limit(1);

  const leagueId = memberships?.[0]?.league_id;
  if (!leagueId) {
    return (
      <EmptyState
        title="Aún no perteneces a una liga"
        body="Crea tu propia quiniela o únete con un enlace de invitación para administrarla."
        cta={{ href: "/leagues/new", label: "Crear una liga" }}
      />
    );
  }

  // Cargar miembros con rol + perfil embebido (RLS ya autoriza a un miembro).
  const { data: memberRows } = await supabase
    .from("league_members")
    .select(
      "user_id, role, payment_status, joined_at, profiles(display_name, avatar_url)",
    )
    .eq("league_id", leagueId)
    .order("joined_at", { ascending: true });

  const rows = (memberRows ?? []) as unknown as ManageMemberRow[];

  // Defensa server-side (AC #1/#2): solo el admin entra al panel.
  const currentMember = rows.find((m) => m.user_id === userId);
  if (currentMember?.role !== "admin") redirect("/standings");

  const members: AdminMemberView[] = rows.map((m) => ({
    userId: m.user_id,
    displayName: m.profiles?.display_name ?? "Jugador Anónimo",
    avatarUrl: m.profiles?.avatar_url ?? "/assets/avatars/default-player.svg",
    role: m.role,
    paymentStatus: m.payment_status,
  }));

  return (
    <MemberAdminList
      members={members}
      currentUserId={userId}
      leagueId={leagueId}
    />
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
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-md border border-border bg-card"
        />
      ))}
    </div>
  );
}

export default function ManageLeaguePage() {
  return (
    <main className="min-h-svh bg-background px-4 py-6 pb-24 text-foreground">
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <header className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="font-display text-xs font-semibold uppercase tracking-wide text-accent">
              PIJA Quiniela
            </p>
            <h1 className="font-display text-2xl font-bold">Gestión de liga</h1>
          </div>
          <span className="mt-1 rounded-sm border border-primary bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
            Admin
          </span>
        </header>

        <Suspense fallback={<BoardSkeleton />}>
          <ManageBoard />
        </Suspense>
      </div>

      <BottomNavbar />
    </main>
  );
}
