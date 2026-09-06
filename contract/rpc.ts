// bb-plugin-agent-board — the RPC contract shared by server.ts and app.tsx.
//
// Both schemas run at the wire boundary: handler input/output and the
// frontend client are inferred from this one definition. Frontend hooks also
// use signal schemas here, so SDK imports must remain type-only: managed Git
// installs omit the development SDK package before building the frontend.
//
// The board DTO is intentionally source-agnostic: every card carries a
// `source` discriminator. BB and optional public plugin adapters contribute
// cards without leaking source DTOs into the UI.
import type { PluginRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/** Board card statuses, normalized across every source. */
export const boardCardStatusSchema = z.enum([
  "queued",
  "starting",
  "running",
  "waiting",
  "completed",
  "failed",
  "interrupted",
  "skipped",
]);
export type BoardCardStatus = z.infer<typeof boardCardStatusSchema>;

/** Kanban column the card is placed in. Derived server-side so every client agrees. */
export const boardColumnSchema = z.enum(["plan", "active", "output"]);
export type BoardColumn = z.infer<typeof boardColumnSchema>;

/**
 * Kinds of observable work the board renders. "thread" is a BB thread
 * (root or child); "workflow-agent" is one agent inside a BB workflow;
 * "delegation" is a parent-thread delegation item without a resolvable
 * child-thread card; "plan-step" is an explicit todo/plan step; "queued-message"
 * is work waiting to start.
 */
export const boardCardKindSchema = z.enum([
  "thread",
  "workflow-agent",
  "delegation",
  "plan-step",
  "queued-message",
  "phase",
  "operation",
]);
export type BoardCardKind = z.infer<typeof boardCardKindSchema>;

/** Which observable source produced the card. The extension seam for adapters. */
export const boardCardSourceSchema = z.enum(["bb", "redteam", "ollama-fleet"]);
export type BoardCardSource = z.infer<typeof boardCardSourceSchema>;

/** Operational attention, derived only from explicit structured source state. */
export const attentionTypeSchema = z.enum([
  "action-required",
  "failed",
  "waiting",
  "interrupted",
  "warning",
]);
export type AttentionType = z.infer<typeof attentionTypeSchema>;

/**
 * Bounded recent-activity entry for one execution (the focus view's tail).
 * `label` is the operation family (tool name / work kind); `detail` is the
 * compact target or activity text. Never reasoning, never raw output.
 */
export const boardActivityFeedEntrySchema = z.object({
  /** Stable identity within the feed (for keyed list animation). */
  id: z.string(),
  label: z.string(),
  detail: z.string().nullable(),
  /** Epoch ms of the observation. */
  at: z.number(),
  /** Activity family, e.g. "tool", "inference", "file-read". */
  kind: z.string().nullable(),
});
export type BoardActivityFeedEntry = z.infer<typeof boardActivityFeedEntrySchema>;

/** Recent-activity feed keyed by execution ("thread:<id>" or "redteam:<scanId>"). */
export const boardActivityFeedSchema = z.object({
  key: z.string(),
  entries: z.array(boardActivityFeedEntrySchema),
});
export type BoardActivityFeed = z.infer<typeof boardActivityFeedSchema>;

export const boardActivitySchema = z.object({
  /** Compact human text, e.g. "Reading orchestrator.ts" or a command line. */
  text: z.string(),
  /** Epoch ms of the observation. */
  at: z.number(),
  /** Activity family, e.g. "tool", "command", "search", "turn", "plan". */
  kind: z.string().nullable(),
});
export type BoardActivity = z.infer<typeof boardActivitySchema>;

export const boardCardSchema = z.object({
  /** Stable card key, unique within one snapshot. */
  key: z.string(),
  /** Key of the owning card, or null for root-level cards. */
  parentKey: z.string().nullable(),
  /** 0 for root-level, 1+ nested. */
  depth: z.number().int().nonnegative(),
  kind: boardCardKindSchema,
  source: boardCardSourceSchema,
  /** Primary line, e.g. thread title or agent label. */
  title: z.string(),
  /** Secondary line, e.g. "child thread" or a phase title. */
  subtitle: z.string().nullable(),
  status: boardCardStatusSchema,
  column: boardColumnSchema,
  /** Underlying BB thread id when the card maps to one (for "Open thread"). */
  threadId: z.string().nullable(),
  providerId: z.string().nullable(),
  providerLabel: z.string().nullable(),
  /** Resolved model where publicly available (thread execution options or workflow). */
  model: z.string().nullable(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  /** Authoritative duration when the work is finished; null = clock it live. */
  durationMs: z.number().nullable(),
  phaseTitle: z.string().nullable(),
  /** Task preview where the source exposes one (workflow promptPreview). */
  promptPreview: z.string().nullable(),
  activity: boardActivitySchema.nullable(),
  /** Compact final-output preview (truncated server-side). */
  outputPreview: z.string().nullable(),
  /**
   * Latest user-visible assistant-authored text (bounded excerpt). Strictly
   * conversational: never reasoning, tool/command output, or user/system
   * text. Optional because adapters without public assistant text (Redteam)
   * and list-only summary cards omit it.
   */
  latestPublicUpdate: z.string().nullable().optional(),
  /** Failure status/message where publicly available. */
  errorPreview: z.string().nullable(),
  tokens: z.number().nullable(),
  toolCalls: z.number().nullable(),
  /** Human explanation of what queued/waiting work is waiting on. */
  waitingOn: z.string().nullable(),
  /** Explicit unresolved operational condition; absent means no attention inference. */
  attention: z
    .object({ type: attentionTypeSchema, message: z.string().max(320) })
    .nullable()
    .optional(),
  /** Plan-step status when kind="plan-step". */
  planStatus: z.enum(["pending", "in_progress", "completed", "failed"]).nullable(),
  /** True for the board's root thread card. */
  isRoot: z.boolean(),
  /** Parent thread id for thread cards (null/absent for root-level cards). */
  parentThreadId: z.string().nullable().optional(),
  /** Source-defined order within the card's step group (plan/phase/agent list). */
  sequence: z.number().int().nonnegative().nullable().optional(),
  /** Step-group identity the card belongs to ("plan:<thread>", "redteam:<scan>", …). */
  groupKey: z.string().nullable().optional(),
  /** Optional source-owned correlation metadata; never required for BB cards. */
  jobId: z.string().max(80).optional(),
  serverName: z.string().max(120).nullable().optional(),
  originThreadId: z.string().max(120).optional(),
  originProjectId: z.string().max(120).optional(),
  scanId: z.string().optional(),
  phaseId: z.string().optional(),
  operationId: z.string().optional(),
});
export type BoardCard = z.infer<typeof boardCardSchema>;

export const boardRootSchema = z.object({
  threadId: z.string(),
  title: z.string().nullable(),
  status: z.string(),
  displayStatus: z.string().nullable(),
  providerId: z.string().nullable(),
  providerLabel: z.string().nullable(),
  model: z.string().nullable(),
  projectId: z.string().nullable(),
  createdAt: z.number().nullable(),
  updatedAt: z.number().nullable(),
  goal: z
    .object({
      objective: z.string(),
      status: z.enum(["active", "paused", "budgetLimited", "complete"]),
      tokensUsed: z.number(),
      tokenBudget: z.number().nullable(),
      timeUsedSeconds: z.number(),
    })
    .nullable(),
  contextWindowUsedTokens: z.number().nullable(),
  contextWindowTotalTokens: z.number().nullable(),
});
export type BoardRoot = z.infer<typeof boardRootSchema>;

export const boardCountsSchema = z.object({
  running: z.number(),
  waiting: z.number(),
  queued: z.number(),
  completed: z.number(),
  failed: z.number(),
  interrupted: z.number(),
});
export type BoardCounts = z.infer<typeof boardCountsSchema>;

const boardSnapshotSchema = z.object({
  root: boardRootSchema,
  counts: boardCountsSchema,
  cards: z.array(boardCardSchema),
  /** Bounded recent-activity feeds for the observed executions (focus view). */
  activityFeeds: z.array(boardActivityFeedSchema).optional(),
  /** True when caps truncated the observed tree; the board shows a notice. */
  partial: z.boolean(),
  fetchedAt: z.number(),
});
/** The output of board_snapshot, for the frontend (type-only import). */
export type BoardSnapshot = z.infer<typeof boardSnapshotSchema>;

/** One logical execution on the global operations dashboard. */
export const globalExecutionSchema = z.object({
  key: z.string(),
  /** Compact normalized card reused by the global and thread renderers. */
  card: boardCardSchema,
  projectId: z.string().nullable(),
  delegatedWorkers: z.array(boardCardSchema).max(4).optional(),
  delegatedWorkerCount: z.number().int().nonnegative().optional(),
  activeDelegatedWorkerCount: z.number().int().nonnegative().optional(),
  childCount: z.number().int().nonnegative(),
  activeChildCount: z.number().int().nonnegative(),
  updatedAt: z.number(),
});
export type GlobalExecution = z.infer<typeof globalExecutionSchema>;

/** One currently unresolved issue, suitable for a future notification consumer. */
export const attentionItemSchema = z.object({
  id: z.string(),
  executionKey: z.string(),
  type: attentionTypeSchema,
  status: z.literal("open"),
  title: z.string(),
  message: z.string().max(160),
  firstObservedAt: z.number(),
  updatedAt: z.number(),
  threadId: z.string().nullable(),
  source: boardCardSourceSchema,
  scanId: z.string().optional(),
});
export type AttentionItem = z.infer<typeof attentionItemSchema>;

/** Small, source-independent operational vocabulary for execution history. */
export const timelineEventKindSchema = z.enum([
  "execution-start",
  "execution-complete",
  "execution-failed",
  "execution-interrupted",
  "phase-start",
  "phase-complete",
  "phase-failed",
  "model-selected",
  "tool-start",
  "tool-complete",
  "tool-failed",
  "public-update",
  "waiting",
  "resumed",
  "approval-requested",
  "question-requested",
  "child-start",
  "child-complete",
  "child-failed",
  "delegation",
]);
export type TimelineEventKind = z.infer<typeof timelineEventKindSchema>;

export const timelineEventStatusSchema = z.enum([
  "pending",
  "running",
  "waiting",
  "completed",
  "failed",
  "interrupted",
  "resolved",
]);
export type TimelineEventStatus = z.infer<typeof timelineEventStatusSchema>;

/**
 * One normalized, bounded event. `sourceMetadata` carries identity/sequence
 * only — never a raw BB/adapter row or tool payload.
 */
export const timelineEventSchema = z.object({
  id: z.string().min(1).max(320),
  executionKey: z.string().min(1).max(240),
  source: boardCardSourceSchema,
  timestamp: z.number().int().nonnegative(),
  kind: timelineEventKindSchema,
  status: timelineEventStatusSchema.nullable(),
  title: z.string().min(1).max(120),
  summary: z.string().max(360).nullable(),
  model: z.string().max(160).nullable(),
  toolName: z.string().max(100).nullable(),
  target: z.string().max(240).nullable(),
  phase: z.string().max(120).nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  threadId: z.string().nullable(),
  attentionType: attentionTypeSchema.nullable(),
  sourceMetadata: z
    .object({
      sourceId: z.string().max(240),
      sequence: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
});
export type TimelineEvent = z.infer<typeof timelineEventSchema>;

export const executionTimelineSchema = z.object({
  executionKey: z.string().min(1).max(240),
  source: boardCardSourceSchema,
  events: z.array(timelineEventSchema).max(80),
  active: z.boolean(),
  /** True means older source rows or normalized events were omitted. */
  truncated: z.boolean(),
  /** Non-fatal degradation, e.g. lifecycle rows temporarily unavailable. */
  sourceWarning: z.string().max(240).nullable(),
  fetchedAt: z.number().int().nonnegative(),
});
export type ExecutionTimeline = z.infer<typeof executionTimelineSchema>;

const executionTimelineInputSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("ollama-fleet"),
    executionKey: z.string().min(1).max(240),
    jobId: z.string().min(1).max(80),
    limit: z.number().int().min(1).max(80).optional(),
  }),
  z.object({
    source: z.literal("bb"),
    executionKey: z.string().min(1).max(240),
    threadId: z.string().min(1).max(240),
    limit: z.number().int().min(1).max(80).optional(),
  }),
  z.object({
    source: z.literal("redteam"),
    executionKey: z.string().min(1).max(240),
    scanId: z.string().min(1).max(200),
    limit: z.number().int().min(1).max(80).optional(),
  }),
]);
export type ExecutionTimelineInput = z.infer<typeof executionTimelineInputSchema>;

export const globalDashboardCountsSchema = z.object({
  active: z.number().int().nonnegative(),
  waiting: z.number().int().nonnegative(),
  attention: z.number().int().nonnegative(),
  recent: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
});
export type GlobalDashboardCounts = z.infer<typeof globalDashboardCountsSchema>;

const globalDashboardSnapshotSchema = z.object({
  active: z.array(globalExecutionSchema),
  attention: z.array(attentionItemSchema),
  recent: z.array(globalExecutionSchema),
  counts: globalDashboardCountsSchema,
  unavailableSources: z.array(boardCardSourceSchema),
  partial: z.boolean(),
  /** Attention items currently hidden by user dismissal. */
  dismissedCount: z.number().int().nonnegative(),
  fetchedAt: z.number(),
});
export type GlobalDashboardSnapshot = z.infer<typeof globalDashboardSnapshotSchema>;

const boardActivityEntrySchema = z.object({
  text: z.string(),
  at: z.number(),
  kind: z.string().nullable(),
});

/** Realtime channel the backend publishes board invalidations on. */
export const BOARD_CHANGED_CHANNEL = "agent-board-changed";

export const boardChangedPayloadSchema = z.object({
  /** Roots whose snapshots are stale; a missing/empty list means "refetch any". */
  roots: z.array(z.string()),
  /** True when the global dashboard snapshot is stale. */
  global: z.boolean().optional(),
});

export const rpcContract = {
  /**
   * Normalized board for one root thread and its publicly visible
   * descendants/workflows. `fresh: true` bypasses the short-lived
   * response caches (used by the manual refresh control).
   */
  board_snapshot: {
    input: z.object({ threadId: z.string().min(1), fresh: z.boolean().optional() }),
    output: boardSnapshotSchema,
  },
  /** Bounded recent-activity tail for one thread (details expansion). */
  board_activity: {
    input: z.object({
      threadId: z.string().min(1),
      limit: z.number().int().min(1).max(60).optional(),
    }),
    output: z.object({ entries: z.array(boardActivityEntrySchema) }),
  },
  /** Lazily loaded bounded operational timeline for one BB/adapter execution. */
  execution_timeline: {
    input: executionTimelineInputSchema,
    output: executionTimelineSchema,
  },
  /** Bounded cross-project operational overview for the global nav page. */
  global_dashboard: {
    input: z.object({ fresh: z.boolean().optional() }),
    output: globalDashboardSnapshotSchema,
  },
  /**
   * Presentation-only: hide one attention item from the global dashboard.
   * Never mutates the underlying BB thread / Redteam scan / source state; the
   * item stays visible in Active/Recent sections until its condition changes.
   */
  dismiss_attention: {
    input: z.object({
      executionKey: z.string().min(1).max(200),
      type: attentionTypeSchema,
      /** Version of the underlying condition; a changed condition reappears. */
      updatedAt: z.number().int().min(0),
    }),
    output: z.object({ dismissed: z.number().int().nonnegative() }),
  },
  /** Presentation-only: forget every stored attention dismissal. */
  clear_dismissed_attentions: {
    input: z.object({}),
    output: z.object({ dismissed: z.number().int().nonnegative() }),
  },
} as const satisfies PluginRpcContract;
