// bb-plugin-agent-board — status chip used on every card.
import { cn } from "@/lib/utils";
import type { BoardCardStatus } from "@/contract/rpc";

const STATUS_STYLE: Record<BoardCardStatus, string> = {
  queued: "bg-muted text-muted-foreground border-border",
  starting: "bg-muted text-muted-foreground border-border",
  running: "bg-primary/10 text-primary border-primary/30",
  waiting: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  completed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  interrupted: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30",
  skipped: "bg-muted text-muted-foreground border-border",
};

const STATUS_LABEL: Record<BoardCardStatus, string> = {
  queued: "Queued",
  starting: "Starting",
  running: "Running",
  waiting: "Waiting",
  completed: "Done",
  failed: "Failed",
  interrupted: "Interrupted",
  skipped: "Skipped",
};

export function StatusChip({
  status,
  className,
}: {
  status: BoardCardStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        STATUS_STYLE[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}