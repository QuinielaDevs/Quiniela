---
title: Quiniela Mundial FIFA 2026
status: final
created: 2026-06-01
updated: 2026-06-01
---

# PRD: Quiniela Mundial FIFA 2026

## 0. Propósito del Documento
Este Documento de Requisitos de Producto (PRD) define las capacidades funcionales, la experiencia de usuario y las métricas de éxito para la aplicación de la Quiniela del Mundial de la FIFA 2026. Está dirigido al único desarrollador del proyecto (Cris), a fin de guiar los sprints de implementación, y a los revisores de calidad de BMad. El documento utiliza un vocabulario anclado en el Glosario y prioriza los requisitos del producto (las capacidades de negocio y usuario) sobre la tecnología concreta. Las decisiones arquitectónicas, el stack técnico y el modelo de base de datos relacional se definen de manera complementaria en el [addendum.md](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/addendum.md).

## 1. Visión
La Quiniela del Mundial de la FIFA 2026 es una plataforma web mobile-first interactiva diseñada para crear y gestionar ligas privadas de pronósticos deportivos entre amigos, compañeros de trabajo y comunidades. A diferencia de las plantillas de Excel tradicionales o las aplicaciones de quinielas pasivas, este producto incrementa la competitividad y la interacción social diaria a través de mecánicas activas en tiempo real (como duelos 1v1 y tablas proyectadas en vivo) mientras elimina por completo las barreras de uso mediante onboarding inmediato y guardado automático sin fricciones.

El objetivo estratégico es ofrecer una experiencia premium y dinámica que mantenga el interés de los participantes durante todo el mes del torneo, permitiendo al administrador gestionar la logística (incluyendo el cobro de la participación) mediante transparencia y control social básico, sin necesidad de integrar pasarelas de pago ni lidiar con trabas legales.

## 2. Usuario Objetivo

### 2.1 Jobs to Be Done (JTBD)
* **Funcional (Jugador):** Quiero registrar mis pronósticos de forma rápida desde mi celular, sin tener que teclear marcadores ni preocuparme por guardar manualmente, para no perder tiempo ni arriesgarme a perder mis datos.
* **Social/Emocional (Jugador):** Quiero competir directamente contra amigos específicos y retarlos cara a cara apostando mis puntos para demostrar mi conocimiento de fútbol y generar rivalidad directa.
* **Funcional (Administrador):** Quiero configurar una liga privada en segundos, invitar a mis amigos vía WhatsApp sin enviar códigos complejos, y poder marcar quién ha pagado y quién no, con la opción de dar de baja a miembros inactivos o deudores.
* **Emocional (Espectador):** Quiero ver cómo cambia la tabla de posiciones en tiempo real mientras ocurren los partidos del Mundial, convirtiendo la app en una pantalla complementaria de la transmisión de televisión.

### 2.2 No-Usuarios (v1)
* Jugadores que buscan apostar dinero real directamente dentro de la plataforma (el dinero se gestiona de forma externa entre los participantes).
* Administradores de torneos masivos corporativos públicos que requieren pasarelas de pago automatizadas integradas.

### 2.3 Viajes del Usuario Clave (Key User Journeys)

* **UJ-1: Invitación y Registro Instantáneo (Smart Deep-Linking)**
  * **Persona y contexto:** Pedro recibe un enlace de WhatsApp enviado por su amigo Cris para unirse a su liga del Mundial.
  * **Estado inicial:** Pedro no está registrado. Abre el enlace en su celular.
  * **Recorrido:** El enlace abre la aplicación mostrando una tarjeta de bienvenida personalizada: *"Cris te invita a la liga 'La Pija Quiniela'"*. Pedro toca el botón de "Registrarse con Google". Google valida su identidad en un segundo.
  * **Clímax:** Pedro es redirigido inmediatamente a la vista principal de la liga de Cris, estando ya unido automáticamente como miembro activo, sin haber tenido que copiar códigos ni validar correos electrónicos.
  * **Resolución:** Pedro ve la tabla de posiciones inicial y el botón para empezar a pronosticar.
  * **Caso de borde:** Si el correo de Google de Pedro ya estaba registrado en el sistema bajo otra liga, el sistema lo une a la nueva liga de Cris de forma transparente y mantiene su perfil intacto, unificando su cuenta.

* **UJ-2: Guardado Táctil y Rápido (Mobile-First Auto-Save)**
  * **Persona y contexto:** Laura quiere llenar los pronósticos de la jornada del día siguiente mientras viaja en el transporte público.
  * **Estado inicial:** Autenticada en su móvil, en la pantalla de "Pronósticos".
  * **Recorrido:** Laura ve las tarjetas de los partidos. En lugar de teclear, toca el botón `+` en el marcador local de México para subir a `2`, y `+` en el marcador visitante de Polonia para subir a `1`. 
  * **Clímax:** Al dejar de pulsar durante 500 milisegundos, aparece un destello verde y una marca de verificación `✓` junto al partido indicando que su marcador `2 - 1` ha sido guardado de forma segura en el servidor.
  * **Resolución:** Laura bloquea su teléfono sabiendo que sus predicciones están registradas sin haber pulsado ningún botón de "Guardar".

* **UJ-3: Retar a un Amigo y Compartir por WhatsApp (Desafío Directo)**
  * **Persona y contexto:** Carlos está seguro de que Argentina goleará a Francia en el partido de mañana y quiere retar a Diego, quien está por encima de él en la tabla.
  * **Estado inicial:** Carlos y Diego son miembros de la misma liga y tienen puntos acumulados.
  * **Recorrido:** Carlos navega al partido Argentina-Francia en la quiniela, pulsa "Crear Desafío", selecciona "Directo (1v1)", elige a Diego, define una apuesta de 5 puntos e ingresa su marcador (`3 - 1`). Al guardar, la app genera el reto y muestra el botón de compartir. Carlos lo toca y se abre WhatsApp con un mensaje pre-formateado que le envía a Diego. Diego hace clic en el enlace, lo que abre directamente la landing page del reto con el detalle y un botón para responder. Diego acepta e ingresa su marcador (`1 - 2`).
  * **Clímax:** La aplicación retiene en garantía ("escrow") 5 puntos de la cuenta de Carlos y 5 puntos de la de Diego, reflejando el bloqueo temporal en sus saldos.
  * **Resolución:** Al finalizar el partido real, el sistema evalúa automáticamente quién obtuvo una mejor predicción bajo las reglas de puntuación. El ganador recibe los 10 puntos totales (recupera sus 5 y gana los 5 del oponente).

* **UJ-4: Proyección de la Tabla en Vivo**
  * **Persona y contexto:** Se está jugando el segundo tiempo del partido inaugural del Mundial. Cris está viendo el partido por televisión con la aplicación abierta en su celular.
  * **Estado inicial:** Autenticado, en la pantalla de "Tabla en Vivo" de su liga.
  * **Recorrido:** El partido real va 0-0. En el minuto 70, Ecuador anota un gol. El servidor procesa el gol y actualiza el marcador en vivo.
  * **Clímax:** La pantalla de Cris muestra una animación de "Impacto de Gol". La tabla de posiciones se reordena automáticamente en su pantalla: Cris, que pronosticó 1-0 a favor de Ecuador, sube momentáneamente al primer puesto con sus puntos proyectados.
  * **Resolución:** El partido termina 1-0; la proyección se convierte en la puntuación oficial final y Cris consolida su primer puesto en la tabla real.

## 3. Glosario
* **Quiniela (o Torneo):** La instancia general de la aplicación que contiene todos los partidos del Mundial de la FIFA 2026.
* **Liga Privada:** Un grupo competitivo creado por un Administrador al que los Jugadores se unen mediante un enlace de invitación. Cada liga tiene su propia tabla de posiciones, duelos 1v1 y configuraciones.
* **Administrador:** El creador de una Liga Privada. Tiene la facultad de modificar las reglas locales, registrar estados de pago de los miembros y dar de baja (expulsar) a jugadores.
* **Jugador (o Miembro):** Un usuario registrado participante en una o más Ligas Privadas.
* **Predicción Estándar:** El marcador estimado (Goles Local y Goles Visitante) que un jugador registra para un partido específico de la quiniela.
* **Multiplicador Incremental:** Factor matemático que premia la anticipación de una predicción. A mayor tiempo de antelación respecto al inicio del partido, mayor es el multiplicador sobre los puntos obtenidos.
* **Duelo 1v1:** Reto directo entre dos jugadores de la misma liga para un partido, donde apuestan una cantidad de sus propios puntos acumulados.
* **Puntos en Escrow (Garantía):** Puntos bloqueados temporalmente de los saldos de los retadores al aceptar un Duelo 1v1, imposibilitados de ser usados en otros duelos.
* **Predicción de Premios:** Pronóstico a largo plazo sobre eventos del torneo (Campeón del mundo, Goleador del torneo y MVP del torneo).
* **Puntuación Decreciente:** Regla que disminuye la recompensa máxima por la Predicción de Premios a medida que el torneo avanza y se reducen los riesgos.
* **Tabla de Posiciones Oficial:** Clasificación acumulada de una liga basada en los puntos reales consolidados.
* **Tabla Proyectada en Vivo:** Clasificación calculada en tiempo real combinando los puntos acumulados y los puntos que obtendrían los jugadores si los partidos actualmente en juego terminaran con su marcador en vivo.

## 4. Características y Requisitos Funcionales

### 4.1 Onboarding y Autenticación sin Fricción
**Descripción:** El sistema debe permitir a los usuarios registrarse e iniciar sesión de la forma más rápida posible para evitar el abandono en el primer uso. Se implementará de forma exclusiva el inicio de sesión único mediante Google (Google OAuth), reduciendo el registro a un solo toque en dispositivos móviles.
*Realiza UJ-1.*

**Requisitos Funcionales:**
#### FR-1: Registro Exclusivo con Google OAuth
El usuario puede crear una cuenta e iniciar sesión de manera instantánea utilizando su cuenta de Google.
* **Consecuencias:**
  * Al hacer clic en "Continuar con Google", el sistema valida las credenciales y crea el perfil del usuario (nombre, email y avatar) sin pasos adicionales.

---

### 4.2 Enlaces de Invitación Inteligentes (Smart Deep-Linking)
**Descripción:** Permite a los administradores compartir sus ligas privadas mediante enlaces cortos. Al abrir el enlace, el sistema identifica el grupo y guía al usuario para que al registrarse quede integrado automáticamente en la liga.
*Realiza UJ-1.*

**Requisitos Funcionales:**
#### FR-3: Generación de Enlace de Invitación
El Administrador puede generar un enlace único para invitar a usuarios a su liga.
* **Consecuencias:**
  * El enlace debe contener un formato amigable e incluir metadatos de OpenGraph para que al compartirse en WhatsApp/Telegram muestre el título de la liga y el nombre del creador.
  * El enlace codifica de manera segura el ID o código de la liga (ej. `/join/LIGA123`).

#### FR-4: Registro y Adhesión Automática
El sistema procesa el enlace de invitación y asocia al invitado a la liga de manera transparente tras su registro.
* **Consecuencias:**
  * Si el usuario no está autenticado, la app precarga el código de invitación en segundo plano y redirige al flujo de login.
  * Una vez autenticado (por Google OAuth), el usuario se une a la liga privada de forma inmediata y es redirigido a la vista de dicha liga.

---

### 4.3 Gestión Administrativa y Control de Pagos
**Descripción:** El administrador de la liga privada tiene control de la logística del grupo. Puede marcar quién ha pagado la cuota de entrada física (dinámicas de apuestas informales) y expulsar miembros.
*Realiza UJ-1, UJ-3.*

**Requisitos Funcionales:**
#### FR-5: Indicador de Pago (Presión Social)
El Administrador puede marcar a los miembros de la liga como "Pagado" o "Pendiente de Pago".
* **Consecuencias:**
  * Por defecto, los usuarios nuevos entran con estado "Pendiente".
  * La tabla de posiciones y las vistas de la liga mostrarán públicamente un indicador visual (ej. una etiqueta roja de "Pendiente" o un check verde de "Pagado") junto al nombre de cada jugador, incentivando el cobro mediante transparencia grupal.
  * Los usuarios pendientes acumulan y proyectan puntos normalmente; no se bloquea su juego para evitar fricciones.

#### FR-6: Baja de Miembros (Expulsión)
El Administrador puede eliminar de forma definitiva a cualquier miembro de la liga.
* **Consecuencias:**
  * Al dar de baja a un miembro, este es removido de la tabla de posiciones y de las relaciones de la liga. Sus predicciones y desafíos pendientes asociados a esa liga se cancelan o eliminan.

#### FR-24: Formulario de Creación y Configuración de Liga
El Administrador, al crear o editar su liga privada, puede configurar mediante un formulario específico las reglas y logística de la misma.
* **Consecuencias:**
  * El formulario permite habilitar/deshabilitar la opción "Requiere Pago".
  * Si se habilita "Requiere Pago", el formulario obliga a ingresar el "Monto de Inscripción" y las "Instrucciones de Pago" (ej. cuenta bancaria, Bizum, Zelle, efectivo).
  * Al habilitar "Requiere Pago", la app activa automáticamente el Indicador de Pago (FR-5) y el panel rápido de cobros para el administrador. El Smart Deep-Link de invitación incluirá estas condiciones de pago en la bienvenida del invitado.
  * Si "Requiere Pago" está inhabilitado, se ocultan por completo los indicadores visuales de pago en la clasificación y las vistas públicas.
  * El formulario permite definir el Modo de Predicción de la liga (Completo, Jornada o Dual).

---

### 4.4 Tablero de Predicciones Táctil con Auto-guardado
**Descripción:** La interfaz de usuario móvil debe optimizarse para un ingreso rápido de marcadores, eliminando el teclado del teléfono e implementando botones táctiles grandes para subir o bajar los goles de cada equipo. La información se guarda automáticamente sin necesidad de botones de guardado.
*Realiza UJ-2.*

**Requisitos Funcionales:**
#### FR-7: Controles Táctiles Incrementales
La vista de predicciones debe proporcionar botones de más/menos (`+`/`-`) para ajustar los marcadores de los partidos.
* **Consecuencias:**
  * Al presionar los botones, el valor numérico se incrementa o decrementa de 1 en 1, con un límite mínimo de 0.
  * No se debe desplegar el teclado nativo del móvil en ningún momento de esta interacción para evitar la fatiga visual y física del usuario.

#### FR-8: Auto-guardado con Debounce e Indicador Visual
El sistema guarda de manera silenciosa las predicciones modificadas tras un breve lapso de inactividad de clics.
* **Consecuencias:**
  * Al realizar un ajuste, el sistema espera 500ms de inactividad del usuario (debounce) para enviar la petición al servidor.
  * Tras confirmarse la persistencia en el servidor, se muestra un micro-indicador de éxito (ej. un pequeño destello verde del marcador o la aparición del check `✓`).
  * En caso de error de red, el sistema muestra una advertencia visual y reintenta automáticamente al recuperar conexión.

#### FR-9: Bloqueo Temporal de Predicciones
El sistema bloquea la edición de predicciones para un partido 1 minuto antes de su horario de inicio oficial (Kickoff).
* **Consecuencias:**
  * El sistema toma la hora del servidor en UTC y el horario del partido registrado para inhabilitar los controles de edición (`+`/`-`) a partir de: `match_time - 1 minuto`.

#### FR-22: Gestión de Partidos Suspendidos o Cancelados
Si un partido es suspendido, cancelado o pospuesto oficialmente fuera de los límites de la jornada o del torneo por la FIFA, el sistema anula todas las predicciones asociadas a ese encuentro.
* **Consecuencias:**
  * Las predicciones asociadas no otorgan ningún tipo de puntos (0 puntos para todos los participantes).
  * El partido se marca con estado "Canceled/Suspended" y no se contabiliza en el cálculo de tablas oficiales ni proyectadas.

---

### 4.5 Multiplicador Incremental por Predicción Anticipada
**Descripción:** Mecánica competitiva que premia el riesgo estratégico. Los usuarios que pronostiquen un partido con mayor antelación reciben un multiplicador sobre los puntos que obtengan en dicho encuentro. El cálculo se realiza por partido individual en base a su fecha/hora de kickoff.
*Realiza UJ-2.*

**Requisitos Funcionales:**
#### FR-10: Cálculo del Multiplicador Incremental
El sistema calcula y almacena un multiplicador para cada predicción en base a la diferencia entre la hora de creación/actualización de la predicción y la hora de inicio oficial del partido (kickoff).
* **Consecuencias:**
  * **Umbral A (> 5 semanas / más de 35 días):** Multiplicador de **2.0x**
  * **Umbral B (4 a 5 semanas / 28 a 35 días):** Multiplicador de **1.8x**
  * **Umbral C (3 a 4 semanas / 21 a 28 días):** Multiplicador de **1.6x**
  * **Umbral D (2 a 3 semanas / 14 a 21 días):** Multiplicador de **1.4x**
  * **Umbral E (1 a 2 semanas / 7 a 14 días):** Multiplicador de **1.2x**
  * **Umbral F (< 1 semana / menos de 7 días):** Multiplicador de **1.0x** (sin bono, puntuación estándar).
  * Si el usuario actualiza una predicción, el multiplicador se recalcula y sobrescribe según la marca de tiempo de la actualización.
  * La interfaz de usuario debe mostrar una advertencia interactiva si un cambio de marcador causará la degradación del multiplicador actual para ese partido.

#### FR-11: Aplicación del Multiplicador en Puntuación
El sistema aplica el multiplicador al calcular los puntos obtenidos tras finalizar el partido.
* **Puntuación Base:**
  * Marcador exacto: **5 puntos**.
  * Ganador o empate acertado pero marcador incorrecto: **2 puntos**.
  * Sin acierto: **0 puntos**.
* **Fórmula de puntos finales:** `PuntosObtenidos = PuntosBase * Multiplicador`.
* **Consecuencias:**
  * Si un jugador acierta el marcador exacto (5 puntos) con más de 5 semanas de antelación, recibe `5 * 2.0 = 10.0 puntos`.
  * Los puntos resultantes pueden contener decimales y se sumarán de esta manera a las tablas de posiciones.

---

### 4.6 Módulo de Desafíos (Directos 1v1 y Abiertos Grupales)
**Descripción:** Los jugadores pueden competir activamente apostando sus propios puntos acumulados en la tabla general de la liga para un partido determinado, creando un mercado activo de pique y recompensas.
*Realiza UJ-3.*

**Requisitos Funcionales:**
#### FR-12: Creación de Desafíos (Directos y Abiertos)
Un jugador (Creador) puede emitir un desafío para un partido específico de la quiniela, definiendo el tipo de reto.
* **Consecuencias:**
  * **Desafío Directo (1v1):** Dirigido a un oponente específico de la liga. El desafío permanece "Pendiente" hasta que el oponente lo acepta.
  * **Desafío Abierto (Grupal):** Un pozo competitivo libre para toda la liga. Cualquier miembro de la liga puede unirse aportando el entry fee en puntos.
  * El creador debe poseer un saldo de puntos acumulados en la liga mayor o igual al monto que desea apostar (`puntos_apuesta > 0` y `puntos_acumulados >= puntos_apuesta`).
  * El creador debe registrar su predicción para ese partido como parte de la creación del reto.

#### FR-13: Retención de Puntos en Garantía (Escrow)
El sistema bloquea temporalmente los puntos de la apuesta al crearse y aceptarse/unirse al desafío.
* **Consecuencias:**
  * Al crear el desafío (directo o abierto), se le restan inmediatamente los puntos apostados del saldo del creador para la tabla y se marcan como "en garantía" (escrow).
  * En desafíos Directos, al aceptar el oponente, se restan y bloquean de igual forma sus puntos de apuesta. Si el oponente rechaza o el partido inicia sin ser aceptado, los puntos del creador en garantía se devuelven automáticamente.
  * En desafíos Abiertos, a medida que cada participante se une, se restan y bloquean sus puntos correspondientes del saldo disponible y se colocan en el pozo del escrow.

#### FR-14: Resolución y Reparto del Pozo
El sistema resuelve el desafío de forma automática una vez finalizado el partido oficial.
* **Consecuencias:**
  * Se evalúan los puntos base (5, 2 o 0 puntos) obtenidos por las predicciones de cada participante del desafío para ese partido específico.
  * El pozo total acumulado (ej. `puntos_apuesta * número_participantes`) se reparte equitativamente entre el participante o participantes que sumen la mayor puntuación base en el partido del desafío.
  * Si hay empates perfectos en las predicciones, el pozo se divide en partes iguales entre los ganadores empatados.
  * Si el partido asociado es suspendido, cancelado o pospuesto oficialmente, el desafío se anula de inmediato y todos los puntos retenidos en garantía (escrow) se devuelven en su totalidad al saldo de puntos disponible de todos los participantes.

#### FR-23: Compartir Desafío de Forma Viral (WhatsApp Banter & Smart Landing)
El sistema facilita compartir los retos fuera de la aplicación de forma llamativa para motivar la participación instantánea.
* **Consecuencias:**
  * Al crear el reto, el sistema muestra un botón de "Compartir en WhatsApp" que copia o envía un mensaje redactado con tono de competitividad y pique (Banter Text), incluyendo los nombres de los jugadores, la apuesta y un enlace inteligente (ej. `/desafio/xyz`).
  * El enlace contiene etiquetas de metadatos de OpenGraph para generar tarjetas visuales enriquecidas al pegarse en WhatsApp (visualizando banderas de los equipos, avatares de los jugadores y el monto del pozo).
  * El enlace dirige a una Landing Page optimizada para móviles que muestra el desafío directamente con botones de acción rápida ("Aceptar Duelo" / "Unirse al Pozo") administrando el inicio de sesión único de Google OAuth en segundo plano.

---

### 4.7 Predicciones de Premios de la Copa (Largo Plazo)
**Descripción:** Permite a los usuarios pronosticar quién será el Campeón, el Máximo Goleador y el MVP del Mundial, con una puntuación que se devalúa a medida que el torneo avanza.
*Realiza UJ-2.*

**Requisitos Funcionales:**
#### FR-15: Pronóstico de Premios Especiales
El usuario puede ingresar sus predicciones para los tres galardones principales en cualquier momento hasta antes de las semifinales.
* **Consecuencias:**
  * La interfaz ofrece un selector rápido basado en la lista de favoritos de casas de apuestas (precargados de forma manual en la base de datos por el administrador de la plataforma) para agilizar la selección en móviles.

#### FR-16: Sistema de Recompensa Decreciente
La recompensa máxima asignada por acertar un premio decrece en base a las fases del torneo.
* **Líneas Temporales de Puntuación:**
  * **Fase A (Antes del partido inaugural):** Acertar otorga **50 puntos**.
  * **Fase B (Durante Fase de Grupos):** Acertar otorga **25 puntos** (desde el silbatazo del partido 1 hasta antes de iniciar el primer partido de Octavos de Final).
  * **Fase C (Octavos y Cuartos de Final):** Acertar otorga **10 puntos** (desde Octavos hasta antes de iniciar la primera Semifinal).
  * **Fase D (Semifinales en adelante):** No se permiten más predicciones o cambios para estos premios (**0 puntos**).

---

### 4.8 Proyección de Clasificaciones en Vivo (Real-Time Leaderboard)
**Descripción:** Sincroniza la tabla de posiciones en tiempo real basándose en los partidos que se están jugando en vivo, convirtiendo a la quiniela en un acompañamiento activo de la transmisión. Los datos de goles, marcadores y estados de partidos se reciben automáticamente en tiempo real mediante la integración de la API de Zafronix (vía webhooks), manteniendo la opción de invalidación o edición manual por el administrador en caso de ser necesario.
*Realiza UJ-4.*

**Requisitos Funcionales:**
#### FR-17: Tabla de Posiciones Proyectada
El sistema calcula y muestra una vista de clasificación proyectada sumando los marcadores en vivo de los encuentros en desarrollo a las predicciones guardadas de los jugadores.
* **Consecuencias:**
  * La tabla debe reordenarse dinámicamente cuando hay un cambio de marcador en los partidos en vivo.
  * El sistema muestra un indicador visual o notificación temporal en la interfaz (ej. "¡Gol de Ecuador! Laura sube al 2º puesto").
  * Para mantener la escala gratuita, la tabla proyectada se procesa eficientemente y solo mantiene conexiones WebSocket activas en la pantalla de la tabla en vivo.

---

### 4.9 Tablas por Jornada y Medallas Humorísticas
**Descripción:** Para mantener enganchados a los usuarios que van rezagados o que ingresaron tarde al torneo, el sistema divide el torneo en jornadas independientes y otorga insignias de perfil según el desempeño.
*Realiza UJ-4.*

**Requisitos Funcionales:**
#### FR-18: Clasificación por Jornada
El sistema genera tablas de posiciones independientes por cada jornada de partidos (definida según el calendario oficial del Mundial 2026).
* **Consecuencias:**
  * Permite definir ganadores semanales o por jornada dentro de la liga privada.

#### FR-19: Insignias y Medallas Humorísticas Automáticas
El sistema asigna insignias virtuales especiales en el perfil del usuario al cierre de cada jornada en base a estadísticas de predicción específicas.
* **Tipos de Insignias:**
  * **"Nostradamus":** Otorgada por acertar un marcador exacto de alta dificultad (ej. marcadores con más de 3 goles de un equipo o resultados muy improbables).
  * **"El Salado":** Otorgada por una racha de cero puntos en toda una jornada de partidos.
  * **"El Tibio":** Otorgada por pronosticar empates en la mayoría de sus partidos en la jornada.

---

### 4.10 Desempates por Rivalidad Directa y Tarjeta Psicológica
**Descripción:** Mecánicas estructuradas para resolver empates en las clasificaciones sin recurrir al azar, y resúmenes de jugador listos para compartir.
*Realiza UJ-4.*

**Requisitos Funcionales:**
#### FR-20: Criterio de Desempate Estructurado
El sistema resuelve empates en la clasificación aplicando las siguientes reglas en orden jerárquico:
1. **Cantidad de Marcadores Exactos:** Número total de marcadores exactos acertados (predicciones de 5 puntos base).
2. **Duelos 1v1 Directos:** Puntuación en los enfrentamientos directos entre los jugadores empatados en esa liga.
3. **Fecha de Registro:** Prioridad a quien se haya registrado primero en la liga.

#### FR-21: Tarjetas de Perfil Psicológico de Juego
El sistema genera una "tarjeta de jugador" visual al término de cada jornada que categoriza al usuario según sus hábitos de juego.
* **Perfiles Clave:**
  * **Optimista:** Si tiende a pronosticar marcadores con alta cantidad de goles a favor de los equipos favoritos.
  * **Conservador:** Si tiende a pronosticar resultados ajustados (1-0, 0-0, 1-1).
  * **Cazador de Sorpresas:** Si frecuentemente pronostica victorias de equipos desfavorecidos por las apuestas.
  * La tarjeta debe ser visual y optimizada para ser descargada o compartida directamente en chats de WhatsApp.

## 5. No-Goles (Explícitos)
* **Pasarela de Pagos:** No se integrará Stripe, PayPal ni cobro integrado con criptomonedas. Todo intercambio monetario de las apuestas locales se gestiona externamente por el administrador.
* **Feed en vivo de Video:** La aplicación no transmite vídeo ni audio de los partidos del Mundial.
* **Chat de Texto Interno:** No se implementará un chat de mensajería en tiempo real dentro del app para evitar sobrecostes de base de datos; la comunicación se delega a WhatsApp.

## 6. Alcance del MVP

### 6.1 En el MVP
* Autenticación exclusiva mediante Google OAuth (registro a un solo toque).
* Enlaces de invitación de un solo clic (Smart Deep-Linking).
* Control de pagos manual para el administrador (visual) y capacidad de expulsar miembros.
* Tablero móvil de predicciones con botones `+`/`-` y guardado automático (debounce 500ms).
* Multiplicador incremental por tiempo de predicción.
* Mecánica de duelos 1v1 con puntos en escrow y resolución automática.
* Predicciones de Campeón, Goleador y MVP con puntuación decreciente.
* Tabla de posiciones proyectada en vivo.
* Tablas por jornadas independientes e insignias humorísticas.
* Criterio de desempate por duelos directos e insignias psicológicas básicas.

### 6.2 Fuera del MVP (Para versiones v2+)
* Torneos multideportivos (exclusivo para Mundial FIFA 2026).
* Integración con APIs de cobro móvil.
* Estadísticas avanzadas de rendimiento histórico de jugadores entre torneos anuales.

## 7. Métricas de Éxito

### Primarias
* **SM-1 (Retención Diaria):** Porcentaje de usuarios activos diarios (DAU) que ingresan a consultar o pronosticar en días de partido. Objetivo: > 80% de los miembros registrados en ligas activas. *Valida FR-7, FR-8, FR-17.*
* **SM-2 (Adopción de Duelos):** Porcentaje de miembros de la liga que inician o aceptan al menos un Duelo 1v1 durante la fase de grupos. Objetivo: > 60% de los usuarios activos. *Valida FR-12, FR-13, FR-14.*

### Secundarias
* **SM-3 (Fricción en Registro):** Tiempo promedio transcurrido desde que se hace clic en el enlace de invitación hasta que el usuario registra su primera predicción. Objetivo: < 2 minutos. *Valida FR-1, FR-3, FR-4.*

### Métricas de Control (Counter-metrics - No optimizar a costa de esto)
* **SM-C1 (Sobrecarga de Servidor en Vivo):** Número de peticiones WebSocket y de base de datos por usuario por minuto durante horas de partido. No debe superar las cuotas gratuitas del pooler de Supabase (límite de 200 conexiones WebSocket simultáneas en tiempo real). Si se supera, se debe priorizar la optimización del lado del cliente desactivando reactividad innecesaria en pantallas inactivas.

## 8. Preguntas Abiertas
*Ninguna (todas las preguntas iniciales fueron resueltas e incorporadas en el diseño del borrador).*

## 9. Índice de Supuestos (Assumptions)
* `[ASSUMPTION (Sección 4.4 - FR-8)]`: Un retardo de 500ms de inactividad de clics en móviles es suficiente para asegurar que el usuario terminó de registrar sus goles, optimizando el tráfico del servidor sin retrasar la percepción de guardado automático.
