---
baseline_commit: 57ead0b
created: 2026-06-04T20:50:00-04:00
---

# Story 7.3: Motor Automático de Avance de Fase (Formato FIFA 2026)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **sistema de la quiniela**,
I want **calcular automáticamente la clasificación de cada grupo y resolver los equipos reales de los partidos de eliminatoria del Mundial 2026**,
so that **el bracket se llene solo conforme el admin registra resultados, sin intervención manual ni API externa**.

## Contexto y alcance (leer primero)

Esta historia es la tercera pieza del correct-course de Epic 7: 7.1 sembró los 104 partidos reales y placeholders de bracket; 7.2 captura resultados por admin; **7.3 calcula avance de fase y persiste equipos resueltos en `public.matches`**. Es foundational antes de Epic 5 y Epic 6: Epic 5 necesita partidos knockout reales para duelos; Epic 6 necesita límites de fase (inicio de Octavos y Semis) para cerrar/puntuar premios especiales.

**Decisión de implementación:** el algoritmo debe ser **puro y testeable en TypeScript**, análogo a `src/utils/standings.ts`, y la persistencia debe ser una capa fina. No implementar el ranking FIFA en SQL ni como lógica de UI.

**Punto crítico de seguridad:** `public.matches` tiene RLS con solo lectura para `authenticated`; no hay `UPDATE` directo. Para persistir equipos resueltos de knockout, agregar un RPC `SECURITY DEFINER` admin-gated que actualice únicamente campos de participantes de partidos knockout (`home_team`, `away_team`, `home_team_code`, `away_team_code`, `updated_at`) y nunca abra una política `UPDATE`.

**Dependencia con 7.2:** la Server Action que fija resultados (`setMatchResult`/`fn_admin_set_match_result`) debe disparar el recálculo después de un resultado exitoso. Si 7.2 aún no está implementada al empezar dev-story, implementar primero el contrato mínimo de 7.2 o dejar el recálculo expuesto en una acción `recalculateTournamentAdvancement()` y conectarlo en cuanto exista `matches.actions.ts`.

## Acceptance Criteria

1. **Given** los 72 partidos de grupos sembrados con resultados `finished`
   **When** se ejecuta el motor puro
   **Then** devuelve la tabla de cada grupo A-L ordenada por reglas FIFA computables: puntos, diferencia de goles, goles a favor, enfrentamiento directo entre empatados (puntos, DG, GF), y respaldo determinista estable para criterios no disponibles en la app.

2. **And** clasifican exactamente los 2 primeros de cada grupo (24 equipos) más los 8 mejores terceros, ordenando los 12 terceros por puntos, DG, GF y respaldo determinista estable.

3. **And** el motor resuelve códigos de slot:
   - `1X` y `2X` desde el ranking de grupo.
   - `3X/Y/Z` usando la lookup-table oficial FIFA de Annexe C para las 495 combinaciones de mejores terceros.
   - `W##` y `L##` desde ganador/perdedor del partido knockout `bracket_slot=##` cuando ese partido ya está `finished`.
   - Los slots dependientes de resultados incompletos permanecen `"Por definir"` con códigos null.

4. **And** el recálculo es idempotente y estable: ejecutarlo varias veces con los mismos partidos produce la misma salida y no borra resultados, estados, horarios, sources, bracket slots ni sedes.

5. **And** el resultado se persiste en `public.matches` mediante un RPC `SECURITY DEFINER` admin-gated que acepta un payload validado de slots resueltos y actualiza solo partidos knockout. No hay escritura directa del cliente ni nueva política RLS de `UPDATE`.

6. **And** al cambiar un resultado desde el panel admin de 7.2, la Server Action revalida `/standings`, `/standings/manage`, `/predictions` y `/live`, y aplica el recálculo para que los nuevos partidos knockout con equipos reales aparezcan en pronósticos cuando sigan editables por `fn_match_editable`.

7. **And** se exponen límites de fase consumibles por Epic 6: inicio de `round-32`, inicio de `semi`, e indicador de si cada fase está completamente resuelta.

8. **And** existen pruebas unitarias exhaustivas del motor puro: desempates de grupo, head-to-head múltiple, mejores terceros, Annexe C, resolución R32→R16→QF→SF→Final/tercer puesto, idempotencia, fallback determinista y preservación de TBD.

9. **And** existen pruebas de integración del RPC/persistencia: admin sí, no-admin no, anon no, payload inválido no, actualización de un slot knockout, no mutación de partidos de grupo, no borrado de resultados ya capturados, y recálculo tras grupos completos.

## Tasks / Subtasks

- [x] **Tarea 1 — Motor puro de torneo** (AC: #1, #2, #3, #4, #7, #8)
  - [x] Crear `src/utils/tournament-advancement.ts` sin dependencias de DB/DOM.
  - [x] Definir tipos locales claros: `TournamentMatch`, `GroupStandingRow`, `QualifiedTeam`, `ResolvedKnockoutSlot`, `TournamentPhaseBoundaries`.
  - [x] Implementar `buildGroupStandings(matches)` para grupos A-L; solo contar partidos `stage='group'` y `status='finished'` con marcadores enteros.
  - [x] Implementar desempates:
    - puntos: victoria 3, empate 1, derrota 0.
    - diferencia de goles y goles a favor globales.
    - mini-tabla head-to-head entre equipos empatados: puntos, DG, GF solo en partidos entre ellos.
    - fallback determinista: `group_label`, posición estable del seed o `team_code` lexicográfico. Documentar que reemplaza fair play/ranking FIFA porque esos datos no existen en la app.
  - [x] Implementar `rankBestThirds(groupTables)` con los mismos criterios globales aplicables y fallback estable.
  - [x] Implementar `resolveSourceCode(code, context)` para `1A`, `2A`, `3A/B/C/D/F`, `W74`, `L101`.
  - [x] Implementar `calculateTournamentAdvancement(matches)` que retorna:
    - tablas de grupos,
    - clasificados,
    - mejores terceros,
    - slots knockout resueltos,
    - límites de fase (`round32StartAt`, `semiStartAt`) desde `matches.match_time`.

- [x] **Tarea 2 — Lookup FIFA Annexe C de mejores terceros** (AC: #3, #8)
  - [x] Crear una constante versionada en `src/utils/tournament-advancement.ts` o `src/utils/third-place-annex-c.ts`.
  - [x] Transcribir la lookup oficial de Annexe C del reglamento FIFA 2026: columnas de destino `1A`, `1B`, `1D`, `1E`, `1G`, `1I`, `1K`, `1L`; filas por combinación de 8 grupos terceros clasificados.
  - [x] Validar en tests que la tabla contiene 495 combinaciones únicas de 8 grupos entre A-L.
  - [x] Validar que cada `home_source`/`away_source` del JSON que tenga forma `3X/Y/Z` se resuelve contra esa tabla y nunca por heurística.
  - [x] Incluir comentario con fuente oficial: FIFA World Cup 26 Regulations, May 2026, Annexe C.

- [x] **Tarea 3 — Persistencia segura de slots knockout** (AC: #5, #9)
  - [x] Crear `supabase/migrations/<ts>_knockout_advancement_rpc.sql` con timestamp posterior a `20260604140000_admin_match_results_rpc.sql` si esa migración existe.
  - [x] Reutilizar `public.fn_user_is_any_league_admin()` de 7.2; si no existe en el branch, crearla con el mismo contrato de 7.2.
  - [x] Crear `public.fn_admin_apply_knockout_advancement(p_slots jsonb) returns setof public.matches`:
    - `auth.uid()` null -> `42501`.
    - no admin global -> `42501`.
    - payload debe ser array de objetos `{ bracket_slot, home_team, away_team, home_team_code, away_team_code }`.
    - solo permite `bracket_slot` 73-104 y solo filas `stage <> 'group'`.
    - nunca actualiza `home_score`, `away_score`, `status`, `match_time`, `home_source`, `away_source`, `venue`.
    - preserva slots no resueltos como `"Por definir"`/null si el motor así los envía.
    - `updated_at = now()` y `returning *`.
  - [x] Grant execute solo a `authenticated`.
  - [x] No abrir políticas `UPDATE`/`DELETE` sobre `matches`.

- [x] **Tarea 4 — Conexión con Server Action de resultados** (AC: #5, #6, #7)
  - [x] Crear o extender `src/app/actions/matches.actions.ts`:
    - después de `fn_admin_set_match_result` exitoso, cargar los 104 partidos `wc2026:%` necesarios para el motor.
    - llamar `calculateTournamentAdvancement`.
    - llamar `fn_admin_apply_knockout_advancement` con slots resultantes.
    - retornar `ServerActionResult<Match>` y nunca lanzar al cliente.
  - [x] Si se prefiere separar responsabilidades, crear `recalculateTournamentAdvancement(): Promise<ServerActionResult<ResolvedKnockoutSlot[]>>` y llamarla desde `setMatchResult`.
  - [x] Revalidar `/standings`, `/standings/manage`, `/predictions` y `/live`.
  - [x] Mapear `42501` a "No autorizado" y errores de validación a mensaje genérico seguro, siguiendo `leagues.actions.ts`.
  - [x] Confirmar que `PredictionsBoard` ya filtra `.not("home_team_code","is",null).not("away_team_code","is",null)`; por tanto, al resolver un knockout scheduled con códigos reales, aparecerá automáticamente para pronósticos si `fn_match_editable` lo permite.

- [x] **Tarea 5 — Pruebas unitarias exhaustivas** (AC: #1, #2, #3, #4, #7, #8)
  - [x] Crear `src/utils/tournament-advancement.test.ts` o `tests/unit/tournament-advancement.test.ts`.
  - [x] Cubrir ranking básico de grupo: victorias, empates, GF/GA/GD.
  - [x] Cubrir empate a 2 y 3 equipos con mini-tabla head-to-head.
  - [x] Cubrir fallback determinista cuando persiste empate tras head-to-head.
  - [x] Cubrir ranking de mejores terceros con 12 terceros y selección exacta de 8.
  - [x] Cubrir al menos 3 combinaciones Annexe C: una con `3A/B/C/D/F`, una con `3C/E/F/H/I`, una con grupos altos (`3D/E/I/J/L`).
  - [x] Cubrir propagación `W##`/`L##` para R16, QF, SF, final y tercer puesto.
  - [x] Cubrir idempotencia: snapshot de salida igual con el mismo input.
  - [x] Cubrir incompletitud: grupos no completos y knockout no terminado mantienen slots TBD.

- [x] **Tarea 6 — Pruebas de integración DB/RPC** (AC: #5, #6, #9)
  - [x] Crear `tests/integration/knockout-advancement.test.ts` siguiendo patrones `member-admin-management.test.ts` y `worldcup-seed.test.ts`.
  - [x] Casos RPC: admin puede aplicar slots; member/no-admin recibe `42501`; anon falla; payload no-array falla; `bracket_slot` fuera de 73-104 falla; intento de mutar grupo no muta nada.
  - [x] Caso end-to-end de persistencia: preparar resultados de grupo con `service_role`, ejecutar acción/RPC de avance, verificar que R32 tiene equipos/códigos reales en slots resolubles.
  - [x] Verificar que re-ejecutar el RPC con el mismo payload no cambia conteos ni borra resultados de partidos ya `finished`.
  - [x] Limpiar cualquier partido creado por tests; si se usan filas seed `wc2026:%`, encapsular en `begin/rollback` o restaurar estado.

- [x] **Tarea 7 — Verificación final** (AC: #8, #9)
  - [x] `source ~/.nvm/nvm.sh && nvm use 24`
  - [x] `npx supabase db reset`
  - [x] `npm run db:types`
  - [x] `npm run lint`
  - [x] `npm run typecheck`
  - [x] `npm run build`
  - [x] `npm run test:unit`
  - [x] `npm run test:integration`

### Review Findings

- [x] [Review][Patch] Mantener resultado guardado exitoso aunque falle el recálculo, exponiendo el fallo de avance como aviso/reintento separado [src/app/actions/matches.actions.ts:121]
- [x] [Review][Patch] Bloquear `finished` empatado en partidos knockout hasta modelar penales/ganador explícito [supabase/migrations/20260604140000_admin_match_results_rpc.sql:115]
- [x] [Review][Patch] Acotar el RPC de avance al calendario `wc2026:%` [supabase/migrations/20260604143000_knockout_advancement_rpc.sql:54]
- [x] [Review][Patch] Revocar `EXECUTE` implícito de `PUBLIC`/`anon` antes de concederlo a `authenticated` [supabase/migrations/20260604143000_knockout_advancement_rpc.sql:78]
- [x] [Review][Patch] Validar payload del RPC por slot único, campos requeridos y consistencia nombre/código [supabase/migrations/20260604143000_knockout_advancement_rpc.sql:35]
- [x] [Review][Patch] Completar cobertura AC #8/#9: 3 combinaciones Annexe C, cadena R32→R16→QF→SF→Final/tercer puesto, TBD por grupos incompletos, no mutación de grupos, payload con campos faltantes y recálculo tras grupos completos [tests/unit/tournament-advancement.test.ts:174]
- [x] [Review][Patch] Limpiar ligas creadas por tests de integración 7.3 o eliminar `createdLeagueIds` si el cleanup depende de cascadas explícitas [tests/integration/knockout-advancement.test.ts:12]

## Dev Notes

### Estado actual del proyecto

- Stack instalado localmente: Next.js `16.2.7`, React `19.2.7`, `@supabase/supabase-js` `2.107.0`, `@supabase/ssr` `0.10.3`, TypeScript `5.9.3`, Vitest `4.1.8` (`npm ls --depth=0`, 2026-06-04).
- Toolchain: usar `source ~/.nvm/nvm.sh && nvm use 24` antes de Supabase/tests. Supabase CLI vía `npx supabase ...`.
- `project-context.md` no existe en el repo; no hay facts persistentes adicionales cargados por el workflow.

### Datos y esquema que NO se deben reinventar

`public.matches` ya es la fuente única del calendario:

```
id, external_ref, home_team, away_team, home_team_code, away_team_code,
home_score, away_score, match_time, status, matchday, stage,
group_label, bracket_slot, home_source, away_source, venue, created_at, updated_at
```

- 7.1 sembró 104 partidos: 72 `stage='group'` y 32 knockout con `bracket_slot` 73-104.
- Los knockout TBD usan `home_team/away_team = 'Por definir'` y códigos null.
- `home_source`/`away_source` guardan códigos como `1A`, `2B`, `3A/B/C/D/F`, `W74`, `L101`; esos códigos son la entrada del motor.
- `external_ref='wc2026:ko:<num>'` y `bracket_slot=<num>` son claves estables; no agregar otra tabla de calendario.
- `fn_match_editable` bloquea predicciones de knockout mientras falten códigos reales. Cuando 7.3 llene `home_team_code` y `away_team_code`, el partido scheduled vuelve a ser pronosticable si aún no está cerrado por kickoff.
- `PredictionsBoard` ya filtra partidos scheduled con códigos no-null; no necesita heurísticas extra para detectar TBD.

### Reglas FIFA y alcance computable

El reglamento oficial FIFA World Cup 26 (May 2026) define que el torneo tiene fase de grupos y knockout, que pasan 2 primeros + 8 mejores terceros, y que Annexe C contiene las 495 combinaciones posibles de terceros y su matchup de R32. Para el ranking de grupo, el documento oficial incluye criterios computables y criterios no disponibles en la app (fair play y ranking FIFA). En esta app:

- Computar: puntos, diferencia de goles, goles a favor, head-to-head entre empatados.
- No computar todavía: fair play, rankings FIFA publicados sucesivos, sorteo/decisión FIFA.
- Resolver lo no computable con fallback determinista estable y visible en tests. No usar `Math.random`, orden de array original no documentado, ni reloj.

### Detalles de resolución de slots

- `1X`: primero del grupo X.
- `2X`: segundo del grupo X.
- `3A/B/C/D/F`: se resuelve consultando la Annexe C para la combinación exacta de los 8 terceros clasificados. El destino se identifica por la columna del partido cuyo `home_source` o `away_source` contiene el set de grupos.
- `W##`: ganador del partido knockout con `bracket_slot=##`, solo si `status='finished'` y hay marcador entero.
- `L##`: perdedor del partido knockout con `bracket_slot=##`, solo si `status='finished'` y hay marcador entero.
- Empates en knockout no deberían persistir como `finished` sin ganador. Si aparecen, el motor debe dejar dependientes TBD y reportar advertencia/estado incompleto; no inventar ganador por fallback.

### Persistencia y seguridad

- No abrir RLS `UPDATE` sobre `matches`.
- No usar `service_role` en runtime de la app.
- La persistencia de avance es admin-gated porque el disparador real será el admin que captura resultados en 7.2.
- El RPC de avance debe ser deliberadamente estrecho: solo actualiza participantes de knockout, no resultados.
- Si el payload manda `"Por definir"`/null para un slot dependiente incompleto, está permitido; eso conserva el estado TBD.

### Integración con 7.2

Existe una migración local no rastreada `supabase/migrations/20260604140000_admin_match_results_rpc.sql` con `fn_user_is_any_league_admin()` y `fn_admin_set_match_result(...)`. La story 7.3 debe construir encima de ese contrato si ya está presente. Si el dev-story empieza antes de que 7.2 termine, no duplicar nombres ni cambiar semánticas; coordinar con esa migración.

La acción de resultados debe aplicar este orden:

1. validar input de resultado,
2. llamar `fn_admin_set_match_result`,
3. si success, cargar partidos `wc2026:%`,
4. calcular avance puro,
5. llamar `fn_admin_apply_knockout_advancement`,
6. revalidar rutas,
7. devolver `ServerActionResult`.

### Pruebas y calidad

- Tests unitarios del motor puro deben ser la red de seguridad principal; no depender de Supabase para probar combinatoria de fútbol.
- Tests de integración solo validan permisos/persistencia/RLS y un flujo representativo.
- Mantener fixtures pequeños y legibles para desempates; para Annexe C, validar cobertura de tabla con asserts de conteo + combinaciones puntuales.
- No agregar librerías nuevas para combinatoria; TypeScript/arrays/maps bastan.

### Project Structure Notes

Archivos **NUEVOS** esperados:

- `src/utils/tournament-advancement.ts`
- `src/utils/tournament-advancement.test.ts` o `tests/unit/tournament-advancement.test.ts`
- `src/utils/third-place-annex-c.ts` si se separa la tabla
- `supabase/migrations/<ts>_knockout_advancement_rpc.sql`
- `tests/integration/knockout-advancement.test.ts`

Archivos **MODIFICADOS** esperados:

- `src/app/actions/matches.actions.ts` (crearlo si 7.2 aún no lo creó)
- `src/types/database.types.ts` tras `npm run db:types`
- `src/types/index.ts` solo si hace falta exportar tipos de dominio nuevos
- Posible `src/app/predictions/page.tsx` solo si se detecta un bug en el filtro actual; por ahora ya filtra códigos no-null.

Archivos que **NO** se deben tocar salvo bug demostrado:

- `scripts/generate-worldcup-seed.mjs`
- `supabase/migrations/20260604131000_seed_worldcup_2026.sql`
- `src/utils/standings.ts`
- `src/utils/scoring.ts`
- Código de tabla en vivo (`src/components/live/*`)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.3: Motor Automático de Avance de Fase]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-06-04.md]
- [Source: _bmad-output/implementation-artifacts/7-1-seed-del-calendario-y-modelo-de-fases-grupos-bracket.md]
- [Source: _bmad-output/implementation-artifacts/7-2-captura-y-edicion-de-resultados-por-el-administrador.md]
- [Source: supabase/migrations/20260604130000_matches_tournament_model.sql]
- [Source: supabase/migrations/20260604131000_seed_worldcup_2026.sql]
- [Source: supabase/migrations/20260604132000_block_tbd_knockout_predictions.sql]
- [Source: supabase/migrations/20260604140000_admin_match_results_rpc.sql]
- [Source: supabase/seed-data/worldcup-2026/worldcup.json]
- [Source: scripts/generate-worldcup-seed.mjs]
- [Source: src/app/predictions/page.tsx]
- [Source: src/utils/standings.ts]
- [Source: src/utils/scoring.ts]
- [Source: tests/integration/worldcup-seed.test.ts]
- [Source: tests/integration/member-admin-management.test.ts]
- [Source: FIFA World Cup 26 Regulations, May 2026: https://digitalhub.fifa.com/m/636f5c9c6f29771f/original/FWC2026_regulations_EN.pdf]
- [Source: FIFA Draw Procedures for the FIFA World Cup 2026: https://digitalhub.fifa.com/m/2d1a1ac7bab78995/original/Draw-Procedures-for-the-FIFA-World-Cup-2026.pdf]

## Git Intelligence (commits recientes relevantes)

- `57ead0b` Implement World Cup 2026 calendar seed — base directa de `matches`, seed y bloqueo TBD.
- `f466f15` feat: notificaciones "Impacto de Gol" en vivo — confirma que la tabla en vivo reacciona a cambios en `matches`.
- `e396b98` feat: add live projected standings — patrón de cálculo cliente/puro y Realtime.
- `babb4f3` feat: panel de administración y control de pagos — patrón RPC `SECURITY DEFINER` + UI/Server Action admin.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run --project unit tests/unit/tournament-advancement.test.ts` — rojo inicial por módulo inexistente; luego 7 tests verdes.
- `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run --project integration tests/integration/knockout-advancement.test.ts` — rojo inicial por RPC ausente (`PGRST202`); luego 5 tests verdes tras migración.
- `source ~/.nvm/nvm.sh && nvm use 24 && npx supabase db reset` — migración `20260604143000_knockout_advancement_rpc.sql` aplicada correctamente.
- `source ~/.nvm/nvm.sh && nvm use 24 && npm run db:types` — tipos Supabase regenerados con `fn_admin_apply_knockout_advancement`.
- `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run --project unit tests/unit/tournament-advancement.test.ts tests/unit/matches-actions.test.ts` — 2 archivos / 8 tests verdes.
- `source ~/.nvm/nvm.sh && nvm use 24 && npm run lint` — verde tras remover import no usado.
- `source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck` — verde.
- `source ~/.nvm/nvm.sh && nvm use 24 && npm run build` — verde.
- `source ~/.nvm/nvm.sh && nvm use 24 && npm run test:unit` — 31 archivos / 229 tests verdes; aviso no bloqueante de jsdom canvas.
- `source ~/.nvm/nvm.sh && nvm use 24 && npm run test:integration` — 16 archivos / 78 tests verdes.
- `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run --project unit tests/unit/tournament-advancement.test.ts tests/unit/matches-actions.test.ts` — review patch: 2 archivos / 10 tests verdes.
- `source ~/.nvm/nvm.sh && nvm use 24 && npx supabase db reset` — review patch: migraciones 7.2/7.3 aplicadas correctamente.
- `source ~/.nvm/nvm.sh && nvm use 24 && npx vitest run --project integration tests/integration/admin-match-results.test.ts tests/integration/knockout-advancement.test.ts` — review patch: 2 archivos / 20 tests verdes.
- `source ~/.nvm/nvm.sh && nvm use 24 && npm run lint` — review patch verde.
- `source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck` — review patch verde.
- `source ~/.nvm/nvm.sh && nvm use 24 && npm run build` — review patch verde.
- `source ~/.nvm/nvm.sh && nvm use 24 && npm run test:unit` — review patch: 31 archivos / 231 tests verdes; aviso no bloqueante de jsdom canvas.
- `source ~/.nvm/nvm.sh && nvm use 24 && npm run test:integration` — review patch: 16 archivos / 81 tests verdes.

### Completion Notes List

- Implementado motor puro `calculateTournamentAdvancement` para ranking de grupos A-L, mejores terceros, resolución de `1X`/`2X`/`3X/Y/Z`/`W##`/`L##`, slots TBD e indicadores de límites de fase.
- Generada lookup oficial Annexe C desde FIFA World Cup 26 Regulations (May 2026): 495 combinaciones únicas validadas por unit tests.
- Agregado RPC `fn_admin_apply_knockout_advancement(jsonb)` con `SECURITY DEFINER`, gate admin global, payload validado y UPDATE limitado a participantes knockout 73-104.
- Extendida `setMatchResult` para disparar recálculo de avance tras captura de resultado exitosa y revalidar `/standings`, `/standings/manage`, `/predictions` y `/live`.
- Añadidas pruebas unitarias para motor puro y Server Action; añadidas pruebas de integración para permisos/persistencia/idempotencia del RPC.
- Review patch aplicado: el guardado de marcador queda exitoso con warning si falla el avance, se bloquea empate `finished` en knockout, el RPC queda acotado a `wc2026:ko:<slot>` con payload estricto y se amplió la cobertura AC #8/#9.

### File List

- `_bmad-output/implementation-artifacts/7-3-motor-automatico-de-avance-de-fase-formato-fifa-2026.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `src/app/actions/matches.actions.ts`
- `src/components/standings/MatchAdminList.tsx`
- `src/types/database.types.ts`
- `src/types/index.ts`
- `src/utils/third-place-annex-c.ts`
- `src/utils/tournament-advancement.ts`
- `supabase/migrations/20260604140000_admin_match_results_rpc.sql`
- `supabase/migrations/20260604143000_knockout_advancement_rpc.sql`
- `tests/integration/admin-match-results.test.ts`
- `tests/integration/knockout-advancement.test.ts`
- `tests/unit/matches-actions.test.ts`
- `tests/unit/tournament-advancement.test.ts`

## Change Log

| Fecha | Versión | Descripción | Autor |
| --- | --- | --- | --- |
| 2026-06-04 | 0.1 | Story context creada para motor puro de avance FIFA 2026, lookup Annexe C, persistencia admin-gated de slots knockout e integración con captura de resultados 7.2. | BMad Create-Story |
| 2026-06-04 | 1.0 | Implementada Story 7.3: motor puro, Annexe C, RPC admin-gated, integración con Server Action y pruebas unitarias/integración. | Codex |
| 2026-06-04 | 1.1 | Aplicados hallazgos de code review: warning de avance, bloqueo de empate knockout, hardening del RPC y cobertura adicional. | Codex |

## Completion Note

Ultimate context engine analysis completed - comprehensive developer guide created.
