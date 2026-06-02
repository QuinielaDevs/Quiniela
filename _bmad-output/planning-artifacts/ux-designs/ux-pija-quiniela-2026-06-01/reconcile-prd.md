# Reconciliación de Entradas: PRD a UX Spines

Este documento reconcilia los requisitos funcionales del [prd.md](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md) con las especificaciones de diseño y experiencia definidas en [DESIGN.md](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/DESIGN.md) y [EXPERIENCE.md](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/EXPERIENCE.md).

## Matriz de Cobertura

| Requisito PRD | Implementación en UX | Ubicación en Spines |
|---|---|---|
| **FR-1: Google OAuth** | Flujo de login express a un clic en el Onboarding de Invitación. | `EXPERIENCE.md` -> Key Flows (Flow 1) |
| **FR-3 y FR-4: Deep-linking e Invitación** | Pantalla de Bienvenida de Invitados con código pre-cargado y redirección. | `EXPERIENCE.md` -> IA, State Patterns, Key Flows |
| **FR-5: Indicador de Pago (Presión Social)** | Badge visual `Pendiente` en tabla de posiciones y banner explicativo persistente. | `DESIGN.md` -> Colors, Components; `EXPERIENCE.md` -> IA, Component/State Patterns |
| **FR-7: Controles Táctiles** | Botones de `+`/`-` de 48px sin teclado nativo. | `DESIGN.md` -> Shapes, Components; `EXPERIENCE.md` -> Component Patterns, Accessibility |
| **FR-8: Auto-guardado con Debounce** | Retardo de 500ms antes de la Server Action con feedback visual de destello verde y check `✓`. | `DESIGN.md` -> Colors, Do's and Don'ts; `EXPERIENCE.md` -> Component Patterns, Key Flows (Flow 2) |
| **FR-9: Bloqueo por Kickoff** | Inhabilitación de controles y cambio a icono de candado 🔒 1 min antes de empezar. | `EXPERIENCE.md` -> State Patterns |
| **FR-10: Multiplicador Anticipado** | Badge de nivel en la tarjeta de partido y modal de advertencia al editar tardíamente. | `DESIGN.md` -> Colors, Components; `EXPERIENCE.md` -> Component Patterns, State Patterns |
| **FR-12 y FR-13: Duelos y Escrow** | Pestaña de Duelos, retención en escrow restada de la visualización del saldo principal. | `DESIGN.md` -> Components; `EXPERIENCE.md` -> IA, State Patterns, Key Flows (Flow 3) |
| **FR-15 y FR-16: Premios Especiales** | Selector de candidatos favoritos con devaluación de puntos por fases y cierre en semifinales. | `EXPERIENCE.md` -> IA, Component/State Patterns |
| **FR-17: Posiciones Proyectadas** | Recalculación local en cliente mediante WebSocket y toast de notificación de cambio ("Impacto de Gol"). | `EXPERIENCE.md` -> IA, State Patterns, Key Flows (Flow 4) |
| **FR-18: Clasificación por Jornada** | Filtro de tabla plana acumulada vs jornadas sin recarga completa de página. | `EXPERIENCE.md` -> Component Patterns |
| **FR-21: Tarjetas Psicológicas** | Tarjetas de perfil compartibles visuales al cierre de cada jornada. | `EXPERIENCE.md` -> IA |
| **FR-23: Compartido Viral** | Botón para enviar plantilla de pique en WhatsApp y tags OpenGraph para tarjetas enriquecidas. | `EXPERIENCE.md` -> Interaction Primitives, Key Flows (Flow 3) |
| **FR-24: Configuración de Administrador** | Panel rápido para activar "Requiere Pago", montos, instrucciones de cobro y expulsión. | `EXPERIENCE.md` -> IA |

## Observaciones de Diseño
*   **Transparencia de Pago:** Se optó por un banner y tag visual en vez de bloquear las predicciones de los usuarios para no penalizar el engagement de la liga por retrasos logísticos del administrador.
*   **Performance:** Para cuidar el límite de 200 conexiones concurrentes en Supabase Realtime, las tablas proyectadas se calculan localmente y solo se conectan vía WebSocket en la vista activa de tiempo real, usando fetch HTTP estándar en el resto del sitio.
