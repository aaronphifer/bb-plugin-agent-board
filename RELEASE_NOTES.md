# Agent Board v0.6.1

First public beta: live execution observability for BB.

Includes the final Git-install fix: shared RPC schemas use a type-only SDK
contract, so BB can build from runtime dependencies without installing the
development SDK package. Version 0.6.0 was an unpublished release candidate.

- Open the global operations dashboard for active work, Needs Attention, and recent completion.
- Open a thread-scoped board with automatic single-agent focus and multi-agent views.
- Inspect active models, tools, public progress updates, and native BB thread/workflow execution state.
- Review attention states and persist presentation-only dismissals without changing the underlying execution.
- Open a bounded Timeline of operational events and lifecycle progress. Hidden reasoning is excluded.
- Observe delegated local jobs with optional Ollama Fleet >=0.6.0, including actual worker model/server summaries. Native BB observation works without Fleet.
- Use optional Redteam observability when available; Redteam is not required.
- Use responsive mobile layouts, keyboard controls, and reduced-motion support.

Requires BB >=0.40 and public Plugin SDK >=0.4.21; development types use SDK 0.4.34. This is a bounded latest view, not a persistent execution-history database. Source capabilities vary. System/push notifications are unavailable through the currently used public SDK. Current release validation includes emulated mobile; a fresh physical Android check is not claimed. README media uses clearly labeled synthetic data.

Install: `bb plugin install git:https://github.com/aaronphifer/bb-plugin-agent-board.git@v0.6.1`

MIT licensed. Report security issues privately through this repository's Security → Report a vulnerability form after publication activation.
