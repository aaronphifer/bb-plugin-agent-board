import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { GlobalExecution } from "@/contract/rpc";
import { cardElapsedMs, formatElapsed } from "@/lib/board-model";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/board/status-chip";
import { ExecutionTimelineDialog, timelineTargetForCard } from "@/components/timeline/execution-timeline-dialog";

export function ExecutionChildren({ execution, now }: { execution: GlobalExecution; now: number }) {
  const navigate = useBbNavigate();
  const children = execution.children ?? [];
  if (!children.length) return null;
  return <details className="mt-2 min-w-0 border-t border-border/60 pt-2">
    <summary className="cursor-pointer text-xs text-muted-foreground">Observed agents ({children.length}{execution.childCount > children.length ? ` of ${execution.childCount}` : ""})</summary>
    <ul className="mt-2 min-w-0 space-y-2">{children.map(child => {
      const elapsed = cardElapsedMs(child, now);
      const target = timelineTargetForCard(child, child.key);
      return <li key={child.key} className="min-w-0 rounded border border-border/70 p-2 text-xs">
        <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{child.title}</span><StatusChip status={child.status} /></div>
        <p className="mt-1 text-muted-foreground [overflow-wrap:anywhere]">{child.model ?? "Model unavailable"}{elapsed !== null ? ` · ${formatElapsed(elapsed)}` : ""}</p>
        {child.activity ? <p className="mt-1 [overflow-wrap:anywhere]">{child.activity.text}</p> : null}
        {child.outputPreview ? <details className="mt-1"><summary className="cursor-pointer text-muted-foreground">Output preview</summary><p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{child.outputPreview}</p></details> : null}
        <div className="mt-1 flex flex-wrap gap-1">{child.threadId ? <Button size="sm" variant="ghost" onClick={() => navigate.toThread(child.threadId!)}>Open agent thread</Button> : null}{target ? <ExecutionTimelineDialog target={target} /> : null}</div>
        {!child.threadId && child.ownerThreadId ? <p className="text-[10px] text-muted-foreground">Native subagent · Timeline opens its owning execution.</p> : null}
      </li>;
    })}</ul>
    <p className="mt-1 text-[10px] text-muted-foreground">Only agents present in the bounded source snapshot are shown.</p>
  </details>;
}
