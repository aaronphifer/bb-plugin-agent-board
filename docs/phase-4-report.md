# Agent Board Phase 4 — Global operations dashboard & Needs Attention

Phase 4 adds a global, read-only operations page while retaining the existing thread-scoped panel. Both surfaces consume the same normalized BB and Redteam card contract. Agent Board remains an observer and navigator: it does not persist execution state, approve requests, retry work, or orchestrate agents.

## Public surface and collection

The global page is registered through the stable public `app.slots.navPanel` surface at `operations`. Thread navigation uses public `useBbNavigate().toThread(threadId)`. The existing `threadPanelAction` registration is unchanged.

`lib/collect.ts` implements one bounded global collector. A collection cycle performs one `threads.list` request capped at 64 visible/non-archived rows, groups related BB threads inside that bounded page, and enriches at most 8 live plus 6 recent logical executions. Representative enrichment is capped at four concurrent groups and reuses the existing provider/model and resource caches. The Redteam source independently contributes its already-bounded public snapshot; source failures are isolated with `Promise.allSettled` and stale disposable cache data may be shown with a partial/unavailable marker.

The pure `lib/global-model.ts` layer collapses source-normalized cards into generic execution groups, derives active and recent items, and calculates truthful summary counts. Global prompt previews are always cleared. Orphaned children in the bounded list remain visible as standalone executions rather than causing an unbounded parent lookup.

## Needs Attention

Attention is derived only from explicit structured state attached by source normalizers. The taxonomy is `action-required`, `failed`, `waiting`, `interrupted`, and `warning`.

- BB approval/question timeline records produce action-required attention.
- Structured host/reconnect waits produce waiting attention.
- Failed/error and stopping/interrupted thread, workflow, delegation, or agent states produce terminal attention.
- Redteam failed and cancelled/interrupted phase state produces corresponding attention.

There is no assistant-prose inference and no stale/stuck heuristic. One `executionKey + type` identifies an issue, so duplicate cards within one logical execution collapse deterministically. Resolution is automatic because each snapshot is re-derived from authoritative source state. Terminal attention older than 24 hours is omitted, and at most 8 items are shown. Operational text is redacted and bounded; attention wire messages are capped at 160 characters.

## Realtime and discovery

Existing BB lifecycle/thread events mark the global watcher dirty and publish the existing `agent-board-changed` signal with a global flag. Global and scoped caches share invalidation and inflight protection without forcing unrelated thread panels to refetch. Redteam's existing 3-second active-scan polling is reused for global active scans and stops on terminal state or lease expiry.

Because runtime SDK 0.4.21 has no supported cross-plugin realtime subscription and an unrelated Redteam scan may start without a BB event, the mounted global page performs one slow 20-second discovery check. It is guarded against overlap and stops on unmount. The existing one-second presentation timer runs only while live work is displayed so elapsed labels stay current; it causes no RPC by itself.

## UI, mobile, and accessibility

The page renders a compact summary, Needs Attention first, active execution cards, and a bounded recent list. Active cards reuse the shared LIVE dot and indeterminate strip from thread Kanban cards. Waiting and queued cards remain static. On mobile everything stacks vertically in attention/active/recent order; desktop uses a two-column active grid. Open is rendered only when a supported BB thread target is known.

Reduced-motion preference disables pulse and strip movement while preserving static status text and indicators. The page has no wide tables, horizontal-scroll dependency, notification behavior, or execution timeline. Reasoning, prompts, raw tool output, credentials, and unbounded report content remain excluded.

## Delegated local review

Repository reconnaissance and independent review used the public Ollama Fleet route with a local-only `qwen3-coder:30b` target. Delegated reports covered the public global surface, collector/cache reuse, structured attention states, bounded-collector compatibility, attention false positives/deduplication, and mobile/accessibility behavior. The main implementation verified important SDK declarations and rejected unsupported or inaccurate suggestions before editing.

## Runtime validation

Two tiny read-only BB child tasks ran concurrently under one parent and were observed as separate active cards with real model, command activity, elapsed state, and LIVE treatment. Both then completed and moved out of active state without duplicates. The existing Redteam snapshot was visible without running a new scan. The global plugin route returned HTTP 200, the scoped CLI snapshot remained operational, and plugin logs contained no handler errors on BB daemon 0.40.0 / runtime SDK 0.4.21.

The suite contains 258 tests. Typecheck, plugin build, and the public-SDK-only scan pass with zero private dependencies or violations.
