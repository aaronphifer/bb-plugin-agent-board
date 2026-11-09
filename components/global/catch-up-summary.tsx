import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { CatchUpChange } from "@/lib/catch-up";
import { Button } from "@/components/ui/button";

export function CatchUpSummary({ changes, onSeen }: { changes: CatchUpChange[]; onSeen: () => void }) {
  const navigate = useBbNavigate();
  if (!changes.length) return null;
  return <section aria-label="Since you last checked" className="mt-3 rounded-lg border border-primary/25 bg-card p-3">
    <div className="flex flex-wrap items-center gap-2"><h2 className="flex-1 text-xs font-semibold">Since you last checked</h2><Button size="sm" variant="ghost" onClick={onSeen}>Mark seen</Button></div>
    <ul className="mt-1 space-y-1">{changes.map(change => <li key={change.key} className="flex min-w-0 flex-wrap items-center gap-2 text-xs"><span className="text-muted-foreground">{change.kind}</span><span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{change.title}</span>{change.threadId ? <Button size="sm" variant="ghost" onClick={() => navigate.toThread(change.threadId!)}>Open</Button> : null}</li>)}</ul>
    <p className="mt-2 text-[10px] text-muted-foreground">Changes observed in this bounded snapshot; activity outside it may be missing.</p>
  </section>;
}
