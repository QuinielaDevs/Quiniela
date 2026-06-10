import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildStandings, type StandingMatch, type StandingMember, type StandingPrediction } from "@/utils/standings";
import type { LeagueRole, PaymentStatus } from "@/types";

// Fila de league_members embebiendo el perfil (FK user_id → profiles.id).
type MemberRow = {
  user_id: string;
  role: LeagueRole;
  payment_status: PaymentStatus;
  joined_at: string;
  wager_balance: number;
  profiles: { display_name: string; avatar_url: string } | null;
};

export async function GET(req: NextRequest) {
  const botSecret = process.env.BOT_SECRET;

  // 1. Validar que la variable de entorno BOT_SECRET esté configurada en el servidor
  if (!botSecret) {
    console.error("BOT_SECRET is not configured on the server");
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 }
    );
  }

  // 2. Control de autorización
  const authHeader = req.headers.get("authorization");
  if (!authHeader || authHeader !== `Bearer ${botSecret}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  // 3. Validar y extraer el query parameter leagueId
  const { searchParams } = new URL(req.url);
  const leagueId = searchParams.get("leagueId");

  if (!leagueId) {
    return NextResponse.json(
      { success: false, error: "El parámetro leagueId es obligatorio" },
      { status: 400 }
    );
  }

  // Simple validación de formato UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(leagueId)) {
    return NextResponse.json(
      { success: false, error: "Formato de leagueId inválido. Debe ser un UUID válido" },
      { status: 400 }
    );
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Database configuration missing (SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)");
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 }
    );
  }

  // Cliente de Supabase con service_role para omitir las políticas RLS y leer todos los miembros de la liga
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    // 4. Consultar datos requeridos para el cálculo de la tabla
    const [membersRes, matchesRes] = await Promise.all([
      supabase
        .from("league_members")
        .select("user_id, role, payment_status, joined_at, wager_balance, profiles(display_name, avatar_url)")
        .eq("league_id", leagueId),
      supabase
        .from("matches")
        .select("id, status, matchday, stage, home_score, away_score")
        .eq("status", "finished"),
    ]);

    if (membersRes.error) {
      console.error("Error fetching league members:", membersRes.error);
      throw membersRes.error;
    }
    if (matchesRes.error) {
      console.error("Error fetching matches:", matchesRes.error);
      throw matchesRes.error;
    }

    const memberRows = (membersRes.data ?? []) as unknown as MemberRow[];
    
    // Si la liga no tiene miembros, retornamos tabla vacía o error 404
    if (memberRows.length === 0) {
      return NextResponse.json(
        { success: false, error: "Liga no encontrada o sin miembros" },
        { status: 404 }
      );
    }

    const finishedMatches: StandingMatch[] = (matchesRes.data ?? []).map((m) => ({
      id: m.id,
      status: m.status,
      matchday: m.matchday,
      stage: m.stage,
      homeScore: m.home_score,
      awayScore: m.away_score,
    }));
    const finishedIds = finishedMatches.map((m) => m.id);

    // 5. Consultar predicciones para partidos finalizados
    let predictions: StandingPrediction[] = [];
    if (finishedIds.length > 0) {
      const { data: predRows, error: predError } = await supabase
        .from("predictions")
        .select("user_id, match_id, home_score_pred, away_score_pred, multiplier")
        .eq("league_id", leagueId)
        .in("match_id", finishedIds);

      if (predError) {
        console.error("Error fetching predictions:", predError);
        throw predError;
      }

      predictions = (predRows ?? []).map((p) => ({
        userId: p.user_id,
        matchId: p.match_id,
        homeScorePred: p.home_score_pred,
        awayScorePred: p.away_score_pred,
        multiplier: p.multiplier,
      }));
    }

    // 6. Mapear miembros al formato requerido por la función buildStandings
    const members: StandingMember[] = memberRows.map((m) => ({
      userId: m.user_id,
      displayName: m.profiles?.display_name ?? "Jugador Anónimo",
      avatarUrl: m.profiles?.avatar_url ?? "/assets/avatars/default-player.svg",
      paymentStatus: m.payment_status,
      joinedAt: m.joined_at,
      duelPoints: Number(m.wager_balance ?? 0),
    }));

    // 7. Calcular las posiciones
    const standings = buildStandings(members, finishedMatches, predictions);

    // 8. Responder con las posiciones ordenadas y habilitar caché HTTP (5 min) para optimizar el consumo de Supabase
    return NextResponse.json(
      { success: true, standings },
      { 
        status: 200, 
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60"
        }
      }
    );
  } catch (error: any) {
    console.error("Unhandled error in standings API:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
