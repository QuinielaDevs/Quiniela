---
baseline_commit: 024163aa824c440a730499a0a8acbbaaa65249d2
---

# Story 8.2: Sincronización Periódica de Respaldo con ETags (GitHub Actions Cron Job)

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

Como sistema de la quiniela,
quiero configurar un cron job periódico en GitHub Actions y un script de sincronización con soporte para cabeceras condicionales `If-None-Match` y ETags,
para que los marcadores de respaldo del Mundial se sincronicen de manera automatizada y eficiente sin agotar la cuota de llamadas gratuitas de la API de Zafronix.

## Acceptance Criteria

1. **Given** un workflow programado de GitHub Actions (`.github/workflows/sync-matches.yml`) ejecutándose cada 30 minutos durante el periodo de partidos.
2. **When** el script de sincronización realiza una solicitud HTTP GET a la API de Zafronix (`https://api.zafronix.com/fifa/worldcup/v1/matches?year=2026`).
3. **Then** incluye en la cabecera `If-None-Match` el último `ETag` (hash) guardado en la base de datos (en la tabla de configuración del sistema `public.system_config` con la clave `'zafronix_matches_etag'`).
4. **And** la llamada se realiza de manera segura inyectando el token `WC_API_KEY` desde los secretos de GitHub Actions en la cabecera `X-API-Key`.
5. **When** el servidor de Zafronix responde con `304 Not Modified`.
6. **Then** el script finaliza sin consumir cuota de llamadas ni realizar escrituras en la base de datos.
7. **When** el servidor responde con `200 OK`.
8. **Then** el script lee el body, actualiza los marcadores (`home_score`, `away_score`), equipos (`home_team`, `away_team` para partidos de eliminatorias) y estados en la tabla `public.matches` (mediante upsert/actualización buscando por `external_ref`), y almacena el nuevo `ETag` retornado por la cabecera `etag` de la API en la base de datos (tabla `public.system_config` clave `'zafronix_matches_etag'`) para la siguiente llamada.
9. **And** se implementan pruebas unitarias y de integración que utilicen mocks para simular las respuestas `200 OK` (con actualización de datos y ETag) y `304 Not Modified` (comprobando que no hay cambios ni consumo), validando el comportamiento esperado.

## Tasks / Subtasks

- [x] **Configuración e Infraestructura** (AC: #1, #4)
  - [x] Crear el archivo `.github/workflows/sync-matches.yml` con la configuración del cron job (ejecución cada 30 minutos).
  - [x] Configurar el workflow para utilizar Node.js, instalar dependencias y ejecutar `npx tsx scripts/sync-matches.ts`.
  - [x] Inyectar las variables de entorno `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `WC_API_KEY` (esta última mapeada desde `secrets.WC_API_KEY`) en el paso del workflow.
  - [x] Asegurarse de que `tsx` esté disponible. Se recomienda agregar `tsx` a las `devDependencies` de `package.json` para agilizar la ejecución del workflow en lugar de descargarlo en caliente.
- [x] **Desarrollo del Script de Sincronización (`scripts/sync-matches.ts`)** (AC: #2, #3, #5, #6, #7, #8)
  - [x] Cargar variables de entorno mediante `dotenv` (importante para ejecución local y desarrollo).
  - [x] Validar que las variables de entorno requeridas estén presentes (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WC_API_KEY`). Si falta alguna, loguear un error claro y abortar.
  - [x] Instanciar el cliente de Supabase con el rol `service_role` para omitir políticas RLS de lectura y escritura.
  - [x] Consultar el ETag anterior de la base de datos: `SELECT value FROM public.system_config WHERE key = 'zafronix_matches_etag'`.
  - [x] Realizar la solicitud `fetch` a `https://api.zafronix.com/fifa/worldcup/v1/matches?year=2026` pasando las cabeceras `X-API-Key` y `If-None-Match` (si existe ETag).
  - [x] Procesar la respuesta:
    - [x] **Si el status es 304**: Loguear un mensaje de que no hay cambios y salir del proceso de forma exitosa (`process.exit(0)`).
    - [x] **Si el status es 200**:
      - [x] Obtener el nuevo ETag desde la cabecera `etag` o `ETag` de la respuesta.
      - [x] Validar y parsear el cuerpo JSON de la respuesta (array de partidos de Zafronix) usando un esquema de `zod`.
      - [x] Consultar todos los partidos locales (`public.matches`) para comparar y realizar las actualizaciones solo sobre los partidos que cambiaron en score, status o equipos de eliminatorias.
      - [x] Para cada partido cambiado: actualizar `home_score`, `away_score`, `status` y `updated_at`. Si `bracket_slot` no es nulo y la API provee equipos reales, también actualizar `home_team` y `away_team`.
      - [x] Guardar/actualizar el nuevo ETag en `public.system_config` asociándolo a la clave `'zafronix_matches_etag'`.
      - [x] Loguear un resumen descriptivo del resultado de la sincronización (ej. "Partidos actualizados: X, ETag actualizado: Y").
    - [x] **Si el status es cualquier otro (4xx, 5xx)**: Loguear el error de forma detallada y abortar con código de salida no-cero (`process.exit(1)`).
- [x] **Desarrollo de Pruebas de Integración (`tests/integration/sync-matches.test.ts`)** (AC: #9)
  - [x] Crear la suite de pruebas `tests/integration/sync-matches.test.ts` usando Vitest.
  - [x] Mockear la función global `fetch` para interceptar llamadas a la API de Zafronix.
  - [x] Probar el escenario **304 Not Modified**:
    - [x] Insertar previamente un ETag ficticio en `public.system_config`.
    - [x] Configurar el mock de fetch para retornar status 304.
    - [x] Ejecutar la lógica del script (o importar la función principal).
    - [x] Verificar que no se realizaron peticiones de actualización a `public.matches` ni se modificó el ETag.
  - [x] Probar el escenario **200 OK**:
    - [x] Insertar previamente partidos de prueba en `public.matches` con referencias externas estables.
    - [x] Configurar el mock de fetch para retornar status 200 con un ETag nuevo y un array de partidos de prueba con goles y estados actualizados.
    - [x] Ejecutar el script de sincronización.
    - [x] Verificar que los partidos correspondientes fueron modificados en la base de datos con los nuevos marcadores y estados.
    - [x] Verificar que el ETag en `public.system_config` clave `'zafronix_matches_etag'` se actualizó al nuevo valor.
  - [x] Validar que se envían las cabeceras `X-API-Key` y `If-None-Match` de forma correcta.

## Dev Notes

- **Conexión a la Base de Datos**: Al ser un script autónomo de cron job, debe inicializarse el cliente de Supabase usando el rol de servicio `service_role` para poder modificar las tablas `matches` y `system_config` evadiendo las restricciones de RLS.
- **Formato y Timezone**: Todos los campos temporales (`updated_at`, `match_time`) deben manejarse y guardarse en formato ISO 8601 UTC.
- **Protección contra Regresiones / Cascade Triggers**: Las actualizaciones del estado de los partidos gatillarán los triggers existentes en la base de datos (por ejemplo, el trigger para cancelar desafíos pendientes si un partido se suspende o finaliza). Asegurar que las actualizaciones se realicen limpiamente.
- **Rendimiento**: Evitar realizar escrituras innecesarias en la base de datos si no hay diferencias entre la API y la base de datos local. Comparar los campos relevantes en memoria antes de disparar la actualización de cada partido.

### Project Structure Notes

- El cron job de GitHub Actions debe crearse en `.github/workflows/sync-matches.yml`.
- El script de sincronización autónomo se ubicará en `scripts/sync-matches.ts` para alinearse con los scripts administrativos del proyecto.
- Las pruebas de integración se ubicarán en `tests/integration/sync-matches.test.ts` para correr dentro de la suite de Vitest de integración contra el Supabase local.
- Se agregará el comando `"sync-matches": "tsx scripts/sync-matches.ts"` en la sección `scripts` de `package.json` para facilitar su ejecución local y en CI.
- Agregar `tsx` como dependencia de desarrollo: `npm install -D tsx` para asegurar que el comando funcione de forma nativa e integrada en cualquier entorno de ejecución.

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Sincronización Periódica de Respaldo (Conditional GETs con ETags)]
- [Source: _bmad-output/planning-artifacts/architecture.md#Bypass de Límite de Cuota de API]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.2]
- [Source: supabase/migrations/20260605160000_add_system_config_table.sql]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (Thinking)

### Debug Log References

- Docker Desktop no disponible en el entorno local — no se pudieron ejecutar las pruebas de integración directamente. TypeScript compila limpio y las pruebas unitarias existentes (267/267) pasan sin regresiones.

### Completion Notes List

- ✅ Workflow de GitHub Actions creado con cron `*/30 * * * *`, Node.js 22, npm ci, y ejecución de `npx tsx scripts/sync-matches.ts` con los tres secretos inyectados (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WC_API_KEY`).
- ✅ Script `scripts/sync-matches.ts` implementado con arquitectura testeable: función `syncMatches()` exportada que acepta un `fetchFn` inyectable para mocking. Incluye validación Zod del response, smart diffing en memoria (solo escribe partidos que realmente cambiaron), mapeo de status de API a DB, soporte para bracket_slot/knockout teams, y gestión completa del ciclo de vida del ETag.
- ✅ Suite de integración `tests/integration/sync-matches.test.ts` con 15 casos de prueba cubriendo: ETag CRUD, escenario 304 (sin writes/sin cambio de ETag), escenario 200 (actualización de scores/status/teams, ETag nuevo), cabeceras HTTP correctas, smart diffing (no actualiza si datos idénticos), partidos desconocidos ignorados, y manejo de errores HTTP (500/403/body inválido).
- ✅ `tsx` añadido a devDependencies y script `sync-matches` añadido a package.json.
- ✅ TypeScript compila sin errores (`tsc --noEmit` limpio).
- ✅ 267 pruebas unitarias existentes pasan sin regresiones.

### File List

- [NEW] `.github/workflows/sync-matches.yml`
- [NEW] `scripts/sync-matches.ts`
- [NEW] `tests/integration/sync-matches.test.ts`
- [MOD] `package.json` (añadido `tsx` devDep + script `sync-matches`)

## Change Log

- **2026-06-06**: Implementación completa de Story 8.2 — Cron job de GitHub Actions para sincronización periódica de respaldo con ETags contra la API de Zafronix. Workflow cada 30 min, script autónomo con smart diffing y validación Zod, suite de 15 pruebas de integración con fetch mockeado.
