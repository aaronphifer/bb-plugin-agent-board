// Focus view model tests: the logical-execution grouping rule, hero
// selection, pipeline derivation, feeds, and section behavior — all pure
// (no React, no SDK).
import { describe, expect, it } from "vitest";
import type { BoardActivityFeed, BoardCard, BoardSnapshot } from "@/contract/rpc";
import {
  buildFocusModel,
  groupExecutions,
  heroLabelFor,
  isFocusActiveStatus,
} from "@/lib/focus-model";

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

function redteamPhase(scanId: string, phaseId: string, title: string, overrides: Partial<BoardCard> = {}): BoardCard {
  const sequence = { reconnaissance: 0, "code-review": 1, "web-testing": 2, verification: 3, reporting: 4 }[phaseId] ?? 5;
  const status = overrides.status ?? "running";
  return card(overrides.kind ?? "phase", title, {
    key: `redteam:${scanId}:phase:${phaseId}`,
    source: "redteam",
    scanId,
    phaseId,
    groupKey: `redteam:${scanId}`,
    sequence,
    status,
    column: status === "completed" ? "output" : status === "queued" ? "plan" : "active",
    subtitle: `Redteam · ${scanId}`,
    ...overrides,
  });
}

function snapshot(cards: BoardCard[], feeds: BoardActivityFeed[] = []): BoardSnapshot {
  return {
    root: {
      threadId: "thr_root",
      title: "Root",
      status: "active",
      displayStatus: null,
      providerId: null,
      providerLabel: null,
      model: null,
      projectId: null,
      createdAt: 0,
      updatedAt: 0,
      goal: null,
      contextWindowUsedTokens: null,
      contextWindowTotalTokens: null,
    },
    counts: { running: 0, waiting: 0, queued: 0, completed: 0, failed: 0, interrupted: 0 },
    cards,
    activityFeeds: feeds,
    partial: false,
    fetchedAt: 0,
  };
}

describe("active statuses", () => {
  it("treats running, starting, and waiting as watchable; nothing else", () => {
    expect(isFocusActiveStatus("running")).toBe(true);
    expect(isFocusActiveStatus("starting")).toBe(true);
    expect(isFocusActiveStatus("waiting")).toBe(true);
    expect(isFocusActiveStatus("queued")).toBe(false);
    expect(isFocusActiveStatus("completed")).toBe(false);
    expect(isFocusActiveStatus("failed")).toBe(false);
    expect(isFocusActiveStatus("interrupted")).toBe(false);
    expect(isFocusActiveStatus("skipped")).toBe(false);
  });
});

describe("groupExecutions — the logical-execution grouping rule", () => {
  it("merges a Redteam scan's active phase and operation into one execution", () => {
    const groups = groupExecutions([
      redteamPhase("scan-1", "reconnaissance", "Reconnaissance", { status: "running" }),
      card("operation", "Read dispatcher.js", {
        key: "redteam:scan-1:op:9",
        source: "redteam",
        scanId: "scan-1",
        status: "running",
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it("keeps two concurrent Redteam scans separate", () => {
    const groups = groupExecutions([
      redteamPhase("scan-1", "reconnaissance", "Recon A", { status: "running" }),
      redteamPhase("scan-2", "reconnaissance", "Recon B", { status: "running" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("links a child thread to its running root via parentThreadId", () => {
    const groups = groupExecutions([
      card("thread", "Root", {
        key: "thread:thr_root",
        threadId: "thr_root",
        isRoot: true,
        status: "running",
        parentThreadId: null,
      }),
      card("thread", "Child", {
        key: "thread:thr_child",
        threadId: "thr_child",
        status: "running",
        parentThreadId: "thr_root",
      }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("does not link a child to an idle root", () => {
    const groups = groupExecutions([
      card("thread", "Root", { key: "thread:thr_root", threadId: "thr_root", isRoot: true, status: "completed" }),
      card("thread", "Child A", { key: "thread:thr_a", threadId: "thr_a", status: "running", parentThreadId: "thr_root" }),
      card("thread", "Child B", { key: "thread:thr_b", threadId: "thr_b", status: "running", parentThreadId: "thr_root" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("links plan steps and workflow agents to their active parent", () => {
    const groups = groupExecutions([
      card("thread", "Root", { key: "thread:thr_root", threadId: "thr_root", status: "running" }),
      card("plan-step", "Step 1", { key: "plan:1", parentKey: "thread:thr_root", status: "running", groupKey: "plan:thr_root", sequence: 0 }),
      card("workflow-agent", "Agent", { key: "agent:1", parentKey: "thread:thr_root", status: "running", groupKey: "workflow:thr_root:w1" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it("never merges BB and Redteam cards", () => {
    const groups = groupExecutions([
      card("thread", "Root", { key: "thread:thr_root", threadId: "thr_root", status: "running" }),
      redteamPhase("scan-1", "reconnaissance", "Recon", { status: "running" }),
    ]);
    expect(groups).toHaveLength(2);
  });
});

describe("buildFocusModel — mode selection", () => {
  it("returns null for an empty board", () => {
    expect(buildFocusModel(snapshot([]))).toBeNull();
  });

  it("returns null when nothing is active", () => {
    expect(
      buildFocusModel(
        snapshot([
          card("thread", "Root", { key: "thread:thr_root", status: "completed", isRoot: true }),
          card("delegation", "Old work", { key: "delegation:1", status: "completed" }),
        ]),
      ),
    ).toBeNull();
  });

  it("focuses a single running Redteam scan (phase + operation = one execution)", () => {
    const model = buildFocusModel(
      snapshot([
        redteamPhase("scan-1", "reconnaissance", "Reconnaissance", {
          status: "running",
          kind: "operation",
          activity: { text: "Reading src/dispatcher.js", at: 900, kind: "tool" },
        }),
        redteamPhase("scan-1", "code-review", "Code review", { status: "queued" }),
      ]),
    );
    expect(model).not.toBeNull();
    expect(model!.hero.key).toBe("redteam:scan-1:phase:reconnaissance");
    expect(model!.heroLabel).toBe("ACTIVE PHASE");
  });

  it("falls back to Kanban for two concurrent Redteam scans", () => {
    expect(
      buildFocusModel(
        snapshot([
          redteamPhase("scan-1", "reconnaissance", "Recon A", { status: "running" }),
          redteamPhase("scan-2", "web-testing", "Web B", { status: "running" }),
        ]),
      ),
    ).toBeNull();
  });

  it("focuses one running BB child agent with an idle root", () => {
    const model = buildFocusModel(
      snapshot([
        card("thread", "Root", { key: "thread:thr_root", threadId: "thr_root", isRoot: true, status: "completed" }),
        card("workflow-agent", "Auth agent", {
          key: "agent:1",
          status: "running",
          threadId: "thr_child",
          parentKey: "thread:thr_root",
          groupKey: "workflow:thr_root:w1",
          sequence: 0,
        }),
      ]),
    );
    expect(model).not.toBeNull();
    expect(model!.hero.kind).toBe("workflow-agent");
    expect(model!.heroLabel).toBe("ACTIVE AGENT");
  });

  it("falls back to Kanban for two independent running children", () => {
    expect(
      buildFocusModel(
        snapshot([
          card("thread", "Root", { key: "thread:thr_root", threadId: "thr_root", isRoot: true, status: "completed" }),
          card("workflow-agent", "Agent A", { key: "agent:1", status: "running", parentKey: "thread:thr_root" }),
          card("workflow-agent", "Agent B", { key: "agent:2", status: "running", parentKey: "thread:thr_root" }),
        ]),
      ),
    ).toBeNull();
  });

  it("focuses root + child linked by parentThreadId (one delegation chain)", () => {
    const model = buildFocusModel(
      snapshot([
        card("thread", "Root", {
          key: "thread:thr_root",
          threadId: "thr_root",
          isRoot: true,
          status: "running",
          activity: { text: "Delegating to child", at: 800, kind: "delegation" },
        }),
        card("thread", "Child", {
          key: "thread:thr_child",
          threadId: "thr_child",
          status: "running",
          depth: 1,
          parentThreadId: "thr_root",
          activity: { text: "Editing auth.ts", at: 900, kind: "file-change" },
        }),
      ]),
    );
    expect(model).not.toBeNull();
    // Deeper card wins the hero role; the root stays visible as a peer.
    expect(model!.hero.key).toBe("thread:thr_child");
    expect(model!.peers.map((peer) => peer.key)).toEqual(["thread:thr_root"]);
  });

  it("treats root + unlinked child as two executions (Kanban)", () => {
    expect(
      buildFocusModel(
        snapshot([
          card("thread", "Root", { key: "thread:thr_root", threadId: "thr_root", isRoot: true, status: "running" }),
          card("thread", "Child", { key: "thread:thr_child", threadId: "thr_child", status: "running", depth: 1 }),
        ]),
      ),
    ).toBeNull();
  });

  it("focuses a running workflow agent owned by the active root", () => {
    const model = buildFocusModel(
      snapshot([
        card("thread", "Root", { key: "thread:thr_root", threadId: "thr_root", isRoot: true, status: "running" }),
        card("workflow-agent", "Agent", {
          key: "agent:1",
          parentKey: "thread:thr_root",
          status: "running",
          groupKey: "workflow:thr_root:w1",
          sequence: 1,
          activity: { text: "Reading config", at: 950, kind: "file-read" },
        }),
      ]),
    );
    expect(model).not.toBeNull();
    expect(model!.hero.kind).toBe("workflow-agent");
    expect(model!.peers.map((peer) => peer.key)).toEqual(["thread:thr_root"]);
  });

  it("focuses an active Redteam scan next to a completed BB root", () => {
    const model = buildFocusModel(
      snapshot([
        card("thread", "Root", { key: "thread:thr_root", threadId: "thr_root", isRoot: true, status: "completed" }),
        redteamPhase("scan-1", "code-review", "Code review", { status: "running" }),
      ]),
    );
    expect(model).not.toBeNull();
    expect(model!.hero.key).toBe("redteam:scan-1:phase:code-review");
    // The idle root is outside the execution.
    expect(model!.other.map((other) => other.key)).toEqual(["thread:thr_root"]);
  });

  it("falls back to Kanban for an active Redteam scan plus an active BB child", () => {
    expect(
      buildFocusModel(
        snapshot([
          card("thread", "Root", { key: "thread:thr_root", threadId: "thr_root", isRoot: true, status: "completed" }),
          card("thread", "Child", { key: "thread:thr_child", threadId: "thr_child", status: "running", parentThreadId: "thr_root" }),
          redteamPhase("scan-1", "code-review", "Code review", { status: "running" }),
        ]),
      ),
    ).toBeNull();
  });

  it("focuses a waiting BB thread (approval pending is still watchable)", () => {
    const model = buildFocusModel(
      snapshot([
        card("thread", "Root", {
          key: "thread:thr_root",
          threadId: "thr_root",
          isRoot: true,
          status: "waiting",
          waitingOn: "Waiting for approval",
        }),
      ]),
    );
    expect(model).not.toBeNull();
    expect(model!.hero.key).toBe("thread:thr_root");
  });

  it("does not crown a lone active plan step as an execution", () => {
    expect(
      buildFocusModel(
        snapshot([
          card("plan-step", "Step", { key: "plan:1", status: "running", parentKey: "thread:thr_root", groupKey: "plan:thr_root", sequence: 0 }),
        ]),
      ),
    ).toBeNull();
  });
});

describe("buildFocusModel — hero selection", () => {
  it("prefers the running phase over idle queued phases of the same scan", () => {
    const model = buildFocusModel(
      snapshot([
        redteamPhase("scan-1", "reconnaissance", "Reconnaissance", { status: "completed" }),
        redteamPhase("scan-1", "code-review", "Code review", { status: "running" }),
        redteamPhase("scan-1", "verification", "Verification", { status: "queued" }),
      ]),
    );
    expect(model!.hero.key).toBe("redteam:scan-1:phase:code-review");
  });

  it("breaks same-depth ties by latest activity, stably", () => {
    const model = buildFocusModel(
      snapshot([
        card("thread", "Root", { key: "thread:thr_root", threadId: "thr_root", isRoot: true, status: "running" }),
        card("workflow-agent", "Agent A", {
          key: "agent:a",
          parentKey: "thread:thr_root",
          status: "running",
          groupKey: "workflow:thr_root:w1",
          sequence: 0,
          activity: { text: "Old work", at: 100, kind: "tool" },
        }),
        card("workflow-agent", "Agent B", {
          key: "agent:b",
          parentKey: "thread:thr_root",
          status: "running",
          groupKey: "workflow:thr_root:w1",
          sequence: 1,
          activity: { text: "New work", at: 900, kind: "tool" },
        }),
      ]),
    );
    expect(model!.hero.key).toBe("agent:b");
  });

  it("keeps hero identity stable across routine activity updates", () => {
    const makeCard = (at: number, text: string): BoardCard =>
      redteamPhase("scan-1", "web-testing", "Web testing", {
        status: "running",
        activity: { text, at, kind: "tool" },
      });
    const first = buildFocusModel(snapshot([makeCard(900, "Probing /login")]));
    const second = buildFocusModel(snapshot([makeCard(950, "Probing /admin")]));
    expect(second!.hero.key).toBe(first!.hero.key);
  });
});

describe("buildFocusModel — pipeline", () => {
  it("derives Redteam phases in canonical order with truthful states", () => {
    const model = buildFocusModel(
      snapshot([
        redteamPhase("scan-1", "reconnaissance", "Reconnaissance", { status: "completed", durationMs: 38_000, outputPreview: "3 entry points" }),
        redteamPhase("scan-1", "code-review", "Code review", { status: "running" }),
        redteamPhase("scan-1", "web-testing", "Web testing", { status: "queued", waitingOn: "Waiting for earlier Redteam phases" }),
        redteamPhase("scan-1", "reporting", "Reporting", { status: "queued" }),
      ]),
    );
    expect(model!.pipeline).not.toBeNull();
    expect(model!.pipeline!.map((node) => node.title)).toEqual([
      "Reconnaissance",
      "Code review",
      "Web testing",
      "Reporting",
    ]);
    expect(model!.pipeline!.map((node) => node.state)).toEqual([
      "completed",
      "active",
      "pending",
      "pending",
    ]);
    // State-only, never a fabricated percentage.
    const states = new Set(model!.pipeline!.map((node) => node.state));
    for (const state of states) {
      expect(["completed", "active", "pending", "failed", "interrupted", "skipped"]).toContain(state);
    }
  });

  it("derives the pipeline from a BB thread's plan steps, ordered by sequence", () => {
    const model = buildFocusModel(
      snapshot([
        card("thread", "Root", { key: "thread:thr_root", threadId: "thr_root", isRoot: true, status: "running" }),
        card("plan-step", "Write tests", {
          key: "plan:1",
          parentKey: "thread:thr_root",
          status: "completed",
          groupKey: "plan:thr_root",
          sequence: 1,
        }),
        card("plan-step", "Ship it", {
          key: "plan:2",
          parentKey: "thread:thr_root",
          status: "queued",
          groupKey: "plan:thr_root",
          sequence: 2,
          waitingOn: "Not started",
        }),
        card("plan-step", "Plan A", {
          key: "plan:0",
          parentKey: "thread:thr_root",
          status: "running",
          groupKey: "plan:thr_root",
          sequence: 0,
        }),
      ]),
    );
    expect(model!.pipeline!.map((node) => node.title)).toEqual(["Plan A", "Write tests", "Ship it"]);
    expect(model!.pipeline!.map((node) => node.state)).toEqual(["active", "completed", "pending"]);
  });

  it("derives the pipeline from a workflow's agents for a workflow-agent hero", () => {
    const model = buildFocusModel(
      snapshot([
        card("workflow-agent", "Agent B", {
          key: "agent:2",
          parentKey: "thread:thr_root",
          status: "running",
          groupKey: "workflow:thr_root:w1",
          sequence: 1,
          activity: { text: "Working", at: 900, kind: "tool" },
        }),
        card("workflow-agent", "Agent A", {
          key: "agent:1",
          parentKey: "thread:thr_root",
          status: "completed",
          groupKey: "workflow:thr_root:w1",
          sequence: 0,
        }),
        card("workflow-agent", "Other flow agent", {
          key: "agent:9",
          parentKey: "thread:thr_root",
          status: "running",
          groupKey: "workflow:thr_root:w2",
          sequence: 0,
        }),
      ]),
    );
    // Two independent running agents → Kanban.
    expect(model).toBeNull();
  });

  it("keeps a single-node step list off the pipeline", () => {
    const model = buildFocusModel(
      snapshot([
        redteamPhase("scan-1", "reconnaissance", "Reconnaissance", { status: "running" }),
      ]),
    );
    expect(model!.pipeline).toBeNull();
  });

  it("omits the pipeline when a thread hero has no truthful step list", () => {
    const model = buildFocusModel(
      snapshot([
        card("thread", "Root", { key: "thread:thr_root", threadId: "thr_root", isRoot: true, status: "running" }),
      ]),
    );
    expect(model!.pipeline).toBeNull();
  });

  it("does not mix two workflows' agents into one pipeline", () => {
    const model = buildFocusModel(
      snapshot([
        card("thread", "Root", { key: "thread:thr_root", threadId: "thr_root", isRoot: true, status: "running" }),
        card("workflow-agent", "Flow A running", {
          key: "agent:1",
          parentKey: "thread:thr_root",
          status: "running",
          groupKey: "workflow:thr_root:w1",
          sequence: 0,
          activity: { text: "Working", at: 900, kind: "tool" },
        }),
        card("workflow-agent", "Flow A done", {
          key: "agent:2",
          parentKey: "thread:thr_root",
          status: "completed",
          groupKey: "workflow:thr_root:w1",
          sequence: 1,
        }),
        card("workflow-agent", "Flow B agent", {
          key: "agent:9",
          parentKey: "thread:thr_root",
          status: "queued",
          groupKey: "workflow:thr_root:w2",
          sequence: 0,
        }),
      ]),
    );
    expect(model!.hero.kind).toBe("workflow-agent");
    // Only the hero's own workflow is the pipeline — never mixed with w2.
    expect(model!.pipeline!.map((node) => node.key)).toEqual(["agent:1", "agent:2"]);
  });
});

describe("buildFocusModel — recent activity", () => {
  it("binds the hero's execution feed (Redteam scan)", () => {
    const model = buildFocusModel(
      snapshot(
        [redteamPhase("scan-1", "code-review", "Code review", { status: "running" })],
        [
          {
            key: "redteam:scan-1",
            entries: [
              { id: "op-2", label: "read_file", detail: "src/dispatcher.js", at: 900, kind: "tool" },
              { id: "op-1", label: "model", detail: "Analyzing", at: 800, kind: "inference" },
            ],
          },
          { key: "thread:thr_root", entries: [{ id: "r-1", label: "read", detail: "other feed", at: 700, kind: "file-read" }] },
        ],
      ),
    );
    expect(model!.recent.map((entry) => entry.id)).toEqual(["op-2", "op-1"]);
    expect(model!.latestOperation).not.toBeNull();
    expect(model!.latestOperation!.label).toBe("read_file");
    expect(model!.latestOperation!.detail).toBe("src/dispatcher.js");
  });

  it("binds the hero's execution feed (BB thread)", () => {
    const model = buildFocusModel(
      snapshot(
        [
          card("thread", "Root", { key: "thread:thr_root", threadId: "thr_root", isRoot: true, status: "running" }),
        ],
        [
          {
            key: "thread:thr_root",
            entries: [{ id: "r-1", label: "edit", detail: "src/auth.ts", at: 900, kind: "file-change" }],
          },
        ],
      ),
    );
    expect(model!.recent.map((entry) => entry.detail)).toEqual(["src/auth.ts"]);
  });

  it("returns an empty tail when no feed exists for the execution", () => {
    const model = buildFocusModel(
      snapshot([card("thread", "Root", { key: "thread:thr_root", threadId: "thr_root", isRoot: true, status: "running" })]),
    );
    expect(model!.recent).toEqual([]);
    expect(model!.latestOperation).toBeNull();
  });

  it("bounds the tail to six entries, newest first", () => {
    // The contract defines feeds newest-first; the model trusts that bound.
    const entries = Array.from({ length: 9 }, (_, index) => ({
      id: `e-${8 - index}`,
      label: "tool",
      detail: `work ${8 - index}`,
      at: (8 - index) * 10,
      kind: "tool",
    }));
    const model = buildFocusModel(
      snapshot(
        [card("thread", "Root", { key: "thread:thr_root", threadId: "thr_root", isRoot: true, status: "running" })],
        [{ key: "thread:thr_root", entries }],
      ),
    );
    expect(model!.recent).toHaveLength(6);
    expect(model!.recent.map((entry) => entry.id)).toEqual([
      "e-8",
      "e-7",
      "e-6",
      "e-5",
      "e-4",
      "e-3",
    ]);
  });
});

describe("buildFocusModel — completed and up-next sections", () => {
  it("shows completed phases with duration and summary", () => {
    const model = buildFocusModel(
      snapshot([
        redteamPhase("scan-1", "reconnaissance", "Reconnaissance", {
          status: "completed",
          durationMs: 38_000,
          outputPreview: "3 entry points; 1 web app",
        }),
        redteamPhase("scan-1", "code-review", "Code review", { status: "running" }),
      ]),
    );
    expect(model!.completed).toHaveLength(1);
    expect(model!.completed[0]!.title).toBe("Reconnaissance");
    expect(model!.completed[0]!.durationMs).toBe(38_000);
    expect(model!.completed[0]!.summary).toBe("3 entry points; 1 web app");
  });

  it("keeps failed work visible in completed rows with its error", () => {
    const model = buildFocusModel(
      snapshot([
        redteamPhase("scan-1", "reconnaissance", "Reconnaissance", { status: "completed" }),
        redteamPhase("scan-1", "web-testing", "Web testing", {
          status: "failed",
          errorPreview: "Target unreachable",
          durationMs: 5_000,
        }),
        redteamPhase("scan-1", "code-review", "Code review", { status: "running" }),
      ]),
    );
    const failed = model!.completed.find((row) => row.status === "failed");
    expect(failed).toBeDefined();
    expect(failed!.title).toBe("Web testing");
    expect(failed!.error).toBe("Target unreachable");
  });

  it("lists queued phases as up-next with their waiting reasons", () => {
    const model = buildFocusModel(
      snapshot([
        redteamPhase("scan-1", "reconnaissance", "Reconnaissance", { status: "completed" }),
        redteamPhase("scan-1", "code-review", "Code review", { status: "running" }),
        redteamPhase("scan-1", "web-testing", "Web testing", {
          status: "queued",
          waitingOn: "Waiting for earlier Redteam phases",
        }),
      ]),
    );
    expect(model!.upNext.map((row) => row.title)).toEqual(["Web testing"]);
    expect(model!.upNext[0]!.waitingOn).toBe("Waiting for earlier Redteam phases");
  });

  it("includes the owning root's finished delegations as completed work", () => {
    const model = buildFocusModel(
      snapshot([
        card("thread", "Root", { key: "thread:thr_root", threadId: "thr_root", isRoot: true, status: "running" }),
        card("delegation", "Fix flaky test", {
          key: "delegation:1",
          parentKey: "thread:thr_root",
          status: "completed",
          threadId: "thr_child",
          durationMs: 5_000,
          outputPreview: "All 12 tests pass.",
        }),
        card("queued-message", "Run tests", {
          key: "queued:1",
          parentKey: "thread:thr_root",
          status: "queued",
          waitingOn: "Waiting for busy thread",
        }),
      ]),
    );
    expect(model!.completed.map((row) => row.title)).toContain("Fix flaky test");
    expect(model!.upNext.map((row) => row.title)).toContain("Run tests");
  });
});

describe("buildFocusModel — other cards", () => {
  it("places cards outside the execution under other, never duplicated", () => {
    const model = buildFocusModel(
      snapshot([
        redteamPhase("scan-1", "code-review", "Code review", { status: "running" }),
        card("thread", "Root", { key: "thread:thr_root", threadId: "thr_root", isRoot: true, status: "completed" }),
        card("delegation", "Old task", { key: "delegation:old", parentKey: "thread:thr_root", status: "completed" }),
      ]),
    );
    const keys = [model!.hero.key, ...model!.peers.map((c) => c.key), ...model!.other.map((c) => c.key)];
    expect(new Set(keys).size).toBe(keys.length);
    expect(model!.other.map((c) => c.key)).toEqual(["thread:thr_root", "delegation:old"]);
  });

  it("flags failed/interrupted cards outside the execution for attention", () => {
    const model = buildFocusModel(
      snapshot([
        redteamPhase("scan-1", "code-review", "Code review", { status: "running" }),
        redteamPhase("scan-2", "web-testing", "Web testing", { status: "failed", errorPreview: "boom" }),
      ]),
    );
    expect(model!.otherAttention.map((c) => c.key)).toEqual(["redteam:scan-2:phase:web-testing"]);
  });

  it("keeps supporting cards out of other (no double accounting)", () => {
    const model = buildFocusModel(
      snapshot([
        redteamPhase("scan-1", "reconnaissance", "Reconnaissance", { status: "completed" }),
        redteamPhase("scan-1", "code-review", "Code review", { status: "running" }),
        redteamPhase("scan-2", "web-testing", "Web testing", { status: "queued" }),
      ]),
    );
    expect(model!.other.map((c) => c.key)).toEqual(["redteam:scan-2:phase:web-testing"]);
    expect(model!.completed.map((row) => row.key)).toEqual(["redteam:scan-1:phase:reconnaissance"]);
  });
});

describe("hero labels", () => {
  it("labels each hero kind truthfully", () => {
    expect(heroLabelFor("thread")).toBe("CURRENT EXECUTION");
    expect(heroLabelFor("workflow-agent")).toBe("ACTIVE AGENT");
    expect(heroLabelFor("phase")).toBe("ACTIVE PHASE");
    expect(heroLabelFor("operation")).toBe("ACTIVE PHASE");
    expect(heroLabelFor("delegation")).toBe("DELEGATED TASK");
  });
});