// bb-plugin-agent-board — the board root.
//
// Derives the normalized snapshot, then chooses ONE of two truthful views:
// the single-agent focus experience when exactly one logical active
// execution is being watched (see lib/focus-model.ts), otherwise the
// multi-agent Kanban board. The header, states, and invalidation flow are
// shared by both views.
import { useMemo } from "react";
import type { ReactNode } from "react";
import { useRealtimeConnectionState } from "@get-bb/plugin-sdk/app";
import type { BoardSnapshot } from "@/contract/rpc";
import { formatElapsed } from "@/lib/board-model";
import { buildFocusModel } from "@/lib/focus-model";
import { useBoard } from "@/hooks/useBoard";
import { KanbanBoard } from "@/components/board/kanban-board";
import { SingleAgentFocus } from "@/components/board/single-agent-focus";
import { StatusChip } from "@/components/board/status-chip";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export function Board({ rootThreadId }: { rootThreadId: string }) {
  const { snapshot, loading, refreshing, error, tick, refetch } = useBoard(rootThreadId);
  const connectionState = useRealtimeConnectionState();
  const now = useMemo(() => Date.now(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // One logical active execution → focus view; otherwise Kanban.
  const focusModel = useMemo(
    () => (snapshot !== null && snapshot.cards.length > 0 ? buildFocusModel(snapshot) : null),
    [snapshot],
  );

  const contextPct =
    snapshot?.root.contextWindowUsedTokens !== null &&
    snapshot?.root.contextWindowUsedTokens !== undefined &&
    snapshot?.root.contextWindowTotalTokens !== null &&
    snapshot?.root.contextWindowTotalTokens !== undefined &&
    snapshot.root.contextWindowTotalTokens > 0
      ? Math.min(
          100,
          Math.round(
            (snapshot.root.contextWindowUsedTokens / snapshot.root.contextWindowTotalTokens) * 100,
          ),
        )
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      {/* Header: root identity, goal, model, live indicator, refresh. */}
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="min-w-0 truncate text-sm font-semibold">
                {snapshot?.root.title ?? "Agent Board"}
              </h2>
              {snapshot !== null ? <StatusChip status={boardStatusForChip(snapshot.root.status)} /> : null}
            </div>
            {snapshot?.root.goal ? (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" title={snapshot.root.goal.objective}>
                <span className="font-medium text-foreground/80">Goal:</span>{" "}
                {snapshot.root.goal.objective}
                {snapshot.root.goal.tokenBudget !== null ? (
                  <span className="ml-2 font-mono text-[10px]">
                    {Math.round((snapshot.root.goal.tokensUsed / snapshot.root.goal.tokenBudget) * 100)}% budget
                  </span>
                ) : null}
              </p>
            ) : null}
            {snapshot !== null ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {[snapshot.root.providerLabel ?? snapshot.root.providerId, snapshot.root.model]
                  .filter(Boolean)
                  .map((part) => (
                    <span key={part} className="font-mono">{part}</span>
                  ))
                  .reduce<ReactNode[]>((nodes, node, index) => {
                    if (index > 0) nodes.push(" · ");
                    nodes.push(node);
                    return nodes;
                  }, [])}
                {snapshot.root.updatedAt !== null
                  ? ` · updated ${formatElapsed(Math.max(0, now - snapshot.root.updatedAt))} ago`
                  : ""}
              </p>
            ) : null}
            {contextPct !== null ? (
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1 w-32 overflow-hidden rounded-full bg-border" role="presentation">
                  <div className={cn("h-full", contextPct > 85 ? "bg-orange-500" : "bg-primary")} style={{ width: `${contextPct}%` }} />
                </div>
                <span className="text-[10px] font-mono text-muted-foreground">
                  ctx {contextPct}%
                </span>
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={loading || refreshing}
              onClick={() => refetch({ fresh: true })}
              aria-label="Refresh now (bypasses server caches)"
            >
              <Icon name="Loading" className={cn("size-3.5", (loading || refreshing) && "animate-spin")} aria-hidden="true" />
              Refresh
            </Button>
            <span
              className="flex items-center gap-1 text-[10px] text-muted-foreground"
              title={`Realtime: ${connectionState}`}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  connectionState === "connected" ? "bg-emerald-500" : "bg-amber-500",
                )}
                aria-hidden="true"
              />
              {connectionState === "connected" ? "Live" : "Reconnecting…"}
            </span>
          </div>
        </div>
        {snapshot !== null ? (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              <strong className="text-foreground">{snapshot.counts.running}</strong> running
            </span>
            <span>
              <strong className="text-foreground">{snapshot.counts.waiting}</strong> waiting
            </span>
            <span>
              <strong className="text-foreground">{snapshot.counts.queued}</strong> queued
            </span>
            <span>
              <strong className="text-foreground">{snapshot.counts.completed}</strong> done
            </span>
            {snapshot.counts.failed > 0 ? (
              <span className="text-destructive">
                <strong>{snapshot.counts.failed}</strong> failed
              </span>
            ) : null}
            {snapshot.counts.interrupted > 0 ? (
              <span className="text-orange-600 dark:text-orange-400">
                <strong>{snapshot.counts.interrupted}</strong> interrupted
              </span>
            ) : null}
            {snapshot.partial ? (
              <span className="italic" title="The observed tree was capped (24 threads / depth 4)">
                showing a truncated tree
              </span>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* Body: states, then focus or the three columns. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error !== null ? (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <p className="font-medium text-destructive">Could not load the board</p>
            <p className="mt-1 break-words text-xs text-destructive/80">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch({ fresh: true })}>
              Retry
            </Button>
          </div>
        ) : loading && snapshot === null ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <Icon name="Loading" className="size-4 animate-spin" aria-hidden="true" />
              Loading the board…
            </span>
          </div>
        ) : snapshot === null ? null : snapshot.cards.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">
            <div className="max-w-sm text-center">
              <Icon name="Workflow" className="mx-auto size-8 opacity-50" aria-hidden="true" />
              <p className="mt-2">Nothing to observe yet.</p>
              <p className="mt-1 text-xs">
                The board shows plans, queued work, agents, delegations, and outputs for this thread
                and its children.
              </p>
            </div>
          </div>
        ) : focusModel !== null ? (
          <SingleAgentFocus snapshot={snapshot} model={focusModel} now={now} />
        ) : (
          <KanbanBoard snapshot={snapshot} now={now} />
        )}
      </div>
    </div>
  );
}

/** The root's ThreadResponse.status string → the closest chip status. */
function boardStatusForChip(status: string): Parameters<typeof StatusChip>[0]["status"] {
  switch (status) {
    case "active":
      return "running";
    case "error":
      return "failed";
    case "pending":
    case "starting":
      return "queued";
    case "stopping":
      return "interrupted";
    default:
      return "completed";
  }
}