# Fase 2 — Smoke de todas las rutas + Autenticación completa

## Objetivo
Garantizar que TODAS las rutas del producto cargan sin error en su estado correcto (anon/auth/admin) y cubrir el ciclo de vida completo de la sesión: registro, login, logout, recuperación de contraseña, guards y redirecciones seguras.

## Dependencias
Fase 1 completada (helpers `users.ts`, `mail.ts`, testids de forms de auth).

## Contexto requerido
- `00-contexto.md` §2 (rutas), §5.4 (emails locales), §7.6 (OAuth fuera de alcance).
- Leer antes de escribir asserts: `src/components/login-form.tsx`, `sign-up-form.tsx`, `forgot-password-form.tsx`, `update-password-form.tsx`, `google-signin-button.tsx`, `logout-button.tsx`, `src/utils/redirect.ts` (`getSafeNextPath`), `src/app/auth/*/page.tsx`, middleware/guards (buscar dónde se hace el redirect a login — probablemente `src/middleware.ts` o `src/lib/supabase`).

## Entregables
- `tests/e2e/smoke.spec.ts`
- `tests/e2e/auth.spec.ts`

## Casos de prueba

### Smoke (`smoke.spec.ts`)
Un `describe` anon y otro autenticado (un solo usuario+liga sembrados en `beforeAll` con un partido `test_` de cada estado para que las páginas tengan datos).

| ID | Caso | Setup | Verificación |
|---|---|---|---|
| SMK-01 | `/` carga para anónimo | — | respuesta 200, contenido principal visible, sin error boundary |
| SMK-02 | `/auth/login` carga | — | inputs de email/contraseña y botón Google visibles |
| SMK-03 | `/auth/sign-up` carga | — | formulario visible |
| SMK-04 | `/auth/forgot-password` carga | — | formulario visible |
| SMK-05 | Rutas de juego cargan autenticado | usuario+liga+partidos seed | loop sobre `/predictions`, `/standings`, `/live`, `/duels`, `/awards`, `/account`, `/rules`: heading/elemento raíz visible (`predictions-board`, `standings-table` o estado vacío legítimo, `live-board`, `duels-dashboard`, `awards-board`, etc.), **cero excepciones de página** |
| SMK-06 | `/standings/manage` carga para admin | usuario admin | `match-admin-row` o lista visible |
| SMK-07 | `/leagues/new` carga autenticado | usuario sin/con liga | formulario visible |
| SMK-08 | `/join/<código válido>` carga anónimo | liga sembrada | `join-league-card` con nombre de liga |
| SMK-09 | `/desafio/<uuid inexistente>` no crashea | — | estado "no encontrado" amable, no 500 |
| SMK-10 | Ruta inexistente → not-found | — | página 404 de Next, no error boundary |
| SMK-11 | Sin errores graves de consola en rutas de juego | mismo seed | recolectar `page.on("console")` tipo error durante SMK-05 y assertear lista vacía (permitir lista blanca documentada de ruido conocido, p. ej. favicons) |

### Autenticación (`auth.spec.ts`)

| ID | Caso | Setup | Acción | Verificación |
|---|---|---|---|---|
| AUTH-01 | Login correcto | usuario creado vía admin API | form login | redirect a `/predictions`, sesión persistente |
| AUTH-02 | Credenciales inválidas | usuario existente | password incorrecta | mensaje de error (copiar literal del componente), sigue en `/auth/login` |
| AUTH-03 | Email malformado | — | "noesunemail" | validación impide submit o muestra error |
| AUTH-04 | `next` seguro se respeta | usuario | visitar `/auth/login?next=/standings` y loguear | termina en `/standings` |
| AUTH-05 | `next` malicioso se normaliza | usuario | `?next=https://evil.com` y `?next=//evil.com` | NUNCA sale del origen; termina en ruta interna (ver `getSafeNextPath`) |
| AUTH-06 | Sign-up con email+password crea cuenta | — | completar form de registro | comportamiento real del flujo (página success o sesión directa — verificar en `sign-up-form.tsx`); el perfil existe en BD (trigger `fn_handle_new_user`, display_name default) |
| AUTH-07 | Password corta rechazada | — | password de 4 chars | error (mínimo 8, `config.toml`) |
| AUTH-08 | Email duplicado en sign-up | usuario existente | registrar mismo email | error claro, sin crear duplicado |
| AUTH-09 | Logout | sesión activa | botón logout | vuelve a estado anon; visitar `/predictions` redirige a login |
| AUTH-10 | Recuperación de contraseña completa | usuario existente | forgot-password → leer email en Mailpit/Inbucket (`mail.ts`) → seguir link → `/auth/update-password` → nueva password → login con la nueva | login exitoso con la nueva password; la vieja ya no sirve |
| AUTH-11 | `/auth/update-password` sin sesión de recovery | — | visita directa | guard/redirect o error controlado (verificar comportamiento real) |
| AUTH-12 | Botón Google redirige al provider | — | interceptar navegación al hacer click | request hacia `<SUPABASE_URL>/auth/v1/authorize?provider=google` (abortar ahí; NO completar OAuth) |
| AUTH-13 | Guards de rutas protegidas | sin sesión | loop: `/predictions`, `/standings`, `/standings/manage`, `/live`, `/duels`, `/awards`, `/account`, `/leagues/new`, `/rules` | cada una redirige a `/auth/login`; si el guard adjunta `next`, verificar que apunta a la ruta original |
| AUTH-14 | La sesión sobrevive recargas | sesión activa | `page.reload()` en `/predictions` | sigue autenticado (cookies SSR chunked correctas) |

## Criterios de aceptación (DoD)
1. Los 25 casos implementados y verdes en local 3 ejecuciones seguidas (estabilidad).
2. AUTH-10 funciona contra el servidor de email local real (sin mocks).
3. Suite completa (`npm run test:e2e`) verde; lint/typecheck verdes.
4. Notas de ejecución rellenadas (incluida la lista blanca de consola de SMK-11 y el comportamiento real de AUTH-06/11).

## Riesgos y notas
- AUTH-10 depende de la versión del CLI de Supabase (Mailpit vs Inbucket) — el helper de Fase 1 ya lo abstrae; si el formato del email cambia, ajustar `extractLinks`.
- AUTH-12: usar `page.route`/`waitForRequest` para capturar la URL sin navegar de verdad al provider (placeholders de Google en local pueden devolver error si se navega — irrelevante para el caso).
- SMK-11 puede destapar ruido legítimo (hydration warnings, etc.): documentar la lista blanca, no silenciar el caso entero.

## Notas de ejecución
_(rellenar al ejecutar)_
