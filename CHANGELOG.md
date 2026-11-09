# Changelog

## 0.7.1 — 2026-11-09

- Add Reply, Review approval and Inspect failure actions with the reported
  question or request and its age.
- Review completed work with its objective, observed changed files, reported
  links and checks. Distinguish finished turns from completed goals and
  independent verification.
- Expand observed child agents and show meaningful tool/target summaries.
- Add a since-you-last-checked digest, browser-persisted filters and up to eight
  saved dashboard views.
- Refine card spacing, restrained status edges, operation text and compact
  expandable results. Preserve the indeterminate running strip and reduced motion.
- Fix timeline scrolling and add incremental earlier-history loading, stable
  event merging, preserved scroll position, reconnect gap bridging and retries.
- Add release discovery and a review/confirm flow for BB-eligible updates.
  Out-of-range and pinned sources remain advisory; source ranges are never widened.
- Correct stale release and upgrade documentation.

No storage migration or reset is required. Existing `^0.7.0` selectors include
this release. Earlier-history loading depends on BB retention and source APIs;
optional Fleet and Redteam history remains bounded. See
[daily monitoring](docs/daily-workflow.md) and
[release validation](docs/validation-0.7.1.md).

## 0.7.0 — 2026-10-12

- Show the latest observed public activity and distinguish recent from quiet
  reporting, without changing task status or the indeterminate activity strips.
- Add structured completion outcome/result/failure sections, explicitly labeled
  agent-reported verification and access to the original bounded output preview.
- Filter and group the bounded dashboard by project, repository, provider and
  status. Project metadata lookup is optional, bounded and credential-safe.
- Separate transport connection, refresh/change timestamps and watcher health.
  Contain watcher callback/publication errors and surface degraded monitoring.
- Reduce empty Needs attention to a compact line; actionable items remain visible.
- Add bundled What's New highlights with per-version local dismissal and a
  persistent Release notes control. This version did not fetch remote releases.
- Retain explicit result/check labels before truncating the original output preview.
- Qualify cached watcher health when disconnected, a refresh fails or becomes overdue.
- Keep terminal duration unknown when the source supplies no completion timing.
- Bound package contents to runtime source, assets and user documentation;
  exclude tests, validation helpers, reports and temporary evidence from npm packs.
- Make public-SDK test paths portable to Windows and use a serial Vitest thread
  pool for reliable startup on the development laptop.

- Add Node 24 Ubuntu/Windows PR tests/typecheck and an Ubuntu official build/package gate.
- Patch Hono, Undici and source-map-js development dependencies; the updated graph audits clean.
- Prebundle the large icon data dependency in Vitest without relaxing hook limits or mocking the UI.

No storage migration or settings reset is required. BB >=0.40 and SDK >=0.4.21
remain declared; BB 0.46.0 is recommended. See [upgrade notes](docs/upgrade-0.7.0.md)
and [release convention](docs/release-convention.md). Version 0.7.0 was published on 12 October 2026.

## 0.6.1 — first public beta

- Fix managed Git installation when BB omits development dependencies: keep the
  shared RPC contract SDK import type-only while preserving schema inference.
- 0.6.0 remained an unpublished release candidate.

Dates are omitted because these milestones were local development commits.
0.6.1 is the first public beta; 0.6.0 remained unpublished.

## 0.6.0
- Optional Ollama Fleet public observability integration.
- Release documentation, MIT license, third-party notices and safe examples.

## 0.5.1
- Constrained the global dashboard layout on mobile.

## 0.5.0
- Bounded execution timeline.

## 0.4.1
- Terminal-state reconciliation, latest public updates and attention dismissal.

## 0.4.0
- Global operations dashboard and Needs Attention.

## 0.3.x
- Automatic single-agent focus and live motion in multi-agent views.

## 0.2.0
- Optional Redteam public observability.

## 0.1.0
- Initial live Agent Board.
