# Registro de bugs de producto encontrados por la suite E2E

> Creado por la Fase 1 del plan E2E. Regla de oro §9.2 de `00-contexto.md`: si el
> comportamiento real del producto contradice las reglas de negocio (§4), NO se
> "arregla" el test para que pase — se registra aquí y el test se marca
> `test.fixme` referenciando el ID del bug.

## Plantilla de registro

```markdown
## BUG-NNN — <título corto>

- **Fecha**: YYYY-MM-DD
- **Fase / caso de prueba**: Fase N · <ID del caso> (`tests/e2e/<spec>.ts`)
- **Severidad**: crítica | alta | media | baja
- **Esperado**: <comportamiento según 00-contexto.md §4.x o el doc de la fase>
- **Real**: <comportamiento observado, con pasos de reproducción>
- **Archivos implicados**: <componentes / actions / RPCs / migraciones>
- **Estado**: abierto | corregido (commit) | descartado (razón)
```

## Bugs registrados

## BUG-001 — `/desafio/[id]` no es accesible para visitantes anónimos

- **Fecha**: 2026-06-10
- **Fase / caso de prueba**: Fase 2 · SMK-09b (`tests/e2e/smoke.spec.ts`, `test.fixme`)
- **Severidad**: media
- **Esperado**: `00-contexto.md` §2 define `/desafio/[id]` como landing **pública**
  (acceso anon/auth) con metadata OG para previews de WhatsApp. Un visitante sin
  sesión debería ver la landing del duelo (con predicciones ocultas pre-kickoff).
- **Real**: el middleware (`src/utils/supabase/middleware.ts`) solo excluye `/`,
  `/auth*`, `/join*` y `/api/*` del guard de sesión; cualquier visita anónima a
  `/desafio/<id>` se redirige a `/auth/login?next=/desafio/<id>`. Los crawlers
  de WhatsApp/OG (sin cookies) nunca ven la metadata de `generateMetadata`.
- **Archivos implicados**: `src/utils/supabase/middleware.ts`,
  `src/app/desafio/[id]/page.tsx` (la página y su RPC `fn_get_challenge_landing`
  sí soportan anon; es el middleware quien bloquea).
- **Estado**: abierto
