# Fase 9 — Viaje completo multi-usuario, cuenta y casos extremos transversales

## Objetivo
Dos entregas: (1) el **gran tour** — un test largo que recorre la vida completa de una liga con varios usuarios reales en paralelo, verificando al final todos los números; (2) los casos extremos transversales que no pertenecen a una sola feature: cuenta/insignias, salir de la liga, multi-liga, expulsado en caliente, viewport desktop y resiliencia de UI.

## Dependencias
Fases 1-8 TODAS (el gran tour reutiliza cada helper y cada flujo ya estabilizado).

## Contexto requerido
- `00-contexto.md` completo.
- Leer: `src/components/account/*` (AccountLeaguesPanel, LeaveLeagueDialog, BadgeHistory, ProfileSummaryCard, ShareProfileButton), `src/app/account/page.tsx`, migración `20260607140000_leave_league.sql` (qué pasa EXACTAMENTE con los datos del que se va: trigger `tr_cleanup_on_member_removed` — copiar la semántica a las notas), `tests/integration/account-awards-materialization.test.ts` (cómo se materializan las insignias), `src/components/layout/BottomNavbar.tsx`.

## Casos de prueba

### Gran tour (`tests/e2e/full-journey.spec.ts`) — UN test `@slow`, serial, ~20 pasos
Tres usuarios: Ana (creadora/admin), Beto y Carla. Partidos `test_`: 2 de J1 (finalizables), 1 de J2 editable.

| Paso | Acción | Verificación inmediata |
|---|---|---|
| 1 | Ana se registra (form) y crea liga CON pago | liga creada, Ana admin |
| 2 | Ana copia el invite code | código visible |
| 3 | Beto (contexto 2) entra por `/join/<code>` anon → se registra → auto-join | Beto miembro pending; modal de pago |
| 4 | Carla (contexto 3) igual | 3 miembros |
| 5 | Ana marca a Beto como `paid` en `/standings/manage` | badge actualizado |
| 6 | Los tres predicen el partido 1 de J1 (valores distintos: exacto/resultado/fallo respecto al resultado que vendrá) | autosave confirmado en los 3 |
| 7 | Beto predice también el partido de J2 | multiplicador dinámico correcto |
| 8 | Ana reta a Beto (duelo directo, apuesta X de saldo sembrado) | escrow deducido |
| 9 | Beto acepta con su predicción | duelo active |
| 10 | Cada uno elige campeón en `/awards` | 3 selecciones per-league |
| 11 | Webhook firmado: partido 1 pasa a live | `/predictions` muestra "En vivo" |
| 12 | Con Carla mirando `/live`: webhook gol | toast + reorden (`@realtime`) |
| 13 | Webhook finalized del partido 1 | — |
| 14 | `/standings`: orden y puntos correctos | comparar contra cálculo importado de `src/utils/standings.ts` con los datos sembrados (cero números mágicos) |
| 15 | `/duels`: duelo resuelto, saldo del ganador actualizado | BD + UI |
| 16 | `assertLedgerInvariant` para los 3 | pasa |
| 17 | Predicciones ajenas del partido 1 ahora visibles (time-gating) | donde aplique |
| 18 | Carla sale de la liga (`/account` → LeaveLeagueDialog) | fuera del roster; standings con 2 |
| 19 | Ana NO puede salir (último admin… verificar: aquí hay 1 admin) | mensaje claro |
| 20 | Cleanup completo | BD sin restos `test_`/usuarios e2e |

### Cuenta y extremos (`tests/e2e/account-edge.spec.ts`)

| ID | Caso | Verificación |
|---|---|---|
| EDG-01 | `/account` muestra perfil y ligas | display_name, avatar, `account-league-item` por liga |
| EDG-02 | Insignias tras jornada finalizada | sembrar la condición (jornada completa con resultados que produzcan nostradamus/el_salado/el_tibio según las reglas reales — leer la materialización primero); `badge-item` visibles. Si la materialización requiere visitar una ruta concreta, ejercitarla |
| EDG-03 | Salir de liga: efectos según diseño | tras salir, la semántica de la migración se cumple (¿se borran sus predicciones? ¿sus duelos se cancelan y reembolsan a contrapartes? — assertear lo que el SQL realmente hace) |
| EDG-04 | Último admin no puede salir | error claro; sigue siendo miembro |
| EDG-05 | Re-unirse tras salir | entra de nuevo limpio (balance/predicciones según semántica del cleanup); sin errores |
| EDG-06 | Expulsado en caliente | usuario navegando `/predictions` es expulsado por el admin (otro contexto); al recargar pierde acceso a los datos de esa liga (NoLeagueState o equivalente) |
| EDG-07 | Multi-liga sin fugas | usuario en 2 ligas con predicciones/duelos distintos: los datos de una no aparecen en la otra (predicciones, standings, duelos, awards) |
| EDG-08 | Navegación BottomNavbar | recorrer todos los `nav-item` y verificar destino |
| EDG-09 | Doble submit transversal | crear duelo con doble click rápido → un solo challenge (BD) |
| EDG-10 | Inputs extremos | nombre de liga en el límite del schema (leerlo), predicción 99-99 (¿la UI lo permite? ¿el server?), apuesta gigante > saldo | comportamiento controlado en todos |
| EDG-11 | Smoke desktop `@desktop` | `/predictions`, `/standings`, `/duels`, `/live` renderizan sin layout roto en 1280×800 (elementos clave visibles, sin overflow catastrófico) |
| EDG-12 | Refresco en cada ruta conserva estado | loop de rutas con `page.reload()`: sesión y datos persisten |

## Criterios de aceptación (DoD)
1. Gran tour verde 3 ejecuciones seguidas (es el test más valioso y el más frágil: invertir en su estabilidad).
2. 12 casos de extremos verdes (o documentada la adaptación a la semántica real en EDG-02/03/05).
3. La semántica real de `leave_league`/cleanup copiada en las notas desde la migración.
4. Suite completa + lint + typecheck verdes.

## Riesgos y notas
- El gran tour debe usar `test.step()` por paso para que el reporte señale dónde falla.
- 3 logins por formulario ≈ 10-15 s de overhead: aceptable para UN test; no replicar el patrón en tests pequeños.
- EDG-02 (insignias) tiene la lógica menos documentada del producto: leer `account-awards-materialization.test.ts` e implementar el caso solo si la condición es construible de forma determinista; si no, documentar por qué y dejar el caso reducido (visibilidad con datos sembrados directamente en `member_badges` via service role).
- EDG-10: si el producto permite 99-99 sin límite superior, no es bug salvo que el schema diga lo contrario — assertear contra el schema real.

## Notas de ejecución
_(rellenar al ejecutar)_
