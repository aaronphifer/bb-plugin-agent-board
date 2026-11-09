import { z } from "zod";
import type { GlobalDashboardSnapshot } from "../contract/rpc";

export const CATCH_UP_KEY = "agent-board:seen:v1";
const checkpointSchema = z.object({ at: z.number().finite().nonnegative(), executions: z.record(z.string().max(500), z.object({ status: z.string().max(40), completedAt: z.number().finite().nullable() })), attention: z.record(z.string().max(500), z.string().max(100)) });
export type Checkpoint = z.infer<typeof checkpointSchema>;
export type CatchUpChange = { key: string; title: string; kind: string; threadId: string | null };
// Store a fingerprint, never question text or execution output in browser state.
function fingerprint(value: string): string { let n = 2166136261; for (const c of value) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return (n >>> 0).toString(16); }
export function parseCheckpoint(raw: string | null): Checkpoint | null {
  try {
    if (!raw || raw.length > 100_000) return null;
    const value = checkpointSchema.parse(JSON.parse(raw));
    if (value.at > Date.now() + 5_000 || Object.keys(value.executions).length > 128 || Object.keys(value.attention).length > 128) return null;
    return value;
  } catch { return null; }
}
export function checkpointFor(snapshot: GlobalDashboardSnapshot): Checkpoint {
  return { at: snapshot.fetchedAt,
    executions: Object.fromEntries([...snapshot.active, ...snapshot.recent].slice(0, 128).map(e => [e.key, { status: e.card.status, completedAt: e.card.completedAt }])),
    attention: Object.fromEntries(snapshot.attention.slice(0, 128).map(a => [a.id, fingerprint(`${a.type}:${a.firstObservedAt}:${a.message}`)])),
  };
}
export function mergeCheckpoint(previous: Checkpoint | null, snapshot: GlobalDashboardSnapshot): Checkpoint {
  const next = checkpointFor(snapshot);
  // The board is always bounded: absence is never evidence of deletion.
  return { ...next, at: previous && (snapshot.partial || snapshot.unavailableSources.length > 0) ? previous.at : next.at,
    executions: Object.fromEntries(Object.entries({ ...previous?.executions, ...next.executions }).slice(-128)),
    attention: Object.fromEntries(Object.entries({ ...previous?.attention, ...next.attention }).slice(-128)),
  };
}
export function catchUpChanges(snapshot: GlobalDashboardSnapshot, previous: Checkpoint | null): CatchUpChange[] {
  if (!previous || snapshot.fetchedAt < previous.at) return [];
  const changes: CatchUpChange[] = [];
  const current = checkpointFor(snapshot);
  for (const item of snapshot.attention) {
    if (previous.attention[item.id] === current.attention[item.id]) continue;
    if (!["action-required", "failed", "interrupted"].includes(item.type)) continue;
    changes.push({ key: item.id, title: item.title, kind: item.type === "action-required" ? "Needs your input" : item.type === "failed" ? "Failed" : "Interrupted", threadId: item.threadId });
  }
  for (const execution of snapshot.recent) {
    if (changes.some(c => c.key.startsWith(`attention:${execution.key}:`))) continue;
    const old = previous.executions[execution.key];
    const at = execution.card.completedAt;
    if (old?.status === execution.card.status && old.completedAt === at) continue;
    // Old list entries first discovered on this visit are not new results.
    if (at === null || (!old && at <= previous.at) || at > snapshot.fetchedAt + 5_000) continue;
    const kind = execution.card.status === "completed" ? execution.card.source === "bb" ? "Turn finished" : "Execution finished" : execution.card.status === "failed" ? "Failed" : execution.card.status === "interrupted" ? "Interrupted" : null;
    if (kind) changes.push({ key: execution.key, title: execution.card.title, kind, threadId: execution.card.threadId });
  }
  return changes.slice(0, 12);
}
