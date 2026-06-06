# Investigation: Special Predictions / Award Candidates UI Location

## Hand-off Brief

1. **What happened.** The special predictions feature (MVP, top scorer, and champion) is fully implemented under `/awards` (`src/app/awards/page.tsx`), but it is not linked from the main user interface navigation (neither in the `BottomNavbar` nor on the `/predictions` dashboard).
2. **Where the case stands.** Concluded. The root cause is that the task instructions for Story 6.1 explicitly stated not to modify the navigation bar (`BottomNavbar`), and the link was only added to the template's `/protected` fallback landing page, which is bypassed by the root redirect to `/predictions`.
3. **What's needed next.** Add a navigable entry point to `/awards` in the main UI, such as a banner/card on the `/predictions` dashboard or an option in the bottom navigation bar.

## Case Info

| Field            | Value                                                                      |
| ---------------- | -------------------------------------------------------------------------- |
| Ticket           | N/A                                                                        |
| Date opened      | 2026-06-06                                                                 |
| Status           | Concluded                                                                  |
| System           | Windows, Next.js / React project                                           |
| Evidence sources | Source code files, project epics                                           |

## Problem Statement

The user is asking: "Donde esta el apartado de award_candidates? quiero decir, en primera instancia no lo veo en ningun lado de la interfaz. Hablo de la opcion de que el usuario selecciones cosas como, el mvp del torneo, goleador y el campeon" (Where is the section for award_candidates? I mean, I don't see it anywhere in the interface at first glance. I'm talking about the option for the user to select things like the tournament MVP, top scorer, and champion).

## Evidence Inventory

| Source | Status | Notes |
| ------ | ------ | ----- |
| [src/components/layout/BottomNavbar.tsx](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/components/layout/BottomNavbar.tsx) | Confirmed | Contains only links for `/predictions`, `/standings`, `/duels`, and `/account`. Does not link to `/awards`. |
| [src/app/protected/page.tsx](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/app/protected/page.tsx) | Confirmed | Contains a link to `/awards` on lines 62-69, but this page is not in the navigation flow. |
| [src/app/page.tsx](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/app/page.tsx) | Confirmed | Redirects logged-in users directly to `/predictions` (bypassing `/protected`). |
| [src/app/awards/page.tsx](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/app/awards/page.tsx) | Confirmed | Page implementation for "Premios Especiales de la Copa". |

## Investigation Backlog

| # | Path to Explore | Priority | Status | Notes |
| - | --------------- | -------- | ------ | ----- |
| 1 | Search codebase for `award_candidates` and special predictions UI | High | Done | Located `/awards` page and navbar configuration. |

## Timeline of Events

| Time  | Event | Source | Confidence |
| ----- | ----- | ------ | ---------- |
| 18:05 | User asks where the award candidates are in UI | User chat | Confirmed |
| 22:06 | Checked `BottomNavbar` and confirmed no `/awards` link | [BottomNavbar.tsx](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/components/layout/BottomNavbar.tsx) | Confirmed |
| 22:06 | Checked page redirects and confirmed `/protected` bypass | [page.tsx](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/app/page.tsx) | Confirmed |
| 22:07 | Verified `/awards` page existence | [page.tsx](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/app/awards/page.tsx) | Confirmed |

## Confirmed Findings

### Finding 1: Route `/awards` exists but is orphaned

**Evidence:** [src/app/awards/page.tsx](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/app/awards/page.tsx)

**Detail:** The page `/awards` is implemented to render the tournament predictions for MVP, champion, and top scorer. It fetches candidates from the `award_candidates` table and saves selections to `special_predictions`.

### Finding 2: Link exists only on `/protected` template page

**Evidence:** [src/app/protected/page.tsx#L62-L69](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/app/protected/page.tsx#L62-L69)

**Detail:** A link to `/awards` is placed on the `/protected` route. However, this route is part of the original Supabase template boilerplate and is not part of the current application's user flow.

### Finding 3: Redirect bypasses `/protected` landing page

**Evidence:** [src/app/page.tsx#L17-L19](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/app/page.tsx#L17-L19)

**Detail:** When an authenticated user visits the landing page (`/`), they are redirected directly to `/predictions`. Therefore, they never see the `/protected` page or its links.

## Deduced Conclusions

### Deduction 1: Bypassed navigation leaves the feature unreachable

**Based on:** Finding 1, Finding 2, Finding 3

**Reasoning:** If the link only exists on `/protected`, and the user is redirected away from `/protected` to `/predictions` upon visiting the site, the user has no UI path to discover or navigate to `/awards`.

**Conclusion:** The `/awards` page is inaccessible through normal UI navigation.

## Hypothesized Paths

### Hypothesis 1: The UI for special predictions is unimplemented or hidden behind conditions

**Status:** Refuted

**Theory:** The special predictions (MVP, champion, top scorer) might not be exposed in the main navigation, or they might only appear under a specific league/tournament configuration or timing constraint.

**Resolution:** Refuted because the page `/awards` **is** fully implemented and functional, but simply lacks a entry point from the active navigation surfaces (`BottomNavbar` or predictions page).

## Missing Evidence

*None. All evidence gathered.*

## Source Code Trace

| Element | Detail |
| --- | --- |
| Route | `/awards` |
| File | [src/app/awards/page.tsx](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/app/awards/page.tsx) |
| Missing Entry Point | No link exists in [src/components/layout/BottomNavbar.tsx](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/components/layout/BottomNavbar.tsx) or [src/app/predictions/page.tsx](file:///c:/Users/Public/Development/AI-Driven/pija-quiniela/src/app/predictions/page.tsx) |

## Conclusion

**Confidence:** High

The `/awards` page (Premios Especiales) is fully implemented but currently orphan in the UI. Because authenticated users are automatically redirected to `/predictions`, the link on `/protected` is never reached.

## Recommended Next Steps

### Fix direction

We should expose the "Premios Especiales de la Copa" page to the user in the main flow. Two recommended options are:

1. **Option A: Add an entry card/banner at the top of the `/predictions` dashboard.**
   - Since predictions are the primary view, placing a highlighted card or alert pointing to `/awards` ("*¡No te olvides de registrar tus Premios Especiales del Mundial!*") makes it highly discoverable and relevant.
2. **Option B: Add it to the `BottomNavbar` (replacing or adding to the existing tabs).**
   - Note: The original story specified not to redesign the navbar yet, but this could be done now.

### Recommended Tool
To implement either of these options, use `/bmad-quick-dev`.
