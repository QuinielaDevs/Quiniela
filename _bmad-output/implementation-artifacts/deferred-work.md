# Deferred Work

## Deferred from: code review of story-1.1 (2026-06-01)

- `[db.seed] enabled=true` apunta a `./seed.sql` inexistente (`supabase/config.toml:71`) — default de plantilla; `supabase start` lo tolera, pero conviene crear un `seed.sql` vacío o desactivar `[db.seed]`.
- `additional_redirect_urls = ["https://127.0.0.1:3000"]` con `site_url = "http://127.0.0.1:3000"` (`supabase/config.toml:163`) — corregir a `http://` cuando se implemente el flujo de auth/OAuth local.
- Defaults de auth sin endurecer: `minimum_password_length = 6`, `enable_confirmations = false`, `max_rows = 1000` (`supabase/config.toml`) — endurecer durante el hardening de producción.
- `cacheComponents: true` en `next.config.ts:4` — confirmar que la activación de esta flag de caché de Next 16 es intencional (válida y en verde, pero cambia el modelo de caché por defecto).
- `components.json` con `tailwind.config: ""` mientras existe `tailwind.config.ts` (Tailwind v3) — puede provocar configuración incorrecta en futuros `shadcn add`.
- `eslint-config-next` fijado en `15.3.1` mientras Next es `16.2.7` (`package.json`) — el bump a `eslint-config-next@^16` migra a flat config nativo (quitar `FlatCompat` en `eslint.config.mjs`) PERO activa la regla `react-hooks/set-state-in-effect`, que falla en `src/components/theme-switcher.tsx` (código de plantilla del Grupo B). Alinear la versión y resolver ese error de lint cuando se aborde el código de plantilla.
