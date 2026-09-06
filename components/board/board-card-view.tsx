// bb-plugin-agent-board — one board card (thread, workflow agent, delegation,
// plan step, or queued message) with expandable details.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { BoardCard } from "@/contract/rpc";
import { cardElapsedMs, formatElapsed } from "@/lib/board-model";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { StatusChip } from "@/components/board/status-chip";
import { LiveIndicator, LiveStrip } from "@/components/board/live-execution-cue";
import { ExecutionTimelineDialog, timelineTargetForCard } from "@/components/timeline/execution-timeline-dialog";

/** Kind → icon hint (core Icon names). */
const KIND_ICON: Record<BoardCard["kind"], Parameters<typeof Icon>[0]["name"]> = {
  thread: "Terminal",
  "workflow-agent": "Bot",
  delegation: "UserRoundPlus",
  "plan-step": "Check",
  "queued-message": "MessageSquare",
  phase: "Workflow",
  operation: "Zap",
};

/** Icon for a card's status, shown when the card is terminal or live. */
function statusIcon(status: BoardCard["status"]): Parameters<typeof Icon>[0]["name"] | null {
  switch (status) {
    case "running":
      return "Zap";
    case "waiting":
      return "Info";
    case "failed":
      return "AlertCircle";
    case "interrupted":
      return "AlertTriangle";
    case "completed":
      return "CircleCheck";
    default:
      return null;
  }
}

export function BoardCardView({
  card,
  now,
  liveTreatment = false,
  reducedMotion = false,
}: {
  card: BoardCard;
  /** Timestamp the timers render against (recomputed by the 1s ticker). */
  now: number;
  /** Enable the compact Kanban live treatment for truthful executing states. */
  liveTreatment?: boolean;
  /** Preserve a static status cue when the user requests reduced motion. */
  reducedMotion?: boolean;
}) {
  const navigate = useBbNavigate();
  const timelineTarget = timelineTargetForCard(card);

  const elapsedMs = cardElapsedMs(card, now);
  const statusGlyph = statusIcon(card.status);
  const modelLine = [card.providerLabel ?? card.providerId, card.model]
    .filter(Boolean)
    .join(" · ");
  const executing = liveTreatment && (card.status === "running" || card.status === "starting");

  return (
    <div
      className={cn(
        "min-w-0 max-w-full rounded-lg border border-border bg-card p-3 text-sm shadow-sm transition-shadow hover:shadow",
        card.status === "failed" && "border-destructive/40",
        card.isRoot && "ring-1 ring-primary/30",
      )}
      data-card-kind={card.kind}
      data-card-status={card.status}
      data-card-source={card.source}
      data-live-state={executing ? "executing" : "static"}
    >
      {/* Title row: icon, title (thread link when possible), status chip. */}
      <div className="flex items-start gap-2">
        <Icon name={KIND_ICON[card.kind]} className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate font-medium",
                card.status === "completed" && "text-muted-foreground",
              )}
              title={card.title}
            >
              {card.title}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {executing ? (
                <LiveIndicator reducedMotion={reducedMotion} />
              ) : null}
              <StatusChip status={card.status} />
            </span>
          </div>
          {card.subtitle !== null ? (
            <p className="truncate text-xs text-muted-foreground" title={card.subtitle}>
              {card.subtitle}
            </p>
          ) : null}
        </div>
      </div>

      {/* Provider · model · phase — the "which model" answer. */}
      {modelLine !== "" || card.phaseTitle !== null ? (
        <p className="mt-1.5 truncate text-xs text-muted-foreground">
          {modelLine !== "" ? <span className="font-mono">{modelLine}</span> : null}
          {card.phaseTitle !== null ? (
            <span className={modelLine !== "" ? "ml-2" : ""}>{card.phaseTitle}</span>
          ) : null}
        </p>
      ) : null}

      {card.serverName ? <p className="mt-1 min-w-0 truncate text-xs text-muted-foreground" title={card.serverName}>{card.serverName}</p> : null}

      {/* Current activity — the "what is it doing" answer. */}
      {card.activity !== null ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs">
          {statusGlyph !== null ? (
            <Icon name={statusGlyph} className={cn("size-3.5 shrink-0", card.status === "running" ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
          ) : null}
          <span
            key={card.activity.text}
            className={cn(
              "min-w-0 truncate",
              executing && !reducedMotion && "ab-activity-in",
            )}
            title={card.activity.text}
          >
            {card.activity.text}
          </span>
        </p>
      ) : null}

      {/* What the card is waiting on, when waiting/queued. */}
      {card.waitingOn !== null ? (
        <p className="mt-1.5 text-xs text-muted-foreground italic">{card.waitingOn}</p>
      ) : null}

      {/* Failure text — failures stay visible, not hidden. */}
      {card.errorPreview !== null ? (
        <p className="mt-1.5 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive line-clamp-3">
          {card.errorPreview}
        </p>
      ) : null}

      {/* Output preview for finished work. */}
      {card.outputPreview !== null ? (
        <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
          {card.outputPreview}
        </p>
      ) : null}

      {/* Task preview for workflow agents. */}
      {card.promptPreview !== null ? (
        <p className="mt-1.5 text-xs text-muted-foreground/80 line-clamp-2">
          {card.promptPreview}
        </p>
      ) : null}

      {/* Compact, indeterminate execution cue — never numeric progress. */}
      {executing ? (
        <div className="mt-2"><LiveStrip identity={card.key} reducedMotion={reducedMotion} /></div>
      ) : null}

      {/* Footer: elapsed, tokens/tool calls, actions. */}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
        {elapsedMs !== null ? <span className="font-mono">{formatElapsed(elapsedMs)}</span> : null}
        {card.tokens !== null ? <span>{card.tokens.toLocaleString()} tok</span> : null}
        {card.toolCalls !== null ? <span>{card.toolCalls} tools</span> : null}
        <span className="flex-1" />
        {card.threadId !== null ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={() => navigate.toThread(card.threadId as string)}
            aria-label="Open this thread in the main panel"
          >
            Open
          </Button>
        ) : null}
        {timelineTarget !== null ? <ExecutionTimelineDialog target={timelineTarget} buttonClassName="h-6 px-2 text-[11px]" /> : null}
      </div>
    </div>
  );
}
