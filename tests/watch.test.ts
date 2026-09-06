// Watcher tests: relevance filtering, candidate selection, parentage
// lookups, rate-limited lookups, debounce coalescing, TTL pruning, dispose.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BoardWatcher,
  isTerminalLifecycleKind,
  isTerminalThreadChange,
  type LifecycleKind,
  type ThreadChangedEvent,
} from "@/lib/watch";
import { BOARD_CHANGED_CHANNEL } from "@/contract/rpc";

interface Recorded {
  publishes: Array<{ roots: string[]; global?: boolean }>;
  lookups: string[];
}

function makeWatcher(overrides?: {
  now?: () => number;
  debounceMs?: number;
  lookupGapMs?: number;
  watchedTtlMs?: number;
}) {
  const recorded: Recorded = { publishes: [], lookups: [] };
  const watcher = new BoardWatcher({
    publish: (payload) => recorded.publishes.push(payload),
    getParent: async (threadId) => {
      recorded.lookups.push(threadId);
      return threadId === "thr_new" ? "thr_root" : null;
    },
    now: overrides?.now,
    debounceMs: overrides?.debounceMs,
    lookupGapMs: overrides?.lookupGapMs,
    watchedTtlMs: overrides?.watchedTtlMs,
  });
  return { watcher, recorded };
}

function changed(id: string | undefined, fields: Partial<ThreadChangedEvent> = {}): ThreadChangedEvent {
  return { entity: "thread", type: "changed", id, ...fields };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("invalidation for observed threads", () => {
  it("marks a watched root dirty when an observed thread changes", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touch("thr_root", ["thr_root", "thr_child"], null);
    await watcher.handleChanged(changed("thr_child", { changes: ["status-changed"] }));
    watcher.flush();

    expect(recorded.publishes).toEqual([{ roots: ["thr_root"] }]);
    expect(recorded.lookups).toEqual([]);
  });

  it("ignores cosmetic changes and pure reasoning deltas", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touch("thr_root", ["thr_root"], null);
    await watcher.handleChanged(changed("thr_root", { changes: ["read-state-changed"] }));
    await watcher.handleChanged(changed("thr_root", { changes: ["pin-state-changed"] }));
    await watcher.handleChanged(
      changed("thr_root", {
        changes: ["events-appended"],
        metadata: { eventTypes: ["item/reasoning/textDelta"] },
      }),
    );
    watcher.flush();
    expect(recorded.publishes).toEqual([]);
  });

  it("refreshes every board on an id-less broadcast", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touch("thr_a", ["thr_a"], null);
    watcher.touch("thr_b", ["thr_b"], null);
    await watcher.handleChanged(changed(undefined, { changes: ["history-rewritten"] }));
    watcher.flush();
    expect(recorded.publishes).toEqual([{ roots: ["thr_a", "thr_b"] }]);
  });
});

describe("candidate filtering and parentage", () => {
  it("skips a project-mismatched root without a parentage lookup", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touch("thr_root", ["thr_root"], "p1");
    await watcher.handleChanged(
      changed("thr_new", { changes: ["status-changed"], metadata: { projectId: "p2" } }),
    );
    watcher.flush();
    expect(recorded.lookups).toEqual([]);
    expect(recorded.publishes).toEqual([]);
  });

  it("resolves a new descendant through a bounded parentage lookup", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touch("thr_root", ["thr_root"], null);
    await watcher.handleChanged(changed("thr_new", { changes: ["status-changed"] }));
    watcher.flush();

    expect(recorded.lookups).toEqual(["thr_new"]);
    expect(recorded.publishes).toEqual([{ roots: ["thr_root"] }]);

    // The descendant is now remembered: later changes skip the lookup.
    await watcher.handleChanged(changed("thr_new", { changes: ["events-appended"] }));
    expect(recorded.lookups).toEqual(["thr_new"]);
  });

  it("rate-limits parentage lookups for unresolved threads", async () => {
    const { watcher, recorded } = makeWatcher({ lookupGapMs: 2_000 });
    watcher.touch("thr_root", ["thr_root"], null);
    await watcher.handleChanged(changed("thr_unknown", { changes: ["status-changed"] }));
    await watcher.handleChanged(changed("thr_unknown", { changes: ["events-appended"] }));
    expect(recorded.lookups).toEqual(["thr_unknown"]); // one lookup within the gap

    vi.advanceTimersByTime(2_500);
    await watcher.handleChanged(changed("thr_unknown", { changes: ["events-appended"] }));
    expect(recorded.lookups).toEqual(["thr_unknown", "thr_unknown"]);
  });

  it("keeps unrelated threads out of the board", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touch("thr_root", ["thr_root", "thr_child"], null);
    await watcher.handleChanged(changed("thr_elsewhere", { changes: ["status-changed"] }));
    watcher.flush();
    expect(recorded.lookups).toEqual(["thr_elsewhere"]);
    expect(recorded.publishes).toEqual([]);
  });
});

describe("lifecycle events", () => {
  it("uses the event's parent when provided (no lookup)", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touch("thr_root", ["thr_root"], null);
    await watcher.handleLifecycle({
      id: "thr_new",
      parentThreadId: "thr_root",
      projectId: null,
    });
    watcher.flush();
    expect(recorded.lookups).toEqual([]);
    expect(recorded.publishes).toEqual([{ roots: ["thr_root"] }]);
  });

  it("ignores lifecycle events for threads outside the tree", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touch("thr_root", ["thr_root"], null);
    await watcher.handleLifecycle({ id: "thr_far", parentThreadId: "thr_other" });
    watcher.flush();
    expect(recorded.publishes).toEqual([]);
  });
});

describe("debounce and coalescing", () => {
  it("coalesces many changes into one publish per window", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touch("thr_root", ["thr_root"], null);
    await watcher.handleChanged(changed("thr_root", { changes: ["status-changed"] }));
    await watcher.handleChanged(changed("thr_root", { changes: ["events-appended"] }));
    await watcher.handleChanged(changed("thr_root", { changes: ["events-appended"] }));

    expect(recorded.publishes).toEqual([]); // still debouncing
    vi.advanceTimersByTime(400);
    expect(recorded.publishes).toEqual([{ roots: ["thr_root"] }]); // exactly one
  });

  it("debounces across roots into a single signal", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touch("thr_a", ["thr_a"], null);
    watcher.touch("thr_b", ["thr_b"], null);
    await watcher.handleChanged(changed("thr_a", { changes: ["status-changed"] }));
    vi.advanceTimersByTime(200);
    await watcher.handleChanged(changed("thr_b", { changes: ["status-changed"] }));
    vi.advanceTimersByTime(400);

    expect(recorded.publishes).toEqual([{ roots: ["thr_a", "thr_b"] }]);
  });
});

describe("registry lifecycle", () => {
  it("prunes watched roots after the TTL", async () => {
    let now = 0;
    const { watcher, recorded } = makeWatcher({ now: () => now, watchedTtlMs: 90_000 });
    watcher.touch("thr_root", ["thr_root"], null);
    now = 91_000;
    watcher.touch("thr_other", ["thr_other"], null); // triggers prune
    await watcher.handleChanged(changed("thr_root", { changes: ["status-changed"] }));
    watcher.flush();
    expect(recorded.publishes).toEqual([]); // thr_root was pruned
  });

  it("stops handling events and publishing after dispose", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touch("thr_root", ["thr_root"], null);
    watcher.dispose();
    await watcher.handleChanged(changed("thr_root", { changes: ["status-changed"] }));
    watcher.flush();
    expect(recorded.publishes).toEqual([]);
  });

  it("cancels the pending debounce on dispose", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touch("thr_root", ["thr_root"], null);
    await watcher.handleChanged(changed("thr_root", { changes: ["status-changed"] }));
    watcher.dispose();
    vi.advanceTimersByTime(1_000);
    expect(recorded.publishes).toEqual([]);
  });
});

describe("terminal-state reconciliation", () => {
  it("re-publishes the same payload once, after the flush, for a terminal status change", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touch("thr_root", ["thr_root"], null);
    await watcher.handleChanged(
      changed("thr_root", {
        changes: ["status-changed"],
        metadata: { statusChange: { status: "idle" } },
      }),
    );
    watcher.flush();
    expect(recorded.publishes).toEqual([{ roots: ["thr_root"] }]);

    vi.advanceTimersByTime(1_499);
    expect(recorded.publishes).toEqual([{ roots: ["thr_root"] }]); // still waiting
    vi.advanceTimersByTime(1);
    expect(recorded.publishes).toEqual([{ roots: ["thr_root"] }, { roots: ["thr_root"] }]); // exactly one
  });

  it("treats turn/completed appended events as terminal", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touch("thr_root", ["thr_root"], null);
    await watcher.handleChanged(
      changed("thr_root", {
        changes: ["events-appended"],
        metadata: { eventTypes: ["item/completed", "turn/completed"] },
      }),
    );
    watcher.flush();
    vi.advanceTimersByTime(1_500);
    expect(recorded.publishes).toEqual([{ roots: ["thr_root"] }, { roots: ["thr_root"] }]);
  });

  it("schedules a reconciliation for terminal lifecycle events only", async () => {
    const cases: Array<[LifecycleKind, boolean]> = [
      ["idle", true],
      ["failed", true],
      ["archived", true],
      ["deleted", true],
      ["turn-failed", true],
      ["created", false],
      ["active", false],
      ["other", false],
    ];
    for (const [kind, expected] of cases) {
      const { watcher, recorded } = makeWatcher();
      watcher.touch("thr_root", ["thr_root"], null);
      await watcher.handleLifecycle({ id: "thr_new", parentThreadId: "thr_root" }, kind);
      watcher.flush();
      vi.advanceTimersByTime(1_500);
      // flush publish (1) plus optional reconcile publish (2)
      expect(recorded.publishes).toHaveLength(expected ? 2 : 1);
    }
  });

  it("does not schedule a reconciliation for non-terminal flushes", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touch("thr_root", ["thr_root"], null);
    await watcher.handleChanged(changed("thr_root", { changes: ["status-changed"] }));
    watcher.flush();
    vi.advanceTimersByTime(10_000);
    expect(recorded.publishes).toEqual([{ roots: ["thr_root"] }]);
  });

  it("replaces — never stacks — the pending reconciliation across terminal flushes", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touch("thr_a", ["thr_a"], null);
    watcher.touch("thr_b", ["thr_b"], null);
    await watcher.handleChanged(
      changed("thr_a", { changes: ["status-changed"], metadata: { statusChange: { status: "idle" } } }),
    );
    watcher.flush();
    await watcher.handleChanged(
      changed("thr_b", { changes: ["status-changed"], metadata: { statusChange: { status: "error" } } }),
    );
    watcher.flush(); // second terminal flush replaces the pending reconcile
    vi.advanceTimersByTime(5_000);
    // Two immediate flushes; only ONE delayed reconcile, carrying the latest payload.
    expect(recorded.publishes).toEqual([
      { roots: ["thr_a"] },
      { roots: ["thr_b"] },
      { roots: ["thr_b"] },
    ]);
  });

  it("merges a scoped and global terminal flush into a single reconciled payload", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touch("thr_root", ["thr_root"], null);
    watcher.touchGlobal();
    await watcher.handleChanged(
      changed("thr_root", {
        changes: ["status-changed"],
        metadata: { statusChange: { status: "idle" } },
      }),
    );
    watcher.flush();
    vi.advanceTimersByTime(1_500);
    expect(recorded.publishes).toEqual([
      { roots: ["thr_root"], global: true },
      { roots: ["thr_root"], global: true },
    ]);
  });

  it("cancels the pending reconciliation on dispose", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touch("thr_root", ["thr_root"], null);
    await watcher.handleChanged(
      changed("thr_root", { changes: ["status-changed"], metadata: { statusChange: { status: "idle" } } }),
    );
    watcher.flush();
    expect(recorded.publishes).toHaveLength(1);
    watcher.dispose();
    vi.advanceTimersByTime(5_000);
    expect(recorded.publishes).toHaveLength(1);
  });

  it("does not leak a terminal flag from a flush that published nothing", async () => {
    const { watcher, recorded } = makeWatcher();
    // No root watched and no global lease: nothing dirty, flush publishes nothing.
    await watcher.handleChanged(
      changed("thr_root", { changes: ["status-changed"], metadata: { statusChange: { status: "idle" } } }),
    );
    watcher.flush();
    expect(recorded.publishes).toEqual([]);
    // Later, a non-terminal change must not inherit the earlier terminal flag.
    watcher.touch("thr_root", ["thr_root"], null);
    await watcher.handleChanged(changed("thr_root", { changes: ["status-changed"] }));
    watcher.flush();
    vi.advanceTimersByTime(5_000);
    expect(recorded.publishes).toEqual([{ roots: ["thr_root"] }]);
  });

  it("is terminal only for the documented statuses and turn events", () => {
    expect(isTerminalThreadChange(changed("t", { metadata: { statusChange: { status: "idle" } } }))).toBe(true);
    expect(isTerminalThreadChange(changed("t", { metadata: { statusChange: { status: "error" } } }))).toBe(true);
    expect(isTerminalThreadChange(changed("t", { metadata: { statusChange: { status: "active" } } }))).toBe(false);
    expect(isTerminalThreadChange(changed("t", { metadata: { eventTypes: ["turn/completed", "item/completed"] } }))).toBe(true);
    expect(isTerminalThreadChange(changed("t", { metadata: { eventTypes: ["item/completed"] } }))).toBe(false);
    expect(isTerminalThreadChange(changed("t", {}))).toBe(false);
    expect(isTerminalLifecycleKind("idle")).toBe(true);
    expect(isTerminalLifecycleKind("turn-failed")).toBe(true);
    expect(isTerminalLifecycleKind("active")).toBe(false);
  });
});

describe("channel contract", () => {
  it("publishes on the documented realtime channel", () => {
    expect(BoardWatcher.channel).toBe(BOARD_CHANGED_CHANNEL);
    expect(BOARD_CHANGED_CHANNEL).toBe("agent-board-changed");
  });
});

describe("global dashboard invalidation", () => {
  it("invalidates a watched global page for any relevant thread change", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touchGlobal();
    await watcher.handleChanged(changed("thr_any", { changes: ["status-changed"] }));
    watcher.flush();
    expect(recorded.publishes).toEqual([{ roots: [], global: true }]);
    expect(recorded.lookups).toEqual([]);
  });

  it("coalesces scoped and global invalidation in one signal", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touch("thr_root", ["thr_root"], null);
    watcher.touchGlobal();
    await watcher.handleChanged(changed("thr_root", { changes: ["status-changed"] }));
    watcher.flush();
    expect(recorded.publishes).toEqual([{ roots: ["thr_root"], global: true }]);
  });

  it("does not wake the global page for ignored reasoning deltas", async () => {
    const { watcher, recorded } = makeWatcher();
    watcher.touchGlobal();
    await watcher.handleChanged(changed("thr_root", { changes: ["events-appended"], metadata: { eventTypes: ["item/reasoning/textDelta"] } }));
    watcher.flush();
    expect(recorded.publishes).toEqual([]);
  });

  it("expires the global watch lease", async () => {
    let now = 0;
    const { watcher, recorded } = makeWatcher({ now: () => now, watchedTtlMs: 100 });
    watcher.touchGlobal();
    now = 101;
    await watcher.handleChanged(changed("thr_root", { changes: ["status-changed"] }));
    watcher.flush();
    expect(recorded.publishes).toEqual([]);
  });
});
