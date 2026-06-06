# Contrato del Webhook Entrante de Zafronix

Este documento establece la especificación formal del contrato del webhook de Zafronix y el runbook de drift para detectar y mitigar cualquier discrepancia en producción.

- **Versión de Contrato:** `contract: v1 (2026-06-06)`
- **Fuente Oficial:** [Zafronix API Docs](https://api.zafronix.com/docs)
- **Fecha de Verificación:** 2026-06-06

---

## 1. Esquema de Firma HMAC-SHA256

El material firmado consiste en concatenar el timestamp recibido en la cabecera `X-Zafronix-Timestamp` (en milisegundos), un punto `.`, y el payload crudo de la solicitud (`rawBody`):

```
material = `${timestampMs}.${rawBody}`
```

La firma resultante se calcula usando **HMAC-SHA256** con el secreto `ZAFRONIX_WEBHOOK_SECRET` y se transmite en la cabecera `X-Zafronix-Signature-256` con el prefijo `sha256=`.

### Recipe de Validación (Node.js/TypeScript)
```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

const expected = "sha256=" + createHmac("sha256", secret)
  .update(`${timestamp}.${rawBody}`)
  .digest("hex");

const isValid = timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
```

---

## 2. Cabeceras del Contrato

Las siguientes cabeceras son obligatorias en cada entrega del webhook:

| Cabecera | Descripción | Tipo / Formato |
| --- | --- | --- |
| `X-Zafronix-Signature-256` | Firma HMAC-SHA256 de la solicitud | Cadena `sha256=<hex-de-64-caracteres>` |
| `X-Zafronix-Timestamp` | Marca de tiempo en la que se despachó el webhook | Entero (milisegundos desde la época Unix) |
| `X-Zafronix-Event-Type` | Nombre del evento despachado | Cadena (ej. `match.finalized`) |
| `X-Zafronix-Event-Id` | ID único de este evento específico para deduplicación | Cadena (Hexadecimal de 32 caracteres) |
| `X-Zafronix-Webhook-Id` | ID de la configuración del webhook suscriptor | Cadena con formato `whk_<24-hex-chars>` |
| `X-Zafronix-Delivery-Attempt` | Número de intento de entrega | Entero positivo (empieza en `1`) |

---

## 3. Estructuras de Payload Pineadas

### Evento: `match.finalized`
Publicado cuando se termina de procesar el marcador de un partido y se calcula el puntaje oficial.

```json
{
  "type": "match.finalized",
  "id": "8a3f1c50000000000000000000000000",
  "matchId": "2026-001",
  "year": 2026,
  "ts": "2026-06-11T19:30:00Z",
  "payload": {
    "homeTeam": "Mexico",
    "awayTeam": "USA",
    "homeScore": 2,
    "awayScore": 1,
    "result": "2-1",
    "extraTime": false,
    "penalties": null,
    "stage": "group_a",
    "actor": "actor:f1c80000"
  }
}
```

### Evento: `match.patched`
Publicado cuando se efectúa una corrección manual o de auditoría sobre el marcador de un partido finalizado.

```json
{
  "type": "match.patched",
  "id": "9b1e2d00000000000000000000000000",
  "matchId": "2026-001",
  "year": 2026,
  "ts": "2026-06-11T20:05:00Z",
  "payload": {
    "homeTeam": "Mexico",
    "awayTeam": "USA",
    "changes": {
      "homeScore": { "from": 2, "to": 3 },
      "result": { "from": "2-1", "to": "3-1" }
    },
    "actor": "actor:f1c80000"
  }
}
```

### Evento: `match.postponed`
Publicado cuando un partido cambia su estado a suspendido (`postponed`), cancelado (`cancelled` / `canceled`) o abandonado (`abandoned`).

```json
{
  "type": "match.postponed",
  "id": "5c2b8e00000000000000000000000000",
  "matchId": "2026-005",
  "year": 2026,
  "ts": "2026-06-12T15:00:00Z",
  "payload": {
    "homeTeam": "Brazil",
    "awayTeam": "Argentina",
    "status": "postponed",
    "rescheduledTo": "2026-06-13T17:00:00Z",
    "reason": "Stadium roof damage",
    "actor": "actor:f1c80000"
  }
}
```

---

## 4. Runbook de Drift en 3 Capas

Para protegernos ante cambios silenciosos o inesperados en la API de Zafronix, implementamos una estrategia de 3 capas.

### Capa 1: Pruebas Unitarias de Regresión (Offline)
Las pruebas de contrato offline ([zafronix-contract.test.ts](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/tests/unit/zafronix-contract.test.ts)) validan que los esquemas de validación Zod de nuestra aplicación sean compatibles con los payloads del contrato pineados. Si cambiamos un esquema localmente de forma incompatible con los samples oficiales, el pipeline de CI fallará impidiendo el despliegue de la regresión.

### Capa 2: Observabilidad y Detección de Desviaciones en Producción
Dado que los cambios ocurren del lado del proveedor (Zafronix), nuestro webhook está protegido mediante logging estructural detallado ante fallos de firma o validaciones Zod.
Si Zafronix cambia su contrato:
1. El handler (`POST`) responderá `400 Bad Request` ante fallos de parseo Zod.
2. Registrará la traza con los fallos de Zod (via `parseResult.error.issues`).
3. El sistema lanzará alertas automáticas debido al pico de errores `400` y `401` en los endpoints del webhook.

### Capa 3: Procedimiento de Actualización y Mitigación
Ante una alerta de desviación de contrato, siga estos pasos:
1. Descargue el payload que falló desde los logs de producción de Supabase/Vercel (preservando el body JSON exacto y las cabeceras).
2. Verifique la versión actualizada en [https://api.zafronix.com/docs](https://api.zafronix.com/docs).
3. Copie los nuevos esquemas/payloads de la documentación y guárdelos en el directorio de fixtures: `tests/fixtures/zafronix/`.
4. Actualice los esquemas Zod en [contract.ts](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/lib/zafronix/contract.ts) para coincidir con la nueva estructura.
5. Ejecute `npm run test:unit` para verificar que el test de contrato pasa limpio.
6. Actualice la versión del contrato al inicio de este archivo `docs/zafronix-webhook-contract.md`.
7. Despliegue el hotfix a producción.

---

## 5. Instrucciones para Capturar un Webhook Real ("B-después")

Actualmente, el registro automático de suscriptores para recibir webhooks en vivo en URLs locales/públicas no está habilitado por Zafronix. Una vez que Zafronix habilite esta funcionalidad o soporte nos provea un sample firmado real, siga este runbook para capturar y fijar la integración con una firma real en el proyecto:

1. **Exponer el puerto local:** Exponga el servidor Next.js local (por ejemplo usando ngrok, cloudflared tunnel, o un servicio público como webhook.site):
   ```bash
   ngrok http 3000
   ```
2. **Registrar la URL:** Envíe una solicitud de registro de subscriber a Zafronix con su URL expuesta (`https://<subdominio>.ngrok-free.app/api/webhooks/zafronix`).
3. **Disparar un evento:** Ejecute un cambio de estado en el sandbox de Zafronix (ej. finalizando un partido en el año 9999).
4. **Almacenar la solicitud cruda:** Recupere la solicitud HTTP exacta recibida por su endpoint. Copie el JSON crudo del payload exactamente como se transmitió en la red (sin formatearlo, ya que los cambios de espacios rompen la verificación HMAC) en `tests/fixtures/zafronix/real-delivery.local.json`.
5. **Configurar secreto local:** Copie el valor de `ZAFRONIX_WEBHOOK_SECRET` que le asignó Zafronix en su `.env.test.local`.
6. **Ejecutar pruebas:** Corra `npm run test:integration`. El test [zafronix-webhook-real.contract.test.ts](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/tests/integration/zafronix-webhook-real.contract.test.ts) detectará el archivo local de captura y verificará la firma real de Zafronix contra el handler de producción de forma local.
