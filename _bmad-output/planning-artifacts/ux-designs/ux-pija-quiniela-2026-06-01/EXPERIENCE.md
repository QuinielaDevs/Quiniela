---
name: Championship Gold
status: final
sources:
  - {planning_artifacts}/prds/prd-pija-quiniela-2026-06-01/prd.md
updated: 2026-06-01
---

# Championship Gold — Experience Spine

This experience spine outlines the layout behavior, information hierarchy, state structures, and key journeys of the Quiniela Mundial FIFA 2026 application. It works in partnership with [DESIGN.md](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/DESIGN.md), referencing its design tokens with `{path.to.token}`.

## Foundation

*   **Platform:** Mobile-first web application (responsive up to desktop screens, optimized specifically for viewport widths between 320px and 480px).
*   **UI System:** Tailwind CSS + shadcn/ui.
*   **Visual Anchor:** Pairings and structures follow the dark-mode layout specified in [DESIGN.md](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/DESIGN.md). Navigation uses a persistent bottom bar for quick page access.
*   **Conflict Resolution:** Los spines impresos (DESIGN.md y EXPERIENCE.md) representan la especificación técnica de referencia oficial y ganan en caso de conflicto con cualquier mockup o maqueta de la carpeta `.working/`.

## Information Architecture

| Surface | Reached from | Purpose | Interactive Mockup |
|---|---|---|---|
| **Invitación (Landing)** | Deep-link invitation URL (`/join/LIGA123`) | Display league name, creator, payment alert (if required), and Google Sign-in button. | None |
| **Pronósticos (Dashboard)** | App load (authenticated) / Bottom nav | List fixture cards of the day. Entry point to input scores using tactical tap controls. | [mock-dashboard.html](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/.working/mock-dashboard.html) |
| **Tabla de Posiciones** | Bottom nav | Table ranking all league members by accumulated points. Flags unpaid members. Toggle to view cumulative vs Round (Jornada) standings. | None |
| **Tabla en Vivo (Proyectada)** | Standings Header or WebSocket indicator | Special dashboard active during match hours showing real-time scores and projected user points. | [mock-live-leaderboard.html](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/.working/mock-live-leaderboard.html) |
| **Duelos (Apuestas)** | Bottom nav / Detail row tap | Panel to create 1v1 direct challenges or join open pools. Displays locked escrow balances. | [mock-challenges.html](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/.working/mock-challenges.html) |
| **Premios Especiales** | Profile area / Dashboard sub-pane | Predict Tournament Champion, Top Scorer, and MVP. Access candidate selection list. | None |
| **Ajustes de Liga (Admin)** | Standings gear icon (Admin only) | Form to toggle payments, edit Zelle instructions, choose prediction mode, and manage/expel members. | [mock-admin-settings.html](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/.working/mock-admin-settings.html) |

Bottom Navigation Bar: `Pronósticos` | `Posiciones` | `Duelos` | `Mi Cuenta`.

## Voice and Tone

Microcopy is competitive, sports-oriented, and direct, driving engagement without feeling cluttered.

| Do | Don't |
|---|---|
| "Cris te invita a la liga **La Pija Quiniela**" | "Código de invitación recibido: LIGA123" |
| "Guardado ✓" (displayed next to scorecard after 500ms) | "El registro fue guardado exitosamente en la base de datos" |
| "Apuestas 5 puntos. Diego tiene que aceptar el reto." | "El desafío de 1v1 directo está pendiente de confirmación" |
| "¡Gol de Ecuador! Subes al 2º puesto temporalmente." | "Actualización en tiempo real: Marcador modificado. Recalculando standings..." |
| "Acierto exacto: +5 pts · Acierto ganador: +2 pts" | "Regla de puntos base: 5 y 2" |
| "Error al guardar. Reintentando..." | "Error de comunicación 500 en la API" |

## Component Patterns

Visual patterns conform exactly to [DESIGN.md.Components](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/DESIGN.md).

| Component | UI Elements | Behavioral Rules |
|---|---|---|
| **goal-picker-button** | `{components.goal-picker-button}` | Large tap target (48x48px). Increments goals (min 0). Disables visual focus states to prevent triggering native mobile keyboards. Triggers auto-save function 500ms after last click. |
| **paid-badge** | `{components.paid-badge}` | Green tag showing `Pagado`. Visible on standings. Action: Tapping it in admin view toggles status back to pending. |
| **unpaid-badge** | `{components.unpaid-badge}` | Crimson tag showing `Pendiente`. Visible on standings. Action: Tapping it in admin view toggles status to paid. |
| **wager-card** | `{components.wager-card}` | Dual-layered challenge card. Shows opponents, predictions, and wagers. Provides a "Compartir por WhatsApp" button to trigger banter sharing. |
| **active-badge** | `{components.active-badge}` | Gold status indicator. Visible on matches in progress or accepted wagers. |
| **payment-banner** | Sticky top panel. | Visible only to users with `is_paid = false` (if required). Displays payment steps. Dismissing hides it until next session. |
| **tab-bar-container** | `{components.tab-bar-container}`, caret chevrons, gradient fades. | Level 2 Navigation bar. Uses `overflow-x: auto` with hidden scrollbar. Centers active tab dynamically using `scrollIntoView` inline centering. Dynamically toggles fades and caret buttons based on scroll position (`scrollLeft`). For Groups phase, shows 3 tabs (Jornada 1-3) which fit standard screens. For Knockout phase, uses compact labels (`Dieciseisavos`, `Octavos`, `Cuartos`, `Semifinales`, `Final`) and activates scroll indicators due to overflow. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| **Bienvenida Invitado** | Invitación Landing | Displays: *"¡Únete a la liga de Cris! Tarifa de inscripción: $10 USD. Cuenta Zelle: cris@mail.com. Regístrate con Google para jugar."* |
| **Bloqueo por Kickoff** | Pronósticos | 1 minute before kickoff, score card controls hide. Displays locked icon 🔒. Multiplier indicator freezes. |
| **Escrow Activo** | Duelos | Locked wager points are subtracted from the user's available balance in the Standings view and displayed as `Puntos Retenidos: X pts` in duels tab. |
| **Impacto de Gol** | Tabla en Vivo | Animated toast at the top: *"¡Gol de Argentina! Laura sube al 3º puesto proyectado 🎉"*. Flashes the row that moved up. |
| **Premios Bloqueados** | Premios Especiales | From the Semifinal kickoff onward, editing is disabled. Displays: *"Pronósticos cerrados"*. |
| **Cero Desafíos** | Duelos | Displays empty state illustration: *"No tienes apuestas activas. ¡Reta a un amigo para subir la emoción!"* |
| **Cero Miembros** | Tabla de Posiciones | Displays empty state illustration: *"Aún no hay participantes en esta liga. ¡Invita a tus amigos con el enlace superior!"* |
| **Fallo de Guardado** | Pronósticos | Flashes card border in crimson `{colors.destructive}`. Displays: *"Fallo de conexión. Reintentando..."* and auto-retries when back online. |
| **Error Administrativo** | Ajustes de Liga (Admin) | Displays error message: *"No pudimos guardar los cambios. Por favor revisa tu conexión e inténtalo de nuevo."* |

## Interaction Primitives

*   **Taps:** Primary action for adjustments, switching tabs, and accepting duels. Double taps are ignored.
*   **Banter Sharing:** Tapping "Retar" generates a text clip and launches the native share sheet or WhatsApp client directly:
    *   *Text:* `¡Te desafío en la Quiniela! Apuesto {points_bet} puntos de mi clasificación a que {TeamA} gana {ScoreA}-{ScoreB} contra {TeamB}. ¿Aceptas? Entra aquí: pijaquiniela.app/desafio/{challenge_id}`
*   **Gestures:** Swipe-to-dismiss is enabled for the live leaderboard "Impacto de Gol" toasts.

## Accessibility Floor

*   **Tap Targets:** Goal pickers and action buttons are at least `48px` by `48px` to assist single-handed mobile navigation.
*   **Contrast:** Off-white text `{colors.primary-foreground}` on card surfaces `{colors.card}` achieves a contrast ratio of at least 7:1.
*   **Screen Readers:** Active matches use aria-labels: `"Predicción local {TeamA}: {ScoreA} goles. Botón incrementar goles local."`
*   **Motion Reduction:** If the user has reduced motion active, "Impacto de Gol" transitions use simple opacity changes, skipping slide-in animations.

## Key Flows

### Flow 1 — Invitación y Registro Express (Pedro, primer contacto)

1.  Pedro abre el enlace `https://pijaquiniela.app/join/LIGA123` que le llegó por WhatsApp.
2.  El sistema muestra la tarjeta de bienvenida: *"Cris te invita a la liga La Pija Quiniela"* and details payment requirement instructions if active.
3.  Pedro toca el botón de "Registrarse con Google".
4.  *Happy Path:* Tras la validación de Supabase Auth, se crea su perfil en `public.profiles` y se registra en `public.league_members`.
5.  Pedro entra directamente al Dashboard y ve: *"¡Te has unido con éxito! Ya puedes registrar tus pronósticos."*
6.  *Failure Path:* Si Google OAuth falla o es cancelado por el usuario, se muestra una alerta flotante: *"Registro cancelado. Por favor inicia sesión con Google para unirte a la liga."* y permanece en la landing page de invitación.

### Flow 2 — Guardado Automático de Marcador (Laura, en el bus)

1.  Laura abre la pestaña `Pronósticos` y ve el partido inaugural *Ecuador vs Qatar*.
2.  Toca el botón `+` de Ecuador dos veces. El marcador muestra `2 - 0`.
3.  El sistema detecta un intervalo de 500ms sin clics adicionales (debounce).
4.  Se inicia la Server Action de persistencia en la tabla `public.predictions`.
5.  *Happy Path:* El marcador muestra un destello verde turf `{colors.success}` instantáneo y se visualiza el check `✓` de guardado exitoso en el extremo superior de la tarjeta.
6.  *Failure Path (Offline):* Si la petición de red falla, la tarjeta se bordea en rojo `{colors.destructive}`, se cambia el indicador de estado a *"Sin conexión - Pendiente"* y se guarda localmente en el cliente, reintentando sincronizar automáticamente cuando la red se reestablezca.

### Flow 3 — Creación de Duelo 1v1 y Escrow (Carlos, retando a Diego)

1.  Carlos va a `Duelos` y toca "Crear Desafío".
2.  Elige el partido *Argentina vs Francia*, selecciona a Diego de la lista de miembros, e ingresa su marcador (`3 - 1`) y una apuesta de `5` puntos.
3.  Toca "Enviar Duelo".
4.  *Happy Path:* La base de datos ejecuta la función RPC `public.create_challenge`, descontando 5 puntos del saldo de Carlos y reteniéndolos en escrow. La app muestra la confirmación y un botón de "Compartir en WhatsApp".
5.  Carlos lo toca; se abre WhatsApp con el mensaje de pique cargado. Diego abre el link del reto, lo acepta e ingresa su marcador (`1 - 2`), descontando sus 5 puntos para el pozo.
6.  *Failure Path:* Si Carlos intenta apostar `10` puntos pero su balance disponible actual es de `8` puntos, el botón de envío se deshabilita y se despliega una advertencia en rojo: *"Saldo insuficiente para realizar esta apuesta (Disponible: 8.0 pts)"*.

### Flow 4 — Visualización de Standing Proyectado en Vivo (Espectador)

1.  Cris está viendo el partido inaugural. Abre la pestaña `Tabla en Vivo`.
2.  El partido real va 0-0. Ecuador mete gol en el minuto 70.
3.  La API de Fútbol actualiza el marcador en Supabase.
4.  *Happy Path:* Supabase Realtime difunde el evento a los navegadores suscritos a la vista en vivo. La app recalcula localmente en JS los puntos de los jugadores basándose en el 1-0 momentáneo. El row de Cris sube a la primera posición con una animación suave, mientras que una notificación flotante (toast) avisa: *"¡Gol de Ecuador! Cris sube al 1er puesto proyectado."*
5.  *Failure Path (Desconexión WebSocket):* Si la conexión WebSocket en tiempo real se interrumpe durante el partido, la app muestra un pequeño indicador amarillo en la cabecera: *"Conexión perdida. Intentando reconectar..."* y automáticamente degrada a polling HTTP (peticiones fetch cada 60 segundos) para no interrumpir el servicio de standings hasta recuperar el socket.
