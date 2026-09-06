import { describe, expect, it, vi } from "vitest";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { BOARD_LIMITS } from "@/lib/board-model";
import { RedteamBoardSource, normalizeRedteamGlobalSnapshot, normalizeRedteamSnapshot, normalizeRedteamTimeline, redteamObservabilityWireSchema } from "@/lib/redteam-source";

const at = (seconds: number) => `2026-09-03T12:00:${String(seconds).padStart(2, "0")}.000Z`;
const phases = (running: string | null = null) => [
  { id: "queued", label: "Queued", state: "completed", startedAt: at(0), finishedAt: at(1), durationMs: 1000, summary: null, error: null },
  ...["reconnaissance", "code-review", "web-testing", "verification", "reporting"].map((id, index) => ({
    id, label: id === "code-review" ? "Code review" : id[0]!.toUpperCase() + id.slice(1),
    state: id === running ? "running" : running && index > ["reconnaissance", "code-review", "web-testing", "verification", "reporting"].indexOf(running) ? "queued" : "completed",
    startedAt: id === running || !running || index < ["reconnaissance", "code-review", "web-testing", "verification", "reporting"].indexOf(running) ? at(index + 1) : null,
    finishedAt: id === running || (running && index >= ["reconnaissance", "code-review", "web-testing", "verification", "reporting"].indexOf(running)) ? null : at(index + 2),
    durationMs: id === running ? 10_000 : 1000, summary: id === "reconnaissance" ? "3 entry points; 1 web app" : null, error: null,
  })),
  { id: "completed", label: "Completed", state: running ? "queued" : "completed", startedAt: running ? null : at(10), finishedAt: running ? null : at(10), durationMs: running ? null : 0, summary: null, error: null },
];

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1, observedAt: at(20), scans: [{
      scanId: "scan-1", projectId: "project-1", title: "Authorized scan", mode: "static", status: "running",
      startedAt: at(0), updatedAt: at(11), finishedAt: null, currentPhaseId: "code-review", failedPhaseId: null,
      phases: phases("code-review"), operations: [], candidateCounts: { total: 0, codeReview: 0, webTesting: 0 },
      findingCounts: { total: 0, unverified: 0, confirmed: 0, inconclusive: 0, rejected: 0, severity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 } }, error: null,
      ...overrides,
    }],
  };
}

function makeSource(callRpc: (...args: unknown[]) => Promise<unknown>) {
  const bb = { sdk: { plugins: { callRpc } } } as unknown as BbPluginApi;
  return new RedteamBoardSource(bb, () => 10_000);
}

describe("optional public RPC", () => {
  it.each(["not installed", "disabled", "unknown_method", "RPC timeout"])("isolates %s errors", async (message) => {
    const source = makeSource(async () => { throw new Error(message); });
    await expect(source.collect("project-1")).resolves.toEqual({ cards: [], active: false, partial: false, fingerprint: null, activityFeeds: [] });
  });

  it("handles no project and no scans", async () => {
    const call = vi.fn(async () => ({ schemaVersion: 1, observedAt: at(0), scans: [] })); const source = makeSource(call);
    expect((await source.collect(null)).cards).toEqual([]); expect(call).not.toHaveBeenCalled();
    expect((await source.collect("project-1")).cards).toEqual([]);
  });

  it("rejects malformed snapshots safely", async () => {
    const source = makeSource(async () => ({ schemaVersion: 1, observedAt: at(0), scans: [{ scanId: 9 }] }));
    expect((await source.collect("project-1")).cards).toEqual([]);
  });

  it("accepts a partial scan but emits no fabricated card without identity", () => {
    const parsed = redteamObservabilityWireSchema.parse({ schemaVersion: 1, observedAt: at(0), scans: [{}] });
    expect(normalizeRedteamSnapshot(parsed).cards).toEqual([]);
  });
});

describe("card normalization", () => {
  it("maps queued phases into PLAN without inventing model or activity", () => {
    const parsed = redteamObservabilityWireSchema.parse(snapshot()); const result = normalizeRedteamSnapshot(parsed);
    const verification = result.cards.find((card) => card.phaseId === "verification")!;
    expect(verification.source).toBe("redteam"); expect(verification.kind).toBe("phase"); expect(verification.status).toBe("queued"); expect(verification.column).toBe("plan");
    expect(verification.model).toBeNull(); expect(verification.activity).toBeNull(); expect(verification.waitingOn).toContain("earlier");
  });

  it("maps an active phase when no operation detail exists", () => {
    const result = normalizeRedteamSnapshot(redteamObservabilityWireSchema.parse(snapshot()));
    const card = result.cards.find((item) => item.phaseId === "code-review")!;
    expect(card.kind).toBe("phase"); expect(card.status).toBe("running"); expect(card.column).toBe("active"); expect(card.model).toBeNull();
  });

  it("maps actual model and running tool activity into one active operation card", () => {
    const operations = [{ id: "op-1", kind: "tool", label: "read_file", phaseId: "code-review", state: "running", actualModel: "qwen3:8b",
      task: "Reading src/dispatcher.js", latestActivity: "Reading src/dispatcher.js", toolName: "read_file", target: "src/dispatcher.js",
      startedAt: at(2), updatedAt: at(9), finishedAt: null, durationMs: 7_000, outputPreview: null, error: null }];
    const result = normalizeRedteamSnapshot(redteamObservabilityWireSchema.parse(snapshot({ operations })));
    const card = result.cards.find((item) => item.phaseId === "code-review")!;
    expect(card.kind).toBe("operation"); expect(card.operationId).toBe("op-1"); expect(card.model).toBe("qwen3:8b");
    expect(card.phaseTitle).toBe("Tool: read_file"); expect(card.activity?.text).toBe("Reading src/dispatcher.js"); expect(card.durationMs).toBe(7_000);
  });

  it("maps completed phases and compact candidate/finding counts into OUTPUTS", () => {
    const value = snapshot({ status: "completed", currentPhaseId: null, finishedAt: at(20), phases: phases(null), candidateCounts: { total: 3, codeReview: 2, webTesting: 1 },
      findingCounts: { total: 3, unverified: 0, confirmed: 1, inconclusive: 1, rejected: 1, severity: { critical: 0, high: 1, medium: 1, low: 1, info: 0 } } });
    const result = normalizeRedteamSnapshot(redteamObservabilityWireSchema.parse(value)); const verification = result.cards.find((card) => card.phaseId === "verification")!;
    expect(result.active).toBe(false); expect(verification.status).toBe("completed"); expect(verification.column).toBe("output");
    expect(verification.outputPreview).toContain("3 candidates"); expect(verification.outputPreview).toContain("1 confirmed");
  });

  it.each([["failed", "failed"], ["cancelled", "interrupted"]] as const)("maps %s phase truthfully", (phaseState, cardState) => {
    const phaseList = phases("verification").map((phase) => phase.id === "verification" ? { ...phase, state: phaseState, finishedAt: at(15), error: "Verifier unavailable" } : phase);
    const result = normalizeRedteamSnapshot(redteamObservabilityWireSchema.parse(snapshot({ status: phaseState, currentPhaseId: null, failedPhaseId: "verification", phases: phaseList, error: "Verifier unavailable" })));
    const card = result.cards.find((item) => item.phaseId === "verification")!; expect(card.status).toBe(cardState); expect(card.errorPreview).toBe("Verifier unavailable");
  });

  it("keeps separate concurrent scans and source metadata", () => {
    const value = snapshot(); value.scans.push({ ...value.scans[0], scanId: "scan-2", title: "Second scan" });
    const cards = normalizeRedteamSnapshot(redteamObservabilityWireSchema.parse(value)).cards;
    expect(new Set(cards.map((card) => card.scanId))).toEqual(new Set(["scan-1", "scan-2"])); expect(cards.every((card) => card.source === "redteam")).toBe(true);
  });

  it("bounds cards and drops unknown reasoning fields", () => {
    const value = snapshot({ reasoning: "SECRET REASONING", prompt: "SECRET PROMPT" });
    value.scans = Array.from({ length: BOARD_LIMITS.redteamMaxScans }, (_, index) => ({ ...value.scans[0], scanId: `scan-${index}`, reasoning: "SECRET REASONING" }));
    const parsed = redteamObservabilityWireSchema.parse(value); const result = normalizeRedteamSnapshot(parsed); const json = JSON.stringify(result);
    expect(result.cards.length).toBeLessThanOrEqual(BOARD_LIMITS.redteamMaxCards); expect(json).not.toContain("SECRET"); expect(json).not.toContain("reasoning");
  });

  it("coalesces overlapping RPC requests", async () => {
    let release!: (value: unknown) => void; const gate = new Promise((resolve) => { release = resolve; }); const call = vi.fn(async () => gate); const source = makeSource(call);
    const first = source.collect("project-1"); const second = source.collect("project-1"); release({ schemaVersion: 1, observedAt: at(0), scans: [] });
    await Promise.all([first, second]); expect(call).toHaveBeenCalledTimes(1);
  });
});

describe("focus correlation fields", () => {
  it("tags every phase card with its scan groupKey and canonical order", () => {
    const result = normalizeRedteamSnapshot(redteamObservabilityWireSchema.parse(snapshot()));
    const order = new Map([["reconnaissance", 0], ["code-review", 1], ["web-testing", 2], ["verification", 3], ["reporting", 4]]);
    for (const card of result.cards) {
      expect(card.groupKey).toBe("redteam:scan-1");
      expect(card.sequence).toBe(order.get(card.phaseId!));
    }
  });
});

describe("global Redteam source", () => {
  it("returns an available empty result when there are no scans", () => {
    const parsed = redteamObservabilityWireSchema.parse({ schemaVersion: 1, observedAt: at(0), scans: [] });
    expect(normalizeRedteamGlobalSnapshot(parsed)).toMatchObject({ groups: [], active: false, available: true });
  });

  it("keeps a partial running scan visible with a truthful scan fallback", () => {
    const parsed = redteamObservabilityWireSchema.parse(snapshot({ phases: [], operations: [] }));
    const result = normalizeRedteamGlobalSnapshot(parsed);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.title).toBe("Redteam — Authorized scan");
    expect(result.groups[0]!.cards[0]).toMatchObject({ status: "running", source: "redteam", model: null });
  });

  it("keeps multiple scans as separate global execution groups", () => {
    const value = snapshot(); value.scans.push({ ...value.scans[0], scanId: "scan-2", title: "Second scan" });
    const result = normalizeRedteamGlobalSnapshot(redteamObservabilityWireSchema.parse(value));
    expect(result.groups.map((group) => group.key)).toEqual(["redteam:scan-1", "redteam:scan-2"]);
  });

  it("marks failed and cancelled scans for attention", () => {
    for (const state of ["failed", "cancelled"] as const) {
      const phaseList = phases("verification").map((phase) => phase.id === "verification" ? { ...phase, state, error: state === "failed" ? "Verifier failed" : null } : phase);
      const parsed = redteamObservabilityWireSchema.parse(snapshot({ status: state, phases: phaseList, currentPhaseId: null, error: state === "failed" ? "Verifier failed" : null }));
      const result = normalizeRedteamGlobalSnapshot(parsed);
      const affected = result.groups[0]!.cards.find((card) => card.phaseId === "verification")!;
      expect(affected.attention?.type).toBe(state === "failed" ? "failed" : "interrupted");
    }
  });

  it("isolates unavailable global RPC and retains only disposable stale data", async () => {
    let fail = false;
    const source = makeSource(async () => {
      if (fail) throw new Error("offline");
      return snapshot();
    });
    expect((await source.collectGlobal()).available).toBe(true);
    fail = true;
    const stale = await source.collectGlobal({ fresh: true });
    expect(stale.available).toBe(false);
    expect(stale.groups).toHaveLength(1);
  });
});

describe("scan activity feeds", () => {
  const operations = [
    { id: "op-2", kind: "tool", label: "grep", phaseId: "reconnaissance", state: "completed", actualModel: null,
      task: "Grepping", latestActivity: "Completed grep", toolName: "grep", target: "src/*.ts",
      startedAt: at(2), updatedAt: at(8), finishedAt: at(8), durationMs: 6_000, outputPreview: null, error: null },
    { id: "op-1", kind: "tool", label: "read_file", phaseId: "code-review", state: "running", actualModel: "qwen3:8b",
      task: "Reading src/dispatcher.js", latestActivity: "Reading src/dispatcher.js", toolName: "read_file", target: "src/dispatcher.js",
      startedAt: at(3), updatedAt: at(9), finishedAt: null, durationMs: 6_000, outputPreview: null, error: null },
  ];

  it("builds a newest-first feed of bounded safe operation summaries", () => {
    const result = normalizeRedteamSnapshot(redteamObservabilityWireSchema.parse(snapshot({ operations })));
    expect(result.activityFeeds).toHaveLength(1);
    const feed = result.activityFeeds[0]!;
    expect(feed.key).toBe("redteam:scan-1");
    expect(feed.entries.map((entry) => entry.id)).toEqual(["op-1", "op-2"]);
    expect(feed.entries[0]!.label).toBe("read_file");
    expect(feed.entries[0]!.detail).toBe("src/dispatcher.js");
    expect(feed.entries[0]!.kind).toBe("tool");
    expect(feed.entries[1]!.label).toBe("grep");
  });

  it("labels inference and agent-loop operations truthfully", () => {
    const ops = [
      { id: "op-m", kind: "inference", label: "model call", phaseId: "code-review", state: "running", actualModel: "qwen3:8b",
        task: "Analyzing", latestActivity: "Analyzing findings", toolName: null, target: null,
        startedAt: at(3), updatedAt: at(9), finishedAt: null, durationMs: 1_000, outputPreview: null, error: null },
    ];
    const result = normalizeRedteamSnapshot(redteamObservabilityWireSchema.parse(snapshot({ operations: ops })));
    expect(result.activityFeeds[0]!.entries[0]!.label).toBe("model");
    expect(result.activityFeeds[0]!.entries[0]!.detail).toBe("Analyzing findings");
  });

  it("caps operations at the wire limit and carries all of them in the feed", () => {
    const ops = Array.from({ length: 9 }, (_, index) => ({ id: `op-${index}`, kind: "tool", label: "tool", phaseId: "code-review", state: "completed", actualModel: null,
      task: `Task ${index}`, latestActivity: null, toolName: "tool", target: `t-${index}`,
      startedAt: at(1), updatedAt: at(2), finishedAt: at(2), durationMs: 1_000, outputPreview: null, error: null }));
    // The wire contract hard-rejects more than the scan's operation bound.
    expect(() => redteamObservabilityWireSchema.parse(snapshot({ operations: ops }))).toThrow();
    const result = normalizeRedteamSnapshot(redteamObservabilityWireSchema.parse(snapshot({ operations: ops.slice(0, BOARD_LIMITS.redteamMaxOperationsPerScan) })));
    expect(result.activityFeeds[0]!.entries).toHaveLength(BOARD_LIMITS.redteamMaxOperationsPerScan);
  });

  it("emits one feed per selected scan", () => {
    const value = snapshot(); value.scans.push({ ...value.scans[0], scanId: "scan-2", title: "Second scan" });
    const result = normalizeRedteamSnapshot(redteamObservabilityWireSchema.parse(value));
    expect(result.activityFeeds.map((feed) => feed.key)).toEqual(["redteam:scan-1", "redteam:scan-2"]);
  });

  it("emits an empty feed for a scan without operations", () => {
    const result = normalizeRedteamSnapshot(redteamObservabilityWireSchema.parse(snapshot()));
    expect(result.activityFeeds[0]!.entries).toEqual([]);
  });
});

describe("Redteam execution timeline", () => {
  it("derives truthful phase history when a completed scan retained no operations", () => {
    const parsed = redteamObservabilityWireSchema.parse(snapshot({ status: "completed", currentPhaseId: null, finishedAt: at(20), phases: phases(null), operations: [] }));
    const result = normalizeRedteamTimeline(parsed, "scan-1", "redteam:scan-1", 50, Date.parse(at(20)))!;
    expect(result.active).toBe(false);
    expect(result.events[0]!.kind).toBe("execution-start");
    expect(result.events.some((event) => event.kind === "phase-start")).toBe(true);
    expect(result.events.some((event) => event.kind === "phase-complete")).toBe(true);
    expect(result.events.at(-1)!.kind).toBe("execution-complete");
    expect(result.events.some((event) => event.kind.startsWith("tool-"))).toBe(false);
    expect(result.sourceWarning).toContain("phase milestones");
  });

  it("maps retained operations, actual models, waiting, failures, and redaction", () => {
    const operations = [
      { id: "op-1", kind: "tool", label: "read_file", phaseId: "code-review", state: "completed", actualModel: "qwen3:8b", task: "Read source", latestActivity: "Done", toolName: "read_file", target: "src/a.ts", startedAt: at(3), updatedAt: at(4), finishedAt: at(4), durationMs: 1_000, outputPreview: "password=hunter2", error: null },
      { id: "op-2", kind: "tool", label: "verify", phaseId: "code-review", state: "failed", actualModel: "qwen3:8b", task: "Verify", latestActivity: null, toolName: "verify", target: "finding-1", startedAt: at(5), updatedAt: at(6), finishedAt: at(6), durationMs: 1_000, outputPreview: null, error: "Bearer abc.secret" },
      { id: "op-3", kind: "tool", label: "host", phaseId: "code-review", state: "waiting", actualModel: null, task: "Wait", latestActivity: "Waiting for host", toolName: "host", target: null, startedAt: at(7), updatedAt: at(8), finishedAt: null, durationMs: null, outputPreview: null, error: null },
    ];
    const parsed = redteamObservabilityWireSchema.parse(snapshot({ operations }));
    const result = normalizeRedteamTimeline(parsed, "scan-1", "redteam:scan-1", 50, Date.parse(at(20)))!;
    expect(result.events.filter((event) => event.kind === "model-selected")).toHaveLength(1);
    expect(result.events.some((event) => event.kind === "tool-complete")).toBe(true);
    expect(result.events.some((event) => event.kind === "tool-failed")).toBe(true);
    expect(result.events.some((event) => event.kind === "waiting")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(JSON.stringify(result)).not.toContain("abc.secret");
  });

  it("returns null for a scan outside the bounded public snapshot", () => {
    const parsed = redteamObservabilityWireSchema.parse(snapshot());
    expect(normalizeRedteamTimeline(parsed, "missing", "redteam:missing")).toBeNull();
  });

  it("lazy source reads once when no fresh snapshot is cached and then reuses it", async () => {
    const call = vi.fn(async () => snapshot());
    const source = makeSource(call);
    const first = await source.timeline("scan-1", "redteam:scan-1", 50);
    const second = await source.timeline("scan-1", "redteam:scan-1", 50);
    expect(first.events.length).toBeGreaterThan(0);
    expect(second.events).toEqual(first.events);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a pre-invalidation Redteam snapshot after its in-flight read settles", async () => {
    let release!: (value: unknown) => void;
    const gate = new Promise((resolve) => { release = resolve; });
    let calls = 0;
    const source = makeSource(async () => {
      calls += 1;
      if (calls === 1) return gate;
      return snapshot({ title: "Fresh scan" });
    });
    const stale = source.timeline("scan-1", "redteam:scan-1", 50);
    source.invalidate();
    release(snapshot({ title: "Stale scan" }));
    await expect(stale).rejects.toThrow("unavailable");
    const fresh = await source.timeline("scan-1", "redteam:scan-1", 50);
    expect(calls).toBe(2);
    expect(fresh.events[0]!.summary).toBe("Fresh scan");
  });
});
