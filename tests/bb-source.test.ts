// Normalizer tests for the "bb" source: pure functions over DTO fixtures.
import { describe, expect, it } from "vitest";
import {
  activityFromEvents,
  latestActivity,
  latestPublicUpdate,
  normalizeThread,
  recentActivityFeed,
  threadBoardStatus,
  waitingOnLabel,
  workKindLabel,
  type NormalizeContext,
  type QueuedMessageRow,
  type ThreadEventRow,
  type ThreadFacts,
  type ThreadRowLike,
  type TimelineResponse,
  type TimelineTurnRow,
  type TimelineWorkRow,
} from "@/lib/bb-source";

let seq = 0;
const ctx: NormalizeContext = {
  providerLabel: (id) => (id === "pi" ? "Pi" : null),
};

function threadRow(overrides: Partial<ThreadRowLike> = {}): ThreadRowLike {
  return {
    id: "thr_root",
    parentThreadId: null,
    providerId: "pi",
    title: "Root thread",
    titleFallback: null,
    status: "active",
    createdAt: 0,
    updatedAt: 1_000,
    ...overrides,
  };
}

function timeline(overrides: Partial<TimelineResponse> = {}): TimelineResponse {
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
  } as TimelineResponse;
}

function workRow(workKind: string, fields: Record<string, unknown>): TimelineWorkRow {
  seq += 1;
  return {
    id: `row-${seq}`,
    kind: "work",
    workKind,
    callId: "call-1",
    threadId: "thr_root",
    turnId: "turn-1",
    createdAt: 1_000,
    startedAt: 1_100,
    status: "completed",
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    ...fields,
  } as unknown as TimelineWorkRow;
}

function turnRow(fields: Record<string, unknown>): TimelineTurnRow {
  seq += 1;
  return {
    id: `turn-${seq}`,
    kind: "turn",
    threadId: "thr_root",
    turnId: "turn-1",
    status: "completed",
    startedAt: 900,
    completedAt: 2_000,
    children: [],
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    ...fields,
  } as unknown as TimelineTurnRow;
}

function facts(overrides: Partial<ThreadFacts> = {}): ThreadFacts {
  return {
    row: threadRow(),
    timeline: timeline(),
    isRoot: true,
    depth: 0,
    childThreadIds: [],
    ...overrides,
  };
}

function eventRow(type: string, data: unknown, at = 1_500): ThreadEventRow {
  return { id: `e-${seq++}`, scope: "thread", threadId: "thr_root", seq, createdAt: at, type, data } as unknown as ThreadEventRow;
}

function queuedMessage(fields: Record<string, unknown>): QueuedMessageRow {
  return {
    id: `q-${seq++}`,
    threadId: "thr_root",
    createdAt: 1_000,
    editable: true,
    groupWithNext: false,
    model: "qwen3-coder:30b",
    permissionMode: "auto",
    reasoningLevel: "none",
    serviceTier: "default",
    updatedAt: 1_000,
    content: [{ type: "text", text: "Run the tests" }],
    sendAt: 0,
    waitingOn: null,
    ...fields,
  } as unknown as QueuedMessageRow;
}

describe("thread card normalization", () => {
  it("renders the root thread as an active card with its latest activity", () => {
    const rows = [
      workRow("command", { command: "npm test", status: "pending" }),
      workRow("tool", { toolName: "read_file", status: "pending" }),
    ];
    const cards = normalizeThread(facts({ timeline: timeline({ rows }) }), ctx, null);
    const root = cards.find((card) => card.isRoot && card.kind === "thread");
    expect(root).toBeDefined();
    expect(root!.status).toBe("running");
    expect(root!.column).toBe("active");
    expect(root!.subtitle).toBe("parent thread");
    expect(root!.activity?.text).toBe("read_file");
    expect(root!.providerLabel).toBe("Pi");
    expect(root!.model).toBeNull(); // no defaultExecutionOptions in facts
  });

  it("uses turn timing for started/duration when present", () => {
    const rows = [turnRow({ children: [workRow("command", { command: "ls" })] })];
    const cards = normalizeThread(facts({ timeline: timeline({ rows }) }), ctx, null);
    const root = cards.find((card) => card.isRoot && card.kind === "thread")!;
    expect(root.startedAt).toBe(900);
    expect(root.durationMs).toBe(1_100);
    expect(root.completedAt).toBe(2_000);
  });

  it("enriches a child card with its delegation label and output", () => {
    const child = facts({
      row: threadRow({
        id: "thr_child",
        parentThreadId: "thr_root",
        title: null,
        titleFallback: null,
        status: "idle",
      }),
      isRoot: false,
      depth: 1,
      output: undefined,
      timeline: timeline(),
    });
    const cards = normalizeThread(
      child,
      ctx,
      { label: "Fix the failing tests", output: "All 12 tests pass." },
    );
    const card = cards.find((c) => c.kind === "thread")!;
    expect(card.title).toBe("Fix the failing tests");
    expect(card.subtitle).toBe("Fix the failing tests");
    expect(card.outputPreview).toBe("All 12 tests pass.");
    expect(card.status).toBe("completed");
    expect(card.column).toBe("output");
  });
});

describe("status normalization", () => {
  it("maps thread statuses onto board statuses", () => {
    expect(threadBoardStatus(threadRow({ status: "active" }), [])).toBe("running");
    expect(threadBoardStatus(threadRow({ status: "starting" }), [])).toBe("starting");
    expect(threadBoardStatus(threadRow({ status: "pending" }), [])).toBe("queued");
    expect(threadBoardStatus(threadRow({ status: "stopping" }), [])).toBe("interrupted");
    expect(threadBoardStatus(threadRow({ status: "error" }), [])).toBe("failed");
    expect(threadBoardStatus(threadRow({ status: "idle" }), [])).toBe("completed");
  });

  it("treats queued messages on an idle thread as queued work", () => {
    const row = threadRow({ status: "idle", queuedMessageCount: 2 });
    expect(threadBoardStatus(row, [])).toBe("queued");
  });

  it("detects waiting states from displayStatus and interactions", () => {
    expect(
      threadBoardStatus(threadRow({ runtime: { displayStatus: "waiting-for-host" } }), []),
    ).toBe("waiting");
    expect(
      threadBoardStatus(threadRow({ hasPendingInteraction: true }), []),
    ).toBe("waiting");
  });

  it("detects work rows blocked on approval or a question", () => {
    const approval = [
      workRow("command", { command: "rm -rf build", approvalStatus: "waiting_for_approval" }),
    ];
    expect(threadBoardStatus(threadRow(), approval)).toBe("waiting");

    const question = [
      workRow("question", { lifecycle: "pending", questions: [{ prompt: "Which db?" }] }),
    ];
    expect(threadBoardStatus(threadRow({ hasPendingInteraction: false }), question)).toBe("waiting");
  });

  it("attaches explicit action-required metadata for approvals and questions", () => {
    const approvalRows = [workRow("command", { command: "deploy", approvalStatus: "waiting_for_approval" })];
    const approval = normalizeThread(facts({ timeline: timeline({ rows: approvalRows as never }) }), ctx, null)[0]!;
    expect(approval.attention).toEqual({ type: "action-required", message: "Approval required" });
    expect(approval.waitingOn).toBe("Approval required");

    const questionRows = [workRow("question", { lifecycle: "pending", questions: [{ prompt: "Which db?" }] })];
    const question = normalizeThread(facts({ timeline: timeline({ rows: questionRows as never }) }), ctx, null)[0]!;
    expect(question.attention).toEqual({ type: "action-required", message: "Input required" });
    expect(question.waitingOn).toBe("Input required");
  });

  it("uses static waiting attention for host states without claiming execution progress", () => {
    const root = normalizeThread(facts({ row: threadRow({ runtime: { displayStatus: "waiting-for-host" } }) }), ctx, null)[0]!;
    expect(root.status).toBe("waiting");
    expect(root.attention).toEqual({ type: "waiting", message: "Waiting for host" });
  });

  it("humanizes waitingOn reasons", () => {
    expect(waitingOnLabel({ kind: "time" })).toBe("Waiting for scheduled time");
    expect(waitingOnLabel({ kind: "thread-busy" })).toBe("Waiting for busy thread");
    expect(waitingOnLabel({ kind: "plugin", pluginId: "redteam", reason: "running check" })).toBe(
      "Waiting for plugin redteam",
    );
    expect(waitingOnLabel(null)).toBe("Queued");
  });
});

describe("workflow agent normalization", () => {
  function workflowRow(agents: Array<Record<string, unknown>>, fields: Record<string, unknown> = {}) {
    return {
      id: "wf-1",
      itemId: "item-1",
      kind: "work",
      workKind: "workflow",
      createdAt: 1_000,
      startedAt: 1_000,
      status: "pending",
      taskStatus: "running",
      description: "Parallel code review",
      model: "fallback-model",
      workflow: { agents },
      ...fields,
    };
  }

  it("creates one card per agent with model, phase, and live activity", () => {
    const agents = [
      {
        attempt: 0,
        cached: false,
        index: 0,
        label: "Auth review",
        lastProgressAt: 1_400,
        model: "qwen3-coder:30b",
        state: "running",
        agentType: "reviewer",
        lastToolName: "read_file",
        lastToolSummary: "Reading orchestrator.ts",
        phaseTitle: "Reviewing auth flow",
        promptPreview: "Review the auth flow in src/auth",
        startedAt: 1_200,
        toolCalls: 3,
        tokens: 1_234,
      },
      {
        attempt: 0,
        cached: false,
        index: 1,
        label: "DB review",
        lastProgressAt: 1_300,
        model: "qwen3-coder:30b",
        state: "queued",
        queuedAt: 1_100,
      },
    ];
    const cards = normalizeThread(
      facts({ timeline: timeline({ activeWorkflows: [workflowRow(agents) as never] }) }),
      ctx,
      null,
    );
    const agentCards = cards.filter((card) => card.kind === "workflow-agent");
    expect(agentCards).toHaveLength(2);

    const running = agentCards.find((card) => card.status === "running")!;
    expect(running.title).toBe("Auth review");
    expect(running.model).toBe("qwen3-coder:30b");
    expect(running.phaseTitle).toBe("Reviewing auth flow");
    expect(running.activity?.text).toBe("Reading orchestrator.ts");
    expect(running.column).toBe("active");
    expect(running.startedAt).toBe(1_200);

    const queued = agentCards.find((card) => card.status === "queued")!;
    expect(queued.column).toBe("plan");
    expect(queued.waitingOn).toBe("Waiting for a slot");
  });

  it("falls back to the workflow model when an agent carries none", () => {
    const agents = [
      {
        attempt: 0,
        cached: false,
        index: 0,
        label: "Labeled agent",
        lastProgressAt: 1_000,
        model: "qwen3-coder:30b",
        state: "done",
        durationMs: 500,
        startedAt: 1_000,
        resultPreview: "Done: no issues.",
      },
    ];
    const cards = normalizeThread(
      facts({ timeline: timeline({ activeWorkflows: [workflowRow(agents, { model: "wf-model" }) as never] }) }),
      ctx,
      null,
    );
    const agent = cards.find((card) => card.kind === "workflow-agent")!;
    expect(agent.status).toBe("completed");
    expect(agent.column).toBe("output");
    expect(agent.model).toBe("qwen3-coder:30b");
    expect(agent.outputPreview).toBe("Done: no issues.");
  });

  it("renders one fallback card when no agent breakdown exists", () => {
    const cards = normalizeThread(
      facts({
        timeline: timeline({
          activeWorkflows: [
            workflowRow([], {
              description: "Refactor sweep",
              taskStatus: "paused",
              summary: "Found 3 candidates.",
            }) as never,
          ],
        }),
      }),
      ctx,
      null,
    );
    const workflowCard = cards.find((card) => card.kind === "workflow-agent")!;
    expect(workflowCard.title).toBe("Refactor sweep");
    expect(workflowCard.status).toBe("waiting");
    expect(workflowCard.column).toBe("plan");
    expect(workflowCard.outputPreview).toBe("Found 3 candidates.");
  });
});

describe("plan and queue normalization", () => {
  it("places pendingTodos as plan cards with pending/in-progress/completed states", () => {
    const cards = normalizeThread(
      facts({
        timeline: timeline({
          pendingTodos: {
            items: [
              { id: "p1", status: "completed", text: "Design schema" },
              { id: "p2", status: "in_progress", text: "Write migrations" },
              { id: "p3", status: "pending", text: "Run tests" },
            ],
            sourceSeq: 5,
            updatedAt: 1_000,
          },
        }),
      }),
      ctx,
      null,
    );
    const plan = cards.filter((card) => card.kind === "plan-step");
    expect(plan).toHaveLength(3);
    expect(plan.every((card) => card.column === "plan")).toBe(true);
    const byStatus = new Map(plan.map((card) => [card.planStatus, card]));
    expect(byStatus.get("completed")!.status).toBe("completed");
    expect(byStatus.get("in_progress")!.status).toBe("running");
    expect(byStatus.get("pending")!.waitingOn).toBe("Not started");
  });

  it("falls back to the latest plan-steps row when no todos exist", () => {
    const rows = [
      workRow("plan-steps", {
        steps: [
          { step: "Audit deps", status: "completed" },
          { step: "Pin versions", status: "active" },
          { step: "Commit", status: undefined },
        ],
      }),
    ];
    const cards = normalizeThread(facts({ timeline: timeline({ rows }) }), ctx, null);
    const plan = cards.filter((card) => card.kind === "plan-step");
    expect(plan).toHaveLength(3);
    expect(plan.find((card) => card.title === "Pin versions")!.planStatus).toBe("in_progress");
    expect(plan.find((card) => card.title === "Commit")!.planStatus).toBe("pending");
  });

  it("turns queued messages into queued cards with their wait reason", () => {
    const cards = normalizeThread(
      facts({
        row: threadRow({ status: "idle", queuedMessageCount: 1 }),
        queuedMessages: [queuedMessage({ waitingOn: { kind: "thread-busy" } })],
      }),
      ctx,
      null,
    );
    const queuedCard = cards.find((card) => card.kind === "queued-message")!;
    expect(queuedCard.title).toBe("Run the tests");
    expect(queuedCard.status).toBe("queued");
    expect(queuedCard.column).toBe("plan");
    expect(queuedCard.model).toBe("qwen3-coder:30b");
    expect(queuedCard.waitingOn).toBe("Waiting for busy thread");
  });
});

describe("delegation normalization", () => {
  it("skips delegations whose child thread is observed", () => {
    const rows = [
      workRow("delegation", {
        childRef: "thr_child",
        description: "Write the README",
        background: false,
        output: "README written.",
        status: "completed",
        completedAt: 1_900,
        childRows: [],
      }),
    ];
    const cards = normalizeThread(
      facts({ timeline: timeline({ rows }), childThreadIds: ["thr_child"] }),
      ctx,
      null,
    );
    expect(cards.some((card) => card.kind === "delegation")).toBe(false);
  });

  it("keeps unobserved delegations as their own cards, interrupted included", () => {
    const rows = [
      workRow("delegation", {
        childRef: "thr_gone",
        description: "Investigate flaky test",
        background: true,
        output: null,
        status: "completed",
        completedAt: 1_900,
      }),
      workRow("delegation", {
        childRef: null,
        description: "Interrupted task",
        background: false,
        output: null,
        status: "interrupted",
      }),
    ];
    const cards = normalizeThread(
      facts({ timeline: timeline({ rows }), childThreadIds: [] }),
      ctx,
      null,
    );
    const delegations = cards.filter((card) => card.kind === "delegation");
    expect(delegations).toHaveLength(2);
    expect(delegations[0]!.status).toBe("completed");
    expect(delegations[0]!.threadId).toBe("thr_gone");
    expect(delegations[1]!.status).toBe("interrupted");
    expect(delegations[1]!.column).toBe("output");
  });
});

describe("failure and error normalization", () => {
  it("surfaces failure text from the events tail of an errored thread", () => {
    const cards = normalizeThread(
      facts({
        row: threadRow({ status: "error" }),
        events: [
          eventRow("provider/error", { error: "rate limited by upstream" }),
          eventRow("system/error", { message: "Turn failed after retries" }),
        ],
      }),
      ctx,
      null,
    );
    const root = cards.find((card) => card.isRoot && card.kind === "thread")!;
    expect(root.status).toBe("failed");
    expect(root.errorPreview).toBe("Turn failed after retries");
    expect(root.attention).toEqual({ type: "failed", message: "Turn failed after retries" });
  });

  it("falls back to the system error row when no events were fetched", () => {
    const rows = [
      {
        id: "sys-1",
        kind: "system",
        systemKind: "error",
        threadId: "thr_root",
        title: "Provider failure",
        detail: "upstream 502",
        startedAt: 1_500,
        createdAt: 1_500,
        sourceSeqStart: 9,
        sourceSeqEnd: 9,
        status: "error",
      },
    ];
    const cards = normalizeThread(
      facts({ row: threadRow({ status: "error" }), timeline: timeline({ rows: rows as never }) }),
      ctx,
      null,
    );
    const root = cards.find((card) => card.isRoot && card.kind === "thread")!;
    expect(root.errorPreview).toBe("Provider failure — upstream 502");
  });

  it("joins message and detail from a system/error event", () => {
    const cards = normalizeThread(
      facts({
        row: threadRow({ status: "error" }),
        events: [
          eventRow("system/error", {
            code: "thread_provisioning_failed",
            message: "Provisioning thread failed",
            detail: "Cannot create a worktree because the source is not a Git repository: /home/user",
          }),
        ],
      }),
      ctx,
      null,
    );
    const root = cards.find((card) => card.isRoot && card.kind === "thread")!;
    expect(root.errorPreview).toBe(
      "Provisioning thread failed — Cannot create a worktree because the source is not a Git repository: /home/user",
    );
  });
});

describe("running turn timing", () => {
  it("uses the visible pending turn row when the thread is running", () => {
    const cards = normalizeThread(
      facts({
        row: threadRow({ status: "active" }),
        timeline: timeline({
          rows: [
            turnRow({
              turnId: "turn-9",
              status: "pending",
              startedAt: 4_000,
              completedAt: null,
              children: [workRow("command", { command: "ls", turnId: "turn-9", startedAt: 4_100 })],
            }),
          ] as never,
        }),
      }),
      ctx,
      null,
    );
    const root = cards.find((card) => card.isRoot && card.kind === "thread")!;
    expect(root.startedAt).toBe(4_000);
    expect(root.completedAt).toBeNull();
  });

  it("approximates the start when the in-flight turn's opening row was trimmed from the segment", () => {
    // A long in-flight turn (turn-9) generated more rows than the segment
    // holds: only its newest work rows are visible, and the latest visible
    // turn row (turn-1) already completed. The board must not rewind the
    // live timer to that finished turn.
    const cards = normalizeThread(
      facts({
        row: threadRow({ status: "active" }),
        timeline: timeline({
          rows: [
            turnRow({ turnId: "turn-1", startedAt: 900, completedAt: 2_000, children: [] }),
            workRow("command", { command: "make test", turnId: "turn-9", startedAt: 5_000 }),
            workRow("command", { command: "make lint", turnId: "turn-9", startedAt: 5_600 }),
          ] as never,
        }),
      }),
      ctx,
      null,
    );
    const root = cards.find((card) => card.isRoot && card.kind === "thread")!;
    expect(root.startedAt).toBe(5_000);
    expect(root.completedAt).toBeNull();
    expect(root.durationMs).toBeNull();
  });

  it("keeps the finished turn's exact timing once the thread is idle", () => {
    const cards = normalizeThread(
      facts({
        row: threadRow({ status: "idle" }),
        timeline: timeline({
          rows: [
            turnRow({ turnId: "turn-1", startedAt: 900, completedAt: 2_000, children: [] }),
            workRow("command", { command: "make test", turnId: "turn-9", startedAt: 5_000 }),
          ] as never,
        }),
      }),
      ctx,
      null,
    );
    const root = cards.find((card) => card.isRoot && card.kind === "thread")!;
    expect(root.startedAt).toBe(900);
    expect(root.completedAt).toBe(2_000);
    expect(root.durationMs).toBe(1_100);
  });
});

describe("activity from events", () => {
  it("never normalizes reasoning events into board activity", () => {
    const entries = activityFromEvents([
      eventRow("item/reasoning/textDelta", { item: { text: "SECRET THINKING ABOUT AUTH" } }),
      eventRow("item/reasoning/summaryTextDelta", { item: { text: "SECRET SUMMARY" } }),
      eventRow("item/started", { item: { label: "Running tests" } }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.text).toBe("Running tests");
    const rendered = JSON.stringify(entries);
    expect(rendered).not.toContain("SECRET");
  });

  it("excludes non-activity events entirely", () => {
    const entries = activityFromEvents([
      eventRow("thread/tokenUsage/updated", { usedTokens: 10 }),
      eventRow("item/agentMessage/delta", { text: "partial" }),
      eventRow("system/error", { message: "boom" }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.text).toBe("boom");
  });
});

describe("latestActivity", () => {
  it("uses presentation labels when BB supplies them", () => {
    const rows = [
      workRow("file-change", {
        change: { path: "src/auth.ts", diffStats: { added: 3, removed: 1 } },
        presentation: { label: { pending: "Editing src/auth.ts", completed: "Edited src/auth.ts" } },
        status: "pending",
      }),
    ];
    const activity = latestActivity(rows);
    expect(activity?.text).toBe("Editing src/auth.ts");
    expect(activity?.kind).toBe("file-change");
  });

  it("reads the correct per-kind fields", () => {
    const cases: Array<[TimelineWorkRow, string]> = [
      [workRow("web-search", { queries: ["bb plugin sdk docs"] }), "Web search: bb plugin sdk docs"],
      [workRow("web-fetch", { url: "https://example.com/api" }), "Fetch: https://example.com/api"],
      [workRow("file-read", { path: "package.json" }), "package.json"],
      [workRow("image-view", { path: "shot.png" }), "shot.png"],
      [workRow("search", { mode: "content", query: "TODO" }), "Search: TODO"],
    ];
    for (const [row, expected] of cases) {
      expect(latestActivity([row])?.text).toBe(expected);
    }
  });
});

describe("focus correlation fields (parentThreadId, groupKey, sequence)", () => {
  it("marks the root thread with parentThreadId null", () => {
    const cards = normalizeThread(facts(), ctx, null);
    const root = cards.find((card) => card.isRoot)!;
    expect(root.parentThreadId).toBeNull();
  });

  it("carries the owning thread on child thread cards", () => {
    const cards = normalizeThread(
      facts({
        row: threadRow({ id: "thr_child", parentThreadId: "thr_root" }),
        isRoot: false,
        depth: 1,
        output: undefined,
        timeline: timeline(),
      }),
      ctx,
      null,
    );
    expect(cards.find((card) => card.kind === "thread")!.parentThreadId).toBe("thr_root");
  });

  it("tags plan steps with their plan groupKey and list order", () => {
    const rows = [
      workRow("plan-steps", {
        steps: [
          { step: "Audit deps", status: "completed" },
          { step: "Pin versions", status: "active" },
          { step: "Commit", status: undefined },
        ],
      }),
    ];
    const cards = normalizeThread(facts({ timeline: timeline({ rows }) }), ctx, null);
    const plan = cards.filter((card) => card.kind === "plan-step");
    expect(plan.every((card) => card.groupKey === "plan:thr_root")).toBe(true);
    expect(plan.map((card) => card.sequence)).toEqual([0, 1, 2]);
  });

  it("tags pendingTodos with the same plan groupKey and order", () => {
    const cards = normalizeThread(
      facts({
        timeline: timeline({
          pendingTodos: {
            items: [
              { id: "p1", status: "completed", text: "Design schema" },
              { id: "p2", status: "pending", text: "Run tests" },
            ],
            sourceSeq: 5,
            updatedAt: 1_000,
          },
        }),
      }),
      ctx,
      null,
    );
    const plan = cards.filter((card) => card.kind === "plan-step");
    expect(plan.every((card) => card.groupKey === "plan:thr_root")).toBe(true);
    expect(plan.map((card) => card.sequence)).toEqual([0, 1]);
  });

  it("tags workflow agents with their workflow groupKey and agent index", () => {
    const agents = [
      { index: 0, state: "running", label: "A", startedAt: 1_200, lastProgressAt: 1_400 },
      { index: 1, state: "queued", label: "B", queuedAt: 1_100 },
    ];
    const cards = normalizeThread(
      facts({ timeline: timeline({ activeWorkflows: [{ id: "wf-1", itemId: "item-1", kind: "work", workKind: "workflow", createdAt: 1_000, startedAt: 1_000, status: "pending", taskStatus: "running", workflow: { agents } }] as never }) }),
      ctx,
      null,
    );
    const agentCards = cards.filter((card) => card.kind === "workflow-agent");
    expect(agentCards.map((card) => card.groupKey)).toEqual(["workflow:thr_root:item-1", "workflow:thr_root:item-1"]);
    expect(agentCards.map((card) => card.sequence)).toEqual([0, 1]);
  });
});

describe("recentActivityFeed", () => {
  it("builds a bounded, newest-first, reasoning-free feed from work rows", () => {
    const rows = [
      workRow("file-read", { path: "src/first.ts", startedAt: 1_000, completedAt: 1_100 }),
      workRow("tool", { toolName: "read_file", status: "pending" }),
      workRow("file-change", { change: { path: "src/auth.ts" }, path: "src/auth.ts", startedAt: 2_000, completedAt: 2_100 }),
    ];
    const feed = recentActivityFeed("thr_root", rows);
    expect(feed.key).toBe("thread:thr_root");
    expect(feed.entries).toHaveLength(3);
    // Newest first.
    expect(feed.entries[0]!.detail).toContain("src/auth.ts");
    expect(feed.entries[2]!.detail).toContain("src/first.ts");
    // Label is the compact work-kind, detail is the safe activity text.
    expect(feed.entries[0]!.label).toBe("edit");
    expect(feed.entries[0]!.kind).toBe("file-change");
    expect(feed.entries[0]!.at).toBe(2_100);
  });

  it("keeps at most the configured number of entries", () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      workRow("file-read", { path: `src/file-${index}.ts`, startedAt: index * 100, completedAt: index * 100 + 10 }),
    );
    const feed = recentActivityFeed("thr_root", rows);
    expect(feed.entries).toHaveLength(6);
    expect(feed.entries[0]!.detail).toContain("src/file-11.ts");
    expect(feed.entries[5]!.detail).toContain("src/file-6.ts");
  });

  it("skips turn and reasoning rows entirely", () => {
    const rows = [
      workRow("file-read", { path: "src/a.ts", completedAt: 1_100 }),
      turnRow({ children: [] }) as unknown as TimelineWorkRow,
    ];
    const feed = recentActivityFeed("thr_root", rows);
    expect(feed.entries).toHaveLength(1);
    expect(feed.entries[0]!.detail).toContain("src/a.ts");
  });

  it("returns an empty feed when there is no observable work", () => {
    expect(recentActivityFeed("thr_root", []).entries).toEqual([]);
  });
});

function conversationRow(
  role: "assistant" | "user",
  text: string,
  seq: number,
  fields: Record<string, unknown> = {},
): unknown {
  return {
    id: `conv-${seq}`,
    kind: "conversation",
    role,
    ...(role === "assistant" ? { text, turnId: `turn-${seq}` } : {}),
    ...(role === "user"
      ? {
          initiator: "user",
          content: [{ type: "text", text }],
          senderThreadId: null,
          systemMessageKind: null,
          title: "User message",
        }
      : {}),
    startedAt: seq * 100,
    createdAt: seq * 100,
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    threadId: "thr_root",
    ...fields,
  };
}

describe("latestPublicUpdate", () => {
  it("uses the newest assistant-authored conversation text", () => {
    const rows = [
      conversationRow("assistant", "First update.", 1),
      conversationRow("assistant", "Second update: tests pass.", 2),
    ] as never;
    expect(latestPublicUpdate(rows)).toBe("Second update: tests pass.");
  });

  it("ignores user and system-authored conversation rows", () => {
    const rows = [
      conversationRow("user", "Please continue.", 1),
      {
        ...(conversationRow("assistant", "", 2) as Record<string, unknown>),
        initiator: "system",
        role: "user",
        content: [{ type: "text", text: "Child completed" }],
        title: "System notice",
      },
    ] as never;
    expect(latestPublicUpdate(rows)).toBeNull();
  });

  it("finds the assistant row nested inside a turn's children", () => {
    const rows = [
      turnRow({
        children: [conversationRow("assistant", "Nested public reply.", 7)],
      }),
    ] as never;
    expect(latestPublicUpdate(rows)).toBe("Nested public reply.");
  });

  it("returns null when the thread has no assistant text yet", () => {
    const rows = [workRow("command", { command: "npm test", status: "pending" })] as never;
    expect(latestPublicUpdate(rows)).toBeNull();
  });

  it("returns null for a code-fence-only assistant message (no prose to show)", () => {
    const rows = [
      conversationRow("assistant", "```ts\nexport const x = 42;\n```", 3),
    ] as never;
    expect(latestPublicUpdate(rows)).toBeNull();
  });

  it("bounds and redacts the excerpt like all global text", () => {
    const rows = [
      conversationRow("assistant", `x`.repeat(1_000), 1),
      conversationRow("assistant", "Rotated api_key=supersecret123 in staging.", 2),
    ] as never;
    const bounded = latestPublicUpdate([conversationRow("assistant", "y".repeat(900), 1)] as never);
    expect(bounded).not.toBeNull();
    expect(bounded!.length).toBeLessThanOrEqual(360);
    const redacted = latestPublicUpdate(rows);
    expect(redacted).not.toContain("supersecret123");
  });

  it("is carried onto the normalized thread card", () => {
    const rows = [
      workRow("tool", { toolName: "read_file", status: "completed" }),
      conversationRow("assistant", "Phase complete: the board now reconciles.", 9),
    ] as never;
    const cards = normalizeThread(facts({ timeline: timeline({ rows }) }), ctx, null);
    const root = cards.find((card) => card.isRoot && card.kind === "thread")!;
    expect(root.latestPublicUpdate).toBe("Phase complete: the board now reconciles.");
  });

  it("keeps the excerpt null when the assistant row is malformed (resilient)", () => {
    const rows = [
      conversationRow("assistant", "", 4),
      { kind: "conversation", role: "assistant", text: null, sourceSeqEnd: 5 },
    ] as never;
    expect(latestPublicUpdate(rows)).toBeNull();
  });
});
