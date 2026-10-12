# Agent Board v0.7.0 — draft release notes

Candidate: **0.7.0-rc.1**, unpublished and awaiting review. These notes are a
draft for the eventual 0.7.0 release.

Agent Board gives you a clearer view of live agent work and completed outcomes.

- **Activity freshness:** see the age of the latest public activity and whether
  reporting is recent or quiet. Long tasks keep their authoritative status and
  the existing animated activity bars.
- **Completion outcomes:** review results, failures and explicitly agent-reported
  checks in separate sections. Open the original thread or bounded timeline for details.
- **Filters and grouping:** organize visible work by project, repository, provider
  or status. Needs Attention and operational counts remain visible across filters.
- **Monitoring health:** distinguish transport connection, snapshot refresh and
  source-watcher health. Cached watcher status is qualified when it cannot be confirmed.
- **What's New:** read bundled version highlights, persist dismissal for that
  version, and reopen its notes from the dashboard. Empty Needs Attention is compact.

Reliability fixes preserve explicit result/check metadata before output truncation,
qualify cached health during disconnects and failed/overdue refreshes, and avoid
inventing elapsed duration for terminal tasks without completion timing.

Existing settings and attention dismissals are preserved. No manual data migration
or configuration change is required. BB >=0.40 and public SDK >=0.4.21 remain
declared; BB **0.46.0 is recommended**. Optional Fleet >=0.6.0 and a Redteam
runtime exposing the public observability contract remain optional.

BB installs tracking `^0.6.1` do not include 0.7.0. After publication, users must
select the new marketplace release or change their Git selector to `^0.7.0`.
Pinned tags/commits remain pinned. See [compatibility and upgrade notes](docs/upgrade-0.7.0.md).

Filters cover the bounded visible snapshot. Quiet reporting does not prove a
stall, and reported checks are not independent test evidence. Release notes in
the UI are bundled highlights; GitHub hosts the full release notes. There are
no new push notifications, automatic-install promises or Phase 2 features.

Candidate checks, coverage provenance and remaining limits are recorded in
[the validation summary](docs/validation-0.7.0.md). Detailed machine-specific
reports and live screenshots remain local development evidence.

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
