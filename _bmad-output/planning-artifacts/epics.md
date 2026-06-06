---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - '_bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/DESIGN.md'
  - '_bmad-output/planning-artifacts/ux-designs/ux-pija-quiniela-2026-06-01/EXPERIENCE.md'
---

# pija-quiniela - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for pija-quiniela, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

- **FR-1: Registro Exclusivo con Google OAuth**
  El usuario puede crear una cuenta e iniciar sesión de manera instantánea utilizando su cuenta de Google. Al hacer clic en "Continuar con Google", el sistema valida las credenciales y crea el perfil del usuario (nombre, email y avatar) sin pasos adicionales.
- **FR-3: Generación de Enlace de Invitación**
  El Administrador puede generar un enlace único para invitar a usuarios a su liga. El enlace debe contener un formato amigable e incluir metadatos de OpenGraph para WhatsApp/Telegram, codificando de manera segura el ID o código de la liga (ej. `/join/LIGA123`).
- **FR-4: Registro y Adhesión Automática**
  El sistema procesa el enlace de invitación y asocia al invitado a la liga de manera transparente tras su registro. Si no está autenticado, precarga el código en segundo plano, va a login, y al autenticarse se une a la liga automáticamente.
- **FR-5: Indicador de Pago (Presión Social)**
  El Administrador puede marcar a los miembros de la liga como "Pagado" o "Pendiente de Pago". Los nuevos entran como "Pendiente". Se muestra públicamente una etiqueta roja ("Pendiente") o check verde ("Pagado") en la tabla de posiciones. No se bloquea el juego del usuario.
- **FR-6: Baja de Miembros (Expulsión)**
  El Administrador puede eliminar de forma definitiva a cualquier miembro. El expulsado es removido de la clasificación y sus predicciones y desafíos activos asociados a esa liga se cancelan o eliminan.
- **FR-24: Formulario de Creación y Configuración de Liga**
  El Administrador puede configurar mediante un formulario las reglas y logística de la misma (Modos de predicción, pago requerido, montos, instrucciones).
- **FR-7: Controles Táctiles Incrementales**
  La vista de predicciones proporciona botones de más/menos (+/-) de 48x48px para ajustar los marcadores de los partidos, sin desplegar el teclado nativo del móvil.
- **FR-8: Auto-guardado con Debounce e Indicador Visual**
  El sistema guarda silenciosamente las predicciones tras 500ms de inactividad de clics. Tras confirmarse la persistencia, se muestra un micro-indicador de éxito (destello verde o check ✓). Si hay error de red, muestra advertencia visual y reintenta automáticamente.
- **FR-9: Bloqueo Temporal de Predicciones**
  El sistema bloquea la edición de predicciones para un partido 1 minuto antes de su horario de inicio oficial (Kickoff), basado en la hora UTC del servidor de base de datos.
- **FR-22: Gestión de Partidos Suspendidos o Cancelados**
  Si la FIFA suspende/cancela un partido, se anulan las predicciones (0 pts) y duelos asociados (devolviendo el escrow).
- **FR-10: Cálculo del Multiplicador Incremental**
  Calcula y almacena un multiplicador basado en la antelación de la predicción respecto al kickoff: >5 semanas (2.0x), 4-5 semanas (1.8x), 3-4 semanas (1.6x), 2-3 semanas (1.4x), 1-2 semanas (1.2x), <1 semana (1.0x). Si se actualiza, se recalcula y sobrescribe.
- **FR-11: Aplicación del Multiplicador en Puntuación**
  Aplica el multiplicador a los puntos base obtenidos tras terminar el partido: Marcador exacto (5 pts), ganador/empate con marcador incorrecto (2 pts), sin acierto (0 pts). PuntosObtenidos = PuntosBase * Multiplicador.
- **FR-12: Creación de Desafíos (Directos y Abiertos)**
  Un jugador con saldo de puntos suficiente puede crear un desafío para un partido (Duelo 1v1 directo o Pozo Abierto grupal), registrando su predicción y aportando una apuesta.
- **FR-13: Retención de Puntos en Garantía (Escrow)**
  Se bloquean atómicamente los puntos de la apuesta al crearse el desafío (del creador) y al aceptarse/unirse (de los contrincantes). Si se rechaza, cancela o no se acepta antes del kickoff, los puntos se devuelven.
- **FR-14: Resolución y Reparto del Pozo**
  El sistema resuelve automáticamente el desafío al finalizar el partido. El pozo acumulado se reparte equitativamente entre los participantes con mayor puntuación base en el partido. Si se cancela o pospone el partido, se reembolsa a todos.
- **FR-23: Compartir Desafío de Forma Viral (WhatsApp Banter & Smart Landing)**
  Genera un texto con tono de pique (Banter Text) y OpenGraph previews para compartir en WhatsApp, enviando a una Landing Page optimizada para móviles para aceptar el reto.
- **FR-15: Pronóstico de Premios Especiales**
  El usuario puede pronosticar el Campeón, Máximo Goleador y MVP del Mundial en cualquier momento hasta antes del inicio de las semifinales.
- **FR-16: Sistema de Recompensa Decreciente**
  La recompensa por acertar premios decrece por fases: Antes del partido inaugural (50 pts), durante Fase de Grupos (25 pts), Octavos y Cuartos (10 pts), Semifinales en adelante (0 pts / no se permiten cambios).
- **FR-17: Tabla de Posiciones Proyectada**
  Muestra la clasificación proyectada en vivo combinando puntos consolidados y marcadores del momento de partidos en juego, reordenando dinámicamente y notificando goles.
- **FR-18: Clasificación por Jornada**
  Genera tablas de posiciones independientes por cada jornada de partidos oficial del Mundial.
- **FR-19: Insignias y Medallas Humorísticas Automáticas**
  Asigna insignias especiales al cierre de cada jornada: "Nostradamus" (marcador exacto difícil), "El Salado" (cero puntos en jornada), "El Tibio" (mayoría de empates pronosticados).
- **FR-20: Criterio de Desempate Estructurado**
  Desempata la clasificación jerárquicamente. **Orden canónico (decisión 2026-06-04, post-Epic 3): 1. Cantidad de marcadores exactos (5 pts), 2. Duelos 1v1 directos, 3. Fecha de registro en la liga (`joined_at`).** Esto sigue la AC de la Story 3.1 (lo implementado en `src/utils/standings.ts`) y **supera el orden original de este FR** (que listaba duelos antes que exactos). El criterio de duelos queda inerte (=0) hasta que Epic 5 cree las tablas de duelos.
- **FR-21: Tarjetas de Perfil Psicológico de Juego**
  Genera una tarjeta visual al terminar cada jornada categorizando los hábitos de juego del usuario (Optimista, Conservador, Cazador de Sorpresas), optimizada para compartir en WhatsApp.

### NonFunctional Requirements

- **NFR-1: Coste Cero ($0.00 USD)**
  El proyecto debe funcionar enteramente dentro de los límites gratuitos de Vercel (Hobby) y Supabase (Free Tier).
- **NFR-2: Rendimiento de Base de Datos y WebSockets**
  La reactividad de standings en vivo se calcula en el cliente (JS) al recibir actualizaciones de marcadores en vivo, protegiendo las 200 conexiones WebSockets concurrentes máximas del tier gratuito de Supabase.
- **NFR-3: Seguridad RLS (Row Level Security)**
  Políticas Postgres RLS para impedir que los usuarios lean predicciones de otros jugadores antes de `match_time - 1 minuto`.
- **NFR-4: Integridad Transaccional de Apuestas**
  Las deducciones e ingresos en escrow se ejecutan atómicamente mediante triggers/funciones SQL (`SECURITY DEFINER`) para evitar doble gasto o balances negativos.
- **NFR-5: Límite de API de Fútbol**
  Estrategia Pull-and-Cache en backend ejecutada mediante crons controlados (30 min) solo en ventanas activas de juego, manteniéndose bajo el límite de 100 llamadas diarias.
- **NFR-6: Keep-Alive de Base de Datos**
  Ping automático diario programado para evitar la suspensión por inactividad de Supabase (límite de 1 semana sin uso).

### Additional Requirements

- **Starter Greenfield Template:** Utilización del starter oficial `npx create-next-app@latest -e with-supabase` para integrar SSR de Supabase, cookies, TypeScript y Tailwind CSS de entrada.
- **Servidor como Fuente de Tiempo:** El bloqueo de predicciones (1 minuto antes del kickoff) y la devaluación de premios especiales se validan estrictamente en Supabase comparando con `now()` UTC del servidor.
- **Cascada de Expulsión:** La eliminación de un miembro de la liga gatilla un trigger SQL para cancelar sus retos 1v1 pendientes y retornar el escrow de puntos a sus oponentes de forma limpia.
- **Escrow al Crear:** La apuesta se deduce y se retiene al momento de *crear* el desafío, no al *aceptar*, evitando sobregiros en desafíos paralelos sin aceptar.
- **Robustez de Auth:** Manejo de fallbacks automáticos para avatares y nombres nulos que puedan provenir de Google OAuth en el momento de crear el perfil.
- **Separación de Standings:** La clasificación oficial se calcula y persiste en base de datos al concluir el partido (`finished`), mientras que la reactividad en tiempo real durante el partido ocurre localmente en JS.

### UX Design Requirements

- **UX-DR-1: Mobile-First Max-Width**
  Diseño de columna única optimizado para viewports móviles de entre 320px y 480px con un contenedor general `max-w-md` (`480px`).
- **UX-DR-2: Paleta de Colores Championship Gold**
  Aplicación de tokens definidos: Fondo Indigo Oscuro (`#0D1B2A`), Tarjetas Navy Mate (`#1B263B`), Dorado del Campeonato (`#E9C46A`), Carmesí de Acción/Pendiente (`#E63946`), Verde Turf de Éxito (`#10B981`), Borde Slate (`#415A77`) y Muted Blue-Gray (`#8D99AE`).
- **UX-DR-3: Tipografía Deportiva Premium**
  Uso de las fuentes Outfit (títulos, marcadores y puntajes) e Inter (cuerpo de texto, metadatos y botones).
- **UX-DR-4: Componente GoalPicker Táctil**
  Controles táctiles grandes (48x48px) de más/menos (+/-) que no enfocan el campo ni despliegan el teclado móvil para evitar la fatiga visual.
- **UX-DR-5: Feedback Visual de Guardado Automático**
  Al guardarse el marcador (debounce 500ms), la tarjeta de partido muestra un destello verde turf y aparece una marca de verificación `✓` en el extremo superior.
- **UX-DR-6: Badges de Pago Públicos**
  Indicador visual verde (`Pagado`) o rojo (`Pendiente`) en la clasificación general. Banner superior persistente para deudores con detalles de transferencia (Bizum/Zelle) configurados por el admin.
- **UX-DR-7: Navegación por Pestañas Nivel-2 Desplazables**
  Tab bar con scroll horizontal, sombras de atenuación en extremos y centrado suave del elemento activo mediante `scrollIntoView`.
- **UX-DR-8: Banter Card & Sharing**
  Tarjeta de desafío de doble capa (Wager Card) que muestra apuestas de puntos acumulados, estados del reto y botón de compartir que redirige directamente a WhatsApp con un texto de pique pre-formateado.
- **UX-DR-9: Live Standings Toast & Animations**
  Toast flotante de gol ("¡Gol de Ecuador! Laura sube...") deslizable para descartar y animación de parpadeo con reordenamiento suave de la fila en la tabla proyectada en vivo.
- **UX-DR-10: Pautas de Accesibilidad**
  Tamaño de áreas táctiles mínimo de 48px, relación de contraste mínima de 7:1 en textos legibles y etiquetas descriptivas de accesibilidad (`aria-labels`) para marcadores.

### FR Coverage Map

- FR-1: Epic 1 - Registro Exclusivo con Google OAuth
- FR-3: Epic 1 - Generación de Enlace de Invitación
- FR-4: Epic 1 - Registro y Adhesión Automática
- FR-5: Epic 3 - Indicador de Pago (Presión Social)
- FR-6: Epic 3 - Baja de Miembros (Expulsión)
- FR-7: Epic 2 - Controles Táctiles Incrementales
- FR-8: Epic 2 - Auto-guardado con Debounce e Indicador Visual
- FR-9: Epic 2 - Bloqueo Temporal de Predicciones (Kickoff - 1 min)
- FR-10: Epic 2 - Cálculo del Multiplicador Incremental
- FR-11: Epic 2 - Aplicación del Multiplicador en Puntuación
- FR-12: Epic 5 - Creación de Desafíos (Directos 1v1 y Abiertos)
- FR-13: Epic 5 - Retención de Puntos en Garantía (Escrow)
- FR-14: Epic 5 - Resolución y Reparto del Pozo
- FR-15: Epic 6 - Pronóstico de Premios Especiales (Campeón, Goleador, MVP)
- FR-16: Epic 6 - Sistema de Recompensa Decreciente
- FR-17: Epic 4 - Tabla de Posiciones Proyectada en Vivo (WebSockets) & Epic 8 - Sincronización Zafronix API
- FR-18: Epic 3 - Clasificación por Jornada
- FR-19: Epic 3 - Insignias y Medallas Humorísticas Automáticas
- FR-20: Epic 3 - Criterio de Desempate Estructurado
- FR-21: Epic 3 - Tarjetas de Perfil Psicológico de Juego
- FR-22: Epic 2 - Gestión de Partidos Suspendidos o Cancelados
- FR-23: Epic 5 - Compartir Desafío de Forma Viral (WhatsApp Banter)
- FR-24: Epic 1 - Formulario de Creación y Configuración de Liga

## Epic List

### Epic 1: Inicialización del Proyecto, Configuración de Testing y Autenticación Express
El desarrollador cuenta con el boilerplate del proyecto con Playwright configurado. El usuario puede crear una cuenta e iniciar sesión instantáneamente con Google OAuth, y unirse de manera transparente a una liga privada mediante un enlace de invitación `/join/LIGA123` visualizando las instrucciones de cobro.
**FRs covered:** FR-1, FR-3, FR-4, FR-24

### Epic 2: Tablero de Predicciones Táctil con Auto-guardado y Multiplicadores
El usuario puede ingresar y modificar sus pronósticos mediante la interfaz táctil (+/-) con auto-guardado debounced (500ms). El sistema calcula y aplica el multiplicador de antelación y congela la predicción 1 minuto antes del kickoff.
**FRs covered:** FR-7, FR-8, FR-9, FR-10, FR-11, FR-22

### Epic 3: Clasificación General, Jornadas y Administración de Liga
Los jugadores compiten viendo la clasificación general e independiente por jornada con sus insignias humorísticas y perfiles de juego. El administrador puede marcar quién ha pagado (presión social) y expulsar miembros.
**FRs covered:** FR-5, FR-6, FR-18, FR-19, FR-20, FR-21

### Epic 4: Tabla Proyectada en Vivo en Tiempo Real (WebSocket Leaderboard)
Los usuarios ven la tabla de clasificación proyectándose y reordenándose en vivo por WebSockets conforme ocurren los goles en los partidos en juego, recibiendo alertas en tiempo real ("Impacto de Gol").
**FRs covered:** FR-17

### Epic 5: Módulo de Duelos (1v1 y Abiertos) con Puntos en Escrow
Los jugadores pueden retarse apostando puntos de clasificación. Los puntos se retienen en garantía (escrow). Los retos se pueden compartir en WhatsApp con mensajes personalizados de pique y se resuelven atómicamente en el servidor.
**FRs covered:** FR-12, FR-13, FR-14, FR-23

### Epic 6: Premios Especiales de la Copa (Largo Plazo)
Los usuarios pueden pronosticar el Campeón, Goleador y MVP del torneo, ganando puntos decrecientes basados en qué tan temprano lo hicieron (bloqueándose antes de semifinales).
**FRs covered:** FR-15, FR-16

### Epic 7: Datos del Torneo — Seed, Captura de Resultados (Admin) y Avance de Fase
El calendario del Mundial 2026 se siembra desde datos reales (`supabase/seed-data/worldcup-2026/`), el administrador captura/edita resultados, y un motor automático calcula la clasificación de grupos y el avance de eliminatorias con las reglas FIFA del formato 2026. **Foundational: se ejecuta antes de Epics 5 y 6** (Epic 6 depende de los límites de fase que produce este motor).
**Reescopa:** NFR-5 (mapeo de partidos); soporte de datos para FR-7…FR-11, FR-15…FR-17. Surgió del correct-course del 2026-06-04 (ver `sprint-change-proposal-2026-06-04.md`).

### Epic 8: Sincronización Automática con Zafronix World Cup API
Automatiza la sincronización en tiempo real de marcadores, estados y cruces del Mundial 2026 mediante la integración con la API deportiva de Zafronix (webhooks HMAC y cron de respaldo condicional con ETags) a coste cero.
**FRs covered:** FR-17 (integración API), NFR-1, NFR-5).
**Reescopa:** NFR-5 (mapeo de partidos); soporte de datos para FR-7…FR-11, FR-15…FR-17. Surgió del correct-course del 2026-06-04 (ver `sprint-change-proposal-2026-06-04.md`).

## Epic 1: Inicialización del Proyecto, Configuración de Testing y Autenticación Express

El desarrollador cuenta con el boilerplate del proyecto con Playwright configurado. El usuario puede crear una cuenta e iniciar sesión instantáneamente con Google OAuth, y unirse de manera transparente a una liga privada mediante un enlace de invitación `/join/LIGA123` visualizando las instrucciones de cobro.

### Story 1.1: Inicialización del Boilerplate y Configuración del Entorno de Testing (Playwright & Vitest)

As a desarrollador,
I want inicializar el proyecto usando la plantilla de Next.js + Supabase y configurar Playwright y Vitest (con soporte para integración de base de datos local),
So that disponer de un entorno de desarrollo limpio y frameworks para validar lógica, UI, asincronía y seguridad (RLS/Triggers).

**Acceptance Criteria:**

**Given** el directorio del proyecto está listo para inicializar
**When** ejecuto el comando de inicialización `npx -y create-next-app@latest ./ -e with-supabase` y configuro TypeScript estricto
**Then** la estructura del proyecto se genera correctamente incluyendo `/src/app`, `/supabase/migrations` y `/utils/supabase`
**And** Playwright queda instalado con un smoke test base (`tests/e2e/sanity.spec.ts`) para verificar la carga inicial de la UI
**And** Vitest queda configurado en el proyecto para soportar tanto pruebas unitarias como de integración de base de datos (`vitest.config.ts`)
**And** se crea el andamiaje inicial para pruebas de integración de base de datos (`tests/integration/setup.ts`), permitiendo instanciar clientes de Supabase con diferentes roles (service_role, anon, JWT) y ejecutar un test de integración inicial ("smoke test") contra el Supabase local
**And** se definen scripts unificados en `package.json` para ejecutar `test:unit`, `test:integration`, `test:e2e` y `test:ci` (este último corre todos en secuencia en la pipeline de CI de GitHub Actions)

### Story 1.2: Esquema Relacional de Base de Datos y Autenticación Google OAuth

As a desarrollador,
I want definir las tablas de perfiles, ligas y miembros en PostgreSQL junto con la autenticación basada en cookies con Google OAuth,
So that permitir que los usuarios tengan identidades únicas y persistencia segura desde su primer inicio de sesión.

**Acceptance Criteria:**

**Given** la base de datos de Supabase local
**When** ejecuto las migraciones para crear las tablas `profiles`, `leagues` y `league_members`
**Then** se habilitan políticas de Row Level Security (RLS) que impiden a usuarios no autenticados escribir en la base de datos
**And** al autenticarse un usuario mediante Google OAuth, un trigger SQL en la tabla `auth.users` inserta automáticamente su información en `public.profiles`
**And** si la API de Google retorna campos nulos para nombre o avatar, la base de datos aplica valores por defecto ("Jugador Anónimo" y avatar deportivo genérico)

### Story 1.3: Formulario de Creación y Configuración de Liga (Admin)

As a administrador de una quiniela,
I want configurar una liga privada mediante un formulario mobile-first especificando si requiere pago de inscripción, instrucciones de cobro y modo de predicción,
So that establecer las reglas logísticas de mi grupo.

**Acceptance Criteria:**

**Given** un administrador autenticado en la app móvil (`max-w-md`)
**When** ingresa al panel de creación de liga
**Then** el formulario le permite seleccionar el "Modo de Predicción" (guardado dentro de la columna `rules` JSONB de `leagues`) y, si activa la opción "Requiere Pago", le obliga a ingresar el monto de inscripción e instrucciones (Bizum/Zelle/efectivo)
**And** al guardar el formulario, una Server Action estructurada bajo la firma `ServerActionResult` inserta el registro en la tabla `leagues` y asocia al creador como miembro administrador en `league_members`
**And** todos los botones del formulario tienen un tamaño mínimo de `48x48px` y usan la tipografía e HSL tokens del sistema de diseño **Championship Gold**

### Story 1.4: Enlaces de Invitación Inteligentes y Registro Express (Smart Deep-Linking)

As a usuario invitado,
I want abrir un enlace de invitación a una liga, ver sus detalles y registrarme con un solo toque,
So that unirme al torneo sin fricciones ni pasos redundantes.

**Acceptance Criteria:**

**Given** un usuario que recibe y abre un enlace corto del tipo `/join/[invite_code]`
**When** la landing page se renderiza
**Then** muestra los metadatos de la liga (nombre del creador, título de la liga y detalles de pago si aplica) formateados con fondo Indigo (`#0D1B2A`) y tipografía Outfit
**And** el usuario es redirigido directamente a la pantalla de pronósticos de la liga con un mensaje de éxito

## Epic 2: Tablero de Predicciones Táctil con Auto-guardado y Multiplicadores

El usuario puede ingresar y modificar sus pronósticos mediante la interfaz táctil (+/-) con auto-guardado debounced (500ms). El sistema calcula y aplica el multiplicador de antelación y congela la predicción 1 minuto antes del kickoff.

### Story 2.1: Modelos de Partidos, Predicciones y Motor de Puntuación (Scoring)

As a desarrollador,
I want estructurar las tablas de partidos y predicciones en Supabase junto con la lógica de puntuación base en código,
So that poder guardar pronósticos y evaluar los aciertos del torneo.

**Acceptance Criteria:**

**Given** las tablas `matches` y `predictions` creadas en Postgres
**When** un usuario que no es dueño intenta consultar la predicción de otro miembro para un partido activo
**Then** la política RLS bloquea la lectura a menos que la hora UTC del servidor sea `>= match_time - 1 minuto`
**And** la lógica de negocio en `src/utils/scoring.ts` calcula correctamente la puntuación base: marcador exacto = 5 pts; resultado (ganador/empate) acertado = 2 pts; sin aciertos = 0 pts
**And** si un partido es marcado con estado "canceled" o "suspended" en la base de datos, el motor de puntuación asigna automáticamente `0.00` puntos a todas las predicciones asociadas al encuentro y lo excluye de la sumatoria de las clasificaciones oficiales y proyectadas en vivo
**And** se implementan pruebas de integración en `tests/integration/rls-policies.test.ts` para validar rigurosamente este comportamiento de bloqueo de RLS ante consultas de usuarios distintos y anónimos

### Story 2.2: Componente GoalPicker Táctil (Mobile Viewport)

As a jugador,
I want ingresar marcadores usando botones grandes de más y menos en lugar de teclear números,
So that llenar la quiniela de manera veloz y sin esfuerzo.

**Acceptance Criteria:**

**Given** la tarjeta de partido en la pantalla móvil (`max-w-md`)
**When** presiono los botones `+` o `-` del marcador local o visitante
**Then** el valor de los goles aumenta o disminuye de 1 en 1 con un mínimo de 0
**And** los botones tienen un área de tap de al menos `48x48px` y desactivan las pseudo-clases de focus para evitar que aparezca el teclado táctil de Android/iOS

### Story 2.3: Auto-guardado Debounced con Feedback y Manejo de Conexión Offline

As a jugador,
I want que mis predicciones se guarden solas en segundo plano mientras las modifico y recibir confirmación visual instantánea, inclusive si mi red falla,
So that no temer a la pérdida de datos o tener que presionar botones de "Guardar".

**Acceptance Criteria:**

**Given** una edición en el marcador
**When** pasan 500 milisegundos sin clics adicionales
**Then** se dispara la Server Action `predictions.actions.ts` para persistir los goles
**And** tras completarse con éxito, la tarjeta muestra un destello verde turf (`#10B981`) y renderiza un checkmark `✓` de guardado exitoso
**And** si no hay red, la tarjeta muestra un borde rojo destructivo (`#E63946`), visualiza "Sin conexión - Pendiente", almacena la predicción en el estado local de React y reintenta de forma automática al detectar de nuevo la red

### Story 2.4: Multiplicador Táctico por Antelación y Bloqueo de Kickoff

As a jugador de la quiniela,
I want que el sistema premie mis predicciones tempranas con multiplicadores y me avise antes de degradar mi multiplicador al editar,
So that jugar de manera estratégica en base a la antelación.

**Acceptance Criteria:**

**Given** un usuario que realiza o edita una predicción
**When** el sistema detecta la marca de tiempo de la actualización
**Then** calcula y almacena en Supabase el multiplicador correcto según la fecha del Kickoff (2.0x a 1.0x)
**And** si el usuario intenta modificar un marcador ya guardado con un multiplicador de antelación alto, se despliega una advertencia interactiva en pantalla informando que cambiar el marcador bajará su multiplicador
**And** cuando falte 1 minuto para el inicio del partido, la UI bloquea los botones de edición (`+`/`-`) y muestra un candado cerrado 🔒

## Epic 3: Clasificación General, Jornadas y Administración de Liga

Los jugadores compiten viendo la clasificación general e independiente por jornada con sus insignias humorísticas y perfiles de juego. El administrador puede marcar quién ha pagado (presión social) y expulsar miembros.

### Story 3.1: Tabla de Posiciones Clásica (Acumulada) y Filtro por Jornada

As a jugador de la liga,
I want visualizar la tabla de posiciones oficial ordenada por puntos totales y filtrada por jornadas individuales,
So that conocer mi rendimiento acumulado y por etapa del torneo.

**Acceptance Criteria:**

**Given** un usuario visualizando la pestaña de Posiciones
**When** carga la página de clasificación
**Then** renderiza una tabla mobile-first (`max-w-md`) con avatares y nombres, ordenada por puntos de mayor a menor
**And** al interactuar con el control de pestañas superior (Tab Bar con scroll horizontal y fades laterales), cambia la vista de la tabla mostrando los puntos e insignias obtenidos exclusivamente en la jornada seleccionada
**And** si el usuario tiene estado "Pendiente de Pago" y la liga lo requiere, muestra un banner superior persistente con las instrucciones de cobro cargadas por el admin
**And** si dos o más miembros tienen la misma puntuación, la clasificación se desempata y ordena jerárquicamente por: (1) cantidad de marcadores exactos (aciertos de 5 puntos base), (2) puntos en duelos directos 1v1 entre ellos, y (3) fecha y hora de registro en la liga (`joined_at`)

### Story 3.2: Insignias Humorísticas y Perfiles Psicológicos de Juego

As a jugador de la liga,
I want que el sistema me otorgue insignias humorísticas y defina mi perfil psicológico de juego al cierre de cada jornada,
So that presumir o bromear con mis amigos en redes sociales.

**Acceptance Criteria:**

**Given** una jornada cerrada y evaluada, y habiendo creado la tabla `member_badges` para registrar el historial de medallas
**When** el usuario entra a su perfil "Mi Cuenta"
**Then** visualiza las medallas obtenidas ("Nostradamus" por aciertos improbables, "El Salado" por racha de ceros, "El Tibio" por exceso de empates) leídas desde `member_badges` y su perfil de juego asignado (Optimista, Conservador, Cazador de Sorpresas)
**And** al presionar "Compartir Perfil", genera una tarjeta visual optimizada y abre la hoja de compartir o WhatsApp con un texto de pique pre-redactado

### Story 3.3: Panel Rápido de Administración y Control de Pagos

As a administrador de la liga,
I want poder marcar a los miembros como pagados o pendientes de pago y expulsar de forma definitiva a miembros inactivos,
So that gestionar la administración logística del torneo de manera transparente.

**Acceptance Criteria:**

**Given** un administrador autenticado en la pestaña de Posiciones
**When** hace clic en el engranaje de configuración y accede al listado de miembros
**Then** puede presionar la etiqueta de pago de un miembro para alternar su estado entre "Pagado" (badge verde `#10B981`) y "Pendiente" (badge rojo `#E63946`)
**And** al presionar "Expulsar Miembro", el sistema remueve al usuario de la clasificación y un trigger SQL elimina sus predicciones locales y cancela en cascada sus retos 1v1 activos devolviendo los puntos de escrow a sus rivales

## Epic 4: Tabla Proyectada en Vivo en Tiempo Real (WebSocket Leaderboard)

Los usuarios ven la tabla de clasificación proyectándose y reordenándose en vivo por WebSockets conforme ocurren los goles en los partidos en juego, recibiendo alertas en tiempo real ("Impacto de Gol").

### Story 4.1: Conexión WebSocket y Tabla Proyectada en Vivo (JS Client Side)

As a espectador del Mundial,
I want ver cómo se reordena la tabla de posiciones en vivo según los marcadores en tiempo real de los partidos en desarrollo,
So that usar la app como pantalla complementaria de la transmisión de TV.

**Acceptance Criteria:**

**Given** un usuario autenticado en la pestaña "Tabla en Vivo"
**When** se dispara un evento de cambio de marcador en juego vía Supabase WebSockets
**Then** el cliente JS en el navegador intercepta el marcador momentáneo y recalcula en memoria los puntos virtuales proyectados de todos los jugadores de la liga
**And** la tabla de posiciones se reordena automáticamente de forma suave en pantalla sin realizar recargas de página
**And** si el WebSocket se desconecta, la UI muestra un indicador amarillo de "Reconectando..." y degrada automáticamente a realizar HTTP polling cada 60 segundos

### Story 4.2: Notificaciones "Impacto de Gol" (Live Toast)

As a espectador del Mundial,
I want recibir alertas emergentes en pantalla que indiquen quién sube o baja de puesto ante un gol real,
So that sentir la adrenalina de los cambios de posiciones de forma inmediata.

**Acceptance Criteria:**

**Given** un cambio en la clasificación proyectada por un gol
**When** un jugador sube de puesto en vivo
**Then** se despliega una notificación flotante (Toast) en la parte superior: "¡Gol de [Equipo]! [Jugador] sube al [Puesto]º proyectado 🎉"
**And** la fila correspondiente en la tabla parpadea momentáneamente en dorado (`#E9C46A`) y realiza una transición de desplazamiento suave
**And** el usuario puede deslizar lateralmente (swipe) la notificación flotante para descartarla

## Epic 5: Módulo de Duelos (1v1 y Abiertos) con Puntos en Escrow

Los jugadores pueden retarse apostando puntos de clasificación. Los puntos se retienen en garantía (escrow). Los retos se pueden compartir en WhatsApp con mensajes personalizados de pique y se resuelven atómicamente en el servidor.

### Story 5.1: Creación de Duelo 1v1 Directo y Abierto con Deducción de Escrow

As a jugador de la liga,
I want crear un duelo directo 1v1 contra un amigo o un pozo abierto para todo el grupo apostando mis puntos acumulados,
So that retar sus conocimientos de fútbol bajo riesgo real de perder mis puntos.

**Acceptance Criteria:**

**Given** un jugador con balance de puntos acumulados suficiente y habiéndose creado las tablas `challenges`, `challenge_participants` y `point_transactions`
**When** crea un desafío en la pestaña "Duelos", selecciona un partido, ingresa su predicción y define la apuesta de puntos
**Then** una Server Action con transacción ACID en Postgres deduce los puntos del saldo disponible y los bloquea en un estado de escrow ("puntos retenidos") al momento de crear el reto, registrando la transacción en `point_transactions`
**And** si el saldo disponible es menor que la apuesta, el botón de envío se inhabilita y muestra un mensaje de advertencia en rojo: "Saldo insuficiente"
**And** debe incluir pruebas de integración (`Vitest DB-Integration`) bajo `tests/integration/triggers.test.ts` que validen que la deducción de escrow ocurre de manera atómica y no permite sobregiros ni balances negativos.

### Story 5.2: Aceptación, Rechazo y Devolución de Garantía (Escrow)

As a jugador retado,
I want aceptar o rechazar un desafío directo, o unirme a un pozo abierto, asegurando que mis puntos apostados se congelen y liberen si el reto se cancela,
So that mantener la integridad de mi balance de puntos en juego.

**Acceptance Criteria:**

**Given** un duelo directo 1v1 recibido por un oponente
**When** el oponente presiona "Aceptar Duelo" e ingresa su marcador
**Then** el sistema descuenta de forma atómica sus puntos y los deposita en el pozo en escrow del reto, marcando el duelo como activo
**And** si el oponente rechaza el duelo, o si el partido inicia sin ser aceptado, el sistema reembolsa en su totalidad los puntos retenidos del creador devolviéndolos a su saldo disponible
**And** se deben incluir pruebas de integración en `tests/integration/triggers.test.ts` que validen la devolución correcta y atómica de los puntos retenidos al creador en caso de rechazo, cancelación o expiración antes del kickoff.

### Story 5.3: Resolución y Reparto Automatizado del Pozo de Puntos

As a jugador participante en apuestas,
I want que los desafíos se resuelvan y los pozos de puntos se repartan automáticamente al finalizar el partido,
So that recibir mis ganancias de forma inmediata e indiscutible.

**Acceptance Criteria:**

**Given** un partido de la quiniela finalizado con estado oficial "finished"
**When** el cron del sincronizador procesa el resultado real del partido
**Then** evalúa los puntajes obtenidos por las predicciones de los participantes del reto y distribuye el pozo total del escrow de forma equitativa entre los ganadores con mejor predicción
**And** si hay empate absoluto, divide el pozo equitativamente entre los empatados
**And** si el partido se cancela o suspende oficialmente, se cancelan los duelos y se reembolsan los puntos en garantía a todos los participantes
**And** se deben incluir pruebas de integración en `tests/integration/triggers.test.ts` que validen el reparto de saldos del pozo y los reembolsos por cancelación.

### Story 5.4: Compartir de Forma Viral por WhatsApp y Landing Page (Banter Preview)

As a jugador retador,
I want compartir mi desafío en chats de WhatsApp con textos de pique visuales e interactivos,
So that motivar a mis rivales a aceptar el duelo instantáneamente.

**Acceptance Criteria:**

**Given** un reto de duelo creado
**When** presiono "Compartir en WhatsApp"
**Then** se abre la aplicación de mensajería con un mensaje de pique pre-formateado (Banter Text) que incluye el enlace inteligente `/desafio/[challenge_id]`
**And** el enlace contiene etiquetas OpenGraph configuradas para renderizar una tarjeta visual rica con banderas de los equipos, avatares de los jugadores y el pozo acumulado
**And** al abrir el enlace, el rival ve una Landing Page responsiva que permite "Aceptar Reto" guiando de manera fluida el flujo de login por Google OAuth en segundo plano

## Epic 6: Premios Especiales de la Copa (Largo Plazo)

Los usuarios pueden pronosticar el Campeón, Goleador y MVP del torneo, ganando puntos decrecientes basados en qué tan temprano lo hicieron (bloqueándose antes de semifinales).

### Story 6.1: Predicciones de Premios Especiales de la Copa (Campeón, Goleador, MVP)

As a jugador de la quiniela,
I want registrar mis predicciones de largo plazo para los galardones principales del Mundial mediante selectores de favoritos simplificados,
So that aspirar a obtener puntos masivos al final del torneo de forma ágil desde el móvil.

**Acceptance Criteria:**

**Given** el usuario en la sección de Premios Especiales y habiéndose creado las tablas `award_candidates` y `special_predictions`
**When** decide realizar su pronóstico para Campeón, Goleador o MVP
**Then** visualiza un listado ordenado de favoritos (leídos de la tabla `award_candidates`) para seleccionar el candidato con un solo tap
**And** al guardar, crea o actualiza un registro en `special_predictions` asociando la predicción a su perfil de usuario con una marca de tiempo inalterable

### Story 6.2: Sistema de Puntuación Decreciente y Cierre por Semifinales

As a jugador estratégico,
I want que mis aciertos de premios especiales otorguen más puntos mientras más temprano en el torneo los haya registrado, bloqueándose cuando el riesgo sea nulo,
So that premiar mi visión y audacia estratégica.

**Acceptance Criteria:**

**Given** una predicción de premios especiales guardada
**When** finaliza el torneo y se registran los ganadores oficiales en Supabase
**Then** el sistema asigna puntos según la fase de registro: Fase A (antes del partido inaugural) = 50 pts; Fase B (Fase de grupos) = 25 pts; Fase C (Octavos y Cuartos) = 10 pts
**And** si el usuario intenta modificar o registrar predicciones a partir del inicio de la primera Semifinal (Fase D), el sistema bloquea los controles de edición y retorna 0 puntos

## Epic 7: Datos del Torneo — Seed, Captura de Resultados (Admin) y Avance de Fase

Reemplaza la sincronización automática con API-Football (inviable en plan Free para `season=2026`). El calendario del Mundial 2026 se siembra desde datos reales (`supabase/seed-data/worldcup-2026/`: `worldcup.json` = 104 partidos, `worldcup.teams.json` = 48 equipos con `fifa_code`/`group`/bandera). El administrador captura/edita resultados, y un motor automático calcula la clasificación de grupos y el avance de eliminatorias con las reglas FIFA del formato 2026. **Foundational: antes de Epics 5 y 6.**

### Story 7.1: Seed del Calendario y Modelo de Fases (Grupos + Bracket)

As a sistema de la quiniela,
I want tener sembrado el calendario del Mundial 2026 (72 partidos de grupos en 12 grupos A–L) y la estructura de 32 partidos de eliminatoria como placeholders,
So that la app funcione con datos reales del torneo sin depender de una API externa de pago.

**Acceptance Criteria:**

**Given** los datos en `supabase/seed-data/worldcup-2026/` y una migración nueva
**When** se aplica la migración/seed
**Then** `public.matches` gana columnas `group_label text`, `bracket_slot int`, `home_source text`, `away_source text` y `venue text`, preservando columnas/constraints existentes (`home_team`/`away_team` siguen `not null`, `status` CHECK intacto, `external_ref` unique)
**And** un seed idempotente generado desde JSON inserta los 72 partidos de grupos con `home_team`/`away_team` = `name_normalised ?? name`, `*_team_code` = `teams.fifa_code`, `match_time` UTC, `matchday` = ronda de grupo 1/2/3 derivada, `stage='group'`, `group_label` A–L y `venue`
**And** se siembran los 32 partidos de eliminatoria (R32→Final + 3.º lugar) como placeholders TBD, con `stage ∈ {round-32, round-16, quarter, semi, third-place, final}`, `bracket_slot` = `num`, `home_source`/`away_source` = códigos del JSON (`1A`/`2B`/`3A/B/C/D/F`/`W##`/`L##`) y equipos legibles `"Por definir"`
**And** `external_ref` se reutiliza como clave estable del seed (`wc2026:grp:*`, `wc2026:ko:*`) con `insert ... on conflict (external_ref) do update`
**And** los partidos knockout TBD no quedan habilitados para predicción de marcador hasta que Story 7.3 resuelva equipos reales; 7.1 no modifica UI ni reglas de predicción
**And** el seed convive con la RLS actual (`matches_select_authenticated`); la escritura se hace por migración, no por cliente
**And** pruebas de integración validan conteos (104 total, 72 grupos, 32 knockout), rondas, grupos/jornadas, apariciones de equipos, `bracket_slot`/sources, idempotencia y UTC del inaugural

### Story 7.2: Captura y Edición de Resultados por el Administrador

As a administrador de la liga,
I want capturar y editar el marcador y estado de cada partido (`scheduled→live→finished`) desde el panel de administración,
So that la clasificación, la tabla en vivo y el scoring se actualicen con resultados reales sin una API externa.

**Acceptance Criteria:**

**Given** un admin autenticado en `/standings/manage`
**When** abre la gestión de partidos
**Then** ve los partidos (al menos los de la jornada/fase activa) y puede fijar `home_score`, `away_score` y `status` mediante un RPC `SECURITY DEFINER` admin-gated (patrón Story 3.3) que valida rol admin, marcadores >=0 y transiciones de `status` válidas; sin escritura directa a `matches` por cliente
**And** al pasar un partido a `live`/`finished` con marcador, la tabla en vivo (Epic 4) reacciona vía Realtime (reordenamiento + toast "Impacto de Gol") sin trabajo adicional
**And** al marcar `finished`, la clasificación oficial (`buildStandings`) incorpora el partido (consolidación on-the-fly)
**And** la UI es mobile-first con tokens Championship Gold, tap targets >=48px, y maneja error/permiso (no-admin bloqueado)
**And** existen pruebas del RPC (admin sí / no-admin no / validaciones) e integración con el flujo de standings

### Story 7.3: Sincronización e Integración de Clasificaciones y Bracket desde Zafronix API

As a sistema de la quiniela,
I want integrar la resolución de las clasificaciones y cruces eliminatorios desde los endpoints de standings y bracket de la API de Zafronix,
So that los nombres de los equipos y avances de fase en los partidos eliminatorios se actualicen en base de datos sin necesidad de calcular localmente la lógica de desempates de la FIFA.

**Acceptance Criteria:**

**Given** partidos de la fase de grupos marcados como `finished`
**When** el sincronizador (cron o webhook) detecta actualizaciones y consulta los endpoints `GET /standings?year=2026` y `GET /bracket?year=2026` de la API de Zafronix
**Then** el sistema extrae las posiciones finales de los grupos y el ranking de mejores terceros computados por la API
**And** actualiza automáticamente las columnas `home_team` y `away_team` en la tabla `public.matches` resolviendo los códigos de slot (ej. `1A`, `2B`, `3ABCDF`, `W73`) con los países correspondientes provistos por el endpoint del bracket
**And** el proceso de resolución es idempotente y se ejecuta de forma segura e incremental sin corromper registros de partidos existentes ni predicciones de usuarios
**And** el script expone y calcula los límites de fase del torneo (inicio de la ronda de Octavos, de Semis) a partir de los datos sincronizados para consumo del motor de puntuación decreciente de la Epic 6
**And** se implementan pruebas de integración en `tests/integration/bracket-resolution.test.ts` que validen la correcta resolución de los cruces de fase de eliminación directa usando fixtures mockeados de la API

## Epic 8: Sincronización Automática con Zafronix World Cup API

Automatiza la sincronización en tiempo real de marcadores, estados y cruces del Mundial 2026 mediante la integración con la API deportiva de Zafronix (webhooks HMAC y cron de respaldo condicional con ETags) a coste cero.

### Story 8.1: Endpoint de Webhook para Sincronización de Partidos en Tiempo Real (Zafronix API)

As a sistema de la quiniela,
I want exponer un endpoint seguro de webhook HTTP POST en `/api/webhooks/zafronix`,
So que el sistema reciba y procese notificaciones en tiempo real sobre la finalización y estados de los partidos del Mundial.

**Acceptance Criteria:**

**Given** una solicitud HTTP POST entrante en el endpoint `/api/webhooks/zafronix`
**When** se valida la firma HMAC-SHA256 en la cabecera `X-Zafronix-Signature-256` con el timestamp `X-Zafronix-Timestamp` usando la clave secreta `ZAFRONIX_WEBHOOK_SECRET`
**Then** el sistema calcula la firma localmente sobre la cadena `${timestamp}.${rawBody}` y verifica que coincida exactamente con la cabecera provista
**And** el sistema rechaza solicitudes cuya diferencia de marca de tiempo (`X-Zafronix-Timestamp` vs reloj local del servidor) supere los 5 minutos (replay attack prevention) retornando un estado `401 Unauthorized` o `400 Bad Request` en formato JSON `{ error: string, message: string }`
**And** si la firma es válida, procesa los eventos `match.finalized`, `match.patched` y `match.postponed`
**And** para eventos `match.finalized` y `match.patched`, actualiza en la tabla `public.matches` las columnas `home_score`, `away_score` y `status` (`'finished'`) correspondientes, buscando por la clave `external_ref`
**And** si el partido actualizado pertenece a una fase eliminatoria y contiene la resolución de equipos, actualiza `home_team` y `away_team` en la tabla `public.matches`
**And** para eventos `match.postponed`, actualiza el `status` a `'suspended'` o `'canceled'` y gatilla la anulación automática de predicciones (0 pts) y duelos asociados (retornando el escrow) de forma transaccional
**And** se implementan pruebas unitarias y de integración de firma HMAC en `tests/integration/zafronix-webhook.test.ts` con payloads y firmas simuladas correctas e incorrectas.

### Story 8.2: Sincronización Periódica de Respaldo con ETags (GitHub Actions Cron Job)

As a sistema de la quiniela,
I want configurar un cron job periódico que realice peticiones HTTP condicionales utilizando cabeceras `If-None-Match` con ETags a la API de Zafronix,
So que los marcadores de respaldo se sincronicen sin consumir la cuota de llamadas diarias del plan gratuito.

**Acceptance Criteria:**

**Given** un workflow programado de GitHub Actions (`.github/workflows/sync-matches.yml`) ejecutándose cada 30 minutos durante el periodo de partidos
**When** el script de sincronización realiza una solicitud HTTP GET a `https://api.zafronix.com/fifa/worldcup/v1/matches?year=2026`
**Then** incluye en la cabecera `If-None-Match` el último `ETag` (hash) guardado en la base de datos (por ejemplo, en la tabla de configuración del sistema `public.system_config`)
**And** si el servidor de Zafronix responde con `304 Not Modified`, el script finaliza sin consumir cuota de llamadas ni realizar escrituras en la base de datos
**And** si el servidor responde con `200 OK`, el script lee el body, actualiza los marcadores, equipos y estados en la tabla `public.matches` (mediante upsert buscando por `external_ref`), y almacena el nuevo `ETag` retornado en la base de datos para la siguiente llamada
**And** se implementan pruebas unitarias y de integración que utilicen mocks para simular las respuestas `200 OK` (con actualización de datos y ETag) y `304 Not Modified` (comprobando que no hay cambios ni consumo), validando el comportamiento esperado
**And** la llamada se realiza de manera segura inyectando el token `WC_API_KEY` desde los secretos de GitHub Actions en la cabecera `X-API-Key`

### Story 8.3: Script Administrativo de Sincronización y Restauración Completa

As a administrador de la quiniela,
I want contar con un script ejecutable de restauración y sincronización completa desde la consola que cargue todos los datos vigentes de la API de Zafronix,
So que el calendario y resultados del Mundial se puedan resembrar, validar o corregir de golpe si es necesario.

**Acceptance Criteria:**

**Given** un script administrativo de Node/TypeScript en `scripts/restore-zafronix-data.ts`
**When** el administrador ejecuta el script con las credenciales apropiadas (usando la variable `SUPABASE_SERVICE_ROLE_KEY` o mediante una función RPC admin-gated)
**Then** realiza una solicitud GET directa a la API de Zafronix sin cabeceras condicionales para traer el listado completo de partidos del Mundial 2026
**And** procesa e inserta o actualiza todos los registros de partidos en `public.matches` asociándolos por `external_ref`, respetando las relaciones y claves foráneas existentes
**And** si hay diferencias con los marcadores locales, actualiza los datos y recalcula las clasificaciones oficiales correspondientes
**And** el script incluye logs informativos detallados (ej. "Partidos actualizados: X, Partidos creados: Y, Errores: Z")
**And** se verifica mediante pruebas de integración que la ejecución del script sobre una base de datos limpia o parcialmente poblada restaura el estado exacto de la Copa del Mundo reportada por la API de Zafronix sin duplicar registros ni corromper las predicciones de los usuarios

### Story 8.4: Entorno de Pruebas Integradas con el Sandbox de Zafronix (Año 9999)

As a desarrollador del proyecto,
I want configurar un entorno de pruebas de integración automatizadas que interactúe con el Sandbox de Zafronix del año 9999,
So que el ciclo de vida completo de un partido se pueda probar de manera fiel y controlada.

**Acceptance Criteria:**

**Given** la suite de pruebas automatizadas E2E de Playwright y de integración de Vitest
**When** se ejecutan las pruebas del flujo de sincronización y webhooks
**Then** las solicitudes de escritura de resultados se dirigen a los partidos del año 9999 de Zafronix usando un token de sandbox `ZAFRONIX_SANDBOX_KEY` (`zwc_skt_...`)
**And** la suite de pruebas realiza una llamada a `POST /sandbox/reset` antes de comenzar para garantizar un estado consistente de los fixtures ficticios
**And** se verifica que al simular un resultado deportivo en el sandbox de Zafronix, el webhook local recibe la firma HMAC válida, actualiza la base de datos local y propaga el cambio en tiempo real (Supabase Realtime) permitiendo verificar la tabla de clasificaciones proyectada en el cliente
**And** no se ejecutan operaciones de escritura sobre partidos reales del año 2026 durante las pruebas

### Story 8.5: Test de Contrato del Webhook de Zafronix (pin del payload + recipe de firma desde docs)

As a desarrollador del proyecto,
I want fijar (pin) el contrato del webhook entrante de Zafronix con tests deterministas basados en los samples y el esquema de firma publicados en la documentación oficial,
So que la mitad de ENTRADA (que un webhook real firmado por Zafronix pase nuestro handler) deje de ser un supuesto y quede protegida contra regresiones nuestras, con un runbook claro ante cambios de contrato.

**Contexto:** Follow-up de la Story 8.4. El enfoque híbrido de 8.4 validó la mitad de SALIDA (escritura real al sandbox año 9999) y el pipeline interno (handler → DB → Realtime), pero re-firma el evento localmente, así que la firma y el payload REALES de Zafronix siguen siendo supuestos derivados de la doc. Verificado en https://api.zafronix.com/docs (2026-06-06): el registro de subscribers NO está disponible ("subscriber-side endpoints land in a follow-up release") → capturar una entrega real está BLOQUEADO; PERO los docs publican samples de payload (`match.finalized`/`.patched`/`.postponed`) y el esquema de firma completo. Esta historia cubre solo lo determinista y offline ("B-ahora"); la validación contra una entrega real firmada ("B-después") queda diferida y documentada como placeholder gated hasta que Zafronix habilite el registro.

**Acceptance Criteria:**

**Given** los samples de evento y el esquema de firma publicados en la documentación oficial de Zafronix
**When** se ejecuta la suite de tests de contrato (offline, sin red, sin clave de sandbox, sin base de datos)
**Then** cada sample documentado (`match.finalized`, `match.patched`, `match.postponed`) se valida contra los esquemas Zod del handler (`baseEventSchema` + el payload schema específico), fijando la FORMA del payload esperada
**And** el recipe de firma documentado (HMAC-SHA256 sobre `${timestampMs}.${rawBody}`, cabecera `X-Zafronix-Signature-256: sha256=<hex>`, `X-Zafronix-Timestamp` en ms, ventana de replay 5 min) se verifica contra la función `verifySignature` del handler, incluyendo casos de manipulación (tamper) que deben fallar
**And** los nombres de cabecera del contrato (`X-Zafronix-Signature-256`, `X-Zafronix-Timestamp`, `X-Zafronix-Event-Type`, `X-Zafronix-Event-Id`, `X-Zafronix-Webhook-Id`, `X-Zafronix-Delivery-Attempt`) quedan aseverados contra los docs
**And** los samples se almacenan como fixtures versionados y existe un `CONTRACT.md` con la versión de contrato pineada, la fuente (URL + fecha) y un runbook de drift de 3 capas (guard de regresión propio, detección del cambio de Zafronix vía observabilidad en prod, y procedimiento de actualización)
**And** la validación de una entrega REAL firmada por Zafronix queda documentada como diferida (placeholder gated `*.real.test.ts` con `skipIf` + instrucciones de captura), sin implementarse, por estar bloqueada por la disponibilidad del registro de subscribers
**And** la suite corre verde en CI offline y no introduce dependencias de red, clave ni base de datos.

**Fuera de alcance (follow-up aparte):** idempotencia/deduplicación de entregas reintentadas por `X-Zafronix-Event-Id` en el handler (relevante por el backoff 0s,5s,25s,2m,10m,52m y auto-disable a 20 fallos) — se documenta como riesgo, no se implementa aquí. Tampoco la deuda de lint pre-existente en `scripts/sync-matches.ts` / `route.ts`.
