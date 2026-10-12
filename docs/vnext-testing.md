# Development launch and verification

Use Node.js 24 and an isolated BB host. The candidate is `0.7.0-rc.1`;
it is unpublished. See [candidate validation](validation-0.7.0.md) for
cross-platform results and their limits. Never install a review build over the
stable plugin, share its data directory, or copy its credentials into a test host.

## Pull request CI

The `Release validation` workflow runs for PRs targeting `main`, using official
GitHub-hosted Ubuntu and Windows runners with Node 24. Both run locked installation,
the full suite and typecheck. Ubuntu additionally prepares separate pinned BB
0.46.0 tools, runs the official full production build and `npm run verify:package`.
The inspector checks the actual tar archive, required assets, version metadata
and private/runtime-data exclusions. It leaves its temporary package outside Git.

Permissions are `contents: read`; official Actions are pinned to commit revisions
and checkout credentials are not persisted. No secrets, self-hosted runners,
`pull_request_target`, release/tag jobs or sensitive artifact uploads are used.
Test failures remain failures: there are no unconditional retries or blanket
timeout increases. A clean local Windows install took 100 seconds importing the
large icon barrel and exceeded the existing 20-second app-hook limit. Vitest now
prebundles that data-only dependency once; real icon exports, app code and hook
limits are preserved. Fresh hosted timings validate this harness change.
See [dependency assessment](dependency-security-0.7.0.md).

## Automated checks

From the candidate checkout:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run typecheck
```

The suite uses the public SDK fake hosts, synthetic fixtures and isolated
storage. Vitest uses a serial thread pool for reliable Windows startup. A cold
import timeout has been observed: record the failed run, investigate it and
rerun unchanged checks; do not count a timeout as a pass. The development SDK
pin is 0.4.34. The official BB 0.46.0 builder stamps SDK 0.6.37; these serve
different roles and a build notice does not authorize upgrading the pin.

## Guarded Windows helpers

The helpers intentionally require this disposable workspace layout:

```text
<workspace>/outputs/agent-board-vnext/    candidate checkout
<workspace>/work/bb-build-tools/         isolated official BB tools
<workspace>/work/bb-validation-windows-data/  test data; preserve across restarts
```

Prepare tools outside the checkout, from `<workspace>`:

```powershell
npm install --prefix work\bb-build-tools --ignore-scripts --no-audit --no-fund bb-app@0.46.0
```

Use an environment with working native SQLite dependencies. The native Windows
host was exercised successfully during this review; that is empirical coverage,
not a general platform-support promise. Prefer the supported Linux/WSL host
where available; do not change system networking or authentication to make a
validation environment work.

From the candidate checkout, build and start in one terminal:

```powershell
$env:BB_CLI=''
.\scripts\build-dev.ps1
.\scripts\validation-host.ps1 start
```

After the test host is healthy, in a second terminal in the same checkout:

```powershell
$env:BB_CLI=''
.\scripts\validation-host.ps1 install
.\scripts\validation-host.ps1 status
```

Open <http://127.0.0.1:49986> and choose Agent Board. Server/daemon ports are
49986/49987; telemetry and in-app updates are disabled for this host. Install
and stop verify the launcher marker, executable path, URL and process identity.
The build helper uses separate build data and restores the caller's environment.

After all disposable tasks finish:

```powershell
$env:BB_CLI=''
.\scripts\validation-host.ps1 stop
```

Keep the test data. Do not uninstall to test an upgrade: replacing the same
plugin identity preserves preferences, while uninstalling deletes them.

## Guarded Linux helper

`scripts/linux-validation-host.sh` uses only
`$HOME/.local/share/agent-board-vnext-validation/`, loopback ports 50886/50887,
and the source checkout containing the script. It refuses occupied start ports
and verifies the launcher identity before install/stop. Prepare its dedicated
`node24/` directory with an official Node 24 distribution verified against the
vendor checksums; keep it separate from system and production runtimes.

```bash
runtime="$HOME/.local/share/agent-board-vnext-validation"
npm install --prefix "$runtime/bb-tools" --ignore-scripts --no-audit --no-fund bb-app@0.46.0
(cd "$runtime/bb-tools" && npm rebuild better-sqlite3)
bash scripts/linux-validation-host.sh build
bash scripts/linux-validation-host.sh start
```

In another terminal, from the candidate checkout:

```bash
bash scripts/linux-validation-host.sh install
bash scripts/linux-validation-host.sh status
```

Open <http://127.0.0.1:50886>. Stop only that test host after tasks finish:

```bash
bash scripts/linux-validation-host.sh stop
```

The older `scripts/dev-host.sh` is a workspace-layout-specific WSL helper using
`<workspace>/work/bb-linux-tools`, `<workspace>/work/bb-wsl-data` and ports
49886/49887. It does not share selectors with the native Windows or Linux
validation hosts. Inspect selectors and prerequisites before using any helper.

## Acceptance checks

Use a disposable project for real provider work. Verify connected transport,
refresh/watch health, project/repository/provider/status filters and grouping,
attention preservation, completed results with explicit verification provenance,
controlled failure states, Open/Timeline navigation, active animation and
version-scoped announcement dismissal/reload/reopening. Test a narrow viewport
as well as desktop and reset temporary viewport overrides afterward.

Agent-reported checks are not independent test evidence. Quiet reporting does
not prove a stall. Optional Fleet/Redteam fixtures do not replace nonempty live
adapter coverage. Save detailed local logs/screenshots in ignored `evidence/`;
do not publish private task text, paths, databases or credentials.
