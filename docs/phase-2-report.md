# Agent Board Phase 2 — Redteam observability

Phase 2 adds optional live execution observability for `bb-plugin-redteam` while preserving Agent Board's generic normalized-card architecture.

## Public integration

Redteam now exposes `observability_snapshot({ projectId?, limit? })` through its public RPC contract. The response is schema version 1 and contains bounded scan identity/state, seven real lifecycle phases, up to four ephemeral current/recent operations, actual selected model, dispatch-time tool lifecycle, deterministic candidate/finding aggregates, timing, summaries, and redacted errors. The server caps scans at 10 and every free-text field has a strict limit.

The API never includes prompts, reasoning, model responses, raw tool output, evidence, report bodies, finding bodies, stack traces, secrets, credentials, or arbitrary file contents. Candidate and finding counts are computed in SQLite without loading full bodies into the snapshot path. Tracker callbacks are failure-isolated from scan execution.

Agent Board calls this RPC with the SDK 0.4.21-supported `bb.sdk.plugins.callRpc`. `lib/redteam-source.ts` defines its own forward-compatible Zod wire schema, then emits only generic `BoardCard` objects tagged `source: "redteam"`. React has no Redteam DTO dependency.

## Mapping

- Pending reconnaissance/code-review/web-testing/verification/reporting phases → PLAN / QUEUED.
- Running phase/current operation → ACTIVE AGENTS. Actual model, tool, target, task, activity, and elapsed time render only when supplied.
- Completed/failed/cancelled phases → OUTPUTS / DONE, with deterministic summaries and compact candidate/finding counts.
- The board includes every active scan plus the newest terminal scan; it does not dump historical reports or add a findings column.

## Refresh behavior

Cross-plugin realtime subscription is unavailable on the live SDK. Existing BB invalidations opportunistically refresh all sources. Once a queued/running Redteam scan is discovered, one server-side project poll runs every 3 seconds with a 1.5-second source TTL and shared inflight request. It stops at terminal state or after the watched board's 90-second TTL. There is no idle discovery poll.

## Live BB 0.40 / SDK 0.4.21 observations

Authorized fixture: project `example-project` (`/tmp/example-project`).

- Completed scan `example-scan-id` ran in 85.9 seconds.
- Reconnaissance appeared ACTIVE with actual `qwen3:8b`, then DONE at 21.1 seconds with `1 entry point; 1 web app`.
- Code review appeared ACTIVE with actual `qwen3:8b`; latest activity advanced to `Completed read_file`; it finished at 55.1 seconds with `1 candidate`.
- Static web testing completed truthfully at 0 ms with `0 candidates`.
- Verification completed at 9.7 seconds with `0 confirmed; 1 inconclusive; 0 rejected`.
- Reporting completed with `Report generated · 1 candidate · 1 inconclusive`.
- No duplicate keys, stale active cards, raw output, or reasoning text appeared.
- A second authorized run was cancelled during code review. Active polling made two snapshot calls in seven seconds, then the phase rendered as interrupted with the public stopped-by-user error.
- The generic BB root failure card remained present beside Redteam cards, proving source coexistence and failure isolation.

The existing responsive grid remains unchanged: three columns at `md` and above, vertical stacking below `md`, with no new wide controls or tables.
