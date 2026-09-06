import { useLayoutEffect, useRef, useState } from "react";
import type { BoardCard, ExecutionTimelineInput, TimelineEvent, TimelineEventKind } from "@/contract/rpc";
import { useExecutionTimeline } from "@/hooks/useExecutionTimeline";
import { formatElapsed } from "@/lib/board-model";
import { usePrefersReducedMotion } from "@/components/ui/hooks/use-media-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export type ExecutionTimelineTarget = ExecutionTimelineInput & { title: string };

const KIND_PRESENTATION: Record<TimelineEventKind, { label: string; icon: IconName }> = {
  "execution-start": { label: "Started", icon: "Circle" },
  "execution-complete": { label: "Completed", icon: "CircleCheck" },
  "execution-failed": { label: "Failed", icon: "AlertCircle" },
  "execution-interrupted": { label: "Interrupted", icon: "AlertTriangle" },
  "phase-start": { label: "Phase", icon: "Workflow" },
  "phase-complete": { label: "Phase complete", icon: "Check" },
  "phase-failed": { label: "Phase failed", icon: "AlertCircle" },
  "model-selected": { label: "Model", icon: "Bot" },
  "tool-start": { label: "Tool", icon: "ToolCase" },
  "tool-complete": { label: "Tool complete", icon: "ToolCase" },
  "tool-failed": { label: "Tool failed", icon: "AlertCircle" },
  "public-update": { label: "Update", icon: "MessageSquare" },
  waiting: { label: "Waiting", icon: "Info" },
  resumed: { label: "Resumed", icon: "ArrowRight" },
  "approval-requested": { label: "Action required", icon: "AlertTriangle" },
  "question-requested": { label: "Question", icon: "MessageQuestion" },
  "child-start": { label: "Child started", icon: "UserRoundPlus" },
  "child-complete": { label: "Child completed", icon: "CircleCheck" },
  "child-failed": { label: "Child failed", icon: "AlertCircle" },
  delegation: { label: "Delegation", icon: "UserRoundPlus" },
};

function eventTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function eventDetail(event: TimelineEvent): string | null {
  const parts: string[] = [];
  if (event.toolName !== null) parts.push(event.toolName);
  if (event.target !== null) parts.push(event.target);
  if (event.model !== null) parts.push(event.model);
  if (event.durationMs !== null) parts.push(formatElapsed(event.durationMs));
  return parts.length > 0 ? parts.join(" · ") : null;
}

function TimelineRow({ event, reducedMotion }: { event: TimelineEvent; reducedMotion: boolean }) {
  const presentation = KIND_PRESENTATION[event.kind];
  const detail = eventDetail(event);
  const failure = event.status === "failed" || event.kind.endsWith("-failed");
  return (
    <li
      data-event-kind={event.kind}
      className={cn(
        "grid min-w-0 grid-cols-[4.75rem_minmax(0,1fr)] gap-2 py-2.5 sm:grid-cols-[5.5rem_1.25rem_minmax(0,1fr)] sm:gap-3",
        !reducedMotion && "ab-row-in",
      )}
    >
      <time dateTime={new Date(event.timestamp).toISOString()} className="pt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground max-md:text-xs">
        {eventTime(event.timestamp)}
      </time>
      <Icon
        name={presentation.icon}
        className={cn("mt-0.5 hidden size-4 sm:block", failure ? "text-destructive" : "text-muted-foreground")}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <div className="flex min-w-0 items-start gap-1.5">
          <Icon name={presentation.icon} className={cn("mt-0.5 size-3.5 shrink-0 sm:hidden", failure ? "text-destructive" : "text-muted-foreground")} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className={cn("text-[10px] font-semibold uppercase tracking-wider", failure ? "text-destructive" : "text-muted-foreground")}>{presentation.label}</p>
            <p className="min-w-0 max-w-full text-sm font-medium leading-5 [overflow-wrap:anywhere]">{event.title}</p>
          </div>
        </div>
        {detail !== null ? <p data-part="timeline-detail" className="mt-0.5 min-w-0 max-w-full font-mono text-[11px] text-muted-foreground line-clamp-2 [overflow-wrap:anywhere]">{detail}</p> : null}
        {event.summary !== null ? <p data-part="timeline-summary" className={cn("mt-1 min-w-0 max-w-full text-xs leading-5 line-clamp-3 [overflow-wrap:anywhere]", failure ? "text-destructive" : "text-foreground/80")}>{event.summary}</p> : null}
      </div>
    </li>
  );
}

export function timelineTargetForCard(card: BoardCard, executionKey = card.groupKey ?? card.key): ExecutionTimelineTarget | null {
  if (card.source === "ollama-fleet" && card.jobId) {
    return { source: "ollama-fleet", executionKey, jobId: card.jobId, title: card.title };
  }
  if (card.source === "bb" && card.threadId !== null) {
    return { source: "bb", executionKey, threadId: card.threadId, title: card.title };
  }
  if (card.source === "redteam" && card.scanId) {
    return { source: "redteam", executionKey, scanId: card.scanId, title: card.title };
  }
  return null;
}

export function ExecutionTimelineDialog({
  target,
  buttonClassName,
  buttonVariant = "ghost",
}: {
  target: ExecutionTimelineTarget;
  buttonClassName?: string;
  buttonVariant?: "ghost" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const { timeline, loading, refreshing, error, refetch } = useExecutionTimeline(target, open);
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const lastEventId = timeline?.events.at(-1)?.id ?? null;

  const jumpToLatest = () => {
    const element = scrollRef.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
    following.current = true;
    setShowJump(false);
  };

  // Follow only when initially loaded or when the user remains near the end.
  useLayoutEffect(() => {
    if (lastEventId !== null && following.current) jumpToLatest();
  }, [lastEventId]);

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) { following.current = true; setShowJump(false); } }}>
      <DialogTrigger asChild>
        <Button variant={buttonVariant} size="sm" className={cn("max-md:pointer-coarse:h-9", buttonClassName ?? "h-7 px-2 text-[11px]")} aria-label={`Open timeline for ${target.title}`}>
          Timeline
        </Button>
      </DialogTrigger>
      <DialogContent className="min-w-0 max-w-full max-h-[88dvh] gap-3 overflow-hidden p-4 sm:max-w-2xl sm:p-5" data-testid="execution-timeline-dialog" data-motion={reducedMotion ? "reduced" : "full"}>
        <DialogHeader className="min-w-0 max-w-full pr-8">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>Execution timeline</DialogTitle>
            {timeline?.active ? <span role="status" aria-label="Live timeline" className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-primary"><span className={cn("size-1.5 rounded-full bg-primary", !reducedMotion && "ab-live-dot")} aria-hidden="true" />Live</span> : null}
            {refreshing ? <span className="text-[10px] text-muted-foreground">Updating…</span> : null}
          </div>
          <DialogDescription className="min-w-0 max-w-full truncate">{target.title} · bounded operational events</DialogDescription>
        </DialogHeader>

        {error !== null ? (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            Timeline unavailable: {error}
            <Button variant="ghost" size="sm" className="ml-2 h-7 max-md:pointer-coarse:h-9" onClick={refetch}>Try again</Button>
          </div>
        ) : null}
        {loading && timeline === null ? <div className="grid min-h-48 place-items-center text-sm text-muted-foreground"><span className="flex items-center gap-2"><Icon name="Loading" className="size-4 animate-spin" aria-hidden="true" />Loading timeline…</span></div> : null}
        {timeline !== null ? (
          <>
            {timeline.truncated ? <p className="rounded-md border border-dashed border-border px-2.5 py-1.5 text-[11px] text-muted-foreground">Earlier activity omitted — showing the latest bounded events.</p> : null}
            {timeline.sourceWarning !== null ? <p className="text-[11px] text-muted-foreground">{timeline.sourceWarning}</p> : null}
            {timeline.events.length === 0 ? <p className="grid min-h-40 place-items-center text-sm text-muted-foreground">No public operational events are available.</p> : (
              <div
                ref={scrollRef}
                role="region"
                aria-label="Chronological execution events"
                tabIndex={0}
                className="min-h-0 min-w-0 max-w-full flex-1 overflow-y-auto overscroll-contain"
                onScroll={(event) => {
                  const element = event.currentTarget;
                  const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 56;
                  following.current = nearBottom;
                  setShowJump(!nearBottom && timeline.active);
                }}
              >
                <ol className="min-w-0 max-w-full divide-y divide-border/70">{timeline.events.map((event) => <TimelineRow key={event.id} event={event} reducedMotion={reducedMotion} />)}</ol>
              </div>
            )}
            {showJump ? <div className="flex justify-end"><Button variant="outline" size="sm" className="h-7 max-md:pointer-coarse:h-9" onClick={jumpToLatest}><Icon name="ArrowDown" className="mr-1 size-3.5" aria-hidden="true" />Jump to latest</Button></div> : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
