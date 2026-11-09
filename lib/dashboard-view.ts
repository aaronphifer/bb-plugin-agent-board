import type { BoardCard, GlobalExecution, GlobalDashboardSnapshot } from "../contract/rpc";
import { previewText, redactOperationalText } from "./board-model";

export function resultLinks(text: string | null | undefined): { label: string; url: string }[] {
  const links: { label: string; url: string }[] = [];
  for (const match of (text?.slice(-16_384) ?? "").matchAll(/\[([^\]\n]{1,80})\]\((https:\/\/[^\s)]+)\)/g)) {
    try {
      const url = new URL(match[2]!);
      const credentialName = /^(?:api[-_]?key|access[-_]?token|auth[-_]?token|password|passwd|secret|token|key|authorization|signature|sig|x-amz-signature|x-amz-credential)$/i;
      if (url.username || url.password || url.href.length > 500 || [...url.searchParams.keys()].some(key => credentialName.test(key))) continue;
      if (!links.some(link => link.url === url.href)) links.push({ label: redactOperationalText(match[1]!), url: url.href });
      if (links.length === 4) break;
    } catch { /* Not an actionable URL. */ }
  }
  return links;
}

export const QUIET_ACTIVITY_MS = 120_000;
export function activityFreshness(card: BoardCard, now: number) {
  const at = card.lastActivityAt ?? card.activity?.at ?? null;
  if (at === null || !Number.isFinite(at) || at < 0 || at > now + 5_000) return { state: "unknown" as const, at: null, ageMs: null };
  const ageMs = Math.max(0, now - at);
  return { state: ageMs >= QUIET_ACTIVITY_MS ? "quiet" as const : "recent" as const, at, ageMs };
}

export type FilterField = "project" | "repository" | "workspace" | "provider" | "status";
export type DashboardFilters = Record<FilterField, string>;
export const EMPTY_FILTERS: DashboardFilters = { project: "", repository: "", workspace: "", provider: "", status: "" };
// Separate sentinels prevent a real ID/remote from colliding with Unknown.
export function filterValue(execution: GlobalExecution, field: FilterField): string {
  const value = field === "project" ? execution.projectId : field === "repository" ? execution.repository : field === "workspace" ? execution.workspaceId : field === "provider" ? execution.card.providerId : execution.card.status;
  return value ? `value:${value}` : "unknown";
}
export function filterLabel(execution: GlobalExecution, field: FilterField): string {
  if (field === "project") return execution.projectName ?? execution.projectId ?? "Unknown project";
  if (field === "repository") return execution.repository ?? "Unknown repository";
  if (field === "workspace") return execution.workspaceName ?? execution.workspaceId ?? "Unknown workspace";
  if (field === "provider") return execution.card.providerLabel ?? execution.card.providerId ?? "Unknown provider";
  return execution.card.status;
}
export function filterOptions(executions: readonly GlobalExecution[], field: FilterField) {
  const values = new Map<string, string>();
  for (const execution of executions) values.set(filterValue(execution, field), filterLabel(execution, field));
  return [...values].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}
export function matchesFilters(execution: GlobalExecution, filters: DashboardFilters): boolean {
  return (Object.keys(filters) as FilterField[]).every(field => !filters[field] || filters[field] === filterValue(execution, field));
}
export function filterDashboard(snapshot: GlobalDashboardSnapshot, filters: DashboardFilters) {
  return { active: snapshot.active.filter(e => matchesFilters(e, filters)), recent: snapshot.recent.filter(e => matchesFilters(e, filters)) };
}
export function groupExecutions(executions: readonly GlobalExecution[], field: FilterField | "none") {
  if (field === "none") return [{ key: "all", label: null, executions: [...executions] }];
  const groups = new Map<string, { key: string; label: string; executions: GlobalExecution[] }>();
  for (const execution of executions) {
    const key = filterValue(execution, field);
    const group = groups.get(key) ?? { key, label: filterLabel(execution, field), executions: [] };
    group.executions.push(execution); groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Parse explicit labels only. Output prose is a report, never test evidence. */
export function reportedCompletion(text: string | null | undefined) {
  // Only inspect a bounded tail; final result/check labels normally end a response.
  const tail = typeof text === "string" ? redactOperationalText(text.slice(-16_384)) : "";
  const labels = /(?:^|\s)(?:#{1,6}\s*)?(?:\*\*)?(result|verification|validation|tests(?: executed| run)?|checks)(?:\*\*)?\s*:(?:\*\*)?\s*([\s\S]*?)(?=\n|\s+(?:\*\*)?(?:result|verification|validation|tests(?: executed| run)?|checks)(?:\*\*)?\s*:|$)/gi;
  let completionResult: string | null = null;
  const reportedVerification: string[] = [];
  for (const match of tail.matchAll(labels)) {
    const value = previewText(match[2], 240);
    if (!value) continue;
    if (match[1]!.toLowerCase() === "result") completionResult = value;
    else if (reportedVerification.length < 4) reportedVerification.push(value);
  }
  return { completionResult, reportedVerification };
}

export function completionSummary(card: BoardCard) {
  const text = card.outputPreview?.trim() ?? "";
  const fallback = reportedCompletion(text);
  const reportedChecks = card.reportedVerification ?? fallback.reportedVerification;
  return {
    outcome: card.status,
    result: card.completionResult ?? fallback.completionResult ?? (text || "No result summary supplied by this source."),
    failure: card.errorPreview,
    reportedChecks,
    originalPreview: text,
  };
}
