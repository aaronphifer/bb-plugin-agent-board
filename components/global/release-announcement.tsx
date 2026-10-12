import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "@/contract/rpc";
import { Button } from "@/components/ui/button";

type Release = { version: string; title: string; highlights: string[]; dismissed: boolean };
export function ReleaseAnnouncement() {
  const rpc = useRpc<typeof rpcContract>();
  const [release, setRelease] = useState<Release | null>(null);
  const [viewing, setViewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    rpc.call("release_announcement", {}).then(result => { if (!cancelled) { setRelease(result); setError(null); } }, () => { if (!cancelled) setError("Release notes could not be loaded."); });
    return () => { cancelled = true; };
  }, [rpc]);
  async function dismiss() {
    if (!release || saving) return;
    setSaving(true);
    try {
      await rpc.call("dismiss_release_announcement", { version: release.version });
      setRelease({ ...release, dismissed: true }); setViewing(false); setError(null);
    } catch { setError("Dismissal could not be saved. Please try again."); }
    finally { setSaving(false); }
  }
  return <div className="mt-3 min-w-0">
    <Button variant="ghost" size="sm" onClick={() => setViewing(v => !v)} disabled={release === null} aria-expanded={release !== null && (!release.dismissed || viewing)}>Release notes</Button>
    {error ? <p role="alert" className="mt-1 text-xs text-destructive">{error}</p> : null}
    {release && (!release.dismissed || viewing) ? <section aria-label="What's New" className="mt-2 rounded-lg border border-primary/25 bg-card p-3">
      <div className="flex flex-wrap items-center gap-2"><h2 className="flex-1 text-sm font-semibold">What’s New · {release.version}</h2><Button variant="ghost" size="sm" disabled={saving} onClick={() => release.dismissed ? setViewing(false) : void dismiss()}>{release.dismissed ? "Close release notes" : saving ? "Saving…" : "Dismiss announcement"}</Button></div>
      <p className="mt-1 text-xs font-medium">{release.title}</p>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">{release.highlights.map(highlight => <li key={highlight}>{highlight}</li>)}</ul>
    </section> : null}
  </div>;
}
