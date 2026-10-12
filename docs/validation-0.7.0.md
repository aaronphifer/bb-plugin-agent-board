# Agent Board 0.7.0 validation summary

Version 0.7.0 is prepared on the PR branch and is unpublished. These checks support development review, not
stable-release, marketplace or automatic-install approval. Detailed host-specific
reports, logs, synchronization manifests and live screenshots are retained
locally and excluded from the public commit.

## Stable preparation and CI

Release hardening patched the development Hono/Undici/source-map-js graph, which
returned zero npm audit findings. The development SDK/BB runtime/production
dependencies and animated activity source remain unchanged. A measured 100-second
Windows cold icon import was addressed by prebundling its real data-only module
without changing the 20-second hook limit or adding retries.

The [hardening CI run](https://github.com/aaronphifer/bb-plugin-agent-board/actions/runs/38289933214)
passed all three hosted jobs before stable promotion: Ubuntu and Windows full tests/
typecheck, and Ubuntu BB 0.46.0 full build plus actual package inspection. Stable
version tests/build/package checks run again before push and through the same
workflow on the new head. Inspect PR checks for their current result; historical
RC checks alone do not validate newly patched dependencies.

See [dependency assessment](dependency-security-0.7.0.md) and [testing](vnext-testing.md).

## Historical RC source and checks (12 October 2026)

At the RC review, before public-documentation cleanup, 134 source inventory hashes matched between
Windows and Pop!_OS. Public cleanup only changes documentation and one launcher's
missing-tools help message; plugin implementation, tests, animation, dependencies,
version and compatibility declarations remain the reviewed candidate.

| Coverage | Result and provenance |
| --- | --- |
| Windows full suite | 468 tests / 24 files passed. The first cold-import timeout was followed by an unchanged passing full rerun. |
| Windows adapter regression | 109 Fleet/Redteam tests / 6 files passed; a subset of the full suite. |
| Windows focused checks | 37 announcement, dashboard, JSON and public-SDK tests / 4 files passed; a subset of the full suite. |
| Windows typecheck / official build | Passed, BB 0.46.0 builder. Fresh frontend/backend metadata both identify the candidate. |
| Pop!_OS RC review | Independently passed 468 tests / 24 files, 109 adapter tests, typecheck and official build. |
| Minimum/current Linux runtime | BB 0.40.0 and 0.46.0 built, directly installed and served the RC in disposable hosts; RPC/app-asset/announcement smoke passed. |
| Production-only Linux install | Clean runtime dependency/source build and installation passed without the development SDK. |
| Actual Windows providers | Codex created and ran three Python unittests; Grok completed harmless delay/review tasks and explicitly reported tests not run. A controlled invalid-model failure appeared correctly. |
| Actual Linux providers | Earlier Linux validation ran Codex/Grok tasks and host recovery on the preview. Linux RC build/install/RPC smoke was checked separately. New inference tasks were not rerun in the independent Linux RC review. |
| Windows UI/storage | Monitoring health, saved attention preservation, version dismissal/reload/reopening, filtering/grouping, completion provenance, active animation, Open/Timeline and desktop/narrow rendering passed. |
| Package inspection | Fresh 68-file Windows package: correct plugin/version metadata, required runtime assets, unchanged dependencies and no test/runtime/credential data. |

Windows native BB worked in the inspected environment. This is empirical evidence,
not a claim of general native Windows host support. Codex's Windows sandbox
startup failures required scoped one-time approvals for the disposable fixture;
no authentication, persistent permissions or networking settings were changed.

The SDK 0.4.34 development pin differs from the builder SDK. A source-only
typecheck against the declared 0.4.21 floor finds eight existing optional queue
`waitingOn` typing errors, also present in unchanged 0.6.1. New Phase 1 SDK use
is present at that floor and optional at runtime. This does not claim the full
development harness runs against the oldest SDK package.

Nonempty live Fleet/Redteam coverage remains limited. Optional Redteam needs the
public schema-version-1 observability RPC; a version number alone is insufficient.
BB 0.40.0's community-catalog entry cap limits current marketplace discovery,
while direct installation works. Physical-device and fresh Linux graphical
browser coverage remain separate. Existing bounded-history and agent-reported
verification limits still apply.

See [testing instructions](vnext-testing.md), [compatibility/upgrade notes](upgrade-0.7.0.md),
[release notes](../RELEASE_NOTES.md) and [release procedure](release-convention.md).
