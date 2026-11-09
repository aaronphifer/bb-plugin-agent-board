# Agent Board v0.7.1

Catch up on agent work, act on requests, and browse earlier execution history.

- **Actionable attention:** Reply to questions, Review approval requests, and
  Inspect failures in BB's native surface, with the reported request and its age.
- **Completion review:** inspect objectives, observed files, reported result links
  and checks. A finished turn or completed goal does not imply independent verification.
- **Catch-up and saved views:** see changed outcomes since your last visit, retain
  dashboard filters in this browser, and save up to eight named views.
- **Observed agents:** expand child agents and native delegations with the
  status, model and output information the source actually supplies.
- **Subtle polish:** tighter cards, restrained status edges, clearer operations
  and compact expandable results. Running strips remain indeterminate.
- **Earlier timeline activity:** scroll through loaded events and select Load
  earlier activity for earlier BB pages. Loading preserves your place; live
  refreshes retain loaded history and bridge reconnect gaps. Failed loads offer retry.
- **Update available:** discover official GitHub releases and review/confirm
  updates eligible under BB's installed source and compatibility rules.

Existing `^0.7.0` Git installations can update to 0.7.1 through BB. Pinned tags,
commits and local paths stay pinned; `^0.6.1` excludes this release. Existing
clients receive the new update card only after installing this release. There
is no background auto-install, source-range widening or settings reset.

BB >=0.40 and public SDK >=0.4.21 remain declared; use a current BB for current
history and update APIs. Missing APIs degrade to the source's available view.
Fleet >=0.6.0 and Redteam's public observability RPC remain optional.
Earlier-history browsing covers BB's retained public operational events, not
hidden reasoning or an independent archive. Fleet and Redteam retain their
bounded snapshot limits. Saved views and catch-up state are browser-local.
The update check reads public metadata from this repository's GitHub release
endpoint without credentials; BB controls installation and rollback.

See [daily monitoring and limits](https://github.com/aaronphifer/bb-plugin-agent-board/blob/v0.7.1/docs/daily-workflow.md)
and [validation](https://github.com/aaronphifer/bb-plugin-agent-board/blob/v0.7.1/docs/validation-0.7.1.md).

# Agent Board v0.7.0

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

Release hardening adds hosted Node 24 Linux/Windows tests and typecheck, an
Ubuntu official BB build/package gate, and fixed development Hono/Undici/source-map-js
patches. See [dependency assessment](docs/dependency-security-0.7.0.md).

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
