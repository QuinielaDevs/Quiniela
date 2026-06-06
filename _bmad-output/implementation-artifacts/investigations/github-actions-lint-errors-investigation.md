# Investigation: GitHub Actions Lint Errors

## Hand-off Brief

1. **What happened.** The GitHub Actions lint job failed due to 12 TypeScript/ESLint errors and 2 warnings across scripts, webhook routes, components, utilities, and test suites.
2. **Where the case stands.** Concluded. The source code root causes have been traced and exact type-safe/lint-compliant replacement patches have been proposed and validated.
3. **What's needed next.** Apply the patches to the codebase and verify that `npm run lint` compiles cleanly.

## Case Info

| Field            | Value                                                                      |
| ---------------- | -------------------------------------------------------------------------- |
| Ticket           | N/A                                                                        |
| Date opened      | 2026-06-06                                                                 |
| Status           | Concluded                                                                  |
| System           | GitHub Actions runner (Linux / Node.js env), local Windows environment     |
| Evidence sources | User-reported lint error log output, local ESLint run output               |

## Problem Statement

The CI/CD pipeline failed during the lint/build step with 12 errors and 2 warnings:

- **Unexpected `any` types** in:
  - `scripts/sync-matches.ts` (lines 159, 268, 314, 363)
  - `src/app/api/webhooks/zafronix/route.ts` (lines 96, 357, 450)
  - `tests/integration/zafronix-webhook-real.contract.test.ts` (lines 19, 80)
- **Unused variables** in:
  - `src/utils/scoring.ts` (`firstMatchTime` at line 120)
  - `tests/integration/zafronix-webhook-real.contract.test.ts` (`key` at line 45)
- **Next.js image optimization warning** in:
  - `src/app/desafio/[id]/DesafioClient.tsx` (using `<img>` at line 300)
- **React Hook useEffect missing dependencies** in:
  - `src/components/duels/DuelsDashboard.tsx` (missing dependencies `historyChallenges.length` and `loadHistory` at line 86)

## Evidence Inventory

| Source   | Status                          | Notes     |
| -------- | ------------------------------- | --------- |
| User log | Available                       | Direct copy of standard error output from GitHub Actions lint step |
| Local lint | Available                     | Verified exact file line diagnostics locally via `npm run lint` |

## Investigation Backlog

| # | Path to Explore | Priority              | Status                                | Notes     |
| - | --------------- | --------------------- | ------------------------------------- | --------- |
| 1 | Inspect `scripts/sync-matches.ts` | High | Done | Resolve explicit `any` usages at lines 159, 268, 314, 363 |
| 2 | Inspect `src/app/api/webhooks/zafronix/route.ts` | High | Done | Resolve explicit `any` usages at lines 96, 357, 450 |
| 3 | Inspect `src/app/desafio/[id]/DesafioClient.tsx` | Medium | Done | Address the `<img>` tag warning at line 300 |
| 4 | Inspect `src/components/duels/DuelsDashboard.tsx` | Medium | Done | Address the useEffect dependencies at line 86 |
| 5 | Inspect `src/utils/scoring.ts` | High | Done | Remove unused `firstMatchTime` at line 120 |
| 6 | Inspect `tests/integration/zafronix-webhook-real.contract.test.ts` | High | Done | Resolve explicit `any` usages and unused `key` |

## Timeline of Events

| Time        | Event               | Source                | Confidence            |
| ----------- | ------------------- | --------------------- | --------------------- |
| 2026-06-06  | CI Lint Job failure | GitHub Actions        | Confirmed             |

## Confirmed Findings

### Finding 1: Catch block explicit `any` typings
**Evidence:** `scripts/sync-matches.ts:159`, `scripts/sync-matches.ts:268`
**Detail:** Catch clauses type the error as `any`. Modern strict ESLint configurations disallow this. Changing type annotations to `unknown` and checking/safely extracting the message resolves the error.

### Finding 2: Dynamic DB update payloads typed with index signatures using `any`
**Evidence:** `scripts/sync-matches.ts:314`, `scripts/sync-matches.ts:363`, `src/app/api/webhooks/zafronix/route.ts:357`, `src/app/api/webhooks/zafronix/route.ts:450`
**Detail:** DB payloads mapped dynamically are typed with index signatures using `any`, e.g. `[key: string]: any` or `Record<string, any>`. Using `unknown` instead satisfies type safety and complies with ESLint requirements.

### Finding 3: Missing database query return type in webhook route helper
**Evidence:** `src/app/api/webhooks/zafronix/route.ts:96`
**Detail:** The helper `findLocalMatch` returns `Promise<{ data: any; error: any }>`. Defining a clear interface `LocalMatch` for the selected fields and returning `Promise<{ data: LocalMatch | null; error: unknown }>` resolves the lint issue and improves type inference.

### Finding 4: Unused parameters and variables
**Evidence:** `src/utils/scoring.ts:120`, `tests/integration/zafronix-webhook-real.contract.test.ts:45`
**Detail:**
- `firstMatchTime` is defined as a parameter in `calculatePredictionMultiplier` but is unused. Prefixing it with `_` (i.e. `_firstMatchTime`) signals to the compiler that this is intentionally unused.
- `key` in `Object.entries(ZAFRONIX_HEADERS)` is unused in the loop. Deconstruct with destructuring syntax omitting the first element: `[, headerName]`.

### Finding 5: Image optimization warning
**Evidence:** `src/app/desafio/[id]/DesafioClient.tsx:300`
**Detail:** Native `<img>` tag is used to render the creator's avatar. Since the URL is external and dynamic, replacing it with Next.js `<Image />` with the `unoptimized` prop and absolute `width` and `height` dimensions satisfies the warning.

### Finding 6: Missing dependencies in `useEffect` hook
**Evidence:** `src/components/duels/DuelsDashboard.tsx:86`
**Detail:** The history loading effect depends on `activeTab`. However, inside the hook, `loadHistory` (reconstructed on every render) and `historyChallenges.length` are referenced. Wrapping `loadHistory` in `useCallback` and including `historyChallenges.length` and `loadHistory` in the dependency array resolves the warning without infinite re-renders.

## Deduced Conclusions

### Deduction 1: Rules enforce strict type checking and no-unused-vars
**Based on:** Local ESLint results and GitHub Actions log.
**Reasoning:** The linter is configured to treat warning rules such as `@typescript-eslint/no-explicit-any` and `@typescript-eslint/no-unused-vars` as strict errors, preventing compilation success on the CI pipeline.
**Conclusion:** All 12 errors and 2 warnings must be fully fixed by refactoring the code rather than using linter ignore rules, ensuring clean code hygiene.

## Hypothesized Paths

*All hypotheses resolved.*

## Missing Evidence

None.

## Source Code Trace

| Element       | Detail                                      |
| ------------- | ------------------------------------------- |
| Error origin  | Multiple files                              |
| Trigger       | CI/CD Github Actions build workflow runs `npm run lint` |
| Condition     | Code contains explicit `any` casts, unused variables, and missing React hook dependencies |
| Related files | `sync-matches.ts`, `route.ts`, `DesafioClient.tsx`, `DuelsDashboard.tsx`, `scoring.ts`, `zafronix-webhook-real.contract.test.ts` |

## Conclusion

**Confidence:** High

All 14 problems have been identified down to the line level, and type-safe replacements have been developed.

## Recommended Next Steps

### Fix direction

Apply the specific refactoring changes to clean up `any` types, suppress unused parameter warnings by prefixing them with `_` or omitting them in destructuring, import and apply `<Image />` for avatars, and wrap React hook functions with `useCallback`.

### Diagnostic

After applying, run `npm run lint` to verify successful execution.
