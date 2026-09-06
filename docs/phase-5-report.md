# Agent Board Phase 5 — Execution Timeline

Phase 5 adds one reusable, read-only execution timeline to the global operations dashboard and thread-scoped Agent Board. Agent Board remains an observer and navigator: Timeline adds no approve, retry, stop, restart, spawn, or dispatch controls.

## Lazy architecture

`execution_timeline` is the sole Timeline RPC. No card or dashboard summary fetches Timeline data. Opening a BB timeline performs one bounded `threads.timeline` request and one parallel, tightly allowlisted `threads.events.list` request. Opening a Redteam timeline reuses a fresh public `observability_snapshot` when available, otherwise makes one public Redteam snapshot RPC. React consumes only the generic normalized contract.

Active results use a 1.5-second disposable cache; terminal results use 60 seconds. The cache has a 24-entry insertion-order cap, same-generation requests coalesce, and generation checks prevent pre-invalidation requests from repopulating fresh cache state. The open dialog follows the existing `agent-board-changed` signal and reconnect reconciliation. A signal burst during an in-flight request becomes exactly one trailing read. Completed timelines stop following signals. There is no Timeline poll or CSS-timer fetch.

## Semantic model and bounds

Each event carries stable identity, execution/source/thread identity, timestamp, a small operational kind, status, title, optional safe summary/model/tool/target/phase/duration/attention metadata, and source identity/sequence only. No raw source row is retained.

Supported kinds are execution start/complete/fail/interruption, phase start/complete/fail, proven model selection, tool start/complete/fail, public assistant update, waiting/resumed, approval/question request, child start/complete/fail, and delegation. Deterministic source fingerprints collapse duplicate logical transitions; source-row identity preserves distinct tool calls. Events sort oldest-to-newest with stable sequence and ID tie-breakers.

BB reads at most 80 timeline segments and 80 allowlisted lifecycle events. The RPC returns 50 normalized events by default and at most 80, with 360-character summaries and 240-character targets/commands. Truncation is explicit. Historical pagination and infinite scrolling are intentionally deferred.

## Privacy and source truth

Public updates come only from assistant-role conversation rows. Fenced code blocks are removed, credentials are redacted, whitespace is collapsed, and text is bounded. User, system, developer, reasoning, thinking, tool-output, command-output, file-content, and raw-JSON fields never enter the returned model. Tool rows expose only safe operational names, allowlisted targets, status, and duration.

BB model events are emitted only from public resolved execution options on `client/turn/requested`, provider fallback selections, and observed workflow-agent models. The normalizer reads only the resolved model field from turn requests and discards their input; configured thread defaults are not relabeled as actual. Waiting and resumed events require structured interaction, provisioning, interruption, or reconnect state—never prose inference.

Redteam normalization uses only its existing public snapshot. It emits scan, real phase, actual-model, and retained operation milestones. Completed scans without retained operations render truthful phase-level history with an explanatory warning. Agent Board does not fabricate older operation details.

## UI and limitations

The shared responsive dialog becomes a mobile drawer below the existing compact breakpoint. Timeline rows use timestamp, icon plus text label, title, and at most a few bounded detail lines; there is no table or horizontal log surface. The scroll region is keyboard-focusable. Reduced motion removes row/live animations while preserving textual state. Live updates auto-follow only near the bottom; scrolling upward pauses follow behavior.

Ollama Fleet delegated workers remain represented only by the parent thread's `ollama_fleet_route` tool event because Fleet does not expose each worker as a supported Agent Board execution. Timeline does not invent worker cards or lifecycle events. Notifications, persistent history, historical pagination, and Fleet-worker integration are outside Phase 5.
