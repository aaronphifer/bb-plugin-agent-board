import { describe, it, expect } from "vitest";
import { activityFreshness, EMPTY_FILTERS, filterDashboard, filterOptions, matchesFilters, groupExecutions, completionSummary, reportedCompletion } from "../lib/dashboard-view";
import { buildGlobalExecution } from "../lib/global-model";
import { safeRepositoryLabel } from "../lib/collect";
import { phaseCard as card, phaseExecution as execution, phaseSnapshot as snapshot } from "./vnext-fixtures";

describe("activity freshness without lifecycle inference", () => {
  it("treats missing/invalid activity time as unknown", () => {
    for (const at of [null, NaN, -1, 1_000_000]) expect(activityFreshness(card({ lastActivityAt: at }), 500).state).toBe("unknown");
  });
  it("uses observation time rather than updatedAt or fetch time", () => {
    const e = execution("task", { updatedAt: 500_000, card: card({ activity: { at: 100, text: "Long build", kind: "tool" } }) });
    expect(activityFreshness(e.card, 130_000).state).toBe("quiet");
    expect(e.card.status).toBe("running");
  });
  it("returns to recent reporting on new activity and clamps small clock skew", () => {
    expect(activityFreshness(card({ lastActivityAt: 1000 }), 1200).state).toBe("recent");
    expect(activityFreshness(card({ lastActivityAt: 1000 }), 900).ageMs).toBe(0);
  });
  it("includes child and delegated worker observations in a logical execution", () => {
    const e = buildGlobalExecution({ key: "x", source: "bb", title: "x", threadId: "x", projectId: null, updatedAt: 99_999, cards: [card({ lastActivityAt: 10 })], delegatedWorkers: [card({ source: "ollama-fleet", lastActivityAt: 900 })] });
    expect(e.card.lastActivityAt).toBe(900);
  });
});
describe("bounded filtering and grouping", () => {
  const a = execution("a");
  const b = execution("b", { projectId: "proj-b", projectName: "Project A", repository: null, card: card({ providerId: "grok", providerLabel: "Grok", status: "waiting" }) });
  it("combines filters by identity, even with duplicate project labels", () => {
    expect(matchesFilters(a, { ...EMPTY_FILTERS, project: "value:proj-a", provider: "value:codex" })).toBe(true);
    expect(matchesFilters(b, { ...EMPTY_FILTERS, project: "value:proj-a" })).toBe(false);
  });
  it("supports missing project, repository and provider metadata", () => {
    const unknown = execution("u", { projectId: null, projectName: null, repository: null, card: card({ providerId: null, providerLabel: null }) });
    expect(matchesFilters(unknown, { ...EMPTY_FILTERS, project: "unknown", repository: "unknown", provider: "unknown" })).toBe(true);
    expect(filterOptions([unknown], "repository")).toEqual([{ value: "unknown", label: "Unknown repository" }]);
  });
  it("filters active and recent while retaining snapshot counts and attention", () => {
    const source = snapshot({ active: [a, b], recent: [a] });
    const result = filterDashboard(source, { ...EMPTY_FILTERS, provider: "value:grok", status: "value:waiting" });
    expect(result.active).toEqual([b]); expect(result.recent).toEqual([]); expect(source.active).toHaveLength(2);
  });
  it("groups stably without merging same-name projects or altering order inside a group", () => {
    const groups = groupExecutions([a, b, { ...a, key: "a2" }], "project");
    expect(groups).toHaveLength(2); expect(groups.find(g => g.key === "value:proj-a")!.executions.map(e => e.key)).toEqual(["a", "a2"]);
    expect(groupExecutions([a, b], "none")[0]!.executions).toEqual([a, b]);
  });
});
describe("completion provenance and repository privacy", () => {
  it("omits absent completion metadata on legacy adapters and preserves their preview fallback", () => {
    const e = buildGlobalExecution({ key: "legacy", source: "bb", title: "legacy", threadId: "legacy", projectId: null, updatedAt: 1, cards: [card({ outputPreview: "Tests: not run", status: "completed" })] });
    expect(Object.hasOwn(e.card, "reportedVerification")).toBe(false);
    expect(completionSummary(e.card).reportedChecks).toEqual(["not run"]);
  });
  it("bounds and redacts explicit completion fields without treating prose as checks", () => {
    const fields = reportedCompletion("x".repeat(20_000) + "\n**Result:** password=synthetic-secret " + "r".repeat(300) + "\n" + "Tests: agent reported only\n".repeat(10));
    expect(fields.completionResult!.length).toBeLessThanOrEqual(240);
    expect(fields.completionResult).not.toContain("synthetic-secret");
    expect(fields.reportedVerification).toHaveLength(4);
  });
  it("uses bounded verification retained before source-output truncation", () => {
    const result = completionSummary(card({ outputPreview: "A long review was truncated…", reportedVerification: ["not run (review only)"], completionResult: "Boundary review completed" }));
    expect(result.reportedChecks).toEqual(["not run (review only)"]); expect(result.result).toBe("Boundary review completed");
  });
  it("preserves preview/failure and extracts only explicitly labeled reported checks", () => {
    const text = "Result: new UI\nTests: 20 passed\nVerification: manual check pending";
    const result = completionSummary(card({ status: "failed", outputPreview: text, errorPreview: "Build failed" }));
    expect(result.originalPreview).toBe(text); expect(result.failure).toBe("Build failed"); expect(result.reportedChecks).toEqual(["20 passed", "manual check pending"]);
  });
  it("never infers verification from success wording", () => {
    expect(completionSummary(card({ status: "completed", outputPreview: "Everything passed and is verified" })).reportedChecks).toEqual([]);
    expect(completionSummary(card()).result).toContain("No result summary");
  });
  it("strips remote credentials, query strings and fragments", () => {
    expect(safeRepositoryLabel("https://user:secret@github.com/example/a.git?token=secret#private")).toBe("github.com/example/a");
    expect(safeRepositoryLabel("git@github.com:example/a.git")).toBe("github.com/example/a");
    expect(safeRepositoryLabel("file:///private/repo")).toBeNull(); expect(safeRepositoryLabel(null)).toBeNull();
  });
});
