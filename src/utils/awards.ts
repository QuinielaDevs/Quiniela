// Utilidades puras de los Premios Especiales (Story 6.1).
// Sin dependencias de React/Supabase → testeables como unidad.
import type { AwardCandidate, AwardCategory } from "@/types";

/**
 * Galardones en el orden canónico de presentación, con su microcopy (tono pique,
 * directo). Fuente única de verdad para la UI y para agrupar candidatos.
 */
export const AWARD_CATEGORIES: ReadonlyArray<{
  category: AwardCategory;
  title: string;
  hint: string;
}> = [
  {
    category: "champion",
    title: "Campeón del Mundo",
    hint: "¿Quién levanta la copa?",
  },
  {
    category: "top_scorer",
    title: "Máximo Goleador",
    hint: "¿Quién mete más goles?",
  },
  { category: "mvp", title: "MVP del Torneo", hint: "¿El mejor de todos?" },
];

/**
 * Agrupa los candidatos por categoría, ordenados por display_order (y por name
 * como desempate estable). Devuelve SIEMPRE las tres categorías, aunque alguna
 * quede vacía (la UI muestra entonces su empty state).
 */
export function groupCandidatesByCategory(
  candidates: AwardCandidate[],
): Record<AwardCategory, AwardCandidate[]> {
  const grouped: Record<AwardCategory, AwardCandidate[]> = {
    champion: [],
    top_scorer: [],
    mvp: [],
  };

  for (const candidate of candidates) {
    const bucket = grouped[candidate.category as AwardCategory];
    // Ignora categorías desconocidas (defensivo ante drift del CHECK de la BD).
    if (bucket) bucket.push(candidate);
  }

  for (const category of Object.keys(grouped) as AwardCategory[]) {
    grouped[category].sort(
      (a, b) =>
        a.display_order - b.display_order || a.name.localeCompare(b.name),
    );
  }

  return grouped;
}
