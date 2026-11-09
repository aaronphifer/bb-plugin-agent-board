import type { BoardCard } from "@/contract/rpc";
import { completionSummary } from "@/lib/dashboard-view";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";

export function CompletionSummary({ card }: { card: BoardCard }) {
  const navigate = useBbNavigate();
  const summary = completionSummary(card);
  const finished = card.status === "completed";
  const outcome = finished && card.source === "bb" ? card.review?.goalStatus === "complete" ? "Goal marked complete — review needed" : "Turn finished — review needed" : summary.outcome;
  return <div data-part="completion-summary" className="mt-2 space-y-1 text-xs [overflow-wrap:anywhere]">
    <p><span className="font-medium">Outcome:</span> <span>{outcome}</span></p>
    {card.review?.objective ? <p><span className="font-medium">Objective:</span> {card.review.objective}</p> : null}
    {summary.failure ? <p data-part="recent-summary" className="min-w-0 max-w-full line-clamp-2 text-destructive [overflow-wrap:anywhere]"><span className="font-medium">Failure:</span> {summary.failure}</p> : null}
    <p data-part={summary.failure ? undefined : "recent-summary"} className="min-w-0 max-w-full line-clamp-2 text-muted-foreground [overflow-wrap:anywhere]"><span className="font-medium">Result:</span> {summary.result}</p>
    <p className="text-muted-foreground"><span className="font-medium">Reported verification:</span> {summary.reportedChecks.length ? summary.reportedChecks.join(" · ") : "Not supplied"}</p>
    {summary.reportedChecks.length ? <p className="text-[10px] text-muted-foreground">Reported by the agent; not independently verified.</p> : null}
    {card.review ? <details><summary className="cursor-pointer text-muted-foreground">Observed file changes ({card.review.changedPaths.length})</summary>{card.review.changedPaths.length ? <ul className="mt-1 space-y-1 font-mono">{card.review.changedPaths.map(path => <li key={path}>{path}</li>)}</ul> : <p className="mt-1 text-muted-foreground">No changed paths observed in this bounded timeline.</p>}</details> : null}
    {card.review?.links?.length ? <div className="flex flex-wrap gap-1" aria-label="Reported result links">{card.review.links.map(link => <Button key={link.url} size="sm" variant="ghost" onClick={() => navigate.openUrl(link.url)}>{link.label}</Button>)}</div> : null}
    {finished && card.source === "bb" ? <p className="text-[10px] text-muted-foreground">A finished turn does not verify the task. Output is the latest source preview and may be an interim update; review the thread and checks.</p> : null}
    {summary.originalPreview ? <details><summary className="cursor-pointer text-muted-foreground">Original output preview</summary><p className="mt-1 whitespace-pre-wrap">Source preview: {summary.originalPreview}</p><p className="mt-1 text-muted-foreground">Preview is bounded. Use Open for the detailed source output.</p></details> : null}
  </div>;
}
