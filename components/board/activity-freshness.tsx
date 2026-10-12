import type { BoardCard } from "@/contract/rpc";
import { activityFreshness } from "@/lib/dashboard-view";
import { formatElapsed } from "@/lib/board-model";

export function ActivityFreshness({ card, now }: { card: BoardCard; now: number }) {
  const freshness = activityFreshness(card, now);
  return <p data-part="activity-freshness" data-freshness={freshness.state} className="mt-2 text-[11px] text-muted-foreground" title={freshness.at === null ? undefined : new Date(freshness.at).toLocaleString()}>
    {freshness.ageMs === null ? "Activity time unavailable" : `Last observed activity ${formatElapsed(freshness.ageMs)} ago`}
    {freshness.state === "quiet" && (card.status === "running" || card.status === "starting") ? <span> · Quiet reporting; task may still be running.</span> : freshness.state === "recent" ? <span> · Recent reporting</span> : null}
  </p>;
}
