import type { FleetJob, FleetSnapshot } from "../lib/fleet-source";
import type { BoardCard, BoardSnapshot } from "../contract/rpc";
import type { GlobalExecutionGroup } from "../lib/global-model";
export const NOW = Date.parse("2026-09-05T04:00:00.000Z");
export function job(overrides: Partial<FleetJob> = {}): FleetJob {
  return {
    jobId: "j1",
    revision: 2,
    state: "running",
    origin: { threadId: "parent", projectId: "p" },
    taskType: "coding",
    label: "Validation review A",
    actualModel: "qwen3-coder:30b",
    server: { id: "pc", name: "Desktop PC" },
    startedAt: new Date(NOW - 10000).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    finishedAt: null,
    durationMs: null,
    attemptCount: 1,
    latestActivity: "Generating response",
    errorPreview: null,
    ...overrides,
  };
}
export const wire = (jobs: FleetJob[] = []): FleetSnapshot => ({
  schemaVersion: 1,
  observedAt: new Date(NOW).toISOString(),
  truncated: false,
  jobs,
});
export function parent(overrides: Partial<BoardCard> = {}): BoardCard {
  return {
    key: "thread:parent",
    source: "bb",
    kind: "thread",
    title: "Parent work",
    subtitle: "BB",
    isRoot: true,
    threadId: "parent",
    parentKey: null,
    depth: 0,
    status: "running",
    column: "active",
    model: "parent-model",
    providerId: "pi",
    providerLabel: "Pi",
    startedAt: NOW - 15000,
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
    attention: null,
    ...overrides,
  };
}
export const group = (card = parent()): GlobalExecutionGroup => ({
  key: "bb:parent",
  source: "bb",
  title: "Parent work",
  threadId: "parent",
  projectId: "p",
  cards: [card],
  updatedAt: NOW,
});
export function scoped(cards: BoardCard[]): BoardSnapshot {
  return {
    root: {
      threadId: "parent",
      title: "Parent work",
      projectId: "p",
      status: "active",
      displayStatus: null,
      providerId: "pi",
      providerLabel: "Pi",
      model: "parent-model",
      createdAt: NOW - 15000,
      updatedAt: NOW,
      goal: null,
      contextWindowUsedTokens: null,
      contextWindowTotalTokens: null,
    },
    cards,
    counts: {
      running: cards.filter((c) => c.status === "running").length,
      queued: 0,
      waiting: 0,
      failed: 0,
      interrupted: 0,
      completed: 0,
    },
    partial: false,
    fetchedAt: NOW,
  };
}
