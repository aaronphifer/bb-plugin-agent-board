# Agent Board

Agent Board is a generic BB execution-observability plugin with two complementary surfaces:

- **Global operations dashboard** — open **Agent Board** from BB navigation to see bounded active work, structured unresolved attention, and recent terminal executions across projects.
- **Thread-scoped board** — open the thread panel action for the existing focused/Kanban view of one thread tree and its optional public plugin sources:
- **Execution timeline** — use **Timeline** from either surface to lazily load the latest bounded chronological operational events for one BB thread, Redteam scan, or Fleet job.

- **Single-agent focus** — when exactly one logical execution is active (a running thread, one Redteam scan, one delegation, one workflow, or a plan), the board shows that execution alone: a pipeline/progress track of truthful discrete states, a hero card with live activity, bounded recent activity, completed work, and the up-next queue. Failures and waiting states stay visible; empty sections collapse away.
- **Three-column Kanban** (fallback) — when zero or several executions are active, the classic columns return:
  - **PLAN / QUEUED** — explicit plan steps, queued messages, waiting threads, and pending pipeline phases.
  - **ACTIVE AGENTS** — running BB threads/workflows and active external operations.
  - **OUTPUTS / DONE** — completed, failed, interrupted, and skipped work with bounded summaries.

The mode is derived from the normalized snapshot by a pure view model (`lib/focus-model.ts`); no source-specific logic lives in the UI. The board is derived from authoritative sources on demand. It stores no duplicate board state and never renders reasoning/thinking events, fabricated progress percentages, or raw tool output.

The global page uses the stable public `app.slots.navPanel` surface and `useBbNavigate().toThread(...)`. `lib/global-model.ts` collapses normalized source cards into independent logical executions, derives attention only from explicit structured metadata, and removes resolved conditions automatically. It does not inspect assistant prose. Stale/no-activity warnings are intentionally omitted because current timestamps cannot prove a stall reliably.

## Sources

### BB

The built-in source observes the root thread, bounded descendants, workflows, delegations, plans, queue entries, tool activity, outputs, failures, model/provider, goal, context use, and timing through the public Plugin SDK.

Timeline reads are lazy. Opening one BB timeline performs a single Agent Board RPC backed by one bounded public `threads.timeline` request and one tightly allowlisted lifecycle-event tail. The normalizer emits safe execution, phase, tool, public-update, waiting/resumed, interaction, child, delegation, and proven model-selection events. It never requests reasoning event kinds and never renders `activeThinking`, raw tool results, terminal output, file contents, user/system/developer text, or raw event JSON.

### Redteam (optional)

When `bb-plugin-redteam` exposes the public `observability_snapshot` RPC (schema version 1), Agent Board calls it through the SDK 0.4.21-supported `bb.sdk.plugins.callRpc(...)` mechanism. `lib/redteam-source.ts` owns a small local Zod wire schema and normalizes the response into ordinary board cards with `source: "redteam"`; no Redteam module or DTO reaches React.

Redteam is optional. Missing/disabled/older plugins, `unknown_method`, malformed/partial responses, and RPC failures are isolated and never break the BB board. The adapter accepts only operational fields; prompt, reasoning, report, evidence, and raw tool-output fields are absent from its schema.

Pending real phases map to PLAN, the active phase/current operation maps to ACTIVE, and completed/failed/cancelled phases map to OUTPUTS. Actual model, tool, target, task, and activity appear only when Redteam supplied them. Findings remain compact aggregate metadata; there is no findings column.

Redteam timelines reuse the same public observability snapshot and generic UI. Older completed scans may retain only phase history; Agent Board says so instead of fabricating historical tool activity. The snapshot exposes only a bounded recent operation window.

## Realtime and polling

BB changes use the existing public thread lifecycle/entity stream, a 400 ms coalescing watcher, and the plugin's `agent-board-changed` frontend signal.

SDK 0.4.21 has no supported cross-plugin realtime subscription. BB changes therefore opportunistically re-check Redteam. After a snapshot discovers a queued/running Redteam scan, a server-side fallback probes that project/global snapshot every 3 seconds. Requests share the Redteam source's inflight guard and 1.5-second TTL and never overlap. Polling stops when observed scans are terminal or the watched lease expires. While the global page is mounted, one slow 20-second snapshot refresh discovers brand-new Redteam work that has no BB event; unmounting clears that timer. BB thread changes remain event-driven.

## Bounds

Core thread-scoped collection is capped at 24 threads, depth 4, 40 timeline segments/events, and short previews. Global collection makes one list request capped at 64 rows, displays at most 8 active and 6 recent executions, enriches at most 14 representatives with concurrency 4, and shows at most 8 attention items. Terminal attention expires from the dashboard after 24 hours. Execution Timeline reads at most 80 source segments plus 80 allowlisted lifecycle events and returns 50 events by default, never more than 80; summaries are capped at 360 characters and targets/commands at 240. Older omitted activity is labeled. Its process-local cache is capped at 24 entries. The Redteam adapter accepts at most 10 scans, 7 phases per scan, 4 operations per scan, and 60 normalized cards. Focus-mode recent activity is bounded to 6 entries per execution. All caches are ephemeral and discardable.

## Motion and accessibility

All focus-mode motion is restrained CSS driven by state changes only: a 1.8 s opacity/shadow pulse on the active node, a 500 ms one-shot connector sweep when the active step advances, an indeterminate strip only while work executes, 250 ms crossfades for changing activity lines and new rows, and one-shot completion/failure accents. There are no requestAnimationFrame loops and no timer storms. Both `prefers-reduced-motion: reduce` (OS setting) and the `data-motion="reduced"` attribute (rendered from `matchMedia`) disable every animation; state is always legible from text, glyphs, and status chips, never color or motion alone.

The shared Timeline uses the existing responsive dialog/drawer primitive. Rows are stacked rather than tabular, the scroll region is keyboard-focusable, controls receive coarse-pointer sizing on phones, and new events auto-follow only while the reader stays near the bottom. Scrolling upward pauses follow mode and offers **Jump to latest**.

## Compatibility

- BB engine: `>=0.40`
- Runtime Plugin SDK floor: `>=0.4.21`
- Current development types: 0.4.34

Server modules use relative imports and avoid `@/` aliases so the BB 0.40 daemon loader can load source when artifact SDK versions differ. Newer lifecycle names are registered opportunistically, and missing newer thread fields degrade gracefully.

## Commands

```bash
bb agent-board show <thread-id>
bb agent-board show <thread-id> --json
```

## Develop and verify

```bash
npm test
npm run typecheck
bb plugin build
```

The Vitest suite includes a public-SDK-only scan that rejects private `@bb/*` dependencies and package-escaping imports.

## Install or reload

```bash
cd bb-plugin-agent-board
bb plugin install . --yes
bb plugin reload agent-board
```

Open **Agent Board** in BB navigation for the global dashboard, or open a thread panel and select the **Agent Board** action. Global attention, active work, and recent sections stack vertically on mobile; active cards use a two-column grid only from the `md` breakpoint.

## Optional Ollama Fleet workers (0.6.0)

Agent Board consumes only Fleet's public `fleet_observability_snapshot` RPC
through `bb.sdk.plugins.callRpc`, with its own Zod schema in `lib/fleet-source.ts`.
Fleet may be absent, disabled, older, unavailable, or return malformed data;
BB and Redteam collection continues. Fleet source/types/storage are never imported.

The adapter requests at most 20 jobs. Exact thread/project origin links workers
to their parent; a null origin becomes a standalone Fleet execution. The scoped
board shows at most eight workers per parent. One active worker receives the
delegated-work focus view; multiple active workers use individual live Kanban
cards. Selecting a model is active work, not a queue. Actual model and friendly
server names are shown only when supplied by Fleet.

Global Active Work counts logical parent executions. Linked workers add a
compact list (four visible, +N overflow), without replacing the parent's model
or creating extra global Recent rows. Linked failures stay in scoped details;
the parent's outcome controls global attention. Orphan failures can create one
standalone attention item. Parent tool events remain operational activity, not
extra worker cards. If the bounded BB page omits a known active parent, jobs
remain grouped under their exact origin thread as `BB delegated work`.

Execution Timeline includes route delegation/start, actual-model observation,
and terminal lifecycle events. Fleet v1 has no model-selection timestamp or
per-attempt history: model observations use `updatedAt`, labelled as recorded
actual model, rather than inventing an earlier selection time. No inference
tool history is fabricated. Worker activity never becomes latestPublicUpdate.
Prompts, responses, reasoning, unknown fields and server URLs are excluded from
worker records; display strings and errors are redacted/bounded (120/360 chars).

All views share a Fleet cache and one physical inflight request. Idle cache TTL
is 20 seconds, matching the existing global discovery cycle. New route-tool
activity can refresh discovery at a bounded two-second TTL. Once active jobs are discovered,
one 2.5-second loop polls regardless of job count, stops at terminal state or
source failure, and expires unused watches after 90 seconds. No idle Fleet timer
is created. Meaningful changes invalidate board/timeline generations and publish
Agent Board's normal signal. Invalidation during a source read discards its
result and retries sequentially; stale RUNNING cannot re-enter the cache.

SDK 0.4.34 has no server-side cross-plugin signal subscription or callRpc abort
parameter. Consumer waits are capped at 1.5 seconds, but a timed-out physical
request is retained until settlement to prevent overlapping retries. Source
failures show no stale workers and recover on normal discovery. A truncated
20-job Fleet snapshot can omit workers; scoped/global views report partial data.

Reinstall locally with `bb plugin install .`
after installing Fleet. Tests include the public-SDK-only dependency scan.
