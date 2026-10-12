import type { BoardCard } from "@/contract/rpc";
import { completionSummary } from "@/lib/dashboard-view";

export function CompletionSummary({ card }: { card: BoardCard }) {
  const summary = completionSummary(card);
  return <div data-part="completion-summary" className="mt-2 space-y-1 text-xs [overflow-wrap:anywhere]">
    <p><span className="font-medium">Outcome:</span> {summary.outcome}</p>
    {summary.failure ? <p data-part="recent-summary" className="min-w-0 max-w-full line-clamp-2 text-destructive [overflow-wrap:anywhere]"><span className="font-medium">Failure:</span> {summary.failure}</p> : null}
    <p data-part={summary.failure ? undefined : "recent-summary"} className="min-w-0 max-w-full line-clamp-2 text-muted-foreground [overflow-wrap:anywhere]"><span className="font-medium">Result:</span> {summary.result}</p>
    <p className="text-muted-foreground"><span className="font-medium">Reported verification:</span> {summary.reportedChecks.length ? summary.reportedChecks.join(" · ") : "Not supplied"}</p>
    {summary.reportedChecks.length ? <p className="text-[10px] text-muted-foreground">Reported by the agent; not independently verified.</p> : null}
    {summary.originalPreview ? <details><summary className="cursor-pointer text-muted-foreground">Original output preview</summary><p className="mt-1 whitespace-pre-wrap">Source preview: {summary.originalPreview}</p><p className="mt-1 text-muted-foreground">Preview is bounded. Use Open for the detailed source output.</p></details> : null}
  </div>;
}
