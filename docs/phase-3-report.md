# Agent Board Phase 3 — Single-agent focus & visual polish

Phase 3 adds an automatic single-agent focus mode on top of the normalized board, derived purely from snapshot state. The three-column Kanban remains as the multi-agent/empty-state fallback.

## Focus view model

`lib/focus-model.ts` is a pure, source-free view model: `buildFocusModel(snapshot) → FocusModel | null`. It returns a model only when the board contains exactly one linked active execution.

Grouping (documented in the module header): active cards are those with status running/starting/waiting. Cards link into one execution through (a) `parentKey`, (b) thread `parentThreadId` → an active parent thread card, and (c) Redteam cards sharing a `scanId`. BB and Redteam never merge. Focus renders only when exactly one linked group contains at least one hero-eligible card (thread, workflow-agent, delegation, phase, or operation — plan steps are never heroes).

The hero is the group's deepest active execution, most recently active, with a stable key tie-break. Supporting cards (plan steps, sibling agents, Redteam phases) become pipeline nodes; the pipeline renders only when at least two truthful nodes exist. Recent activity is a bounded, newest-first feed; `completed`, `upNext`, `other`, and `otherAttention` classify the remaining cards. No duplicated collection logic: the model consumes only the existing `BoardCard` contract plus the new `activityFeeds` array.

## New contract fields

`contract/rpc.ts` adds optional, nullable `parentThreadId`, `sequence`, and `groupKey` on cards and `activityFeeds: [{ key, entries: [{ id, label, detail, at, kind }] }]` on the snapshot. All fields are additive and optional — old snapshots and clients stay compatible.

- `lib/bb-source.ts` tags thread cards with `parentThreadId`, plan steps with `groupKey: "plan:{threadId}"` + list `sequence`, and workflow agents with `groupKey: "workflow:{threadId}:{itemId}"` + agent index. `recentActivityFeed(threadId, rows)` builds a bounded, newest-first, reasoning-free feed from the same safe work rows as card activity.
- `lib/redteam-source.ts` tags phase cards with `groupKey: "redteam:{scanId}"` + the canonical phase order and builds `scanActivityFeed(scan)` with truthful labels (tool name, or `model`/`agent` for inference/agent-loop kinds).
- `lib/collect.ts` merges thread feeds (only for live-observed threads) and Redteam feeds into the snapshot.

## Focus UI

`components/board/single-agent-focus.tsx` renders: the pipeline track, the hero card (truthful label, status chip, live-operation strip while executing, waiting warning, animated activity line, latest observed operation, real stats only, visible errors, peer chips, Open/Details actions), bounded recent activity, completed work with summaries, the up-next queue, and an "Other activity" section where failures are always visible and the rest collapse behind one toggle. Empty sections are omitted entirely. `components/board/pipeline-track.tsx` renders discrete state glyphs (completed, active, pending, failed, interrupted, skipped) with `aria-current="step"` on the active node. `components/board/kanban-board.tsx` and `components/board/card-details.tsx` are verbatim extractions of the existing columns and details block.

## Motion and accessibility

All motion is restrained CSS driven by state changes only, defined in `app.css`:

- active pulse (`ab-breathe`, `ab-node-pulse`): 1.8 s opacity/shadow breathing;
- connector sweep (`ab-connector-signal`): 500 ms one-shot when the active step advances exactly one node;
- indeterminate strip (`ab-strip-slide`): only while a hero is executing;
- activity crossfade (`ab-activity-in/out`) and row entrance (`ab-row-in`): 250 ms, the hero itself never re-animates for a text change;
- completion pop (`ab-pop`): 250 ms then static; failure accent (`ab-fail-in`): 300 ms one-shot then persistent styling; settle (`ab-settle`): 450 ms.

There are no requestAnimationFrame loops and no new polling; the two one-shot animation cleanup timeouts (550 ms, 300 ms) are the only timers added. Both `@media (prefers-reduced-motion: reduce)` and `[data-motion="reduced"]` (rendered from `matchMedia`, defaulting safe when unavailable) disable every animation; the live strip becomes a static state and the connector signal is hidden. State is never encoded in color or motion alone: glyphs, status chips, and text carry it. Buttons are keyboard-usable and there is no aggressive `aria-live`.

## Live BB 0.40 / SDK 0.4.21 observations

Authorized scans on project `example-project` (`/home/user`), static mode, local Ollama models.

- Scan `example-scan-a` completed in ~10.5 minutes (0 candidates, truthful budget-exhausted summary).
- Scan `example-scan-b` completed in 10m23s; observation thread `example-thread-id` (idle) showed the board in **focus mode** throughout:
  - Reconnaissance running: hero `operation`/`ACTIVE PHASE`, pipeline `Reconnaissance:active → Code review → Web testing → Verification → Reporting`, recent feed `model · Generating with selected model`, up-next the four remaining phases.
  - Transition to code review: pipeline became `Reconnaissance:completed → Code review:active …`, the feed accumulated `agent · Investigating with selected model`, completed section gained `Reconnaissance`.
  - The current main thread (`example-thread-id`, running) plus the running scan produced two independent executions — the board correctly stayed in **Kanban** (`buildFocusModel` → null).
  - After completion the observation board returned to Kanban with all five phases in OUTPUTS and bounded summaries.
- No Redteam modification was needed; the public `observability_snapshot` contract already carried everything required.

## Tests

123 pre-existing tests all pass unchanged in behavior; the suite grew to 193 tests across 11 files, adding: focus-model unit tests (grouping, hero selection, pipeline derivation, feed bounding, section classification), bb-source/redteam-source/collect tests for the new fields and feeds, jsdom UI tests for focus rendering, mode switches via realtime, hero actions, failure visibility, and a dedicated reduced-motion file that stubs `window.matchMedia` (jsdom-safe).

`npm run typecheck`, `bb plugin build`, and the public-SDK-only import scan all pass. Version bumped 0.2.0 → 0.3.0.