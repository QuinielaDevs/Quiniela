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

## 2. Estrategia de Integración de Datos (API de Fútbol)

> **SUPERSEDED (2026-06-04 — ver Epic 7 / `sprint-change-proposal-2026-06-04.md`).** El plan Free de API-Football **no da acceso a `season=2026`** (verificado con llamadas reales: error de plan en `/fixtures` y `/leagues`). La estrategia Pull-and-Cache se reemplaza por: **seed del calendario desde datos reales** (`supabase/seed-data/worldcup-2026/`) + **captura de resultados por el administrador** (RPC admin-gated) + **motor automático de avance de fase**. La tabla en vivo (Epic 4) reacciona por Realtime al update del admin. El keep-alive diario se conserva. El texto siguiente queda como referencia histórica.

Para la actualización de los marcadores, horarios y resultados oficiales de los partidos se adopta el patrón **Pull-and-Cache** con la API externa **API-Football (api-sports.io)**:

1. **Restricción de Capa Gratuita:** API-Football otorga **100 solicitudes diarias** en su plan gratuito.
2. **Sincronización Selectiva (Cron Job):**
   * Un cron job programado (ej. vía Vercel Cron o GitHub Actions) consultará el endpoint `/fixtures` para el Mundial de la FIFA 2026 (`league=1`, `season=2026`).
   * **Filtro de horas activas:** Durante la Fase de Grupos y Eliminatorias, el cron solo se ejecutará cada 30 minutos *únicamente* dentro de las ventanas de tiempo en las que haya partidos activos (según el calendario de juegos). Fuera de los horarios de partidos, el cron no realiza llamadas. Esto asegura no consumir más de 30-40 llamadas en días de alta actividad y 0 llamadas en días de descanso.
3. **Escritura segura:** Las actualizaciones del cron se escriben directamente en la tabla `public.matches` de Supabase.
4. **Lectura del Cliente:** Los clientes de la Quiniela **nunca** consultan directamente la API de Fútbol. Consumen exclusivamente los datos de la base de datos de Supabase, eliminando los límites de peticiones de red y protegiendo el sistema de sobrecostes.

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

-- 4. Partidos (Sincronizados de la API de fútbol)
CREATE TABLE public.matches (
    id INTEGER PRIMARY KEY, -- ID de API-Football para mapeo directo
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    home_logo TEXT,
    away_logo TEXT,
    match_time TIMESTAMP WITH TIME ZONE NOT NULL, -- UTC para validaciones de bloqueo
    status VARCHAR(20) NOT NULL, -- scheduled, live, finished, canceled, suspended
    home_score INTEGER,
    away_score INTEGER,
    group_name TEXT,
    round_name TEXT,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Predicciones de los Usuarios
CREATE TABLE public.predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    match_id INTEGER REFERENCES public.matches(id) ON DELETE CASCADE,
    home_prediction INTEGER NOT NULL,
    away_prediction INTEGER NOT NULL,
    points_earned DECIMAL(5,2) DEFAULT 0.00 NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (user_id, match_id)
);

-- 6. Tabla de Desafíos (Directos 1v1 y Abiertos Grupales)
CREATE TABLE public.challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID REFERENCES public.leagues(id) ON DELETE CASCADE,
    match_id INTEGER REFERENCES public.matches(id) ON DELETE CASCADE,
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
