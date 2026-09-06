// bb-plugin-agent-board — the single-agent focus view model.
//
// Pure derivation: normalized snapshot → "is the user watching ONE logical
// active execution?" → a generic focus layout model. No SDK imports, no
// React, no source-specific branching: Redteam and BB both express executions
// through the generic card fields (parentKey, parentThreadId, scanId,
// groupKey, sequence).
//
// ---------------------------------------------------------------------------
// LOGICAL ACTIVE EXECUTION — grouping rule
// ---------------------------------------------------------------------------
// 1. The ACTIVE set is every card with status running / starting / waiting:
//    work that is executing right now, or blocked (e.g. on an approval) while
//    still being the thing the user is watching.
// 2. Active cards are linked into one LOGICAL EXECUTION when:
//    a. one is the parent of the other (non-thread cards via parentKey, when
//       the parent card is itself active) — a thread plus its in-progress plan
//       steps / running workflow agents / delegations is ONE execution;
//    b. a thread card's parent thread card is also active (parentThreadId
//       link) — a root turn that delegated to one child is ONE execution
//       chain; a root orchestrating several children is still one execution
//       while the root's turn runs;
//    c. Redteam cards share a scanId — a scan's active phase and its current
//       operation records are ONE execution. Different scans never merge.
//    BB and Redteam cards never merge (disjoint link spaces).
// 3. FOCUS MODE activates exactly when the active set forms ONE linked group
//    that contains at least one hero-eligible card (kind thread,
//    workflow-agent, delegation, phase, or operation). Plan steps and queued
//    messages are pipeline/queue material, never the hero. Two independent
//    active executions (e.g. two Redteam scans, or one Redteam scan plus one
//    running BB child with an idle root) keep the multi-agent Kanban board.
//
// The hero is the most specific executing card: deepest first (a running
// child thread beats its running root), then the freshest activity, then a
// stable key order — so the card identity survives routine activity updates.
import type {
  BoardActivityFeedEntry,
  BoardCard,
  BoardCardStatus,
  BoardSnapshot,
} from "../contract/rpc";

/** Statuses that mean "this is work being watched right now". */
export const FOCUS_ACTIVE_STATUSES: ReadonlySet<BoardCardStatus> = new Set([
  "running",
  "starting",
  "waiting",
]);

/** Card kinds that can be the hero of a focus view. */
export const FOCUS_HERO_KINDS: ReadonlySet<BoardCard["kind"]> = new Set([
  "thread",
  "workflow-agent",
  "delegation",
  "phase",
  "operation",
]);

/** Pipeline node states — state only, never a fabricated percentage. */
export type FocusStepState =
  | "completed"
  | "active"
  | "pending"
  | "failed"
  | "interrupted"
  | "skipped";

/** One node of the pipeline / progress track. */
export interface FocusStepNode {
  key: string;
  title: string;
  state: FocusStepState;
  /** Source-defined order within the step group. */
  sequence: number;
  durationMs: number | null;
  /** Bounded summary text (e.g. "1 candidate") for completed nodes. */
  summary: string | null;
  error: string | null;
}

/** Compact completed/failed row under the hero. */
export interface FocusCompletedRow {
  key: string;
  title: string;
  status: BoardCardStatus;
  durationMs: number | null;
  summary: string | null;
  error: string | null;
}

/** Compact queued row ("up next"). */
export interface FocusUpNextRow {
  key: string;
  title: string;
  waitingOn: string | null;
  sequence: number | null;
}

/** The derived single-agent focus layout model. */
export interface FocusModel {
  /** The primary executing card (stable key across activity updates). */
  hero: BoardCard;
  /** Truthful hero label, derived from the card kind — never fakes "agent". */
  heroLabel: string;
  /** Other active cards in the same execution (e.g. a running root turn). */
  peers: BoardCard[];
  /** Truthful discrete pipeline nodes, or null when none exist. */
  pipeline: FocusStepNode[] | null;
  /** Bounded newest-first recent activity for the execution. */
  recent: BoardActivityFeedEntry[];
  /** Newest observed operation while the hero executes (tool · target). */
  latestOperation: BoardActivityFeedEntry | null;
  /** Completed / failed / interrupted supporting work. */
  completed: FocusCompletedRow[];
  /** Queued supporting work ("up next"). */
  upNext: FocusUpNextRow[];
  /** Cards outside the execution (idle root, other scans, old work). */
  other: BoardCard[];
  /** `other` cards whose failure/interruption must stay visible. */
  otherAttention: BoardCard[];
}

/** True when the status means "being watched right now". */
export function isFocusActiveStatus(status: BoardCardStatus): boolean {
  return FOCUS_ACTIVE_STATUSES.has(status);
}

function stepState(status: BoardCardStatus): FocusStepState {
  switch (status) {
    case "running":
    case "starting":
      return "active";
    case "queued":
      return "pending";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    case "skipped":
      return "skipped";
    default:
      return "pending";
  }
}

/** Truthful label for the hero card by kind. */
export function heroLabelFor(kind: BoardCard["kind"]): string {
  switch (kind) {
    case "workflow-agent":
      return "ACTIVE AGENT";
    case "phase":
    case "operation":
      return "ACTIVE PHASE";
    case "delegation":
      return "DELEGATED TASK";
    default:
      return "CURRENT EXECUTION";
  }
}

/** The card's own recency signal (activity beat, else start time). */
function recencyOf(card: BoardCard): number {
  return card.activity?.at ?? card.startedAt ?? Number.NEGATIVE_INFINITY;
}

/** Hero preference: deepest, then freshest activity, then stable key order. */
function heroRank(card: BoardCard): number {
  return card.depth * 1_000_000_000 + Math.max(0, recencyOf(card));
}

function pickHero(group: BoardCard[]): BoardCard | null {
  let best: BoardCard | null = null;
  for (const card of group) {
    if (!FOCUS_HERO_KINDS.has(card.kind)) continue;
    if (
      best === null ||
      heroRank(card) > heroRank(best) ||
      (heroRank(card) === heroRank(best) && card.key < best.key)
    ) {
      best = card;
    }
  }
  return best;
}

/**
 * Link active cards into logical executions (connected components).
 * Returns every component; each is a non-empty array of active cards.
 */
export function groupExecutions(cards: readonly BoardCard[]): BoardCard[][] {
  const active = cards.filter((card) => isFocusActiveStatus(card.status));
  const index = new Map<string, number>();
  active.forEach((card, position) => index.set(card.key, position));
  const parent = active.map((_, position) => position);
  const find = (position: number): number => {
    while (parent[position] !== position) {
      parent[position] = parent[parent[position]]!;
      position = parent[position]!;
    }
    return position;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  // Link (a) children to active parents and (b) BB threads to active parents.
  const threadById = new Map<string, number>();
  active.forEach((card, position) => {
    if (card.kind === "thread" && card.threadId !== null) threadById.set(card.threadId, position);
  });
  active.forEach((card, position) => {
    if (card.parentKey !== null) {
      const parentPosition = index.get(card.parentKey);
      if (parentPosition !== undefined) union(position, parentPosition);
    }
    if (
      card.kind === "thread" &&
      card.parentThreadId !== null &&
      card.parentThreadId !== undefined &&
      card.parentThreadId !== ""
    ) {
      const parentPosition = threadById.get(card.parentThreadId);
      if (parentPosition !== undefined) union(position, parentPosition);
    }
  });

  // Link (c) Redteam cards of the same scan.
  const byScan = new Map<string, number>();
  active.forEach((card, position) => {
    if (card.source !== "redteam" || card.scanId === undefined) return;
    const first = byScan.get(card.scanId);
    if (first === undefined) byScan.set(card.scanId, position);
    else union(position, first);
  });

  const components = new Map<number, BoardCard[]>();
  active.forEach((card, position) => {
    const root = find(position);
    const list = components.get(root) ?? [];
    list.push(card);
    components.set(root, list);
  });
  return [...components.values()];
}

/** Feed key for the hero's execution: scans by scanId, threads by thread id. */
function feedKeyFor(hero: BoardCard, cards: readonly BoardCard[]): string | null {
  if (hero.source === "ollama-fleet") return hero.key;
  if (hero.source === "redteam" && hero.scanId !== undefined) return `redteam:${hero.scanId}`;
  if (hero.threadId !== null) return `thread:${hero.threadId}`;
  // A delegation without a resolvable child: fall back to the parent thread.
  if (hero.parentKey !== null) {
    const parentCard = cards.find((card) => card.key === hero.parentKey);
    if (parentCard !== undefined && parentCard.threadId !== null) {
      return `thread:${parentCard.threadId}`;
    }
  }
  return null;
}

/**
 * The execution's supporting cards: everything that belongs to the same
 * narrative but is not itself an active group member — the scan's other
 * phases, the owning threads' plan steps / queued messages / delegations /
 * workflow agents, and (for a workflow-agent hero) its workflow siblings.
 */
function supportingCards(hero: BoardCard, group: BoardCard[], cards: readonly BoardCard[]): BoardCard[] {
  const memberKeys = new Set(group.map((card) => card.key));
  const groupThreadKeys = new Set(
    group.filter((card) => card.kind === "thread").map((card) => card.key),
  );
  return cards.filter((card) => {
    if (memberKeys.has(card.key)) return false;
    if (hero.source === "redteam") {
      return hero.scanId !== undefined && card.scanId === hero.scanId;
    }
    if (card.parentKey !== null && groupThreadKeys.has(card.parentKey)) return true;
    if (
      hero.kind === "workflow-agent" &&
      hero.groupKey !== null &&
      hero.groupKey !== undefined &&
      card.groupKey === hero.groupKey &&
      card.key !== hero.key
    ) {
      return true;
    }
    return false;
  });
}

/** The step-group key whose ordered cards form the pipeline, if truthful. */
function pipelineGroupKey(
  hero: BoardCard,
  supporting: readonly BoardCard[],
): string | null {
  if (hero.kind === "phase" || hero.kind === "operation" || hero.kind === "workflow-agent") {
    return hero.groupKey ?? null;
  }
  if (hero.kind !== "thread") return null; // delegations have no step list
  const heroKey = hero.key;
  const planSteps = supporting.filter(
    (card) => card.kind === "plan-step" && card.parentKey === heroKey,
  );
  if (planSteps.length > 0) return planSteps[0]!.groupKey ?? null;
  // No plan: a single observed workflow's agents can be the truthful pipeline.
  const workflowGroups = new Set(
    supporting
      .filter((card) => card.kind === "workflow-agent" && card.parentKey === heroKey && card.groupKey !== null && card.groupKey !== undefined)
      .map((card) => card.groupKey as string),
  );
  return workflowGroups.size === 1 ? [...workflowGroups][0]! : null;
}

/** Order helper: sequence first, then recency, then key. */
function bySequenceThenRecency(a: BoardCard, b: BoardCard): number {
  const sa = a.sequence ?? Number.MAX_SAFE_INTEGER;
  const sb = b.sequence ?? Number.MAX_SAFE_INTEGER;
  if (sa !== sb) return sa - sb;
  const ra = a.completedAt ?? a.startedAt ?? Number.NEGATIVE_INFINITY;
  const rb = b.completedAt ?? b.startedAt ?? Number.NEGATIVE_INFINITY;
  if (ra !== rb) return rb - ra;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function bySequenceThenKey(a: BoardCard, b: BoardCard): number {
  const sa = a.sequence ?? Number.MAX_SAFE_INTEGER;
  const sb = b.sequence ?? Number.MAX_SAFE_INTEGER;
  if (sa !== sb) return sa - sb;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Derive the single-agent focus model from a normalized snapshot.
 * Returns null whenever the board should stay in multi-agent Kanban mode:
 * no active work, no hero-eligible execution, or more than one independent
 * execution being watched.
 */
export function buildFocusModel(snapshot: BoardSnapshot): FocusModel | null {
  if (snapshot.cards.length === 0) return null;
  // Concurrent real local workers remain individual Kanban cards.
  if (snapshot.cards.filter(c => c.source === "ollama-fleet" && isFocusActiveStatus(c.status)).length > 1) return null;
  const groups = groupExecutions(snapshot.cards);
  const eligible = groups.filter((group) => pickHero(group) !== null);
  if (eligible.length !== 1) return null;
  const group = eligible[0]!;
  const hero = pickHero(group)!;
  const peers = group
    .filter((card) => card.key !== hero.key)
    .sort((a, b) => b.depth - a.depth || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const supporting = supportingCards(hero, group, snapshot.cards);

  // Pipeline: ordered step cards of one truthful step group. Active group
  // members (the hero and its peers) are nodes of their own pipeline too.
  const stepGroup = pipelineGroupKey(hero, supporting);
  let pipeline: FocusStepNode[] | null = null;
  if (stepGroup !== null) {
    const stepPool = [...group, ...supporting];
    const nodes = stepPool
      .filter(
        (card) =>
          card.groupKey === stepGroup &&
          card.sequence !== null &&
          card.sequence !== undefined &&
          card.sequence >= 0,
      )
      .sort(bySequenceThenKey)
      .map<FocusStepNode>((card) => ({
        key: card.key,
        title: card.title,
        state: stepState(card.status),
        sequence: card.sequence!,
        durationMs: card.durationMs,
        summary: card.outputPreview,
        error: card.errorPreview,
      }));
    pipeline = nodes.length >= 2 ? nodes : null;
  }

  // Recent activity feed for the hero's execution.
  const feedKey = feedKeyFor(hero, snapshot.cards);
  const recent =
    feedKey !== null
      ? (snapshot.activityFeeds ?? []).find((feed) => feed.key === feedKey)?.entries.slice(
          0,
          6,
        ) ?? []
      : [];
  const latestOperation =
    hero.status === "running" || hero.status === "starting"
      ? recent[0] ?? null
      : null;

  const memberKeys = new Set([...group.map((card) => card.key), ...supporting.map((card) => card.key)]);
  const other = snapshot.cards.filter((card) => !memberKeys.has(card.key));
  const otherAttention = other.filter(
    (card) => card.status === "failed" || card.status === "interrupted",
  );

  const completed = supporting
    .filter(
      (card) =>
        card.status === "completed" ||
        card.status === "failed" ||
        card.status === "interrupted" ||
        card.status === "skipped",
    )
    .sort(bySequenceThenRecency)
    .map<FocusCompletedRow>((card) => ({
      key: card.key,
      title: card.title,
      status: card.status,
      durationMs: card.durationMs,
      summary: card.outputPreview,
      error: card.errorPreview,
    }));

  const upNext = supporting
    .filter((card) => card.status === "queued")
    .sort(bySequenceThenKey)
    .map<FocusUpNextRow>((card) => ({
      key: card.key,
      title: card.title,
      waitingOn: card.waitingOn,
      sequence: card.sequence ?? null,
    }));

  return {
    hero,
    heroLabel: hero.source === "ollama-fleet" ? "CURRENT DELEGATED WORK" : heroLabelFor(hero.kind),
    peers,
    pipeline,
    recent,
    latestOperation,
    completed,
    upNext,
    other,
    otherAttention,
  };
}