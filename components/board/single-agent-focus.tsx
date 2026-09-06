// bb-plugin-agent-board — the single-agent focus view.
//
// Renders when the board derives exactly ONE logical active execution
// (see lib/focus-model.ts). Everything is truthful and bounded: no
// fabricated percentages, no reasoning text, no raw output. Empty sections
// collapse away; failures and waiting states stay visible. All motion is
// restrained CSS driven by state changes, and fully disabled under
// prefers-reduced-motion.
import { useEffect, useRef, useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { BoardCard, BoardSnapshot } from "@/contract/rpc";
import { cardElapsedMs, formatElapsed } from "@/lib/board-model";
import type { FocusCompletedRow, FocusModel, FocusUpNextRow } from "@/lib/focus-model";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { StatusChip } from "@/components/board/status-chip";
import { PipelineTrack } from "@/components/board/pipeline-track";
import { BoardCardView } from "@/components/board/board-card-view";
import { usePrefersReducedMotion } from "@/components/ui/hooks/use-media-query";
import { ExecutionTimelineDialog, timelineTargetForCard } from "@/components/timeline/execution-timeline-dialog";

const HERO_KIND_ICON: Record<BoardCard["kind"], Parameters<typeof Icon>[0]["name"]> = {
  thread: "Terminal",
  "workflow-agent": "Bot",
  delegation: "UserRoundPlus",
  "plan-step": "ListTodo",
  "queued-message": "MessageSquare",
  phase: "Workflow",
  operation: "Zap",
};

/** Outgoing activity line lifetime in ms (matches app.css). */
const ACTIVITY_OUT_MS = 300;

/** Max queued rows shown in "Up next" (pipeline covers the full plan). */
const UP_NEXT_LIMIT = 6;

interface ActivityDisplay {
  current: string | null;
  outgoing: string | null;
  animate: boolean;
}

function heroStats(hero: BoardCard, now: number): Array<{ label: string; value: string }> {
  const stats: Array<{ label: string; value: string }> = [];
  const elapsedMs = cardElapsedMs(hero, now);
  if (elapsedMs !== null) {
    stats.push({
      label: hero.status === "waiting" ? "Waiting" : "Elapsed",
      value: formatElapsed(elapsedMs),
    });
  }
  if (hero.model !== null && hero.model !== undefined && hero.model !== "") {
    stats.push({ label: "Model", value: hero.model });
  }
  if (hero.serverName) stats.push({ label: "Server", value: hero.serverName });
  if (hero.tokens !== null && hero.tokens !== undefined) {
    stats.push({ label: "Tokens", value: `${hero.tokens.toLocaleString()} tok` });
  }
  if (hero.toolCalls !== null && hero.toolCalls !== undefined) {
    stats.push({ label: "Tool calls", value: hero.toolCalls.toLocaleString() });
  }
  return stats;
}

function completedRowIcon(status: FocusCompletedRow["status"]): Parameters<typeof Icon>[0]["name"] {
  switch (status) {
    case "failed":
      return "X";
    case "interrupted":
      return "AlertTriangle";
    case "skipped":
      return "MoreHorizontal";
    default:
      return "Check";
  }
}

function UpNextRow({ row }: { row: FocusUpNextRow }) {
  return (
    <li className="flex items-baseline gap-2 text-xs">
      <span
        aria-hidden="true"
        className="mt-1 size-1.5 shrink-0 rounded-full border border-muted-foreground/50"
      />
      <span className="min-w-0 flex-1 truncate">{row.title}</span>
      {row.waitingOn !== null ? (
        <span className="max-w-40 shrink-0 truncate text-[10px] text-muted-foreground/70" title={row.waitingOn}>
          {row.waitingOn}
        </span>
      ) : null}
    </li>
  );
}

export function SingleAgentFocus({
  snapshot,
  model,
  now,
}: {
  snapshot: BoardSnapshot;
  model: FocusModel;
  now: number;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const navigate = useBbNavigate();
  const [showOther, setShowOther] = useState(false);

  const hero = model.hero;
  const executing = hero.status === "running" || hero.status === "starting";
  const timelineTarget = timelineTargetForCard(hero, `bb:${snapshot.root.threadId}`);

  // Current-activity line: swap with a one-shot crossfade when the text
  // changes (never re-animates the whole card; no loop — a single bounded
  // timeout clears the outgoing line).
  const activityText = hero.activity?.text ?? null;
  const [activity, setActivity] = useState<ActivityDisplay>({
    current: activityText,
    outgoing: null,
    animate: false,
  });
  const lastActivityText = useRef<string | null>(activityText);
  useEffect(() => {
    const previous = lastActivityText.current;
    if (previous === activityText) return;
    lastActivityText.current = activityText;
    if (reducedMotion) {
      setActivity({ current: activityText, outgoing: null, animate: false });
      return;
    }
    setActivity({ current: activityText, outgoing: previous, animate: true });
    const timer = setTimeout(
      () => setActivity({ current: activityText, outgoing: null, animate: false }),
      ACTIVITY_OUT_MS,
    );
    return () => clearTimeout(timer);
  }, [activityText, reducedMotion]);

  const stats = heroStats(hero, now);
  const otherRest = model.other.filter(
    (card) => !(card.status === "failed" || card.status === "interrupted"),
  );

  return (
    <div
      data-testid="single-agent-focus"
      data-motion={reducedMotion ? "reduced" : "full"}
      className="space-y-3"
    >
      {/* Pipeline / progress track — truthful discrete states only. */}
      {model.pipeline !== null ? (
        <section
          className="rounded-lg border border-border bg-card px-3 py-2.5"
          aria-label="Execution progress"
        >
          <PipelineTrack nodes={model.pipeline} reducedMotion={reducedMotion} />
        </section>
      ) : null}

      {/* Hero card + bounded recent activity. */}
      <div className={cn("grid gap-3", model.recent.length > 0 ? "md:grid-cols-5" : "grid-cols-1")}>
        <section
          data-testid="focus-hero"
          aria-label="Current execution"
          className={cn(
            "min-w-0 rounded-lg border border-border bg-card p-3.5",
            model.recent.length > 0 ? "md:col-span-3" : "col-span-1",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              {executing ? (
                <span
                  className={cn("size-1.5 shrink-0 rounded-full bg-primary", !reducedMotion && "ab-live-dot")}
                  aria-hidden="true"
                />
              ) : null}
              <Icon name={HERO_KIND_ICON[hero.kind]} className="size-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{model.heroLabel}</span>
            </span>
            <StatusChip status={hero.status} />
          </div>

          <h3 className="mt-2 min-w-0 truncate text-sm font-semibold" title={hero.title}>
            {hero.title}
          </h3>
          {hero.subtitle !== null && hero.subtitle !== undefined && hero.subtitle !== "" ? (
            <p className="mt-0.5 min-w-0 truncate text-xs text-muted-foreground" title={hero.subtitle}>
              {hero.subtitle}
            </p>
          ) : null}

          {/* Indeterminate live-operation strip while work executes. */}
          {executing ? (
            <div className={cn("ab-strip mt-3", reducedMotion && "ab-strip-static")} role="presentation" />
          ) : null}

          {/* Waiting state: never hidden, never buried. */}
          {hero.status === "waiting" ? (
            <p className="mt-2.5 flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400">
              <Icon name="AlertTriangle" className="size-3" aria-hidden="true" />
              <span className="min-w-0 truncate">{hero.waitingOn ?? "Waiting"}</span>
            </p>
          ) : null}

          {/* What it is doing right now — newest activity, crossfaded. */}
          {activity.current !== null || activity.outgoing !== null ? (
            <p
              data-testid="hero-activity"
              className="relative mt-2 min-h-[1.25rem] overflow-hidden text-xs"
            >
              {activity.outgoing !== null ? (
                <span
                  className={cn("absolute inset-0 truncate text-muted-foreground/70", !reducedMotion && "ab-activity-out")}
                  aria-hidden="true"
                >
                  {activity.outgoing}
                </span>
              ) : null}
              {activity.current !== null ? (
                <span
                  key={activity.current}
                  className={cn("block truncate text-foreground/90", activity.animate && !reducedMotion && "ab-activity-in")}
                >
                  {activity.current}
                </span>
              ) : null}
            </p>
          ) : null}

          {/* Latest observed operation (tool · target) for the execution. */}
          {model.latestOperation !== null ? (
            <p className="mt-2 truncate text-xs text-muted-foreground" data-testid="hero-latest-operation">
              <span className="font-medium text-foreground/80">Latest operation:</span>{" "}
              <span className="font-mono">{model.latestOperation.label}</span>
              {model.latestOperation.detail !== null && model.latestOperation.detail !== "" ? (
                <span className="font-mono"> · {model.latestOperation.detail}</span>
              ) : null}
            </p>
          ) : null}

          {/* Truthful stats; unavailable fields are simply omitted. */}
          {stats.length > 0 ? (
            <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5" data-testid="hero-stats">
              {stats.map((stat) => (
                <div key={stat.label} className="flex items-baseline justify-between gap-2 min-w-0">
                  <dt className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{stat.label}</dt>
                  <dd className="min-w-0 truncate font-mono text-[11px]" title={stat.value}>
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {/* Errors stay visible, never behind a toggle. */}
          {hero.errorPreview !== null && hero.errorPreview !== undefined && hero.errorPreview !== "" ? (
            <p className="mt-2 line-clamp-2 break-words text-xs text-destructive" data-testid="hero-error">
              {hero.errorPreview}
            </p>
          ) : null}

          {/* Other active cards of the same execution. */}
          {model.peers.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="font-semibold uppercase tracking-wider">Also active</span>
              {model.peers.map((peer) => (
                <span
                  key={peer.key}
                  className="min-w-0 max-w-44 truncate rounded-full border border-border px-1.5 py-0.5"
                  title={peer.title}
                >
                  {peer.title}
                </span>
              ))}
            </div>
          ) : null}

          {/* Actions: same controls as Kanban cards. */}
          {hero.threadId !== null || timelineTarget !== null ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {hero.threadId !== null ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => navigate.toThread(hero.threadId as string)}
                  aria-label="Open this thread in the main panel"
                >
                  Open
                </Button>
              ) : null}
              {timelineTarget !== null ? <ExecutionTimelineDialog target={timelineTarget} buttonClassName="h-7" /> : null}
            </div>
          ) : null}
        </section>

        {/* Bounded recent activity — newest first; omitted when empty. */}
        {model.recent.length > 0 ? (
          <section
            data-testid="focus-recent"
            aria-label="Recent activity"
            className="min-w-0 rounded-lg border border-border bg-card p-3 md:col-span-2"
          >
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Recent activity
            </h3>
            <ul className="mt-2 space-y-1.5">
              {model.recent.map((entry) => (
                <li
                  key={entry.id}
                  className={cn("flex items-baseline gap-1.5 text-xs", !reducedMotion && "ab-row-in")}
                >
                  <span className="shrink-0 font-mono text-[10px] uppercase text-primary/80">
                    {entry.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground" title={entry.detail ?? undefined}>
                    {entry.detail}
                  </span>
                  <time className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
                    {formatElapsed(Math.max(0, now - entry.at))} ago
                  </time>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {/* Completed work and up-next queue; sections collapse when empty. */}
      {model.completed.length > 0 || model.upNext.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {model.completed.length > 0 ? (
            <section
              data-testid="focus-completed"
              aria-label="Completed work"
              className="min-w-0 rounded-lg border border-border bg-card p-3"
            >
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Completed
              </h3>
              <ul className="mt-2 space-y-1.5">
                {model.completed.map((row) => (
                  <li key={row.key} className="text-xs">
                    <div className="flex items-baseline gap-2">
                      <Icon
                        name={completedRowIcon(row.status)}
                        aria-hidden="true"
                        className={cn(
                          "size-3 shrink-0",
                          row.status === "failed"
                            ? "text-destructive"
                            : row.status === "interrupted"
                              ? "text-orange-600 dark:text-orange-400"
                              : "text-emerald-500",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate">{row.title}</span>
                      {row.durationMs !== null ? (
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                          {formatElapsed(row.durationMs)}
                        </span>
                      ) : null}
                    </div>
                    {row.summary !== null && row.summary !== "" ? (
                      <p className="mt-0.5 line-clamp-2 break-words pl-5 text-[11px] text-muted-foreground/80">
                        {row.summary}
                      </p>
                    ) : null}
                    {row.error !== null && row.error !== "" ? (
                      <p className="mt-0.5 line-clamp-2 break-words pl-5 text-[11px] text-destructive/80">
                        {row.error}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {model.upNext.length > 0 ? (
            <section
              data-testid="focus-up-next"
              aria-label="Up next"
              className="min-w-0 rounded-lg border border-border bg-card p-3"
            >
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Up next
              </h3>
              <ul className="mt-2 space-y-1.5">
                {model.upNext.slice(0, UP_NEXT_LIMIT).map((row) => (
                  <UpNextRow key={row.key} row={row} />
                ))}
              </ul>
              {model.upNext.length > UP_NEXT_LIMIT ? (
                <p className="mt-1.5 text-[10px] text-muted-foreground/70">
                  +{model.upNext.length - UP_NEXT_LIMIT} more queued
                </p>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}

      {/* Other cards: failures stay visible; the rest collapse behind a
          single toggle. The section disappears entirely when empty. */}
      {model.other.length > 0 ? (
        <section
          data-testid="focus-other"
          aria-label="Other activity"
          className="rounded-lg border border-border bg-card p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Other activity
              {model.otherAttention.length > 0 ? (
                <span className="ml-1.5 text-destructive">
                  · {model.otherAttention.length} need attention
                </span>
              ) : (
                <span className="ml-1.5 text-muted-foreground/70">· {model.other.length}</span>
              )}
            </h3>
            {otherRest.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => setShowOther((value) => !value)}
                aria-expanded={showOther}
              >
                {showOther ? "Hide" : "Show"} {otherRest.length}
              </Button>
            ) : null}
          </div>
          <div className="mt-2 space-y-2">
            {model.otherAttention.map((card) => (
              <BoardCardView key={card.key} card={card} now={now} />
            ))}
            {showOther
              ? otherRest.map((card) => <BoardCardView key={card.key} card={card} now={now} />)
              : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
