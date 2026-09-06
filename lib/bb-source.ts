// bb-plugin-agent-board — the "bb" board source: pure normalization of public
// BB thread/workflow/delegation/plan data into the source-agnostic card model.
//
// This module is deliberately free of SDK *runtime* imports (the type import
// is erased at build time): everything here is a pure function over
// DTO-shaped inputs, so the normalization rules are exhaustively unit-tested
// without a host. lib/collect.ts is the only place that talks to bb.sdk.
//
// The contract the normalizer keeps:
// - No model reasoning/thinking text ever enters a card (denylisted event
//   types; reasoning never appears in timeline work rows).
// - Titles/labels/previews come only from data BB exposes intentionally:
//   thread titles, plan steps, delegation descriptions, workflow labels,
//   phase titles, prompt previews, tool names/summaries, work-row
//   presentation labels, outputs.
// - Statuses are mapped losslessly enough to drive column placement.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type {
  BoardActivity,
  BoardActivityFeed,
  BoardActivityFeedEntry,
  BoardCard,
  BoardCardStatus,
} from "../contract/rpc";
import {
  BOARD_LIMITS,
  columnForStatus,
  isActivityEventType,
  isReasoningEventType,
  previewText,
  publicUpdatePreview,
} from "./board-model";

// ---------------------------------------------------------------------------
// Structural DTO types, derived from the single public exported API type.
// The wire DTOs (ThreadResponse, TimelineRow, …) are not re-exported by the
// SDK entry, so every type below is computed from BbPluginApi instead.
// ---------------------------------------------------------------------------

export type Sdk = BbPluginApi["sdk"];
type Threads = Sdk["threads"];

/** One row of threads.list(): ThreadResponse plus activity/runtime extras. */
export type ThreadListRow = Awaited<ReturnType<Threads["list"]>>[number];
/** threads.get() result (with or without includes). */
export type ThreadGetResult = Awaited<ReturnType<Threads["get"]>>;
export type TimelineResponse = Awaited<ReturnType<Threads["timeline"]>>;
export type TimelineRow = TimelineResponse["rows"][number];
export type TimelineSystemRow = Extract<TimelineRow, { kind: "system" }>;
export type TimelineConversationRow = Extract<TimelineRow, { kind: "conversation" }>;
export type TimelineWorkRow = Extract<TimelineRow, { kind: "work" }>;
export type TimelineTurnRow = Extract<TimelineRow, { kind: "turn" }>;
export type WorkflowRow = Extract<TimelineWorkRow, { workKind: "workflow" }>;
export type WorkflowAgent = NonNullable<WorkflowRow["workflow"]>["agents"][number];
export type ThreadEventRow = Awaited<ReturnType<Sdk["threads"]["events"]["list"]>>[number];
export type QueuedMessageRow = Awaited<
  ReturnType<Sdk["threads"]["queuedMessages"]["list"]>
>[number];
export type ExecutionOptions = Awaited<ReturnType<Threads["defaultExecutionOptions"]>>;

/** The subset of a thread row the normalizer reads (satisfied by get/list rows). */
export interface ThreadRowLike {
  id: string;
  parentThreadId: string | null;
  projectId?: string | null;
  providerId: string | null;
  title: string | null;
  titleFallback: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
  queuedMessageCount?: number;
  hasPendingInteraction?: boolean;
  runtime?: { displayStatus?: string | null };
  originKind?: string | null;
  originPluginId?: string | null;
}

/** Everything the normalizer knows about one thread in the observed tree. */
export interface ThreadFacts {
  row: ThreadRowLike;
  timeline: TimelineResponse;
  /** Fetched only for threads in an error state (failure text lookup). */
  events?: ThreadEventRow[];
  /** Last assistant text from threads.output(); fetched for idle threads. */
  output?: string | null;
  /** Model resolved from threads.defaultExecutionOptions(). */
  model?: string | null;
  /** Fetched when queuedMessageCount > 0. */
  queuedMessages?: QueuedMessageRow[];
  isRoot: boolean;
  depth: number;
  /** Direct child thread ids from the tree walk. */
  childThreadIds: string[];
}

export interface NormalizeContext {
  /** providerId → display name, from the providers area. */
  providerLabel: (providerId: string | null) => string | null;
}

// ---------------------------------------------------------------------------
// Row helpers
// ---------------------------------------------------------------------------

/** Flatten turn rows into their source children; keeps order stable. */
export function flattenRows(rows: readonly TimelineRow[]): TimelineRow[] {
  const out: TimelineRow[] = [];
  const walk = (list: readonly TimelineRow[]) => {
    for (const row of list) {
      out.push(row);
      if (row.kind === "turn" && Array.isArray(row.children)) walk(row.children);
    }
  };
  walk(rows);
  return out;
}

function isWorkRow(row: TimelineRow): row is TimelineWorkRow {
  return row.kind === "work";
}

/** Work rows, latest-last, suppressed presentations dropped. */
export function workRows(rows: readonly TimelineRow[]): TimelineWorkRow[] {
  return flattenRows(rows)
    .filter(isWorkRow)
    .filter(
      (row) =>
        !("presentation" in row && row.presentation?.suppress === true),
    )
    .sort((a, b) => a.sourceSeqEnd - b.sourceSeqEnd);
}

/** Presentation label for a work row, falling back to per-kind content. */
export function activityTextForWorkRow(row: TimelineWorkRow): string {
  // presentation is declared on most (not all) work-row variants.
  const presentation = (
    "presentation" in row ? row.presentation : undefined
  ) as { label?: { completed?: string; pending?: string } } | undefined;
  const label = presentation?.label;
  if (label) {
    const chosen = row.status === "completed" ? label.completed : label.pending;
    if (typeof chosen === "string" && chosen.length > 0) return chosen;
  }
  switch (row.workKind) {
    case "command":
      return row.command;
    case "tool":
      return row.toolName;
    case "search":
      return row.mode === "content" ? `Search: ${row.query}` : `Search in ${row.path ?? ""}`;
    case "web-search":
      return `Web search: ${row.queries[0] ?? ""}`;
    case "web-fetch":
      return `Fetch: ${row.url}`;
    case "file-read":
      return row.path;
    case "file-change":
      return row.change.path;
    case "image-view":
      return row.path;
    case "plan-steps":
      return "Planning";
    case "delegation":
      return row.description ?? "Delegating";
    case "workflow":
      return row.description ?? "Workflow";
    case "question":
      return row.questions[0]?.prompt ?? "Asking";
    case "approval":
      return row.target?.toolName ? `Approve: ${row.target.toolName}` : "Approval";
    default:
      return row.workKind;
  }
}

/** Latest meaningful activity for a thread card, from its work rows. */
export function latestActivity(rows: readonly TimelineRow[]): BoardActivity | null {
  const works = workRows(rows);
  const last = works[works.length - 1];
  if (!last) return null;
  const completedAt = "completedAt" in last ? (last.completedAt ?? null) : null;
  return {
    text: previewText(activityTextForWorkRow(last), BOARD_LIMITS.activityChars) ?? last.workKind,
    at: completedAt ?? last.startedAt,
    kind: last.workKind,
  };
}

/**
 * Latest user-visible assistant-authored text for a thread, from the newest
 * conversation row with role "assistant". Semantically distinct from
 * latestActivity (work-row activity): this is the agent's own public prose —
 * never reasoning (which never appears in timeline conversation rows), never
 * tool/command output, never user/system/system-message text (those are the
 * role "user" conversation variants). Pure over the already-fetched timeline;
 * no second fetch per thread. Returns null when no assistant text exists.
 */
export function latestPublicUpdate(rows: readonly TimelineRow[]): string | null {
  const conversations = flattenRows(rows).filter(
    (row): row is TimelineConversationRow =>
      row.kind === "conversation" && "role" in row && row.role === "assistant",
  );
  const last = conversations.sort((a, b) => a.sourceSeqEnd - b.sourceSeqEnd).at(-1);
  if (last === undefined) return null;
  return publicUpdatePreview(last.text);
}

/** Compact human label for a work kind (recent-activity rows). */
export function workKindLabel(workKind: string): string {
  switch (workKind) {
    case "file-read":
      return "read";
    case "file-change":
      return "edit";
    case "web-search":
      return "web search";
    case "web-fetch":
      return "fetch";
    case "plan-steps":
      return "plan";
    case "image-view":
      return "view";
    default:
      return workKind;
  }
}

/**
 * Bounded recent-activity feed for one thread, built from the same safe work
 * rows the card activity uses: newest first, at most
 * BOARD_LIMITS.feedEntriesPerExecution entries, no reasoning, no raw output.
 */
export function recentActivityFeed(
  threadId: string,
  rows: readonly TimelineRow[],
): BoardActivityFeed {
  const works = workRows(rows).slice(-BOARD_LIMITS.feedEntriesPerExecution);
  const entries: BoardActivityFeedEntry[] = [];
  for (let index = works.length - 1; index >= 0; index -= 1) {
    const row = works[index]!;
    const completedAt = "completedAt" in row ? (row.completedAt ?? null) : null;
    entries.push({
      id: row.id,
      label: workKindLabel(row.workKind),
      detail: previewText(activityTextForWorkRow(row), BOARD_LIMITS.activityChars),
      at: completedAt ?? row.startedAt,
      kind: row.workKind,
    });
  }
  return { key: `thread:${threadId}`, entries };
}

/** True when a thread's latest rows show work blocked on a human decision. */
export function hasBlockingInteraction(rows: readonly TimelineRow[]): boolean {
  return blockingInteractionKind(rows) !== null;
}

/** Latest explicit human-blocking interaction, never inferred from prose. */
export function blockingInteractionKind(
  rows: readonly TimelineRow[],
): "approval" | "question" | null {
  const works = workRows(rows);
  for (let index = works.length - 1; index >= 0; index -= 1) {
    const row = works[index]!;
    if ("approvalStatus" in row && row.approvalStatus === "waiting_for_approval") {
      return "approval";
    }
    if (row.workKind === "approval") {
      if (row.lifecycle === "waiting" || row.lifecycle === "pending") return "approval";
    }
    if (row.workKind === "question") {
      if (row.lifecycle === "pending" || row.lifecycle === "resolving") return "question";
    }
  }
  return null;
}

/** Latest turn row (the thread's current/last turn), or null. */
export function latestTurn(rows: readonly TimelineRow[]): TimelineTurnRow | null {
  const turns = flattenRows(rows)
    .filter((row): row is TimelineTurnRow => row.kind === "turn")
    .sort((a, b) => a.sourceSeqEnd - b.sourceSeqEnd);
  return turns[turns.length - 1] ?? null;
}

/** Failure text for an errored thread: latest error-bearing event or system row. */
export function errorPreviewFor(
  facts: Pick<ThreadFacts, "events" | "timeline">,
): string | null {
  for (const event of [...(facts.events ?? [])].reverse()) {
    const data = event.data as Record<string, unknown> | undefined;
    const message =
      (typeof data?.error === "string" && data.error) ||
      (typeof data?.message === "string" && data.message) ||
      null;
    const detail = typeof data?.detail === "string" ? data.detail : null;
    const text =
      message && detail
        ? `${message} — ${detail}`
        : (message ?? detail);
    if (text) return previewText(text, BOARD_LIMITS.activityChars);
  }
  const systemError = flattenRows(facts.timeline.rows)
    .filter((row): row is TimelineSystemRow => row.kind === "system")
    .filter((row) => row.systemKind === "error")
    .sort((a, b) => a.sourceSeqEnd - b.sourceSeqEnd)
    .at(-1);
  if (systemError) {
    return previewText(
      systemError.detail ? `${systemError.title} — ${systemError.detail}` : systemError.title,
      BOARD_LIMITS.activityChars,
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Thread status normalization
// ---------------------------------------------------------------------------

/** Map a thread row onto a board status. Waiting beats running; queued beats idle. */
export function threadBoardStatus(
  row: ThreadRowLike,
  rows: readonly TimelineRow[],
): BoardCardStatus {
  const display = row.runtime?.displayStatus ?? null;
  if (display === "waiting-for-host" || display === "host-reconnecting") return "waiting";
  if (row.hasPendingInteraction === true) return "waiting";
  if (hasBlockingInteraction(rows)) return "waiting";
  switch (row.status) {
    case "starting":
      return "starting";
    case "active":
      return "running";
    case "pending":
      return "queued";
    case "stopping":
      return "interrupted";
    case "error":
      return "failed";
    case "idle": {
      if ((row.queuedMessageCount ?? 0) > 0) return "queued";
      return "completed";
    }
    default:
      return "completed";
  }
}

function waitingOnText(facts: ThreadFacts): string | null {
  const display = facts.row.runtime?.displayStatus;
  if (display === "waiting-for-host") return "Waiting for host";
  if (display === "host-reconnecting") return "Reconnecting to host";
  if (facts.row.hasPendingInteraction === true) return "Waiting for you";
  const interaction = blockingInteractionKind(facts.timeline.rows);
  if (interaction === "approval") return "Approval required";
  if (interaction === "question") return "Input required";
  const queued = facts.queuedMessages?.find((message) => message.waitingOn);
  if (queued?.waitingOn) return waitingOnLabel(queued.waitingOn);
  return null;
}

/** Humanize a queued message's waitingOn reason. */
export function waitingOnLabel(waitingOn: QueuedMessageRow["waitingOn"]): string {
  if (!waitingOn) return "Queued";
  switch (waitingOn.kind) {
    case "time":
      return "Waiting for scheduled time";
    case "thread-busy":
      return "Waiting for busy thread";
    case "turn-starting":
      return "Waiting for turn to start";
    case "provisioning":
      return "Waiting for provisioning";
    case "host-offline":
      return `Waiting for host ${waitingOn.hostName}`;
    case "interaction":
      return "Waiting for interaction";
    case "plugin":
      return `Waiting for plugin ${waitingOn.pluginId}`;
    default:
      return "Queued";
  }
}

// ---------------------------------------------------------------------------
// Card builders
// ---------------------------------------------------------------------------

function threadTitle(facts: ThreadFacts, delegationLabel: string | null): string {
  return (
    facts.row.title ??
    previewText(facts.row.titleFallback, 80) ??
    delegationLabel ??
    (facts.row.originPluginId ? `Plugin: ${facts.row.originPluginId}` : "Thread")
  );
}

function threadStartEnd(
  facts: ThreadFacts,
  status: BoardCardStatus,
): {
  startedAt: number | null;
  completedAt: number | null;
} {
  const turn = latestTurn(facts.timeline.rows);
  if (status !== "running") {
    return turn
      ? { startedAt: turn.startedAt, completedAt: turn.completedAt }
      : { startedAt: facts.row.createdAt, completedAt: null };
  }
  if (turn !== null && turn.completedAt === null) {
    return { startedAt: turn.startedAt, completedAt: turn.completedAt };
  }
  // The thread runs but every visible turn row already finished: a long
  // in-flight turn generates more rows than the bounded segment holds, so its
  // opening row was trimmed. Approximate from the oldest visible row of a
  // turn newer than the last finished one so the live timer tracks current
  // work instead of rewinding to an old turn.
  const approximated = runningTurnStart(facts.timeline.rows, turn);
  if (approximated !== null) {
    return { startedAt: approximated, completedAt: null };
  }
  return turn
    ? { startedAt: turn.startedAt, completedAt: turn.completedAt }
    : { startedAt: facts.row.createdAt, completedAt: null };
}

/**
 * Oldest visible row of the newest visible turn, when that turn is newer than
 * the last finished turn row; null otherwise.
 */
function runningTurnStart(rows: readonly TimelineRow[], lastTurn: TimelineTurnRow | null): number | null {
  const flat = flattenRows(rows).sort((a, b) => a.sourceSeqEnd - b.sourceSeqEnd);
  const newestTurnId = [...flat].reverse().find((row) => row.turnId !== null)?.turnId ?? null;
  if (newestTurnId === null) return null;
  if (lastTurn !== null && newestTurnId === lastTurn.turnId) return null;
  const oldest = flat.find((row) => row.turnId === newestTurnId);
  return oldest ? oldest.startedAt : null;
}

/**
 * Normalize one thread's facts into cards: the thread card itself, plan-step
 * cards, workflow-agent cards, delegation cards (only for delegations whose
 * child is not itself observed), and queued-message cards.
 */
export function normalizeThread(
  facts: ThreadFacts,
  ctx: NormalizeContext,
  delegation: { label: string | null; output: string | null } | null,
): BoardCard[] {
  const cards: BoardCard[] = [];
  const status = threadBoardStatus(facts.row, facts.timeline.rows);
  const { startedAt, completedAt } = threadStartEnd(facts, status);
  const providerId = facts.row.providerId ?? null;
  const threadKey = `thread:${facts.row.id}`;
  const errorPreview = status === "failed" ? errorPreviewFor(facts) : null;
  const waitingOn = status === "waiting" || status === "queued" ? waitingOnText(facts) : null;
  const interaction = blockingInteractionKind(facts.timeline.rows);
  const attention: BoardCard["attention"] =
    status === "failed"
      ? { type: "failed", message: errorPreview ?? "Execution failed" }
      : status === "interrupted"
        ? { type: "interrupted", message: "Execution was interrupted" }
        : status === "waiting" && (interaction !== null || facts.row.hasPendingInteraction === true)
          ? {
              type: "action-required",
              message: interaction === "question" ? "Input required" : interaction === "approval" ? "Approval required" : "Waiting for you",
            }
          : status === "waiting"
            ? { type: "waiting", message: waitingOn ?? "Execution is waiting" }
            : null;

  const threadCard: BoardCard = {
    key: threadKey,
    parentKey: null,
    depth: facts.depth,
    kind: "thread",
    source: "bb",
    title: threadTitle(facts, delegation?.label ?? null),
    subtitle: delegation?.label
      ? delegation.label
      : facts.isRoot
        ? "parent thread"
        : facts.row.originPluginId
          ? `plugin · ${facts.row.originPluginId}`
          : "child thread",
    status,
    column: columnForStatus(status, "thread"),
    threadId: facts.row.id,
    providerId,
    providerLabel: ctx.providerLabel(providerId),
    model: facts.model ?? null,
    startedAt,
    completedAt,
    durationMs:
      startedAt !== null && completedAt !== null ? completedAt - startedAt : null,
    phaseTitle: null,
    promptPreview: null,
    activity: latestActivity(facts.timeline.rows),
    outputPreview:
      previewText(facts.output ?? delegation?.output ?? null, BOARD_LIMITS.outputPreviewChars) ??
      null,
    latestPublicUpdate: latestPublicUpdate(facts.timeline.rows),
    errorPreview,
    tokens: null,
    toolCalls: null,
    waitingOn,
    attention,
    planStatus: null,
    isRoot: facts.isRoot,
    parentThreadId: facts.isRoot ? null : (facts.row.parentThreadId ?? null),
  };
  cards.push(threadCard);

  // --- Plan steps: explicit todos win; fall back to the latest plan row. ---
  for (const card of planStepCards(facts, threadKey)) cards.push(card);

  // --- Workflow agents (kanban-style subagents inside the thread). ---
  for (const card of workflowCards(facts, threadKey)) cards.push(card);

  // --- Delegations whose child thread is not itself observed. ---
  for (const card of delegationCards(facts, threadKey)) cards.push(card);

  // --- Queued messages: work waiting to start. ---
  for (const card of queuedMessageCards(facts, threadKey)) cards.push(card);

  return cards;
}

function planStepCards(facts: ThreadFacts, parentKey: string): BoardCard[] {
  const items = facts.timeline.pendingTodos?.items;
  if (items && items.length > 0) {
    return items.map((item, index) => {
      const status: BoardCardStatus =
        item.status === "in_progress"
          ? "running"
          : item.status === "pending"
            ? "queued"
            : "completed";
      return {
        key: `plan:${facts.row.id}:${item.id}`,
        parentKey,
        depth: facts.depth + 1,
        kind: "plan-step" as const,
        source: "bb" as const,
        title: item.text,
        subtitle: null,
        status,
        column: "plan" as const,
        threadId: facts.row.id,
        providerId: null,
        providerLabel: null,
        model: null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
        phaseTitle: null,
        promptPreview: null,
        activity: null,
        outputPreview: null,
        errorPreview: null,
        tokens: null,
        toolCalls: null,
        waitingOn: item.status === "pending" ? "Not started" : null,
        planStatus:
          item.status === "in_progress"
            ? ("in_progress" as const)
            : item.status === "pending"
              ? ("pending" as const)
              : ("completed" as const),
        isRoot: false,
        groupKey: `plan:${facts.row.id}`,
        sequence: index,
      };
    });
  }
  // Fall back to the newest plan-steps work row.
  const planRow = workRows(facts.timeline.rows)
    .filter((row) => row.workKind === "plan-steps")
    .at(-1);
  if (!planRow || planRow.workKind !== "plan-steps") return [];
  return planRow.steps.map((step, index) => {
    const planStatus =
      step.status === "active"
        ? ("in_progress" as const)
        : step.status === "failed"
          ? ("failed" as const)
          : step.status === "completed"
            ? ("completed" as const)
            : ("pending" as const);
    const status: BoardCardStatus =
      planStatus === "in_progress"
        ? "running"
        : planStatus === "failed"
          ? "failed"
          : planStatus === "completed"
            ? "completed"
            : "queued";
    return {
      key: `plan:${facts.row.id}:${planRow.id}:${index}`,
      parentKey,
      depth: facts.depth + 1,
      kind: "plan-step" as const,
      source: "bb" as const,
      title: step.step,
      subtitle: null,
      status,
      column: "plan" as const,
      threadId: facts.row.id,
      providerId: null,
      providerLabel: null,
      model: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      phaseTitle: null,
      promptPreview: null,
      activity: null,
      outputPreview: null,
      errorPreview: null,
      tokens: null,
      toolCalls: null,
      waitingOn: planStatus === "pending" ? "Not started" : null,
      planStatus,
      isRoot: false,
      groupKey: `plan:${facts.row.id}`,
      sequence: index,
    };
  });
}

/** Collect workflow-ish rows from every place the timeline exposes them. */
export function workflowItems(facts: ThreadFacts): WorkflowRow[] {
  const byKey = new Map<string, WorkflowRow>();
  const add = (row: WorkflowRow) => {
    const key = row.itemId ?? row.id;
    if (!byKey.has(key)) byKey.set(key, row);
  };
  for (const row of facts.timeline.activeWorkflows) add(row);
  for (const row of facts.timeline.activeBackgroundCommands) add(row);
  for (const row of workRows(facts.timeline.rows)) {
    if (row.workKind === "workflow") add(row);
  }
  return [...byKey.values()];
}

function agentBoardStatus(state: WorkflowAgent["state"]): BoardCardStatus {
  switch (state) {
    case "running":
      return "running";
    case "queued":
      return "queued";
    case "done":
      return "completed";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
  }
}

function workflowCards(facts: ThreadFacts, parentKey: string): BoardCard[] {
  const cards: BoardCard[] = [];
  for (const workflow of workflowItems(facts)) {
    const agents = workflow.workflow?.agents ?? [];
    if (agents.length > 0) {
      for (const agent of agents) {
        const status = agentBoardStatus(agent.state);
        const activity: BoardActivity | null =
          agent.state === "running"
            ? agent.lastToolSummary || agent.lastToolName
              ? {
                  text: previewText(
                    agent.lastToolSummary ?? agent.lastToolName ?? "",
                    BOARD_LIMITS.activityChars,
                  ) ?? (agent.lastToolName ?? "Working"),
                  at: agent.lastProgressAt,
                  kind: agent.lastToolName ?? "tool",
                }
              : null
            : agent.state === "queued"
              ? { text: "Queued", at: agent.queuedAt ?? workflow.startedAt, kind: "queue" }
              : null;
        cards.push({
          key: `agent:${facts.row.id}:${workflow.itemId}:${agent.index}:${agent.attempt}`,
          parentKey,
          depth: facts.depth + 1,
          kind: "workflow-agent",
          source: "bb",
          title: agent.label,
          subtitle: agent.agentType ?? null,
          status,
          column: columnForStatus(status, "workflow-agent"),
          threadId: facts.row.id,
          providerId: facts.row.providerId ?? null,
          providerLabel: null,
          model: agent.model ?? workflow.model ?? null,
          startedAt: agent.startedAt ?? agent.queuedAt ?? null,
          completedAt: agent.state === "done" || agent.state === "failed" ? (agent.durationMs ? (agent.startedAt ?? 0) + agent.durationMs : null) : null,
          durationMs: agent.durationMs ?? null,
          phaseTitle: agent.phaseTitle ?? null,
          promptPreview: previewText(agent.promptPreview ?? null, BOARD_LIMITS.promptPreviewChars),
          activity,
          outputPreview: previewText(agent.resultPreview ?? null, BOARD_LIMITS.outputPreviewChars),
          errorPreview: previewText(agent.error ?? null, BOARD_LIMITS.activityChars),
          tokens: agent.tokens ?? null,
          toolCalls: agent.toolCalls ?? null,
          waitingOn: agent.state === "queued" ? "Waiting for a slot" : null,
          attention:
            status === "failed"
              ? { type: "failed", message: previewText(agent.error ?? null, BOARD_LIMITS.activityChars) ?? "Agent failed" }
              : null,
          planStatus: null,
          isRoot: false,
          groupKey: `workflow:${facts.row.id}:${workflow.itemId ?? workflow.id}`,
          sequence: agent.index,
        });
      }
    } else {
      // No agent breakdown: one card for the workflow itself.
      const status: BoardCardStatus =
        workflow.taskStatus === "running"
          ? "running"
          : workflow.taskStatus === "pending"
            ? "queued"
            : workflow.taskStatus === "failed" || workflow.status === "error"
              ? "failed"
              : workflow.status === "interrupted"
                ? "interrupted"
                : workflow.taskStatus === "paused"
                  ? "waiting"
                  : "completed";
      cards.push({
        key: `workflow:${facts.row.id}:${workflow.itemId ?? workflow.id}`,
        parentKey,
        depth: facts.depth + 1,
        kind: "workflow-agent",
        source: "bb",
        title: workflow.description,
        subtitle: workflow.workflowName ?? null,
        status,
        column: columnForStatus(status, "workflow-agent"),
        threadId: facts.row.id,
        providerId: facts.row.providerId ?? null,
        providerLabel: null,
        model: workflow.model ?? null,
        startedAt: workflow.startedAt,
        completedAt: workflow.completedAt,
        durationMs: workflow.usage?.durationMs ?? null,
        phaseTitle: null,
        promptPreview: null,
        activity: { text: workflow.description, at: workflow.startedAt, kind: "workflow" },
        outputPreview: previewText(workflow.summary ?? null, BOARD_LIMITS.outputPreviewChars),
        errorPreview: previewText(workflow.error ?? null, BOARD_LIMITS.activityChars),
        tokens: workflow.usage?.totalTokens ?? null,
        toolCalls: workflow.usage?.toolUses ?? null,
        waitingOn: status === "queued" ? "Waiting for a slot" : null,
        attention:
          status === "failed"
            ? { type: "failed", message: previewText(workflow.error ?? null, BOARD_LIMITS.activityChars) ?? "Workflow failed" }
            : status === "interrupted"
              ? { type: "interrupted", message: "Workflow was interrupted" }
              : status === "waiting"
                ? { type: "waiting", message: "Workflow is paused" }
                : null,
        planStatus: null,
        isRoot: false,
        groupKey: `workflow:${facts.row.id}:${workflow.itemId ?? workflow.id}`,
        sequence: 0,
      });
    }
  }
  return cards;
}

function delegationCards(facts: ThreadFacts, parentKey: string): BoardCard[] {
  const cards: BoardCard[] = [];
  for (const row of workRows(facts.timeline.rows)) {
    if (row.workKind !== "delegation") continue;
    const delegation = row;
    // A resolvable child thread gets its own live card; skip the duplicate.
    const childObserved =
      delegation.childRef !== null && facts.childThreadIds.includes(delegation.childRef);
    if (childObserved) continue;
    const status: BoardCardStatus =
      delegation.status === "completed"
        ? "completed"
        : delegation.status === "error"
          ? "failed"
          : delegation.status === "interrupted"
            ? "interrupted"
            : "running";
    cards.push({
      key: `delegation:${facts.row.id}:${delegation.id}`,
      parentKey,
      depth: facts.depth + 1,
      kind: "delegation",
      source: "bb",
      title: delegation.description ?? delegation.childRef ?? "Delegated task",
      subtitle: delegation.background ? "background delegation" : "delegation",
      status,
      column: columnForStatus(status, "delegation"),
      threadId: delegation.childRef,
      providerId: null,
      providerLabel: null,
      model: null,
      startedAt: delegation.startedAt,
      completedAt: delegation.completedAt,
      durationMs:
        delegation.completedAt !== null
          ? delegation.completedAt - delegation.startedAt
          : null,
      phaseTitle: null,
      promptPreview: null,
      activity: null,
      outputPreview: previewText(delegation.output, BOARD_LIMITS.outputPreviewChars),
      errorPreview: null,
      tokens: null,
      toolCalls: null,
      waitingOn: null,
      attention:
        status === "failed"
          ? { type: "failed", message: "Delegated execution failed" }
          : status === "interrupted"
            ? { type: "interrupted", message: "Delegated execution was interrupted" }
            : null,
      planStatus: null,
      isRoot: false,
    });
  }
  return cards;
}

function queuedMessageCards(facts: ThreadFacts, parentKey: string): BoardCard[] {
  const messages = facts.queuedMessages ?? [];
  const cards: BoardCard[] = [];
  for (const message of messages.slice(0, 3)) {
    const text = message.content
      .filter((part): part is Extract<(typeof message.content)[number], { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join(" ");
    cards.push({
      key: `queued:${message.id}`,
      parentKey,
      depth: facts.depth + 1,
      kind: "queued-message",
      source: "bb",
      title: previewText(text, BOARD_LIMITS.promptPreviewChars) ?? "Queued message",
      subtitle: message.waitingOn ? waitingOnLabel(message.waitingOn) : "Queued",
      status: "queued",
      column: "plan",
      threadId: facts.row.id,
      providerId: null,
      providerLabel: null,
      model: message.model ?? null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
      phaseTitle: null,
      promptPreview: null,
      activity: null,
      outputPreview: null,
      errorPreview: null,
      tokens: null,
      toolCalls: null,
      waitingOn: message.waitingOn ? waitingOnLabel(message.waitingOn) : "Queued",
      planStatus: null,
      isRoot: false,
    });
  }
  return cards;
}

// ---------------------------------------------------------------------------
// Event activity tail (details view + error lookup)
// ---------------------------------------------------------------------------

const EVENT_FALLBACK_LABELS: Record<string, string> = {
  "client/turn/start": "Turn started",
  "client/turn/requested": "Turn requested",
  "client/turn/rejected": "Turn rejected",
  "item/started": "Work started",
  "item/completed": "Work completed",
  "provider/error": "Provider error",
  "provider/modelFallback": "Model fallback",
  "provider/unhandled": "Provider issue",
  "system/error": "Error",
  "system/thread/interrupted": "Thread interrupted",
  "thread/started": "Thread started",
  "thread/compacted": "History compacted",
};

/**
 * Normalize event rows into a bounded activity tail. Reasoning events are
 * refused outright (denylist + allowlist), so model thinking never reaches
 * the board even though BB exposes those events publicly.
 */
export function activityFromEvents(events: readonly ThreadEventRow[]): BoardActivity[] {
  const out: BoardActivity[] = [];
  for (const event of events) {
    if (isReasoningEventType(event.type)) continue;
    if (!isActivityEventType(event.type)) continue;
    const data = event.data as Record<string, unknown> | undefined;
    const item = data?.item as Record<string, unknown> | undefined;
    const presentation = item?.presentation as
      | { label?: { pending?: string; completed?: string } }
      | undefined;
    const candidate =
      presentation?.label?.pending ??
      (typeof item?.label === "string" ? item.label : undefined) ??
      (typeof item?.description === "string" ? item.description : undefined) ??
      (typeof data?.error === "string" ? data.error : undefined) ??
      (typeof data?.message === "string" ? data.message : undefined) ??
      EVENT_FALLBACK_LABELS[event.type] ??
      event.type;
    out.push({
      text: previewText(candidate, BOARD_LIMITS.activityChars) ?? candidate,
      at: event.createdAt,
      kind: event.type.split("/")[0] ?? null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Root summary
// ---------------------------------------------------------------------------

export function rootSummary(
  facts: ThreadFacts,
  ctx: NormalizeContext,
): {
  threadId: string;
  title: string | null;
  status: string;
  displayStatus: string | null;
  providerId: string | null;
  providerLabel: string | null;
  model: string | null;
  projectId: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  goal: {
    objective: string;
    status: "active" | "paused" | "budgetLimited" | "complete";
    tokensUsed: number;
    tokenBudget: number | null;
    timeUsedSeconds: number;
  } | null;
  contextWindowUsedTokens: number | null;
  contextWindowTotalTokens: number | null;
} {
  const goal = facts.timeline.goal ?? null;
  const context = facts.timeline.contextWindowUsage ?? null;
  return {
    threadId: facts.row.id,
    title: facts.row.title ?? previewText(facts.row.titleFallback, 120),
    status: facts.row.status,
    displayStatus: facts.row.runtime?.displayStatus ?? null,
    providerId: facts.row.providerId ?? null,
    providerLabel: ctx.providerLabel(facts.row.providerId ?? null),
    model: facts.model ?? null,
    projectId: facts.row.projectId ?? null,
    createdAt: facts.row.createdAt,
    updatedAt: facts.row.updatedAt,
    goal: goal
      ? {
          objective: goal.objective,
          status: goal.status,
          tokensUsed: goal.tokensUsed,
          tokenBudget: goal.tokenBudget ?? null,
          timeUsedSeconds: goal.timeUsedSeconds,
        }
      : null,
    contextWindowUsedTokens: context?.usedTokens ?? null,
    contextWindowTotalTokens: context?.modelContextWindow ?? null,
  };
}
