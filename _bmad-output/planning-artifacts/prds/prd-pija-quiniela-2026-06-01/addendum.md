# Addendum Técnico: Quiniela Mundial FIFA 2026

Este documento recopila las decisiones de arquitectura técnica, integraciones externas y especificaciones de base de datos para la implementación de la Quiniela del Mundial de la FIFA 2026. Al estar estas especificaciones ligadas a la tecnología de implementación, se mantienen separadas del PRD principal y sirven como referencia directa para la fase de desarrollo.

## 1. Pila Tecnológica (Tech Stack)

Para garantizar un coste operativo de **cero absoluto ($0.00 USD)** durante la ejecución de todo el torneo y optimizar la velocidad de desarrollo para un único programador, se ha elegido el siguiente stack:

| Componente | Tecnología | Razón de Elección y Límites de Capa Gratuita |
| :--- | :--- | :--- |
| **Frontend & Backend** | **Next.js 15 (App Router, React 19, TypeScript)** | Desarrollo unificado en un solo repositorio. Los React Server Components (RSC) permiten layouts rápidos y Server Actions elimina la necesidad de crear endpoints API intermedios. |
| **Hosting & CDN** | **Vercel (Plan Hobby)** | Despliegue continuo gratuito integrado con GitHub. Límites: 100 GB de ancho de banda mensual y 1 millón de ejecuciones serverless. |
| **Base de Datos (BaaS)** | **Supabase (Capa Gratuita)** | PostgreSQL relacional robusto con soporte nativo de autenticación social (Google), WebSockets (Realtime) y motor de base de datos local vía Supabase CLI. Límites: 500 MB de espacio en base de datos. |
| **Autenticación** | **Supabase Auth** | Integración nativa y exclusiva con Google OAuth (registro e inicio de sesión a un solo clic). |
| **Tiempo Real** | **Supabase Realtime** | Retransmisión instantánea de actualizaciones de base de datos a clientes. Límites: 200 conexiones WebSockets concurrentes simultáneas. |
| **CSS & UI Components**| **Tailwind CSS + Shadcn UI** | Desarrollo responsivo mobile-first rápido utilizando un sistema de diseño pulido y predefinido. |

---

## 2. Estrategia de Integración de Datos (API de Zafronix)

Para la actualización automática en tiempo real de marcadores y estados del torneo de la Copa del Mundo de la FIFA 2026, se integra la API deportiva **Zafronix World Cup API (api.zafronix.com)**. Esta integración está diseñada para encajar en el límite diario de 250 llamadas de su capa gratuita, logrando un costo operativo de **cero absoluto ($0.00 USD)**:

### 2.1 Webhooks en Tiempo Real (Actualización Push Primaria)
La API de Zafronix notifica los cambios de forma pasiva a través de webhooks. El servidor expone un endpoint HTTP POST en `/api/webhooks/zafronix`.
1. **Eventos suscritos:**
   * `match.finalized`: Emitido cuando finaliza un partido y su marcador queda definitivo.
   * `match.patched`: Emitido ante correcciones de marcadores de partidos ya finalizados.
   * `match.postponed`: Emitido si un partido es suspendido, cancelado o pospuesto oficialmente.
2. **Validación de Seguridad (HMAC-SHA256):**
   * Cada petición HTTP POST de Zafronix incluye la firma HMAC-SHA256 en la cabecera `X-Zafronix-Signature-256` y la marca de tiempo en `X-Zafronix-Timestamp`.
   * El webhook calcula la firma localmente sobre la cadena `${timestamp}.${rawBody}` utilizando la clave secreta `ZAFRONIX_WEBHOOK_SECRET` y valida que la diferencia temporal no supere los 5 minutos para prevenir ataques de repetición ("replay attacks").
3. **Persistencia y Reactividad:**
   * El payload procesado actualiza la fila de `public.matches` correspondiente usando `external_ref` como clave (ej. `2026-073`).
   * La tabla en vivo (Epic 4) reacciona por Supabase Realtime a este cambio de base de datos.
   * Los webhooks no realizan solicitudes a la API, por lo que **no consumen la cuota de llamadas diarias**.

### 2.2 Sincronización Periódica de Respaldo (Conditional GETs con ETags)
Como mecanismo de contingencia si falla la red o la entrega del webhook:
1. Un cron job periódico (ej. cada 30 minutos durante las ventanas de partidos activos) realiza una petición condicional a `GET /matches?year=2026`.
2. Se envía la cabecera HTTP `If-None-Match` incluyendo el último `ETag` (hash SHA-256 de la respuesta) almacenado en la caché o base de datos.
3. Si los marcadores y el calendario no han cambiado, el servidor de Zafronix responde con un código **`304 Not Modified`** y cuerpo vacío.
4. **Las respuestas 304 no decrementan la cuota de llamadas diarias**, lo que permite verificar la sincronía infinitas veces de forma gratuita. Si hay cambios, se devuelve `200 OK` con el payload de los partidos para actualizar la base de datos y guardar el nuevo ETag.

### 2.3 Mecanismo de Emergencia (Admin RPC Override)
Se conserva el panel rápido y el procedimiento almacenado (RPC) `public.fn_admin_update_match_result` (desarrollado en la Epic 7). En caso de corte de red general de la API o errores de la fuente externa, el administrador del sistema puede forzar y anular marcadores manualmente por base de datos como última instancia.


---

## 3. Optimización de Rendimiento en Tiempo Real

El plan gratuito de Supabase limita las conexiones simultáneas de WebSockets a **200**. Para escalar a miles de usuarios activos en días de partidos dentro de este límite:

1. **Cálculo en Cliente (Client-side Recalculation):**
   * La base de datos difunde los goles y estados de los partidos en vivo a través de Supabase Realtime.
   * Los navegadores de los clientes reciben la actualización de goles y calculan de forma local en Javascript la tabla de posiciones proyectada y la resolución temporal de sus predicciones.
   * Se evita realizar costosas agrupaciones y uniones de base de datos (SQL Joins) por cada gol en vivo en el servidor de base de datos.
2. **Uso selectivo de Conexiones WebSocket:**
   * La conexión por WebSockets de Supabase Realtime se suscribe **únicamente** cuando el usuario tiene abierta la vista de la "Tabla de Posiciones Proyectada" o "Partidos en Vivo".
   * El resto de secciones estáticas de la aplicación (como el llenado de quinielas pasadas, perfil de usuario, etc.) utilizan peticiones HTTP `fetch` tradicionales, liberando sockets de inmediato.
3. **Pooler de Conexiones:**
   * Las Server Actions de Next.js se conectan a PostgreSQL utilizando el puerto del Connection Pooler de Supabase (`port: 6543`) para reutilizar conexiones activas y evitar saturar el límite de conexiones concurrentes de PostgreSQL (máximo 60 en capa gratuita).

---

## 4. Políticas de Seguridad (RLS) y Control de Concurrencia

### 4.1 Row Level Security (RLS) en Supabase
Para evitar trampas en las ligas privadas, se configuran las siguientes políticas a nivel de base de datos:

* **Predicciones (`predictions`):**
  * **Acceso de escritura:** Un usuario autenticado solo puede insertar o actualizar predicciones donde `user_id = auth.uid()`.
  * **Acceso de lectura restrictiva:** Un usuario no puede leer las predicciones de otros miembros de la liga hasta que falte menos de 1 minuto para el inicio del partido.
  * **Filtro SQL RLS para lectura:**
    ```sql
    CREATE POLICY "Allow read after kickoff lock" ON public.predictions 
    FOR SELECT 
    USING (
      auth.uid() = user_id 
      OR 
      EXISTS (
        SELECT 1 FROM public.matches 
        WHERE id = match_id 
        AND match_time - INTERVAL '1 minute' <= timezone('utc'::text, now())
      )
    );
    ```

### 4.2 Control de Concurrencia en Apuestas (Desafíos Directos y Abiertos)
Para evitar ataques de saldo negativo de puntos o duplicación de transacciones de puntos ("double-spending"), las apuestas y la retención en garantía (escrow) se ejecutan a nivel de base de datos en una transacción atómica mediante funciones SQL (RPC):

```sql
-- 1. Crear Desafío (Directo o Abierto)
CREATE OR REPLACE FUNCTION public.create_challenge(
    p_league_id UUID,
    p_match_id INTEGER,
    p_points_bet INTEGER,
    p_type VARCHAR(10), -- 'direct' o 'open'
    p_challenged_id UUID, -- NULL si es abierto (grupal)
    p_prediction_home INTEGER,
    p_prediction_away INTEGER
) RETURNS UUID AS $$
DECLARE
    v_creator_id UUID;
    v_current_points DECIMAL(5,2);
    v_challenge_id UUID;
BEGIN
    v_creator_id := auth.uid();
    
    -- Bloquear la fila de league_members para el creador
    SELECT points INTO v_current_points
    FROM public.league_members
    WHERE league_id = p_league_id AND user_id = v_creator_id
    FOR UPDATE;
    
    IF v_current_points < p_points_bet THEN
        RAISE EXCEPTION 'Saldo de puntos insuficiente para crear el desafío.';
    END IF;
    
    -- Insertar el desafío
    INSERT INTO public.challenges (
        league_id, match_id, creator_id, points_bet, type, challenged_id, status
    ) VALUES (
        p_league_id, p_match_id, v_creator_id, p_points_bet, p_type, p_challenged_id, 'pending'
    ) RETURNING id INTO v_challenge_id;
    
    -- Insertar al creador como participante
    INSERT INTO public.challenge_participants (
        challenge_id, user_id, prediction_home, prediction_away
    ) VALUES (
        v_challenge_id, v_creator_id, p_prediction_home, p_prediction_away
    );
    
    -- Restar puntos del creador (escrow)
    UPDATE public.league_members
    SET points = points - p_points_bet
    WHERE league_id = p_league_id AND user_id = v_creator_id;
    
    -- Registrar transacción
    INSERT INTO public.point_transactions (
        user_id, league_id, amount, description, reference_id
    ) VALUES (
        v_creator_id, p_league_id, -p_points_bet, 'Puntos en escrow por creación de desafío ' || p_type, v_challenge_id
    );
    
    RETURN v_challenge_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Unirse a Desafío / Aceptar Duelo
CREATE OR REPLACE FUNCTION public.join_challenge(
    p_challenge_id UUID,
    p_prediction_home INTEGER,
    p_prediction_away INTEGER
) RETURNS VOID AS $$
DECLARE
    v_user_id UUID;
    v_league_id UUID;
    v_points_bet INTEGER;
    v_current_points DECIMAL(5,2);
    v_type VARCHAR(10);
    v_status VARCHAR(20);
BEGIN
    v_user_id := auth.uid();
    
    -- Obtener datos del desafío
    SELECT league_id, points_bet, type, status INTO v_league_id, v_points_bet, v_type, v_status
    FROM public.challenges
    WHERE id = p_challenge_id;
    
    IF v_status <> 'pending' AND v_type = 'direct' THEN
        RAISE EXCEPTION 'Este desafío ya no está pendiente de aceptación.';
    END IF;
    
    -- Bloquear saldo del usuario que se une
    SELECT points INTO v_current_points
    FROM public.league_members
    WHERE league_id = v_league_id AND user_id = v_user_id
    FOR UPDATE;
    
    IF v_current_points < v_points_bet THEN
        RAISE EXCEPTION 'Saldo de puntos insuficiente para unirse al desafío.';
    END IF;
    
    -- Insertar participación
    INSERT INTO public.challenge_participants (
        challenge_id, user_id, prediction_home, prediction_away
    ) VALUES (
        p_challenge_id, v_user_id, p_prediction_home, p_prediction_away
    );
    
    -- Si es directo (1v1), pasar a activo
    IF v_type = 'direct' THEN
        UPDATE public.challenges
        SET status = 'active'
        WHERE id = p_challenge_id;
    END IF;
    
    -- Restar puntos del usuario (escrow)
    UPDATE public.league_members
    SET points = points - v_points_bet
    WHERE league_id = v_league_id AND user_id = v_user_id;
    
    -- Registrar transacción
    INSERT INTO public.point_transactions (
        user_id, league_id, amount, description, reference_id
    ) VALUES (
        v_user_id, v_league_id, -v_points_bet, 'Puntos en escrow por unirse a desafío ' || v_type, p_challenge_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 5. Prototipo de Esquema de Base de Datos (SQL)

El esquema de base de datos relacional se compone de las siguientes 11 tablas estructuradas y consolidadas:

```sql
-- 1. Tabla de Usuarios (Extiende auth.users de Supabase)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Tabla de Ligas Privadas
CREATE TABLE public.leagues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    invite_code VARCHAR(8) UNIQUE NOT NULL,
    admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    rules JSONB NOT NULL, -- Configuración de Modo de Predicción
    requires_payment BOOLEAN DEFAULT FALSE NOT NULL, -- Habilita control de pagos
    payment_amount TEXT, -- Ejemplo: "$10 USD"
    payment_instructions TEXT, -- Instrucciones para pago offline
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Relación de Miembros de Ligas (Tabla de Posiciones)
CREATE TABLE public.league_members (
    league_id UUID REFERENCES public.leagues(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    is_paid BOOLEAN DEFAULT FALSE NOT NULL, -- Rastreador de Pagos del admin
    points DECIMAL(5,2) DEFAULT 0.00 NOT NULL, -- DECIMAL para soportar multiplicadores decimales
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (league_id, user_id)
);

-- 4. Partidos (Sincronizados y sembrados desde la API de Zafronix / Calendario)
CREATE TABLE public.matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_ref TEXT UNIQUE, -- ID de partido de Zafronix (ej. "2026-001")
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    home_team_code TEXT, -- ISO3 para banderas
    away_team_code TEXT,
    home_score INTEGER CHECK (home_score >= 0),
    away_score INTEGER CHECK (away_score >= 0),
    match_time TIMESTAMP WITH TIME ZONE NOT NULL, -- UTC de inicio del partido
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'finished', 'suspended', 'canceled')),
    matchday INTEGER, -- Jornada (1, 2, 3)
    stage TEXT, -- Fase del torneo (group, round-32, round-16, quarter, semi, third-place, final)
    group_label TEXT CHECK (group_label IS NULL OR group_label IN ('A','B','C','D','E','F','G','H','I','J','K','L')), -- Grupo A-L
    bracket_slot INTEGER UNIQUE, -- Slot oficial de eliminatoria (73-104)
    home_source TEXT, -- Origen local si es TBD (ej. "1A", "W73")
    away_source TEXT, -- Origen visitante si es TBD (ej. "2B", "W73")
    venue TEXT, -- Estadio / Ciudad sede
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Predicciones de los Usuarios
CREATE TABLE public.predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID REFERENCES public.leagues(id) ON DELETE CASCADE,
    match_id UUID REFERENCES public.matches(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    home_score_pred INTEGER NOT NULL CHECK (home_score_pred >= 0),
    away_score_pred INTEGER NOT NULL CHECK (away_score_pred >= 0),
    multiplier DECIMAL(3,2) DEFAULT 1.00 NOT NULL CHECK (multiplier >= 1.00), -- Multiplicador por antelación
    points_earned DECIMAL(5,2), -- Puntos obtenidos reales
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (league_id, user_id, match_id)
);

-- 6. Tabla de Desafíos (Directos 1v1 y Abiertos Grupales)
CREATE TABLE public.challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID REFERENCES public.leagues(id) ON DELETE CASCADE,
    match_id UUID REFERENCES public.matches(id) ON DELETE CASCADE,
    creator_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    points_bet INTEGER NOT NULL CHECK (points_bet > 0),
    type VARCHAR(10) NOT NULL CHECK (type IN ('direct', 'open')), -- direct = 1v1, open = grupal
    challenged_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE, -- NULL para desafíos abiertos
    status VARCHAR(20) DEFAULT 'pending' NOT NULL, -- pending, active, completed, canceled
    winner_ids UUID[] NULL, -- Arreglo de ganadores (soporta empates y cobros múltiples)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. Participantes de Desafíos
CREATE TABLE public.challenge_participants (
    challenge_id UUID REFERENCES public.challenges(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    prediction_home INTEGER NOT NULL,
    prediction_away INTEGER NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (challenge_id, user_id)
);

-- 8. Historial de Transacciones de Puntos
CREATE TABLE public.point_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    league_id UUID REFERENCES public.leagues(id) ON DELETE CASCADE,
    amount DECIMAL(5,2) NOT NULL, -- DECIMAL para soportar movimientos fraccionarios
    description TEXT NOT NULL,
    reference_id UUID, -- ID del desafío o predicción asociada
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 9. Tabla de Opciones/Candidatos a Premios
CREATE TABLE public.award_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    award_type VARCHAR(20) NOT NULL CHECK (award_type IN ('champion', 'top_scorer', 'mvp')),
    candidate_name TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 10. Tabla de Pronósticos de Premios Especiales (Largo Plazo)
CREATE TABLE public.special_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    league_id UUID REFERENCES public.leagues(id) ON DELETE CASCADE,
    award_type VARCHAR(20) NOT NULL CHECK (award_type IN ('champion', 'top_scorer', 'mvp')),
    candidate_id UUID REFERENCES public.award_candidates(id) ON DELETE RESTRICT,
    points_earned DECIMAL(5,2) DEFAULT 0.00 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (user_id, league_id, award_type)
);

-- 11. Tabla de Historial de Medallas por Jornada
CREATE TABLE public.member_badges (
    league_id UUID REFERENCES public.leagues(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    round_name VARCHAR(50) NOT NULL,
    badge_type VARCHAR(30) NOT NULL CHECK (badge_type IN ('nostradamus', 'salado', 'tibio')),
    awarded_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (league_id, user_id, round_name, badge_type)
);
```
