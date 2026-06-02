---
name: Championship Gold
status: final
description: Brand-layer design system for Quiniela Mundial FIFA 2026. Custom Dark-Mode-First system inheriting from shadcn/ui and Tailwind CSS.
colors:
  background: '#0D1B2A'
  card: '#1B263B'
  primary: '#E63946'
  primary-foreground: '#FFFFFF'
  accent: '#E9C46A'
  accent-foreground: '#1A1208'
  success: '#10B981'
  border: '#415A77'
  muted: '#8D99AE'
  destructive: '#E63946'
typography:
  display:
    fontFamily: 'Outfit'
    fontSize: '28px'
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: '-0.02em'
  ui:
    fontFamily: 'Inter'
    fontSize: '14px'
    fontWeight: '400'
    lineHeight: '1.5'
rounded:
  sm: '6px'
  md: '10px'
  lg: '16px'
  full: '9999px'
spacing:
  gutter: '16px'
  row-gap: '12px'
components:
  goal-picker-button:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    color: '{colors.accent}'
    radius: '{rounded.sm}'
  active-badge:
    background: '{colors.accent}'
    foreground: '{colors.accent-foreground}'
    radius: '{rounded.full}'
  paid-badge:
    background: '{colors.success}'
    foreground: '{colors.primary-foreground}'
    radius: '{rounded.full}'
  unpaid-badge:
    background: '{colors.destructive}'
    foreground: '{colors.primary-foreground}'
    radius: '{rounded.full}'
  wager-card:
    background: '{colors.card}'
    border: '1px solid {colors.accent}'
    radius: '{rounded.md}'
  tab-bar-container:
    background: '{colors.card}'
    border-bottom: '1px solid {colors.border}'
---

## Brand & Style

Championship Gold is a premium, television-inspired sports aesthetic designed to evoke the prestige and global scale of the FIFA World Cup. The layout relies on a deep royal indigo background and dark matte navy cards, bringing a classic stadium look to mobile screens.

The system extends shadcn/ui's dark theme defaults. This DESIGN.md specifies only the brand-layer deltas: our royal navy base, the championship gold accent (reserved for rankings, points, and trophies), a clean crimson for primary actions and destructive states, and a dedicated turf green for successful operations (like the auto-save indicator and paid membership status).

## Colors

The Championship Gold palette is built around high-contrast athletic accents set against structured dark bases.

*   **Deep Indigo Background (`#0D1B2A`)**: The primary workspace canvas, giving a rich, premium night-time backdrop.
*   **Matte Navy Card (`#1B263B`)**: Used for fixtures, leaderboards, and panel containers, cleanly separating interactive elements.
*   **Championship Gold (`#E9C46A`)**: The primary accent color. Reserved for points values, active duels, multipliers, and first-place status.
*   **Crimson Accent (`#E63946`)**: The action color, used for headers, primary click targets, and indicators for pending/destructive states.
*   **Turf Green Success (`#10B981`)**: The affirmative color. Used exclusively for checkmarks, confirmation messages (like "Guardado ✓"), and paid status badges.
*   **Border Slate (`#415A77`)**: Fine border separator for visual layout structure.
*   **Muted Blue-Gray (`#8D99AE`)**: Used for secondary text, elapsed times, and disabled controls.

Avoid: neon color overlays, bright pastel backgrounds, or arbitrary color coding of team badges.

## Typography

Championship Gold utilizes two type families from Google Fonts:

1.  **Outfit (Display & Headings)**: Bold, clean, and modern-sporty. Used for scores, rankings, headers, and badge titles. Set at `{typography.display.fontSize}` with tight letter spacing.
2.  **Inter (UI & Metadata)**: High-legibility sans-serif. Used for team listings, usernames, rules text, and metadata details.

## Layout & Spacing

The layout is built mobile-first, targeting single-column reading with a maximum content container width of `480px` (`max-w-md`) to ensure tap targets are comfortably within reach.

*   **Horizontal Gutters (`{spacing.gutter}`)**: 16px margins on mobile screens to keep layouts clean.
*   **Vertical Gaps (`{spacing.row-gap}`)**: 12px default gap between consecutive match cards to allow breathing room.

## Elevation & Depth

No elevation shadows are used. Depth is established through flat tonal shifts:
1.  **Layer 0 (Base)**: `{colors.background}`.
2.  **Layer 1 (Card)**: `{colors.card}` (resting on Base).
3.  **Layer 2 (Header/Modal)**: Same tone as Card but separated by a `{colors.border}` hairline.

Active elements are highlighted with a border of `{colors.accent}` or `{colors.border}`.

## Shapes

Championship Gold uses structured shapes to convey a premium, clean tool aesthetic:
*   `{rounded.sm}` (6px): Small controls, input boxes, and goal adjustment buttons.
*   `{rounded.md}` (10px): Match listing cards, profile frames, and drawer containers.
*   `{rounded.lg}` (16px): Large dialog pop-ups and welcome overlays.
*   `{rounded.full}` (9999px): Toggle badges, status tags, and score chips.

## Components

Custom components extending shadcn/ui defaults:

*   **Goal Picker Button**: `{components.goal-picker-button}`.
*   **Wager Card**: `{components.wager-card}`.
*   **Paid Tag**: `{components.paid-badge}`.
*   **Unpaid Tag**: `{components.unpaid-badge}`.
*   **Active Badge**: `{components.active-badge}`.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Use default dark-mode as the primary visual container | Build a light-mode layout (ruins the night stadium vibe) |
| Limit gold color (`{colors.accent}`) to points, multipliers and trophy elements | Use gold for all primary actions (dilutes its high-value meaning) |
| Show auto-save success using a green pulse effect on the card and a turf-green `✓` | Present noisy alert popups confirming the save |
| Provide large mobile tap areas (at least 48px) for match adjustment | Force users to select tiny inputs or type values |
| Use `{colors.success}` only for affirmative states (saving, payment verified) | Mix green into general UI borders or headers |
