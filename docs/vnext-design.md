# Phase 1 design (unreleased)

Base: main, 92efdcdf89b838713dac7ebc9fc2eaef9e4b8860, plugin 0.6.1.
Development branch: feature/agent-board-vnext. This is an unpublished
release candidate. Stable installation and publication require separate approval.

Reuse the public SDK collectors, normalized cards, bounded caches, lifecycle
watcher, optional Fleet/Redteam adapters and React hooks. Codex/Grok observation
is mediated by BB threads/providers; there are no provider session-file watchers.
Preserve LiveStrip, its CSS, reduced motion, source privacy and collection caps.

Add pure dashboard derivation for freshness, filters/grouping and completion
sections. Freshness uses source activity timestamps rather than fetch times or
thread updatedAt (which can include cosmetic changes). Old observations mean
quiet reporting, never failed/stalled work. Verification extracted from labeled
output remains agent-reported, not independently verified. Full output remains
accessible in BB through Open; the plugin keeps its bounded sanitized preview.

Enrich global executions with project names/git remotes using bounded public
projects.get calls for observed project IDs. Missing metadata is explicit and
must not prevent native observation. Filter only the already bounded snapshot;
the page states that matching sessions outside that window are not searched.
Attention stays visible independently of execution filters.

Separate transport connection, successful snapshot refresh and server watcher
health. Record timestamps and generic error categories only. Quiet connections
are not errors. Catch asynchronous watcher errors and failed publication instead
of leaking rejected promises; expose degradation in the snapshot.

Add a small version-keyed release dismissal store using plugin KV and bundled
release highlights. Use the package version as the single version source. A
release-notes control remains available after dismissal; storage failures stay
visible. No network, account, telemetry or external release fetching.

Automated validation uses the official SDK fake server/app hosts, synthetic
data, separate dependencies and isolated storage. Real provider checks use a
verified separate BB data directory and loopback ports; never install a preview
into the production host. See [testing](vnext-testing.md) and
[candidate validation](validation-0.7.0.md).
No Lattice runtime integration or future orchestration/analytics is added.
