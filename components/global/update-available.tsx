import { useEffect, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "@/contract/rpc";
import type { ReleaseUpdateState } from "@/lib/update-check";
import { Button } from "@/components/ui/button";

export function UpdateAvailable() {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [update, setUpdate] = useState<ReleaseUpdateState | null>(null);
  const [dismissed, setDismissed] = useState(() => { try { return window.localStorage.getItem("agent-board:update-dismissed"); } catch { return null; } });
  const [confirming, setConfirming] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const check = () => rpc.call("release_update", {}).then(result => { if (!cancelled) setUpdate(result); }, () => {});
    void check();
    const timer = setInterval(() => void check(), 3_600_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [rpc]);
  const identity = update ? `${update.installed}:${update.latest ?? ""}:${update.eligible?.version ?? ""}` : "";
  if (!update || (!update.latest && !update.eligible) || dismissed === identity) return null;
  async function install() {
    if (!update?.eligible || installing) return;
    setInstalling(true); setMessage(null);
    try {
      const result = await rpc.call("install_update", { expectedVersion: update.eligible.version });
      setMessage(result.applied ? "Update installed. Reopen Agent Board to use the new version." : result.detail ?? `BB update result: ${result.outcome}.`);
      setConfirming(false);
    } catch (cause) {
      setMessage(`Update was not confirmed: ${cause instanceof Error ? cause.message : String(cause)}. Reopen Agent Board to check the installed version before retrying.`);
    } finally { setInstalling(false); }
  }
  return <section aria-label="Agent Board update available" className="mt-3 min-w-0 rounded-lg border border-primary/30 bg-card p-3 text-xs">
    <div className="flex flex-wrap items-center gap-2"><h2 className="min-w-0 flex-1 font-semibold">Agent Board {update.latest ?? "update"} available</h2><Button size="sm" variant="ghost" disabled={installing} onClick={() => { setDismissed(identity); try { window.localStorage.setItem("agent-board:update-dismissed", identity); } catch { /* This visit only. */ } }}>Dismiss update notice</Button></div>
    <p className="mt-1 text-muted-foreground">Installed: {update.installed}. {update.eligible ? `BB offers ${update.eligible.display} within your selected update source.` : "BB has not offered an installable update within your selected source. A newer release may require a version-range change or a newer BB."}</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {update.eligible && !confirming ? <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>Review update</Button> : null}
      {update.releaseUrl ? <Button size="sm" variant="ghost" onClick={() => navigate.openUrl(update.releaseUrl!)}>Release notes</Button> : null}
    </div>
    {confirming ? <div className="mt-2 space-y-2 rounded border border-border p-2" role="group" aria-label="Confirm plugin update">
      <p>Install BB’s eligible Agent Board update? BB handles installation and rollback checks while keeping your settings. BB resolves the eligible release again when installation starts.</p>
      <div className="flex flex-wrap gap-2"><Button size="sm" disabled={installing} onClick={() => void install()}>{installing ? "Installing…" : "Install update"}</Button><Button size="sm" variant="ghost" disabled={installing} onClick={() => setConfirming(false)}>Cancel</Button></div>
    </div> : null}
    {message ? <p role="status" className="mt-2 [overflow-wrap:anywhere]">{message}</p> : null}
    {!update.eligible ? <p className="mt-2 text-muted-foreground">Open BB’s Plugins → Agent Board → check for updates, and see the release notes for upgrade instructions. An out-of-range release cannot be installed by this card on BB versions without range upgrades.</p> : null}
  </section>;
}
