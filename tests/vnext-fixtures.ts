import type { BoardCard, GlobalExecution, GlobalDashboardSnapshot } from "../contract/rpc";
export function phaseCard(overrides: Partial<BoardCard> = {}): BoardCard {
  return { key: "card", parentKey: null, depth: 0, kind: "thread", source: "bb", title: "Synthetic task", subtitle: null,
    status: "running", column: "active", threadId: "thread", providerId: "codex", providerLabel: "Codex", model: null,
    startedAt: 100, completedAt: null, durationMs: null, phaseTitle: null, promptPreview: null, activity: null,
    outputPreview: null, errorPreview: null, tokens: null, toolCalls: null, waitingOn: null, attention: null, planStatus: null, isRoot: false, ...overrides };
}
export function phaseExecution(key: string, overrides: Partial<GlobalExecution> = {}): GlobalExecution {
  return { key, card: phaseCard({ key: `card:${key}`, title: key }), projectId: "proj-a", projectName: "Project A", repository: "github.com/example/a", childCount: 0, activeChildCount: 0, updatedAt: 1000, ...overrides };
}
export function phaseSnapshot(overrides: Partial<GlobalDashboardSnapshot> = {}): GlobalDashboardSnapshot {
  return { active: [phaseExecution("Task A")], recent: [], attention: [], counts: { active: 1, waiting: 0, attention: 0, recent: 0, failures: 0 }, unavailableSources: [], dismissedCount: 0, partial: false, fetchedAt: 1000, ...overrides };
}
