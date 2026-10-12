# Changelog

## Unreleased — 0.7.0 (candidate 0.7.0-rc.1)

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
  persistent Release notes control. No telemetry or remote release fetching.
- Retain explicit result/check labels before truncating the original output preview.
- Qualify cached watcher health when disconnected, a refresh fails or becomes overdue.
- Keep terminal duration unknown when the source supplies no completion timing.
- Bound package contents to runtime source, assets and user documentation;
  exclude tests, validation helpers, reports and temporary evidence from npm packs.
- Make public-SDK test paths portable to Windows and use a serial Vitest thread
  pool for reliable startup on the development laptop.

No storage migration or settings reset is required. BB >=0.40 and SDK >=0.4.21
remain declared; BB 0.46.0 is recommended. See [upgrade notes](docs/upgrade-0.7.0.md)
and [release convention](docs/release-convention.md). This candidate is not published.

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
