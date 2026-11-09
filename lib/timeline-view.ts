import type { TimelineEvent } from "../contract/rpc";

/** Refreshes update known events; history pages never replace the loaded run. */
export function mergeTimelineEvents(current: readonly TimelineEvent[], incoming: readonly TimelineEvent[]): TimelineEvent[] {
  const events = new Map(current.map(event => [event.id, event]));
  for (const event of incoming) events.set(event.id, event);
  return [...events.values()].sort((a, b) => a.timestamp - b.timestamp || (a.sourceMetadata?.sequence ?? 0) - (b.sourceMetadata?.sequence ?? 0) || a.id.localeCompare(b.id));
}
