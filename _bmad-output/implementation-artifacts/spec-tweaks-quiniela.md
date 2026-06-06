---
title: 'Ajustes y Mejoras de la Quiniela'
type: 'bugfix'
created: '2026-06-06'
status: 'done'
baseline_commit: 'f3111a41ecb1b59aa539ff1f92ba47f246556d36'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** La quiniela presenta varios detalles de UI (cards cortados en desktop, barra de jornadas asfixiada y rígida, desalineación de tarjetas al guardar, e inconsistencia de pestaña activa al visitar la tabla en vivo) y una desviación en la regla de multiplicadores por antelación, que actualmente se miden respecto al inicio del torneo y no por cada partido individual como especifica el PRD.

**Approach:** Solucionar los problemas de CSS y layouts responsive, ajustar el BottomNavbar para mantener activa la pestaña de Posiciones al estar en /live con un botón Volver en cabecera, añadir un timeout de 3 segundos para el estado "Guardado ✓", incrementar el debounce de autoguardado a 1500ms y revertir el cálculo de multiplicador a la fecha de kickoff individual de cada partido en frontend y base de datos.

## Boundaries & Constraints

**Always:**
- El cálculo de multiplicador debe ser idéntico en frontend (TypeScript) y backend (PostgreSQL) para evitar discrepancias de puntuación.
- Los tests existentes (unitarios e integración) deben ejecutarse y quedar en verde o ser adaptados a la lógica por partido individual.

**Ask First:**
- Cualquier cambio adicional a la escala de multiplicadores canon (2.5x a 1.0x).

**Never:**
- No usar librerías de terceros para la barra de scroll de jornadas.
- No romper la RLS ni la política gated de lectura de predicciones de rivales.

</frozen-after-approval>

## Code Map

- `src/app/predictions/page.tsx` -- Página de pronósticos; define el layout y el padding de main en desktop.
- `src/components/ui/ScrollableTabs.tsx` -- Barra de navegación por jornadas; define su diseño, bordes y padding.
- `src/components/layout/BottomNavbar.tsx` -- Barra de navegación inferior móvil; define la pestaña activa.
- `src/app/live/page.tsx` -- Página de la tabla en vivo; contiene la cabecera donde se insertará el botón Volver.
- `src/utils/scoring.ts` -- Lógica puramente matemática del multiplicador en TS.
- `src/components/predictions/MatchCard.tsx` -- Componente de tarjeta de partido; maneja el debounce de autoguardado, el estado de guardado y su visualización temporal.
- `supabase/migrations/20260605000000_update_lock_and_multiplier.sql` -- Migración que definió la función del multiplicador en la base de datos PostgreSQL.

## Tasks & Acceptance

**Execution:**
- [x] `src/app/predictions/page.tsx` -- Modificar `lg:py-10` a `lg:pt-10 lg:pb-28` en el elemento `<main>` para evitar que el BottomNavbar oculte las últimas tarjetas en desktop.
- [x] `src/components/ui/ScrollableTabs.tsx` -- Añadir padding vertical (`py-1.5`) y un track con diseño de bordes redondeados (`rounded-full border border-border bg-card p-1 shadow-sm`) para quitar el aspecto plano y asfixiado.
- [x] `src/components/layout/BottomNavbar.tsx` -- Ajustar `isActive` para que coincida con `/standings` incluso cuando el `pathname` es `/live`.
- [x] `src/app/live/page.tsx` -- Añadir un botón visual y accesible de "Volver" a `/standings` en la cabecera de la página.
- [x] `src/utils/scoring.ts` -- Modificar `calculatePredictionMultiplier` para que ignore `firstMatchTime` (o calcule los días de antelación respecto al kickoff de cada partido `matchTime` directamente).
- [x] `src/components/predictions/MatchCard.tsx` -- Cambiar `DEBOUNCE_MS` de `500` a `1500` y añadir un `useEffect` que regrese el `saveState` a `"idle"` después de 3000ms una vez guardado con éxito.
- [x] `supabase/migrations/20260606150000_revert_multiplier_to_match_time.sql` -- Crear una nueva migración que redefina `public.fn_prediction_multiplier(p_match_time timestamptz)` para que use `p_match_time - now()` en lugar de `v_first_match_time - now()`.

**Acceptance Criteria:**
- Given la página de pronósticos en resolución de desktop, when se realiza scroll hasta el final, then las tarjetas de la última fila son completamente visibles sobre el BottomNavbar.
- Given el BottomNavbar en la página `/live`, when se carga la página, then la pestaña de "Posiciones" se muestra como activa y al presionarla se navega a `/standings`.
- Given el GoalPicker de una predicción, when el usuario modifica un marcador, then la petición de guardado se debounea por 1500ms, y al guardarse muestra "Guardado ✓" con borde verde durante 3 segundos para después regresar silenciosamente al estado idle (sin texto y con borde normal).
- Given una predicción realizada hoy para un partido de Jornada 3 en 18 días, when se calcula el multiplicador en frontend y backend, then este refleja el umbral correspondiente a 18 días (1.6x) y no 1.0x.

## Design Notes

El autodesvanecimiento del estado de guardado tras 3 segundos se implementa en `MatchCard.tsx` mediante un timeout de React:
```typescript
useEffect(() => {
  if (saveState === "saved") {
    const timer = setTimeout(() => {
      setSaveState("idle");
    }, 3000);
    return () => clearTimeout(timer);
  }
}, [saveState]);
```

## Verification

**Commands:**
- `npm run lint` -- expected: SUCCESS
- `npm run typecheck` -- expected: SUCCESS
- `npx vitest run --project unit` -- expected: SUCCESS (actualizar tests de multiplicador a la nueva escala basada en fecha de partido individual)

## Suggested Review Order

**Visuales y Layout**

- Padding responsivo en desktop para evitar recortes de tarjetas:
  [`page.tsx:145`](../../src/app/predictions/page.tsx#L145)

- Track redondeado con sombreado y padding para la barra de jornadas:
  [`ScrollableTabs.tsx:67`](../../src/components/ui/ScrollableTabs.tsx#L67)

- Reset de estado "saved" a "idle" tras 3 segundos para evitar desalineación permanente:
  [`MatchCard.tsx:323`](../../src/components/predictions/MatchCard.tsx#L323)

**Navegación en Vivo**

- Highlight de pestaña Posiciones cuando la ruta del usuario es /live:
  [`BottomNavbar.tsx:34`](../../src/components/layout/BottomNavbar.tsx#L34)

- Botón de cabecera "Volver" en la vista en vivo:
  [`page.tsx:146`](../../src/app/live/page.tsx#L146)

**Mecánica del Multiplicador**

- Lógica de cálculo basada en kickoff de partido individual en TS:
  [`scoring.ts:120`](../../src/utils/scoring.ts#L120)

- Redefinición de la función de base de datos SQL para coincidir con TS:
  [`20260606150000_revert_multiplier_to_match_time.sql:5`](../../supabase/migrations/20260606150000_revert_multiplier_to_match_time.sql#L5)

**Autoguardado y Tests**

- Aumento del debounce a 1500ms para mitigar carga en Supabase:
  [`MatchCard.tsx:55`](../../src/components/predictions/MatchCard.tsx#L55)

- Actualización de intervalos de avance de tiempo en la suite de pruebas unitarias:
  [`MatchCard.test.tsx:99`](../../src/components/predictions/MatchCard.test.tsx#L99)
