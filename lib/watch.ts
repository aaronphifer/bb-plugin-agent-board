// bb-plugin-agent-board — realtime invalidation for open boards.
//
// Subscribes to BB's public entity stream (bb.sdk.subscribe "thread:changed")
// and the plugin thread lifecycle events (bb.events.on), decides which
// watched roots are stale, and coalesces those decisions into one
// bb.realtime.publish per debounce window. The frontend reacts by refetching
// board_snapshot — no polling, no content pushed, only invalidation.
//
// All registry state is derived cache (which threads each watched root
// observed last) with a TTL; a plugin reload rebuilds it from scratch.

import { BOARD_CHANGED_CHANNEL } from "../contract/rpc";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * Structural view of the public "thread:changed" realtime event. The exact
 * SDK type is internal to the realtime area; this interface accepts exactly
 * the fields the watcher reads (all optional where the wire makes them
 * optional), so server.ts can pass the SDK event through directly.
 */
export interface ThreadChangedEvent {
  entity: "thread";
  type: "changed";
  /** The thread that changed; absent on broadcasts. */
  id?: string;
  /** What changed (status-changed, events-appended, …). */
  changes?: readonly string[];
  metadata?: {
    projectId?: string;
    backgroundActivityChanged?: boolean;
    eventTypes?: readonly string[];
    hasPendingInteraction?: boolean;
    statusChange?: {
      status?: string;
      activity?: Record<string, number>;
    } | null;
  };
}

/** Change kinds that never affect a board. */
const IGNORED_CHANGE_KINDS: ReadonlySet<string> = new Set([
  "read-state-changed",
  "order-changed",
  "pin-state-changed",
  "tabs-changed",
  "terminals-changed",
  "environment-changed",
]);

/**
 * Appended event types that cannot alter a board snapshot: reasoning deltas
 * (never rendered), message text deltas (output previews update on turn
 * completion), and chatty usage counters.
 */
const IGNORED_APPENDED_EVENT_TYPES: ReadonlySet<string> = new Set([
  "item/reasoning/textDelta",
  "item/reasoning/summaryTextDelta",
  "item/agentMessage/delta",
  "thread/tokenUsage/updated",
  "thread/contextWindowUsage/updated",
  "provider/rateLimits/updated",
]);

/**
 * Pure decision: could this changed event alter any board? Unknown change
 * kinds stay relevant (conservative), ignored kinds are filtered, and a
 * pure reasoning-delta append is not worth a refetch.
 */
export function isRelevantThreadChange(event: ThreadChangedEvent): boolean {
  const changes = event.changes;
  if (changes === undefined || changes.length === 0) return true;
  const relevant = changes.filter((change) => !IGNORED_CHANGE_KINDS.has(change));
  if (relevant.length === 0) return false;
  if (relevant.length === 1 && relevant[0] === "events-appended") {
    const types = event.metadata?.eventTypes;
    if (types !== undefined && types.length > 0) {
      if (types.every((type) => IGNORED_APPENDED_EVENT_TYPES.has(type))) return false;
    }
  }
  return true;
}

/**
 * Terminal-relevant thread status names observed on thread:changed
 * statusChange metadata. These mark a running thread settling into a
 * terminal state — the transitions whose invalidation must not be lost to
 * an in-flight fetch race, because terminal threads emit no further signals.
 */
const TERMINAL_THREAD_STATUSES: ReadonlySet<string> = new Set(["idle", "error"]);

/**
 * Appended event types that finalize a turn; a terminal signal arriving as
 * events-appended (turn/completed typically precedes status-changed) also
 * marks the flush terminal-relevant.
 */
const TERMINAL_APPENDED_EVENT_TYPES: ReadonlySet<string> = new Set([
  "turn/completed",
  "turn/failed",
]);

/** True when a thread:changed event marks a terminal transition. */
export function isTerminalThreadChange(event: ThreadChangedEvent): boolean {
  const status = event.metadata?.statusChange?.status;
  if (status !== undefined && TERMINAL_THREAD_STATUSES.has(status)) return true;
  const types = event.metadata?.eventTypes;
  if (types !== undefined && types.some((type) => TERMINAL_APPENDED_EVENT_TYPES.has(type))) {
    return true;
  }
  return false;
}

/** Lifecycle event kinds the watcher is told about. */
export type LifecycleKind =
  | "created"
  | "active"
  | "idle"
  | "failed"
  | "archived"
  | "deleted"
  | "turn-failed"
  | "other";

/** True when a lifecycle event marks a terminal transition. */
export function isTerminalLifecycleKind(kind: LifecycleKind): boolean {
  return (
    kind === "idle" ||
    kind === "failed" ||
    kind === "archived" ||
    kind === "deleted" ||
    kind === "turn-failed"
  );
}

export interface WatchedRoot {
  rootThreadId: string;
  /** Threads observed in the last snapshot (root included). Derived cache. */
  threads: Set<string>;
  /** Project filter for parentage lookups of unseen threads. */
  projectId: string | null;
  /** Open board clients currently watching this root. */
  watchers: number;
}

export interface WatcherDeps {
  /** Publishes the invalidation signal. */
  publish: (payload: { roots: string[]; global?: boolean }) => void;
  /** Resolves a thread's ancestor ids, parent first (bounded parentage check). */
  getAncestors: (threadId: string) => Promise<readonly string[]>;
  /** Clock, injectable for tests. Defaults to Date.now. */
  now?: () => number;
  /** Debounce window for coalescing signals. */
  debounceMs?: number;
  /** Min gap between parentage lookups for the same unseen thread. */
  lookupGapMs?: number;
  /**
   * Delay of the single bounded terminal-state reconciliation: after a
   * flush that a terminal signal (idle/error/failed/turn-completed)
   * contributed to, ONE delayed re-publish lets open boards re-read BB state
   * after any in-flight pre-terminal collect has settled. No polling: one
   * scheduled publish per terminal transition, replaced (never stacked) by
   * a newer terminal flush, cleared on dispose.
   */
  reconcileDelayMs?: number;
}

/**
 * Tracks open boards and decides invalidation. Decision logic is pure
 * (isRelevantThreadChange + candidatesFor); the class owns the registry,
 * the debounce timer, and the dispose contract.
 */
export class BoardWatcher {
  private readonly watched = new Map<string, WatchedRoot>();
  private readonly dirty = new Set<string>();
  private dirtyGlobal = false;
  private globalWatchers = 0;
  private readonly lookupAt = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Pending terminal reconciliation: at most one, replaced by newer terminal flushes. */
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  /** Terminal signal contributed to the current dirty set. */
  private dirtyTerminal = false;
  private disposed = false;
  private unavailable = false;
  private degraded = false;
  private startedAt = 0;
  private lastEventAt: number | null = null;
  private lastPublishedAt: number | null = null;
  private lastErrorAt: number | null = null;
  private readonly debounceMs: number;
  private readonly lookupGapMs: number;
  private readonly reconcileDelayMs: number;

  constructor(private readonly deps: WatcherDeps) {
    this.debounceMs = deps.debounceMs ?? 400;
    this.lookupGapMs = deps.lookupGapMs ?? 2_000;
    this.reconcileDelayMs = deps.reconcileDelayMs ?? 1_500;
    this.clock = deps.now ?? (() => Date.now());
    this.startedAt = this.clock();
  }

  private readonly clock: () => number;

  health() {
    return { status: this.disposed ? "disposed" as const : this.unavailable ? "unavailable" as const : this.degraded ? "degraded" as const : "watching" as const,
      startedAt: this.startedAt, lastEventAt: this.lastEventAt, lastPublishedAt: this.lastPublishedAt, lastErrorAt: this.lastErrorAt };
  }
  recordError(): void { if (!this.disposed) { this.lastErrorAt = this.clock(); this.degraded = true; } }
  markUnavailable(): void { this.unavailable = true; this.recordError(); }
  private publish(payload: { roots: string[]; global?: boolean }): boolean {
    if (this.disposed) return false;
    try { this.deps.publish(payload); this.lastPublishedAt = this.clock(); this.degraded = false; return true; }
    catch { this.recordError(); return false; }
  }

  /**
   * Watch a root while an open board reads it; the read's watched signal
   * ends the watch when its last client leaves.
   */
  watch(rootThreadId: string, signal: AbortSignal): void {
    if (this.disposed || signal.aborted) return;
    const existing = this.watched.get(rootThreadId);
    if (existing) existing.watchers += 1;
    else {
      this.watched.set(rootThreadId, {
        rootThreadId,
        threads: new Set([rootThreadId]),
        projectId: null,
        watchers: 1,
      });
    }
    signal.addEventListener("abort", () => {
      const root = this.watched.get(rootThreadId);
      if (!root) return;
      root.watchers -= 1;
      if (root.watchers <= 0) this.watched.delete(rootThreadId);
    }, { once: true });
  }

  /** Watch the global dashboard while an open page reads it. */
  watchGlobal(signal: AbortSignal): void {
    if (this.disposed || signal.aborted) return;
    this.globalWatchers += 1;
    signal.addEventListener("abort", () => {
      this.globalWatchers = Math.max(0, this.globalWatchers - 1);
    }, { once: true });
  }

  /** Called by the RPC handler with the threads a watched root's snapshot observed. */
  touch(rootThreadId: string, threads: string[], projectId: string | null): void {
    if (this.disposed) return;
    const root = this.watched.get(rootThreadId);
    if (!root) return;
    root.threads = new Set(threads);
    root.projectId = projectId;
  }

  isWatching(rootThreadId: string): boolean {
    return this.watched.has(rootThreadId);
  }

  isWatchingGlobal(): boolean {
    return this.globalWatchers > 0;
  }

  private pruneLookups(now: number): void {
    for (const [id, at] of this.lookupAt) {
      if (now - at >= this.lookupGapMs) this.lookupAt.delete(id);
    }
  }

  /**
   * Pure decision: watched roots that could be affected by a thread change.
   * Known threads match directly; unseen threads pass only when the project
   * matches (or is unknown), pending a parentage check.
   */
  candidatesFor(threadId: string, projectId: string | null): WatchedRoot[] {
    const result: WatchedRoot[] = [];
    for (const root of this.watched.values()) {
      if (root.threads.has(threadId) || threadId === root.rootThreadId) {
        result.push(root);
        continue;
      }
      if (
        projectId !== null &&
        root.projectId !== null &&
        root.projectId !== projectId
      ) {
        continue;
      }
      result.push(root);
    }
    return result;
  }

  /** Handle a "thread:changed" entity event. */
  async handleChanged(event: ThreadChangedEvent): Promise<void> {
    if (this.disposed) return;
    if (!isRelevantThreadChange(event)) return;
    this.lastEventAt = this.clock();
    if (isTerminalThreadChange(event)) this.dirtyTerminal = true;
    this.markGlobalDirty();
    if (event.id === undefined) {
      // Broadcast without a thread id: conservatively refresh every board.
      for (const root of this.watched.values()) this.markDirty(root.rootThreadId);
      return;
    }
    await this.markAffectedRoots(event.id, event.metadata?.projectId ?? null, undefined);
  }

  /** Handle a plugin thread lifecycle event (thread.created/failed/idle/…). */
  async handleLifecycle(
    thread: {
      id: string;
      parentThreadId?: string | null;
      projectId?: string | null;
    },
    kind: LifecycleKind = "other",
  ): Promise<void> {
    if (this.disposed) return;
    this.lastEventAt = this.clock();
    if (isTerminalLifecycleKind(kind)) this.dirtyTerminal = true;
    this.markGlobalDirty();
    await this.markAffectedRoots(thread.id, thread.projectId ?? null, thread.parentThreadId);
  }

  /**
   * Mark every watched root containing `threadId`. Known threads and children
   * of known threads match directly; any other candidate needs one ancestor
   * lookup, so a thread created below an unseen parent still reaches its
   * root. A known null parent means a root thread, which needs no lookup.
   */
  private async markAffectedRoots(
    threadId: string,
    projectId: string | null,
    parentThreadId: string | null | undefined,
  ): Promise<void> {
    const unresolved: WatchedRoot[] = [];
    for (const root of this.candidatesFor(threadId, projectId)) {
      if (root.threads.has(threadId) || threadId === root.rootThreadId) {
        this.markDirty(root.rootThreadId);
      } else if (parentThreadId != null && (root.threads.has(parentThreadId) || parentThreadId === root.rootThreadId)) {
        root.threads.add(threadId);
        this.markDirty(root.rootThreadId);
      } else if (parentThreadId !== null) {
        unresolved.push(root);
      }
    }
    if (unresolved.length === 0 || this.lookupRecently(threadId)) return;
    const ancestors = await this.deps.getAncestors(threadId);
    if (this.disposed) return;
    for (const root of unresolved) {
      if (ancestors.some((id) => id === root.rootThreadId || root.threads.has(id))) {
        root.threads.add(threadId);
        this.markDirty(root.rootThreadId);
      }
    }
  }

  private lookupRecently(threadId: string): boolean {
    const now = this.clock();
    this.pruneLookups(now);
    const at = this.lookupAt.get(threadId);
    if (at !== undefined && now - at < this.lookupGapMs) return true;
    this.lookupAt.set(threadId, now);
    return false;
  }

  private markDirty(rootThreadId: string): void {
    this.dirty.add(rootThreadId);
    this.ensureTimer();
  }

  private markGlobalDirty(): void {
    if (this.globalWatchers === 0) return;
    this.dirtyGlobal = true;
    this.ensureTimer();
  }

  private ensureTimer(): void {
    if (this.timer !== null) return; // already coalescing
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
    if (typeof this.timer === "object" && this.timer !== null && "unref" in this.timer) {
      (this.timer as unknown as { unref(): void }).unref();
    }
  }

  /** Optional-source invalidation for every currently watched root in a project. */
  invalidateProject(projectId: string): void {
    if (this.disposed) return;
    for (const root of this.watched.values()) if (root.projectId === projectId) this.markDirty(root.rootThreadId);
    this.markGlobalDirty();
  }

  /** Optional-source invalidation when a cross-project snapshot changes. */
  invalidateGlobal(): void {
    if (this.disposed) return;
    this.markGlobalDirty();
  }

  /** Publish dirty roots now (test seam; also runs after the debounce). */
  flush(): void {
    const terminal = this.dirtyTerminal;
    this.dirtyTerminal = false;
    if (this.disposed || (this.dirty.size === 0 && !this.dirtyGlobal)) return;
    const roots = [...this.dirty];
    const global = this.dirtyGlobal;
    this.dirty.clear();
    this.dirtyGlobal = false;
    const payload = { roots, ...(global ? { global: true } : {}) };
    this.publish(payload);
    // Bounded terminal-state self-correction: ONE delayed re-publish of the
    // same payload, so open boards re-read BB after any pre-terminal
    // in-flight fetch settled. Terminal threads emit no further signals, so
    // a lost or dropped terminal signal would otherwise leave a board
    // showing RUNNING forever. Never stacks: a newer terminal flush replaces
    // it; dispose clears it; it fires at most once (not a poll).
    if (terminal) this.scheduleReconcile(payload);
  }

  private scheduleReconcile(payload: { roots: string[]; global?: boolean }): void {
    if (this.reconcileTimer !== null) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null;
      if (this.disposed) return;
      this.publish(payload);
    }, this.reconcileDelayMs);
    if (
      typeof this.reconcileTimer === "object" &&
      this.reconcileTimer !== null &&
      "unref" in this.reconcileTimer
    ) {
      (this.reconcileTimer as unknown as { unref(): void }).unref();
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.reconcileTimer !== null) {
      clearTimeout(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    this.watched.clear();
    this.dirty.clear();
    this.dirtyGlobal = false;
    this.dirtyTerminal = false;
    this.globalWatchers = 0;
  }

  /** Realtime channel the frontend listens on. */
  static readonly channel = BOARD_CHANGED_CHANNEL;
}

/** Wire the watcher to the plugin API; returns the unsubscribe handle. */
export function attachWatcher(bb: BbPluginApi, watcher: BoardWatcher): () => void {
  let unsubscribe = () => {};
  try { unsubscribe = bb.sdk.subscribe({
    event: "thread:changed",
    callback: (event) => {
      void watcher.handleChanged(event).catch(() => watcher.recordError());
    },
  }); } catch { watcher.markUnavailable(); }
  // bb.events.on listeners live for the plugin's lifetime (no dispose handle).
  bb.events.on("thread.created", (payload) => {
    void watcher.handleLifecycle(payload.thread, "created").catch(() => watcher.recordError());
  });
  bb.events.on("thread.active", (payload) => {
    void watcher.handleLifecycle(payload.thread, "active").catch(() => watcher.recordError());
  });
  bb.events.on("thread.idle", (payload) => {
    void watcher.handleLifecycle(payload.thread, "idle").catch(() => watcher.recordError());
  });
  bb.events.on("thread.failed", (payload) => {
    void watcher.handleLifecycle(payload.thread, "failed").catch(() => watcher.recordError());
  });
  bb.events.on("thread.archived", (payload) => {
    void watcher.handleLifecycle(payload.thread, "archived").catch(() => watcher.recordError());
  });
  bb.events.on("thread.deleted", (payload) => {
    void watcher.handleLifecycle(payload.thread, "deleted").catch(() => watcher.recordError());
  });
  // Newer event names may not exist on older runtimes (which throw at
  // registration). Subscribe opportunistically: the thread:changed channel
  // already covers queue and failure transitions.
  onOptionalLifecycleEvent(bb, "turn.failed", (payload: { threadId: string }) => {
    void watcher.handleLifecycle({ id: payload.threadId }, "turn-failed").catch(() => watcher.recordError());
  });
  onOptionalLifecycleEvent(bb, "message.queued", (payload: { entry: { threadId: string } }) => {
    void watcher.handleLifecycle({ id: payload.entry.threadId }, "other").catch(() => watcher.recordError());
  });
  onOptionalLifecycleEvent(bb, "message.dispatched", (payload: { entry: { threadId: string } }) => {
    void watcher.handleLifecycle({ id: payload.entry.threadId }, "other").catch(() => watcher.recordError());
  });
  return unsubscribe;
}

/** Register a lifecycle event the host may not know; old runtimes skip it. */
function onOptionalLifecycleEvent<P>(
  bb: BbPluginApi,
  name: string,
  handler: (payload: P) => void,
): void {
  try {
    bb.events.on(
      name as Parameters<typeof bb.events.on>[0],
      handler as Parameters<typeof bb.events.on>[1],
    );
  } catch {
    // Unknown event on this runtime — thread:changed still delivers it.
  }
}
