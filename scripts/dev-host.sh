#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
WORKSPACE="$(cd -- "$ROOT/../.." && pwd -P)"
TOOLS="$WORKSPACE/work/bb-linux-tools/node_modules/bb-app/dist"
# Only this task's host. These selectors deliberately cannot inherit a
# production data directory or server URL from the caller's environment.
export BB_DATA_DIR="$WORKSPACE/work/bb-wsl-data"
export BB_SERVER_URL="http://127.0.0.1:49886"
export BB_TELEMETRY=false
if [[ -x "$HOME/.nvm/versions/node/v24.20.0/bin/node" ]]; then
  export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"
fi
NODE="$(command -v node || true)"
if [[ -z "$NODE" || ! -f "$TOOLS/bb-app.js" ]]; then
  printf '%s\n' 'Linux Node and task-local bb-app 0.46.0 are required; see docs/vnext-testing.md.' >&2
  exit 1
fi
cd -- "$ROOT"
case "${1:-start}" in
  start)
    exec "$NODE" "$TOOLS/bb-app.js" --data-dir "$BB_DATA_DIR" --server-bind-host 127.0.0.1 --server-port 49886 --host-daemon-port 49887 --no-in-app-updates start ;;
  stop)
    exec "$NODE" "$TOOLS/bb-app.js" --data-dir "$BB_DATA_DIR" stop ;;
  build)
    exec "$NODE" "$TOOLS/bb.js" plugin build ;;
  install)
    # Refuse installation unless the task's isolated server is reachable.
    "$NODE" --input-type=module - "$BB_DATA_DIR/bb-app-runtime.json" "$TOOLS/bb-app.js" <<'JS'
import fs from "node:fs";
const runtime = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const expected = fs.realpathSync(process.argv[3]);
if (runtime.serverUrl !== process.env.BB_SERVER_URL || fs.realpathSync(runtime.entryPath) !== expected) throw new Error("Isolated host identity does not match");
process.kill(runtime.pid, 0);
const argv = fs.readFileSync(`/proc/${runtime.pid}/cmdline`, "utf8").split("\0");
if (!argv.includes(expected)) throw new Error("Isolated launcher process does not match");
JS
    curl --silent --show-error --fail --max-time 5 "$BB_SERVER_URL/api/health" >/dev/null
    exec "$NODE" "$TOOLS/bb.js" plugin install "$ROOT" --yes ;;
  status)
    exec "$NODE" "$TOOLS/bb.js" plugin list ;;
  *) printf '%s\n' 'Usage: bash scripts/dev-host.sh start|stop|build|install|status' >&2; exit 1 ;;
esac
