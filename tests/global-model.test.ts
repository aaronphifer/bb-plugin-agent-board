import { describe, expect, it } from "vitest";
import type { AttentionType, BoardCard } from "@/contract/rpc";
import { BOARD_LIMITS } from "@/lib/board-model";
import { attentionDismissalKey } from "@/lib/dismissals";
import {
  buildGlobalDashboard,
  buildGlobalExecution,
  deriveAttentionItems,
  type GlobalExecutionGroup,
} from "@/lib/global-model";

function card(overrides: Partial<BoardCard> = {}): BoardCard {
  const status = overrides.status ?? "completed";
  return {
    key: overrides.key ?? "thread:root",
    parentKey: null,
    depth: 0,
    kind: "thread",
    source: "bb",
    title: "Work",
    subtitle: null,
    status,
    column: status === "running" ? "active" : status === "queued" || status === "waiting" ? "plan" : "output",
    threadId: "thr_root",
    providerId: "pi",
    providerLabel: "Pi",
    model: null,
    startedAt: 100,
    completedAt: status === "completed" ? 900 : null,
    durationMs: status === "completed" ? 800 : null,
    phaseTitle: null,
    promptPreview: null,
    activity: null,
    outputPreview: null,
    errorPreview: null,
    tokens: null,
    toolCalls: null,
    waitingOn: null,
    planStatus: null,
    isRoot: true,
    ...overrides,
  };
}

function group(overrides: Partial<GlobalExecutionGroup> = {}): GlobalExecutionGroup {
  return {
    key: "bb:thr_root",
    source: "bb",
    title: "Root work",
    threadId: "thr_root",
    projectId: "proj_1",
    cards: [card()],
    updatedAt: 1_000,
    ...overrides,
  };
}

function attention(type: AttentionType, message: string, overrides: Partial<BoardCard> = {}) {
  return card({ status: type === "interrupted" ? "interrupted" : type === "failed" ? "failed" : "waiting", attention: { type, message }, ...overrides });
}

describe("global logical execution model", () => {
  it("returns a truthful zero-work dashboard", () => {
    const result = buildGlobalDashboard([], { now: 1_000 });
    expect(result.active).toEqual([]);
    expect(result.recent).toEqual([]);
    expect(result.attention).toEqual([]);
    expect(result.counts).toEqual({ active: 0, waiting: 0, attention: 0, recent: 0, failures: 0 });
  });

  it("uses the active child detail while keeping the root execution title", () => {
    const execution = buildGlobalExecution(group({ cards: [
      card({ title: "Root work", status: "completed", isRoot: true }),
      card({ key: "thread:child", title: "Auth child", status: "running", isRoot: false, threadId: "thr_child", model: "qwen3:8b", phaseTitle: "Code review", activity: { text: "Reading auth.ts", at: 900, kind: "file-read" } }),
    ] }));
    expect(execution.card.title).toBe("Root work");
    expect(execution.card.threadId).toBe("thr_child");
    expect(execution.card.model).toBe("qwen3:8b");
    expect(execution.card.phaseTitle).toBe("Code review");
    expect(execution.card.activity?.text).toBe("Reading auth.ts");
    expect(execution.activeChildCount).toBe(1);
  });

  it("does not invent a model and strips prompt previews from global cards", () => {
    const execution = buildGlobalExecution(group({ cards: [card({ status: "running", model: null, promptPreview: "private prompt and hidden reasoning" })] }));
    expect(execution.card.model).toBeNull();
    expect(execution.card.promptPreview).toBeNull();
    expect(JSON.stringify(execution)).not.toContain("hidden reasoning");
  });

  it("keeps independent BB and Redteam executions separate", () => {
    const result = buildGlobalDashboard([
      group({ key: "bb:a", cards: [card({ key: "a", status: "running" })] }),
      group({ key: "redteam:s1", source: "redteam", title: "Redteam — Lab", threadId: null, scanId: "s1", cards: [card({ key: "r", source: "redteam", kind: "phase", threadId: null, status: "running" })] }),
    ], { now: 2_000 });
    expect(result.active.map((item) => item.key)).toEqual(["bb:a", "redteam:s1"]);
    expect(result.counts.active).toBe(2);
  });

  it("counts queued and waiting executions separately from executing work", () => {
    const result = buildGlobalDashboard([
      group({ key: "run", cards: [card({ status: "running" })] }),
      group({ key: "wait", cards: [card({ status: "waiting" })] }),
      group({ key: "queue", cards: [card({ status: "queued" })] }),
    ], { now: 2_000 });
    expect(result.counts.active).toBe(1);
    expect(result.counts.waiting).toBe(2);
  });

  it("bounds recently completed executions and keeps failures visible", () => {
    const groups = Array.from({ length: BOARD_LIMITS.globalRecentExecutions + 3 }, (_, index) =>
      group({ key: `g${index}`, updatedAt: index, cards: [card({ key: `c${index}`, status: index === 8 ? "failed" : "completed", attention: index === 8 ? { type: "failed", message: "failed" } : null })] }),
    );
    const result = buildGlobalDashboard(groups, { now: 10_000 });
    expect(result.recent).toHaveLength(BOARD_LIMITS.globalRecentExecutions);
    expect(result.recent[0]!.card.status).toBe("failed");
  });
});

describe("Needs Attention derivation", () => {
  it.each([
    ["action-required", "Approval required"],
    ["waiting", "Waiting for host"],
    ["failed", "Provisioning failed"],
    ["interrupted", "Execution was interrupted"],
    ["warning", "Capacity warning"],
  ] as const)("derives explicit %s state", (type, message) => {
    const items = deriveAttentionItems([group({ cards: [attention(type, message)] })], 2_000);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type, message, executionKey: "bb:thr_root", status: "open" });
  });

  it("supports explicit question/input requests", () => {
    const [item] = deriveAttentionItems([group({ cards: [attention("action-required", "Input required")] })], 2_000);
    expect(item?.message).toBe("Input required");
  });

  it("removes resolved approval and resumed waiting automatically", () => {
    const unresolved = group({ cards: [attention("action-required", "Approval required")] });
    expect(deriveAttentionItems([unresolved], 2_000)).toHaveLength(1);
    const resumed = group({ cards: [card({ status: "running", attention: null })] });
    expect(deriveAttentionItems([resumed], 2_000)).toEqual([]);
  });

  it("collapses duplicate parent/child failures by execution and type", () => {
    const items = deriveAttentionItems([group({ cards: [
      attention("failed", "Root failed", { key: "root", isRoot: true }),
      attention("failed", "Child failed", { key: "child", isRoot: false, threadId: "thr_child" }),
    ] })], 2_000);
    expect(items).toHaveLength(1);
    expect(items[0]!.message).toBe("2 execution steps failed");
  });

  it("keeps unrelated execution failures separate", () => {
    const items = deriveAttentionItems([
      group({ key: "bb:a", cards: [attention("failed", "A failed")] }),
      group({ key: "bb:b", cards: [attention("failed", "B failed")] }),
    ], 2_000);
    expect(items.map((item) => item.executionKey).sort()).toEqual(["bb:a", "bb:b"]);
  });

  it("orders action required before failures and waiting", () => {
    const items = deriveAttentionItems([
      group({ key: "wait", cards: [attention("waiting", "wait")] }),
      group({ key: "fail", cards: [attention("failed", "fail")] }),
      group({ key: "action", cards: [attention("action-required", "approve")] }),
    ], 2_000);
    expect(items.map((item) => item.type)).toEqual(["action-required", "failed", "waiting"]);
  });

  it("bounds attention and drops old terminal noise", () => {
    const old = group({ key: "old", updatedAt: 0, cards: [attention("failed", "old failure")] });
    const fresh = Array.from({ length: BOARD_LIMITS.globalAttentionItems + 2 }, (_, index) =>
      group({ key: `new${index}`, updatedAt: BOARD_LIMITS.terminalAttentionWindowMs + index, cards: [attention("failed", `failure ${index}`)] }),
    );
    const items = deriveAttentionItems([old, ...fresh], BOARD_LIMITS.terminalAttentionWindowMs + 100);
    expect(items).toHaveLength(BOARD_LIMITS.globalAttentionItems);
    expect(items.some((item) => item.executionKey === "old")).toBe(false);
  });

  it("never infers attention from generic prose", () => {
    const prose = card({ status: "running", activity: { text: "please respond with approval", at: 500, kind: "tool" }, waitingOn: "please respond", attention: null });
    expect(deriveAttentionItems([group({ cards: [prose] })], 2_000)).toEqual([]);
  });

  it("redacts and truncates attention text", () => {
    const secret = `Bearer abc.def password=hunter2 ${"x".repeat(300)}`;
    const [item] = deriveAttentionItems([group({ cards: [attention("failed", secret)] })], 2_000);
    expect(item!.message).toContain("Bearer [REDACTED]");
    expect(item!.message).toContain("password=[REDACTED]");
    expect(item!.message).not.toContain("hunter2");
    expect(item!.message.length).toBeLessThanOrEqual(BOARD_LIMITS.activityChars);
  });

  it("represents Redteam failure without source-specific UI logic", () => {
    const items = deriveAttentionItems([group({ key: "redteam:s", source: "redteam", threadId: null, scanId: "s", title: "Redteam — Lab", cards: [attention("failed", "Scan failed during verification", { source: "redteam", threadId: null })] })], 2_000);
    expect(items[0]).toMatchObject({ source: "redteam", scanId: "s", message: "Scan failed during verification" });
  });

  it("does not implement speculative stale-agent detection", () => {
    const silent = card({ status: "running", startedAt: 0, activity: null, attention: null });
    expect(deriveAttentionItems([group({ cards: [silent], updatedAt: 0 })], 10 * 60_000)).toEqual([]);
  });
});

describe("latestPublicUpdate on global cards", () => {
  it("surfaces the newest assistant-authored public text on the execution card", () => {
    const execution = buildGlobalExecution(group({ cards: [
      card({ title: "Root work", status: "running", isRoot: true, activity: { text: "Working", at: 500, kind: "tool" } }),
      card({ key: "thread:child", title: "Child", status: "running", isRoot: false, threadId: "thr_child",
        latestPublicUpdate: "The child is now reconciling terminal state.", activity: { text: "Editing", at: 900, kind: "file-change" } }),
    ] }));
    expect(execution.card.latestPublicUpdate).toBe("The child is now reconciling terminal state.");
  });

  it("ranks excerpt candidates by activity, then completion, then start time", () => {
    const execution = buildGlobalExecution(group({ cards: [
      card({ key: "a", status: "running", isRoot: false, latestPublicUpdate: "From card A.",
        completedAt: 950, activity: null }),
      card({ key: "b", status: "completed", isRoot: false, latestPublicUpdate: "From card B.",
        completedAt: 800, activity: null }),
    ] }));
    // Card A is more recent (later completedAt with no activity timestamps).
    expect(execution.card.latestPublicUpdate).toBe("From card A.");
  });

  it("skips plan-step and queued-message cards and omits the excerpt when nothing qualifies", () => {
    const onlySteps = buildGlobalExecution(group({ cards: [
      card({ key: "s1", kind: "plan-step", status: "running", latestPublicUpdate: "Step text" }),
      card({ key: "q1", kind: "queued-message", status: "queued", latestPublicUpdate: "Queued text" }),
    ] }));
    expect(onlySteps.card.latestPublicUpdate).toBeNull();

    const withThread = buildGlobalExecution(group({ cards: [
      card({ key: "s1", kind: "plan-step", status: "running", latestPublicUpdate: "Step text" }),
      card({ key: "t1", status: "running", isRoot: true, latestPublicUpdate: "Thread text", activity: { text: "x", at: 1, kind: "tool" } }),
    ] }));
    expect(withThread.card.latestPublicUpdate).toBe("Thread text");
  });

  it("keeps the excerpt strictly public: no prompt or output preview fields carry it", () => {
    const execution = buildGlobalExecution(group({ cards: [
      card({ status: "running", promptPreview: "SECRET PROMPT", outputPreview: "COMMAND OUTPUT", latestPublicUpdate: "Public update only." }),
    ] }));
    expect(execution.card.latestPublicUpdate).toBe("Public update only.");
    expect(execution.card.promptPreview).toBeNull();
    expect(execution.card.outputPreview).toBe("COMMAND OUTPUT"); // output preview stays where it belongs
  });
});

describe("attention dismissal (presentation-only)", () => {
  const failedGroup = group({ cards: [attention("failed", "Provisioning failed")] });

  it("filters a dismissed condition from Needs attention and reports the count", () => {
    const key = "bb:thr_root::failed::1000";
    const result = buildGlobalDashboard([failedGroup], { now: 2_000, dismissedKeys: new Set([key]) });
    expect(result.attention).toEqual([]);
    expect(result.counts.attention).toBe(0);
    expect(result.counts.failures).toBe(0);
    expect(result.dismissedCount).toBe(1);
  });

  it("keeps undismissed and differently-keyed items visible", () => {
    const result = buildGlobalDashboard([failedGroup], {
      now: 2_000,
      dismissedKeys: new Set(["bb:thr_root::failed::9999", "bb:other::failed::1000"]),
    });
    expect(result.attention).toHaveLength(1);
    expect(result.counts.attention).toBe(1);
    expect(result.dismissedCount).toBe(0);
  });

  it("keeps a dismissed failure visible in Recent (hiding is attention-only)", () => {
    const key = "bb:thr_root::failed::1000";
    const open = buildGlobalDashboard([failedGroup], { now: 2_000 });
    expect(open.recent.map((item) => item.key)).toContain("bb:thr_root");

    const dismissed = buildGlobalDashboard([failedGroup], { now: 2_000, dismissedKeys: new Set([key]) });
    expect(dismissed.recent.map((item) => item.key)).toContain("bb:thr_root");
    expect(dismissed.recent).toEqual(open.recent); // recent is untouched by dismissal
  });

  it("keys on the condition: an unchanged condition stays dismissed, a new one reappears", () => {
    const dismissedKeys = new Set(["bb:thr_root::failed::1000"]);
    // Unchanged condition re-derived later: same updatedAt → still dismissed.
    const unchanged = buildGlobalDashboard([failedGroup], { now: 60_000, dismissedKeys });
    expect(unchanged.attention).toEqual([]);

    // The execution updated (new failure message bumps group updatedAt): the
    // genuinely new condition reappears with the old key still in the store.
    const changed = buildGlobalDashboard(
      [group({ updatedAt: 5_000, cards: [attention("failed", "A different failure")] })],
      { now: 60_000, dismissedKeys },
    );
    expect(changed.attention).toHaveLength(1);
    expect(changed.attention[0]!.updatedAt).toBe(5_000);
    expect(changed.dismissedCount).toBe(0);
  });

  it("dismisses one attention type without hiding another on the same execution", () => {
    const both = group({ cards: [
      attention("failed", "Provisioning failed"),
      attention("waiting", "Waiting for host"),
    ] });
    const result = buildGlobalDashboard([both], {
      now: 2_000,
      dismissedKeys: new Set(["bb:thr_root::failed::1000"]),
    });
    expect(result.attention.map((item) => item.type)).toEqual(["waiting"]);
    expect(result.dismissedCount).toBe(1);
    expect(result.counts.attention).toBe(1);
  });

  it("derives the dismissal key from stable facts (re-derivation is stable)", () => {
    const [first] = deriveAttentionItems([failedGroup], 2_000);
    const [second] = deriveAttentionItems([failedGroup], 90_000);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // The key inputs do not include observation time.
    expect(attentionDismissalKey(first!)).toBe(attentionDismissalKey(second!));
  });
});
