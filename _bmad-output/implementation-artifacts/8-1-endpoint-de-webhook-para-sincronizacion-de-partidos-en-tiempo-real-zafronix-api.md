---
baseline_commit: 64eba1ed19b8a3f3a5b7a253ecd8e3ecbaa833a7
---

# Story 8.1: Endpoint de Webhook para Sincronización de Partidos en Tiempo Real (Zafronix API)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Como sistema de la quiniela,
quiero exponer un endpoint seguro de webhook HTTP POST en `/api/webhooks/zafronix`,
para que el sistema reciba y procese notificaciones en tiempo real sobre la finalización y estados de los partidos del Mundial de la FIFA 2026.

## Acceptance Criteria

1. **Given** una solicitud HTTP POST entrante en el endpoint `/api/webhooks/zafronix`
   **When** se valida la firma HMAC-SHA256 en la cabecera `X-Zafronix-Signature-256` con el timestamp `X-Zafronix-Timestamp` usando la clave secreta `ZAFRONIX_WEBHOOK_SECRET`
   **Then** el sistema calcula la firma localmente sobre la cadena `${timestamp}.${rawBody}` y verifica que coincida exactamente con la cabecera provista.

2. **Given** la validación de firma y ventana de tiempo
   **When** la diferencia de marca de tiempo (`X-Zafronix-Timestamp` vs reloj local del servidor) supera los 5 minutos (300 segundos) para prevenir ataques de replay
   **Then** el sistema rechaza la solicitud retornando un estado `400 Bad Request` o `401 Unauthorized` en formato JSON `{ error: string, message: string }`.

3. **Given** una firma y timestamp válidos
   **When** el sistema recibe los eventos `match.finalized` o `match.patched`
   **Then** busca el partido correspondiente en la tabla `public.matches` usando el campo `external_ref`
   **And** actualiza las columnas `home_score`, `away_score` y `status` (cambiándolo a `'finished'`).

4. **Given** un evento `match.finalized` o `match.patched`
   **When** el partido actualizado pertenece a una fase eliminatoria (knockout con `bracket_slot` no nulo) y contiene la resolución final de los equipos
   **Then** actualiza las columnas `home_team` y `away_team` en la tabla `public.matches`.

5. **Given** una firma y timestamp válidos
   **When** el sistema recibe el evento `match.postponed`
   **Then** actualiza el `status` del partido correspondiente en `public.matches` a `'suspended'` o `'canceled'` según el payload del evento
   **And** gatilla la anulación automática de predicciones (0 pts y `evaluated_at = now()`) y duelos asociados (retornando el escrow) de forma transaccional.

6. **Given** el nuevo endpoint de webhook
   **When** se ejecutan las pruebas
   **Then** se implementan pruebas unitarias y de integración de firma HMAC en `tests/integration/zafronix-webhook.test.ts` con payloads y firmas simuladas correctas e incorrectas, validando replay window y el procesamiento de los distintos eventos.

## Tasks / Subtasks

- [x] **Configuración e Infraestructura** (AC: #1)
  - [x] Validar que la variable de entorno `ZAFRONIX_WEBHOOK_SECRET` esté disponible en el entorno de desarrollo y pruebas.
- [x] **Desarrollo del Endpoint de Webhook (`src/app/api/webhooks/zafronix/route.ts`)** (AC: #1, #2, #3, #4, #5)
  - [x] Implementar la lectura del raw body como texto (`await req.text()`) para realizar la verificación de la firma HMAC sin alterar el stream del body.
  - [x] Validar cabeceras requeridas (`X-Zafronix-Signature-256`, `X-Zafronix-Timestamp`).
  - [x] Implementar la protección contra replay attacks validando que la diferencia absoluta entre `X-Zafronix-Timestamp` (en segundos) y el tiempo del servidor actual no supere los 300 segundos.
  - [x] Calcular la firma HMAC-SHA256 local sobre `${timestamp}.${rawBody}` con la clave secreta `ZAFRONIX_WEBHOOK_SECRET`.
  - [x] Validar coincidencia de firmas usando comparación segura en tiempo constante.
  - [x] Parsear el cuerpo JSON (`JSON.parse(rawBody)`) y validar la estructura con `zod`.
  - [x] Mapear los eventos de Zafronix (`match.finalized`, `match.patched`, `match.postponed`):
    - [x] **Para `match.finalized` y `match.patched`**: Actualizar marcador (`home_score`, `away_score`) y cambiar estado a `'finished'` en la tabla `public.matches` por `external_ref`. Si el partido es eliminatorio (`bracket_slot IS NOT NULL`) y trae equipos resueltos, actualizar `home_team` y `away_team`.
    - [x] **Para `match.postponed`**: Actualizar `status` a `'suspended'` o `'canceled'`. De forma transaccional, anular predicciones asociadas estableciendo `points_earned = 0.00` y `evaluated_at = now()`. (Nota: La cancelación de duelos y reembolso de escrow se gatillan automáticamente en cascada mediante el trigger `tr_resolve_challenges_on_match_status_change` al cambiar el status a suspended/canceled en la base de datos).
  - [x] Retornar respuestas con códigos HTTP coherentes (`200 OK` para éxito, `400 Bad Request` para firma/timestamp inválidos o errores de parseo, `404 Not Found` si el partido no existe).
- [x] **Pruebas de Integración (`tests/integration/zafronix-webhook.test.ts`)** (AC: #6)
  - [x] Diseñar tests de firma HMAC exitosa y fallida.
  - [x] Diseñar tests para el descarte por ventana de tiempo (replay attack).
  - [x] Simular payloads de `match.finalized` y `match.patched` para validar actualizaciones correctas de marcadores y nombres de equipos en `public.matches`.
  - [x] Simular payloads de `match.postponed` para verificar la anulación automática de predicciones (`points_earned = 0.00` y `evaluated_at IS NOT NULL`) y que el trigger de base de datos reembolse el escrow y cancele los duelos.

## Dev Notes

- **Inicialización de Cliente de Supabase**: Utilizar el cliente administrativo de Supabase (`createServiceRoleClient` o equivalente con `SUPABASE_SERVICE_ROLE_KEY`) para realizar las escrituras directamente y saltar las restricciones de RLS, ya que este webhook es un proceso de backend seguro.
- **Lectura del Body en Next.js**: No consumir la solicitud llamando a `req.json()` inicialmente; se debe llamar a `req.text()` para obtener el cuerpo crudo para la validación HMAC y luego parsearlo usando `JSON.parse(bodyText)`.
- **Lógica Transaccional**: Las anulaciones de predicciones por suspensión de partidos (`match.postponed`) deben ocurrir en una transacción de base de datos coordinada si se ejecutan múltiples consultas, o mediante una llamada RPC en PostgreSQL si se prefiere encapsular en la base de datos.
- **Verificación de Replay Window**: Utilizar segundos o milisegundos de forma consistente (por ejemplo, comparar timestamps Unix en segundos). El header `X-Zafronix-Timestamp` puede venir en segundos o milisegundos; validar la unidad antes de realizar la validación contra `Date.now()`.

### Project Structure Notes

- La API REST reside en `/src/app/api/webhooks/zafronix/route.ts` de acuerdo con las especificaciones del App Router.
- Las pruebas de integración residen en `tests/integration/zafronix-webhook.test.ts` utilizando Vitest y conectándose a la base de datos de pruebas local.

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Seguridad en Webhooks (HMAC-SHA256)]
- [Source: _bmad-output/planning-artifacts/architecture.md#Rutas REST secundarias]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.1]
- [Source: supabase/migrations/20260604195000_resolve_challenges.sql#tr_resolve_challenges_on_match_status_change]

## Dev Agent Record
 
 ### Agent Model Used
 
 Gemini 3.5 Flash (High)
 
 ### Debug Log References
 
 - Error 401 en llamadas al webhook debido a inconsistencia entre `ZAFRONIX_WEBHOOK_SECRET` en `.env` y `.env.test.local`. Solucionado igualando el valor en `.env`.
 - Error 500 en llamadas al webhook debido a la falta de variables `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en `.env` para el dev server. Solucionado añadiendo los valores correspondientes del stack local a `.env`.
 
 ### Completion Notes List
 
 - El endpoint `/api/webhooks/zafronix` fue desarrollado con validación robusta de firma HMAC-SHA256 y protección contra replay attacks.
 - Soporta eventos de `match.finalized`, `match.patched` y `match.postponed` actualizando correctamente los partidos en la base de datos local y anulando las predicciones asociadas.
 - La exclusión en `src/utils/supabase/middleware.ts` para rutas de `/api/webhooks` previene redirecciones no deseadas a `/auth/login`.
 - Las pruebas de integración cubren todos los criterios de aceptación con 100% de éxito.
 
 ### File List
 
 - [route.ts](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/app/api/webhooks/zafronix/route.ts)
 - [zafronix-webhook.test.ts](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/tests/integration/zafronix-webhook.test.ts)
 - [middleware.ts](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/utils/supabase/middleware.ts)
 - [.env](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/.env)
