// bb-plugin-agent-board — the focus view's pipeline / progress track.
//
// Truthful discrete state only (completed / active / pending / failed /
// interrupted / skipped) — never a fabricated percentage. The signal sweep
// on the connector runs once (500ms) when the active step advances; the
// active node then keeps a slow pulse. Everything collapses to a fully
// static, still-readable track under reduced motion.
import { useEffect, useRef, useState } from "react";
import { Fragment } from "react";
import type { FocusStepNode, FocusStepState } from "@/lib/focus-model";
import { formatElapsed } from "@/lib/board-model";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const STATE_TEXT: Record<FocusStepState, string> = {
  completed: "completed",
  active: "in progress",
  pending: "pending",
  failed: "failed",
  interrupted: "interrupted",
  skipped: "skipped",
};

function glyphFor(state: FocusStepState): { name: Parameters<typeof Icon>[0]["name"]; className: string } {
  switch (state) {
    case "completed":
      return { name: "Check", className: "text-primary-foreground" };
    case "active":
      return { name: "Loading", className: "text-primary-foreground" };
    case "failed":
      return { name: "X", className: "text-destructive-foreground" };
    case "interrupted":
      return { name: "AlertTriangle", className: "text-warning-foreground" };
    case "skipped":
      return { name: "MoreHorizontal", className: "text-muted-foreground" };
    default:
      return { name: "Circle", className: "text-muted-foreground/70" };
  }
}

function glyphCircleClass(state: FocusStepState): string {
  switch (state) {
    case "completed":
      return "bg-emerald-500 border-emerald-500";
    case "active":
      return "bg-primary border-primary";
    case "failed":
      return "bg-destructive border-destructive";
    case "interrupted":
      return "bg-warning border-warning";
    default:
      return "bg-transparent border-border";
  }
}

function labelClass(state: FocusStepState): string {
  switch (state) {
    case "completed":
      return "text-muted-foreground";
    case "active":
      return "text-foreground font-medium";
    case "failed":
      return "text-destructive";
    case "interrupted":
      return "text-foreground";
    default:
      return "text-muted-foreground/70";
  }
}

/** One-shot connector sweep lifetime in ms (matches app.css). */
const SIGNAL_MS = 550;

export function PipelineTrack({
  nodes,
  reducedMotion,
}: {
  nodes: FocusStepNode[];
  reducedMotion: boolean;
}) {
  const previousActiveKey = useRef<string | null>(null);
  const [signalFrom, setSignalFrom] = useState<number | null>(null);

  // Track the active step across renders; when it advances exactly one
  // position, fire a single connector sweep. Event-driven: no timers or
  // rAF loops of its own.
  useEffect(() => {
    const activeIndex = nodes.findIndex((node) => node.state === "active");
    const previousKey = previousActiveKey.current;
    if (previousKey !== null && activeIndex >= 0) {
      const previousIndex = nodes.findIndex((node) => node.key === previousKey);
      if (
        previousIndex >= 0 &&
        previousIndex !== activeIndex &&
        Math.abs(activeIndex - previousIndex) === 1
      ) {
        setSignalFrom(Math.min(previousIndex, activeIndex));
      }
    }
    previousActiveKey.current = activeIndex >= 0 ? nodes[activeIndex]!.key : null;
  }, [nodes]);

  // One bounded timeout clears the one-shot sweep (auto-skipped in reduced
  // motion because the signal class is never applied).
  useEffect(() => {
    if (signalFrom === null || reducedMotion) return;
    const timer = setTimeout(() => setSignalFrom(null), SIGNAL_MS);
    return () => clearTimeout(timer);
  }, [signalFrom, reducedMotion]);

  return (
    <ol
      className="flex w-full items-start"
      aria-label="Execution steps"
      data-testid="pipeline-track"
    >
      {nodes.map((node, index) => {
        const glyph = glyphFor(node.state);
        return (
          <Fragment key={node.key}>
            {index > 0 ? (
              <span
                aria-hidden="true"
                className={cn(
                  "ab-connector mx-1 mt-[7px] h-[2px] min-w-3 flex-1 rounded-full",
                  nodes[index - 1]!.state === "completed" && node.state === "active"
                    ? "bg-primary/60"
                    : nodes[index - 1]!.state === "completed"
                      ? "bg-primary/30"
                      : "bg-border",
                  !reducedMotion &&
                    signalFrom === index - 1 &&
                    "ab-connector-signal",
                )}
              />
            ) : null}
            <li
              className="flex max-w-24 flex-col items-center gap-1"
              aria-current={node.state === "active" ? "step" : undefined}
              aria-label={`${node.title}: ${STATE_TEXT[node.state]}`}
            >
              <span
                key={`${node.key}:${node.state}`}
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                  glyphCircleClass(node.state),
                  node.state === "active" && !reducedMotion && "ab-node-active-glyph ab-settle",
                  node.state === "completed" && !reducedMotion && "ab-pop",
                  (node.state === "failed" || node.state === "interrupted") &&
                    !reducedMotion &&
                    "ab-fail-in",
                )}
              >
                <Icon name={glyph.name} className={cn("size-2.5", glyph.className)} />
              </span>
              <span
                className={cn("max-w-24 truncate text-center text-[10px] leading-tight", labelClass(node.state))}
                title={node.error ?? node.summary ?? node.title}
              >
                {node.title}
              </span>
              {node.state === "completed" && node.durationMs !== null ? (
                <span className="font-mono text-[9px] text-muted-foreground/70">
                  {formatElapsed(node.durationMs)}
                </span>
              ) : node.state === "active" ? (
                <span className="font-mono text-[9px] text-muted-foreground/70">live</span>
              ) : null}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}