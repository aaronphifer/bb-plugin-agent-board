import { describe, expect, it } from "vitest";
import type { TimelineResponse, ThreadEventRow } from "@/lib/bb-source";
import { BOARD_LIMITS } from "@/lib/board-model";
import { finalizeTimeline, normalizeBbTimeline, type TimelineCandidate } from "@/lib/timeline-model";

function timeline(rows: unknown[], hasOlderRows = false): TimelineResponse {
  return {
    rows,
    activeWorkflows: [],
    activeBackgroundCommands: [],
    maxSeq: rows.length,
    timelinePage: { kind: "latest", hasOlderRows, returnedSegmentCount: rows.length, segmentLimit: 80 },
    activePromptMode: null,
    activeThinking: { text: "SECRET THINKING" },
    goal: null,
    modelFallback: null,
    pendingTodos: null,
  } as unknown as TimelineResponse;
}

function base(id: string, at: number, fields: Record<string, unknown>) {
  return { id, threadId: "thr", turnId: "turn", createdAt: at, startedAt: at, sourceSeqStart: at, sourceSeqEnd: at, ...fields };
}

function normalize(rows: unknown[], lifecycleEvents: unknown[] = [], limit?: number) {
  return normalizeBbTimeline({
    executionKey: "bb:thr",
    threadId: "thr",
    timeline: timeline(rows),
    lifecycleEvents: lifecycleEvents as ThreadEventRow[],
    ...(limit === undefined ? {} : { limit }),
    now: 10_000,
  });
}

describe("BB execution timeline normalization", () => {
  it.each([
    ["completed", "execution-complete"],
    ["error", "execution-failed"],
    ["interrupted", "execution-interrupted"],
  ] as const)("maps execution start and %s", (status, terminalKind) => {
    const result = normalize([base("turn-row", 100, { kind: "turn", turnId: "turn", status, completedAt: 300, children: [] })]);
    expect(result.events.map((event) => event.kind)).toEqual(["execution-start", terminalKind]);
    expect(result.events[1]!.durationMs).toBe(200);
  });

  it("maps phase and distinct tool starts/completions/failures without raw output", () => {
    const rows = [
      base("plan", 100, { kind: "work", workKind: "plan-steps", status: "completed", completedAt: 200, steps: [], explanation: "safe", output: "RAW PLAN" }),
      base("read-a", 210, { kind: "work", workKind: "file-read", status: "completed", completedAt: 240, path: "src/a.ts", output: "SECRET FILE CONTENT" }),
      base("read-b", 250, { kind: "work", workKind: "file-read", status: "error", completedAt: 280, path: "src/b.ts", output: "RAW TOOL OUTPUT", presentation: { detail: "Read failed safely" } }),
    ];
    const result = normalize(rows);
    expect(result.events.map((event) => event.kind)).toEqual([
      "phase-start", "phase-complete", "tool-start", "tool-complete", "tool-start", "tool-failed",
    ]);
    expect(result.events.filter((event) => event.kind === "tool-start").map((event) => event.target)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(JSON.stringify(result)).not.toContain("SECRET FILE CONTENT");
    expect(JSON.stringify(result)).not.toContain("RAW TOOL OUTPUT");
  });

  it("maps a failed phase with a bounded safe error", () => {
    const result = normalize([base("plan-fail", 100, { kind: "work", workKind: "plan-steps", status: "error", completedAt: 180, steps: [], presentation: { detail: "Planning provider failed" } })]);
    expect(result.events.map((event) => event.kind)).toEqual(["phase-start", "phase-failed"]);
    expect(result.events[1]).toMatchObject({ status: "failed", summary: "Planning provider failed", attentionType: "failed" });
  });

  it("keeps only bounded redacted assistant prose and excludes every non-assistant or hidden channel", () => {
    const rows = [
      base("assistant", 100, { kind: "conversation", role: "assistant", text: "Audit done.\n```ts\nSECRET CODE\n```\npassword=hunter2" }),
      base("user", 110, { kind: "conversation", role: "user", text: "SECRET USER" }),
      base("system", 120, { kind: "conversation", role: "system", text: "SECRET SYSTEM" }),
      base("developer", 130, { kind: "conversation", role: "developer", text: "SECRET DEVELOPER" }),
      base("reasoning", 140, { kind: "reasoning", text: "SECRET REASONING" }),
    ];
    const result = normalize(rows);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ kind: "public-update", summary: "Audit done. password=[REDACTED]" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/SECRET (CODE|USER|SYSTEM|DEVELOPER|REASONING|THINKING)/);
    expect(result.events[0]!.summary!.length).toBeLessThanOrEqual(BOARD_LIMITS.timelineSummaryChars);
  });

  it("maps structured approval/question waits and supported resolution timestamps", () => {
    const rows = [
      base("approval", 100, { kind: "work", workKind: "approval", interactionId: "a1", lifecycle: "pending", status: "pending", completedAt: null, target: { toolName: "exec_command" } }),
      base("question", 200, { kind: "work", workKind: "question", interactionId: "q1", lifecycle: "answered", status: "completed", completedAt: 260, questions: [{ prompt: "Use cache?" }] }),
    ];
    const result = normalize(rows);
    expect(result.events.map((event) => event.kind)).toEqual(["approval-requested", "resumed"]);
    expect(result.events[0]).toMatchObject({ title: "Approval requested", attentionType: "action-required", toolName: "exec_command" });
    expect(result.events[1]).toMatchObject({ title: "Question answered", timestamp: 260 });
  });

  it("uses lifecycle events for resolved model, waiting, resumed, question, interruption, and fallback", () => {
    const events = [
      { id: "requested", seq: 0, createdAt: 50, type: "client/turn/requested", data: { input: [{ text: "SECRET USER INPUT" }], execution: { model: "gpt-5.6-sol" } } },
      { id: "p1", seq: 1, createdAt: 100, type: "system/thread-provisioning", data: { provisioningId: "host", status: "active" } },
      { id: "p2", seq: 2, createdAt: 200, type: "system/thread-provisioning", data: { provisioningId: "host", status: "completed" } },
      { id: "q", seq: 3, createdAt: 300, type: "system/interaction/lifecycle", data: { interaction: { id: "q2", status: "pending", payload: { kind: "user_question", questions: [{ prompt: "Which branch?" }] } } } },
      { id: "m", seq: 4, createdAt: 400, type: "provider/modelFallback", data: { fallbackModel: "qwen3:8b", message: "Primary unavailable" } },
      { id: "i", seq: 5, createdAt: 500, type: "system/thread/interrupted", data: { reason: "Host disconnected" } },
    ];
    const result = normalize([], events);
    expect(result.events.map((event) => event.kind)).toEqual(["model-selected", "waiting", "resumed", "question-requested", "model-selected", "execution-interrupted"]);
    expect(result.events.filter((event) => event.kind === "model-selected").map((event) => event.model)).toEqual(["gpt-5.6-sol", "qwen3:8b"]);
    expect(JSON.stringify(result)).not.toContain("SECRET USER INPUT");
    expect(result.active).toBe(false);
  });

  it("keeps the provisioning startup window active until a later terminal event exists", () => {
    const requested = { id: "requested", seq: 1, createdAt: 100, type: "client/turn/requested", data: { execution: { model: "gpt-5.6-sol" } } };
    const starting = normalize([], [requested]);
    expect(starting.active).toBe(true);

    const completed = normalize([
      base("turn", 110, { kind: "turn", turnId: "t1", status: "completed", completedAt: 200 }),
    ], [requested]);
    expect(completed.active).toBe(false);
  });

  it("maps child/delegation lifecycle and one actual workflow model", () => {
    const rows = [
      base("delegated", 100, { kind: "work", workKind: "delegation", childRef: null, description: "Research cache", status: "pending", completedAt: null, output: "" }),
      base("child", 200, { kind: "work", workKind: "delegation", childRef: "thr_child", description: "Review cache", status: "completed", completedAt: 260, durationMs: 60, output: "Review complete" }),
      base("child-failed", 270, { kind: "work", workKind: "delegation", childRef: "thr_failed", description: "Broken child", status: "error", completedAt: 290, durationMs: 20, output: "Child failed safely" }),
      base("workflow", 300, { kind: "work", workKind: "workflow", status: "completed", completedAt: 400, workflow: { agents: [{ index: 0, attempt: 0, label: "Tester", model: "glm-5", startedAt: 310, durationMs: 50, state: "done", phaseTitle: "Test" }] } }),
    ];
    const result = normalize(rows);
    expect(result.events.map((event) => event.kind)).toEqual(["delegation", "child-start", "child-complete", "child-start", "child-failed", "model-selected", "child-start", "child-complete"]);
    expect(result.events.filter((event) => event.kind === "model-selected")).toHaveLength(1);
    expect(result.events.find((event) => event.kind === "model-selected")?.model).toBe("glm-5");
  });

  it("clamps commands and failure previews before returning the contract", () => {
    const command = `npm test ${"x".repeat(500)}`;
    const error = `failed ${"y".repeat(500)}`;
    const result = normalize([base("cmd", 100, { kind: "work", workKind: "command", command, status: "error", completedAt: 200, output: "RAW", presentation: { detail: error } })]);
    expect(result.events[0]!.target!.length).toBeLessThanOrEqual(BOARD_LIMITS.timelineTargetChars);
    expect(result.events[1]!.summary!.length).toBeLessThanOrEqual(BOARD_LIMITS.timelineSummaryChars);
    expect(result.events[0]!.target).toMatch(/…$/);
  });

  it("sorts chronologically, collapses duplicate logical events, retains distinct tools, and marks bounds", () => {
    const common = { executionKey: "bb:thr", source: "bb" as const, threadId: "thr", status: "running" as const, title: "Tool", summary: null, model: null, toolName: "read", target: null, phase: null, durationMs: null, attentionType: null, sourceMetadata: null };
    const candidates: TimelineCandidate[] = [
      { ...common, id: "later", fingerprint: "same", timestamp: 300, kind: "tool-start", sortSequence: 3 },
      { ...common, id: "older-duplicate", fingerprint: "same", timestamp: 100, kind: "tool-start", sortSequence: 1 },
      { ...common, id: "distinct", fingerprint: "other", timestamp: 200, kind: "tool-start", sortSequence: 2 },
    ];
    const result = finalizeTimeline("bb:thr", "bb", candidates, { active: true, limit: 1, fetchedAt: 400 });
    expect(result.events.map((event) => event.id)).toEqual(["later"]);
    expect(result.truncated).toBe(true);
    expect(result.active).toBe(true);
  });

  it("ignores malformed rows and exposes source truncation honestly", () => {
    const result = normalizeBbTimeline({ executionKey: "bb:thr", threadId: "thr", timeline: timeline([null, {}, { id: "bad", kind: "work" }], true), now: 1 });
    expect(result.events).toEqual([]);
    expect(result.truncated).toBe(true);
  });
});
