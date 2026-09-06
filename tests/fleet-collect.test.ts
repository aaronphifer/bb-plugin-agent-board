import { afterEach, describe, it, expect, vi } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { BOARD_CHANGED_CHANNEL } from "../contract/rpc";
import type {
  BoardSnapshot,
  GlobalDashboardSnapshot,
  ExecutionTimeline,
} from "../contract/rpc";
import { job, wire } from "./fleet-fixtures";
const hosts: ReturnType<typeof createFakePluginHost>[] = [];
afterEach(async () => {
  for (const h of hosts.splice(0)) await h.harness.lifecycle.dispose();
  vi.useRealTimers();
});
async function setup(fleet: () => unknown) {
  const rpc = vi.fn(async (args: { pluginId: string }) => {
    if (args.pluginId === "ollama-fleet") return fleet();
    throw Error("missing");
  });
  const root = makeThreadResponse({
    id: "parent",
    projectId: "p",
    status: "active",
    title: "Parent work",
    providerId: "pi",
  });
  const h = createFakePluginHost({
    pluginId: "agent-board",
    sdk: {
      subscribe: () => () => {},
      plugins: { callRpc: rpc },
      threads: {
        get: async () => root,
        list: async (args) => (args?.parentThreadId ? [] : [root]),
        defaultExecutionOptions: async () => ({ model: "parent-model" }),
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
        events: { list: async () => [] },
      },
      providers: { list: async () => [] },
    },
  });
  hosts.push(h);
  await plugin(h.bb);
  return { ...h, rpc };
}
describe("Fleet through Agent Board RPCs", () => {
  it.each(["missing", "disabled", "unknown_method", "malformed", "empty"])(
    "%s never breaks board/global/timeline",
    async (mode) => {
      const h = await setup(() => {
        if (mode === "empty") return wire();
        if (mode === "malformed") return {};
        throw Error(mode);
      });
      const board = (await h.harness.behavior.callRpc("board_snapshot", {
        threadId: "parent",
      })) as BoardSnapshot;
      const global = (await h.harness.behavior.callRpc(
        "global_dashboard",
        {},
      )) as GlobalDashboardSnapshot;
      const timeline = (await h.harness.behavior.callRpc("execution_timeline", {
        source: "bb",
        threadId: "parent",
        executionKey: "bb:parent",
      })) as ExecutionTimeline;
      expect(board.cards.some((c) => c.source === "bb")).toBe(true);
      expect(global.counts.active).toBe(1);
      expect(timeline.events).toEqual([]);
    },
  );
  it("scoped workers, global parent grouping, and parent timeline use shared Fleet read", async () => {
    const h = await setup(() =>
      wire([job(), job({ jobId: "j2", label: "Validation review B" })]),
    );
    const board = (await h.harness.behavior.callRpc("board_snapshot", {
      threadId: "parent",
    })) as BoardSnapshot;
    const global = (await h.harness.behavior.callRpc(
      "global_dashboard",
      {},
    )) as GlobalDashboardSnapshot;
    const timeline = (await h.harness.behavior.callRpc("execution_timeline", {
      source: "bb",
      threadId: "parent",
      executionKey: "bb:parent",
    })) as ExecutionTimeline;
    expect(board.cards.filter((c) => c.source === "ollama-fleet")).toHaveLength(
      2,
    );
    expect(global.counts.active).toBe(1);
    expect(global.active[0].activeDelegatedWorkerCount).toBe(2);
    expect(
      timeline.events.filter((e) => e.kind === "child-start"),
    ).toHaveLength(2);
    expect(
      h.rpc.mock.calls.filter((c) => c[0].pluginId === "ollama-fleet"),
    ).toHaveLength(1);
  });
  it.each(["completed", "failed", "cancelled"] as const)(
    "active loop observes %s, invalidates cached board and stops",
    async (state) => {
      vi.useFakeTimers();
      let current = job();
      const h = await setup(() => wire([current]));
      await h.harness.behavior.callRpc("board_snapshot", {
        threadId: "parent",
      });
      current = job({
        state,
        revision: 3,
        finishedAt: new Date().toISOString(),
      });
      await vi.advanceTimersByTimeAsync(2500);
      expect(h.harness.inspection.realtimeSignals).toContainEqual({
        channel: BOARD_CHANGED_CHANNEL, payload: { roots: [] },
      });
      const board = (await h.harness.behavior.callRpc("board_snapshot", {
        threadId: "parent",
      })) as BoardSnapshot;
      expect(board.cards.find((c) => c.jobId === "j1")?.status).toBe(
        state === "cancelled" ? "interrupted" : state,
      );
      const count = h.rpc.mock.calls.filter(
        (c) => c[0].pluginId === "ollama-fleet",
      ).length;
      await vi.advanceTimersByTimeAsync(10000);
      expect(
        h.rpc.mock.calls.filter((c) => c[0].pluginId === "ollama-fleet"),
      ).toHaveLength(count);
    },
  );
  it("orphan timeline target returns lifecycle without a BB parent", async () => {
    const h = await setup(() => wire([job({ origin: null })]));
    const t = (await h.harness.behavior.callRpc("execution_timeline", {
      source: "ollama-fleet",
      jobId: "j1",
      executionKey: "ollama-fleet:j1",
    })) as ExecutionTimeline;
    expect(t.source).toBe("ollama-fleet");
    expect(t.active).toBe(true);
    expect(t.events.every((e) => e.threadId === null)).toBe(true);
  });
});
