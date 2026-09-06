// @vitest-environment jsdom
// Frontend tests: render the threadPanelAction slot through the official
// plugin app testing harness — columns/cards, realtime signal refetch,
// reconnect reconcile, navigation, loading/error/empty states.
import { describe, expect, it, beforeEach } from "vitest";
import { loadPluginApp, renderSlot, type CapturedPluginApp, type RenderedSlot } from "@get-bb/plugin-sdk/testing/app";
import type { BoardCard, BoardSnapshot, ExecutionTimeline } from "@/contract/rpc";
import { BOARD_CHANGED_CHANNEL } from "@/contract/rpc";

let app: CapturedPluginApp;

beforeEach(async () => {
  app = await loadPluginApp(() => import("../app"));
});

function card(kind: BoardCard["kind"], title: string, overrides: Partial<BoardCard> = {}): BoardCard {
  const status = overrides.status ?? "completed";
  const column =
    overrides.column ?? (status === "running" ? "active" : status === "queued" ? "plan" : "output");
  return {
    key: `key-${title}`,
    parentKey: null,
    depth: 0,
    kind,
    source: "bb",
    title,
    subtitle: null,
    status,
    column,
    threadId: null,
    providerId: null,
    providerLabel: null,
    model: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    phaseTitle: null,
    promptPreview: null,
    activity: null,
    outputPreview: null,
    errorPreview: null,
    tokens: null,
    toolCalls: null,
    waitingOn: null,
    planStatus: null,
    isRoot: false,
    ...overrides,
  };
}

function snapshotFixture(overrides: Partial<BoardSnapshot> = {}): BoardSnapshot {
  return {
    root: {
      threadId: "thr_root",
      title: "Refactor the auth flow",
      status: "active",
      displayStatus: null,
      providerId: "pi",
      providerLabel: "Pi",
      model: "qwen3-coder:30b",
      projectId: null,
      createdAt: 0,
      updatedAt: 1000,
      goal: {
        objective: "Refactor the auth flow",
        status: "active",
        tokensUsed: 12000,
        tokenBudget: 40000,
        timeUsedSeconds: 300,
      },
      contextWindowUsedTokens: 5000,
      contextWindowTotalTokens: 128000,
    },
    counts: { running: 1, waiting: 1, queued: 1, completed: 1, failed: 0, interrupted: 0 },
    cards: [
      card("thread", "Refactor the auth flow", {
        key: "thread:thr_root",
        status: "running",
        column: "active",
        threadId: "thr_root",
        providerId: "pi",
        providerLabel: "Pi",
        model: "qwen3-coder:30b",
        activity: { text: "Editing src/auth.ts", at: 900, kind: "file-change" },
        isRoot: true,
      }),
      card("workflow-agent", "Auth review", {
        key: "agent:1",
        status: "running",
        column: "active",
        threadId: "thr_root",
        model: "qwen3-coder:30b",
        phaseTitle: "Reviewing tokens",
        activity: { text: "Reading auth.ts", at: 950, kind: "read_file" },
      }),
      card("plan-step", "Write migration", {
        key: "plan:1",
        status: "queued",
        column: "plan",
        threadId: "thr_root",
        planStatus: "pending",
        waitingOn: "Not started",
      }),
      card("queued-message", "Run the tests", {
        key: "queued:1",
        status: "queued",
        column: "plan",
        threadId: "thr_root",
        model: "qwen3-coder:30b",
        waitingOn: "Waiting for busy thread",
      }),
      card("delegation", "Fix the flaky test", {
        key: "delegation:1",
        status: "completed",
        column: "output",
        threadId: "thr_child",
        outputPreview: "All 12 tests pass.",
        durationMs: 5000,
      }),
    ],
    partial: false,
    fetchedAt: 1000,
    ...overrides,
  };
}

function timelineFixture(overrides: Partial<ExecutionTimeline> = {}): ExecutionTimeline {
  return {
    executionKey: "bb:thr_root", source: "bb", active: false, truncated: false, sourceWarning: null, fetchedAt: 1_000,
    events: [{ id: "event-1", executionKey: "bb:thr_root", source: "bb", timestamp: 1_000, kind: "tool-complete", status: "completed", title: "Read file completed", summary: null, model: null, toolName: "read_file", target: "package.json", phase: null, durationMs: 200, threadId: "thr_root", attentionType: null, sourceMetadata: { sourceId: "row-1", sequence: 1 } }],
    ...overrides,
  };
}

function mountBoard(
  options: Parameters<typeof renderSlot>[2] = {},
): RenderedSlot {
  const registration = app.threadPanelActions[0]!;
  return renderSlot(
    { component: registration.component },
    { threadId: "thr_root", params: null } as never,
    options,
  );
}

function kanbanSnapshot(cards: BoardCard[]): BoardSnapshot {
  const base = snapshotFixture();
  return {
    ...base,
    root: {
      ...base.root,
      status: "idle",
      goal: null,
      contextWindowUsedTokens: null,
      contextWindowTotalTokens: null,
    },
    counts: {
      running: cards.filter((item) => item.status === "running" || item.status === "starting").length,
      waiting: cards.filter((item) => item.status === "waiting").length,
      queued: cards.filter((item) => item.status === "queued").length,
      completed: cards.filter((item) => item.status === "completed").length,
      failed: cards.filter((item) => item.status === "failed").length,
      interrupted: cards.filter((item) => item.status === "interrupted").length,
    },
    cards,
    activityFeeds: [],
  };
}

describe("slot registration", () => {
  it("registers exactly one thread panel action", () => {
    expect(app.threadPanelActions).toHaveLength(1);
    expect(app.threadPanelActions[0]!.id).toBe("agent-board");
    expect(app.threadPanelActions[0]!.title).toBe("Agent Board");
    expect(app.threadPanelActions[0]!.icon).toBe("ListTodo");
  });
});

describe("board rendering", () => {
  it("renders the root header, columns, and cards from the snapshot", async () => {
    const slot = mountBoard({
      rpc: { board_snapshot: () => snapshotFixture() },
      realtimeConnectionState: "connected",
    });

    expect(await slot.findAllByText("PLAN / QUEUED")).toBeTruthy();
    expect(slot.getByText("ACTIVE AGENTS")).toBeTruthy();
    expect(slot.getByText("OUTPUTS / DONE")).toBeTruthy();

    expect(await slot.findAllByText("Refactor the auth flow")).toBeTruthy();
    expect(slot.getByText("Auth review")).toBeTruthy();
    expect(slot.getByText("Write migration")).toBeTruthy();
    expect(slot.getByText("Fix the flaky test")).toBeTruthy();
    expect(slot.getAllByText("qwen3-coder:30b").length).toBeGreaterThan(0);

    // Live indicator reflects the connection state.
    expect(slot.getByTitle("Realtime: connected").textContent).toContain("Live");

    slot.unmount();
  });

  it("renders per-column placement and status labels", async () => {
    const slot = mountBoard({
      rpc: { board_snapshot: () => snapshotFixture() },
    });
    await slot.findAllByText("Refactor the auth flow");

    const planColumn = slot.getByRole("region", { name: "PLAN / QUEUED" });
    expect(planColumn.textContent).toContain("Write migration");
    expect(planColumn.textContent).toContain("Run the tests");

    const activeColumn = slot.getByRole("region", { name: "ACTIVE AGENTS" });
    expect(activeColumn.textContent).toContain("Auth review");
    expect(activeColumn.textContent).toContain("Editing src/auth.ts");

    const outputColumn = slot.getByRole("region", { name: "OUTPUTS / DONE" });
    expect(outputColumn.textContent).toContain("Fix the flaky test");
    expect(outputColumn.textContent).toContain("All 12 tests pass.");

    slot.unmount();
  });

  it("shows the goal budget and context window", async () => {
    const slot = mountBoard({
      rpc: { board_snapshot: () => snapshotFixture() },
    });
    await slot.findAllByText("Refactor the auth flow");
    // Goal line carries the usage share of the 40k budget.
    expect(slot.getByText(/Goal:/)).toBeTruthy();
    expect(slot.getByText(/30% budget/)).toBeTruthy();
    // Context window bar shows the used share of 128k.
    expect(slot.getByText(/ctx 4%/)).toBeTruthy();
    slot.unmount();
  });

  it("flags a truncated tree", async () => {
    const slot = mountBoard({
      rpc: { board_snapshot: () => snapshotFixture({ partial: true }) },
    });
    expect(await slot.findByText(/truncated/i)).toBeTruthy();
    slot.unmount();
  });
});

describe("realtime invalidation", () => {
  it("refetches when a signal names this board", async () => {
    const slot = mountBoard({
      rpc: { board_snapshot: () => snapshotFixture() },
    });
    await slot.findAllByText("Refactor the auth flow");
    expect(slot.inspection.rpcCalls.length).toBe(1);

    await slot.behavior.emitRealtime(BOARD_CHANGED_CHANNEL, { roots: ["thr_root"] });
    await slot.findAllByText("Refactor the auth flow");
    expect(slot.inspection.rpcCalls.length).toBe(2);

    slot.unmount();
  });

  it("ignores signals scoped to other roots", async () => {
    const slot = mountBoard({
      rpc: { board_snapshot: () => snapshotFixture() },
    });
    await slot.findAllByText("Refactor the auth flow");

    await slot.behavior.emitRealtime(BOARD_CHANGED_CHANNEL, { roots: ["thr_other"] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(slot.inspection.rpcCalls.length).toBe(1);

    slot.unmount();
  });

  it("ignores global-only invalidations", async () => {
    const slot = mountBoard({ rpc: { board_snapshot: () => snapshotFixture() } });
    await slot.findAllByText("Refactor the auth flow");
    await slot.behavior.emitRealtime(BOARD_CHANGED_CHANNEL, { roots: [], global: true });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(slot.inspection.rpcCalls.length).toBe(1);
    slot.unmount();
  });

  it("refetches defensively on a malformed signal", async () => {
    const slot = mountBoard({
      rpc: { board_snapshot: () => snapshotFixture() },
    });
    await slot.findAllByText("Refactor the auth flow");

    await slot.behavior.emitRealtime(BOARD_CHANGED_CHANNEL, { nonsense: true });
    expect(slot.inspection.rpcCalls.length).toBe(2);

    slot.unmount();
  });

  it("reconciles after a realtime reconnect", async () => {
    const slot = mountBoard({
      rpc: { board_snapshot: () => snapshotFixture() },
      realtimeConnectionState: "connected",
    });
    await slot.findAllByText("Refactor the auth flow");
    expect(slot.inspection.rpcCalls.length).toBe(1);

    await slot.behavior.setRealtimeConnectionState("reconnecting");
    await slot.behavior.setRealtimeConnectionState("connected");
    expect(slot.inspection.rpcCalls.length).toBe(2);

    slot.unmount();
  });
});

describe("states", () => {
  it("shows a loading state before the first snapshot", async () => {
    let release!: (value: BoardSnapshot) => void;
    const gate = new Promise<BoardSnapshot>((resolve) => {
      release = resolve;
    });
    const slot = mountBoard({
      rpc: { board_snapshot: () => gate },
    });
    expect(slot.getByText("Loading the board…")).toBeTruthy();

    release(snapshotFixture());
    await slot.findAllByText("Refactor the auth flow");
    slot.unmount();
  });

  it("shows an error state and keeps a retry path", async () => {
    const slot = mountBoard({
      rpc: {
        board_snapshot: () => {
          throw new Error("thread not visible");
        },
      },
    });
    expect(await slot.findByText(/thread not visible/)).toBeTruthy();
    slot.unmount();
  });

  it("shows an empty state for a snapshot with no cards", async () => {
    const slot = mountBoard({
      rpc: {
        board_snapshot: () =>
          snapshotFixture({
            cards: [],
            counts: { running: 0, waiting: 0, queued: 0, completed: 0, failed: 0, interrupted: 0 },
          }),
      },
    });
    expect(await slot.findByText("Nothing to observe yet.")).toBeTruthy();
    slot.unmount();
  });
});

describe("navigation", () => {
  it("opens a card's thread in the main panel", async () => {
    const slot = mountBoard({
      rpc: { board_snapshot: () => snapshotFixture() },
    });
    await slot.findAllByText("Fix the flaky test");

    const openButtons = slot.getAllByLabelText("Open this thread in the main panel");
    openButtons.at(-1)!.click();
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "thr_child",
    });

    slot.unmount();
  });
});

describe("Kanban live execution treatment", () => {
  it("gives one truthful active Kanban card a LIVE cue and indeterminate strip", async () => {
    const active = card("plan-step", "Implement adapter", {
      key: "active-a",
      status: "running",
      column: "plan",
      activity: { text: "Reading src/auth.ts", at: 950, kind: "read_file" },
      toolCalls: 18,
      planStatus: "in_progress",
    });
    const slot = mountBoard({ rpc: { board_snapshot: () => kanbanSnapshot([active]) } });

    const board = await slot.findByTestId("kanban-board");
    const activeCard = board.querySelector('[data-card-status="running"]')!;
    expect(activeCard.getAttribute("data-live-state")).toBe("executing");
    expect(activeCard.querySelector('[data-testid="kanban-live-indicator"]')?.textContent).toBe("Live");
    expect(activeCard.querySelector('[data-testid="kanban-live-strip"]')).toBeTruthy();
    expect(activeCard.textContent).toContain("Reading src/auth.ts");
    expect(activeCard.textContent).toContain("18 tools");
    expect(board.textContent).not.toContain("%");

    slot.unmount();
  });

  it("treats every independent running or starting card as live with stable stagger variants", async () => {
    const cards = [
      card("thread", "Auth review", {
        key: "active-a",
        status: "running",
        column: "active",
        threadId: "thr_a",
      }),
      card("thread", "API review", {
        key: "active-b",
        status: "starting",
        column: "active",
        threadId: "thr_b",
      }),
    ];
    const slot = mountBoard({ rpc: { board_snapshot: () => kanbanSnapshot(cards) } });

    const board = await slot.findByTestId("kanban-board");
    const strips = slot.getAllByTestId("kanban-live-strip");
    expect(slot.getAllByTestId("kanban-live-indicator")).toHaveLength(2);
    expect(strips).toHaveLength(2);
    expect(new Set(strips.map((strip) => strip.getAttribute("data-motion-variant"))).size).toBe(2);
    expect(board.querySelectorAll('[data-live-state="executing"]')).toHaveLength(2);

    slot.unmount();
  });

  it.each([
    ["completed", "completed", "output"],
    ["failed", "failed", "output"],
    ["interrupted", "interrupted", "output"],
    ["queued/pending", "queued", "plan"],
  ] as const)("keeps a %s card static", async (_label, status, column) => {
    const item = card("plan-step", `A ${status} card`, {
      key: `static-${status}`,
      status,
      column,
      planStatus: status === "queued" ? "pending" : null,
    });
    const slot = mountBoard({ rpc: { board_snapshot: () => kanbanSnapshot([item]) } });

    const board = await slot.findByTestId("kanban-board");
    expect(board.querySelector('[data-card-status]')?.getAttribute("data-live-state")).toBe("static");
    expect(slot.queryByTestId("kanban-live-indicator")).toBeNull();
    expect(slot.queryByTestId("kanban-live-strip")).toBeNull();

    slot.unmount();
  });

  it("keeps waiting work visibly waiting without pretending it is progressing", async () => {
    const waiting = card("plan-step", "Approval gate", {
      key: "waiting",
      status: "waiting",
      column: "active",
      waitingOn: "Waiting for approval",
    });
    const slot = mountBoard({ rpc: { board_snapshot: () => kanbanSnapshot([waiting]) } });

    const board = await slot.findByTestId("kanban-board");
    expect(board.textContent).toContain("Waiting for approval");
    expect(board.querySelector('[data-card-status="waiting"]')?.getAttribute("data-live-state")).toBe("static");
    expect(slot.queryByTestId("kanban-live-strip")).toBeNull();

    slot.unmount();
  });

  it("preserves Open and opens Timeline lazily without rendering an unknown reasoning field", async () => {
    const active = card("plan-step", "Inspect package", {
      key: "active-actions",
      status: "running",
      column: "plan",
      threadId: "thr_actions",
      activity: { text: "Reading package.json", at: 950, kind: "read_file" },
      planStatus: "in_progress",
    }) as BoardCard & { reasoning: string };
    active.reasoning = "SECRET HIDDEN REASONING";
    const slot = mountBoard({
      rpc: {
        board_snapshot: () => kanbanSnapshot([active]),
        execution_timeline: () => timelineFixture({ executionKey: "active-actions" }),
      },
    });
    await slot.findByTestId("kanban-live-strip");

    slot.getByRole("button", { name: "Open this thread in the main panel" }).click();
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_actions" });
    expect(slot.inspection.rpcCalls.filter((call) => call.method === "execution_timeline")).toHaveLength(0);
    slot.getByRole("button", { name: "Open timeline for Inspect package" }).click();
    expect(await slot.findByText("Read file completed")).toBeTruthy();
    expect(slot.getByText(/read_file · package.json/)).toBeTruthy();
    expect(slot.inspection.rpcCalls.filter((call) => call.method === "execution_timeline")).toHaveLength(1);
    expect(slot.queryByText("SECRET HIDDEN REASONING")).toBeNull();

    slot.unmount();
  });
});
// ---------------------------------------------------------------------------
// Single-agent focus mode (one logical active execution replaces the Kanban).
// ---------------------------------------------------------------------------

function scanPhase(
  phaseId: string,
  title: string,
  scanId: string,
  sequence: number,
  overrides: Partial<BoardCard> = {},
): BoardCard {
  return card("phase", title, {
    key: `redteam:${scanId}:${phaseId}`,
    status: "queued",
    column: "plan",
    scanId,
    groupKey: `redteam:${scanId}`,
    sequence,
    phaseId,
    waitingOn: "Not started",
    source: "redteam",
    ...overrides,
  });
}

function scanFocusSnapshot(overrides: Partial<BoardSnapshot> = {}): BoardSnapshot {
  return snapshotFixture({
    counts: { running: 1, waiting: 0, queued: 4, completed: 1, failed: 0, interrupted: 0 },
    cards: [
      scanPhase("reconnaissance", "Reconnaissance", "scan-1", 0, {
        status: "completed",
        column: "output",
        outputPreview: "3 entry points; 1 web app",
        durationMs: 3000,
      }),
      scanPhase("code-review", "Code review", "scan-1", 1, {
        status: "running",
        column: "active",
        activity: { text: "Reading src/dispatcher.js", at: 950, kind: "read_file" },
        model: "qwen3:8b",
        tokens: 1234,
        toolCalls: 3,
        startedAt: Date.now() - 60_000,
      }),
      scanPhase("web-testing", "Web testing", "scan-1", 2),
      scanPhase("verification", "Verification", "scan-1", 3),
      scanPhase("reporting", "Reporting", "scan-1", 4),
    ],
    activityFeeds: [
      {
        key: "redteam:scan-1",
        entries: [
          { id: "op-1", label: "read_file", detail: "src/dispatcher.js", at: Date.now() - 3000, kind: "tool" },
          { id: "op-2", label: "grep", detail: "src/*.ts", at: Date.now() - 8000, kind: "tool" },
        ],
      },
    ],
    ...overrides,
  });
}

function twoScanSnapshot(): BoardSnapshot {
  const solo = scanFocusSnapshot();
  return solo; // placeholder replaced below
}

function bbFocusSnapshot(): BoardSnapshot {
  return snapshotFixture({
    counts: { running: 1, waiting: 0, queued: 2, completed: 0, failed: 0, interrupted: 0 },
    cards: [
      card("thread", "Refactor the auth flow", {
        key: "thread:thr_root",
        status: "running",
        column: "active",
        threadId: "thr_root",
        isRoot: true,
        startedAt: Date.now() - 120_000,
        activity: { text: "Editing src/auth.ts", at: 900, kind: "file-change" },
      }),
      card("plan-step", "Write migration", {
        key: "plan:1",
        status: "queued",
        column: "plan",
        threadId: "thr_root",
        parentKey: "thread:thr_root",
        groupKey: "plan:thr_root",
        sequence: 0,
        planStatus: "pending",
        waitingOn: "Not started",
      }),
      card("plan-step", "Update docs", {
        key: "plan:2",
        status: "queued",
        column: "plan",
        threadId: "thr_root",
        parentKey: "thread:thr_root",
        groupKey: "plan:thr_root",
        sequence: 1,
        planStatus: "pending",
        waitingOn: "Not started",
      }),
    ],
  });
}

describe("single-agent focus mode", () => {
  it("replaces the Kanban with hero, pipeline, recent, completed, and up-next", async () => {
    const slot = mountBoard({ rpc: { board_snapshot: () => scanFocusSnapshot() } });
    const focus = await slot.findByTestId("single-agent-focus");

    // Focus body, not columns.
    expect(slot.queryByText("ACTIVE AGENTS")).toBeNull();
    expect(focus.getAttribute("data-motion")).toBe("full");

    const hero = slot.getByTestId("focus-hero");
    expect(hero.textContent).toContain("ACTIVE PHASE");
    expect(hero.textContent).toContain("Code review");

    // Pipeline renders the truthful discrete steps.
    const pipeline = slot.getByTestId("pipeline-track");
    expect(pipeline.textContent).toContain("Reconnaissance");
    expect(pipeline.textContent).toContain("Reporting");

    // Bounded recent activity from the scan feed.
    const recent = slot.getByTestId("focus-recent");
    expect(recent.textContent).toContain("read_file");
    expect(recent.textContent).toContain("src/dispatcher.js");
    expect(recent.textContent).toContain("ago");

    // Completed work with its real summary; up next with the queue.
    const completed = slot.getByTestId("focus-completed");
    expect(completed.textContent).toContain("Reconnaissance");
    expect(completed.textContent).toContain("3 entry points; 1 web app");
    expect(slot.getByTestId("focus-up-next").textContent).toContain("Web testing");

    // No fabricated percentages anywhere in the focus body.
    expect(focus.textContent).not.toContain("%");

    slot.unmount();
  });

  it("opens the shared Timeline component for a scoped Redteam execution", async () => {
    const rpcTimeline = async () => timelineFixture({ executionKey: "redteam:scan-1", source: "redteam", events: [{ ...timelineFixture().events[0]!, executionKey: "redteam:scan-1", source: "redteam", kind: "phase-complete", title: "Code review completed", phase: "Code review" }] });
    const slot = mountBoard({ rpc: { board_snapshot: () => scanFocusSnapshot(), execution_timeline: rpcTimeline } });
    const trigger = await slot.findByRole("button", { name: "Open timeline for Code review" });
    trigger.click();
    expect(await slot.findByText("Code review completed")).toBeTruthy();
    expect(slot.inspection.rpcCalls.filter((call) => call.method === "execution_timeline")).toHaveLength(1);
    slot.unmount();
  });

  it("shows only truthful hero stats and the latest observed operation", async () => {
    const slot = mountBoard({ rpc: { board_snapshot: () => scanFocusSnapshot() } });
    await slot.findByTestId("focus-hero");

    const stats = slot.getByTestId("hero-stats");
    expect(stats.textContent).toContain("Elapsed");
    expect(stats.textContent).toContain("qwen3:8b");
    expect(stats.textContent).toContain("1,234 tok");
    expect(stats.textContent).toContain("Tool calls");

    const latest = slot.getByTestId("hero-latest-operation");
    expect(latest.textContent).toContain("read_file");
    expect(latest.textContent).toContain("src/dispatcher.js");

    slot.unmount();
  });

  it("crossfades the activity line without re-animating the hero", async () => {
    let calls = 0;
    const first = scanFocusSnapshot();
    const second = scanFocusSnapshot();
    const review = second.cards.find((card) => card.key === "redteam:scan-1:code-review")!;
    review.activity = { text: "Writing report.md", at: 960, kind: "file-change" };
    const slot = mountBoard({
      rpc: { board_snapshot: () => (++calls === 1 ? first : second) },
    });
    await slot.findByTestId("focus-hero");
    const hero = slot.getByTestId("focus-hero");

    await slot.behavior.emitRealtime(BOARD_CHANGED_CHANNEL, { roots: ["thr_root"] });

    // The outgoing and incoming lines coexist only during the one-shot swap.
    const activity = slot.getByTestId("hero-activity");
    expect(activity.textContent).toContain("Reading src/dispatcher.js");
    expect(activity.textContent).toContain("Writing report.md");
    // The hero itself never remounts for a text change.
    expect(hero.textContent).toContain("Code review");

    slot.unmount();
  });

  it("returns to the Kanban when a second execution appears", async () => {
    let calls = 0;
    const two = scanFocusSnapshot();
    two.cards = [
      ...two.cards,
      scanPhase("code-review", "Code review", "scan-2", 1, {
        status: "running",
        column: "active",
        activity: { text: "Auditing build scripts", at: 940, kind: "read_file" },
      }),
    ];
    const slot = mountBoard({
      rpc: { board_snapshot: () => (++calls === 1 ? scanFocusSnapshot() : two) },
    });
    await slot.findByTestId("single-agent-focus");

    await slot.behavior.emitRealtime(BOARD_CHANGED_CHANNEL, { roots: ["thr_root"] });

    expect(await slot.findByText("ACTIVE AGENTS")).toBeTruthy();
    expect(slot.queryByTestId("single-agent-focus")).toBeNull();
    expect(slot.getAllByTestId("kanban-live-indicator")).toHaveLength(2);
    expect(slot.getAllByTestId("kanban-live-strip")).toHaveLength(2);

    slot.unmount();
  });

  it("returns to focus when the second execution ends", async () => {
    let calls = 0;
    const two = scanFocusSnapshot();
    two.cards = [
      ...two.cards,
      scanPhase("code-review", "Code review", "scan-2", 1, {
        status: "running",
        column: "active",
      }),
    ];
    const slot = mountBoard({
      rpc: { board_snapshot: () => (++calls === 1 ? two : scanFocusSnapshot()) },
    });
    await slot.findByText("ACTIVE AGENTS");
    expect(slot.getAllByTestId("kanban-live-strip")).toHaveLength(2);

    await slot.behavior.emitRealtime(BOARD_CHANGED_CHANNEL, { roots: ["thr_root"] });

    const focus = await slot.findByTestId("single-agent-focus");
    expect(slot.queryByText("ACTIVE AGENTS")).toBeNull();
    expect(focus.querySelector(".ab-live-dot")).toBeTruthy();
    expect(focus.querySelector(".ab-strip")).toBeTruthy();

    slot.unmount();
  });

  it("keeps a waiting hero state visible instead of hiding it", async () => {
    const waiting = scanFocusSnapshot();
    const review = waiting.cards.find((card) => card.key === "redteam:scan-1:code-review")!;
    review.status = "waiting";
    review.activity = null;
    review.waitingOn = "Waiting for model slot";
    const slot = mountBoard({ rpc: { board_snapshot: () => waiting } });

    const hero = await slot.findByTestId("focus-hero");
    expect(hero.textContent).toContain("Waiting for model slot");
    expect(hero.textContent).toContain("Waiting");
    // No indeterminate strip when nothing is executing.
    expect(hero.querySelector(".ab-strip")).toBeNull();

    slot.unmount();
  });

  it("omits empty sections and fabricates no pipeline for a single step", async () => {
    const solo = scanFocusSnapshot({
      cards: [
        scanPhase("code-review", "Code review", "scan-1", 1, {
          status: "running",
          column: "active",
          activity: { text: "Reading src/dispatcher.js", at: 950, kind: "read_file" },
          startedAt: Date.now() - 10_000,
        }),
      ],
      activityFeeds: [],
    });
    const slot = mountBoard({ rpc: { board_snapshot: () => solo } });

    await slot.findByTestId("single-agent-focus");
    expect(slot.queryByTestId("pipeline-track")).toBeNull();
    expect(slot.queryByTestId("focus-recent")).toBeNull();
    expect(slot.queryByTestId("focus-completed")).toBeNull();
    expect(slot.queryByTestId("focus-up-next")).toBeNull();
    expect(slot.queryByTestId("focus-other")).toBeNull();

    slot.unmount();
  });

  it("keeps an unrelated failure visible in Other with its attention flag", async () => {
    const withFailure = scanFocusSnapshot();
    withFailure.cards = [
      ...withFailure.cards,
      scanPhase("code-review", "Code review", "scan-2", 1, {
        status: "failed",
        column: "output",
        errorPreview: "Scan aborted: timeout",
      }),
    ];
    const slot = mountBoard({ rpc: { board_snapshot: () => withFailure } });

    const other = await slot.findByTestId("focus-other");
    // Attention cards render without any toggle click.
    expect(other.textContent).toContain("Scan aborted: timeout");
    expect(other.textContent).toContain("1 need attention");

    slot.unmount();
  });

  it("opens the hero thread and lazily fetches the shared timeline", async () => {
    const slot = mountBoard({
      rpc: {
        board_snapshot: () => bbFocusSnapshot(),
        execution_timeline: () => timelineFixture(),
      },
    });
    await slot.findByTestId("focus-hero");

    expect(slot.getByTestId("focus-hero").textContent).toContain("CURRENT EXECUTION");
    // The hero's pipeline is the real plan.
    expect(slot.getByTestId("pipeline-track").textContent).toContain("Write migration");

    slot.getByRole("button", { name: "Open this thread in the main panel" }).click();
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "thr_root",
    });

    // Timeline is fetched lazily on first open.
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "execution_timeline"),
    ).toHaveLength(0);
    slot.getByRole("button", { name: "Open timeline for Refactor the auth flow" }).click();
    expect(await slot.findByText("Read file completed")).toBeTruthy();
    expect(
      slot.inspection.rpcCalls.filter((call) => call.method === "execution_timeline"),
    ).toHaveLength(1);

    slot.unmount();
  });

});

// Keep the two-scan helper referenced for future Kanban fixtures.
void twoScanSnapshot;

describe("latestPublicUpdate scoping", () => {
  it("never renders the global excerpt inside the scoped thread panel", async () => {
    const base = snapshotFixture();
    const withExcerpt = {
      ...base,
      cards: base.cards.map((item) => ({
        ...item,
        latestPublicUpdate: "Scoped boards render per-thread state, not the global excerpt.",
      })),
    };
    const slot = mountBoard({ rpc: { board_snapshot: () => withExcerpt } });
    await slot.findAllByText("Refactor the auth flow");
    // The field may travel on the card schema, but the scoped panel never
    // renders it: no excerpt element anywhere in the board.
    expect(slot.container.querySelectorAll('[data-part="public-update"]')).toHaveLength(0);
    expect(slot.container.textContent).not.toContain("Scoped boards render per-thread state");
    slot.unmount();
  });
});
