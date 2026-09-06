// Collector tests: bounded fan-out, ephemeral TTL caches, inflight dedupe,
// tree caps, delegation enrichment, and error/queued handling — driven
// through the official fake SDK harness.
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeSdk } from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { FakeSdkOverrides } from "@get-bb/plugin-sdk/testing";
import { BoardCollector } from "@/lib/collect";

/** Real sdk arg types (wire DTOs are not exported individually). */
type ThreadsArea = BbPluginApi["sdk"]["threads"];
type ListArgsLike = NonNullable<Parameters<ThreadsArea["list"]>[0]>;
type TimelineArgsLike = NonNullable<Parameters<ThreadsArea["timeline"]>[0]>;
type StatusArgsLike = NonNullable<Parameters<ThreadsArea["defaultExecutionOptions"]>[0]>;

let now = 0;
const clock = () => now;

beforeEach(() => {
  now = 0;
});

function thread(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    parentThreadId: null,
    providerId: "pi",
    title: id,
    titleFallback: null,
    status: "idle",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function timelineFixture(overrides: Record<string, unknown> = {}) {
  return {
    rows: [],
    activeWorkflows: [],
    activeBackgroundCommands: [],
    maxSeq: 0,
    timelinePage: {
      kind: "latest",
      hasOlderRows: false,
      returnedSegmentCount: 0,
      segmentLimit: 40,
    },
    activePromptMode: null,
    activeThinking: null,
    goal: null,
    modelFallback: null,
    pendingTodos: null,
    ...overrides,
  };
}

function delegationRow(childRef: string, fields: Record<string, unknown> = {}) {
  return {
    id: `delegation-${childRef}`,
    kind: "work",
    workKind: "delegation",
    callId: "call-1",
    threadId: "thr_root",
    turnId: "turn-1",
    createdAt: 100,
    startedAt: 100,
    completedAt: 900,
    status: "completed",
    sourceSeqStart: 1,
    sourceSeqEnd: 2,
    description: "Fix the tests",
    background: false,
    output: "All 12 tests pass.",
    childRef,
    childRows: [],
    ...fields,
  };
}

/** A root with one idle child, with a delegation pointing at that child. */
function twoThreadOverrides(): FakeSdkOverrides {
  return {
    threads: {
      get: async () =>
        thread("thr_root", { parentThreadId: null, status: "active", title: "Root work" }),
      list: async (args: ListArgsLike) =>
        args.parentThreadId === "thr_root"
          ? [thread("thr_child", { parentThreadId: "thr_root", title: null, titleFallback: null })]
          : [],
      timeline: async (args: TimelineArgsLike) =>
        timelineFixture(
          args.threadId === "thr_root"
            ? { rows: [delegationRow("thr_child")] }
            : {},
        ),
      defaultExecutionOptions: async (args: StatusArgsLike) =>
        args.threadId === "thr_root" ? { model: "qwen3-coder:30b" } : null,
      output: async () => ({ output: "Child finished its own work." }),
      events: {
        list: async () => [
          {
            id: "e1",
            scope: "thread",
            threadId: "thr_child",
            seq: 1,
            createdAt: 100,
            type: "system/error",
            data: { message: "boom" },
          },
        ],
      },
      queuedMessages: {
        list: async () => [],
      },
    },
    providers: {
      list: async () => [{ id: "pi", displayName: "Pi" }],
    },
  } as unknown as FakeSdkOverrides;
}

function makeCollector(overrides: FakeSdkOverrides) {
  const { sdk, harness } = createFakeSdk({ pluginId: "agent-board", overrides });
  const bb = { sdk } as unknown as BbPluginApi;
  return { collector: new BoardCollector(bb, clock), harness };
}

describe("snapshot assembly", () => {
  it("renders root and child cards with delegation enrichment", async () => {
    const { collector } = makeCollector(twoThreadOverrides());
    const snap = await collector.snapshot("thr_root");

    expect(snap.root.threadId).toBe("thr_root");
    expect(snap.root.title).toBe("Root work");
    expect(snap.root.model).toBe("qwen3-coder:30b");
    expect(snap.root.providerLabel).toBe("Pi");
    expect(snap.partial).toBe(false);

    const rootCard = snap.cards.find((card) => card.isRoot && card.kind === "thread")!;
    expect(rootCard.status).toBe("running");
    expect(rootCard.column).toBe("active");

    const childCard = snap.cards.find((card) => card.threadId === "thr_child")!;
    expect(childCard.title).toBe("Fix the tests"); // delegation description
    expect(childCard.status).toBe("completed");
    expect(childCard.outputPreview).toBe("Child finished its own work.");
    expect(childCard.depth).toBe(1);

    // The delegation's child is observed, so no duplicate delegation card.
    expect(snap.cards.some((card) => card.kind === "delegation")).toBe(false);

    expect(snap.counts.running).toBe(1);
    expect(snap.counts.completed).toBe(1);
  });

  it("keeps a delegation card when the child thread is not visible", async () => {
    const overrides = twoThreadOverrides();
    // Child list returns nothing: the delegation childRef is unobserved.
    (overrides.threads as Record<string, unknown>).list = async () => [];
    const { collector } = makeCollector(overrides);
    const snap = await collector.snapshot("thr_root");

    const delegation = snap.cards.find((card) => card.kind === "delegation");
    expect(delegation).toBeDefined();
    expect(delegation!.title).toBe("Fix the tests");
    expect(delegation!.outputPreview).toBe("All 12 tests pass.");
    expect(delegation!.threadId).toBe("thr_child");
  });
});

describe("bounded fetching and caching", () => {
  it("serves repeat snapshots from the ephemeral snapshot cache", async () => {
    const { collector, harness } = makeCollector(twoThreadOverrides());
    await collector.snapshot("thr_root");
    const afterFirst = harness.calls.length;

    await collector.snapshot("thr_root"); // within the 1.2s snapshot TTL
    expect(harness.calls.length).toBe(afterFirst);

    now = 1_300; // snapshot (1.2s) and children (1s) TTLs expired
    const snap = await collector.snapshot("thr_root");
    expect(harness.calls.length).toBeGreaterThan(afterFirst);
    expect(snap.fetchedAt).toBe(1_300);
  });

  it("keeps long-lived model and provider caches warm across refreshes", async () => {
    const { collector, harness } = makeCollector(twoThreadOverrides());
    await collector.snapshot("thr_root");
    const modelCalls = harness.callsTo("threads.defaultExecutionOptions").length;
    const providerCalls = harness.callsTo("providers.list").length;

    now = 5_000; // beyond the 2s timeline/children TTLs, within 60s model TTL
    await collector.snapshot("thr_root", { fresh: true });
    expect(harness.callsTo("threads.defaultExecutionOptions").length).toBe(modelCalls);
    expect(harness.callsTo("providers.list").length).toBe(providerCalls);
  });

  it("fresh: true bypasses only the snapshot cache", async () => {
    const { collector, harness } = makeCollector(twoThreadOverrides());
    await collector.snapshot("thr_root");
    const afterFirst = harness.calls.length;

    const snap = await collector.snapshot("thr_root", { fresh: true });
    expect(snap.root.threadId).toBe("thr_root");
    // Underlying 1s/2s caches still hold: children/timelines/models are not
    // refetched. Only the uncached threads.get runs again.
    expect(harness.calls.length).toBe(afterFirst + 2); // threads.get + explicit fresh Fleet snapshot
    expect(harness.callsTo("threads.list").length).toBe(2);
    expect(harness.callsTo("threads.timeline").length).toBe(2);
    expect(harness.callsTo("threads.defaultExecutionOptions").length).toBe(2);
  });

  it("coalesces concurrent snapshot requests into one SDK fan-out", async () => {
    let release!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const overrides = twoThreadOverrides();
    const threadsArea = overrides.threads as Record<string, unknown>;
    const baseGet = threadsArea.get as () => Promise<unknown>;
    threadsArea.get = async () => {
      await gate;
      return baseGet();
    };
    const { collector, harness } = makeCollector(overrides);

    const first = collector.snapshot("thr_root");
    const second = collector.snapshot("thr_root");
    release(undefined);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(harness.callsTo("threads.get").length).toBe(1);
    expect(harness.callsTo("threads.list").length).toBe(2); // root + child, once each
  });

  it("invalidate() forces a full refetch including models", async () => {
    const { collector, harness } = makeCollector(twoThreadOverrides());
    await collector.snapshot("thr_root");
    const modelCalls = harness.callsTo("threads.defaultExecutionOptions").length;

    collector.invalidate();
    await collector.snapshot("thr_root");
    // Both threads' models are re-resolved (the root's second lookup inside
    // collect() then hits the freshly repopulated cache).
    expect(harness.callsTo("threads.defaultExecutionOptions").length).toBe(modelCalls + 2);
  });

  it("fetches events only for error threads and output only for idle ones", async () => {
    const overrides = twoThreadOverrides();
    (overrides.threads as Record<string, unknown>).get = async () =>
      thread("thr_root", { status: "error" });
    const { collector, harness } = makeCollector(overrides);
    const snap = await collector.snapshot("thr_root");

    expect(snap.cards.find((card) => card.isRoot)!.errorPreview).toBe("boom");
    expect(harness.callsTo("threads.events.list").length).toBe(1); // root only
    expect(harness.callsTo("threads.output").length).toBe(1); // the idle child
  });

  it("shows the finished root's output preview too", async () => {
    const overrides = twoThreadOverrides();
    (overrides.threads as Record<string, unknown>).get = async () =>
      thread("thr_root", { status: "idle", title: "Root work" });
    (overrides.threads as Record<string, unknown>).output = async (args: { threadId: string }) => ({
      output: args.threadId === "thr_root" ? "Root finished cleanly." : "Child finished.",
    });
    const { collector } = makeCollector(overrides);
    const snap = await collector.snapshot("thr_root");
    expect(snap.cards.find((card) => card.isRoot)!.outputPreview).toBe("Root finished cleanly.");
  });

  it("never fetches queued messages when the count is zero", async () => {
    const { collector, harness } = makeCollector(twoThreadOverrides());
    await collector.snapshot("thr_root");
    expect(harness.callsTo("threads.queuedMessages.list").length).toBe(0);
  });
});

describe("lazy execution timeline RPC source", () => {
  it("adds no collection calls until requested and uses one BB timeline plus one lifecycle tail", async () => {
    const { collector, harness } = makeCollector(twoThreadOverrides());
    expect(harness.calls).toHaveLength(0);
    const result = await collector.executionTimeline({ source: "bb", executionKey: "bb:thr_root", threadId: "thr_root" });
    expect(result.executionKey).toBe("bb:thr_root");
    expect(harness.callsTo("threads.timeline")).toHaveLength(1);
    expect(harness.callsTo("threads.events.list")).toHaveLength(1);
    expect(harness.calls).toHaveLength(3); // timeline + lifecycle + optional Fleet
  });

  it("coalesces same-generation requests and keeps completed timelines stable", async () => {
    let release!: (value: unknown) => void;
    const gate = new Promise((resolve) => { release = resolve; });
    const overrides = twoThreadOverrides();
    (overrides.threads as Record<string, unknown>).timeline = async () => gate;
    const { collector, harness } = makeCollector(overrides);
    const input = { source: "bb" as const, executionKey: "bb:thr_root", threadId: "thr_root" };
    const first = collector.executionTimeline(input);
    const second = collector.executionTimeline(input);
    release(timelineFixture({ rows: [{ ...delegationRow("thr_child"), status: "completed" }] }));
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(a.active).toBe(false);
    expect(harness.callsTo("threads.timeline")).toHaveLength(1);
    now = 30_000;
    await collector.executionTimeline(input);
    expect(harness.callsTo("threads.timeline")).toHaveLength(1);
  });

  it("does not let a pre-invalidation in-flight result regain a fresh cache timestamp", async () => {
    let releaseFirst!: (value: unknown) => void;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    let calls = 0;
    const overrides = twoThreadOverrides();
    (overrides.threads as Record<string, unknown>).timeline = async () => {
      calls += 1;
      if (calls === 1) return firstGate;
      return timelineFixture();
    };
    const { collector, harness } = makeCollector(overrides);
    const input = { source: "bb" as const, executionKey: "bb:thr_root", threadId: "thr_root" };
    const stale = collector.executionTimeline(input);
    collector.invalidate();
    releaseFirst(timelineFixture());
    await stale;
    await collector.executionTimeline(input);
    expect(harness.callsTo("threads.timeline")).toHaveLength(2);
  });

  it("enforces server bounds and reports source truncation", async () => {
    const rows = Array.from({ length: 90 }, (_, index) => delegationRow(`thr_${index}`, { id: `d-${index}`, startedAt: index + 1, createdAt: index + 1, completedAt: null, status: "pending", childRef: null }));
    const overrides = twoThreadOverrides();
    (overrides.threads as Record<string, unknown>).timeline = async () => timelineFixture({ rows, timelinePage: { kind: "latest", hasOlderRows: true, returnedSegmentCount: 80, segmentLimit: 80 } });
    const { collector } = makeCollector(overrides);
    const result = await collector.executionTimeline({ source: "bb", executionKey: "bb:thr_root", threadId: "thr_root", limit: 999 });
    expect(result.events).toHaveLength(80);
    expect(result.truncated).toBe(true);
  });

  it("bounds the disposable per-execution timeline cache", async () => {
    const { collector, harness } = makeCollector(twoThreadOverrides());
    for (let index = 0; index <= 24; index += 1) {
      await collector.executionTimeline({ source: "bb", executionKey: `bb:run-${index}`, threadId: `thr_${index}` });
    }
    expect(harness.callsTo("threads.timeline")).toHaveLength(25);
    await collector.executionTimeline({ source: "bb", executionKey: "bb:run-0", threadId: "thr_0" });
    expect(harness.callsTo("threads.timeline")).toHaveLength(26);
  });

  it("survives lifecycle-tail failure but rejects a missing authoritative timeline", async () => {
    const degraded = twoThreadOverrides();
    (degraded.threads as Record<string, unknown>).events = { list: async () => { throw new Error("events offline"); } };
    const { collector } = makeCollector(degraded);
    await expect(collector.executionTimeline({ source: "bb", executionKey: "bb:thr_root", threadId: "thr_root" })).resolves.toMatchObject({ sourceWarning: "Some lifecycle details are temporarily unavailable." });

    const unavailable = twoThreadOverrides();
    (unavailable.threads as Record<string, unknown>).timeline = async () => { throw new Error("timeline offline"); };
    const failed = makeCollector(unavailable).collector;
    await expect(failed.executionTimeline({ source: "bb", executionKey: "bb:thr_root", threadId: "thr_root" })).rejects.toThrow("timeline is unavailable");
  });

  it("reports an unavailable optional Redteam source without affecting BB collection", async () => {
    const { collector } = makeCollector(twoThreadOverrides());
    await expect(collector.executionTimeline({ source: "redteam", executionKey: "redteam:missing", scanId: "missing" })).rejects.toThrow("Redteam timeline is unavailable");
    await expect(collector.executionTimeline({ source: "bb", executionKey: "bb:thr_root", threadId: "thr_root" })).resolves.toMatchObject({ source: "bb" });
  });
});

describe("tree bounds", () => {
  it("caps the thread count and flags partial", async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      thread(`thr_${i}`, { parentThreadId: "thr_root" }),
    );
    const overrides = twoThreadOverrides();
    (overrides.threads as Record<string, unknown>).list = async () => many;
    const { collector } = makeCollector(overrides);

    const snap = await collector.snapshot("thr_root");
    expect(snap.partial).toBe(true);
    const threadCards = snap.cards.filter((card) => card.kind === "thread");
    expect(threadCards.length).toBeLessThanOrEqual(24);
  });

  it("stops at the depth cap and flags partial when deeper threads exist", async () => {
    // Chain root -> a -> b -> c -> d -> e (depths 0..5, cap 4)
    const overrides = twoThreadOverrides();
    (overrides.threads as Record<string, unknown>).get = async () =>
      thread("thr_root", { status: "active" });
    (overrides.threads as Record<string, unknown>).list = async (args: ListArgsLike) => {
      const parent = args.parentThreadId ?? "";
      const chain: Record<string, string> = {
        thr_root: "thr_a",
        thr_a: "thr_b",
        thr_b: "thr_c",
        thr_c: "thr_d",
        thr_d: "thr_e",
      };
      const next = chain[parent];
      return next ? [thread(next, { parentThreadId: parent })] : [];
    };
    const { collector } = makeCollector(overrides);

    const snap = await collector.snapshot("thr_root");
    expect(snap.partial).toBe(true);
    const threadIds = new Set(
      snap.cards.filter((card) => card.kind === "thread").map((card) => card.threadId),
    );
    expect(threadIds.has("thr_e")).toBe(false); // beyond the cap
    expect(threadIds.has("thr_d")).toBe(true);
  });
});

describe("queued messages", () => {
  it("creates queued-message cards for a thread with pending messages", async () => {
    const overrides = twoThreadOverrides();
    (overrides.threads as Record<string, unknown>).get = async () =>
      thread("thr_root", { status: "idle", queuedMessageCount: 1 });
    (overrides.threads as Record<string, unknown>).queuedMessages = {
      list: async () => [
        {
          id: "q1",
          threadId: "thr_root",
          createdAt: 100,
          editable: true,
          groupWithNext: false,
          model: "qwen3-coder:30b",
          permissionMode: "auto",
          reasoningLevel: "none",
          serviceTier: "default",
          updatedAt: 100,
          content: [{ type: "text", text: "Please run the suite" }],
          sendAt: 0,
          waitingOn: { kind: "thread-busy" },
        },
      ],
    };
    const { collector } = makeCollector(overrides);
    const snap = await collector.snapshot("thr_root");

    const queued = snap.cards.find((card) => card.kind === "queued-message");
    expect(queued).toBeDefined();
    expect(queued!.title).toBe("Please run the suite");
    expect(queued!.status).toBe("queued");
    expect(queued!.column).toBe("plan");
    expect(queued!.waitingOn).toBe("Waiting for busy thread");
    // The idle thread with pending messages counts as queued itself, plus
    // the queued-message card in the same plan column.
    expect(snap.cards.find((card) => card.isRoot && card.kind === "thread")!.status).toBe("queued");
    expect(snap.counts.queued).toBe(2);
  });
});

describe("model resolution", () => {
  it("tolerates defaultExecutionOptions failures", async () => {
    const overrides = twoThreadOverrides();
    (overrides.threads as Record<string, unknown>).get = async () =>
      thread("thr_root", { status: "active" });
    (overrides.threads as Record<string, unknown>).defaultExecutionOptions = async () => {
      throw new Error("no options yet");
    };
    const { collector } = makeCollector(overrides);
    const snap = await collector.snapshot("thr_root");
    expect(snap.root.model).toBeNull();
    const rootCard = snap.cards.find((card) => card.isRoot && card.kind === "thread")!;
    expect(rootCard.model).toBeNull();
  });
});

describe("activity feed", () => {
  it("returns a bounded, reasoning-free activity tail", async () => {
    const overrides = twoThreadOverrides();
    (overrides.threads as Record<string, unknown>).events = {
      list: async () => [
        {
          id: "e2",
          scope: "thread",
          threadId: "thr_child",
          seq: 2,
          createdAt: 200,
          type: "item/reasoning/textDelta",
          data: { item: { text: "SECRET PLANNING TEXT" } },
        },
        {
          id: "e1",
          scope: "thread",
          threadId: "thr_child",
          seq: 1,
          createdAt: 100,
          type: "item/started",
          data: { item: { label: "Running the test suite" } },
        },
      ],
    };
    const { collector } = makeCollector(overrides);
    const { entries } = await collector.activity("thr_child", 10);

    expect(entries).toHaveLength(1);
    expect(entries[0]!.text).toBe("Running the test suite");
    expect(JSON.stringify(entries)).not.toContain("SECRET");
  });

  it("clamps the requested limit to the board cap", async () => {
    const overrides = twoThreadOverrides();
    const events = Array.from({ length: 60 }, (_, i) => ({
      id: `e${i}`,
      scope: "thread",
      threadId: "thr_child",
      seq: i,
      createdAt: i,
      type: "thread/started",
      data: {},
    }));
    (overrides.threads as Record<string, unknown>).events = {
      list: async () => events,
    };
    const { collector } = makeCollector(overrides);
    expect((await collector.activity("thr_child", 1000)).entries.length).toBe(40);
  });
});

describe("watcher feed", () => {
  it("reports the thread ids observed in the last snapshot", async () => {
    const { collector } = makeCollector(twoThreadOverrides());
    expect(collector.lastObservedThreads("thr_root")).toBeNull();
    await collector.snapshot("thr_root");
    expect(collector.lastObservedThreads("thr_root")).toEqual(["thr_root", "thr_child"]);
  });
});

describe("source coexistence", () => {
  it("merges optional Redteam cards without changing generic BB cards", async () => {
    const overrides = twoThreadOverrides();
    (overrides.threads as Record<string, unknown>).get = async () =>
      thread("thr_root", { parentThreadId: null, status: "active", title: "Root work", projectId: "project-1" });
    (overrides as Record<string, unknown>).plugins = {
      callRpc: async () => ({
        schemaVersion: 1,
        observedAt: "2026-09-03T12:00:10.000Z",
        scans: [{
          scanId: "scan-1", projectId: "project-1", title: "Authorized scan", mode: "static", status: "running",
          startedAt: "2026-09-03T12:00:00.000Z", updatedAt: "2026-09-03T12:00:10.000Z", finishedAt: null,
          currentPhaseId: "code-review", failedPhaseId: null,
          phases: [
            { id: "queued", label: "Queued", state: "completed", startedAt: "2026-09-03T12:00:00.000Z", finishedAt: "2026-09-03T12:00:01.000Z", durationMs: 1000, summary: null, error: null },
            { id: "reconnaissance", label: "Reconnaissance", state: "completed", startedAt: "2026-09-03T12:00:01.000Z", finishedAt: "2026-09-03T12:00:04.000Z", durationMs: 3000, summary: "2 entry points", error: null },
            { id: "code-review", label: "Code review", state: "running", startedAt: "2026-09-03T12:00:04.000Z", finishedAt: null, durationMs: 6000, summary: null, error: null },
            { id: "web-testing", label: "Web testing", state: "queued", startedAt: null, finishedAt: null, durationMs: null, summary: null, error: null },
            { id: "verification", label: "Verification", state: "queued", startedAt: null, finishedAt: null, durationMs: null, summary: null, error: null },
            { id: "reporting", label: "Reporting", state: "queued", startedAt: null, finishedAt: null, durationMs: null, summary: null, error: null },
            { id: "completed", label: "Completed", state: "queued", startedAt: null, finishedAt: null, durationMs: null, summary: null, error: null },
          ],
          operations: [], candidateCounts: { total: 0, codeReview: 0, webTesting: 0 },
          findingCounts: { total: 0, unverified: 0, confirmed: 0, inconclusive: 0, rejected: 0, severity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 } }, error: null,
        }],
      }),
    };
    const { collector } = makeCollector(overrides);
    const snap = await collector.snapshot("thr_root");
    const bbRoot = snap.cards.find((card) => card.kind === "thread" && card.isRoot)!;
    expect(bbRoot.source).toBe("bb"); expect(bbRoot.title).toBe("Root work"); expect(bbRoot.status).toBe("running");
    const redteam = snap.cards.find((card) => card.source === "redteam" && card.phaseId === "code-review")!;
    expect(redteam.status).toBe("running"); expect(redteam.scanId).toBe("scan-1");
    expect(snap.cards.some((card) => card.source === "bb")).toBe(true); expect(snap.cards.some((card) => card.source === "redteam")).toBe(true);
  });
});

describe("activity feeds assembly", () => {
  it("feeds live-observed threads only — never idle ones", async () => {
    const { collector } = makeCollector(twoThreadOverrides());
    const snap = await collector.snapshot("thr_root");

    expect(snap.activityFeeds?.map((feed) => feed.key)).toEqual(["thread:thr_root"]);
    const rootFeed = snap.activityFeeds![0]!;
    expect(rootFeed.entries.length).toBeGreaterThan(0);
    // Built from the same safe work rows as the card activity.
    expect(rootFeed.entries[0]!.kind).toBe("delegation");
    expect(rootFeed.entries[0]!.detail).toContain("Fix the tests");
  });

  it("merges Redteam scan feeds after the thread feeds", async () => {
    const overrides = twoThreadOverrides();
    (overrides.threads as Record<string, unknown>).get = async () =>
      thread("thr_root", { parentThreadId: null, status: "active", title: "Root work", projectId: "project-1" });
    (overrides as Record<string, unknown>).plugins = {
      callRpc: async () => ({
        schemaVersion: 1,
        observedAt: "2026-09-03T12:00:10.000Z",
        scans: [{
          scanId: "scan-1", projectId: "project-1", title: "Authorized scan", mode: "static", status: "running",
          startedAt: "2026-09-03T12:00:00.000Z", updatedAt: "2026-09-03T12:00:10.000Z", finishedAt: null,
          currentPhaseId: "code-review", failedPhaseId: null,
          phases: [
            { id: "reconnaissance", label: "Reconnaissance", state: "completed", startedAt: "2026-09-03T12:00:01.000Z", finishedAt: "2026-09-03T12:00:04.000Z", durationMs: 3000, summary: "2 entry points", error: null },
            { id: "code-review", label: "Code review", state: "running", startedAt: "2026-09-03T12:00:04.000Z", finishedAt: null, durationMs: 6000, summary: null, error: null },
          ],
          operations: [
            { id: "op-1", kind: "tool", label: "read_file", phaseId: "code-review", state: "running", actualModel: null,
              task: "Reading", latestActivity: "Reading src/x.ts", toolName: "read_file", target: "src/x.ts",
              startedAt: "2026-09-03T12:00:04.000Z", updatedAt: "2026-09-03T12:00:09.000Z", finishedAt: null, durationMs: 5000, outputPreview: null, error: null },
          ],
          candidateCounts: { total: 0, codeReview: 0, webTesting: 0 },
          findingCounts: { total: 0, unverified: 0, confirmed: 0, inconclusive: 0, rejected: 0, severity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 } }, error: null,
        }],
      }),
    };
    const { collector } = makeCollector(overrides);
    const snap = await collector.snapshot("thr_root");

    expect(snap.activityFeeds!.map((feed) => feed.key)).toEqual([
      "thread:thr_root",
      "redteam:scan-1",
    ]);
    expect(snap.activityFeeds![1]!.entries[0]!.label).toBe("read_file");
  });

  it("omits thread feeds when the root is not live", async () => {
    const overrides = twoThreadOverrides();
    (overrides.threads as Record<string, unknown>).get = async () =>
      thread("thr_root", { parentThreadId: null, status: "idle", title: "Root work" });
    const { collector } = makeCollector(overrides);
    const snap = await collector.snapshot("thr_root");
    expect(snap.activityFeeds).toEqual([]);
  });
});

describe("terminal-state cache correctness (generation guards)", () => {
  it("does not serve or cache a pre-invalidation in-flight snapshot after invalidate()", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let getCall = 0;
    const overrides = twoThreadOverrides();
    const threadsArea = overrides.threads as Record<string, unknown>;
    const baseGet = threadsArea.get as () => Promise<unknown>;
    threadsArea.get = async () => {
      const callIndex = ++getCall;
      if (callIndex <= 2) await gate; // both collects are in flight together
      const value = (await baseGet()) as { id: string; title: string | null; titleFallback: string | null };
      if (callIndex <= 2) return { ...value, title: `Root v${callIndex}` };
      return value;
    };
    const { collector } = makeCollector(overrides);

    const stale = collector.snapshot("thr_root"); // starts collect 1 (RUNNING world)
    await new Promise((resolve) => setImmediate(resolve)); // let it reach the gate
    collector.invalidate(); // terminal signal: invalidate everything
    const fresh = collector.snapshot("thr_root"); // must NOT return the stale promise
    expect(fresh).not.toBe(stale);

    release();
    const [staleSnap, freshSnap] = await Promise.all([stale, fresh]);
    expect(staleSnap.root.title).toBe("Root v1");
    expect(freshSnap.root.title).toBe("Root v2");

    // The stale result must never poison the cache: within TTL the next
    // snapshot serves the post-invalidation world.
    const cached = await collector.snapshot("thr_root");
    expect(cached.root.title).toBe("Root v2");
  });

  it("still coalesces same-generation concurrent snapshots", async () => {
    let release!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const overrides = twoThreadOverrides();
    const threadsArea = overrides.threads as Record<string, unknown>;
    const baseGet = threadsArea.get as () => Promise<unknown>;
    threadsArea.get = async () => {
      await gate;
      return baseGet();
    };
    const { collector, harness } = makeCollector(overrides);

    const first = collector.snapshot("thr_root");
    const second = collector.snapshot("thr_root"); // no invalidation between them
    release(undefined);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b); // one collect served both callers
    expect(harness.callsTo("threads.get").length).toBe(1);
    expect(harness.callsTo("threads.list").length).toBe(2); // root + child, once each
  });

  it("does not serve a pre-invalidation in-flight global dashboard after invalidateGlobal()", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let globalListCall = 0;
    const overrides = twoThreadOverrides();
    const threadsArea = overrides.threads as Record<string, unknown>;
    threadsArea.list = async (args: { parentThreadId?: string }) => {
      if (args?.parentThreadId) return [];
      const callIndex = ++globalListCall;
      await gate; // gate every global list call
      return [
        thread(`thr_g${callIndex}`, {
          parentThreadId: null,
          status: "idle",
          title: null,
          titleFallback: `Global v${callIndex}`,
          updatedAt: 1_000,
        }),
      ];
    };
    const { collector } = makeCollector(overrides);

    const stale = collector.globalDashboard();
    await new Promise((resolve) => setImmediate(resolve));
    collector.invalidateGlobal();
    const fresh = collector.globalDashboard();
    expect(fresh).not.toBe(stale);

    release();
    const [staleDash, freshDash] = await Promise.all([stale, fresh]);
    expect(staleDash.recent[0]!.card.title).toBe("Global v1");
    expect(freshDash.recent[0]!.card.title).toBe("Global v2");

    const cached = await collector.globalDashboard();
    expect(cached.recent[0]!.card.title).toBe("Global v2");
  });

  it("invalidateGlobal() leaves the scoped snapshot cache warm", async () => {
    let globalListCalls = 0;
    const overrides = twoThreadOverrides();
    const threadsArea = overrides.threads as Record<string, unknown>;
    const baseList = threadsArea.list as (args: { parentThreadId?: string }) => Promise<unknown[]>;
    threadsArea.list = async (args: { parentThreadId?: string }) => {
      if (args?.parentThreadId) return baseList(args);
      globalListCalls += 1;
      return [
        thread("thr_g", {
          parentThreadId: null,
          status: "idle",
          title: null,
          titleFallback: `Global ${globalListCalls}`,
          updatedAt: 1_000,
        }),
      ];
    };
    const { collector } = makeCollector(overrides);

    await collector.snapshot("thr_root"); // warms the scoped cache
    await collector.globalDashboard(); // global collect 1 → "Global 1"
    collector.invalidateGlobal();

    const global = await collector.globalDashboard(); // cache cleared → refetch
    expect(global.recent[0]!.card.title).toBe("Global 2");

    // The scoped snapshot stayed warm through all of it (within TTL).
    const scopedAgain = await collector.snapshot("thr_root");
    expect(scopedAgain.root.title).toBe("Root work");
    expect(scopedAgain.cards.find((card) => card.threadId === "thr_child")).toBeDefined();
  });
});
