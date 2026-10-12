# Agent Board 0.7.0 compatibility and upgrade notes

The current PR source is **0.7.0**, prepared but unpublished. Do not install it
over a stable installation as part of release review. The public 0.6.1 tag remains
the existing released installation until a separately approved publication.

## Compatibility

The package declares BB `>=0.40` and public Plugin SDK `>=0.4.21`.
BB **0.46.0** is the recommended runtime, also the latest published `bb-app`
version checked during this review on 12 October 2026. The development/test SDK
remains pinned to **0.4.34**. The BB 0.40.0 builder stamps SDK 0.4.21; the
BB 0.46.0 builder stamps SDK 0.6.37. These are different roles: the development
pin supplies types/test harnesses, while BB builds and supplies runtime shims.
The SDK and production dependencies are unchanged; development Hono, Undici and
source-map-js received compatible patch fixes. No BB/SDK compatibility range was
narrowed. See [dependency assessment](dependency-security-0.7.0.md).

Phase 1 adds one BB SDK read, `projects.get`, using `name` and `gitRemoteUrl`.
Both fields and that method exist in SDK 0.4.21. Project lookup is optional,
bounded, cached and failure-tolerant. New announcement RPCs use existing plugin
RPC and KV storage APIs. Existing realtime, navigation and lifecycle APIs are
reused. No new permission/capability declaration, migration, provider access
or external service is required.

A disposable BB 0.40.0 runtime built, installed and served the preview.
Candidate checks are detailed in the [validation summary](validation-0.7.0.md). A source-only
typecheck against SDK 0.4.21 reports eight references to the newer optional queue
`waitingOn` field; the unchanged 0.6.1 source reports the same eight errors.
Those accesses already tolerate an absent field at runtime. New Phase 1 API
uses pass that static comparison. This is not a claim that the full development
suite runs on the oldest SDK harness.

BB 0.40.0 could not refresh today's community catalog because it accepts at
most 256 entries. Direct local plugin installation and RPC smoke work; use
BB 0.46.0 for current marketplace discovery. Fresh Linux graphical-browser and
physical-device checks remain limited. The RC subsequently passed Windows
automated/build and browser/live-provider validation; prior Linux live-provider
coverage applies to the same reviewed runtime source. See the validation summary
for the distinction between fresh and historical checks.

Fleet >=0.6.0 is optional. Redteam is optional and must actually expose
`observability_snapshot` schema version 1; a version number alone is not enough.
The installed local Redteam 0.7.2 does not expose it and correctly remains unavailable.

## Existing users

Agent Board keeps the same plugin identity (`agent-board`). Existing settings
and attention-dismissal storage are retained; no manual migration or reset is
needed. The new release-dismissal preference is separate and version-specific.
The current announcement appears when upgrading from 0.6.1 or skipping earlier
releases. Missing/malformed dismissal storage shows the announcement again;
storage read/write failures are surfaced. Only the latest 20 dismissed versions
are retained. Bundled notes can be reopened after dismissal.

After final approval and publication only:

```sh
bb plugin install git:https://github.com/aaronphifer/bb-plugin-agent-board.git@^0.7.0
```

Reinstalling the same identity through BB replaces its source while retaining
plugin preferences; do not remove/uninstall first, because removal deletes
plugin storage. Exact tag/commit installations stay pinned. `^0.6.1` permits
0.6.x but excludes 0.7.0. Changing the marketplace entry to `^0.7.0` affects new
selections, not the selector already stored by an existing installation.

BB checks managed Git/npm installations for compatible updates and presents
them for an explicit update action. Path/builtin sources are pinned. Stable
semver ranges exclude prereleases unless the range explicitly names one.
Agent Board's What's New appears after installing a new version; it does not
discover remote releases, send push notifications or install updates itself.
