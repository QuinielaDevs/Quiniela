# Reconciliación de Entradas — Quiniela Mundial FIFA 2026 (Revisión Final)

Este documento valida que todas las ideas, requisitos técnicos y decisiones acordadas con Cris se encuentren cubiertos en el PRD y en el Anexo Técnico.

## Insumos Evaluados:
1. **Brainstorming Session Results:** [brainstorming-session-20260531-212006.md](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/brainstorming/brainstorming-session-20260531-212006.md)
2. **Technical Research Report:** [technical-arquitectura-y-apis-quiniela-mundial-fifa-2026-2026-05-31.md](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/research/technical-arquitectura-y-apis-quiniela-mundial-fifa-2026-2026-05-31.md)
3. **Minuta de Acuerdos Post-Borrador (Revisión de Cris):** Discusión sobre retos grupales, escala de multiplicadores extendida por partido y viralidad de WhatsApp.

---

## 1. Cobertura de Ideas de la Lluvia de Ideas

| Idea Original | Estado de Reconciliación | Ubicación en el PRD |
| :--- | :--- | :--- |
| **Idea 1: Onboarding Simplificado** | Conciliado. Acceso exclusivo con Google OAuth. | [prd.md: Sección 4.1 (FR-1)](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md) |
| **Idea 2: Enlaces de Invitación Profunda** | Conciliado. Integra condiciones de pago del admin. | [prd.md: Sección 4.2 (FR-3, FR-4)](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md) |
| **Idea 3: Rastreador de Pagos y Presión** | Conciliado. Configurable en el formulario de creación. | [prd.md: Sección 4.3 (FR-5, FR-6, FR-24)](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md) |
| **Idea 4: Modalidad Dual de Predicción** | Conciliado. Multiplicadores incrementales por partido. | [prd.md: Sección 4.5 (FR-10, FR-11)](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md) |
| **Idea 5: Duelos de Puntos 1v1** | Conciliado. Integrado en módulo de Desafíos. | [prd.md: Sección 4.6 (FR-12 a FR-14)](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md) |
| **Idea 6: Predicciones de Premios Especiales** | Conciliado. Recompensa decreciente y favoritos manuales. | [prd.md: Sección 4.7 (FR-15, FR-16)](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md) |
| **Idea 7: Interfaz Táctil y Auto-guardado** | Conciliado. Botones `+`/`-`, 500ms debounce y check visual. | [prd.md: Sección 4.4 (FR-7, FR-8)](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md) |
| **Idea 8: Proyección de Tabla en Vivo** | Conciliado. Reactividad en vivo por partido. | [prd.md: Sección 4.8 (FR-17)](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md) |
| **Idea 9: Tablas por Jornada e Insignias** | Conciliado. Tablas semanales e insignias humorísticas. | [prd.md: Sección 4.9 (FR-18, FR-19)](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md) |
| **Idea 10: Desempate y Perfil Psicológico** | Conciliado. Tarjeta de jugador y criterios relacionales. | [prd.md: Sección 4.10 (FR-20, FR-21)](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/_bmad-output/planning-artifacts/prds/prd-pija-quiniela-2026-06-01/prd.md) |

---

## 2. Cobertura de Nuevos Requisitos Acordados

* **Multiplicador por Antelación (Escala A):** Se adopta oficialmente la escala por semanas definida en el PRD: >5 semanas (2.0x), 4-5 semanas (1.8x), 3-4 semanas (1.6x), 2-3 semanas (1.4x), 1-2 semanas (1.2x), <1 semana (1.0x). Se descarta el bono upfront del torneo para simplificar la lógica de cara a los usuarios.
* **Módulo de Desafíos Unificado:** Soporta desafíos directos (1v1) y abiertos (grupales/pozos) en base a la misma tabla relacional, con cobros y reembolsos automáticos en escrow.
* **Compartido Viral por WhatsApp:** Botón de compartir con Banter Text personalizado y Smart Links con OG metatags para previsualización dinámica.
* **Configuración del Administrador:** Habilitación de pago, monto e instrucciones de cobro.

---

## 3. Cobertura de Requisitos Técnicos (Anexo)

* **Supabase & Next.js Schema:** Adaptado para 8 tablas, agregando `public.challenges` y `public.challenge_participants` para el módulo unificado, y campos de configuración en `public.leagues`.
* **Funciones SQL RPC Transaccionales:** Implementadas las funciones `public.create_challenge` y `public.join_challenge` en PL/pgSQL para asegurar la integridad atómica de los saldos y escrow de puntos.
