// bb-plugin-agent-board — pure board helpers shared by the normalizer and UI.
//
// No SDK imports here: this module is safe for both bundle sides and is
// exhaustively unit-tested without any host.

import type { BoardCard, BoardCardStatus, BoardColumn, BoardCounts } from "../contract/rpc";

/** Hard caps for bounded collection; exported for tests. */
export const BOARD_LIMITS = {
  /** Max threads per snapshot tree (root included). */
  maxThreads: 24,
  /** Max parent→child descent depth from the root. */
  maxDepth: 4,
  /** Timeline segments fetched per thread (latest page). */
  timelineSegmentLimit: 40,
  /** Latest source segments inspected when the user explicitly opens Timeline. */
  executionTimelineSegmentLimit: 80,
  /** Normalized events returned by Timeline (request may choose less). */
  executionTimelineDefaultEvents: 50,
  executionTimelineMaxEvents: 80,
  /** Small process-local insertion-ordered cap; no persistent history. */
  executionTimelineCacheEntries: 24,
  /** Safe normalized Timeline text fields. */
  timelineSummaryChars: 360,
  timelineTargetChars: 240,
  /** Events fetched per activity tail / error lookup. */
  eventTailLimit: 40,
  /** Characters kept in an output preview. */
  outputPreviewChars: 240,
  /** Characters kept in an activity line. */
  activityChars: 160,
  /** Characters kept in a task/prompt preview. */
  promptPreviewChars: 200,
  /** Characters kept in a global latest-public-update excerpt. */
  publicUpdateChars: 360,
  /** Optional Redteam source bounds (the remote RPC enforces equal/tighter caps). */
  redteamMaxScans: 10,
  redteamMaxPhasesPerScan: 7,
  redteamMaxOperationsPerScan: 4,
  redteamMaxCards: 60,
  /** Max recent-activity entries kept per execution feed. */
  feedEntriesPerExecution: 6,
  /** Global dashboard: one bounded cross-project thread query. */
  globalThreadRows: 64,
  /** Logical execution groups shown/enriched at once. */
  globalActiveExecutions: 8,
  globalRecentExecutions: 6,
  globalDetailedExecutions: 14,
  globalAttentionItems: 8,
  /** Terminal failures/interruption stop demanding attention after this age. */
  terminalAttentionWindowMs: 24 * 60 * 60 * 1_000,
} as const;

/**
 * Reasoning event types, explicitly refused. Agent Board is an execution
 * observability surface: model reasoning text never enters a snapshot even
 * though BB exposes the events publicly.
 */
export const REASONING_EVENT_TYPES: ReadonlySet<string> = new Set([
  "item/reasoning/textDelta",
  "item/reasoning/summaryTextDelta",
]);

/** True when an event type must never be normalized into board data. */
export function isReasoningEventType(type: string): boolean {
  return REASONING_EVENT_TYPES.has(type) || type.startsWith("item/reasoning/");
}

/**
 * Event types the board treats as meaningful activity. An allowlist (plus the
 * reasoning denylist) keeps future event kinds out until they are vetted.
 */
export const ACTIVITY_EVENT_TYPES: ReadonlySet<string> = new Set([
  "item/started",
  "item/completed",
  "item/delegation/progress",
  "item/delegation/completed",
  "item/backgroundTask/progress",
  "item/backgroundTask/completed",
  "item/toolCall/progress",
  "item/mcpToolCall/progress",
  "item/plan/delta",
  "client/turn/start",
  "client/turn/requested",
  "client/turn/rejected",
  "provider/error",
  "provider/modelFallback",
  "provider/unhandled",
  "system/error",
  "system/userQuestion/lifecycle",
  "system/permissionGrant/lifecycle",
  "system/thread/interrupted",
  "thread/started",
  "thread/compacted",
]);

/** True when an event type is board-relevant activity. */
export function isActivityEventType(type: string): boolean {
  return ACTIVITY_EVENT_TYPES.has(type) && !isReasoningEventType(type);
}

/** Column placement for a card status. Plan steps are always "plan". */
export function columnForStatus(status: BoardCardStatus, kind: BoardCard["kind"]): BoardColumn {
  if (kind === "plan-step") return "plan";
  switch (status) {
    case "queued":
    case "starting":
    case "waiting":
      return "plan";
    case "running":
      return "active";
    case "completed":
    case "failed":
    case "interrupted":
    case "skipped":
      return "output";
  }
}

/** Count cards by status for the header. */
export function countCards(cards: BoardCard[]): BoardCounts {
  const counts: BoardCounts = {
    running: 0,
    waiting: 0,
    queued: 0,
    completed: 0,
    failed: 0,
    interrupted: 0,
  };
  for (const card of cards) {
    if (card.kind === "plan-step") continue; // plan steps are not agents
    if (card.status === "running" || (card.source === "ollama-fleet" && card.status === "starting")) counts.running += 1;
    else if (card.status === "waiting") counts.waiting += 1;
    else if (card.status === "queued" || card.status === "starting") counts.queued += 1;
    else if (card.status === "completed") counts.completed += 1;
    else if (card.status === "failed") counts.failed += 1;
    else if (card.status === "interrupted") counts.interrupted += 1;
  }
  return counts;
}

/**
 * Collapse whitespace and truncate with an ellipsis. Never returns more than
 * `max` characters; empty/whitespace-only input yields null.
 */
export function previewText(text: string | null | undefined, max: number): string | null {
  if (typeof text !== "string") return null;
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/**
 * Defense-in-depth redaction for globally aggregated operational messages.
 * BB/adapter data should already be presentation-safe; these narrow patterns
 * prevent common credential assignments and bearer tokens from becoming more
 * widely visible on the global page.
 */
export function redactOperationalText(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /\b(api[_-]?key|access[_-]?token|auth[_-]?token|password|passwd|secret)\s*[:=]\s*([^\s,;]+)/gi,
      (_match, label: string) => `${label}=[REDACTED]`,
    );
}

/**
 * Remove fenced code blocks (closed or still-streaming/unclosed) from an
 * assistant message, keeping only authored prose. Inline `code` spans are
 * prose and stay.
 */
export function stripFencedBlocks(text: string): string {
  return text.replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\1|$)/g, " ");
}

/**
 * Bounded excerpt of an assistant-authored public update: prose only (code
 * fences stripped), redacted like every other globally aggregated text, then
 * collapsed/truncated to `max` characters. Empty prose yields null so the
 * caller omits the excerpt entirely.
 */
export function publicUpdatePreview(
  text: string | null | undefined,
  max = BOARD_LIMITS.publicUpdateChars,
): string | null {
  if (typeof text !== "string") return null;
  return previewText(redactOperationalText(stripFencedBlocks(text)), max);
}

/** Compact elapsed rendering: "42s", "1m 42s", "2h 03m". */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/**
 * Live elapsed for a card between authoritative snapshots: use durationMs
 * when the work finished, otherwise clock from startedAt against `now`.
 */
export function cardElapsedMs(card: BoardCard, now: number): number | null {
  if (card.durationMs !== null && card.durationMs !== undefined) return card.durationMs;
  if (card.startedAt === null || card.startedAt === undefined) return null;
  if (card.completedAt !== null && card.completedAt !== undefined) {
    return Math.max(0, card.completedAt - card.startedAt);
  }
  return Math.max(0, now - card.startedAt);
}
