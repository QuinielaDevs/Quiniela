# Sprint Change Proposal — Fuente de Datos del Torneo

- **Fecha:** 2026-06-04
- **Autor:** Cris (Project Lead) + Developer agent
- **Origen:** Retrospectiva de Epic 4 (pausada) — descubrimiento al validar la integración de datos en vivo
- **Modo de revisión:** Batch
- **Clasificación de alcance:** **Moderate** (reorganización de backlog: nueva epic + ajustes de artefactos; sin rollback)

---

## 1. Resumen del Issue

El modelo de datos del torneo se diseñó alrededor de una **sincronización automática Pull-and-Cache contra API-Football (api-sports.io)**: un cron (GitHub Actions) consultaría `/fixtures?league=1&season=2026` durante ventanas de partido y escribiría en `public.matches`.

**Evidencia dura (llamadas reales realizadas el 2026-06-04 con la API key del proyecto):**

- `GET /status` → `HTTP 200`, plan **Free** activo, 0/100 llamadas. La key es válida.
- `GET /fixtures?league=1&season=2026` → `HTTP 200` con `errors: { plan: "Free plans do not have access to this season, try from 2022 to 2024." }`, `results: 0`.
- `GET /leagues?id=1&season=2026` → mismo bloqueo de plan.
- `GET /leagues?id=1` (sin temporada) → temporadas del Mundial: `[2010, 2014, 2018, 2022, 2026]`. **2026 existe pero está detrás del plan de pago.**
- `GET /fixtures?league=1&season=2022` → `HTTP 200`, **64 partidos** con datos completos (pipeline OK, pero es Mundial 2022, no 2026).

**Conclusión:** el plan Free **no** da acceso a la `season=2026`. La sincronización automática planificada es inviable sin un plan de pago. El formato de datos sí es correcto (validado con 2022), por lo que el cambio es de **fuente de datos**, no de modelo.

**Tipo de issue:** Limitación técnica/externa descubierta durante la implementación (acceso a datos restringido por plan).

---

## 2. Análisis de Impacto

### Epic Impact

| Epic | Impacto |
|------|---------|
| **Epic 1–3** (auth, predicciones/scoring, standings/admin) — `done` | Sin impacto. |
| **Epic 4** (tabla en vivo) — `done` | **Sin cambio funcional.** La tabla en vivo (4.1) y los toasts (4.2) reaccionan a cambios de `public.matches` vía Supabase Realtime **sin importar el origen** del cambio. Solo cambia el *productor* de esos cambios: del cron pasa a ser el **admin**. |
| **Epic 5** (Duelos) — `backlog` | Sin impacto directo; se mantiene. |
| **Epic 6** (Premios por fase A/B/C/D) — `backlog` | **Dependencia nueva:** la puntuación decreciente por fase (FR-15/16) requiere conocer los límites de fase (inicio de Octavos, de Semis). Esos límites ahora los provee el **motor de avance de fase** de la nueva Epic 7. Epic 7 debe ir **antes** que Epic 6. |
| **Epic 7 (NUEVA)** | "Datos del Torneo": seed + captura admin + motor de fases. Foundational; se ejecuta a continuación (prioritaria, antes de Epic 5/6). |

### Artifact Conflicts

| Artefacto | Sección | Acción |
|-----------|---------|--------|
| **PRD addendum** | §"Sincronización de Datos Deportivos (Pull-and-Cache / API-Football)" y esquema `matches (id = API-Football)` | Anotar **SUPERSEDED** → reemplazado por seed + captura admin (Epic 7). |
| **PRD decision-log** | Decision 5 (stack + sync API) | Anotar el pivot de fuente de datos. |
| **Arquitectura** | Líneas ~52, ~121, ~125, ~153-154, ~169, ~181, ~208, ~312, ~358, ~448 (cron API, `/api/sync`, GitHub Action de sync, cuota API) | Anotar **SUPERSEDED** del sync API; **conservar** el keep-alive diario (`db-keep-alive.yml`, NO depende de API-Football). Agregar referencias al modelo admin + motor de fases + columnas `group_label`/bracket. |
| **Epics** | Fin del archivo + "Epic List" + FR mapping | Agregar **Epic 7** con 3 historias. |
| **sprint-status.yaml** | `development_status` | Agregar `epic-7` + `7-1/7-2/7-3` (backlog) + `epic-7-retrospective` (optional). |
| **`db-keep-alive.yml`** (GitHub Action) | — | **Sin cambio** (sigue siendo necesario; no usa API-Football). |

### Technical Impact

- **Schema:** nuevas columnas `matches.group_label` (A–L, nullable), `matches.bracket_slot`, `matches.home_source`, `matches.away_source` y `matches.venue`; migración idempotente de seed.
- **`matches.external_ref`:** ya no lo alimenta un cron externo; se reutiliza como clave estable del seed (`wc2026:grp:*`, `wc2026:ko:*`) con `on conflict (external_ref) do update`. No se elimina (no romper `unique`).
- **Escritura de `matches`:** hoy es solo lectura para `authenticated` (`matches_select_authenticated`); se agrega un RPC `SECURITY DEFINER` admin-gated (patrón Story 3.3) para captura de resultados. NO se habilita escritura directa por cliente.
- **Realtime:** ya activo sobre `matches` (4.1). El admin-update se propaga solo.
- **Motor de fases:** lógica pura/testeable (análoga a `standings.ts`/`scoring.ts`), sin DOM/DB.

---

## 3. Camino Recomendado

**Opción 1 — Direct Adjustment** (elegida). No hay rollback ni recorte de MVP.

- **Justificación:** el plan central y los Epics 1–4 quedan intactos; solo cambia la *fuente* de los datos de partidos y se agrega una epic foundational que antes estaba "oculta" en el cron de API. Riesgo **bajo-medio**: la única complejidad real es el motor de avance de fase (formato 2026: 12 grupos, 8 mejores terceros, bracket), mitigada con cálculo puro + tests exhaustivos + desempate determinista de respaldo.
- **Alternativas descartadas:** (Rollback) nada que revertir; (MVP Review) el MVP sigue siendo alcanzable — de hecho se vuelve más autónomo, sin costo ni rate limits externos.
- **Decisiones del Project Lead (2026-06-04):** avance de fase **automático total** (con respaldo determinista); seed = **72 grupos + 32 slots TBD**; numeración **Epic 7 priorizada** (sin renumerar 5/6); revisión **Batch**.

---

## 3b. Fuente de Datos Confirmada (actualización 2026-06-04)

Cris aportó datos reales y estructurados del Mundial 2026 (repo público en GitHub), que se adoptan como **fuente del seed** y **eliminan casi todo el riesgo de Story 7.1**:

- **`worldcup.json`** — objeto `{name, matches}`; `matches` contiene el calendario completo de 104 partidos: 72 de grupos + 32 de eliminatoria, con `date`, `time` (con timezone, ej. `"13:00 UTC-6"`), `team1`/`team2`, `group`, `ground`, y `num` (id de partido del bracket).
- **`worldcup.teams.json`** — 48 equipos con `name`, `fifa_code`, `group` (A–L), `confed`, bandera.
- **`worldcup.stadiums.json`** — objeto `{name, stadiums}`; `stadiums` contiene 16 sedes (ciudad, timezone, capacidad). 7.1 persiste `venue text` desde `ground`/`stadiums.json`.
- **`worldcup.quali_playoffs.json`** — resultados de repechajes; no se usa (los 48 clasificados ya están definidos).

**Impacto en el motor de fases (Story 7.3):** el `worldcup.json` ya **codifica la estructura del bracket**: R32 usa códigos `1X`/`2X` (1.º/2.º de grupo) y `3X/Y/Z…` (mejor tercero entre esos grupos); R16→Final usan `W##` (ganador del partido `num=##`) y `L##` (perdedor, para el 3.º lugar). El motor resuelve esos códigos conforme entran resultados. La **única lógica no trivial restante** es la asignación de los **8 mejores terceros** a sus slots (lookup-table oficial FIFA, acotada por los grupos candidatos de cada slot).

**Acción:** copiar los 4 JSON al repo (ej. `supabase/seed-data/worldcup-2026/`) como insumo de la migración/script de seed de 7.1.

**Detalles menores resueltos en 7.1:** convertir `time`+timezone → `match_time` UTC; derivar `matchday` como ronda de grupo (1/2/3) por equipo; persistir `venue text` desde `ground`/`stadiums.json`.

---

## 4. Propuestas de Cambio Detalladas

### 4.1 NUEVA Epic 7 (a agregar a `epics.md` y `sprint-status.yaml`)

> **## Epic 7: Datos del Torneo — Seed, Captura de Resultados (Admin) y Avance de Fase**
>
> Reemplaza la sincronización automática con API-Football (inviable en plan Free para `season=2026`). El calendario del Mundial 2026 se siembra en la base, el administrador captura/edita resultados, y un motor automático calcula la clasificación de grupos y el avance de eliminatorias con las reglas FIFA del formato 2026. Foundational: se ejecuta antes de Epics 5 y 6 (Epic 6 depende de los límites de fase que produce este motor).
>
> **Reescopa:** NFR-5 (mapeo de partidos); soporte de datos para FR-7…FR-11, FR-15…FR-17.

#### Story 7.1: Seed del Calendario y Modelo de Fases (Grupos + Bracket)

- **As a** sistema de la quiniela, **I want** el calendario del Mundial 2026 sembrado (72 partidos de grupos en 12 grupos A–L) y la estructura de 32 cruces de eliminatoria como placeholders, **So that** la app funcione con datos reales sin depender de una API externa de pago.
- **AC:**
  1. **Fuente de datos:** `supabase/seed-data/worldcup-2026/` (`worldcup.json` = 104 partidos; `worldcup.teams.json` = 48 equipos con `fifa_code`/`group`/bandera). Migración nueva: `public.matches` gana columnas `group_label` (text, A–L, nullable en knockout), `bracket_slot`, `home_source`, `away_source` y `venue`. Seed **idempotente** inserta los 72 partidos de grupos con `home_team/away_team = name_normalised ?? name`, `*_team_code` (de `teams.fifa_code`), `match_time` UTC (convertido de `date`+`time`+timezone), `status='scheduled'`, `matchday` (ronda de grupo 1/2/3 derivada), `stage='group'`, `group_label` y `venue`.
  2. Se siembran los 32 partidos de eliminatoria (R32→Final + 3.º lugar) como placeholders TBD, con `stage ∈ {round-32, round-16, quarter, semi, third-place, final}` y los **códigos de slot del JSON** (`1A`/`2B`/`3X-Y-Z`/`W##`/`L##`) guardados para que el motor (7.3) los resuelva.
  3. `external_ref` se reutiliza como clave estable del seed (`wc2026:grp:*`, `wc2026:ko:*`) y mantiene el `unique` existente.
  4. El seed convive con RLS actual; escritura por migración/`service_role`, no por cliente.
  5. Pruebas de integración: conteos (104 total, 72 grupos, 32 knockout), `group_label`, rondas, jornadas, idempotencia, UTC del inaugural y regresión de `buildStandings`/`buildProjectedStandings`.

#### Story 7.2: Captura y Edición de Resultados por el Administrador

- **As a** administrador de la liga, **I want** capturar/editar marcador y estado de cada partido (`scheduled→live→finished`) desde el panel admin, **So that** clasificación, tabla en vivo y scoring se actualicen con resultados reales sin API externa.
- **AC:**
  1. Admin autenticado en `/standings/manage` ve los partidos (al menos jornada/fase activa) y fija `home_score`, `away_score`, `status`.
  2. Guardado vía RPC `SECURITY DEFINER` admin-gated (patrón Story 3.3): valida rol admin, marcadores ≥0 y transiciones de `status` válidas; sin escritura directa por cliente.
  3. Al pasar a `live`/`finished` con marcador, la **tabla en vivo (4.1/4.2) reacciona por Realtime** (reordena + toast) sin trabajo extra.
  4. Al marcar `finished`, `buildStandings` incorpora el partido (consolidación on-the-fly).
  5. UI mobile-first, tokens Championship Gold, tap targets ≥48px, manejo de error/permiso (no-admin bloqueado).
  6. Pruebas: RPC (admin/no-admin/validaciones) + integración con standings.

#### Story 7.3: Motor Automático de Avance de Fase (Formato FIFA 2026)

- **As a** sistema de la quiniela, **I want** calcular automáticamente la clasificación de cada grupo y el avance a eliminatorias según reglas FIFA 2026, **So that** el bracket se llene solo conforme el admin registra resultados.
- **AC:**
  1. Con los 72 partidos de grupos `finished`, por grupo se ordena con desempates FIFA: puntos → DG → GF → enfrentamiento directo (pts, DG, GF) → … → **desempate determinista de respaldo** (seed/orden estable) para criterios no computables (juego limpio, sorteo).
  2. Clasifican 2 primeros por grupo (24) + **8 mejores terceros** (ranking de los 12 terceros: pts → DG → GF → … → respaldo determinista).
  3. Mapeo de clasificados a slots R32 según la tabla fija del formato 2026 (incluida la asignación oficial de los 8 terceros) y propagación de ganadores R32→R16→Cuartos→Semis→Final (+ 3.º lugar) conforme hay resultados `finished`.
  4. Slots dependientes permanecen TBD hasta completar su fase; motor idempotente y estable.
  5. Cálculo puro/testeable (sin DOM/DB), análogo a `standings.ts`; expone los **límites de fase** (inicio Octavos, inicio Semis) que Epic 6 consume.
  6. Pruebas unitarias exhaustivas: desempates, mejores terceros, llenado de bracket, idempotencia, respaldo determinista.

### 4.2 Edición — `epics.md` (FR mapping y Epic List)

- **Agregar** al final de la lista de Epics: `**Epic 7: Datos del Torneo** — FRs de soporte de datos (reescopa NFR-5).`
- **Anotar** junto al cron en la línea de arquitectura (paso 6): el consumo de API-Football se sustituye por seed + captura admin (Epic 7).

### 4.3 Edición — `architecture.md` (SUPERSEDED del sync API)

- **OLD (≈línea 154):** "**Sincronización Inteligente de Partidos:** Pull-and-Cache cron … cuota gratuita de 100 peticiones diarias de la API deportiva."
- **NEW:** "**[SUPERSEDED 2026-06-04 — ver Epic 7]** El plan Free de API-Football no da acceso a `season=2026`. La fuente de datos pasa a: **seed del calendario** + **captura de resultados por el admin** (RPC admin-gated) + **motor automático de avance de fase**. La tabla en vivo reacciona por Realtime al update del admin. El keep-alive diario (`db-keep-alive.yml`) se conserva."
- Anotaciones análogas en líneas ~52 (cuota API), ~121/125 (cron orquestador), ~153 (`/api/sync`), ~169/181 (GitHub Actions de sync), ~312/358/448 (`/api/sync/route.ts`). **No** tocar las referencias al keep-alive (líneas ~53, ~169 parte SELECT 1, ~288, ~464).

### 4.4 Edición — PRD `addendum.md` y `.decision-log.md`

- **addendum.md §sync (líneas ~22-28) y esquema `matches` (línea ~236-238):** anotar **SUPERSEDED** apuntando a este proposal + Epic 7.
- **.decision-log.md Decision 5:** agregar nota: "2026-06-04 — el sync vía API-Football se reemplaza por seed + captura admin + motor de fases (plan Free sin acceso a season 2026). Ver Epic 7 / sprint-change-proposal-2026-06-04."

---

## 5. PRD MVP Impact y Plan de Acción

- **MVP:** **no se reduce.** Se vuelve más autónomo (sin costo ni rate limits externos). El admin pasa a ser la fuente de verdad de resultados.
- **Plan de acción (secuencia):**
  1. Aplicar ediciones de artefactos (esta propuesta) + actualizar `sprint-status.yaml`.
  2. Cerrar/retomar la **retrospectiva de Epic 4** registrando este descubrimiento.
  3. Ejecutar **Epic 7** (7.1 → 7.2 → 7.3) antes de Epic 5/6.
  4. Epic 6 consume los límites de fase del motor 7.3.
- **Dependencias/secuencia:** 7.1 (seed/schema) → 7.2 (captura admin) y 7.3 (motor) pueden ir en paralelo tras 7.1, pero 7.3 necesita datos `finished` (de 7.2) para verificarse end-to-end.

---

## 6. Handoff

- **Clasificación:** Moderate → **Product Owner / Developer**.
- **Responsabilidades:**
  - *Developer agent:* `create-story` para 7.1 → `dev-story` → `code-review`, en orden.
  - *Project Lead (Cris):* validar el calendario sembrado (equipos/grupos reales del sorteo 2026) y confirmar la tabla fija de asignación de los 8 terceros.
- **Criterios de éxito:** app operativa con datos reales del Mundial 2026 sembrados; admin captura resultados; tabla en vivo + scoring + clasificación reaccionan; bracket se llena solo con reglas FIFA y respaldo determinista.

---

## 7. Aprobación

- [x] **Aprobado por Cris (Project Lead) — 2026-06-04.** Cambios aplicados: Epic 7 agregada a `epics.md` + `sprint-status.yaml`; anotaciones SUPERSEDED en PRD addendum §2, decision-log Decision 5, y arquitectura (`/api/sync` / sync API). Datos reales copiados a `supabase/seed-data/worldcup-2026/`.
