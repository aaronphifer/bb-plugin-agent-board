# Agent Board Daily Workflow Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Implement the five approved daily monitoring and review improvements.
**Architecture:** Extend source-normalized card metadata and pure dashboard derivation. Keep persistence and catch-up local to the client, with native navigation for host actions and bounded data everywhere.
**Tech Stack:** TypeScript, React, Zod, Vitest, BB Plugin SDK.
**Spec:** ../specs/2026-11-08-daily-workflow-design.md

## Global Constraints

- No new runtime dependencies or publication.
- Preserve current SDK support; inspect live declarations before choosing actions.
- Never equate a turn ending or reported checks with independently verified work.
- Never invent native-agent models or navigate opaque provider child references as BB IDs.
- Keep all previews and client storage bounded and validated.

## Review Focus

- First visits, clock skew, failed refreshes and partial snapshots must not manufacture or erase catch-up events.
- Changed activity on an old completion must not look like new completion.
- Blocked/corrupt client storage must leave the board usable.
- Child activity must not replace the parent's final result.
- Filter choices missing from the latest bounded snapshot must remain visible and resettable.

## Task 1: Source evidence and attention

Files: contract/rpc.ts, lib/bb-source.ts, lib/board-model.ts, lib/global-model.ts, tests/bb-source.test.ts, tests/global-model.test.ts, tests/dashboard-view.test.ts.
- [x] Add failing assertions for specific command/file targets, question text/time, final-only results, goals/changed paths and native delegation ownership.
- [x] Implement bounded optional card review/interaction metadata; aggregate children while preserving the parent review result.
- [x] Run focused normalization/model tests; fix regressions.

## Task 2: Saved views and catch-up model

Files: lib/dashboard-preferences.ts, lib/catch-up.ts, hooks/useDashboardPreferences.ts, hooks/useCatchUp.ts, tests/dashboard-preferences.test.ts, tests/catch-up.test.ts.
- [x] Add failing tests for corrupt/blocked storage, bounded named views, transition fingerprints and partial snapshots.
- [x] Implement pure parsing, filtering windows and catch-up comparison; hooks persist successful snapshots and explicit acknowledgements.
- [x] Run focused tests.

## Task 3: Dashboard and review UX

Files: components/global/global-dashboard.tsx, components/global/dashboard-controls.tsx, components/global/catch-up-summary.tsx, components/global/execution-children.tsx, components/board/completion-summary.tsx, tests/global-app.test.tsx.
- [x] Add failing user-flow tests for purposeful attention actions, review provenance, persisted views/catch-up and child expansion.
- [x] Implement compact rows, disclosed controls/diagnostics, catch-up list, safe native actions and child details.
- [x] Run UI tests and address old expectations changed by the approved design.

## Task 4: Verify and document

Files: README.md, docs/daily-workflow.md.
- [x] Run full Vitest suite, typecheck, BB build and package checks.
- [x] Review the complete diff and verify desktop/mobile rendering; correct any material defects.
- [x] Record checks and remaining source/API limits. Leave the stable installed plugin intact unless an isolated preview is needed.

## Execution notes

- Added an update-awareness card at Aaron’s follow-up request. It checks official GitHub releases with a bounded hourly shared cache and uses BB’s own eligible-update installer only after confirmation. Outside-range releases remain advisory on BB versions without range upgrades. Older installations need an in-range patch containing the notifier before it can alert them.
- Native SDK 0.6.132 has no delegation model field. The feature preserves the existing development SDK pin and supported legacy panel registration; the live host warns about retirement but supports the bundle.
- Baseline: 468 passing tests. Current implementation: 498 passing tests; typecheck and BB frontend/backend build pass. Package verification now validates actual builder metadata instead of requiring a historical hardcoded builder version.
- Preview uses separate plugin ID agent-board-preview; stable agent-board installation remains unchanged.

- Fresh reviewer identified partial-snapshot catch-up loss, scoped native-agent timeline fallback, and credential query parameters in result links. Each has a regression test observed failing before its fix. The final suite passes all 498 tests.
