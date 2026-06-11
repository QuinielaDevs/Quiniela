# Fase 7 — Premios especiales: campeón, goleador y MVP con recompensa decreciente

## Objetivo
Cubrir `/awards`: selección y cambio de candidatos por categoría, recompensa según la fase activa (A=50, B=25, C=10), bloqueo total en fase D, resolución con ganadores oficiales y el alcance **per-league** de las predicciones.

## Dependencias
Fases 1-2 (helpers `seed/phases.ts` y `seed/awards.ts` de la Fase 1 son la palanca central aquí).

## Contexto requerido
- `00-contexto.md` §4.6 y trampa §7.5 (mover ventanas de `tournament_phases` y RESTAURAR siempre).
- **Las predicciones especiales son por liga, no globales** (UNIQUE(user_id, league_id, category)): un usuario en 2 ligas puede predecir distinto en cada una.
- Leer: `src/components/awards/AwardsBoard.tsx`, `AwardSelector.tsx`, `CandidatePicker.tsx`, `src/app/awards/page.tsx`, el action de special predictions (`src/app/actions/`), `src/config/tournamentPhases.ts`, migraciones `20260603015739_special_awards_schema.sql`, `20260603155843_tournament_phases_schema.sql` (triggers `fn_touch_special_prediction`, `fn_check_awards_locked`), vista `special_predictions_with_points`, y **dónde se muestran los puntos de premios al usuario** (¿standings? ¿account? — investigar antes de AWD-08).

## Convención de la fase
Snapshot de `tournament_phases` en `beforeAll`, restauración en `afterAll` (pase lo que pase: usar `cleanup` LIFO). Los candidatos vienen del seed.sql (`award_candidates`) — no crear candidatos nuevos salvo para AWD-09.

## Casos de prueba (`tests/e2e/awards.spec.ts`)

| ID | Caso | Setup | Acción/Verificación |
|---|---|---|---|
| AWD-01 | El board lista las 3 categorías con candidatos | fase A activa | `award-category` para champion/top_scorer/mvp; `candidate-option` poblados desde `award_candidates` |
| AWD-02 | Seleccionar campeón persiste | fase A | elegir candidato → `selected-candidate` lo muestra; reload conserva; BD: fila en `special_predictions` con `predicted_at` reciente (servidor) |
| AWD-03 | Cambiar selección sobrescribe | tras AWD-02 | elegir otro → sigue habiendo UNA fila por categoría; `predicted_at` actualizado (trigger touch) |
| AWD-04 | Goleador y MVP funcionan igual | fase A | una selección por cada categoría; 3 filas en total |
| AWD-05 | Puntos potenciales según fase activa | fase A→B→C (mover ventanas entre asserts, con reload) | `award-phase-points` muestra 50, luego 25, luego 10 (o el formato real del componente) |
| AWD-06 | La recompensa se fija por `predicted_at`, no por la fase actual | sembrar via service role 3 predicciones del mismo usuario en ligas distintas con `predicted_at` dentro de A, B y C; marcar al candidato como ganador | la vista/UI da 50, 25 y 10 respectivamente para la MISMA categoría según el momento de la predicción |
| AWD-07 | Fase D bloquea todo | activar fase D (`edits_locked`) | UI: `award-locked-notice` visible, opciones no interactivas; servidor: intento de cambio (vía UI forzada o action) rechazado por el trigger con error claro |
| AWD-08 | Resolución con ganador oficial | `setWinner('champion', X)`; usuario predijo X en fase A | donde el producto muestre los puntos de premios (investigado antes), aparecen 50 pts; quien predijo otro candidato: 0 |
| AWD-09 | Candidato inactivo no listado | `is_active=false` en un candidato (con restore) | no aparece en `candidate-option` |
| AWD-10 | Orden de candidatos | — | respeta `display_order` (favoritos primero) |
| AWD-11 | Alcance per-league | usuario en 2 ligas; predicción distinta en cada una | cada liga muestra su propia selección; BD: 2 filas independientes |
| AWD-12 | Sin selección → estado vacío claro | usuario nuevo | el board invita a elegir, sin errores |

## Criterios de aceptación (DoD)
1. 12 casos verdes 3 ejecuciones seguidas.
2. **`tournament_phases` queda EXACTAMENTE como estaba** tras la suite (assert final del spec comparando contra el snapshot — es estado global; dejarlo sucio rompe otras fases).
3. `award_candidates` restaurado (winners/inactivos).
4. Suite completa + lint + typecheck verdes; notas de ejecución (dónde se muestran los puntos de premios, formato real de AWD-05).

## Riesgos y notas
- Mover ventanas de fases afecta también al multiplicador NO (son sistemas distintos) pero sí al candado de premios y a cualquier UI que muestre "fase actual" — por eso este spec debe restaurar estado incluso si falla a mitad (cleanup robusto).
- AWD-06 siembra `predicted_at` directamente via service role porque el trigger lo fija a `now()` en flujo normal — es la única forma de construir el escenario histórico.
- Si la UI no muestra los puntos de premios en ningún sitio aún (posible gap de producto), AWD-08 se verifica contra la vista `special_predictions_with_points` en BD y se registra el gap de UI en `BUGS.md` como observación.

## Notas de ejecución
- **Fecha de ejecución**: 2026-06-10
- **Resultado de la suite**: 12 tests en verde (1 skipped `BUG-003`).
- **Gaps y Desviaciones de Producto**:
  1. **BUG-003**: En la ruta standalone `/awards`, el componente `AwardsBoard` no recibe el prop `activePhaseCode` desde `src/app/awards/page.tsx`, lo que provoca que se renderice siempre en la fase por defecto `"D"` y se resalte dicha fase en la tabla de puntos decrecientes, incluso cuando la fase activa en base de datos es A, B o C. La ruta de `/predictions` tab `"Premios Copa"` sí pasa el prop correctamente y ha sido utilizada para verificar el comportamiento de AWD-05 de forma reactiva. **Corregido el 2026-06-11** (ver `BUGS.md`): `/awards` ya pasa el prop y el test "BUG-003" quedó reactivado.
  2. **BUG-004**: Los puntos acumulados por los premios especiales no se muestran en ninguna parte de la UI (ni en standings, ni en account). Por esta razón, AWD-06 y AWD-08 han sido verificados consultando directamente la base de datos a través de la vista `special_predictions_with_points` con el cliente `service_role`.
- **Estrategia E2E de tiempo decreciente (AWD-06)**: Para probar de manera determinista y veloz (sin esperar horas reales) que la recompensa se congela al momento de hacer la predicción según la fase activa, se sembraron 3 predicciones en 3 ligas con esperas de 2 segundos. Posteriormente, se actualizaron las fechas de `tournament_phases` en la base de datos para que los límites temporales dividieran exactamente estos timestamps.
- **Takover del Dev Server de Next.js**: Se implementó la selección de elementos `data-testid="awards-board"` anclada al `<main>` (`page.getByRole("main").getByTestId("awards-board")`) para evitar duplicidad de elementos del DOM por la hidratación retrasada.

