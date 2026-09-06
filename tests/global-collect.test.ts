import { describe, expect, it, vi } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { BOARD_LIMITS } from "@/lib/board-model";
import { BoardCollector, groupGlobalThreadRows } from "@/lib/collect";

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, parentThreadId: null, projectId: "proj", providerId: "pi", title: id,
    titleFallback: null, status: "idle", createdAt: 100, updatedAt: 1_000,
    ...overrides,
  };
}

function timeline(overrides: Record<string, unknown> = {}) {
  return {
    rows: [], activeWorkflows: [], activeBackgroundCommands: [], maxSeq: 0,
    timelinePage: { kind: "latest", hasOlderRows: false, returnedSegmentCount: 0, segmentLimit: 40 },
    activePromptMode: null, activeThinking: null, goal: null, modelFallback: null, pendingTodos: null,
    ...overrides,
  };
}

function activeWork(path = "src/auth.ts") {
  return {
    id: `read:${path}`, kind: "work", workKind: "file-read", threadId: "thr_child", turnId: "turn-1",
    sourceSeqStart: 1, sourceSeqEnd: 2, createdAt: 500, startedAt: 500, completedAt: null,
    status: "active", path, presentation: { label: { pending: `Reading ${path}`, completed: `Read ${path}` } },
  };
}

function makeCollector(options: {
  rows?: unknown[];
  listError?: Error;
  redteam?: unknown;
  callRpcError?: Error;
  now?: () => number;
} = {}) {
  const rows = options.rows ?? [row("thr_root", { status: "active", title: "Root work" })];
  const sdk = {
    threads: {
      list: vi.fn(async () => {
        if (options.listError) throw options.listError;
        return rows;
      }),
      timeline: vi.fn(async ({ threadId }: { threadId: string }) => timeline({ rows: threadId.includes("active") || threadId === "thr_child" ? [activeWork()] : [] })),
      defaultExecutionOptions: vi.fn(async ({ threadId }: { threadId: string }) => threadId === "thr_nomodel" ? null : { model: "qwen3:8b" }),
      output: vi.fn(async () => ({ output: "Completed safely" })),
      events: { list: vi.fn(async () => [{ id: "e", scope: "thread", threadId: "x", seq: 1, createdAt: 900, type: "system/error", data: { message: "Provisioning failed" } }]) },
      queuedMessages: { list: vi.fn(async () => []) },
    },
    providers: { list: vi.fn(async () => [{ id: "pi", displayName: "Pi" }]) },
    plugins: { callRpc: vi.fn(async () => {
      if (options.callRpcError) throw options.callRpcError;
      return options.redteam ?? { schemaVersion: 1, observedAt: "2026-09-03T12:00:00.000Z", scans: [] };
    }) },
  };
  const collector = new BoardCollector({ sdk } as unknown as BbPluginApi, options.now ?? (() => 2_000));
  return { collector, sdk };
}

describe("global BB collection", () => {
  it("uses one bounded thread list and enriches one representative per logical execution", async () => {
    const rows = [
      row("thr_root", { title: "Parent operation", status: "idle", updatedAt: 800 }),
      row("thr_child", { parentThreadId: "thr_root", status: "active", updatedAt: 1_000 }),
    ];
    const { collector, sdk } = makeCollector({ rows });
    const result = await collector.globalDashboard();
    expect(sdk.threads.list).toHaveBeenCalledWith({ archived: false, includeHidden: true, limit: BOARD_LIMITS.globalThreadRows });
    expect(sdk.threads.list).toHaveBeenCalledTimes(1);
    expect(sdk.threads.timeline).toHaveBeenCalledTimes(1);
    expect(result.active).toHaveLength(1);
    expect(result.active[0]!.card.title).toBe("Parent operation");
    expect(result.active[0]!.card.threadId).toBe("thr_child");
    expect(result.active[0]!.card.model).toBe("qwen3:8b");
    expect(result.active[0]!.card.activity?.text).toBe("Reading src/auth.ts");
  });

  it("groups nested descendants without duplicate execution cards", () => {
    const groups = groupGlobalThreadRows([
      row("root"), row("child", { parentThreadId: "root" }), row("grand", { parentThreadId: "child" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.root.id).toBe("root");
    expect(groups[0]!.rows).toHaveLength(3);
  });

  it("treats an orphaned visible child as a bounded standalone group", () => {
    const groups = groupGlobalThreadRows([row("child", { parentThreadId: "older-parent" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.root.id).toBe("child");
  });

  it("enforces global row and recent enrichment bounds", async () => {
    const rows = Array.from({ length: BOARD_LIMITS.globalThreadRows }, (_, index) => row(`thr_${index}`, { updatedAt: index }));
    const { collector, sdk } = makeCollector({ rows });
    const result = await collector.globalDashboard();
    expect(result.partial).toBe(true);
    expect(result.recent).toHaveLength(BOARD_LIMITS.globalRecentExecutions);
    expect(sdk.threads.timeline).toHaveBeenCalledTimes(BOARD_LIMITS.globalRecentExecutions);
  });

  it("coalesces concurrent global requests and serves the short TTL cache", async () => {
    const { collector, sdk } = makeCollector();
    const [a, b] = await Promise.all([collector.globalDashboard(), collector.globalDashboard()]);
    expect(a).toEqual(b);
    await collector.globalDashboard();
    expect(sdk.threads.list).toHaveBeenCalledTimes(1);
    expect(sdk.plugins.callRpc).toHaveBeenCalledTimes(2); // Redteam + Fleet; both coalesced
  });

  it("refreshes stale cached data", async () => {
    let now = 0;
    const { collector, sdk } = makeCollector({ now: () => now });
    await collector.globalDashboard();
    now = 1_300;
    await collector.globalDashboard();
    expect(sdk.threads.list).toHaveBeenCalledTimes(2);
  });

  it("isolates Redteam absence without breaking BB", async () => {
    const { collector } = makeCollector({ callRpcError: new Error("unknown_method") });
    const result = await collector.globalDashboard();
    expect(result.active).toHaveLength(1);
    expect(result.unavailableSources).toContain("redteam");
  });

  it("isolates BB failure while preserving Redteam", async () => {
    const redteam = {
      schemaVersion: 1, observedAt: "2026-09-03T12:00:00.000Z", scans: [{
        scanId: "scan-1", projectId: "proj", title: "Tiny lab", mode: "static", status: "running",
        startedAt: "2026-09-03T11:59:00.000Z", updatedAt: "2026-09-03T12:00:00.000Z", finishedAt: null,
        currentPhaseId: "code-review", failedPhaseId: null, phases: [], operations: [],
        candidateCounts: { total: 0, codeReview: 0, webTesting: 0 },
        findingCounts: { total: 0, unverified: 0, confirmed: 0, inconclusive: 0, rejected: 0, severity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 } }, error: null,
      }],
    };
    const { collector } = makeCollector({ listError: new Error("BB unavailable"), redteam });
    const result = await collector.globalDashboard();
    expect(result.active[0]!.key).toBe("redteam:scan-1");
    expect(result.unavailableSources).toContain("bb");
  });

  it("does not fabricate a model when execution options are unavailable", async () => {
    const { collector } = makeCollector({ rows: [row("thr_nomodel", { status: "active" })] });
    expect((await collector.globalDashboard()).active[0]!.card.model).toBeNull();
  });
});

describe("attention dismissal plumbing (global collect)", () => {
  it("hides a dismissed condition end-to-end while keeping the failure visible in Recent", async () => {
    const rows = [row("thr_fail", { status: "error", updatedAt: 5_000, title: "Deploy" })];
    const { collector } = makeCollector({ rows });
    const open = await collector.globalDashboard({ fresh: true });
    expect(open.attention).toHaveLength(1);
    const item = open.attention[0]!;
    expect(item.type).toBe("failed");
    expect(item.executionKey).toBe("bb:thr_fail");
    expect(item.updatedAt).toBe(5_000);
    expect(open.counts.attention).toBe(1);
    expect(open.dismissedCount).toBe(0);
    expect(open.recent.some((entry) => entry.key === "bb:thr_fail")).toBe(true);

    const key = `${item.executionKey}::${item.type}::${item.updatedAt}`;
    const dismissed = await collector.globalDashboard({
      fresh: true,
      dismissedKeys: new Set([key]),
    });
    expect(dismissed.attention).toEqual([]);
    expect(dismissed.counts.attention).toBe(0);
    expect(dismissed.counts.failures).toBe(0);
    expect(dismissed.dismissedCount).toBe(1);
    expect(dismissed.recent.some((entry) => entry.key === "bb:thr_fail")).toBe(true);
  });

  it("reappears only when the underlying condition changes (new updatedAt)", async () => {
    const { collector } = makeCollector({ rows: [row("thr_fail", { status: "error", updatedAt: 5_000 })] });
    const [item] = (await collector.globalDashboard({ fresh: true })).attention;
    expect(item).toBeDefined();
    const dismissedKeys = new Set([`${item.executionKey}::${item.type}::${item.updatedAt}`]);

    // Re-derive the SAME condition: still dismissed.
    const same = await collector.globalDashboard({ fresh: true, dismissedKeys });
    expect(same.attention).toEqual([]);

    // The execution updated: the genuinely new condition reappears.
    const updated = makeCollector({ rows: [row("thr_fail", { status: "error", updatedAt: 9_000 })] });
    const reappeared = await updated.collector.globalDashboard({ fresh: true, dismissedKeys });
    expect(reappeared.attention).toHaveLength(1);
    expect(reappeared.attention[0]!.updatedAt).toBe(9_000);
    expect(reappeared.dismissedCount).toBe(0);
  });
});
