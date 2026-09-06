# Agent Board — Phase 1 Report

Plugin: `bb-plugin-agent-board` (standalone repo at `/home/user/bb-plugin-agent-board`)
Scope delivered: live kanban-style observability board for the current thread tree —
plan steps, queued messages, active agents, delegations, and outputs — rendered in the
thread panel via `app.slots.threadPanelAction`, with a `bb agent-board show` CLI and two
schema-validated RPC methods. Public plugin SDK only (`@get-bb/plugin-sdk` 0.4.34);
enforced by `experimental_scanPublicSdkOnly` in the test suite. Nothing committed, nothing
installed; the repo is the working tree only.

---

## 1. Files changed / created

Plugin logic (all new; the vendored `components/ui/*` tree, `lib/utils.ts`, `lib/portal-scope.ts`,
`hooks/useBrowserDimmingModal.ts` and `skills/example-todos` come from the `bb plugin new`
scaffold and are untouched except where noted):

| File | LOC | Role |
|---|---|---|
| `contract/rpc.ts` | 182 | Zod DTOs (`BoardCard`, `BoardRoot`, `BoardCounts`, activity payload), `rpcContract` with `board_snapshot` + `board_activity`, realtime payload schema, `BOARD_CHANGED_CHANNEL` |
| `lib/board-model.ts` | 148 | `BOARD_LIMITS` (bounds), column mapping, `countCards`, `previewText`, `formatElapsed`, `cardElapsedMs`, reasoning/event-kind tables |
| `lib/bb-source.ts` | 812 | Pure normalizer: structural wire DTO types derived from `BbPluginApi`, `threadBoardStatus`, `normalizeThread`, plan/workflow/delegation/queued-message cards, `activityFromEvents`, goal/root summaries; `source: "bb"` discriminator on every card |
| `lib/collect.ts` | 371 | `BoardCollector`: TTL caches (children 1s, timeline 2s, events 2s, output 3s, model 60s, providers 60s, snapshot 1.2s), inflight coalescing, bounded BFS child walk, delegation index, `invalidate()` |
| `lib/watch.ts` | 316 | `BoardWatcher` + `attachWatcher`: `bb.events` lifecycle → `bb.sdk.subscribe("thread:changed")` relevance filter, 90s watched-roots TTL, project pre-filter, rate-limited parentage lookups (2s), 400ms debounced publish |
| `hooks/useBoard.ts` | 136 | `useBoard(rootThreadId)`: `useRpc` fetch, `useRealtime(BOARD_CHANGED_CHANNEL)` refetch, reconnect reconcile, fresh-refresh support |
| `components/board/board.tsx` | 246 | Three-column board shell, header (root title, status, goal + budget, model, ctx bar, live dot, Refresh), partial notice, loading/error/empty states |
| `components/board/board-card-view.tsx` | 216 | Card renderer: status chip, meta line, output/activity previews, expandable details, Open (navigate) + Details actions |
| `components/board/status-chip.tsx` | 44 | Color-coded status chip (running/queued/waiting/completed/failed/interrupted/idle) |
| `server.ts` | 127 | RPC registration (`board_snapshot`, `board_activity`), CLI `bb agent-board show [--json]` with `renderText`, watcher attach + invalidate, `onDispose` |
| `app.tsx` | 38 | `definePluginApp`, `threadPanelAction` slot registration, passes `rootThreadId` into `<Board/>` |

Tests (all new, 2,084 LOC):

| File | Tests | Coverage |
|---|---|---|
| `tests/board-model.test.ts` | 14 | Column mapping incl. plan-step pinning, counts, preview truncation, elapsed formatting |
| `tests/bb-source.test.ts` | 25 | Thread/workflow/delegation/plan/queued normalization, presentation labels, error previews, reasoning exclusion at source |
| `tests/collect.test.ts` | 16 | Snapshot assembly, TTL/inflight caching, invalidation, bounded caps (24 threads, depth 4 + `partial`), queued-message rules, activity clamping |
| `tests/watch.test.ts` | 15 | Relevance filtering, cosmetic/reasoning-only suppression, broadcast handling, rate limiting, debounce, TTL pruning, dispose |
| `tests/server.test.ts` | 11 | RPC schema validation via `callRpc`, registrations, realtime publish + coalescing, CLI text/JSON, usage errors, dispose |
| `tests/app.test.tsx` | 13 | Slot registration, per-column placement, partial notice, realtime refetch + malformed-signal defense, reconnect reconcile, loading/error/empty, navigation |
| `tests/public-sdk.test.ts` | 3 | `experimental_scanPublicSdkOnly`: zero violations, zero private dependencies, scanner effectiveness proof |

Support: `package.json` (scripts `test`/`typecheck`; vitest 5, jsdom 30, @testing-library/react 16 in devDependencies), `tsconfig.json` (tests included, `@/` alias), `vitest.config.ts` (alias + per-file jsdom for the app test).

## 2. Architecture

```
bb.events (thread lifecycle)
        │  parent/child/status signals
        ▼
BoardWatcher (lib/watch.ts)          bb.sdk.subscribe("thread:changed")
  - relevance filter (ignore cosmetic/reasoning-only)
  - project pre-filter + rate-limited parentage lookups
  - 90s watched-roots TTL, 400ms debounce
        │  invalidate(rootId) + publish BOARD_CHANGED_CHANNEL {roots}
        ▼
BoardCollector (lib/collect.ts)                 ▲
  - TTL caches per SDK call, inflight coalescing │ refetch({fresh})
  - bounded BFS walk (≤24 threads, depth ≤4)     │
  - delegation index, events tail, output tail   │
        │ BoardSnapshot DTO                      │
        ▼                                        │
board_snapshot / board_activity RPC ◀── zod contract (contract/rpc.ts)
        │                                        ▲
        ▼ useRpc/useBoard                        │
Board component tree (components/board/*) ───────┘
  slot: app.slots.threadPanelAction
```

Design rules honored: no durable persistence (ephemeral TTL caches only — a reload simply
re-fetches), bounded retrieval everywhere (`BOARD_LIMITS`), single source of truth for the
wire shape in `contract/rpc.ts`, pure normalization in `lib/bb-source.ts` behind a `source`
discriminator (Redteam/other sources can extend later), and `rootThreadId` passed into the
`Board` component so future surfaces (sidebar page, CLI-only) reuse it unchanged.

## 3. What the rendered board shows

Header: root thread title + status chip; goal objective with token-budget share; provider
· model line; context-window bar; live-connection dot; Refresh button (bypasses server caches).

Three columns:

- **PLAN / QUEUED** — plan/todo steps (pinned here regardless of step status, showing
  pending/active/done state), queued-message cards (the actual waiting prompts, max 3),
  and any child threads whose status is queued/waiting (e.g. "Waiting for scheduled time").
- **ACTIVE AGENTS** — root and child thread cards that are running, plus `activeWorkflows`
  agent cards (per-agent title, elapsed, model, current activity from tool rows).
- **OUTPUTS / DONE** — completed/idle/interrupted/failed threads, delegation cards (delegated
  prompt + returned output preview), and error states surfaced with a red chip plus a
  short error preview.

Every card: status chip, title/meta line, elapsed (`formatElapsed`), tokens/tool-calls when
known, latest activity or output preview (240-char cap), expandable Details (fuller activity
timeline, preview text), and an **Open** button that navigates to the thread when the card
has a `threadId`. A "truncated" notice appears when the thread cap, depth cap, or segment
caps were hit (`partial: true`). Model reasoning is never rendered: `item/reasoning/*` event
types are excluded in the normalizer, the collector, and the watcher's relevance filter,
and tests prove a reasoning-heavy timeline yields a reasoning-free snapshot.

## 4. Live data sources per card field

| Card field | SDK source |
|---|---|
| threadId, title, status, providerId, timestamps, waitingOn | `bb.sdk.threads.get(root)` + `threads.list({parentThreadId})` walk |
| provider label | `bb.sdk.providers.list()` (matched by providerId) |
| model | `bb.sdk.threads.defaultExecutionOptions({threadId})` |
| goal, token budget, context window | `threads.timeline` → `goal`, `timelinePage`, token accounting |
| plan/todo steps | `threads.timeline` → `pendingTodos` / plan step rows |
| workflow agents | `threads.timeline` → `activeWorkflows[].agents` |
| current activity (e.g. "Editing src/auth.ts") | timeline work rows (command/file tool rows), newest first |
| queued messages | `bb.sdk.threads.queuedMessages.list({threadId})` |
| delegations | timeline rows with delegation info, enriched by the delegation index (child `threads.get`) |
| output preview | delegation output ?? `threads.output({threadId})` for idle children |
| error preview | `threads.events.list({order: "desc", limit: 40})` tail for failed threads |
| latest activity | `threads.events.list` tail mapped via `activityFromEvents`, clamped to 40 rows / 160 chars |
| refetch triggers | `bb.events` thread lifecycle + `bb.sdk.subscribe("thread:changed")` → `BOARD_CHANGED_CHANNEL` |

## 5. Test / build results

- `npm test` (vitest): **7 files, 97/97 passing** (~3.4s) — includes jsdom-rendered app tests via `loadPluginApp`/`renderSlot` and server tests via `createFakePluginHost` with real-timer watcher waits.
- `npx tsc --noEmit`: **clean** (strict; tests included).
- `bb plugin build`: **success** — `dist/server.js` (768 KB) + map + meta, `dist/app.js` (570 KB) + `app.css` + meta, built with bb 0.41.0 against SDK 0.4.34, `sdkMajor 0`.
- `experimental_scanPublicSdkOnly`: **zero violations, zero private dependencies** (allowlist documents the sanctioned non-SDK imports: react/react-dom shims, `@/` package-local alias, radix/clsx/tailwind-merge/class-variance-authority shims, @hugeicons icon deps, vitest/config; a built-in sanity test proves the scanner still flags private `@bb/*` imports and escaping relative paths).
- Reasoning-denylist: three independent test layers assert no `item/reasoning/*` text reaches a card, activity list, or snapshot.

## 6. API limitations encountered

- Wire DTOs (thread rows, timeline rows, queue entries) are not individually exported — `lib/bb-source.ts` derives them structurally from `BbPluginApi["sdk"]`, so SDK upgrades surface contract drift at typecheck time (by design).
- `bb.sdk.subscribe` realtime types are not exported either; `tests/server.test.ts` derives args via `Parameters<BbPluginApi["sdk"]["subscribe"]>[0]`.
- `FakeSdkOverrideTree`/`LooseStub` contextual typing does not flow into inline object literals under spreads; test stubs annotate real derived arg types (`Parameters<...>`) rather than relying on inference.
- `bb.events.on` is lifetime-bound (no unsubscribe handle); disposal relies on the plugin `onDispose` hook and stale-handle errors are asserted in tests.
- `Button` has no `title` prop — tooltips fall back to `aria-label`/native title attributes on spans.
- The thread panel action slot is the only v1 surface; the component was kept surface-agnostic (`rootThreadId` prop) for reuse.
- Depth/thread caps mean very large trees are `partial`; the frontier probe costs one extra `childrenOf()` call per frontier thread to keep `partial` honest.

## 7. Install / reload instructions (for live validation)

```bash
cd /home/user/bb-plugin-agent-board
bb plugin install .          # path install; builds dist/ automatically
# (re)load in a running bb: the daemon reloads the plugin on install;
#  verify with:
bb agent-board show --json   # CLI against the current/default thread, or pass --json
#  then open any thread panel in the bb UI and use the "Agent Board" thread
#  panel action (ListTodo icon) — board opens for that thread's tree root.
```

Reload after edits: `bb plugin build && bb plugin install .` (or `bb plugin dev` for
readable dev bundles). No commit, tag, or publish was performed; the repo remains a
working tree with no git history.

Suggested smoke test against the live session thread `example-thread-id` (provider "pi"):
open its panel, launch the Agent Board, confirm the root card + model line, spawn a child
thread (delegation) and watch the ACTIVE AGENTS column update within ~1–2s (watcher
debounce + TTL caches), then complete it and see it move to OUTPUTS / DONE.

## 8. Redteam integration recommendations (Phase 2+)

1. Keep the `source` discriminator the extension seam: add `source: "redteam"` cards by implementing a second normalizer against Redteam's own SDK surface and merging into `BoardCard` — no changes to the board UI needed.
2. Reuse the collector's TTL + inflight pattern for Redteam findings (they change slowly; a 60s cache like the provider cache is appropriate).
3. Surface findings as a fourth column or as chips on affected thread cards (finding severity → chip color) rather than new card kinds, to keep the three-column mental model.
4. For live rule/finding events, subscribe to Redteam's own channel and route through `BoardWatcher.invalidate()` the same way — one publish path, one refetch path.
5. Consider a "Redteam" filter toggle in the header instead of separate boards; the `counts` DTO already supports per-status totals that can host per-source counts later.