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
  /** Last time a snapshot was requested for this root. */
  lastTouchedAt: number;
}

export interface WatcherDeps {
  /** Publishes the invalidation signal. */
  publish: (payload: { roots: string[]; global?: boolean }) => void;
  /** Resolves a thread's parentThreadId (bounded parentage check). */
  getParent: (threadId: string) => Promise<string | null>;
  /** Clock, injectable for tests. Defaults to Date.now. */
  now?: () => number;
  /** How long a watched root stays live without a snapshot request. */
  watchedTtlMs?: number;
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
  private globalTouchedAt: number | null = null;
  private readonly lookupAt = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Pending terminal reconciliation: at most one, replaced by newer terminal flushes. */
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  /** Terminal signal contributed to the current dirty set. */
  private dirtyTerminal = false;
  private disposed = false;
  private readonly watchedTtlMs: number;
  private readonly debounceMs: number;
  private readonly lookupGapMs: number;
  private readonly reconcileDelayMs: number;

  constructor(private readonly deps: WatcherDeps) {
    this.watchedTtlMs = deps.watchedTtlMs ?? 90_000;
    this.debounceMs = deps.debounceMs ?? 400;
    this.lookupGapMs = deps.lookupGapMs ?? 2_000;
    this.reconcileDelayMs = deps.reconcileDelayMs ?? 1_500;
    this.clock = deps.now ?? (() => Date.now());
  }

  private readonly clock: () => number;

  /** Called by the RPC handler whenever a board is fetched for a root. */
  touch(rootThreadId: string, threads: string[], projectId: string | null): void {
    if (this.disposed) return;
    const now = this.clock();
    const existing = this.watched.get(rootThreadId);
    if (existing) {
      existing.threads = new Set(threads);
      existing.projectId = projectId;
      existing.lastTouchedAt = now;
    } else {
      this.watched.set(rootThreadId, {
        rootThreadId,
        threads: new Set(threads),
        projectId,
        lastTouchedAt: now,
      });
    }
    this.prune(now);
  }

  /** Lease the global dashboard as watched; refreshed by its bounded RPC. */
  touchGlobal(): void {
    if (this.disposed) return;
    this.globalTouchedAt = this.clock();
    this.prune(this.globalTouchedAt);
  }

  private prune(now: number): void {
    for (const [id, root] of this.watched) {
      if (now - root.lastTouchedAt > this.watchedTtlMs) this.watched.delete(id);
    }
    for (const [id, at] of this.lookupAt) {
      if (now - at > this.watchedTtlMs) this.lookupAt.delete(id);
    }
    if (this.globalTouchedAt !== null && now - this.globalTouchedAt > this.watchedTtlMs) {
      this.globalTouchedAt = null;
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
    if (isTerminalThreadChange(event)) this.dirtyTerminal = true;
    this.markGlobalDirty();
    if (event.id === undefined) {
      // Broadcast without a thread id: conservatively refresh every board.
      for (const root of this.watched.values()) this.markDirty(root.rootThreadId);
      return;
    }
    const projectId = event.metadata?.projectId ?? null;
    for (const root of this.candidatesFor(event.id, projectId)) {
      if (root.threads.has(event.id) || event.id === root.rootThreadId) {
        this.markDirty(root.rootThreadId);
        continue;
      }
      if (this.lookupRecently(event.id)) continue;
      const parent = await this.deps.getParent(event.id);
      if (parent !== null && (root.threads.has(parent) || parent === root.rootThreadId)) {
        root.threads.add(event.id); // a new descendant appeared
        this.markDirty(root.rootThreadId);
      }
    }
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
    if (isTerminalLifecycleKind(kind)) this.dirtyTerminal = true;
    this.markGlobalDirty();
    for (const root of this.candidatesFor(thread.id, thread.projectId ?? null)) {
      if (root.threads.has(thread.id) || thread.id === root.rootThreadId) {
        this.markDirty(root.rootThreadId);
        continue;
      }
      const parent = thread.parentThreadId ?? null;
      if (parent !== null) {
        if (root.threads.has(parent) || parent === root.rootThreadId) {
          root.threads.add(thread.id);
          this.markDirty(root.rootThreadId);
        }
        continue;
      }
      if (this.lookupRecently(thread.id)) continue;
      const resolved = await this.deps.getParent(thread.id);
      if (resolved !== null && (root.threads.has(resolved) || resolved === root.rootThreadId)) {
        root.threads.add(thread.id);
        this.markDirty(root.rootThreadId);
      }
    }
  }

  private lookupRecently(threadId: string): boolean {
    const at = this.lookupAt.get(threadId);
    const now = this.clock();
    if (at !== undefined && now - at < this.lookupGapMs) return true;
    this.lookupAt.set(threadId, now);
    return false;
  }

  private markDirty(rootThreadId: string): void {
    this.dirty.add(rootThreadId);
    this.ensureTimer();
  }

  private markGlobalDirty(): void {
    const now = this.clock();
    this.prune(now);
    if (this.globalTouchedAt === null) return;
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
    const now = this.clock(); this.prune(now);
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
    this.deps.publish(payload);
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
      this.deps.publish(payload);
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
    this.globalTouchedAt = null;
  }

  /** Realtime channel the frontend listens on. */
  static readonly channel = BOARD_CHANGED_CHANNEL;
}

/** Wire the watcher to the plugin API; returns the unsubscribe handle. */
export function attachWatcher(bb: BbPluginApi, watcher: BoardWatcher): () => void {
  const unsubscribe = bb.sdk.subscribe({
    event: "thread:changed",
    callback: (event) => {
      void watcher.handleChanged(event);
    },
  });
  // bb.events.on listeners live for the plugin's lifetime (no dispose handle).
  bb.events.on("thread.created", (payload) => {
    void watcher.handleLifecycle(payload.thread, "created");
  });
  bb.events.on("thread.active", (payload) => {
    void watcher.handleLifecycle(payload.thread, "active");
  });
  bb.events.on("thread.idle", (payload) => {
    void watcher.handleLifecycle(payload.thread, "idle");
  });
  bb.events.on("thread.failed", (payload) => {
    void watcher.handleLifecycle(payload.thread, "failed");
  });
  bb.events.on("thread.archived", (payload) => {
    void watcher.handleLifecycle(payload.thread, "archived");
  });
  bb.events.on("thread.deleted", (payload) => {
    void watcher.handleLifecycle(payload.thread, "deleted");
  });
  // Newer event names may not exist on older runtimes (which throw at
  // registration). Subscribe opportunistically: the thread:changed channel
  // already covers queue and failure transitions.
  onOptionalLifecycleEvent(bb, "turn.failed", (payload: { threadId: string }) => {
    void watcher.handleLifecycle({ id: payload.threadId }, "turn-failed");
  });
  onOptionalLifecycleEvent(bb, "message.queued", (payload: { entry: { threadId: string } }) => {
    void watcher.handleLifecycle({ id: payload.entry.threadId }, "other");
  });
  onOptionalLifecycleEvent(bb, "message.dispatched", (payload: { entry: { threadId: string } }) => {
    void watcher.handleLifecycle({ id: payload.entry.threadId }, "other");
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
