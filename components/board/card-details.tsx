// bb-plugin-agent-board — expandable details block shared by board cards and
// the focus hero: a bounded, reasoning-free recent-activity tail fetched
// lazily on first expansion via the public board_activity RPC.
import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { BoardActivity, rpcContract } from "@/contract/rpc";

export function CardDetails({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const [activity, setActivity] = useState<BoardActivity[] | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);

  // The activity tail is fetched once per expansion.
  useEffect(() => {
    let cancelled = false;
    rpc
      .call("board_activity", { threadId })
      .then(
        (result) => {
          if (!cancelled) setActivity(result.entries);
        },
        (cause: unknown) => {
          if (!cancelled) {
            setActivityError(cause instanceof Error ? cause.message : String(cause));
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [threadId, rpc]);

  return (
    <div className="mt-2 rounded-md border border-border bg-background/50 px-2.5 py-2">
      {activity === null && activityError === null ? (
        <p className="text-xs text-muted-foreground">Loading activity…</p>
      ) : activityError !== null ? (
        <p className="text-xs text-destructive">{activityError}</p>
      ) : activity !== null && activity.length === 0 ? (
        <p className="text-xs text-muted-foreground">No recent activity.</p>
      ) : (
        <ol className="space-y-1">
          {activity?.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="flex items-baseline gap-2 text-xs">
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                {new Date(entry.at).toLocaleTimeString([], { hour12: false })}
              </span>
              <span className="min-w-0 truncate">{entry.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}