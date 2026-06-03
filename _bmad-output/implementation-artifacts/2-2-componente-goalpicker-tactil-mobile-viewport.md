---
baseline_commit: db84e14f4a0b33e4cf53be4b43598f65cbe75d42
---

# Story 2.2: Componente GoalPicker Táctil (Mobile Viewport)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **jugador**,
I want **ingresar marcadores con botones grandes de más (`+`) y menos (`−`) en lugar de teclear números en un campo**,
so that **llenar la quiniela de forma veloz, con una sola mano y sin que se despliegue el teclado táctil del móvil**.

## Acceptance Criteria

1. **Given** un `GoalPicker` montado dentro del contenedor móvil (`max-w-md`, 320–480px)
   **When** el jugador presiona el botón `+` o `−`
   **Then** el valor del marcador **aumenta o disminuye exactamente de 1 en 1**, con un **mínimo de 0** (no baja de 0: estando en 0, el botón `−` no produce ningún cambio).

2. **And** cada botón `+`/`−` tiene un **área de tap de al menos `48×48px`** (UX-DR-4 / UX-DR-10), y el marcador se muestra en un elemento **no editable** (NO un `<input>`), de modo que **nunca se dispara el teclado nativo** de Android/iOS al interactuar.

3. **And** el componente es **controlado**: recibe el valor actual y notifica los cambios hacia arriba (`value` / `onChange`), y acepta un estado **`disabled`** que inhabilita ambos botones e impide cambios (preparado para el bloqueo de kickoff de la Story 2.4; en esta historia el bloqueo por tiempo NO se implementa, solo el prop).

4. **And** cumple el **piso de accesibilidad**: cada botón expone un `aria-label` descriptivo siguiendo el patrón de EXPERIENCE.md (p. ej. `"Incrementar goles de Argentina"` / `"Disminuir goles de Argentina"`), y el valor es anunciable por lectores de pantalla. El control usa los **tokens Championship Gold** (fondo `background`, borde `border`, glifos en `accent`, marcador en tipografía `font-display`).

5. **And** existe una prueba unitaria co-localizada `src/components/predictions/GoalPicker.test.tsx` (proyecto Vitest `unit`, jsdom + Testing Library) que valida: incremento, decremento, clamp en 0, que `onChange` recibe el valor correcto, que `disabled` impide cambios, que los controles son `<button>` (no hay `textbox`/`<input>` en el árbol), y que los `aria-label` están presentes. `npm run test:unit`, `npm run lint` y `npm run typecheck` quedan en verde.

## Tasks / Subtasks

- [x] **Tarea 1 — Crear el componente `src/components/predictions/GoalPicker.tsx`** (AC: #1, #2, #3, #4)
  - [x] Crear la carpeta NUEVA `src/components/predictions/` (no existe aún; primer componente del feature de predicciones).
  - [x] Marcar el archivo como **`"use client"`** (tiene estado interactivo / handlers de click; patrón de `LeagueCreateForm.tsx`).
  - [x] **Componente controlado de UN marcador** (stepper), reutilizable dos veces por `MatchCard` en 2.3 (uno local, uno visitante). Props sugeridas:
    ```ts
    interface GoalPickerProps {
      value: number;              // marcador actual (controlado)
      onChange: (next: number) => void;
      label: string;             // nombre del equipo, para los aria-label
      disabled?: boolean;        // bloqueo (Story 2.4 lo activará por kickoff)
      min?: number;              // default 0
      max?: number;              // opcional; ver Dev Notes › Clamp y máximo
    }
    ```
  - [x] Handlers `increment`/`decrement` que **clampan** a `[min, max]` y llaman `onChange(next)` SOLO si `next !== value` (no emitir cambios redundantes). En `disabled` no hacen nada.
  - [x] **Marcador NO editable**: renderizar el número en un `<span>` (tipografía `font-display`, `tabular-nums` para que no “salte” el ancho), **NUNCA** un `<input>`. Este es el mecanismo que evita el teclado nativo (AC #2). [Ver Dev Notes › Por qué buttons y no input]
  - [x] **Botones `+`/`−`**: usar elementos `<button type="button">` con tamaño **`h-12 w-12` (48×48px)** — OVERRIDE del mockup, que dibuja 32px (ver Dev Notes › Conflicto con el mockup). Aplicar clases táctiles: `touch-action: manipulation` (vía `className="touch-manipulation"` o estilo) para matar el delay de doble-tap, `select-none`, y `-webkit-tap-highlight-color: transparent`. Glifos con lucide-react `Plus`/`Minus` (librería de iconos ya configurada en `components.json`) o texto `+`/`−`.
  - [x] **Tokens Championship Gold**: botón con `bg-background border border-border text-accent rounded-sm`, micro-feedback en `:active` (`active:scale-90 active:bg-border` como en el mockup). Estado `disabled` → `opacity-30 pointer-events-none` (botón `−` en min también atenuado/`disabled`).
  - [x] **a11y**: `aria-label={`Incrementar goles de ${label}`}` y `aria-label={`Disminuir goles de ${label}`}`; envolver el valor con un `aria-live="polite"` o exponer `aria-label` en el contenedor del marcador para que el cambio se anuncie. Mantener `focus-visible` para usuarios de teclado (NO rompe el AC #2 — ver Dev Notes › Sobre "desactivar focus").
  - [x] Usar el helper `cn` de `@/utils/utils` para componer clases (patrón del proyecto).

- [x] **Tarea 2 — Prueba unitaria `src/components/predictions/GoalPicker.test.tsx`** (AC: #5)
  - [x] Reutilizar el patrón de `tests/unit/login-form.test.tsx`: `render`, `screen`, `userEvent`, `cleanup` en `beforeEach`. jest-dom ya está cargado globalmente por `vitest.setup.ts` (NO re-importarlo).
  - [x] Como el componente es **controlado**, testear con un wrapper que mantenga el estado (o un `onChange` espía `vi.fn()` y re-render con el nuevo `value`). Casos:
    - `+` incrementa: `onChange` llamado con `value + 1`.
    - `−` decrementa: `onChange` llamado con `value − 1`.
    - **Clamp en 0**: con `value=0`, click en `−` → `onChange` NO se llama (o el botón está `disabled`).
    - `disabled`: ambos botones no disparan `onChange`.
    - **No hay teclado/textbox**: `screen.queryByRole("textbox")` y `queryByRole("spinbutton")` → `null`; los controles son `getAllByRole("button")`.
    - **a11y**: `getByLabelText("Incrementar goles de …")` y `getByLabelText("Disminuir goles de …")` existen.
  - [x] (Opcional) afirmar la presencia de la clase de tamaño 48px o `touch-manipulation` para guardar el contrato visual.

- [x] **Tarea 3 — Verificación final** (AC: #5)
  - [x] `npm run test:unit` en verde (incluye el nuevo `GoalPicker.test.tsx`; los 40 unit previos siguen pasando).
  - [x] `npm run lint` y `npm run typecheck` sin errores.
  - [x] (Sanidad) `npm run build` no rompe por el nuevo archivo cliente. NO se requiere wirear ninguna página en esta historia.

## Dev Notes

### Alcance — qué SÍ y qué NO hacer en esta historia (leer primero)
Esta es una historia **de componente puro de UI**, análoga en alcance acotado a 2.1 (que fue infra pura). Entrega **solo** `GoalPicker.tsx` + su unit test.

**SÍ (2.2):** el stepper táctil controlado `+`/`−`, clamp en 0, 48×48px, sin teclado nativo, `disabled`, a11y, tokens del sistema, unit tests.

**NO (pertenece a otras historias — no implementar aquí):**
- **`MatchCard.tsx`**, la página dashboard `Pronósticos`, la composición de dos GoalPickers, banderas/`team_code`, y el **auto-guardado debounced (500ms) + Server Action `predictions.actions.ts` + feedback verde/offline** → **Story 2.3**. [Source: epics.md Story 2.3]
- **Cálculo/persistencia del multiplicador por antelación**, la **advertencia interactiva** al bajar el multiplicador, y el **bloqueo real por kickoff −1min con candado 🔒** → **Story 2.4**. En 2.2 solo se deja el prop `disabled` para que 2.4 lo accione sin retrabajo. [Source: epics.md Story 2.4; architecture.md#Cross-Cutting (Preservación Guiada del Multiplicador)]
- No tocar la DB, RLS ni `scoring.ts` (ya entregados en 2.1).

### Por qué `<button>` + `<span>` y NUNCA `<input type="number">` (corazón de la AC #2)
El requisito de producto (FR-7 / UX-DR-4) es que **no aparezca el teclado nativo** para reducir fatiga y acelerar la captura con una mano. Un `<input type="number">` o cualquier campo editable **invoca el teclado** al enfocarse en móvil. Por eso el marcador se muestra en un `<span>` no editable y el ajuste se hace 100% con botones. El mockup lo confirma: usa `<div onclick>` para los `+`/`−` y un `<span>` para el número, jamás un input. [Source: EXPERIENCE.md#Component Patterns (goal-picker-button); mock-dashboard.html líneas 581-591]

### Sobre "desactivar las pseudo-clases de focus" (AC original del epic)
El texto del epic dice "desactivan las pseudo-clases de focus para evitar que aparezca el teclado". La **intención real** es evitar el teclado nativo, lo cual se logra **al no usar un input** (los `<button>` no abren teclado). NO elimines el anillo `focus-visible` de los botones: es necesario para accesibilidad por teclado (UX-DR-10) y NO dispara teclado táctil. Es decir: cumple la AC usando botones + span no editable, y conserva `focus-visible`. No añadas un `tabIndex={-1}` que rompa la navegación por teclado. [Source: EXPERIENCE.md#Accessibility Floor; UX-DR-10]

### Conflicto con el mockup: 48px gana sobre los 32px dibujados
`mock-dashboard.html` dibuja `.btn-adjust { width:32px; height:32px }` (líneas 253-256). **Ignóralo.** Las specs impresas mandan sobre los mockups (EXPERIENCE.md#Foundation › "Conflict Resolution": los spines ganan), y **AC #2 + UX-DR-4 + UX-DR-10 + DESIGN.md (Do's: "at least 48px")** exigen tap target ≥48×48px. Implementa `h-12 w-12` (48px). El mockup es referencia de *layout y tono*, no de medidas táctiles. [Source: EXPERIENCE.md#Foundation; DESIGN.md#Do's and Don'ts; epics.md UX-DR-4/UX-DR-10]

### Diseño controlado (por qué `value`/`onChange` y no estado interno)
`MatchCard` (Story 2.3) necesita el valor para dispararle el auto-guardado debounced y para reflejar el estado persistido/offline; por eso el GoalPicker debe ser **controlado** (sin estado propio del marcador). Esto evita reescribir el componente en 2.3 y lo hace trivialmente testeable. La arquitectura ya separa responsabilidades: `GoalPicker.tsx` = control táctil; `MatchCard.tsx` = estado + debounce. [Source: architecture.md#Project Structure (components/predictions); #Component Boundaries; #Decisión: React State + Context]

### Clamp y máximo
- **Mínimo 0** es requisito duro (AC #1) y además la columna DB lo respalda (`home_score_pred/away_score_pred >= 0`, CHECK de 2.1). [Source: 2.1 File List → 20260603144628_matches_and_predictions.sql]
- **Máximo:** el AC no fija uno. Acepta un prop `max` opcional (sin default que limite, o un tope sano tipo 99 para que el `<span>` no se desborde — el mockup reserva ancho fijo). Documenta la elección con un comentario; no es bloqueante.

### Convenciones obligatorias del proyecto
- **Componentes:** `PascalCase` (`GoalPicker.tsx`); en `src/components/<feature>/` (aquí `predictions/`). [Source: architecture.md#Code Naming / #Structure Patterns]
- **Funciones/variables:** `camelCase` (`increment`, `currentScore`). [Source: architecture.md#Code Naming Conventions]
- **Estilos:** Tailwind + tokens HSL ya definidos en `globals.css`/`tailwind.config.ts` (`bg-background`, `border-border`, `text-accent`, `font-display`, `rounded-sm`). NO hardcodear hex; usa los tokens. [Source: src/app/globals.css; tailwind.config.ts]
- **`cn`** vive en `@/utils/utils` (no en `@/lib/utils`). [Source: components.json aliases]
- **Iconos:** lucide-react (`iconLibrary: "lucide"`). [Source: components.json]

### Toolchain de Node (recordatorio de stories previas)
El Node del shell por defecto es **v12**; activa **nvm Node 24** antes de `npm run …`. Para esta historia NO se necesita Supabase local (no hay DB/integration); basta con `test:unit`, `lint`, `typecheck`, `build`. [Source: memoria del proyecto `node-version-toolchain`; 2.1 Dev Notes › Toolchain]

### Patrón de prueba de componentes (copiar de lo existente)
`tests/unit/login-form.test.tsx` es la plantilla: `@testing-library/react` (`render`, `screen`, `cleanup`, `waitFor`), `@testing-library/user-event`, `vitest` (`describe/it/expect/vi`). El proyecto `unit` corre en **jsdom** e incluye tanto `tests/unit/**` como `src/**/*.{test,spec}.tsx`, así que el test co-localizado en `src/components/predictions/` se recoge solo. jest-dom se extiende globalmente en `vitest.setup.ts`. **No** mockear nada de red/Supabase: el GoalPicker es UI pura. [Source: vitest.config.ts; vitest.setup.ts; tests/unit/login-form.test.tsx]
> Nota de jsdom: no puede comprobar literalmente "el teclado no se abre". El proxy correcto es afirmar que **no existe** `role="textbox"`/`"spinbutton"` ni `<input>` y que los controles son `<button>`. Eso codifica el contrato anti-teclado.

### Inteligencia de la Story previa (2.1 — DONE)
- 2.1 dejó `predictions` con `multiplier numeric(3,2) default 1.00` y `points_earned` (que el cliente **no** puede escribir; solo `home_score_pred`/`away_score_pred` vía RLS). El GoalPicker solo manipula los goles previstos; el multiplier/points son de 2.4/Epic 5. [Source: 2.1 Review Findings (Patch 1+2)]
- Tipos de dominio `Prediction`/`PredictionInsert` ya existen en `src/types/index.ts` (por si 2.3 los necesita; 2.2 trabaja con `number` plano). [Source: src/types/index.ts:36-39]
- `scoring.ts` es la fuente única de puntuación; **no** dupliques lógica de puntos en el componente (el GoalPicker no calcula puntos, solo captura el marcador). [Source: 2.1 Dev Notes › Fuente única de verdad]

### Inteligencia de Git (commits recientes)
`db84e14` (Story 2.1) introdujo el módulo de predicciones (DB/RLS/scoring). `f776ff8` (Story 1.3) estableció el patrón de componente cliente con `"use client"` + tokens Championship Gold (`LeagueCreateForm.tsx`) y el sistema de diseño en `globals.css`/`tailwind.config.ts` — esa es la referencia estética/estructural directa para este componente. [Source: git log; src/components/leagues/LeagueCreateForm.tsx]

### Restricciones NFR
- **Coste Cero (NFR-1):** componente puramente cliente, sin dependencias nuevas (lucide-react, tailwind, testing-library ya están). No añadir librerías. [Source: epics.md NFR-1]

### Project Structure Notes
- Archivos **NUEVOS:** `src/components/predictions/GoalPicker.tsx`, `src/components/predictions/GoalPicker.test.tsx` (carpeta `predictions/` nueva).
- Archivos **MODIFICADOS:** ninguno esperado (el componente es autónomo; el cableado a página/MatchCard es de 2.3).
- Alineado con el árbol de arquitectura: `src/components/predictions/GoalPicker.tsx` está explícitamente previsto. Sin conflictos con 1.1–2.1.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.2: Componente GoalPicker Táctil (Mobile Viewport)]
- [Source: _bmad-output/planning-artifacts/epics.md#FR-7 / #UX-DR-4 / #UX-DR-10]
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure (components/predictions/GoalPicker.tsx)]
- [Source: _bmad-output/planning-artifacts/architecture.md#Component Boundaries / #Naming Patterns / #Structure Patterns]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/DESIGN.md#Components / #Do's and Don'ts]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/EXPERIENCE.md#Component Patterns / #Accessibility Floor / #Foundation (Conflict Resolution)]
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/.working/mock-dashboard.html (referencia visual; medidas táctiles NO autoritativas)]
- [Source: _bmad-output/implementation-artifacts/2-1-modelos-de-partidos-predicciones-y-motor-de-puntuacion-scoring.md#Dev Notes / #Review Findings]
- [Source: src/components/leagues/LeagueCreateForm.tsx (patrón "use client" + tokens)]
- [Source: src/components/ui/button.tsx (patrón cva/cn; size xl=h-12 como referencia de 48px)]
- [Source: tests/unit/login-form.test.tsx (patrón de test de componente)]
- [Source: vitest.config.ts; vitest.setup.ts (proyecto unit jsdom + jest-dom)]
- [Source: src/app/globals.css; tailwind.config.ts (tokens Championship Gold)]
- Web: WCAG target size (mín. 44–48px) — https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- Web: `touch-action: manipulation` (eliminar delay de 300ms) — https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Opus 4.8)

### Debug Log References

- RED: `npx vitest run --project unit src/components/predictions/GoalPicker.test.tsx` falla por import sin resolver (componente inexistente) — confirma el test antes de implementar.
- GREEN: tras crear `GoalPicker.tsx`, el mismo run pasa 9/9.
- `npm run test:unit`: **49/49** (40 previos + 9 nuevos de `GoalPicker.test.tsx`).
- `npm run lint`: 0 errores.
- `npm run typecheck` (`tsc --noEmit`): 0 errores.
- `npm run build`: compila sin errores (no se cableó ninguna página; el componente es autónomo).
- Toolchain: nvm Node 24 (el Node del shell por defecto es v12).

### Completion Notes List

- **GoalPicker (Tarea 1)** — `src/components/predictions/GoalPicker.tsx` (carpeta `predictions/` nueva). Componente cliente (`"use client"`) **controlado** (`value`/`onChange`), reutilizable dos veces por `MatchCard` en 2.3. Marcador en `<span>` NO editable + ajuste 100% por `<button>` → nunca abre el teclado nativo (AC #2). Botones **48×48px** (`h-12 w-12`, override del mockup de 32px), con `touch-manipulation`, `select-none`, `-webkit-tap-highlight-color: transparent` y micro-feedback `active:scale-90`. Tokens Championship Gold (`bg-background`/`border-border`/`text-accent`/`font-display`). Glifos lucide `Plus`/`Minus`. Clamp en `min` (default 0, respalda el CHECK `>= 0` de la DB) y `max` opcional sin tope por defecto. Prop `disabled` listo para el bloqueo de kickoff de 2.4 (no implementado aquí). `aria-label` por equipo + `aria-live="polite"` en el marcador.
- **Tests (Tarea 2)** — `src/components/predictions/GoalPicker.test.tsx` (co-localizado, proyecto `unit` jsdom + Testing Library, patrón de `login-form.test.tsx`). 9 casos: incremento, decremento, valor controlado reflejado tras dos clicks, clamp en 0 (botón `−` deshabilitado), tope `max` (botón `+` deshabilitado), `disabled` bloquea ambos, **contrato anti-teclado** (sin `textbox`/`spinbutton`/`<input>`; exactamente 2 `button`), `aria-label` por equipo, y tamaño táctil `h-12 w-12`.
- **Alcance respetado**: NO se construyó `MatchCard`, ni la página de Pronósticos, ni el auto-guardado/Server Action (Story 2.3), ni el multiplicador/candado de kickoff (Story 2.4). No se tocó DB/RLS/`scoring.ts` (2.1). Sin dependencias nuevas (lucide-react/tailwind/testing-library ya presentes → NFR-1 Coste Cero).
- **Decisiones de las "Preguntas para Cris"** (defaults aplicados, no bloqueantes): (1) sin tope máximo duro de goles — clamp solo en 0, con prop `max` opcional disponible; (2) iconos lucide `Plus`/`Minus` por consistencia con la UI; (3) alcance 2.2/2.3/2.4 según lo asumido.

### File List

**Código (nuevo):**
- `src/components/predictions/GoalPicker.tsx`

**Tests (nuevo):**
- `src/components/predictions/GoalPicker.test.tsx`

## Change Log

| Fecha       | Versión | Descripción                                                                                                                                                       | Autor        |
| ----------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 2026-06-03  | 0.1     | Componente `GoalPicker` táctil controlado (+/−, clamp en 0, 48×48px, sin teclado nativo, `disabled` listo para 2.4, tokens Championship Gold, a11y) + 9 unit tests. Story implementada — lista para review. | Amelia (Dev) |
| 2026-06-03  | 0.2     | Code review (Blind/Edge/Auditor — Auditor: Pass): 4 patches aplicados (focus-visible ring, `min-w-6` anti-recorte, aria del `<span>` simplificada, +2 tests). 0 diferidos. unit 51/51. Story aprobada — done. | Amelia (Dev) |

## Review Findings

> Revisión adversarial (Blind Hunter + Edge Case Hunter + Acceptance Auditor) — 2026-06-03. **Acceptance Auditor: Pass** — las 5 ACs se cumplen, gates en verde (unit 9/9, lint, typecheck), alcance 2.3/2.4 respetado. Triage: 0 decisiones, 4 patches, 0 diferidos, ~12 descartados (guardas teóricas de NaN/float/negativo/undefined/`min>max`/label vacío sobre un componente controlado y tipado cuyo `value` siembra el padre desde ints de DB; más elogios y comportamiento intencional).

### Patches (aplicados 2026-06-03)

> Los 4 patches se aplicaron y validaron: unit **51/51** (+2 tests: `min≠0` y render multi-dígito), lint y typecheck limpios, build OK.
> - **P1 (a11y):** `focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring` añadido a los botones (anillo dorado del sistema, UX-DR-10).
> - **P2 (UI):** `w-6` → `min-w-6` en el `<span>` del marcador para no recortar 2+ dígitos.
> - **P3 (a11y):** eliminado el `aria-label` redundante del `<span>` (se conserva `aria-live="polite"`); el contexto de equipo vive en los aria-label de los botones.
> - **P4 (tests):** añadidos test del prop `min≠0` y del render multi-dígito.


- [x] [Review][Patch] Botones sin `focus-visible` ring del sistema de diseño (UX-DR-10): el foco de teclado depende solo del outline UA; alinear con `ui/button.tsx` añadiendo `focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring` [src/components/predictions/GoalPicker.tsx:30]
- [x] [Review][Patch] `w-6` fijo en el `<span>` del marcador recorta números de 2+ dígitos (el `max` es opcional/sin tope) → usar `min-w-6` para que crezca [src/components/predictions/GoalPicker.tsx:65]
- [x] [Review][Patch] `aria-label` + `aria-live` compiten en el mismo `<span>`: el anuncio del cambio de valor es inconsistente entre SR/navegadores. Simplificar quitando el `aria-label` del span y conservando `aria-live="polite"` (el contexto del equipo ya vive en los aria-label de los botones) [src/components/predictions/GoalPicker.tsx:64-70]
- [x] [Review][Patch] Cobertura: falta test del prop `min` distinto de 0 y del render de marcador multi-dígito (tras el fix de ancho) → añadirlos [src/components/predictions/GoalPicker.test.tsx]

## Preguntas para Cris (no bloquean la implementación)

1. **Máximo de goles:** ¿Fijamos un tope (p. ej. 99, o 20) para el marcador, o lo dejamos sin límite superior? Afecta solo al ancho del display y a un caso borde poco realista. (Default propuesto: sin tope duro, clamp solo en 0.)
2. **Glifo de los botones:** ¿iconos lucide `Plus`/`Minus` (consistencia con el resto de la UI) o los caracteres `+`/`−` del mockup? (Default propuesto: lucide.)
3. **Confirmación del alcance:** se asume que `MatchCard`, la página de Pronósticos y el auto-guardado caen en la Story 2.3, y el multiplicador/candado en 2.4. ¿Correcto?
