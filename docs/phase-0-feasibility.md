# Agent Board — Phase 0: Research & Feasibility Report

Date: 2026-09-03 · Status: **findings ready for review; no dashboard implementation yet**

## Method & environment

- Read the installed `bb-plugin-authoring` skill (all relevant references: backend SDK/events/foundation, frontend registration/core slots/API indexes, testing).
- Scaffolded this plugin (`bb plugin new agent-board`) and ran `bb plugin types`, which pins
  `@get-bb/plugin-sdk@0.4.34` — the **authoritative contract for the installed BB 0.41.0**.
  All signatures below were read from
  `node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk.d.ts` (17,341 lines) and
  `bb-plugin-sdk-app.d.ts`.
- Cross-checked against live, read-only data (`bb thread list --json`) and the installed
  `bb-plugin-redteam@0.7.1` source.
- The local `get-bb/bb` checkout at `/home/user/bb` is 0.40.0 (older than installed 0.41.0),
  so it was used only as background, never as the contract.
- Baseline build verified: `bb plugin build` passes on the untouched scaffold.

**Contract rule applied throughout:** only `@get-bb/plugin-sdk`, `@get-bb/plugin-sdk/app`,
`@get-bb/plugin-sdk/testing*` public exports, `bb.*` plugin API surfaces, and the bound
`bb.sdk`. No `@bb/*` private packages, no `bb.db` access, no monkey-patching.
`experimental_scanPublicSdkOnly` will enforce this in tests.

## Feature matrix

| Feature | Supported? | Public API / source |
| --- | --- | --- |
| Thread status | **Yes** | `bb.sdk.threads.get/list` → `ThreadResponse.status` (`active\|error\|idle\|pending\|starting\|stopping`) + `runtime.displayStatus` (adds `waiting-for-host`, `host-reconnecting`, `provisioning`) + per-row `activity` counts |
| Parent/child threads | **Yes** | `ThreadResponse.parentThreadId`; `threads.list({ parentThreadId })` (recursive descent for grandchildren); parent timeline system rows `child-completed/failed/interrupted/needs-attention` with subject `threadId`/`threadName`; `thread:changed` change kinds incl. `parent-changed` |
| Provider per thread | **Yes** | `ThreadResponse.providerId`; friendly names via `experimental_useProviders()` (frontend, host cache) / `bb.sdk.providers.list()` (backend) |
| Model per thread | **Yes, indirect** | `threads.defaultExecutionOptions({ threadId })` → `ResolvedThreadExecutionOptions { model, reasoningLevel, permissionMode, serviceTier }`; workflow agents carry `model` directly. **Not on `ThreadResponse`** (see Gaps G1) |
| Explicit plan steps | **Yes** | `threads.timeline` → `pendingTodos.items` `{ id, status: completed\|in_progress\|pending, text, updatedAt, sourceSeq }`; timeline `planSteps` work rows (steps with `active\|completed\|failed\|pending`); events `turn/plan/updated`, `item/plan/delta`; `bb.sdk.status.get({threadId})` also returns `pendingTodos` |
| Delegation descriptions | **Yes** | timeline `delegation` items `{ background, childRef, label, status: completed\|failed\|interrupted\|pending, summary }`; events `item/delegation/progress`, `item/delegation/completed` |
| Current / latest activity | **Yes** | `threads.timeline` work rows (each with `status`, `startedAt`, `completedAt`, host `presentation` labels); workflow agents' `lastToolName`, `lastToolSummary`, `lastProgressAt`; incremental `threads.events.list({ afterSeq, types })` |
| Tool activity | **Yes** | timeline work-row kinds: `commandExecution`, `toolCall`, `fileChange`, `webSearch`, `webFetch`, `imageView`, `fileRead`, `search`, `planSteps`, `backgroundTask`, `delegation`, `workflow`, `approval`, `question`, `extension` — all with status + presentation |
| Subagent final output | **Yes** | `threads.output({ threadId })` (last assistant text); `thread.idle` event payload carries `lastAssistantText` for free; delegation `summary`; workflow agents' `resultPreview` |
| Failed / interrupted / waiting | **Yes** | `status: "error"`; `turn.failed` event (ids, `errorInfo`, `rateLimits`, `attemptNumber`); row status `interrupted`; command/tool rows `approvalStatus: "waiting_for_approval"`; `threads.interactions.list` (pending interactions); `threads.queuedMessages.list` / `queue.list` (waiting rows with `waitingOn`) |
| Workflow-style subagents (BB's own) | **Yes** | `threads.timeline` → `activeWorkflows[]` / `activeBackgroundCommands[]` each with `workflow: { agents: [{ label, model, state: queued\|running\|done\|failed\|skipped, phaseTitle, promptPreview, resultPreview, lastToolName, lastToolSummary, startedAt, queuedAt, durationMs, tokens, toolCalls, error }], phases: [{ index, title }] }` — this is the exact dataset behind BB's kanban-style workflow UI |
| Overall parent progress | **Yes** | timeline `goal` `{ objective, status: active\|paused\|budgetLimited\|complete, tokensUsed, tokenBudget, timeUsedSeconds }`; `pendingTodos` progress; `contextWindowUsage` |
| Realtime updates | **Yes** | Backend: `bb.sdk.subscribe({ event: "thread:changed", threadId? })` → `{ changes[], metadata: { statusChange { status, runtime, activity { activeWorkflowCount, activeBackgroundAgentCount, … } }, eventTypes[], hasPendingInteraction } }` + `bb.events.on` six lifecycle events (`thread.created/active/idle/failed/archived/deleted`, `message.queued/dispatched`, `turn.failed`). Frontend: `useRealtime(channel, handler)` + `useRealtimeConnectionState()`. Sanctioned pattern: backend subscribes → `bb.realtime.publish(channel, payload)` → frontend refetches via RPC (no aggressive polling) |
| Open underlying thread | **Yes** | `useBbNavigate().toThread(threadId)`; `experimental_useSidebarThreadActions().open(id, { split })`; backend `threads.open` targets the pane |
| Thread-scoped board surface | **Yes** | `app.slots.threadPanelAction` — **core (non-experimental) slot**: an "Agent Board" action in the thread right-panel Actions list, opening a closable panel tab whose component receives `{ threadId, params }`; `layout: "flush"` fits app-like content. (Panel params persist across reloads; identical params refocus the tab.) |
| Global active-work view (Phase 3) | **Yes** | `app.slots.navPanel` plugin page; `threads.list()` across projects (+ `includeHidden`), `threads.listRunning()`, `threads.count({ groupBy })`; `experimental_useSidebarThreads()` live host cache |
| Embed full thread transcript in details | **Yes** | host `ThreadChat` component (`variant: "compact" \| "timeline"`) — read-only timeline variant exists |
| Theme-native UI | **Yes** | host token classes only; the plugin Tailwind pass emits default-theme utilities; dark/light inherited from BB |

## API gaps & designed degradation

- **G1 — model not on `ThreadResponse`.** Closest supported: `threads.defaultExecutionOptions`
  per thread (N+1 calls) and per-workflow-agent `model`. v1 caches resolved models per thread id
  with TTL + refresh on status change. *BB API gap to potentially request later: model on thread
  DTO/list rows or a bulk execution-options call.*
- **G2 — realtime carries change *signals*, not content.** `thread:changed` tells us *what kind*
  of things changed (`events-appended` + `eventTypes[]`, `status-changed` …) but not the payload.
  Designed behavior: signal → bounded refetch (`threads.timeline` with `segmentLimit`, latest
  page; `threads.events.list({ afterSeq })` for incremental activity). This is the sanctioned
  invalidate-and-refetch pattern; it is not raw polling because it is event-driven.
- **G3 — Redteam's internal agents are not BB threads.** `bb-plugin-redteam@0.7.1` runs its own
  agent loop over Ollama Fleet RPC and spawns **no** BB child threads. Agent Board (v1, generic)
  will show the parent BB thread that launched a scan (when launched from a thread), any ordinary
  BB child threads, workflows, and queued work — but *not* Redteam's internal phases. Closest
  supported public data for an optional later integration: Redteam's own RPC `scan_get`/
  `scan_list` (phase, status, findings). Per project rules, v1 takes **no** Redteam dependency.
- **G4 — `delegation.childRef` → thread-id mapping unverified.** Almost certainly the child
  thread id (thr_…); verified against live data in Phase 1. Fallback: correlate by
  `parentThreadId` from `threads.list({ parentThreadId })`, which is authoritative regardless.
- **G5 — reasoning/"thinking" text is exposed but intentionally not rendered.** `activeThinking`
  and `item/reasoning/*` exist in public timeline data. Per the project charter (no
  chain-of-thought surfacing), v1 derives "current activity" only from work rows, `lastTool*`,
  plan steps, and delegation summaries. This is a policy decision, not an API gap.
- **G6 — no server-side push of timeline *content* to plugins.** Same as G2; documented for the
  "do not persist what BB can reconstruct" rule: the board keeps only volatile normalized state
  in memory (plus small kv caches like resolved models), rebuilt from `bb.sdk` on load and on
  signals.

## Thread hierarchy handling (confirmed)

- `threads.list({ parentThreadId })` enumerates direct children (incl. `includeHidden: true` for
  hidden/background children; hidden children still report turns/blockers to the parent).
- Recursive descent gives arbitrary depth (A → B/C/D → …). Board state is a tree keyed by
  `threadId` with `parentThreadId` links; cards render per node with ancestor path.
- Parent timeline system rows (`child-completed` etc.) and `delegation` items provide labels,
  summaries, and outcome notifications even for children that are hidden from the sidebar.

## Proposed v1 architecture

```
BB thread lifecycle / entity changes
   bb.sdk.subscribe({event:"thread:changed"})      (invalidation + activity deltas)
   bb.events.on("thread.*","message.queued", …)    (lifecycle announcements)
        │
        ▼
Backend (server.ts + lib/)
   board-state.ts      in-memory normalized tree; parent/child association;
                       status/timestamps; plan steps; delegation items; activity tail;
                       bounded output previews; model cache (G1)
   collect.ts          read-side fan-out over bb.sdk.threads (get/list/timeline/output/
                       defaultExecutionOptions/events.list) with segmentLimit + afterSeq
   signals.ts          coalescing + bb.realtime.publish("agent-board-changed", {rootThreadId})
   rpc contract        schema-validated (zod) via defineRpcContract:
                       board_snapshot { threadId } → normalized board for thread + descendants
                       board_activity { threadId } → latest activity tail (paged)
        │
        ▼  plugin RPC (useRpc) + realtime signal (useRealtime)
React frontend (app.tsx + components/)
   Thread-scoped panel: app.slots.threadPanelAction "Agent Board" (layout: flush)
   Header: thread/project, provider+model, elapsed, running/waiting/complete/failed counts
   Columns: PLAN/QUEUED · ACTIVE AGENTS · OUTPUTS/DONE
   Cards: status chip, title/task, provider·model, elapsed, latest activity, output preview,
          "Open thread" (useBbNavigate().toThread), expandable details (ThreadChat timeline
          variant for full transcript in Phase 2/3)
   Phase 3: navPanel global view reusing the same components
```

### Planned file structure (v1)

```
bb-plugin-agent-board/
├─ package.json               (manifest: bb.server, bb.app; engines pinned by bb plugin types)
├─ server.ts                  factory: settings, rpc, events, subscribe, realtime, dispose
├─ app.tsx                    definePluginApp: threadPanelAction (+ Phase 3 navPanel)
├─ contract/
│  └─ rpc.ts                  shared zod RPC contract + board DTO schemas (single source)
├─ lib/
│  ├─ board-state.ts          normalization: ThreadResponse/timeline/delegation → board nodes
│  ├─ collect.ts              bounded bb.sdk fan-out + model cache
│  └─ signals.ts              coalesced realtime publish
├─ components/
│  ├─ Board.tsx               layout + header + columns
│  ├─ PlanColumn.tsx / AgentCard.tsx / OutputCard.tsx
│  ├─ StatusChip.tsx / Elapsed.tsx / DetailsSheet.tsx
│  └─ ui/…                    vendored host-styled primitives (scaffold's shadcn base)
├─ hooks/
│  └─ useBoard.ts             useRpc + useRealtime + reconnect reconcile
├─ tests/
│  ├─ board-state.test.ts     normalization: hierarchy, status mapping, transitions (vitest,
│  │                          @get-bb/plugin-sdk/testing + createFakeSdk overrides)
│  ├─ server.test.ts          RPC validation, event → signal flow, reload/dispose
│  ├─ app.test.tsx            card transitions via renderSlot (testing/app)
│  └─ public-sdk-scan.test.ts experimental_scanPublicSdkOnly guard
└─ docs/phase-0-feasibility.md
```

### Phase mapping

- **Phase 1 (minimum live board):** `board-state` + `collect` + `board_snapshot` RPC +
  `thread:changed` subscription + coalesced signals + threadPanelAction panel with three
  columns, statuses, provider/model, timers, child outputs, open-thread links.
- **Phase 2 (activity):** plan steps (`pendingTodos` + planSteps rows), delegation items,
  activity tails via `events.list({afterSeq})`, expandable details, waiting/failed/interrupted
  treatments, `ThreadChat` timeline details.
- **Phase 3 (polish):** native visuals refinements, filters, `navPanel` global dashboard,
  recent runs, optional Redteam-specific integration behind a feature flag (G3).

## Scaffold status (allowed by Phase 0)

- `bb-plugin-agent-board/` created via `bb plugin new`; `npm install` + `bb plugin types`
  (SDK 0.4.34) + `bb plugin build` all pass. Content is still the untouched todo example —
  **no dashboard code written yet**, per the stop-and-report instruction.
- Not installed/enabled, nothing committed, no GitHub/publish actions taken.

## Decisions requested from you

1. Confirm the **threadPanelAction** surface for v1 (vs. `experimental_threadHeaderAction`
   button opening the same panel — both possible; header action is experimental, panel action
   is core).
2. Confirm G5 policy: exclude any reasoning/"thinking" text from the board (recommended).
3. Confirm no persistence beyond small caches (G6) — board state rebuilt from BB on load.