import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { AttentionItem, GlobalExecution } from "@/contract/rpc";
import { useGlobalDashboard } from "@/hooks/useGlobalDashboard";
import { cardElapsedMs, formatElapsed } from "@/lib/board-model";
import { usePrefersReducedMotion } from "@/components/ui/hooks/use-media-query";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { StatusChip } from "@/components/board/status-chip";
import { LiveIndicator, LiveStrip } from "@/components/board/live-execution-cue";
import { cn } from "@/lib/utils";
import { ExecutionTimelineDialog, timelineTargetForCard } from "@/components/timeline/execution-timeline-dialog";

function relativeAge(at: number, now: number): string {
  return `${formatElapsed(Math.max(0, now - at))} ago`;
}

function GlobalExecutionCard({ execution, now, reducedMotion }: { execution: GlobalExecution; now: number; reducedMotion: boolean }) {
  const navigate = useBbNavigate();
  const card = execution.card;
  const executing = card.status === "running" || card.status === "starting";
  const elapsed = cardElapsedMs(card, now);
  const model = [card.providerLabel ?? card.providerId, card.model].filter(Boolean).join(" · ");
  const timelineTarget = timelineTargetForCard(card, execution.key);
  return (
    <article
      className="min-w-0 max-w-full rounded-xl border border-border bg-card p-4 shadow-sm"
      data-global-card="active"
      data-source={card.source}
      data-status={card.status}
      data-live-state={executing ? "executing" : "static"}
    >
      <div className="flex min-w-0 max-w-full items-start gap-3">
        <Icon name={card.source === "redteam" ? "Bug" : "Terminal"} className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold" title={card.title}>{card.title}</h3>
            {executing ? <LiveIndicator reducedMotion={reducedMotion} /> : <StatusChip status={card.status} />}
          </div>
          <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{card.source === "bb" ? "BB" : card.source === "ollama-fleet" ? "Ollama Fleet" : "Redteam"}</p>
        </div>
      </div>
      {card.phaseTitle !== null || model !== "" ? (
        <p data-part="execution-model" className="mt-2 min-w-0 max-w-full line-clamp-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {card.phaseTitle !== null ? <span className="text-foreground/90">{card.phaseTitle}</span> : null}
          {card.phaseTitle !== null && model !== "" ? <span aria-hidden="true"> · </span> : null}
          {model !== "" ? <span className="font-mono">{model}</span> : null}
        </p>
      ) : null}
      {card.serverName ? <p className="mt-1 min-w-0 max-w-full truncate text-xs text-muted-foreground">{card.serverName}</p> : null}
      {(execution.delegatedWorkers?.length ?? 0) > 0 ? (
        <div data-part="delegated-workers" className="mt-3 min-w-0 max-w-full space-y-1 overflow-hidden">
          <p className="text-[11px] text-muted-foreground">{execution.activeDelegatedWorkerCount ?? 0} delegated local workers active</p>
          {execution.delegatedWorkers!.slice(0,4).map(worker => (
            <div key={worker.key} data-fleet-worker={worker.jobId} className="flex min-w-0 max-w-full items-start gap-1.5 text-[11px]">
              <span className="shrink-0" aria-label={worker.status}>{worker.status === "completed" ? "✓" : worker.status === "failed" ? "!" : worker.status === "interrupted" ? "−" : "●"}</span>
              <span className="min-w-0 flex-1 line-clamp-2 [overflow-wrap:anywhere]">
                <span className="font-mono">{worker.model ?? "Selecting model"}</span> · {worker.title}
                {worker.serverName ? <span className="text-muted-foreground"> · {worker.serverName}</span> : null}
              </span>
            </div>
          ))}
          {(execution.delegatedWorkerCount ?? 0) > 4 ? <p className="text-[10px] text-muted-foreground">+{execution.delegatedWorkerCount! - 4} more</p> : null}
        </div>
      ) : null}
      {card.latestPublicUpdate != null ? (
        <p data-part="public-update" className="mt-2 min-w-0 max-w-full line-clamp-3 text-xs text-foreground/80 [overflow-wrap:anywhere]" title={card.latestPublicUpdate}>
          {card.latestPublicUpdate}
        </p>
      ) : null}
      {card.activity !== null ? (
        <p key={card.activity.text} data-part="execution-activity" className={cn("mt-2 min-w-0 max-w-full line-clamp-2 text-xs [overflow-wrap:anywhere]", executing && !reducedMotion && "ab-activity-in")} title={card.activity.text}>
          {card.activity.text}
        </p>
      ) : card.waitingOn !== null ? (
        <p className="mt-2 min-w-0 max-w-full text-xs text-muted-foreground [overflow-wrap:anywhere]">{card.waitingOn}</p>
      ) : null}
      {executing ? <div className="mt-3 min-w-0 max-w-full"><LiveStrip identity={execution.key} reducedMotion={reducedMotion} /></div> : null}
      <div data-part="card-actions" className="mt-3 flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        {elapsed !== null ? <span className="font-mono">{formatElapsed(elapsed)}</span> : null}
        {execution.activeChildCount > 0 ? <span>{execution.activeChildCount} active child{execution.activeChildCount === 1 ? "" : "ren"}</span> : null}
        {execution.childCount > 0 && execution.activeChildCount === 0 ? <span>{execution.childCount} child{execution.childCount === 1 ? "" : "ren"}</span> : null}
        {card.toolCalls !== null ? <span>{card.toolCalls} tools</span> : null}
        {card.tokens !== null ? <span>{card.tokens.toLocaleString()} tok</span> : null}
        <span className="flex-1" />
        {card.threadId !== null ? (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => navigate.toThread(card.threadId!)} aria-label={`Open ${card.title}`}>
            Open
          </Button>
        ) : null}
        {timelineTarget !== null ? <ExecutionTimelineDialog target={timelineTarget} /> : null}
      </div>
    </article>
  );
}

const ATTENTION_LABEL: Record<AttentionItem["type"], string> = {
  "action-required": "Action required",
  failed: "Failed",
  waiting: "Waiting",
  interrupted: "Interrupted",
  warning: "Warning",
};

function AttentionCard({ item, now, onDismiss }: { item: AttentionItem; now: number; onDismiss: (item: AttentionItem) => void }) {
  const navigate = useBbNavigate();
  const destructive = item.type === "failed";
  return (
    <article className={cn("min-w-0 max-w-full rounded-lg border bg-card p-3", destructive ? "border-destructive/40" : "border-amber-500/35")} data-global-card="attention" data-attention-type={item.type}>
      <div className="flex min-w-0 max-w-full items-start gap-2.5">
        <Icon name={destructive ? "AlertCircle" : "AlertTriangle"} className={cn("mt-0.5 size-4 shrink-0", destructive ? "text-destructive" : "text-amber-600 dark:text-amber-400")} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h3 data-part="attention-title" className="min-w-0 max-w-full flex-[1_1_12rem] text-sm font-medium [overflow-wrap:anywhere]">{item.title}</h3>
            <span className={cn("shrink-0 text-[9px] font-semibold uppercase tracking-wider", destructive ? "text-destructive" : "text-amber-700 dark:text-amber-300")}>{ATTENTION_LABEL[item.type]}</span>
          </div>
          <p data-part="attention-message" className="mt-1 min-w-0 max-w-full line-clamp-3 text-xs text-muted-foreground [overflow-wrap:anywhere]">{item.message}</p>
          <p className="mt-1 min-w-0 max-w-full text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
            {item.type === "action-required" || item.type === "waiting" ? `Waiting ${formatElapsed(now - item.firstObservedAt)}` : relativeAge(item.updatedAt, now)}
            <span aria-hidden="true"> · </span>{item.source === "bb" ? "BB" : item.source === "ollama-fleet" ? "Ollama Fleet" : "Redteam"}
          </p>
        </div>
        <div data-part="card-actions" className="flex max-w-full shrink-0 flex-col gap-1">
          {item.threadId !== null ? (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => navigate.toThread(item.threadId!)} aria-label={`Open ${item.title}`}>Open</Button>
          ) : null}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => onDismiss(item)} aria-label={`Dismiss ${item.title}`}
            aria-description="Hide from Needs attention (presentation only; reappears when the condition changes)"
          >Dismiss</Button>
        </div>
      </div>
    </article>
  );
}

function RecentRow({ execution, now }: { execution: GlobalExecution; now: number }) {
  const navigate = useBbNavigate();
  const card = execution.card;
  const elapsed = cardElapsedMs(card, now);
  const finishedAt = card.completedAt ?? execution.updatedAt;
  const timelineTarget = timelineTargetForCard(card, execution.key);
  return (
    <article className="flex min-w-0 max-w-full items-start gap-3 rounded-lg border border-border/70 bg-card/60 px-3 py-2.5" data-global-card="recent" data-source={card.source} data-status={card.status}>
      <Icon name={card.status === "failed" ? "AlertCircle" : card.status === "interrupted" ? "AlertTriangle" : "CircleCheck"} className={cn("mt-0.5 size-4 shrink-0", card.status === "failed" ? "text-destructive" : card.status === "interrupted" ? "text-orange-600 dark:text-orange-400" : "text-emerald-600 dark:text-emerald-400")} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h3 data-part="recent-title" className="min-w-0 flex-1 truncate text-sm font-medium">{card.title}</h3>
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{card.source === "bb" ? "BB" : card.source === "ollama-fleet" ? "Ollama Fleet" : "Redteam"}</span>
        </div>
        <p data-part="recent-metadata" className="mt-0.5 min-w-0 max-w-full line-clamp-2 text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
          {elapsed !== null ? formatElapsed(elapsed) : card.status}
          {card.model !== null ? <> · <span className="font-mono">{card.model}</span></> : null}
          <> · {relativeAge(finishedAt, now)}</>
        </p>
        {card.errorPreview !== null || card.outputPreview !== null ? <p data-part="recent-summary" className={cn("mt-1 min-w-0 max-w-full line-clamp-2 text-xs [overflow-wrap:anywhere]", card.errorPreview !== null ? "text-destructive" : "text-muted-foreground")}>{card.errorPreview ?? card.outputPreview}</p> : null}
      </div>
      <div data-part="card-actions" className="flex max-w-full shrink-0 flex-col gap-1 sm:flex-row">
        {card.threadId !== null ? <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => navigate.toThread(card.threadId!)} aria-label={`Open ${card.title}`}>Open</Button> : null}
        {timelineTarget !== null ? <ExecutionTimelineDialog target={timelineTarget} /> : null}
      </div>
    </article>
  );
}

export function GlobalDashboard() {
  const { snapshot, loading, refreshing, error, refetch, dismissAttention, clearDismissedAttentions, connectionState } = useGlobalDashboard();
  const reducedMotion = usePrefersReducedMotion();
  const now = Date.now();
  return (
    <main className="ab-global-dashboard h-full min-h-0 w-full min-w-0 max-w-full overflow-y-auto bg-background" data-global-dashboard="" data-motion={reducedMotion ? "reduced" : "full"}>
      <div className="mx-auto w-full min-w-0 max-w-6xl p-3 sm:p-5 lg:p-6">
        <header className="flex min-w-0 max-w-full flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Icon name="ListTodo" className="size-5 text-primary" aria-hidden="true" />
              <h1 className="text-lg font-semibold">Agent Board</h1>
              {snapshot !== null && snapshot.counts.active > 0 ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary"><span className={cn("size-1.5 rounded-full bg-primary", !reducedMotion && "ab-live-dot")} aria-hidden="true" />{snapshot.counts.active} live</span> : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Global operations across BB and available observability sources.</p>
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch({ fresh: true })} disabled={refreshing}><Icon name="Loading" className={cn("mr-1.5 size-3.5", refreshing && "animate-spin")} aria-hidden="true" />Refresh</Button>
            <span className="text-[10px] text-muted-foreground" title={`Realtime: ${connectionState}`}>{connectionState === "connected" ? "Live" : "Reconnecting…"}</span>
          </div>
        </header>

        {snapshot !== null ? (
          <section aria-label="Operational summary" className="mt-4 grid min-w-0 max-w-full grid-cols-[repeat(2,minmax(0,1fr))] gap-2 sm:grid-cols-[repeat(4,minmax(0,1fr))]">
            {[["Active", snapshot.counts.active], ["Waiting", snapshot.counts.waiting], ["Attention", snapshot.counts.attention], ["Recent", snapshot.counts.recent]].map(([label, value]) => (
              <div key={label} className="min-w-0 rounded-lg border border-border/70 bg-card/50 px-3 py-2"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p></div>
            ))}
          </section>
        ) : null}

        {error !== null ? <div role="alert" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">Could not refresh the global dashboard: {error}</div> : null}
        {loading && snapshot === null ? <div className="grid min-h-64 place-items-center text-sm text-muted-foreground"><span className="flex items-center gap-2"><Icon name="Loading" className="size-4 animate-spin" aria-hidden="true" />Loading operations…</span></div> : null}

        {snapshot !== null ? <div className="mt-5 min-w-0 max-w-full space-y-6">
          <section aria-labelledby="attention-heading" className="min-w-0 max-w-full">
            <div className="mb-2 flex min-w-0 max-w-full flex-wrap items-center gap-2"><h2 id="attention-heading" className="text-xs font-semibold uppercase tracking-wider">Needs attention</h2>{snapshot.counts.attention > 0 ? <span className="rounded-full bg-amber-500/15 px-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">{snapshot.counts.attention}</span> : null}
              {snapshot.dismissedCount > 0 ? (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => void clearDismissedAttentions()}>Clear dismissed ({snapshot.dismissedCount})</Button>
              ) : null}
            </div>
            {snapshot.attention.length > 0 ? <div data-global-grid="attention" className="grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-2">{snapshot.attention.map((item) => <AttentionCard key={item.id} item={item} now={now} onDismiss={(dismissed) => void dismissAttention(dismissed)} />)}</div> : <p className="min-w-0 max-w-full rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">{snapshot.dismissedCount > 0 ? "No open items — dismissed conditions stay hidden until they change." : "Nothing currently requires your attention."}</p>}
          </section>

          <section aria-labelledby="active-heading" className="min-w-0 max-w-full">
            <div className="mb-2 flex items-center gap-2"><h2 id="active-heading" className="text-xs font-semibold uppercase tracking-wider">Active work</h2><span className="text-[10px] text-muted-foreground">{snapshot.active.length}</span></div>
            {snapshot.active.length > 0 ? <div data-global-grid="active" className="grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))]">{snapshot.active.map((execution) => <GlobalExecutionCard key={execution.key} execution={execution} now={now} reducedMotion={reducedMotion} />)}</div> : <p className="min-w-0 max-w-full rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">No active executions.</p>}
          </section>

          <section aria-labelledby="recent-heading" className="min-w-0 max-w-full">
            <div className="mb-2 flex items-center gap-2"><h2 id="recent-heading" className="text-xs font-semibold uppercase tracking-wider">Recently completed</h2><span className="text-[10px] text-muted-foreground">{snapshot.recent.length}</span></div>
            {snapshot.recent.length > 0 ? <div data-global-grid="recent" className="grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-2">{snapshot.recent.map((execution) => <RecentRow key={execution.key} execution={execution} now={now} />)}</div> : <p className="text-sm text-muted-foreground">No recent completions in the bounded window.</p>}
          </section>

          {snapshot.unavailableSources.length > 0 ? <p className="text-[11px] text-muted-foreground">Temporarily unavailable: {snapshot.unavailableSources.map((source) => source === "bb" ? "BB" : source === "ollama-fleet" ? "Ollama Fleet" : "Redteam").join(", ")}. Available sources remain live.</p> : null}
          {snapshot.partial ? <p className="text-[11px] italic text-muted-foreground">The global view is bounded; older or excess executions are not shown.</p> : null}
        </div> : null}
      </div>
    </main>
  );
}
