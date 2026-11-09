# Agent Board 0.7.1 validation

## Current local checks

Validated on Pop!_OS with Node 26.8.1 before release preparation:

- 505 automated tests passed, zero failures, including timeline pagination,
  reconnect gaps, lifecycle retry, saved views, catch-up and update confirmation.
- TypeScript passed. The BB frontend/backend build passed; both generated
  manifests identify Agent Board 0.7.1 and their actual builder metadata
  (BB 0.43.0, Plugin SDK 0.6.132).
- Actual package inspection passed: matching package/lockfile version, fresh
  bundles, runtime/document assets and no test, credential or local evidence files.
- Reloaded the existing local installation in BB 0.49.0. Agent Board reported
  version 0.7.1, running, with a compatible frontend; its release RPC returned
  the new title and highlights.

## Feature verification

The implementation at 87a0229 was exercised in the installed BB before the
version/highlight/documentation preparation:

- Six timeline requests returned 300 distinct events, with earlier history
  still available. Unit tests also cross the native BB source-page boundary.
- Desktop and 390-pixel mobile timelines had independently scrollable content.
  Loading 50 earlier events on mobile retained the visible event at the same
  offset; the document had no horizontal overflow.
- Desktop/mobile dashboard and history screenshots were inspected. Running
  strips retain their indeterminate animation; reduced motion remains supported.
- A fresh review found reconnect-window gaps and lifecycle-read failure handling.
  Both were fixed and covered by passing regression tests before this release.

## Scope and remaining checks

This is fresh Linux/local-browser evidence. Hosted Ubuntu/Windows release
validation must pass on the release pull request before merge/publication;
historical 0.7.0 Windows checks do not validate the new source. No fresh physical
Android test or nonempty live Fleet/Redteam execution is claimed.

BB history is limited to retained public operational events. Fleet and Redteam
still expose bounded snapshots. Results and checks are agent-reported, not an
independent certification. Existing package engine floors are retained; the
latest timeline/update APIs are optional and source capabilities may differ.

Git tags and GitHub releases are the publication authority. Local version
preparation and these checks alone do not mean a release has been published.
