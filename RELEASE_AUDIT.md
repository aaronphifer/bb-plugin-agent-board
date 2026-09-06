# Phase 8 release audit — bb-plugin-agent-board

Audit date: 2026-09-05. Version: **0.6.0**, first public beta. No runtime product
code changed; documentation, licensing, packaging metadata and fixture hygiene only.

## Baseline and local release state

- Baseline HEAD: `ae384fd0c8e7acc616ea28118751beed1bcfa54c`; branch `main`; clean at start; no remotes.
- Expected implementation HEAD matched.
- Final local SHA: use the commit containing this audit (`git rev-parse HEAD`);
  the accompanying final response records the exact SHA. No tags or remotes created.
- Files changed: README, package metadata/lockfile, .gitignore; added LICENSE,
  THIRD_PARTY_NOTICES, DEPENDENCY_LICENSES, CHANGELOG, CONTRIBUTING, SECURITY,
  PLUGIN_OVERVIEW, RELEASE_AUDIT and PUBLICATION_PLAN. Removed the misleading
  scaffold `skills/example-todos/SKILL.md`, which advertised nonexistent commands.
- Also sanitized historical reports and path fixtures; added architecture documentation and safe demo screenshots.

## Public safety and repository hygiene

Tracked source, documentation, manifest, lockfile and historical revisions were
searched for credentials/private keys, URLs, emails, personal paths, private IPs,
run identifiers, databases, logs, dumps and screenshots. No real credential or
private key was identified. This is a bounded release audit, not a guarantee
that arbitrary strings can be classified perfectly.

| Classification | Finding / disposition |
| --- | --- |
| Harmless fixture/example | Redaction tests intentionally contain dummy Bearer/password/token values; retained. |
| Harmless fixture/example | Private-range IP literals in Fleet UI/CLI are generic endpoint examples, not discovered live endpoints; retained. |
| Harmless metadata | Existing Git authors use a GitHub noreply address; approved copyright name is public. |
| Should clean, resolved in current tree | Personal home paths, project/thread IDs and scan IDs in reports and tests replaced with safe placeholders. Historical reports retain observations, not private identifiers. |
| Blocker for pushing existing history | Old commits retain the original personal paths/run IDs. Do not push this branch's history. Use a reviewed clean-history export, or separately authorize historical-data publication/history cleanup. |

No node_modules, runtime databases, logs, cache directories, .env files, crash
dumps or temporary evidence are tracked. Local ignored dependencies/builds are
expected. Git source installation builds both bundles using declared runtime
dependencies; `dist/` remains intentionally ignored. This was verified in BB's
managed installer source, not inferred from scaffold README text. npm installs
require prebuilt artifacts and remain an optional future distribution channel.
No /tmp diagnostic artifacts are committed.

## Dependency and license audit

MIT approved for original code: **Copyright (c) 2026 Aaron Phifer**.
Package `license` and LICENSE agree; lockfile root metadata matches.
See [complete dependency inventory](DEPENDENCY_LICENSES.md) and
[third-party notices](THIRD_PARTY_NOTICES.md). Vendored BB/shadcn notices are
preserved. SDK npm metadata omits a license, but the declared upstream BB source
is MIT. Hugeicons' missing free-core notice is covered by the upstream MIT
clarification for free icons; no Pro pack is used. Development lightningcss is
MPL-2.0 and is not redistributed in this source release. No non-redistributable
dependency was identified. Both clean npm installs reported zero known advisories.

## Metadata and documentation readiness

Package name and version preserved; description now matches execution
observability/local Ollama positioning. MIT and relevant keywords added. No
repository/homepage/bugs URL or public contact was invented. Public GitHub owner
and private vulnerability reporting destination remain pending, so SECURITY.md
contains an explicit pre-publication TODO. Node 24.20.0/npm 11.19.0 verified;
no untested Node minimum added. README, CHANGELOG, CONTRIBUTING and marketplace
PLUGIN_OVERVIEW are prepared. No competitor comparison or major feature added.

## Compatibility matrix

| Surface | Declared minimum | Evidence |
| --- | --- | --- |
| BB | >=0.40 | Current clean-path installs and live RPC smoke passed on a daemon whose install-built frontend metadata reports BB 0.40.0. |
| Public Plugin SDK | >=0.4.21 | Retained declared floor; this release was not comprehensively retested against every SDK version. |
| Development/test types | — | Lockfile and clean tests use SDK 0.4.34. |
| CLI/build toolchain | — | CLI 0.42.0 builds artifact metadata stamped SDK 0.4.47. |
| Daemon-built frontend | — | Install rebuilt frontend with BB 0.40.0 / SDK 0.4.34 metadata. This stamp is not proof of every daemon runtime API version. |
| Node/npm | No package engine claim | Clean install/test/build on Node 24.20.0 / npm 11.19.0. |
| Historical live evidence | — | Reports phase-2/3/4 describe BB 0.40 / runtime SDK 0.4.21 observations; phase-0/1 describe BB 0.41 / SDK 0.4.34 build evidence. These are historical, not fresh tests of every 0.6.0 path. |

## Verification results

| Gate | Result |
| --- | --- |
| Full tests | **423 passed**, canonical and clean archive copy. |
| Typecheck | Passed in both environments. |
| Build | Passed in both environments. |
| Public SDK scan | Passed as part of full suite; independently inspected imports and storage access. |
| Clean source archive | Git alternate-index tree archived tracked/intended new source only, with no local node_modules or dist. Fresh npm ci, tests, typecheck and build passed. |
| Clean-path BB install | Passed; original canonical plugin path restored afterward. |
| Advisory check | npm ci reported zero known vulnerabilities. |
| Standalone | Fleet and Redteam disabled: native global and scoped RPCs passed. |
| Fleet integration | Both enabled: completed real smoke job visible in Recent and its four-event lifecycle timeline. |
| Native timeline | Live BB timeline returned bounded 50 events. |
| Attention dismissal / reconciliation | Full behavioral tests passed; fixture/browser and public RPC observation complement tests. No real user attention items dismissed for the audit. |
| Global UI | Real BB-hosted UI captured with synthetic RPC fixtures. |
| Scoped visual capture | Focus and multi-agent screenshot slots prepared, but capture was not completed: host-panel selection did not reach the scoped view. Scoped RPC and component tests pass; no fresh scoped browser pass claimed. |
| Mobile | Chromium 360/412 px: document and plugin widths matched, zero horizontal overflow and zero page errors in successful capture. Reduced motion enabled. |
| Physical Android | Not available; not claimed as tested. |

Public-SDK audit: no private @bb imports, package-escaping imports, direct BB DB
access, or private Fleet/Redteam imports. Native reads use BB APIs; presentation
dismissal uses public KV storage. Optional integrations use public
`plugins.callRpc` with local validation schemas. Tests exercise missing/disabled,
unknown-method, malformed, empty and failure cases. Hidden reasoning is excluded.

See [screenshot manifest](docs/screenshots.md). Images show real components with
synthetic data; they are not evidence of physical-device or actual inference behavior.

## Warnings and limits

Clean npm initially failed because the parent process exported
`npm_config_allow_scripts`; removing only that inherited variable in the test
subprocess resolved installation. npm warned about redundant allow-scripts config
and deprecated prebuild-install. Agent Board build warned that its pinned SDK
0.4.34 differs from CLI SDK 0.4.47. No silent SDK upgrade was made.

Live logs showed normal load/dispose messages. Before smoke tests Fleet had one
historical handler error; Agent Board had zero. Two audit-driver probes used the
wrong scoped input key and returned HTTP 400; correcting the driver to `threadId`
passed. Final handler counters were Fleet 1 (unchanged historical error), Agent Board
2 (consistent with those two rejected probes), Redteam 0. Browser capture driver initially used a wrong RPC envelope/event enum and
ambiguous host controls; these were capture-driver errors, not product regressions.
No clean test/build failure remained. Runtime integration settings and paths were restored.

Known public limits: bounded latest timeline, source capability differences,
optional Fleet >=0.6.0 needed for workers, and no supported system/push notification
API in the current SDK. No browser push/service-worker workaround is implemented.

## Publication decision

**NO-GO pending final release gates**, not published. Resolve public owner/URLs
and private security-reporting contact, review media and record physical-device limitations,
and explicitly approve the exact publication source and commands. Agent Board
also requires a clean-history publication decision. Focus/multi-agent media slots
are prepared but captures remain planned; four safe release images are available. See [publication plan](PUBLICATION_PLAN.md).
No repository, remote, tag, GitHub release, npm package or marketplace submission
was created. No external publication approval is inferred from license approval.

Final TypeScript/TSX/CSS, package/lockfile and compiler configuration were byte-
compared with the passing clean archive copy: no differences. Later additions
were documentation/media only. Local Markdown links and git diff whitespace
checks passed. Final local commits include only the intended release changes.
