// Server tests through the official fake plugin host: RPC registration with
// schema validation, watcher wiring (subscribe + lifecycle events), realtime
// publish, CLI rendering, and dispose semantics.
import { describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
  type FakePluginHost,
  type FakeSdkOverrides,
} from "@get-bb/plugin-sdk/testing";
import plugin from "@/server";
import { BOARD_CHANGED_CHANNEL } from "@/contract/rpc";
import type { BbPluginApi } from "@get-bb/plugin-sdk";

/** The subscribe args the fake host hands our stub (realtime types are not
 * exported individually; derive them structurally from the public sdk). */
type SubscribeArgs = Parameters<BbPluginApi["sdk"]["subscribe"]>[0];
type ThreadGetArgsLike = Parameters<BbPluginApi["sdk"]["threads"]["get"]>[0];

type ChangedHandler = (event: {
  entity: "thread";
  type: "changed";
  id?: string;
  changes?: readonly string[];
  metadata?: Record<string, unknown>;
}) => void | Promise<void>;

interface Harness {
  bb: Awaited<ReturnType<typeof plugin>> extends never ? never : Parameters<typeof plugin>[0];
  host: FakePluginHost;
  changed: (event: Parameters<ChangedHandler>[0]) => void;
}

async function makeHost(overrides: FakeSdkOverrides = {}) {
  let changedHandler: ChangedHandler | null = null;
  const defaults: FakeSdkOverrides = {
    subscribe: (args: SubscribeArgs) => {
      if (args.event === "thread:changed") {
        changedHandler = args.callback as unknown as ChangedHandler;
      }
      return () => {};
    },
    threads: {
      get: async (args: ThreadGetArgsLike) => {
        const threadId = args.threadId;
        return makeThreadResponse({
          id: threadId,
          title: "Root work",
          providerId: "pi",
          status: threadId === "thr_child" ? "idle" : "active",
          parentThreadId: threadId === "thr_child" ? "thr_root" : null,
        });
      },
      list: async () => [],
      timeline: async () => ({
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
      }),
      defaultExecutionOptions: async () => ({ model: "qwen3-coder:30b" }),
      output: async () => ({ output: "done" }),
      events: {
        list: async () => [],
      },
      queuedMessages: {
        list: async () => [],
      },
    },
    providers: {
      list: async () => [{ id: "pi", displayName: "Pi" }],
    },
  };
  const host = createFakePluginHost({
    pluginId: "agent-board",
    sdk: { ...defaults, ...overrides },
  });
  await plugin(host.bb);
  return {
    bb: host.bb,
    host,
    changed: (event: Parameters<ChangedHandler>[0]) => {
      if (changedHandler) void changedHandler(event);
    },
  } as Harness;
}

const settle = (ms = 550) => new Promise((resolve) => setTimeout(resolve, ms));

describe("rpc registration", () => {
  it("serves a schema-validated board_snapshot", async () => {
    const { host } = await makeHost();
    const result = (await host.harness.behavior.callRpc("board_snapshot", {
      threadId: "thr_root",
    })) as {
      root: { threadId: string; model: string | null; providerLabel: string | null };
      counts: Record<string, number>;
      cards: Array<{ kind: string; isRoot: boolean }>;
      partial: boolean;
      fetchedAt: number;
    };

    expect(result.root.threadId).toBe("thr_root");
    expect(result.root.model).toBe("qwen3-coder:30b");
    expect(result.root.providerLabel).toBe("Pi");
    expect(result.cards.some((card) => card.kind === "thread" && card.isRoot)).toBe(true);
    expect(typeof result.fetchedAt).toBe("number");
    expect(result.partial).toBe(false);

    // The method was registered under the contract name.
    expect(host.harness.inspection.registrations.rpcMethods).toContain("board_snapshot");
    expect(host.harness.inspection.registrations.rpcMethods).toContain("board_activity");
    expect(host.harness.inspection.registrations.rpcMethods).toContain("execution_timeline");
    expect(host.harness.inspection.registrations.rpcMethods).toContain("global_dashboard");
  });

  it("serves the bounded lazy execution timeline contract", async () => {
    const { host } = await makeHost();
    const result = (await host.harness.behavior.callRpc("execution_timeline", {
      source: "bb",
      executionKey: "bb:thr_root",
      threadId: "thr_root",
    })) as { source: string; events: unknown[]; active: boolean; truncated: boolean };
    expect(result).toMatchObject({ source: "bb", active: false, truncated: false });
    expect(result.events).toEqual([]);
    await expect(host.harness.behavior.callRpc("execution_timeline", { source: "bb" })).rejects.toThrow();
  });

  it("serves the global dashboard even when optional Redteam is unavailable", async () => {
    const { host } = await makeHost();
    const result = (await host.harness.behavior.callRpc("global_dashboard", {})) as {
      active: unknown[]; recent: unknown[]; attention: unknown[]; counts: { active: number };
      unavailableSources: string[];
    };
    expect(result.active).toEqual([]);
    expect(result.recent).toEqual([]);
    expect(result.attention).toEqual([]);
    expect(result.counts.active).toBe(0);
    expect(result.unavailableSources).toContain("redteam");
  });

  it("rejects invalid input with the host's structured failure", async () => {
    const { host } = await makeHost();
    await expect(host.harness.behavior.callRpc("board_snapshot", {})).rejects.toThrow();
    await expect(
      host.harness.behavior.callRpc("board_activity", { threadId: 123 }),
    ).rejects.toThrow();
  });

  it("serves a bounded, reasoning-free board_activity tail", async () => {
    const overrides: FakeSdkOverrides = {};
    const { host } = await makeHost(overrides);
    const result = (await host.harness.behavior.callRpc("board_activity", {
      threadId: "thr_root",
    })) as { entries: Array<{ text: string }> };
    expect(Array.isArray(result.entries)).toBe(true);
    expect(result.entries.length).toBeLessThanOrEqual(40);
  });
});

describe("watcher wiring", () => {
  it("publishes an invalidation signal when an observed thread changes", async () => {
    const { host, changed } = await makeHost();
    await host.harness.behavior.callRpc("board_snapshot", { threadId: "thr_root" });
    expect(host.harness.inspection.realtimeSignals).toEqual([]);

    changed({
      entity: "thread",
      type: "changed",
      id: "thr_root",
      changes: ["status-changed"],
    });
    await settle();

    const signals = host.harness.inspection.realtimeSignals;
    expect(signals).toHaveLength(1);
    expect(signals[0]!.channel).toBe(BOARD_CHANGED_CHANNEL);
    expect(signals[0]!.payload).toEqual({ roots: ["thr_root"] });
  });

  it("coalesces chatty changes into one signal per debounce window", async () => {
    const { host, changed } = await makeHost();
    await host.harness.behavior.callRpc("board_snapshot", { threadId: "thr_root" });

    changed({
      entity: "thread",
      type: "changed",
      id: "thr_root",
      changes: ["status-changed"],
    });
    changed({
      entity: "thread",
      type: "changed",
      id: "thr_root",
      changes: ["events-appended"],
    });
    await settle();

    expect(host.harness.inspection.realtimeSignals).toHaveLength(1);
  });

  it("stays quiet for cosmetic and reasoning-only changes", async () => {
    const { host, changed } = await makeHost();
    await host.harness.behavior.callRpc("board_snapshot", { threadId: "thr_root" });

    changed({
      entity: "thread",
      type: "changed",
      id: "thr_root",
      changes: ["read-state-changed"],
    });
    changed({
      entity: "thread",
      type: "changed",
      id: "thr_root",
      changes: ["events-appended"],
      metadata: { eventTypes: ["item/reasoning/textDelta", "thread/tokenUsage/updated"] },
    });
    await settle();

    expect(host.harness.inspection.realtimeSignals).toEqual([]);
  });

  it("reacts to lifecycle events for observed threads", async () => {
    const { host } = await makeHost();
    await host.harness.behavior.callRpc("board_snapshot", { threadId: "thr_root" });

    await host.harness.behavior.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "thr_root", status: "idle" }),
      lastAssistantText: "done",
    });
    await settle();

    const signals = host.harness.inspection.realtimeSignals;
    expect(signals).toHaveLength(1);
    expect(signals[0]!.channel).toBe(BOARD_CHANGED_CHANNEL);
  });

  it("publishes a global invalidation after the global page is observed", async () => {
    const { host, changed } = await makeHost();
    await host.harness.behavior.callRpc("global_dashboard", {});
    changed({ entity: "thread", type: "changed", id: "thr_unrelated", changes: ["status-changed"] });
    await settle();
    expect(host.harness.inspection.realtimeSignals).toContainEqual({
      channel: BOARD_CHANGED_CHANNEL,
      payload: { roots: [], global: true },
    });
  });
});

describe("cli", () => {
  it("renders the board as text by default", async () => {
    const { host } = await makeHost();
    const result = await host.harness.behavior.runCli(["show", "thr_root"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Board: Root work");
    expect(result.stdout).toContain("[T] / Root work / running / Pi · qwen3-coder:30b");
    expect(result.stderr).toBe("");
  });

  it("emits schema-shaped JSON with --json", async () => {
    const { host } = await makeHost();
    const result = await host.harness.behavior.runCli(["show", "thr_root", "--json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      root: { threadId: string };
      cards: unknown[];
      counts: unknown;
    };
    expect(parsed.root.threadId).toBe("thr_root");
    expect(Array.isArray(parsed.cards)).toBe(true);
    expect(parsed.counts).toHaveProperty("running");
  });

  it("validates usage", async () => {
    const { host } = await makeHost();
    const noArgs = await host.harness.behavior.runCli([]);
    expect(noArgs.exitCode).toBe(0);
    expect(noArgs.stdout).toContain("Usage");

    const missing = await host.harness.behavior.runCli(["show"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("Usage");

    const unknown = await host.harness.behavior.runCli(["nonsense"]);
    expect(unknown.exitCode).toBe(1);
  });
});

describe("dispose", () => {
  it("stops the watcher and unsubscribes on plugin dispose", async () => {
    const { host, changed } = await makeHost();
    await host.harness.behavior.callRpc("board_snapshot", { threadId: "thr_root" });

    await host.harness.lifecycle.dispose();
    changed({
      entity: "thread",
      type: "changed",
      id: "thr_root",
      changes: ["status-changed"],
    });
    await settle();
    expect(host.harness.inspection.realtimeSignals).toEqual([]);
  });
});

describe("attention dismissal RPCs", () => {
  function failingThreadOverrides(): FakeSdkOverrides {
    const updatedAt = Date.now();
    return {
      threads: {
        get: async (args: ThreadGetArgsLike) =>
          makeThreadResponse({ id: args.threadId, status: "active", providerId: "pi" }),
        list: async (args: { parentThreadId?: string }) =>
          args?.parentThreadId
            ? []
            : [
                makeThreadResponse({
                  id: "thr_fail",
                  status: "error",
                  title: "Deploy",
                  providerId: "pi",
                  createdAt: updatedAt - 1_000,
                  updatedAt,
                }),
              ],
        timeline: async () => ({
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
        }),
        defaultExecutionOptions: async () => null,
        output: async () => ({ output: "done" }),
        events: {
          list: async () => [],
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

  interface DashLike {
    attention: Array<{ executionKey: string; type: string; updatedAt: number }>;
    recent: Array<{ key: string }>;
    counts: { attention: number };
    dismissedCount: number;
  }

  it("hides a dismissed condition presentation-only and persists across plugin reload", async () => {
    const { host } = await makeHost(failingThreadOverrides());

    const first = (await host.harness.behavior.callRpc("global_dashboard", {})) as DashLike;
    expect(first.attention).toHaveLength(1);
    const item = first.attention[0]!;
    expect(item.executionKey).toBe("bb:thr_fail");
    expect(item.type).toBe("failed");
    expect(first.counts.attention).toBe(1);
    expect(first.dismissedCount).toBe(0);
    expect(first.recent.some((entry) => entry.key === "bb:thr_fail")).toBe(true);

    const dismissed = (await host.harness.behavior.callRpc("dismiss_attention", {
      executionKey: item.executionKey,
      type: item.type,
      updatedAt: item.updatedAt,
    })) as { dismissed: number };
    expect(dismissed.dismissed).toBe(1);

    const second = (await host.harness.behavior.callRpc("global_dashboard", {
      fresh: true,
    })) as DashLike;
    expect(second.attention).toEqual([]); // hidden from Needs attention
    expect(second.counts.attention).toBe(0); // hidden from the badge count
    expect(second.dismissedCount).toBe(1);
    expect(second.recent.some((entry) => entry.key === "bb:thr_fail")).toBe(true); // recent untouched

    // Reload the plugin (same persisted kv): the dismissal survives.
    const reloaded = await host.harness.lifecycle.reload(plugin);
    const third = (await reloaded.harness.behavior.callRpc("global_dashboard", {
      fresh: true,
    })) as DashLike;
    expect(third.attention).toEqual([]);
    expect(third.dismissedCount).toBe(1);

    // A re-derived unchanged condition stays dismissed with the same key:
    // dismissing again is idempotent and does not double-store.
    const again = (await reloaded.harness.behavior.callRpc("dismiss_attention", {
      executionKey: item.executionKey,
      type: item.type,
      updatedAt: item.updatedAt,
    })) as { dismissed: number };
    expect(again.dismissed).toBe(1);

    // Clear restores everything.
    await reloaded.harness.behavior.callRpc("clear_dismissed_attentions", {});
    const fourth = (await reloaded.harness.behavior.callRpc("global_dashboard", {
      fresh: true,
    })) as DashLike;
    expect(fourth.attention).toHaveLength(1);
    expect(fourth.dismissedCount).toBe(0);
    expect(fourth.counts.attention).toBe(1);
  });

  it("registers and validates the dismissal RPC surface", async () => {
    const { host } = await makeHost();
    expect(host.harness.inspection.registrations.rpcMethods).toContain("dismiss_attention");
    expect(host.harness.inspection.registrations.rpcMethods).toContain(
      "clear_dismissed_attentions",
    );
    await expect(
      host.harness.behavior.callRpc("dismiss_attention", { executionKey: "", type: "failed", updatedAt: 0 }),
    ).rejects.toThrow();
    await expect(
      host.harness.behavior.callRpc("dismiss_attention", { type: "failed", updatedAt: 0 }),
    ).rejects.toThrow();
    await expect(
      host.harness.behavior.callRpc("dismiss_attention", { executionKey: "bb:x", type: "nope", updatedAt: 0 }),
    ).rejects.toThrow();
    await expect(
      host.harness.behavior.callRpc("dismiss_attention", { executionKey: "bb:x", type: "failed", updatedAt: -1 }),
    ).rejects.toThrow();
  });
});
