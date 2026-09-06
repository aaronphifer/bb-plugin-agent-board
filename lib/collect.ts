// bb-plugin-agent-board — bounded bb.sdk fan-out and snapshot assembly.
//
// This is the ONLY module that performs SDK calls. Everything is derived
// state: responses are cached ephemerally (short TTLs, request coalescing)
// purely as performance data — nothing here is authoritative, and a plugin
// reload starts from scratch with BB as the source of truth.
//
// Bounded by BOARD_LIMITS: thread count, depth, timeline segments, event
// tail, preview lengths. `partial` flags a truncated tree so the board can
// say so instead of lying by omission.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { BoardCard, ExecutionTimeline, ExecutionTimelineInput, GlobalDashboardSnapshot } from "../contract/rpc";
import { BOARD_LIMITS, columnForStatus, countCards, previewText } from "./board-model";
import {
  activityFromEvents,
  normalizeThread,
  recentActivityFeed,
  rootSummary,
  threadBoardStatus,
  type NormalizeContext,
  type QueuedMessageRow,
  type Sdk,
  type ThreadEventRow,
  type ThreadFacts,
  type ThreadGetResult,
  type ThreadListRow,
  type ThreadRowLike,
  type TimelineResponse,
} from "./bb-source";
import { RedteamBoardSource } from "./redteam-source";
import type { BoardActivityFeed } from "../contract/rpc";
import {
  buildGlobalDashboard,
  type GlobalExecutionGroup,
  type GlobalSourceResult,
} from "./global-model";
import { FleetSource, scopedFleetCards, addFleetGroups, fleetTimelineEvents, fleetActive } from "./fleet-source";
import { normalizeBbTimeline } from "./timeline-model";

/** Output of board_snapshot (shape matches contract/rpc.ts). */
export interface BoardSnapshot {
  root: ReturnType<typeof rootSummary>;
  counts: ReturnType<typeof countCards>;
  cards: BoardCard[];
  activityFeeds?: BoardActivityFeed[];
  partial: boolean;
  fetchedAt: number;
}

const TTL = {
  children: 1_000,
  timeline: 2_000,
  events: 2_000,
  output: 3_000,
  model: 60_000,
  providers: 60_000,
  snapshot: 1_200,
  globalSnapshot: 1_200,
  executionTimelineActive: 1_500,
  executionTimelineTerminal: 60_000,
} as const;

interface CacheEntry<V> {
  at: number;
  value: V;
}

export class BoardCollector {
  private readonly sdk: Sdk;
  private readonly now: () => number;
  private readonly childrenCache = new Map<string, CacheEntry<ThreadListRow[]>>();
  private readonly timelineCache = new Map<string, CacheEntry<TimelineResponse>>();
  private readonly eventsCache = new Map<string, CacheEntry<ThreadEventRow[]>>();
  private readonly outputCache = new Map<string, CacheEntry<string | null>>();
  private readonly modelCache = new Map<string, CacheEntry<string | null>>();
  private providersCache: CacheEntry<Map<string, string>> | null = null;
  private readonly inflight = new Map<string, { promise: Promise<BoardSnapshot>; generation: number }>();
  private readonly snapshotCache = new Map<string, CacheEntry<BoardSnapshot>>();
  private globalSnapshotCache: CacheEntry<GlobalDashboardSnapshot> | null = null;
  private globalInflight: { promise: Promise<GlobalDashboardSnapshot>; generation: number } | null = null;
  private readonly executionTimelineCache = new Map<string, CacheEntry<ExecutionTimeline>>();
  private readonly executionTimelineInflight = new Map<string, { promise: Promise<ExecutionTimeline>; generation: number }>();
  private readonly redteam: RedteamBoardSource;
  private readonly fleet: FleetSource;
  /**
   * Cache/inflight generations. Every invalidate() bumps them, so a collect
   * that STARTED before an invalidation never serves a snapshot afterwards:
   * the race where a terminal-state flush refetches while a pre-terminal
   * collect is still in flight previously returned (and re-cached) the stale
   * RUNNING result forever, because terminal threads emit no further change
   * signals. Same-generation requests still coalesce exactly as before.
   */
  private generation = 0;
  private globalGeneration = 0;

  constructor(bb: BbPluginApi, now: () => number = () => Date.now()) {
    this.sdk = bb.sdk;
    this.now = now;
    this.redteam = new RedteamBoardSource(bb, now);
    this.fleet = new FleetSource(bb, now);
  }

  // -- cache helpers -------------------------------------------------------

  private async cached<V>(
    store: Map<string, CacheEntry<V>>,
    key: string,
    ttl: number,
    load: () => Promise<V>,
  ): Promise<V> {
    const hit = store.get(key);
    if (hit && this.now() - hit.at < ttl) return hit.value;
    const value = await load();
    store.set(key, { at: this.now(), value });
    return value;
  }

  /** Drop cached responses so the next read reflects live BB state. */
  invalidate(invalidateFleet = true): void {
    if (invalidateFleet) this.fleet.invalidate();
    this.generation += 1;
    this.globalGeneration += 1;
    this.childrenCache.clear();
    this.timelineCache.clear();
    this.eventsCache.clear();
    this.outputCache.clear();
    this.modelCache.clear();
    this.snapshotCache.clear();
    this.globalSnapshotCache = null;
    this.executionTimelineCache.clear();
    this.redteam.invalidate();
  }

  /** Drop only the global snapshot so the next global read reflects a
   * presentation-only change (attention dismissal) without disturbing the
   * per-thread caches. */
  invalidateGlobal(): void {
    this.globalGeneration += 1;
    this.globalSnapshotCache = null;
  }

  // -- individual reads ----------------------------------------------------

  private childrenOf(threadId: string): Promise<ThreadListRow[]> {
    return this.cached(this.childrenCache, threadId, TTL.children, async () =>
      this.sdk.threads.list({ parentThreadId: threadId, includeHidden: true }),
    );
  }

  private timelineOf(threadId: string): Promise<TimelineResponse> {
    return this.cached(this.timelineCache, threadId, TTL.timeline, async () =>
      this.sdk.threads.timeline({
        threadId,
        includeNestedRows: "true",
        segmentLimit: String(BOARD_LIMITS.timelineSegmentLimit),
      }),
    );
  }

  private eventsTail(threadId: string): Promise<ThreadEventRow[]> {
    return this.cached(this.eventsCache, threadId, TTL.events, async () =>
      this.sdk.threads.events.list({
        threadId,
        order: "desc",
        limit: String(BOARD_LIMITS.eventTailLimit),
      }),
    );
  }

  private outputOf(threadId: string): Promise<string | null> {
    return this.cached(this.outputCache, threadId, TTL.output, async () => {
      const result = await this.sdk.threads.output({ threadId });
      return result.output ?? null;
    });
  }

  private modelOf(threadId: string): Promise<string | null> {
    return this.cached(this.modelCache, threadId, TTL.model, async () => {
      try {
        const options = await this.sdk.threads.defaultExecutionOptions({ threadId });
        return options?.model ?? null;
      } catch {
        return null; // thread may not have resolvable options yet
      }
    });
  }

  private async providerLabels(): Promise<Map<string, string>> {
    if (this.providersCache && this.now() - this.providersCache.at < TTL.providers) {
      return this.providersCache.value;
    }
    const map = new Map<string, string>();
    try {
      const providers = await this.sdk.providers.list();
      for (const provider of providers) {
        map.set(provider.id, provider.displayName ?? provider.id);
      }
    } catch {
      // Labels are cosmetic; ids still render.
    }
    this.providersCache = { at: this.now(), value: map };
    return map;
  }

  private async queuedMessagesOf(threadId: string): Promise<QueuedMessageRow[]> {
    try {
      return await this.sdk.threads.queuedMessages.list({ threadId });
    } catch {
      return [];
    }
  }

  // -- tree walk -----------------------------------------------------------

  private async walkTree(
    rootRow: ThreadRowLike,
  ): Promise<{
    rows: ThreadRowLike[];
    depths: Map<string, number>;
    childIds: Map<string, string[]>;
    partial: boolean;
  }> {
    const rows: ThreadRowLike[] = [rootRow];
    const depths = new Map<string, number>([[rootRow.id, 0]]);
    const childIds = new Map<string, string[]>([[rootRow.id, []]]);
    const queue: Array<{ id: string; depth: number }> = [{ id: rootRow.id, depth: 0 }];
    const seen = new Set<string>([rootRow.id]);
    let partial = false;
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (depth >= BOARD_LIMITS.maxDepth) {
        // Depth frontier: one bounded probe so `partial` tells the truth about
        // unseen deeper threads (we never walk them).
        const deeper = await this.childrenOf(id);
        if (deeper.length > 0) partial = true;
        continue;
      }
      const children = await this.childrenOf(id);
      const ids: string[] = [];
      for (const child of children) {
        if (seen.has(child.id)) continue;
        if (rows.length >= BOARD_LIMITS.maxThreads) {
          partial = true;
          break;
        }
        seen.add(child.id);
        rows.push(child);
        depths.set(child.id, depth + 1);
        ids.push(child.id);
        childIds.set(child.id, []);
        queue.push({ id: child.id, depth: depth + 1 });
      }
      childIds.set(id, ids);
      if (rows.length >= BOARD_LIMITS.maxThreads) {
        partial = true;
        break;
      }
    }
    return { rows, depths, childIds, partial };
  }

  // -- snapshot ------------------------------------------------------------
  //
  // One normalized board for a root thread and its publicly visible
  // descendants. The BB source remains authoritative for generic cards; the
  // optional Redteam adapter contributes normalized cards at the boundary.

  async snapshot(rootThreadId: string, options?: { fresh?: boolean }): Promise<BoardSnapshot> {
    const fresh = options?.fresh === true;
    if (!fresh) {
      const hit = this.snapshotCache.get(rootThreadId);
      if (hit && this.now() - hit.at < TTL.snapshot) return hit.value;
    }
    const generation = this.generation;
    const existing = this.inflight.get(rootThreadId);
    if (existing && existing.generation === generation) return existing.promise;
    const promise = this.collect(rootThreadId, fresh).finally(() => {
      if (this.inflight.get(rootThreadId)?.promise === promise) {
        this.inflight.delete(rootThreadId);
      }
    });
    this.inflight.set(rootThreadId, { promise, generation });
    const snapshot = await promise;
    // Never let a collect that started before an invalidation re-poison the
    // cache with a fresh timestamp: only current-generation results cache.
    if (this.generation === generation) {
      this.snapshotCache.set(rootThreadId, { at: this.now(), value: snapshot });
    }
    return snapshot;
  }

  private async collect(rootThreadId: string, fresh: boolean): Promise<BoardSnapshot> {
    const root: ThreadGetResult = await this.sdk.threads.get({ threadId: rootThreadId });
    const rootRow = root as ThreadRowLike;
    const labels = await this.providerLabels();
    const ctx: NormalizeContext = {
      providerLabel: (id) => (id && labels.get(id)) || null,
    };

    const { rows, depths, childIds, partial } = await this.walkTree(rootRow);
    const cards: BoardCard[] = [];

    // Delegation items live on the PARENT's timeline; pre-index them by
    // childRef so each observed child card can carry its task label/output.
    const delegationsByChild = new Map<
      string,
      { label: string | null; output: string | null }
    >();
    const timelines = new Map<string, TimelineResponse>();
    for (const row of rows) {
      const timeline = await this.timelineOf(row.id);
      timelines.set(row.id, timeline);
      for (const item of delegationIndex(timeline)) {
        if (item.childRef && !delegationsByChild.has(item.childRef)) {
          delegationsByChild.set(item.childRef, {
            label: item.label,
            output: item.output,
          });
        }
      }
    }

    for (const row of rows) {
      const timeline = timelines.get(row.id);
      if (!timeline) continue;
      const isRoot = row.id === rootThreadId;
      const needsOutput = row.status === "idle" || (!isRoot && row.status === "error");
      const needsEvents = row.status === "error";
      const [model, output, events, queuedMessages] = await Promise.all([
        this.modelOf(row.id),
        needsOutput ? this.outputOf(row.id) : Promise.resolve(null),
        needsEvents ? this.eventsTail(row.id) : Promise.resolve(undefined),
        (row.queuedMessageCount ?? 0) > 0
          ? this.queuedMessagesOf(row.id)
          : Promise.resolve(undefined),
      ]);
      const facts: ThreadFacts = {
        row,
        timeline,
        events,
        output: output ?? undefined,
        model,
        queuedMessages,
        isRoot,
        depth: depths.get(row.id) ?? (isRoot ? 0 : 1),
        childThreadIds: childIds.get(row.id) ?? [],
      };
      const delegation = isRoot ? null : (delegationsByChild.get(row.id) ?? null);
      for (const card of normalizeThread(facts, ctx, delegation)) cards.push(card);
    }

    // Root summary carries goal + context window usage from the root timeline.
    const rootTimeline = timelines.get(rootThreadId);
    if (rootTimeline === undefined) {
      // Cannot happen: the root row is walked first, but the type demands it.
      throw new Error("Agent Board: root timeline missing");
    }
    const rootFacts: ThreadFacts = {
      row: rootRow,
      timeline: rootTimeline,
      isRoot: true,
      depth: 0,
      childThreadIds: childIds.get(rootThreadId) ?? [],
      model: await this.modelOf(rootThreadId),
    };

    const rootValue = rootSummary(rootFacts, ctx);
    const redteam = await this.redteam.collect(rootValue.projectId, { fresh });
    cards.push(...redteam.cards);
    this.fleet.hintFromCards(cards);
    const fleet = scopedFleetCards(await this.fleet.collect(fresh), new Map(rows.map(r => [r.id, r.projectId ?? null])));
    cards.push(...fleet.cards);

    // Bounded recent-activity feeds: one per live-observed BB thread (the
    // focus view's tail), plus the Redteam per-scan operation feeds.
    const activityFeeds: BoardActivityFeed[] = [];
    for (const row of rows) {
      const timeline = timelines.get(row.id);
      if (!timeline) continue;
      const status = threadBoardStatus(row, timeline.rows);
      if (status !== "running" && status !== "starting" && status !== "waiting") continue;
      activityFeeds.push(recentActivityFeed(row.id, timeline.rows));
    }
    activityFeeds.push(...redteam.activityFeeds);

    return {
      root: rootValue,
      counts: countCards(cards),
      cards,
      activityFeeds,
      partial: partial || redteam.partial || fleet.partial,
      fetchedAt: this.now(),
    };
  }

  pollFleet() { return this.fleet.poll(); }
  isFleetActive() { return this.fleet.isActive(); }

  /** Fresh optional-source probe used only by the active-scan poller. */
  pollRedteam(projectId: string): Promise<{ changed: boolean; active: boolean }> {
    return this.redteam.poll(projectId);
  }

  isRedteamActive(projectId: string | null): boolean { return this.redteam.isActive(projectId); }

  /** Bounded cross-project overview used by the stable global nav page. */
  async globalDashboard(options?: {
    fresh?: boolean;
    dismissedKeys?: ReadonlySet<string>;
  }): Promise<GlobalDashboardSnapshot> {
    const fresh = options?.fresh === true;
    if (!fresh && this.globalSnapshotCache && this.now() - this.globalSnapshotCache.at < TTL.globalSnapshot) {
      return this.globalSnapshotCache.value;
    }
    const generation = this.globalGeneration;
    if (this.globalInflight && this.globalInflight.generation === generation) {
      return this.globalInflight.promise;
    }
    const promise = this.collectGlobal(fresh, options?.dismissedKeys).finally(() => {
      if (this.globalInflight?.promise === promise) this.globalInflight = null;
    });
    this.globalInflight = { promise, generation };
    const snapshot = await promise;
    if (this.globalGeneration === generation) {
      this.globalSnapshotCache = { at: this.now(), value: snapshot };
    }
    return snapshot;
  }

  private async collectGlobal(
    fresh: boolean,
    dismissedKeys?: ReadonlySet<string>,
  ): Promise<GlobalDashboardSnapshot> {
    const [bbResult, redteamResult, fleetResult] = await Promise.allSettled([
      this.collectGlobalBb(),
      this.redteam.collectGlobal({ fresh }),
      this.fleet.collect(fresh),
    ]);
    const groups: GlobalExecutionGroup[] = [];
    const unavailable: Array<"bb" | "redteam"> = [];
    let partial = false;

    if (bbResult.status === "fulfilled") {
      groups.push(...bbResult.value.groups);
      partial ||= bbResult.value.partial;
      if (!bbResult.value.available) unavailable.push("bb");
    } else {
      unavailable.push("bb");
      partial = true;
    }
    if (redteamResult.status === "fulfilled") {
      groups.push(...redteamResult.value.groups);
      partial ||= redteamResult.value.partial;
      if (!redteamResult.value.available) unavailable.push("redteam");
    } else {
      unavailable.push("redteam");
    }

    this.fleet.hintFromCards(groups.flatMap(g => g.cards));
    const fleetSnapshot = fleetResult.status === "fulfilled" ? await this.fleet.collect() : null;
    const combined = fleetSnapshot ? addFleetGroups(groups, fleetSnapshot) : groups;
    if (fleetSnapshot) partial ||= fleetSnapshot.truncated;
    return buildGlobalDashboard(combined, {
      now: this.now(),
      partial,
      unavailableSources: unavailable,
      dismissedKeys,
    });
  }

  private async collectGlobalBb(): Promise<GlobalSourceResult> {
    const listed = await this.sdk.threads.list({
      archived: false,
      includeHidden: true,
      limit: BOARD_LIMITS.globalThreadRows,
    });
    const rows = listed as ThreadRowLike[];
    const grouped = groupGlobalThreadRows(rows);
    const ranked = [...grouped].sort((a, b) => b.updatedAt - a.updatedAt);
    const live = ranked.filter((group) => group.rows.some((row) => isGlobalNonterminal(row)));
    const terminal = ranked.filter((group) => !group.rows.some((row) => isGlobalNonterminal(row)));
    const selected = [
      ...live.slice(0, BOARD_LIMITS.globalActiveExecutions),
      ...terminal.slice(0, BOARD_LIMITS.globalRecentExecutions),
    ].slice(0, BOARD_LIMITS.globalDetailedExecutions);
    const labels = await this.providerLabels();
    const ctx: NormalizeContext = {
      providerLabel: (id) => (id && labels.get(id)) || null,
    };

    const groups = await mapWithConcurrency(selected, 4, async (group): Promise<GlobalExecutionGroup> => {
      const representative = pickGlobalRepresentative(group.rows);
      const summaryCards = group.rows
        .filter((row) => row.id !== representative.id)
        .map((row) => globalSummaryCard(row, row.id === group.root.id, ctx));
      const timeline = await this.timelineOf(representative.id);
      const status = threadBoardStatus(representative, timeline.rows);
      const [model, output, events, queuedMessages] = await Promise.all([
        this.modelOf(representative.id),
        status === "completed" ? this.outputOf(representative.id) : Promise.resolve(null),
        status === "failed" ? this.eventsTail(representative.id) : Promise.resolve(undefined),
        (representative.queuedMessageCount ?? 0) > 0
          ? this.queuedMessagesOf(representative.id)
          : Promise.resolve(undefined),
      ]);
      const childThreadIds = group.rows
        .filter((row) => row.parentThreadId === representative.id)
        .map((row) => row.id);
      const details = normalizeThread({
        row: representative,
        timeline,
        events,
        output,
        model,
        queuedMessages,
        isRoot: representative.id === group.root.id,
        depth: representative.id === group.root.id ? 0 : 1,
        childThreadIds,
      }, ctx, null);
      return {
        key: `bb:${group.root.id}`,
        source: "bb",
        title: globalThreadTitle(group.root),
        threadId: representative.id,
        projectId: group.root.projectId ?? representative.projectId ?? null,
        cards: [...summaryCards, ...details],
        updatedAt: group.updatedAt,
      };
    });

    return {
      groups,
      available: true,
      partial:
        rows.length >= BOARD_LIMITS.globalThreadRows ||
        live.length > BOARD_LIMITS.globalActiveExecutions ||
        terminal.length > BOARD_LIMITS.globalRecentExecutions,
    };
  }

  /** Fresh optional-source probe shared by the global active-scan poller. */
  pollGlobalRedteam(): Promise<{ changed: boolean; active: boolean }> {
    return this.redteam.pollGlobal();
  }

  isGlobalRedteamActive(): boolean { return this.redteam.isGlobalActive(); }

  /**
   * Lazy bounded execution timeline. This is never called by board/global
   * summary collection; it exists only behind the explicit Timeline action.
   */
  async executionTimeline(input: ExecutionTimelineInput): Promise<ExecutionTimeline> {
    const limit = Math.min(
      Math.max(input.limit ?? BOARD_LIMITS.executionTimelineDefaultEvents, 1),
      BOARD_LIMITS.executionTimelineMaxEvents,
    );
    const target = input.source === "bb" ? input.threadId : input.source === "ollama-fleet" ? input.jobId : input.scanId;
    const key = `${input.executionKey}:${input.source}:${target}:${limit}`;
    const cached = this.executionTimelineCache.get(key);
    if (cached) {
      const ttl = cached.value.active ? TTL.executionTimelineActive : TTL.executionTimelineTerminal;
      if (this.now() - cached.at < ttl) return cached.value;
    }
    const generation = this.generation;
    const existing = this.executionTimelineInflight.get(key);
    if (existing?.generation === generation) return existing.promise;
    const promise = this.collectExecutionTimeline(input, limit).finally(() => {
      if (this.executionTimelineInflight.get(key)?.promise === promise) {
        this.executionTimelineInflight.delete(key);
      }
    });
    this.executionTimelineInflight.set(key, { promise, generation });
    const result = await promise;
    // Same stale-inflight rule as snapshots: pre-invalidation data cannot
    // regain a fresh cache timestamp after a change signal.
    if (this.generation === generation) {
      // Refresh insertion order and evict the oldest disposable entry. The
      // cache is an optimization, never a history store.
      this.executionTimelineCache.delete(key);
      this.executionTimelineCache.set(key, { at: this.now(), value: result });
      while (this.executionTimelineCache.size > BOARD_LIMITS.executionTimelineCacheEntries) {
        const oldest = this.executionTimelineCache.keys().next().value;
        if (typeof oldest !== "string") break;
        this.executionTimelineCache.delete(oldest);
      }
    }
    return result;
  }

  private async collectExecutionTimeline(
    input: ExecutionTimelineInput,
    limit: number,
  ): Promise<ExecutionTimeline> {
    if (input.source === "ollama-fleet") {
      const snapshot = await this.fleet.collect();
      const jobs = snapshot.jobs.filter(j => j.jobId === input.jobId);
      const events = fleetTimelineEvents(jobs, input.executionKey);
      return { executionKey: input.executionKey, source: "ollama-fleet", events: events.slice(-limit),
        active: jobs.some(fleetActive), truncated: snapshot.truncated || events.length > limit,
        sourceWarning: jobs.length ? null : "Fleet job is unavailable or outside the retained window.", fetchedAt: this.now() };
    }
    if (input.source === "redteam") {
      return this.redteam.timeline(input.scanId, input.executionKey, limit);
    }
    // Timeline rows supply tools/public updates/turns. A second, tightly
    // allowlisted event tail supplies explicit interaction resolution,
    // provisioning, interruption, and proven resolved-model timestamps.
    // Reasoning event kinds are never requested.
    const [timelineResult, lifecycleResult] = await Promise.allSettled([
      this.sdk.threads.timeline({
        threadId: input.threadId,
        includeNestedRows: "true",
        segmentLimit: String(BOARD_LIMITS.executionTimelineSegmentLimit),
      }),
      this.sdk.threads.events.list({
        threadId: input.threadId,
        order: "desc",
        limit: String(BOARD_LIMITS.executionTimelineMaxEvents),
        types: [
          "client/turn/requested",
          "system/interaction/lifecycle",
          "system/thread-provisioning",
          "system/thread/interrupted",
          "provider/modelFallback",
        ],
      }),
    ]);
    if (timelineResult.status === "rejected") {
      throw new Error("BB execution timeline is unavailable");
    }
    const lifecycleEvents = lifecycleResult.status === "fulfilled" ? lifecycleResult.value : [];
    const normalized = normalizeBbTimeline({
      executionKey: input.executionKey,
      threadId: input.threadId,
      timeline: timelineResult.value,
      lifecycleEvents,
      lifecycleTruncated: lifecycleEvents.length >= BOARD_LIMITS.executionTimelineMaxEvents,
      sourceWarning: lifecycleResult.status === "rejected" ? "Some lifecycle details are temporarily unavailable." : null,
      limit,
      now: this.now(),
    });
    const fleet = await this.fleet.collect();
    const jobs = fleet.jobs.filter(j => j.origin?.threadId === input.threadId);
    const events = [...normalized.events, ...fleetTimelineEvents(jobs, input.executionKey)].sort((a,b) => a.timestamp-b.timestamp);
    return { ...normalized, events: events.slice(-limit), active: normalized.active || jobs.some(fleetActive),
      truncated: normalized.truncated || fleet.truncated || events.length > limit };
  }

  /** Bounded activity tail for the details view (reasoning events excluded). */
  async activity(
    threadId: string,
    limit = 20,
  ): Promise<{ entries: ReturnType<typeof activityFromEvents> }> {
    const clamped = Math.min(Math.max(limit, 1), BOARD_LIMITS.eventTailLimit);
    const events = await this.eventsTail(threadId);
    const entries = activityFromEvents(events).slice(0, clamped);
    return { entries };
  }

  /** Thread ids observed in the last snapshot for a root (watcher feed). */
  lastObservedThreads(rootThreadId: string): string[] | null {
    const hit = this.snapshotCache.get(rootThreadId);
    if (!hit) return null;
    return hit.value.cards.map((card) => card.threadId).filter((id): id is string => id !== null);
  }
}

export interface GlobalThreadGroup {
  root: ThreadRowLike;
  rows: ThreadRowLike[];
  updatedAt: number;
}

/**
 * Group a single bounded threads.list page by the highest visible ancestor.
 * If the cap omits an older parent, the visible child becomes a truthful
 * standalone execution rather than triggering an unbounded parent lookup.
 */
export function groupGlobalThreadRows(rows: readonly ThreadRowLike[]): GlobalThreadGroup[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const groups = new Map<string, ThreadRowLike[]>();
  for (const row of rows) {
    let root = row;
    const seen = new Set<string>([row.id]);
    while (root.parentThreadId && byId.has(root.parentThreadId) && !seen.has(root.parentThreadId)) {
      seen.add(root.parentThreadId);
      root = byId.get(root.parentThreadId)!;
    }
    const bucket = groups.get(root.id) ?? [];
    bucket.push(row);
    groups.set(root.id, bucket);
  }
  return [...groups.entries()].map(([rootId, groupedRows]) => ({
    root: byId.get(rootId)!,
    rows: groupedRows,
    updatedAt: Math.max(...groupedRows.map((row) => row.updatedAt)),
  }));
}

function globalThreadTitle(row: ThreadRowLike): string {
  return row.title ?? previewText(row.titleFallback, 120) ?? (row.originPluginId ? `Plugin: ${row.originPluginId}` : "BB thread");
}

function isGlobalNonterminal(row: ThreadRowLike): boolean {
  const status = threadBoardStatus(row, []);
  return status === "running" || status === "starting" || status === "waiting" || status === "queued";
}

function pickGlobalRepresentative(rows: readonly ThreadRowLike[]): ThreadRowLike {
  const rank = (row: ThreadRowLike): number => {
    const status = threadBoardStatus(row, []);
    if (status === "running") return 0;
    if (status === "starting") return 1;
    if (row.hasPendingInteraction === true) return 2;
    if (status === "waiting") return 3;
    if (status === "queued") return 4;
    if (status === "failed") return 5;
    if (status === "interrupted") return 6;
    return 7;
  };
  return [...rows].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt)[0]!;
}

/** List-row-only fallback card for non-representative members of a group. */
function globalSummaryCard(
  row: ThreadRowLike,
  isRoot: boolean,
  ctx: NormalizeContext,
): BoardCard {
  const status = threadBoardStatus(row, []);
  const display = row.runtime?.displayStatus ?? null;
  const waitingOn =
    row.hasPendingInteraction === true
      ? "Waiting for you"
      : display === "waiting-for-host"
        ? "Waiting for host"
        : display === "host-reconnecting"
          ? "Reconnecting to host"
          : null;
  const terminal = status === "completed" || status === "failed" || status === "interrupted";
  return {
    key: `thread:${row.id}`,
    parentKey: null,
    depth: isRoot ? 0 : 1,
    kind: "thread",
    source: "bb",
    title: globalThreadTitle(row),
    subtitle: isRoot ? "parent thread" : "child thread",
    status,
    column: columnForStatus(status, "thread"),
    threadId: row.id,
    providerId: row.providerId ?? null,
    providerLabel: ctx.providerLabel(row.providerId ?? null),
    model: null,
    startedAt: row.createdAt,
    completedAt: terminal ? row.updatedAt : null,
    durationMs: terminal ? Math.max(0, row.updatedAt - row.createdAt) : null,
    phaseTitle: null,
    promptPreview: null,
    activity: null,
    outputPreview: null,
    errorPreview: null,
    tokens: null,
    toolCalls: null,
    waitingOn,
    attention:
      status === "failed"
        ? { type: "failed", message: "Execution failed" }
        : status === "interrupted"
          ? { type: "interrupted", message: "Execution was interrupted" }
          : status === "waiting" && row.hasPendingInteraction === true
            ? { type: "action-required", message: "Waiting for you" }
            : status === "waiting"
              ? { type: "waiting", message: waitingOn ?? "Execution is waiting" }
              : null,
    planStatus: null,
    isRoot,
    parentThreadId: row.parentThreadId ?? null,
  };
}

/** Small fixed-concurrency mapper so bounded enrichment does not become a request burst. */
async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (next < values.length) {
      const index = next++;
      result[index] = await map(values[index]!);
    }
  });
  await Promise.all(workers);
  return result;
}

/** Delegation items of one timeline, keyed for child enrichment. */
function delegationIndex(
  timeline: TimelineResponse,
): Array<{ childRef: string | null; label: string | null; output: string | null }> {
  const out: Array<{ childRef: string | null; label: string | null; output: string | null }> = [];
  const walk = (rows: readonly unknown[]) => {
    for (const row of rows) {
      const candidate = row as {
        kind?: string;
        workKind?: string;
        children?: unknown[];
        childRef?: string | null;
        description?: string | null;
        output?: string;
      };
      if (candidate.kind === "turn" && Array.isArray(candidate.children)) {
        walk(candidate.children);
        continue;
      }
      if (candidate.kind === "work" && candidate.workKind === "delegation") {
        out.push({
          childRef: candidate.childRef ?? null,
          label: candidate.description ?? null,
          output: typeof candidate.output === "string" ? candidate.output : null,
        });
      }
    }
  };
  walk(timeline.rows);
  return out;
}
