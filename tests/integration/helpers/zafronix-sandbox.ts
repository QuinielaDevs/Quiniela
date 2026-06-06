/**
 * tests/integration/helpers/zafronix-sandbox.ts
 *
 * Cliente tipado del **Sandbox real** de Zafronix (torneo sintético año 9999)
 * para las pruebas de integración del ciclo completo (Story 8.4).
 *
 * NO es código de producción: vive solo bajo tests/ y se usa exclusivamente
 * desde la suite gated `zafronix-sandbox-e2e.test.ts`, que se omite cuando
 * `ZAFRONIX_SANDBOX_KEY` no está presente.
 *
 * Contrato de la API (verificado en https://api.zafronix.com/docs):
 *   - Base:   https://api.zafronix.com/fifa/worldcup/v1
 *   - Auth:   header `X-API-Key: <zwc_skt_…>`
 *   - Sandbox: las claves `zwc_skt_…` LEEN cualquier año pero solo ESCRIBEN
 *     en el año 9999. El aislamiento del 2026 lo garantiza la propia API.
 *
 * Cuotas (NO quemarlas):
 *   - `POST /sandbox/reset` = 10/hora/clave  → llamar SOLO en `beforeAll`.
 *   - Cada read/write cuenta para la cuota diaria (24h) → reintentos
 *     CONSERVADORES y `Idempotency-Key` en las escrituras.
 */
import { z } from "zod";

// ── Constantes ──────────────────────────────────────────────────────

/** Año del torneo sintético del sandbox (único año escribible con `zwc_skt_`). */
export const SANDBOX_YEAR = 9999;

const ZAFRONIX_BASE_URL = "https://api.zafronix.com/fifa/worldcup/v1";

/** Timeout por petición (ms). El sandbox puede ser más lento que producción. */
const REQUEST_TIMEOUT_MS = 15000;

// ── Zod Schemas (lenientes: validan lo esencial, toleran campos extra) ──

/**
 * Forma de un partido del sandbox. Se asume el MISMO contrato que producción
 * (ver scripts/sync-matches.ts): ids con formato `${year}-${NNN}` (ej.
 * `9999-001` grupos, `9999-073` eliminatoria). Campos extra se ignoran.
 */
export const sandboxMatchSchema = z
  .object({
    id: z.string(),
    // En el sandbox real los slots de eliminatoria sin resolver (final, 3er
    // puesto…) llegan con equipos en null y sin status → todo opcional/nullable.
    homeTeam: z.string().nullable().optional(),
    awayTeam: z.string().nullable().optional(),
    homeScore: z.number().int().nullable().optional(),
    awayScore: z.number().int().nullable().optional(),
    status: z.string().nullable().optional(),
    stage: z.string().nullable().optional(),
    group: z.string().nullable().optional(),
    bracketSlot: z.number().int().nullable().optional(),
  })
  .passthrough();

export type SandboxMatch = z.infer<typeof sandboxMatchSchema>;

const sandboxMatchesResponseSchema = z
  .object({
    year: z.number().int().optional(),
    count: z.number().int().optional(),
    data: z.array(sandboxMatchSchema),
  })
  .passthrough();

const sandboxStatusSchema = z
  .object({
    lastResetAt: z.string().optional(),
    modificationCount: z.number().int().optional(),
  })
  .passthrough();

export type SandboxStatus = z.infer<typeof sandboxStatusSchema>;

/** Body aceptado por `POST /matches/{id}/result`. */
export interface FinalizeBody {
  homeScore: number;
  awayScore: number;
  extraTime?: boolean;
  penalties?: { home: number; away: number } | null;
  attendance?: number;
  referee?: string;
}

// ── Infra ───────────────────────────────────────────────────────────

/**
 * Devuelve la clave del sandbox o lanza un error claro. Solo debe invocarse
 * dentro de pruebas ya gated por la presencia de la variable.
 */
export function requireSandboxKey(): string {
  const key = process.env.ZAFRONIX_SANDBOX_KEY;
  if (!key) {
    throw new Error(
      "ZAFRONIX_SANDBOX_KEY no está presente. Las pruebas del ciclo live " +
        "deberían estar gated con describe.skipIf(!process.env.ZAFRONIX_SANDBOX_KEY).",
    );
  }
  if (!key.startsWith("zwc_skt_")) {
    throw new Error(
      "ZAFRONIX_SANDBOX_KEY no tiene el formato esperado `zwc_skt_…` (clave de " +
        "sandbox que solo puede escribir el año 9999). Revisa la credencial.",
    );
  }
  return key;
}

/**
 * `fetch` con timeout y reintentos CONSERVADORES (cada llamada cuenta para la
 * cuota diaria). Patrón derivado de `fetchWithRetry` de scripts/sync-matches.ts
 * pero con menos reintentos. NO reintenta respuestas HTTP (4xx/5xx) — solo
 * fallos de red/timeout — para no multiplicar el consumo de cuota.
 */
async function fetchZafronix(
  path: string,
  init: RequestInit,
  { retries = 1, retryDelayMs = 1500 }: { retries?: number; retryDelayMs?: number } = {},
): Promise<Response> {
  const key = requireSandboxKey();
  const url = `${ZAFRONIX_BASE_URL}${path}`;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: {
          "X-API-Key": key,
          Accept: "application/json",
          ...(init.headers ?? {}),
        },
      });
      clearTimeout(timeoutId);
      if (res.status >= 500) {
        throw new Error(`Error de servidor Zafronix (HTTP ${res.status})`);
      }
      return res;
    } catch (err) {
      clearTimeout(timeoutId);
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  }
  throw new Error(
    `Fallo contra Zafronix sandbox (${path}) tras ${retries + 1} intento(s): ` +
      `${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

/**
 * Verifica que la respuesta sea 2xx y parsea el body como JSON.
 * Tolera respuestas vacías (204/No Content o body vacío en un 2xx),
 * devolviendo `null` en ese caso — los endpoints de escritura pueden no
 * devolver cuerpo. Los endpoints de lectura validan el resultado con Zod, que
 * fallará de forma explícita si esperaban datos y llegó `null`.
 */
async function parseJsonOrThrow(res: Response, context: string): Promise<unknown> {
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Zafronix sandbox ${context} respondió ${res.status} ${res.statusText}: ${text.slice(0, 500)}`,
    );
  }
  if (text.trim() === "") {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Zafronix sandbox ${context}: respuesta no es JSON válido: ${text.slice(0, 200)}`);
  }
}

// ── Operaciones del Sandbox ─────────────────────────────────────────

/**
 * `POST /sandbox/reset` — regenera los fixtures del año 9999. Idempotente,
 * pero **capado a 10/hora/clave**: invocar SOLO en `beforeAll`, NUNCA en
 * `beforeEach`. Lanza un mensaje claro ante 429 (cap agotado).
 */
export async function resetSandbox(): Promise<void> {
  const res = await fetchZafronix("/sandbox/reset", { method: "POST" });
  if (res.status === 429) {
    const retryAfter = res.headers.get("retry-after");
    throw new Error(
      "POST /sandbox/reset devolvió 429 (cap de 10/hora/clave agotado). " +
        `Espera antes de reintentar${retryAfter ? ` (~${retryAfter}s)` : ""}. ` +
        "Recuerda: reset SOLO en beforeAll, nunca en beforeEach.",
    );
  }
  await parseJsonOrThrow(res, "POST /sandbox/reset");
}

/**
 * `GET /sandbox/status` — timestamp del último reset + contador de
 * modificaciones. Útil para diagnósticos/log.
 */
export async function getSandboxStatus(): Promise<SandboxStatus> {
  const res = await fetchZafronix("/sandbox/status", { method: "GET" });
  const json = await parseJsonOrThrow(res, "GET /sandbox/status");
  if (json === null) {
    throw new Error("GET /sandbox/status devolvió una respuesta vacía inesperadamente.");
  }
  return sandboxStatusSchema.parse(json);
}

/**
 * `GET /matches?year=9999` — lista los partidos del sandbox. Permite elegir
 * dinámicamente un partido real (sin hardcodear ids que no se pueden verificar
 * sin la clave).
 */
export async function listSandboxMatches(): Promise<SandboxMatch[]> {
  const res = await fetchZafronix(`/matches?year=${SANDBOX_YEAR}`, { method: "GET" });
  const json = await parseJsonOrThrow(res, "GET /matches?year=9999");
  if (json === null) {
    throw new Error("GET /matches?year=9999 devolvió una respuesta vacía inesperadamente.");
  }
  return sandboxMatchesResponseSchema.parse(json).data;
}

/**
 * `POST /matches/{matchId}/result` — finaliza un partido del año 9999.
 * Emite el evento `match.finalized` en el lado remoto. Acepta `Idempotency-Key`
 * (semántica at-most-once) para reintentos seguros.
 *
 * Devuelve el JSON crudo de la respuesta (estado resultante del partido), que
 * el puente de re-firma usa para construir el evento local.
 */
export async function finalizeSandboxMatch(
  matchId: string,
  body: FinalizeBody,
  idempotencyKey?: string,
): Promise<unknown> {
  const res = await fetchZafronix(`/matches/${encodeURIComponent(matchId)}/result`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  return parseJsonOrThrow(res, `POST /matches/${matchId}/result`);
}

/**
 * `PATCH /matches/{matchId}` — corrige campos de un partido finalizado.
 * Emite `match.patched`. (Opcional; disponible para cobertura futura.)
 */
export async function patchSandboxMatch(
  matchId: string,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<unknown> {
  const res = await fetchZafronix(`/matches/${encodeURIComponent(matchId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  return parseJsonOrThrow(res, `PATCH /matches/${matchId}`);
}

/**
 * `POST /matches/{matchId}/postpone` — marca status
 * (postponed/abandoned/cancelled). Emite `match.postponed`. (Opcional.)
 */
export async function postponeSandboxMatch(
  matchId: string,
  body: { status: string; reason?: string; rescheduledTo?: string },
  idempotencyKey?: string,
): Promise<unknown> {
  const res = await fetchZafronix(`/matches/${encodeURIComponent(matchId)}/postpone`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  return parseJsonOrThrow(res, `POST /matches/${matchId}/postpone`);
}

/** Partido del sandbox con equipos garantizados (no null). */
export type ResolvedSandboxMatch = SandboxMatch & { homeTeam: string; awayTeam: string };

/**
 * Selecciona un partido de **fase de grupos** del sandbox, con equipos ya
 * definidos y aún no finalizado, para usarlo como sujeto del ciclo feliz.
 * Prioriza grupos para mantener resolución simple (bracket_slot null en el
 * espejo local). Exige equipos no nulos porque el espejo local los requiere
 * (home_team/away_team son NOT NULL).
 */
export function pickGroupStageMatch(matches: SandboxMatch[]): ResolvedSandboxMatch {
  const hasTeams = (m: SandboxMatch): m is ResolvedSandboxMatch =>
    typeof m.homeTeam === "string" &&
    m.homeTeam.length > 0 &&
    typeof m.awayTeam === "string" &&
    m.awayTeam.length > 0;
  const isGroup = (m: SandboxMatch) =>
    (m.stage?.toLowerCase().includes("group") ?? false) ||
    (m.group != null && m.bracketSlot == null);
  const notFinished = (m: SandboxMatch) => (m.status ?? "").toLowerCase() !== "finished";

  const candidate =
    matches.find((m) => hasTeams(m) && isGroup(m) && notFinished(m)) ??
    matches.find((m) => hasTeams(m) && notFinished(m)) ??
    matches.find(hasTeams);

  if (!candidate || !hasTeams(candidate)) {
    throw new Error(
      "El sandbox no devolvió ningún partido con equipos definidos tras el reset.",
    );
  }
  return candidate;
}
