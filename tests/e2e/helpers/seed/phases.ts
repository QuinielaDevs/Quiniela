// Control de fases del torneo para tests de premios (Fase 1 del plan E2E).
//
// La fase activa se resuelve por now() contra las ventanas [starts_at, ends_at)
// de tournament_phases. La palanca de test es mover esas ventanas via service
// role. ES ESTADO GLOBAL (trampa §7.5): capturar snapshot ANTES de tocar y
// restaurar SIEMPRE en el cleanup.

import { createAdminClient } from "../admin";

export type PhaseCode = "A" | "B" | "C" | "D";

export interface PhaseRow {
  id: string;
  phase_code: PhaseCode;
  reward_points: number;
  starts_at: string | null;
  ends_at: string | null;
  edits_locked: boolean;
  label: string;
  sort_order: number;
}

export type PhasesSnapshot = PhaseRow[];

export async function getPhases(): Promise<PhaseRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tournament_phases")
    .select("id, phase_code, reward_points, starts_at, ends_at, edits_locked, label, sort_order")
    .order("sort_order", { ascending: true });
  if (error || !data) {
    throw new Error(`Error leyendo tournament_phases: ${error?.message}`);
  }
  return data as PhaseRow[];
}

/** Captura el estado actual (para restaurar en cleanup). */
export async function snapshotPhases(): Promise<PhasesSnapshot> {
  return getPhases();
}

// Mueve las ventanas para que now() caiga en la fase pedida, manteniendo las
// fases contiguas y sin solaparse: A = (-inf, b1), B = [b1, b2), C = [b2, b3),
// D = [b3, +inf). Los límites se colocan ±1h alrededor de `now` según la fase
// objetivo. No toca edits_locked (es dato del seed: solo D lo tiene en true).
export async function setActivePhase(code: PhaseCode): Promise<void> {
  const admin = createAdminClient();
  const now = Date.now();
  const HOUR = 60 * 60 * 1000;

  // b1/b2/b3 relativos a la fase que debe quedar activa.
  const offsetsByCode: Record<PhaseCode, [number, number, number]> = {
    A: [+1, +2, +3],
    B: [-1, +1, +2],
    C: [-2, -1, +1],
    D: [-3, -2, -1],
  };
  const [o1, o2, o3] = offsetsByCode[code];
  const b1 = new Date(now + o1 * HOUR).toISOString();
  const b2 = new Date(now + o2 * HOUR).toISOString();
  const b3 = new Date(now + o3 * HOUR).toISOString();

  const updates: Array<{ phase_code: PhaseCode; starts_at: string | null; ends_at: string | null }> = [
    { phase_code: "A", starts_at: null, ends_at: b1 },
    { phase_code: "B", starts_at: b1, ends_at: b2 },
    { phase_code: "C", starts_at: b2, ends_at: b3 },
    { phase_code: "D", starts_at: b3, ends_at: null },
  ];

  for (const update of updates) {
    const { error } = await admin
      .from("tournament_phases")
      .update({ starts_at: update.starts_at, ends_at: update.ends_at })
      .eq("phase_code", update.phase_code);
    if (error) {
      throw new Error(`Error moviendo la fase ${update.phase_code}: ${error.message}`);
    }
  }
}

/** Restaura las filas del snapshot (ventanas Y edits_locked) por phase_code. */
export async function restorePhases(snapshot: PhasesSnapshot): Promise<void> {
  const admin = createAdminClient();
  for (const row of snapshot) {
    const { error } = await admin
      .from("tournament_phases")
      .update({
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        edits_locked: row.edits_locked,
        reward_points: row.reward_points,
      })
      .eq("phase_code", row.phase_code);
    if (error) {
      throw new Error(`Error restaurando la fase ${row.phase_code}: ${error.message}`);
    }
  }
}

/** Fase activa según las ventanas actuales (espejo de fn_check_awards_locked). */
export async function getActivePhase(): Promise<PhaseRow | null> {
  const phases = await getPhases();
  const now = Date.now();
  for (const phase of phases) {
    const startsOk = phase.starts_at === null || now >= new Date(phase.starts_at).getTime();
    const endsOk = phase.ends_at === null || now < new Date(phase.ends_at).getTime();
    if (startsOk && endsOk) return phase;
  }
  return null;
}
