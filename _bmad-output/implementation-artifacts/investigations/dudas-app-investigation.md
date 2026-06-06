# Investigation: Dudas e Inconsistencias de la App

## Hand-off Brief

1. **What happened.** El usuario Cris plantea varias dudas y reporta posibles fallos de visualización, comportamiento de UI y lógica de negocio (multiplicadores, tiempos de autoguardado, rondas bloqueadas y costos de cuotas API).
2. **Where the case stands.** Completado el análisis de código. Se identificaron las causas de todos los problemas y dudas (ajuste de padding en desktop, comportamiento del BottomNavbar, origen de la escala del multiplicador y comportamiento en Windows, y mecanismo de avance de rondas).
3. **What's needed next.** Presentar los hallazgos y alternativas de solución al usuario y proceder con los arreglos aprobados.

## Case Info

| Field            | Value                                                                      |
| ---------------- | -------------------------------------------------------------------------- |
| Ticket           | N/A                                                                        |
| Date opened      | 2026-06-06                                                                 |
| Status           | Active                                                                     |
| System           | Windows, Next.js / React                                                   |
| Evidence sources | Código fuente, historial de control de versiones y especificaciones.        |

## Problem Statement

El usuario reporta las siguientes dudas e inconsistencias en la aplicación:
- **Arreglos / Vista web**:
  - No se ven los cards completamente (se ven hasta casi la mitad) al final de la pagina (al hacer scroll hasta el fondo).
  - No se ven los iconos de los paises (en la version mobile si se ven).
- **Arreglos / General**:
  - La barra de jornadas puede mejorarse, se ve como asfixiada, necesita mas espacio, se ve como muy cuadrada y no es acorde a al resto de interfaz.
  - En la vista posiciones, al darle al boton ‘en vivo’ deja de mostrar como seleccionada la tab de posiciones.
  - Como estamos manejando las reglas del multiplicador? en la jornada 3 que faltan 18 dias se sigue viendo 1.0x en la interfaz.
  - Cambiar la actualizacion cada 500ms porque una persona puede durar mas subiendo y bajando marcadores, deberiamos agregar un boton de guardar?
  - Que mecanismo tenemos para activar las rondas de clasificacion que actualmente estan bloqueadas? tenemos pruebas para eso?
  - El 1.0x que muestra la interfaz es en relacion a lo que actualmente valdria el cambio si lo hace en ese momento o a lo que ya esta guardado en la base de datos?
  - La alineacion del card se rompe con el ‘Guardado ✅’.
- **Consumo de cuotas**:
  - ¿Actualizar multiples pronosticos puede agotar la cuota de los free tier?

## Evidence Inventory

| Source   | Status                          | Notes     |
| -------- | ------------------------------- | --------- |
| Codebase | Available                       | Acceso completo a archivos del proyecto. |

## Investigation Backlog

| #  | Path to Explore | Priority | Status | Notes |
| -- | --------------- | -------- | ------ | ----- |
| 1  | Investigar vista web: cards cortados al final de la página | High | Done | Resuelto: padding responsive override (`lg:py-10`). |
| 2  | Investigar vista web: iconos de países no visibles | High | Done | Resuelto: Limitación de Windows con emojis de banderas. |
| 3  | Investigar barra de jornadas: diseño y espacio | Medium | Done | Resuelto: Falta de padding en `ScrollableTabs.tsx`. |
| 4  | Investigar vista posiciones: botón 'en vivo' desactiva tab | High | Done | Resuelto: Match estricto de ruta en `BottomNavbar.tsx`. |
| 5  | Investigar reglas del multiplicador: jornada 3 (18 días) muestra 1.0x | High | Done | Resuelto: Commit `1e5dec6` cambió la referencia al primer partido. |
| 6  | Investigar autoguardado: cambiar de 500ms a botón de guardar | High | Done | Resuelto: Explicado comportamiento de debounce y alternativas. |
| 7  | Investigar activación de rondas de clasificación bloqueadas y pruebas | High | Done | Resuelto: Controlado por `fn_admin_apply_knockout_advancement` y probado en `tests/integration/knockout-advancement.test.ts`. |
| 8  | Investigar origen del 1.0x del multiplicador en la interfaz | High | Done | Resuelto: Muestra `savedMultiplier` o `nextMultiplier`. Ambos usan la lógica del primer partido. |
| 9  | Investigar desalineación de card con 'Guardado ✅' | Medium | Done | Resuelto: Clics e inserción dinámica de texto causan wrap. |
| 10 | Investigar cuota free-tier con múltiples pronósticos | High | Done | Resuelto: No agota cuotas de API externa, pero puede saturar conexiones de Supabase. |

## Timeline of Events

| Time        | Event               | Source                | Confidence            |
| ----------- | ------------------- | --------------------- | --------------------- |
| 2026-06-06  | Inicio de la investigación | Solicitud del usuario | Confirmed             |
| 2026-06-06  | Análisis de código y logs | Git history & Code    | Confirmed             |

## Confirmed Findings

### Finding 1: Padding responsive override en `PredictionsPage`
- **Evidence:** `src/app/predictions/page.tsx:145`
- **Detail:** La clase `lg:py-10` en el elemento `<main>` sobrescribe la clase `pb-24` en pantallas grandes (`lg:`). Dado que `BottomNavbar` tiene posición fija y altura de 56px (`h-14`), el padding inferior en desktop disminuye a 40px (2.5rem), causando que la última fila de tarjetas quede oculta detrás de la barra.

### Finding 2: Inconsistencia del active tab en `/live`
- **Evidence:** `src/components/layout/BottomNavbar.tsx:37` y `src/app/standings/page.tsx:130`
- **Detail:** Al hacer clic en "En vivo", el usuario es redirigido a `/live`. El `BottomNavbar` evalúa el estado activo de forma estricta: `pathname === item.href`. Como no hay un ítem específico para `/live`, y el enlace de "Posiciones" apunta a `/standings`, la pestaña de posiciones se deselecciona.

### Finding 3: Referencia del multiplicador en base al primer partido del torneo
- **Evidence:** `src/utils/scoring.ts:123` y `supabase/migrations/20260605000000_update_lock_and_multiplier.sql:53`
- **Detail:** El commit `1e5dec6` modificó la fórmula de cálculo del multiplicador. Tanto la base de datos (`fn_prediction_multiplier`) como el código frontend (`calculatePredictionMultiplier`) utilizan el inicio del primer partido del torneo (`min(match_time)`) como la fecha de referencia en lugar de la hora de inicio de cada partido individual.

### Finding 4: Banderas emoji nativas y comportamiento en Windows
- **Evidence:** `src/utils/team-flags.ts`
- **Detail:** Los iconos de los países se implementan utilizando caracteres de emoji estándar (ej. `"🇪🇸"`). Windows no soporta emojis de banderas en color de forma nativa en la mayoría de sus aplicaciones y navegadores estándar, mostrándolos como letras (ej. `ES`) o recuadros vacíos. En cambio, iOS/Android sí los renderizan.

### Finding 5: Mecanismo automático de avance y pruebas
- **Evidence:** `src/utils/tournament-advancement.ts` y `tests/integration/knockout-advancement.test.ts`
- **Detail:** El avance de fases se calcula mediante la función `calculateTournamentAdvancement` y se aplica en base de datos mediante la RPC `fn_admin_apply_knockout_advancement`. Este flujo está probado rigurosamente por `tests/integration/knockout-advancement.test.ts` (10 tests de integración exitosos) y `tests/unit/tournament-advancement.test.ts`.

## Deduced Conclusions

### Deduction 1: Desalineación del card por texto dinámico
- **Based on:** `src/components/predictions/MatchCard.tsx:400-479`
- **Reasoning:** El contenedor de la cabecera es un flexbox con `justify-between`. El texto de la izquierda (`Jornada 1 · 11 jun · 1.0x`) y el estado de la derecha (`Guardado ✓`) compiten por el espacio horizontal. En dispositivos estrechos, si el texto de la izquierda es muy largo, la aparición del texto de estado causa un salto de línea (wrap), alterando la alineación vertical de todo el card.

### Deduction 2: Desviación de la definición del multiplicador
- **Based on:** `prd.md: Sección 4.5` y `1e5dec6`
- **Reasoning:** El PRD especifica que "el cálculo se realiza por partido individual en base a su fecha/hora de kickoff". La implementación actual cambió esto para basarlo en el primer partido del torneo, presumiblemente para congelar multiplicadores una vez que inicia la copa. Esto causa que todos los partidos tengan un multiplicador de 1.0x si se predicen cuando falta menos de una semana para el primer encuentro, aunque falten semanas para el partido en sí.

### Deduction 3: Cuotas de Free Tier e impactos del autoguardado
- **Based on:** `predictions.actions.ts` y límites de Supabase/Vercel
- **Reasoning:** Las predicciones se guardan localmente en la base de datos de Supabase, por lo que su edición no consume cuota de la API externa de Zafronix (esta solo se consume al sincronizar partidos reales). Sin embargo, el debounce de 500ms hace que múltiples cambios seguidos llamen repetidamente a Vercel/Supabase. En horas pico, esto podría saturar el límite de 60 conexiones concurrentes del free tier de Supabase.

## Hypothesized Paths

### Hypothesis 1: Fix de padding responsive
- **Theory:** Reemplazar `lg:py-10` por `lg:pt-10 lg:pb-28` en `PredictionsPage` resolverá por completo el recorte de los cards.

### Hypothesis 2: Corrección de active tab en Navbar
- **Theory:** Cambiar la lógica de `isActive` en `BottomNavbar` para que `/live` mantenga seleccionada la pestaña de "Posiciones" solucionará la inconsistencia visual.

### Hypothesis 3: Corrección de alineación
- **Theory:** Darle un ancho o espacio fijo al estado de guardado, o usar posicionamiento absoluto en la cabecera de la tarjeta evitará el layout shift.

## Missing Evidence

| Gap              | Impact                               | How to Obtain   |
| ---------------- | ------------------------------------ | --------------- |
| Ninguno          | Todo el análisis se basa en código confirmado. | N/A             |

## Source Code Trace

| Element       | Detail                                      |
| ------------- | ------------------------------------------- |
| Error origin  | `src/app/predictions/page.tsx:145`, `src/components/layout/BottomNavbar.tsx:37`, `src/utils/scoring.ts:123`, `supabase/migrations/20260605000000_update_lock_and_multiplier.sql:53` |
| Trigger       | Renderizado de vistas e interacciones de usuario |
| Condition     | Carga de la página en desktop, navegación a `/live`, visualización de tarjetas en Windows, o cálculo de multiplicador. |
| Related files | `MatchCard.tsx`, `BottomNavbar.tsx`, `scoring.ts`, `database migrations` |

## Conclusion

**Confidence:** High

Todos los puntos consultados por el usuario han sido explicados con evidencia exacta del código. El recorte de tarjetas y la pestaña inactiva son errores claros de implementación, mientras que el multiplicador 1.0x nace de una decisión de desarrollo que se desvió del PRD inicial. El problema de los iconos se debe a limitaciones de Windows con emojis de banderas.

## Recommended Next Steps

### Fix direction

1. **Cards cortados (Desktop):** Cambiar `lg:py-10` por `lg:pt-10 lg:pb-28` en `src/app/predictions/page.tsx` para asegurar suficiente padding inferior sobre la barra fija.
2. **Iconos de países (Windows):** Si se requiere consistencia visual en Windows, se debe migrar de emojis de banderas a una biblioteca de banderas SVG o imágenes en formato CDN. Si no, documentarlo como limitación de OS.
3. **Barra de jornadas (Diseño):** Añadir padding vertical (`py-2` o `py-3`) y bordes suaves al track de `ScrollableTabs` para darle más espacio y quitar el aspecto cuadrado y "asfixiado".
4. **Tab "Posiciones" inactiva en en vivo:** Actualizar `BottomNavbar.tsx` para que `isActive` sea `true` cuando `item.href === "/standings" && pathname === "/live"`.
5. **Multiplicador 1.0x en Jornada 3:** Si se desea retornar a la regla del PRD (multiplicadores por partido individual), se debe revertir el cambio de referencia quitando `firstMatchTime` en frontend y modificando `fn_prediction_multiplier` en base de datos para usar `p_match_time`.
6. **Autoguardado 500ms vs Botón Guardar:** Mantener el autoguardado es mejor UX, pero se aconseja aumentar el debounce a `1000ms` o `1500ms` para reducir llamadas concurrentes innecesarias a Supabase.
7. **Desalineación del card con 'Guardado ✓':** Aplicar un tamaño fijo o posicionamiento que no empuje el resto de elementos de la cabecera.
