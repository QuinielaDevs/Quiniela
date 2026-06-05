---
baseline_commit: ed39e8b6308b393b79d21b3f9678a8575ca6bc6c
---
# Story 5.4: Compartir de Forma Viral por WhatsApp y Landing Page (Banter Preview)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Como **jugador retador**,
quiero **compartir mi desafío en chats de WhatsApp con textos de pique visuales e interactivos**,
so que **pueda motivar a mis rivales a aceptar el duelo instantáneamente**.

## Acceptance Criteria

1. **Given** un desafío de duelo creado (directo o abierto) y en estado pendiente (`status = 'pending'`),
   **When** el usuario presiona el botón "Compartir en WhatsApp" (ya sea en la pantalla de éxito de creación o desde el panel de Duelos),
   **Then** se abre la aplicación de mensajería (WhatsApp Web o App) con un mensaje de pique pre-formateado (Banter Text) que incluye el enlace inteligente `/desafio/[challenge_id]`.

2. **And** para el **Banter Text** (Texto de Pique):
   - **Duelo Directo:** Debe incluir el nombre del rival, los equipos del partido, el monto de puntos apostado y el enlace. Ejemplo:
     *"¡Ey [Nombre Rival]! Te he retado a un duelo 1v1 en PIJA Quiniela para el partido [Local] vs [Visitante] 🏆. Aposté [Puntos] pts de mi saldo. ¿Aceptas el reto o te da miedo perder? Entra aquí para responder: [Enlace]"*
   - **Pozo Abierto (Grupal):** Debe incluir el partido, los puntos de la apuesta y una llamada competitiva. Ejemplo:
     *"¡Atención grupo! He creado un pozo abierto de [Puntos] pts para el partido [Local] vs [Visitante] en PIJA Quiniela 💥. ¡Entren y demuestren quién es el verdadero Nostradamus de la liga!: [Enlace]"*

3. **And** para los **Metadatos OpenGraph (Smart Preview)**:
   - Al cargarse el enlace `/desafio/[challenge_id]` por un crawler o cliente de mensajería (WhatsApp, Telegram, etc.), el servidor Next.js debe retornar etiquetas meta dinámicas (`og:*`):
     - `og:title`: Título personalizado según el reto. Ejemplo: *"Desafío 1v1: [Creador] vs [Rival]"* o *"¡Pozo Abierto de [Puntos] pts para el partido [Local] vs [Visitante]!"*.
     - `og:description`: Detalle del partido, fecha y puntos de la apuesta. Ejemplo: *"Apuesta tus puntos en el partido [Local] vs [Visitante] del Mundial 2026. ¿Quién tiene la mejor predicción?"*.
     - `og:image`: Debe apuntar a una imagen deportiva estática consistente en `/public/assets/images/og-challenge.png` (o usar la imagen de OG por defecto del boilerplate si no hay assets dinámicos).
     - `og:url`: `/desafio/[challenge_id]`.

4. **And** para la **Landing Page del Desafío** (`src/app/desafio/[id]/page.tsx`):
   - Debe tener un layout mobile-first (`max-w-md` o `480px`) con los tokens de color del sistema de diseño (Fondo Indigo `#0D1B2A`, tarjetas Navy `#1B263B`, acentos Dorados `#E9C46A`, éxito Verde `#10B981` y tipografías Outfit e Inter).
   - Debe mostrar la información básica del reto: equipos con sus banderas, avatares y nombres del creador y el rival (si aplica), puntos en juego y estado actual.
   - **Garantía de Confidencialidad de Predicciones (server-authoritative, NFR-3):**
     - El gate de confidencialidad se enforza **dentro del RPC `fn_get_challenge_landing`** (server-side, `now()` de Postgres), NO en el Server Component. Regla: la predicción de un participante (`prediction_home/away`) solo se devuelve si `public.fn_match_unlocked(match_id)` es true **O** el solicitante es ese mismo participante (`auth.uid() = user_id`); en caso contrario se devuelve `NULL`.
     - Es **simétrico**: aplica tanto a la predicción del creador como a la del/los retado(s). Nadie ve la predicción ajena antes de `match_time - 1 min`, ni siquiera el propio oponente.
     - El Server Component solo PINTA lo recibido: campo `NULL` → candado 🔒 / `? - ?`. No recalcula tiempo con el reloj del cliente (`Date.now()` queda prohibido para esto; ver Dev Notes).
   - **Caso de Usuario Autenticado y Miembro de la Liga**:
     - Si el reto es directo y el usuario es el retado (`challenged_id === auth.uid`), muestra los botones **"Aceptar Duelo"** (que abre el modal `AcceptDuelDialog` para introducir el marcador táctil con `GoalPicker` y confirmar) y **"Rechazar"**.
     - Si el reto es abierto y el usuario no se ha unido: Muestra el botón **"Unirse al Pozo"** (abre el `AcceptDuelDialog`).
     - Si ya se unió o es el creador: Muestra detalles de su participación.
   - **Caso de Usuario Autenticado pero NO Miembro de la Liga**:
     - **Pozo ABIERTO:** aviso *"Este desafío pertenece a una liga privada"* + botón **"Unirse a la Liga para Participar"** → `joinLeagueByInvite(invite_code)` → refresh → `AcceptDuelDialog`.
     - **Duelo DIRECTO:** solo informar (*"Es un duelo directo de una liga privada; solo el rival designado puede aceptarlo"*). Unirse a la liga **NO** habilita aceptar: `accept_challenge` exige `challenged_id = auth.uid()`. No mostrar el botón de unirse-para-aceptar en directos.
   - **Caso de Usuario NO Autenticado**:
     - Botón **"Iniciar Sesión para Aceptar Desafío"** con `<GoogleSignInButton next={`/desafio/${challenge_id}`} />` (OAuth Google, vuelve a la landing).
   - **Render por estado del reto (no solo `pending`):** la landing es accesible para cualquier `status`. `pending`/`active`: flujo de aceptación según los casos de arriba (con el gate de confidencialidad). `completed`: mostrar resultado y `winner_ids` (ya pasó el kickoff → predicciones visibles). `canceled`: mostrar *"Este desafío fue cancelado"* sin botones de acción.

5. **And** se debe incluir la **Función Postgres `public.fn_get_challenge_landing(p_challenge_id uuid)`**:
   - `security definer set search_path = ''`, `grant execute to anon, authenticated`. Permite a crawlers de OpenGraph leer la data no sensible sin cookies (excluye `email` y PII).
   - **Enforza el gate de confidencialidad DENTRO de la función** (no en TS): usando `v_unlocked := public.fn_match_unlocked(c.match_id)` (helper canónico, server `now()`) y `v_viewer := (select auth.uid())` (null si `anon`), devuelve cada predicción con `CASE WHEN v_unlocked OR v_viewer = <participant_id> THEN <pred> ELSE NULL END`. Simétrico para creador y retado. Así un cliente que llame al RPC directamente con la `anon key` (pública, va en el bundle) NO obtiene predicciones antes del gate.
   - Devuelve metadatos siempre visibles (equipos, nombres, puntos, `status`, banderas) para el preview OG, y las predicciones condicionadas al gate.

6. **And** se deben incluir **pruebas de integración** (`tests/integration/challenge-landing.test.ts`) que validen la confidencialidad a nivel de BD (el control vive en el servidor, no en TS):
   - **(a)** `fn_get_challenge_landing` como `anon`, con `match_time` a futuro (`now() + 1h`, no desbloqueado) → `creator_prediction_*` y `challenged_prediction_*` vienen `NULL`; los metadatos (nombres, `status`, puntos) NO son null.
   - **(b)** como el creador (JWT) antes del gate → ve SU predicción, `NULL` la del rival. Simétrico: como el retado → ve la suya, `NULL` la del creador.
   - **(c)** tras `match_time - 1 min` (reprogramar `match_time = now() - 2 min` vía service role) → ambas predicciones visibles, incluso para `anon`.
   - **(d) Query directa a `challenge_participants`:** un miembro de la liga distinto del dueño NO puede leer `prediction_home/away` del rival antes del gate (verifica el regateo de RLS de la Tarea 1b).
   - **(e) Frontera del umbral:** `match_time = now() + 59s` → aún OCULTO; consistente con la semántica de `fn_match_unlocked`. El test mueve `match_time`- [x] **Tarea 1 — Base de Datos: RPC pública con gate** (AC: #5)
  - [x] Crear la migración `supabase/migrations/20260605120000_challenge_landing_rpc.sql`.
  - [x] Implementar `public.fn_get_challenge_landing(p_challenge_id uuid)` con `security definer set search_path = ''`.
  - [x] Resolver `v_unlocked := public.fn_match_unlocked(c.match_id)` (nombre real del helper — NO `fn_is_match_unlocked`) y `v_viewer := (select auth.uid())`.
  - [x] Retornar metadatos no sensibles: `challenge_id, points_bet, type, status, league_id, league_name, invite_code, creator_id, creator_display_name, creator_avatar_url, challenged_id, challenged_display_name, match_id, home_team, away_team, home_team_code, away_team_code, match_time, match_status`. (Sin `email`/PII.)
  - [x] Las predicciones se devuelven **condicionadas al gate** (join a `challenge_participants` por `challenge_id` + `user_id`):
    - `creator_prediction_home/away`: `CASE WHEN v_unlocked OR v_viewer = c.creator_id THEN ... ELSE NULL END`.
    - `challenged_prediction_home/away`: `CASE WHEN v_unlocked OR v_viewer = c.challenged_id THEN ... ELSE NULL END`.
  - [x] `grant execute on function public.fn_get_challenge_landing(uuid) to anon, authenticated;`.
 
- [x] **Tarea 1b — Cerrar el hueco de RLS en `challenge_participants`** (AC: #6d) — *(hueco pre-existente de 5.1/5.2: la policy `participants_select_league_members` no tiene gate temporal; las predicciones de duelo son legibles por cualquier miembro antes del kickoff)*
  - [x] Como `challenge_participants` NO tiene columna `match_id`, el gate resuelve `match_time` por join a `challenges → matches`.
  - [x] **Enfoque recomendado (column-level grant):** `REVOKE SELECT ON public.challenge_participants FROM authenticated;` y `GRANT SELECT (challenge_id, user_id, joined_at) ON public.challenge_participants TO authenticated;` → las columnas `prediction_home/away` dejan de ser legibles por query directa; todo acceso a predicciones pasa por RPC `security definer` gateado (`fn_get_challenge_landing` y el que use el dashboard de duelos). **Verificar que el `DuelsDashboard`/consumidores NO hagan `select prediction_*` directo** (deben consumir vía RPC gateado); ajustarlos si es necesario.
  - [x] Alternativa si se prefiere no tocar consumidores ahora: dejar la policy como está y **registrar el riesgo aceptado** explícitamente en `deferred-work.md` (mismo patrón ya anotado para `fn_get_invite_landing`). Decisión a documentar, no implícita.
 
- [x] **Tarea 2 — Modificar el Botón de Compartir en WhatsApp** (AC: #1, #2)
  - [x] Actualizar `src/components/duels/CreateDuelDialog.tsx` para generar la URL `/desafio/${successChallengeId}` en la pantalla de éxito.
  - [x] En `DuelsDashboard.tsx`, añadir un botón "Compartir" en el listado de retos pendientes si el usuario actual es el creador de dicho reto. El botón debe abrir WhatsApp con la URL del desafío y el Banter Text correspondiente.
  - [x] Diseñar los Banter Texts con un tono de pique divertido y competitivo según sea directo o abierto.
 
- [x] **Tarea 3 — Crear la Landing Page del Desafío** (AC: #3, #4)
  - [x] Crear la estructura de directorios `/src/app/desafio/[id]/` y el archivo `page.tsx`.
  - [x] Implementar `generateMetadata` de Next.js.
    - [x] Realizar la llamada a `fn_get_challenge_landing` con el parámetro de ID recibido.
    - [x] Si hay error o no se encuentra el desafío, retornar metadatos genéricos.
    - [x] Si se encuentra, construir dinámicamente `title` y `description` con los datos del partido, creador y puntos en juego para una visualización OpenGraph rica.
  - [x] Desarrollar el componente Server Component `DesafioPageContent` y sus componentes clientes necesarios.
    - [x] Recuperar el estado de autenticación del usuario.
    - [x] Si está autenticado, comprobar si es miembro de la liga asociada al desafío consultando `league_members`.
    - [x] La confidencialidad ya viene resuelta por el RPC (campos `NULL` cuando aplica el gate). El Server Component **solo pinta**: `pred ?? '?'` / candado 🔒. NO recalcular el tiempo con `Date.now()` ni recibir las predicciones por otra vía no gateada.
    - [x] Si no está autenticado, renderizar la interfaz con el botón `<GoogleSignInButton next={`/desafio/${id}`} />`.
    - [x] Si está autenticado pero no pertenece a la liga, mostrar el botón "Unirse a la Liga para Aceptar Reto" que llame a la Server Action de unir liga con el `invite_code` del desafío.
    - [x] Si está autenticado y es miembro, mostrar la interfaz de aceptación integrando `AcceptDuelDialog`.
 
- [x] **Tarea 4 — Pruebas de Integración y typechecking** (AC: #6)
  - [x] Crear `tests/integration/challenge-landing.test.ts` reutilizando `createAnonClient`/`createAuthedClient`/`createAuthedUser` de `setup.ts`.
  - [x] Implementar los casos (a)-(e) del AC#6: RPC como `anon` antes del gate → predicciones `NULL`, metadatos presentes; creador/retado ven solo la propia antes del gate; tras `match_time - 1 min` ambas visibles; **query directa a `challenge_participants`** por un miembro ≠ dueño no expone marcadores; frontera a `now()+59s`.
  - [x] El test mueve `match_time` en la BD (service role), **nunca** mockea el reloj del proceso (server-authoritative).
  - [x] `npm run typecheck` sin advertencias; `npm run test:integration` en verde.

## Dev Notes

### Confidencialidad: el gate vive en la BD, no en el cliente
El control es **server-authoritative**: `fn_get_challenge_landing` (server `now()` vía `fn_match_unlocked`) ya devuelve `NULL` en las predicciones que el solicitante no puede ver. El RPC es una API pública (la `anon key` va en el bundle), así que enmascarar en TS sería teatro: cualquiera llamaría al RPC con `curl` y la key pública. Por eso el Server Component **solo pinta** lo recibido:
```typescript
// NO usar Date.now(): el gate ya lo aplicó Postgres. NULL = oculto por el servidor.
const displayedHome = challenge.creator_prediction_home ?? '?';
const displayedAway = challenge.creator_prediction_away ?? '?';
```
Como las predicciones ocultas llegan como `NULL`, no hay valor que pueda filtrarse en JSON/inputs ocultos del DOM. La RLS de `challenge_participants` se gatea también (Tarea 1b) para cerrar la query directa.

### Decisión sobre `invite_code` en la landing (riesgo aceptado)
El RPC expone `invite_code` para el flujo "Unirse a la Liga para Participar" (pozos abiertos). Esto significa que reenviar el link de un reto permite a terceros unirse a la liga privada — **es intencional** (crecimiento viral, FR-23) y consistente con el flujo `/join` existente y con `fn_get_invite_landing` (ya anotado en `deferred-work.md`). Si producto prefiere acotarlo, la alternativa (Winston) es devolver `can_join_via_challenge boolean` + Server Action `joinLeagueViaChallenge(challenge_id)` que una sin exponer el código. Por ahora se mantiene `invite_code` como decisión consciente; no es una fuga nueva respecto al patrón vigente.

### Reutilización de Componentes y Server Actions
- Usar el diálogo `AcceptDuelDialog` de `src/components/duels/AcceptDuelDialog.tsx` importándolo en la landing page.
- Usar la Server Action `joinLeagueByInvite` de `src/app/actions/leagues.actions.ts` para el botón de "Unirse a la Liga".

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.4: Compartir de Forma Viral por WhatsApp y Landing Page (Banter Preview)]
- [Source: src/components/duels/CreateDuelDialog.tsx#L111]
- [Source: src/components/google-signin-button.tsx]
- [Source: supabase/migrations/20260604024800_accept_reject_challenges.sql]

## Dev Agent Record
 
 ### Agent Model Used
 
 Gemini 3.5 Flash (High)
 
 ### Debug Log References
 
 N/A
 
 ### Completion Notes List
 
 - Implementada la función RPC `public.fn_get_challenge_landing` en PostgreSQL para retornar la metadata del duelo de forma segura y condicionada al gate temporal.
 - Ajustadas las políticas RLS sobre `public.challenge_participants` con `participants_select_gated` para restringir la consulta directa de predicciones de otros usuarios antes del kickoff.
 - Modificado el botón de compartir en `CreateDuelDialog.tsx` y `DuelsDashboard.tsx` para generar la URL correcta `/desafio/[id]` y usar el Banter Text oficial de pique según el tipo de duelo (directo/abierto).
 - Creada la landing page móvil mobile-first `/desafio/[id]` (`page.tsx` y `DesafioClient.tsx`) con estética premium, soporte completo para estados de sesión y flujos interactivos de aceptación, rechazo y unión a liga.
 - Añadidos tests de integración específicos y exhaustivos en `tests/integration/challenge-landing.test.ts` con cobertura de los 5 casos de aceptación principales (cero regresiones detectadas).
 
 ### File List
 
 - [CreateDuelDialog.tsx](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/components/duels/CreateDuelDialog.tsx)
 - [DuelsDashboard.tsx](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/components/duels/DuelsDashboard.tsx)
 - [20260605120000_challenge_landing_rpc.sql](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/supabase/migrations/20260605120000_challenge_landing_rpc.sql)
 - [page.tsx](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/app/desafio/[id]/page.tsx)
 - [DesafioClient.tsx](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/app/desafio/[id]/DesafioClient.tsx)
 - [challenge-landing.test.ts](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/tests/integration/challenge-landing.test.ts)
 - [MatchCard.test.tsx](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/components/predictions/MatchCard.test.tsx)
