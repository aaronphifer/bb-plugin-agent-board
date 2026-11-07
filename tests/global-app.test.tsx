// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { loadPluginApp, renderSlot, type CapturedPluginApp, type RenderedSlot } from "@get-bb/plugin-sdk/testing/app";
import type { AttentionItem, BoardCard, ExecutionTimeline, GlobalDashboardSnapshot, GlobalExecution, TimelineEvent } from "@/contract/rpc";
import { BOARD_CHANGED_CHANNEL } from "@/contract/rpc";
const LONG_TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const LONG_MODEL = "provider/some-extremely-long-model-name-with-many-segments:latest";
const LONG_PATH = "/home/user/projects/some-extremely-long-directory-name/src/components/another-extremely-long-directory/ExecutionCard.tsx";
const LONG_URL = "https://example.com/a/very/long/path/that/does/not/naturally/wrap";
const LONG_COMMAND = `sed -n '1,200p' ${LONG_PATH} && grep --some-long-expression '${LONG_TOKEN}' ${LONG_PATH}`;
const LONG_ERROR = `Provider error — 400: {"message":"${LONG_TOKEN}","documentation":"${LONG_URL}"}`;

let app: CapturedPluginApp;

beforeEach(async () => { app = await loadPluginApp(() => import("../app")); });
afterEach(() => {
  vi.useRealTimers();
  delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia;
});

function boardCard(overrides: Partial<BoardCard> = {}): BoardCard {
  const status = overrides.status ?? "running";
  return {
    key: "global-card", parentKey: null, depth: 0, kind: "thread", source: "bb",
    title: "Auth refactor", subtitle: "BB", status,
    column: status === "running" ? "active" : status === "queued" || status === "waiting" ? "plan" : "output",
    threadId: "thr_auth", providerId: "pi", providerLabel: "Pi", model: "qwen3:8b",
    startedAt: Date.now() - 5_000, completedAt: null, durationMs: null, phaseTitle: "Code review",
    promptPreview: null, activity: { text: "Reading auth.ts", at: Date.now() - 1_000, kind: "file-read" },
    outputPreview: null, errorPreview: null, tokens: null, toolCalls: 12, waitingOn: null,
    attention: null, planStatus: null, isRoot: false, parentThreadId: null, ...overrides,
  };
}

function execution(key: string, overrides: Partial<GlobalExecution> = {}): GlobalExecution {
  return { key, card: boardCard({ key: `card:${key}` }), projectId: "proj", childCount: 2, activeChildCount: 1, updatedAt: Date.now(), ...overrides };
}

function attention(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return { id: "attention:auth:action", executionKey: "bb:auth", type: "action-required", status: "open", title: "Auth refactor", message: "Approval required", firstObservedAt: Date.now() - 10_000, updatedAt: Date.now(), threadId: "thr_auth", source: "bb", ...overrides };
}

function snapshot(overrides: Partial<GlobalDashboardSnapshot> = {}): GlobalDashboardSnapshot {
  return {
    active: [execution("bb:auth")], attention: [], recent: [],
    counts: { active: 1, waiting: 0, attention: 0, recent: 0, failures: 0 },
    unavailableSources: [], partial: false, dismissedCount: 0, fetchedAt: Date.now(), ...overrides,
  };
}

function timelineEvent(id: string, timestamp: number, overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return { id, executionKey: "bb:auth", source: "bb", timestamp, kind: "execution-start", status: "running", title: "Execution started", summary: null, model: null, toolName: null, target: null, phase: null, durationMs: null, threadId: "thr_auth", attentionType: null, sourceMetadata: { sourceId: id, sequence: timestamp }, ...overrides };
}

function executionTimeline(overrides: Partial<ExecutionTimeline> = {}): ExecutionTimeline {
  return { executionKey: "bb:auth", source: "bb", events: [timelineEvent("start", 100)], active: false, truncated: false, sourceWarning: null, fetchedAt: 500, ...overrides };
}

function mountGlobal(options: Parameters<typeof renderSlot>[2] = {}): RenderedSlot {
  const registration = app.navPanels[0]!;
  return renderSlot({ component: registration.component }, { subPath: "" } as never, { ...options, rpc: { release_announcement: () => ({ version: "0.7.0-dev.1", title: "Updates", highlights: [], dismissed: true }), ...options.rpc } });
}

describe("global page registration", () => {
  it("registers the stable nav panel while retaining the thread action", () => {
    expect(app.navPanels).toHaveLength(1);
    expect(app.navPanels[0]).toMatchObject({ id: "agent-board-global", title: "Agent Board", icon: "ListTodo", path: "operations" });
    expect(app.tabs.filter((tab) => tab.id === "agent-board")).toHaveLength(1);
  });
});

describe("global operations rendering", () => {
  it("keeps the box-sizing invariant local instead of hiding page overflow", () => {
    const css = readFileSync("app.css", "utf8");
    expect(css).toMatch(/\.ab-global-dashboard[\s\S]*box-sizing:\s*border-box/);
    expect(css).not.toMatch(/(?:html|body|\.ab-global-dashboard)\s*\{[^}]*overflow-x:\s*hidden/);
  });

  it("renders zero active work without losing the attention-first hierarchy", async () => {
    const slot = mountGlobal({ rpc: { global_dashboard: () => snapshot({ active: [], counts: { active: 0, waiting: 0, attention: 0, recent: 0, failures: 0 } }) } });
    expect(await slot.findByText("Nothing currently requires your attention.")).toBeTruthy();
    expect(slot.getByText("No active executions.")).toBeTruthy();
    expect(slot.getByText("No recent completions in the bounded window.")).toBeTruthy();
    slot.unmount();
  });

  it("renders multiple BB and Redteam executions with truthful live treatment", async () => {
    const redteam = execution("redteam:scan", { card: boardCard({ key: "red", source: "redteam", kind: "phase", title: "Redteam — Tiny lab", threadId: null, providerId: null, providerLabel: null, model: "qwen3:8b" }) });
    const slot = mountGlobal({ rpc: { global_dashboard: () => snapshot({ active: [execution("bb:auth"), redteam], counts: { active: 2, waiting: 0, attention: 0, recent: 0, failures: 0 } }) } });
    expect(await slot.findByText("Auth refactor")).toBeTruthy();
    expect(slot.getByText("Redteam — Tiny lab")).toBeTruthy();
    expect(slot.getAllByTestId("kanban-live-indicator")).toHaveLength(2);
    expect(slot.getAllByTestId("kanban-live-strip")).toHaveLength(2);
    expect(slot.container.textContent).not.toContain("%");
    slot.unmount();
  });

  it("shows attention prominently and navigates with the public thread API", async () => {
    const item = attention();
    const slot = mountGlobal({ rpc: { global_dashboard: () => snapshot({ attention: [item], counts: { active: 1, waiting: 0, attention: 1, recent: 0, failures: 0 } }) } });
    expect(await slot.findByText("Approval required")).toBeTruthy();
    slot.getAllByLabelText("Open Auth refactor")[0]!.click();
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_auth" });
    slot.unmount();
  });

  it("renders failed recent work statically with bounded output", async () => {
    const failed = execution("bb:failed", { card: boardCard({ key: "failed", title: "Deploy test", status: "failed", completedAt: Date.now() - 500, durationMs: 2_000, errorPreview: "Provisioning failed", activity: null }) });
    const slot = mountGlobal({ rpc: { global_dashboard: () => snapshot({ active: [], recent: [failed], counts: { active: 0, waiting: 0, attention: 0, recent: 1, failures: 0 } }) } });
    expect(await slot.findByText("Deploy test")).toBeTruthy();
    expect(slot.getByText("Provisioning failed")).toBeTruthy();
    expect(slot.queryByTestId("kanban-live-strip")).toBeNull();
    slot.unmount();
  });

  it("shows partial source failure without breaking available cards", async () => {
    const slot = mountGlobal({ rpc: { global_dashboard: () => snapshot({ unavailableSources: ["redteam"], partial: true }) } });
    expect(await slot.findByText("Auth refactor")).toBeTruthy();
    expect(slot.getByText(/Optional sources unavailable: Redteam/)).toBeTruthy();
    expect(slot.getByText(/global view is bounded/i)).toBeTruthy();
    slot.unmount();
  });

  it("keeps reasoning and prompts out of global rendering", async () => {
    const poisoned = execution("bb:poison", { card: boardCard({ promptPreview: "SECRET REASONING", outputPreview: null }) });
    const slot = mountGlobal({ rpc: { global_dashboard: () => snapshot({ active: [poisoned] }) } });
    await slot.findByText("Auth refactor");
    expect(slot.container.textContent).not.toContain("SECRET REASONING");
    slot.unmount();
  });

  it("retains static LIVE semantics under reduced motion", async () => {
    window.matchMedia = ((query: string) => ({ matches: query === "(prefers-reduced-motion: reduce)", media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
    const slot = mountGlobal({ rpc: { global_dashboard: () => snapshot() } });
    const strip = await slot.findByTestId("kanban-live-strip");
    expect(slot.container.querySelector("main")?.getAttribute("data-motion")).toBe("reduced");
    expect(strip.className).toContain("ab-strip-static");
    expect(slot.getByTestId("kanban-live-indicator").textContent).toContain("Live");
    slot.unmount();
  });

  it("keeps every global section shrinkable with pathological bounded content", async () => {
    const longTitle = `Continue ${LONG_TOKEN} ${LONG_URL}`;
    const active = execution("bb:pathological-active", {
      card: boardCard({
        key: "pathological-active",
        title: longTitle,
        providerLabel: `Provider-${LONG_TOKEN}`,
        model: LONG_MODEL,
        latestPublicUpdate: `The first handoff is bounded but contains ${LONG_TOKEN} and ${LONG_URL}; it must remain a two-to-three-line excerpt without widening the card.`,
        activity: { text: LONG_COMMAND, at: Date.now(), kind: "command" },
      }),
    });
    const restoredAttention = attention({
      id: "attention:restored:failed",
      executionKey: "bb:restored",
      type: "failed",
      title: longTitle,
      message: LONG_ERROR,
      updatedAt: Date.now() + 1,
    });
    const recent = execution("bb:pathological-recent", {
      card: boardCard({
        key: "pathological-recent",
        title: longTitle,
        status: "completed",
        completedAt: Date.now(),
        durationMs: 12_345,
        model: LONG_MODEL,
        activity: null,
        outputPreview: `Completed ${LONG_PATH} ${LONG_URL} ${LONG_TOKEN}`,
      }),
    });
    const slot = mountGlobal({
      rpc: {
        global_dashboard: () => snapshot({
          active: [active],
          attention: [restoredAttention],
          recent: [recent],
          dismissedCount: 1,
          counts: { active: 1, waiting: 0, attention: 1, recent: 1, failures: 1 },
        }),
      },
    });
    await slot.findByText(LONG_ERROR);

    const dashboard = slot.container.querySelector<HTMLElement>("[data-global-dashboard]");
    expect(dashboard).toBeTruthy();
    expect(dashboard?.className).toContain("ab-global-dashboard");
    expect(dashboard?.className).toContain("min-w-0");
    expect(dashboard?.className).toContain("max-w-full");
    expect(dashboard?.className).not.toContain("overflow-x-hidden");
    expect(document.body.className).not.toContain("overflow-x-hidden");

    const grids = Array.from(slot.container.querySelectorAll<HTMLElement>("[data-global-grid]"));
    expect(grids).toHaveLength(3);
    for (const grid of grids) {
      expect(grid.className).toContain("min-w-0");
      expect(grid.className).toContain("max-w-full");
      expect(grid.className).toContain("minmax(0,1fr)");
    }
    const cards = Array.from(slot.container.querySelectorAll<HTMLElement>("[data-global-card]"));
    expect(cards.map((card) => card.dataset.globalCard).sort()).toEqual(["active", "attention", "recent"]);
    for (const card of cards) {
      expect(card.className).toContain("min-w-0");
      expect(card.className).toContain("max-w-full");
    }

    for (const selector of ["[data-part='execution-model']", "[data-part='public-update']", "[data-part='execution-activity']", "[data-part='attention-title']", "[data-part='attention-message']", "[data-part='recent-metadata']", "[data-part='recent-summary']"]) {
      expect(slot.container.querySelector<HTMLElement>(selector)?.className).toContain("[overflow-wrap:anywhere]");
    }
    expect(slot.container.querySelector<HTMLElement>("[data-part='public-update']")?.className).toContain("line-clamp-3");
    expect(slot.container.querySelector<HTMLElement>("[data-part='execution-activity']")?.className).toContain("line-clamp-2");
    expect(slot.container.querySelector<HTMLElement>("[data-part='attention-message']")?.className).toContain("line-clamp-3");
    expect(slot.container.querySelector<HTMLElement>("[data-part='recent-summary']")?.className).toContain("line-clamp-2");

    expect(slot.getByTestId("kanban-live-indicator").textContent).toContain("Live");
    expect(slot.getByText("Failed")).toBeTruthy();
    expect(slot.getAllByRole("button", { name: `Open ${longTitle}` })).toHaveLength(3);
    expect(slot.getByRole("button", { name: `Dismiss ${longTitle}` })).toBeTruthy();
    expect(slot.getByRole("button", { name: /Clear dismissed \(1\)/ })).toBeTruthy();
    expect(slot.getAllByRole("button", { name: `Open timeline for ${longTitle}` })).toHaveLength(2);
    slot.unmount();
  });

  it("keeps the desktop two-column active grid while using zero-minimum tracks", async () => {
    const slot = mountGlobal({ rpc: { global_dashboard: () => snapshot({ active: [execution("one"), execution("two")] }) } });
    await slot.findAllByText("Auth refactor");
    const activeGrid = slot.container.querySelector<HTMLElement>("[data-global-grid='active']");
    expect(activeGrid?.className).toContain("grid-cols-[minmax(0,1fr)]");
    expect(activeGrid?.className).toContain("md:grid-cols-[repeat(2,minmax(0,1fr))]");
    slot.unmount();
  });
});

describe("global refresh behavior", () => {
  it("refetches on a global invalidation but ignores a scoped-only one", async () => {
    const slot = mountGlobal({ rpc: { global_dashboard: () => snapshot() } });
    await slot.findByText("Auth refactor");
    const reads = () => slot.inspection.rpcCalls.filter(call => call.method === "global_dashboard");
    expect(reads()).toHaveLength(1);
    await slot.behavior.experimental_invalidateRpc(["board:thr_other"]);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(reads()).toHaveLength(1);
    await slot.behavior.experimental_invalidateRpc(["global-dashboard"]);
    await waitFor(() => expect(reads()).toHaveLength(2));
    slot.unmount();
  });

  it("does not poll from the client; discovery refreshes come from the backend", async () => {
    vi.useFakeTimers();
    const slot = mountGlobal({ rpc: { global_dashboard: () => snapshot() } });
    await vi.runOnlyPendingTimersAsync();
    const reads = () => slot.inspection.rpcCalls.filter(call => call.method === "global_dashboard").length;
    const initial = reads();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reads()).toBe(initial);
    slot.unmount();
  });

  it("records a change signal without refetching on it", async () => {
    const slot = mountGlobal({ rpc: { global_dashboard: () => snapshot() } });
    await slot.findByText("Auth refactor");
    expect(slot.getByLabelText("Monitoring health").textContent).toContain("No change signal received");
    await slot.behavior.emitRealtime(BOARD_CHANGED_CHANNEL, { roots: [], global: true });
    expect(slot.getByLabelText("Monitoring health").textContent).toContain("Last change signal");
    expect(slot.inspection.rpcCalls.filter(call => call.method === "global_dashboard")).toHaveLength(1);
    slot.unmount();
  });
});

describe("terminal-state self-correction in the hook", () => {
  it("ends a mid-flight invalidation with a read that started after it (no dropped terminal signals)", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slot = mountGlobal({
      rpc: {
        global_dashboard: async () => {
          calls += 1;
          const call = calls;
          if (call === 1) await gate; // first fetch is slow
          return snapshot({ active: [execution("bb:auth", { card: boardCard({ key: "card:bb:auth", title: `Read ${call}` }) })] });
        },
      },
    });
    expect(calls).toBe(1);
    // The host's invalidation waits for the refetch it starts, so release the
    // slow first read before awaiting it.
    const invalidation = slot.behavior.experimental_invalidateRpc(["global-dashboard"]);
    release();
    await invalidation;
    expect(calls).toBe(2);
    expect(await slot.findAllByText("Read 2")).not.toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(2); // no retry loop
    slot.unmount();
  });
  it("collapses a burst of active invalidations into one trailing request and stops refreshing after completion", async () => {
    let calls = 0;
    let release!: (value: ExecutionTimeline) => void;
    const gate = new Promise<ExecutionTimeline>((resolve) => { release = resolve; });
    const rpcTimeline = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return gate;
      return executionTimeline({ active: false, events: [timelineEvent("done", 200, { kind: "execution-complete", status: "completed", title: "Execution finished" })] });
    });
    const slot = mountGlobal({ rpc: { global_dashboard: () => snapshot(), execution_timeline: rpcTimeline } });
    (await slot.findByRole("button", { name: "Open timeline for Auth refactor" })).click();
    await slot.findByText("Loading timeline…");
    await slot.behavior.emitRealtime(BOARD_CHANGED_CHANNEL, { roots: [], global: true });
    await slot.behavior.emitRealtime(BOARD_CHANGED_CHANNEL, { roots: ["thr_auth"] });
    await slot.behavior.emitRealtime(BOARD_CHANGED_CHANNEL, { roots: [], global: true });
    expect(calls).toBe(1);
    release(executionTimeline({ active: true }));
    expect(await slot.findByText("Execution finished")).toBeTruthy();
    expect(calls).toBe(2);
    await slot.behavior.emitRealtime(BOARD_CHANGED_CHANNEL, { roots: [], global: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toBe(2);
    slot.unmount();
  });

  it("uses the mobile drawer DOM and static reduced-motion cues", async () => {
    window.matchMedia = ((query: string) => ({ matches: query === "(max-width: 767px)" || query === "(prefers-reduced-motion: reduce)", media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
    const slot = mountGlobal({ rpc: { global_dashboard: () => snapshot(), execution_timeline: () => executionTimeline({ active: true, events: [timelineEvent("long", 100, { kind: "tool-complete", title: LONG_TOKEN, toolName: "command", target: LONG_COMMAND, model: LONG_MODEL, summary: `${LONG_ERROR} ${LONG_URL}` })] }) } });
    (await slot.findByRole("button", { name: "Open timeline for Auth refactor" })).click();
    const dialog = await slot.findByTestId("execution-timeline-dialog");
    expect(dialog.getAttribute("data-motion")).toBe("reduced");
    expect(dialog.className).toContain("max-w-none");
    expect(dialog.className).toContain("min-w-0");
    expect(dialog.querySelector<HTMLElement>("[data-part='timeline-detail']")?.className).toContain("[overflow-wrap:anywhere]");
    expect(dialog.querySelector<HTMLElement>("[data-part='timeline-summary']")?.className).toContain("[overflow-wrap:anywhere]");
    expect(dialog.querySelector(".ab-row-in")).toBeNull();
    expect(dialog.querySelector(".ab-live-dot")).toBeNull();
    expect(dialog.querySelector("table")).toBeNull();
    slot.unmount();
  });
});

describe("attention dismissal UI", () => {
  it("dismisses one item: calls the RPC with the condition key, then refetches", async () => {
    const item = attention();
    const dismiss = vi.fn(async () => ({ dismissed: 1 }));
    const snapshots = [snapshot({ attention: [item], counts: { active: 1, waiting: 0, attention: 1, recent: 0, failures: 0 } }), snapshot()];
    let fetch = 0;
    const slot = mountGlobal({
      rpc: {
        global_dashboard: async () => snapshots[Math.min(fetch++, snapshots.length - 1)]!,
        dismiss_attention: dismiss,
      },
    });
    await slot.findByText("Approval required");

    slot.getAllByLabelText("Dismiss Auth refactor")[0]!.click();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(dismiss).toHaveBeenCalledWith({
      executionKey: item.executionKey,
      type: item.type,
      updatedAt: item.updatedAt,
    });
    // The backend invalidates the global page's tag after a dismissal.
    await slot.behavior.experimental_invalidateRpc(["global-dashboard"]);
    await waitFor(() => expect(slot.inspection.rpcCalls.filter((call) => call.method === "global_dashboard")).toHaveLength(2));
    slot.unmount();
  });

  it("offers Clear dismissed once dismissals exist and clears them", async () => {
    const clear = vi.fn(async () => ({ dismissed: 0 }));
    const dashboards = [
      snapshot({ dismissedCount: 3, attention: [], counts: { active: 1, waiting: 0, attention: 0, recent: 0, failures: 0 } }),
      snapshot(),
    ];
    let fetch = 0;
    const slot = mountGlobal({
      rpc: {
        global_dashboard: async () => dashboards[Math.min(fetch++, dashboards.length - 1)]!,
        clear_dismissed_attentions: clear,
      },
    });
    const clearButton = await slot.findByRole("button", { name: /Clear dismissed/ });
    expect(clearButton.textContent).toContain("3");
    expect(slot.container.textContent).toContain("dismissed conditions stay hidden");

    clearButton.click();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(clear).toHaveBeenCalledWith({});
    await slot.behavior.experimental_invalidateRpc(["global-dashboard"]);
    await waitFor(() => expect(slot.container.textContent).not.toContain("Clear dismissed"));
    slot.unmount();
  });

  it("keeps the plain empty state when nothing was dismissed", async () => {
    const slot = mountGlobal({ rpc: { global_dashboard: () => snapshot({ attention: [], counts: { active: 1, waiting: 0, attention: 0, recent: 0, failures: 0 } }) } });
    expect(await slot.findByText("Nothing currently requires your attention.")).toBeTruthy();
    expect(slot.container.textContent).not.toContain("dismissed conditions stay hidden");
    expect(slot.queryByRole("button", { name: /Clear dismissed/ })).toBeNull();
    slot.unmount();
  });
});
