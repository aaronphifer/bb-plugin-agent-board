// Pure global-dashboard derivation. Source adapters supply normalized cards;
// this module groups operational state without knowing BB or Redteam DTOs.
import type {
  AttentionItem,
  AttentionType,
  BoardCard,
  BoardCardSource,
  BoardCardStatus,
  GlobalDashboardSnapshot,
  GlobalExecution,
} from "../contract/rpc";
import {
  BOARD_LIMITS,
  columnForStatus,
  previewText,
  redactOperationalText,
} from "./board-model";
import { attentionDismissalKey } from "./dismissals";

/** Generic source-boundary input for one independent logical execution. */
export interface GlobalExecutionGroup {
  key: string;
  source: BoardCardSource;
  title: string;
  threadId: string | null;
  projectId: string | null;
  scanId?: string;
  cards: BoardCard[];
  delegatedWorkers?: BoardCard[];
  updatedAt: number;
}

export interface GlobalSourceResult {
  groups: GlobalExecutionGroup[];
  partial: boolean;
  available: boolean;
}

const STATUS_PRIORITY: readonly BoardCardStatus[] = [
  "running",
  "starting",
  "waiting",
  "queued",
  "failed",
  "interrupted",
  "completed",
  "skipped",
];

const ATTENTION_PRIORITY: Record<AttentionType, number> = {
  "action-required": 0,
  failed: 1,
  waiting: 2,
  interrupted: 3,
  warning: 4,
};

function executionStatus(cards: readonly BoardCard[]): BoardCardStatus {
  for (const status of STATUS_PRIORITY) {
    if (cards.some((card) => card.kind !== "plan-step" && card.status === status)) return status;
  }
  return "completed";
}

function representative(cards: readonly BoardCard[], status: BoardCardStatus): BoardCard | null {
  return [...cards]
    .filter((card) => card.kind !== "plan-step" && card.status === status)
    .sort((a, b) => {
      const usefulA = Number(a.activity !== null) + Number(a.model !== null) + Number(!a.isRoot);
      const usefulB = Number(b.activity !== null) + Number(b.model !== null) + Number(!b.isRoot);
      if (usefulA !== usefulB) return usefulB - usefulA;
      const atA = a.activity?.at ?? a.completedAt ?? a.startedAt ?? 0;
      const atB = b.activity?.at ?? b.completedAt ?? b.startedAt ?? 0;
      return atB - atA;
    })[0] ?? null;
}

/** Collapse normalized source cards into one compact global execution card. */
export function buildGlobalExecution(group: GlobalExecutionGroup): GlobalExecution {
  const workers = group.delegatedWorkers ?? [];
  const activeWorkers = workers.filter(c => c.status === "running" || c.status === "starting");
  const status = activeWorkers.length ? "running" : executionStatus(group.cards);
  const primary = representative(group.cards, status) ?? group.cards[0] ?? null;
  const children = group.cards.filter(
    (card) => !card.isRoot && card.kind !== "plan-step" && card.kind !== "queued-message",
  );
  const activeChildren = children.filter(
    (card) => card.status === "running" || card.status === "starting",
  );
  const phaseTitle =
    primary?.phaseTitle ??
    (primary !== null && primary.title !== group.title ? primary.title : null);
  const startedAt = primary?.startedAt ?? null;
  const completedAt = primary?.completedAt ?? null;
  const durationMs = primary?.durationMs ??
    (startedAt !== null && completedAt !== null ? Math.max(0, completedAt - startedAt) : null);
  const sourceLabel = group.source === "bb" ? "BB" : group.source === "ollama-fleet" ? "Ollama Fleet" : "Redteam";
  const latestPublicUpdate = pickLatestPublicUpdate(group.cards);

  const card: BoardCard = {
    key: `global:${group.key}`,
    parentKey: null,
    depth: 0,
    kind: group.source === "bb" ? "thread" : "phase",
    source: group.source,
    title: group.title,
    subtitle: sourceLabel,
    status,
    column: columnForStatus(status, group.source === "bb" ? "thread" : "phase"),
    threadId: primary?.threadId ?? group.threadId,
    providerId: primary?.providerId ?? null,
    providerLabel: primary?.providerLabel ?? null,
    model: primary?.model ?? null,
    serverName: primary?.serverName ?? null,
    ...(primary?.jobId ? { jobId: primary.jobId } : {}),
    startedAt,
    completedAt,
    durationMs,
    phaseTitle,
    // A global aggregation never broadens prompt visibility.
    promptPreview: null,
    activity: primary?.activity ?? null,
    outputPreview: primary?.outputPreview ?? null,
    latestPublicUpdate,
    errorPreview: primary?.errorPreview ?? null,
    tokens: primary?.tokens ?? null,
    toolCalls: primary?.toolCalls ?? null,
    waitingOn: primary?.waitingOn ?? null,
    attention: primary?.attention ?? null,
    planStatus: null,
    isRoot: false,
    parentThreadId: null,
    ...(group.scanId ? { scanId: group.scanId } : {}),
    ...(primary?.phaseId ? { phaseId: primary.phaseId } : {}),
    ...(primary?.operationId ? { operationId: primary.operationId } : {}),
  };

  return {
    key: group.key,
    card,
    projectId: group.projectId,
    ...(workers.length ? { delegatedWorkers: [...workers].sort((a,b) => Number(b.status === "running" || b.status === "starting") - Number(a.status === "running" || a.status === "starting")).slice(0,4), delegatedWorkerCount: workers.length, activeDelegatedWorkerCount: activeWorkers.length } : {}),
    childCount: children.length,
    activeChildCount: activeChildren.length,
    updatedAt: group.updatedAt,
  };
}

/**
 * Most recent assistant-authored public text among a group's cards (the
 * scoped panel renders per-thread state; the excerpt exists for the global
 * active cards). Cards without the field (Redteam, list-only summaries)
 * contribute nothing, so the excerpt is simply omitted for them.
 */
function pickLatestPublicUpdate(cards: readonly BoardCard[]): string | null {
  let best: { text: string; at: number } | null = null;
  for (const card of cards) {
    if (card.kind === "plan-step" || card.kind === "queued-message") continue;
    const text = card.latestPublicUpdate;
    if (typeof text !== "string" || text.length === 0) continue;
    const at = card.activity?.at ?? card.completedAt ?? card.startedAt ?? 0;
    if (best === null || at >= best.at) best = { text, at };
  }
  return best?.text ?? null;
}

function safeAttentionMessage(message: string): string {
  return (
    previewText(redactOperationalText(message), BOARD_LIMITS.activityChars) ??
    "Needs attention"
  );
}

function pluralAttention(type: AttentionType, count: number): string {
  switch (type) {
    case "action-required":
      return `${count} actions require your input`;
    case "failed":
      return `${count} execution steps failed`;
    case "waiting":
      return `${count} execution steps are waiting`;
    case "interrupted":
      return `${count} execution steps were interrupted`;
    case "warning":
      return `${count} operational warnings`;
  }
}

/**
 * One item per execution and attention type. Duplicate parent/child signals
 * collapse, while genuinely different issue types remain independently
 * actionable. Resolution is automatic: absent card metadata means absent item.
 */
export function deriveAttentionItems(
  groups: readonly GlobalExecutionGroup[],
  now: number,
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const group of groups) {
    const byType = new Map<AttentionType, BoardCard[]>();
    for (const card of group.cards) {
      const attention = card.attention;
      if (!attention) continue;
      const terminal = attention.type === "failed" || attention.type === "interrupted";
      if (terminal && now - group.updatedAt > BOARD_LIMITS.terminalAttentionWindowMs) continue;
      const bucket = byType.get(attention.type) ?? [];
      bucket.push(card);
      byType.set(attention.type, bucket);
    }
    for (const [type, cards] of byType) {
      const newest = [...cards].sort((a, b) => {
        const atA = a.activity?.at ?? a.completedAt ?? a.startedAt ?? group.updatedAt;
        const atB = b.activity?.at ?? b.completedAt ?? b.startedAt ?? group.updatedAt;
        return atB - atA;
      })[0]!;
      const observedTimes = cards.map(
        (card) => card.activity?.at ?? card.startedAt ?? group.updatedAt,
      );
      const message =
        cards.length === 1
          ? safeAttentionMessage(newest.attention!.message)
          : pluralAttention(type, cards.length);
      items.push({
        id: `attention:${group.key}:${type}`,
        executionKey: group.key,
        type,
        status: "open",
        title: group.title,
        message,
        firstObservedAt: Math.min(...observedTimes),
        updatedAt: group.updatedAt,
        threadId: newest.threadId ?? group.threadId,
        source: group.source,
        ...(group.scanId ? { scanId: group.scanId } : {}),
      });
    }
  }
  return items
    .sort(
      (a, b) =>
        ATTENTION_PRIORITY[a.type] - ATTENTION_PRIORITY[b.type] ||
        b.updatedAt - a.updatedAt ||
        a.id.localeCompare(b.id),
    )
    .slice(0, BOARD_LIMITS.globalAttentionItems);
}

/** Build the complete bounded global page model from independently collected sources. */
export function buildGlobalDashboard(
  groups: readonly GlobalExecutionGroup[],
  options: {
    now: number;
    partial?: boolean;
    unavailableSources?: BoardCardSource[];
    /** Dismissed attention conditions (presentation-only filtering). */
    dismissedKeys?: ReadonlySet<string>;
  },
): GlobalDashboardSnapshot {
  const executions = groups.map(buildGlobalExecution);
  const active = executions
    .filter((execution) =>
      ["running", "starting", "waiting", "queued"].includes(execution.card.status),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, BOARD_LIMITS.globalActiveExecutions);
  const recent = executions
    .filter((execution) =>
      ["completed", "failed", "interrupted", "skipped"].includes(execution.card.status),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, BOARD_LIMITS.globalRecentExecutions);
  const allAttention = deriveAttentionItems(groups, options.now);
  const dismissed = options.dismissedKeys ?? new Set<string>();
  const attention = allAttention.filter(
    (item) => !dismissed.has(attentionDismissalKey(item)),
  );
  const dismissedCount = allAttention.length - attention.length;
  return {
    active,
    attention,
    recent,
    counts: {
      active: active.filter(
        (execution) => execution.card.status === "running" || execution.card.status === "starting",
      ).length,
      waiting: active.filter(
        (execution) => execution.card.status === "waiting" || execution.card.status === "queued",
      ).length,
      attention: attention.length,
      recent: recent.length,
      failures: attention.filter((item) => item.type === "failed").length,
    },
    unavailableSources: [...new Set(options.unavailableSources ?? [])],
    partial: options.partial === true,
    dismissedCount,
    fetchedAt: options.now,
  };
}
