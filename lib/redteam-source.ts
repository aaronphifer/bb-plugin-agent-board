// Optional Redteam adapter. This module owns the public wire schema and is the
// only Agent Board code that knows the Redteam RPC shape. React sees only
// normalized BoardCards.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { BoardActivityFeed, BoardActivityFeedEntry, BoardCard, BoardCardStatus, ExecutionTimeline } from "../contract/rpc";
import { BOARD_LIMITS, columnForStatus, previewText, redactOperationalText } from "./board-model";
import type { GlobalExecutionGroup, GlobalSourceResult } from "./global-model";
import { finalizeTimeline, type TimelineCandidate } from "./timeline-model";

const phaseIdSchema = z.enum(["queued", "reconnaissance", "code-review", "web-testing", "verification", "reporting", "completed"]);
const phaseStateSchema = z.enum(["queued", "running", "completed", "failed", "cancelled", "skipped"]);
const operationStateSchema = z.enum(["starting", "running", "waiting", "completed", "failed", "cancelled"]);

/** Canonical execution order of the real Redteam phases (pipeline sequence). */
export const REDTEAM_PHASE_ORDER = [
  "reconnaissance",
  "code-review",
  "web-testing",
  "verification",
  "reporting",
] as const;

const wirePhaseSchema = z.object({
  id: phaseIdSchema,
  label: z.string().max(96),
  state: phaseStateSchema,
  startedAt: z.string().nullable().optional(), finishedAt: z.string().nullable().optional(), durationMs: z.number().int().nonnegative().nullable().optional(),
  summary: z.string().max(320).nullable().optional(), error: z.string().max(320).nullable().optional(),
});
const wireOperationSchema = z.object({
  id: z.string().max(200), kind: z.enum(["inference", "agent-loop", "tool"]), label: z.string().max(96),
  phaseId: phaseIdSchema, state: operationStateSchema, actualModel: z.string().max(120).nullable().optional(),
  task: z.string().max(240).nullable().optional(), latestActivity: z.string().max(240).nullable().optional(), toolName: z.string().max(80).nullable().optional(),
  target: z.string().max(240).nullable().optional(), startedAt: z.string(), updatedAt: z.string(), finishedAt: z.string().nullable().optional(),
  durationMs: z.number().int().nonnegative().nullable().optional(), outputPreview: z.string().max(240).nullable().optional(), error: z.string().max(320).nullable().optional(),
});
const countSchema = z.number().int().nonnegative();
const zeroCandidates = { total: 0, codeReview: 0, webTesting: 0 };
const zeroFindings = { total: 0, unverified: 0, confirmed: 0, inconclusive: 0, rejected: 0, severity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 } };
const wireScanSchema = z.object({
  scanId: z.string().max(200).optional(), projectId: z.string().max(200).optional(), title: z.string().max(160).optional(),
  mode: z.enum(["static", "passive-web", "active-web"]).optional(), status: z.enum(["queued", "running", "completed", "cancelled", "failed"]).optional(),
  startedAt: z.string().optional(), updatedAt: z.string().optional(), finishedAt: z.string().nullable().optional(), currentPhaseId: phaseIdSchema.nullable().optional(),
  failedPhaseId: phaseIdSchema.nullable().optional(), phases: z.array(wirePhaseSchema).max(BOARD_LIMITS.redteamMaxPhasesPerScan).default([]),
  operations: z.array(wireOperationSchema).max(BOARD_LIMITS.redteamMaxOperationsPerScan).default([]),
  candidateCounts: z.object({ total: countSchema, codeReview: countSchema, webTesting: countSchema }).default(zeroCandidates),
  findingCounts: z.object({ total: countSchema, unverified: countSchema, confirmed: countSchema, inconclusive: countSchema, rejected: countSchema,
    severity: z.object({ critical: countSchema, high: countSchema, medium: countSchema, low: countSchema, info: countSchema }), }).default(zeroFindings),
  error: z.string().max(320).nullable().optional(),
});

export const redteamObservabilityWireSchema = z.object({
  schemaVersion: z.literal(1), observedAt: z.string(), scans: z.array(wireScanSchema).max(BOARD_LIMITS.redteamMaxScans),
});
type RedteamWireSnapshot = z.infer<typeof redteamObservabilityWireSchema>;
type RedteamWireScan = RedteamWireSnapshot["scans"][number];
type RedteamWirePhase = RedteamWireScan["phases"][number];
type RedteamWireOperation = RedteamWireScan["operations"][number];

export interface RedteamBoardResult { cards: BoardCard[]; active: boolean; partial: boolean; fingerprint: string | null; activityFeeds: BoardActivityFeed[]; }
interface CacheEntry { at: number; snapshot: RedteamWireSnapshot; }
const REDTEAM_PLUGIN_ID = "redteam";
const SNAPSHOT_METHOD = "observability_snapshot";
const TTL_MS = 1_500;

function epoch(value: string | null | undefined): number | null {
  if (!value) return null; const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null;
}

function timelineText(value: string | null | undefined, max: number): string | null {
  return typeof value === "string" ? previewText(redactOperationalText(value), max) : null;
}

function operationStatus(operation: RedteamWireOperation): TimelineCandidate["status"] {
  if (operation.state === "completed") return "completed";
  if (operation.state === "failed") return "failed";
  if (operation.state === "cancelled") return "interrupted";
  if (operation.state === "waiting") return "waiting";
  return "running";
}

/** Public Redteam snapshot → generic bounded timeline; React never sees this DTO. */
export function normalizeRedteamTimeline(
  snapshot: RedteamWireSnapshot,
  scanId: string,
  executionKey: string,
  limit: number = BOARD_LIMITS.executionTimelineDefaultEvents,
  fetchedAt = Date.now(),
): ExecutionTimeline | null {
  const scan = snapshot.scans.find((candidate) => candidate.scanId === scanId);
  if (!scan?.scanId || !scan.status) return null;
  const candidates: TimelineCandidate[] = [];
  const base = { executionKey, source: "redteam" as const, threadId: null };
  const scanStart = epoch(scan.startedAt);
  const scanFinish = epoch(scan.finishedAt);
  const scanSource = { sourceId: `scan:${scan.scanId}`, sequence: null };
  if (scanStart !== null) {
    candidates.push({
      ...base, id: `redteam:${scan.scanId}:scan:start`, fingerprint: `scan:${scan.scanId}:start`, sortSequence: 0,
      timestamp: scanStart, kind: "execution-start", status: "running", title: "Scan started",
      summary: timelineText(scan.title, BOARD_LIMITS.timelineSummaryChars), model: null, toolName: null,
      target: null, phase: null, durationMs: null, attentionType: null, sourceMetadata: scanSource,
    });
  }

  for (const phase of scan.phases) {
    if (phase.id === "queued" || phase.id === "completed" || phase.state === "queued" || phase.state === "skipped") continue;
    const startedAt = epoch(phase.startedAt);
    const finishedAt = epoch(phase.finishedAt);
    const sequence = REDTEAM_PHASE_ORDER.indexOf(phase.id as (typeof REDTEAM_PHASE_ORDER)[number]);
    const sourceMetadata = { sourceId: `phase:${phase.id}`, sequence: sequence < 0 ? null : sequence };
    if (startedAt !== null) {
      candidates.push({
        ...base, id: `redteam:${scan.scanId}:phase:${phase.id}:start`, fingerprint: `phase:${phase.id}:start`, sortSequence: sequence < 0 ? 10 : 10 + sequence,
        timestamp: startedAt, kind: "phase-start", status: "running", title: `${phase.label} started`,
        summary: null, model: null, toolName: null, target: null, phase: phase.label,
        durationMs: null, attentionType: null, sourceMetadata,
      });
    }
    if (finishedAt !== null && (phase.state === "completed" || phase.state === "failed")) {
      const failed = phase.state === "failed";
      candidates.push({
        ...base, id: `redteam:${scan.scanId}:phase:${phase.id}:terminal`, fingerprint: `phase:${phase.id}:terminal`, sortSequence: sequence < 0 ? 20 : 20 + sequence,
        timestamp: finishedAt, kind: failed ? "phase-failed" : "phase-complete", status: failed ? "failed" : "completed",
        title: `${phase.label} ${failed ? "failed" : "completed"}`,
        summary: timelineText(failed ? (phase.error ?? scan.error) : phase.summary, BOARD_LIMITS.timelineSummaryChars),
        model: null, toolName: null, target: null, phase: phase.label,
        durationMs: phase.durationMs ?? (startedAt === null ? null : Math.max(0, finishedAt - startedAt)),
        attentionType: failed ? "failed" : null, sourceMetadata,
      });
    }
  }

  const seenModels = new Set<string>();
  scan.operations.forEach((operation, index) => {
    const startedAt = epoch(operation.startedAt);
    const updatedAt = epoch(operation.updatedAt);
    const finishedAt = epoch(operation.finishedAt);
    if (startedAt === null) return;
    const phase = scan.phases.find((candidate) => candidate.id === operation.phaseId)?.label ?? operation.phaseId.replace(/-/g, " ");
    const model = timelineText(operation.actualModel, 160);
    const sourceMetadata = { sourceId: `operation:${operation.id}`, sequence: index };
    if (model !== null && !seenModels.has(model)) {
      seenModels.add(model);
      candidates.push({
        ...base, id: `redteam:${scan.scanId}:operation:${operation.id}:model`, fingerprint: `model:${model}`, sortSequence: 100 + index,
        timestamp: startedAt, kind: "model-selected", status: "running", title: "Model selected",
        summary: null, model, toolName: null, target: null, phase, durationMs: null,
        attentionType: null, sourceMetadata,
      });
    }
    const toolName = timelineText(operation.toolName ?? operation.kind, 100);
    const target = timelineText(operation.target, BOARD_LIMITS.timelineTargetChars);
    candidates.push({
      ...base, id: `redteam:${scan.scanId}:operation:${operation.id}:start`, fingerprint: `operation:${operation.id}:start`, sortSequence: 110 + index,
      timestamp: startedAt, kind: "tool-start", status: "running", title: `${operation.label} started`,
      summary: timelineText(operation.task, BOARD_LIMITS.timelineSummaryChars), model: null, toolName,
      target, phase, durationMs: null, attentionType: null, sourceMetadata,
    });
    if (operation.state === "waiting" && updatedAt !== null) {
      candidates.push({
        ...base, id: `redteam:${scan.scanId}:operation:${operation.id}:waiting`, fingerprint: `operation:${operation.id}:waiting`, sortSequence: 120 + index,
        timestamp: updatedAt, kind: "waiting", status: "waiting", title: "Operation waiting",
        summary: timelineText(operation.latestActivity, BOARD_LIMITS.timelineSummaryChars), model: null, toolName,
        target, phase, durationMs: null, attentionType: "waiting", sourceMetadata,
      });
    }
    const status = operationStatus(operation);
    if (finishedAt !== null && (status === "completed" || status === "failed" || status === "interrupted")) {
      candidates.push({
        ...base, id: `redteam:${scan.scanId}:operation:${operation.id}:terminal`, fingerprint: `operation:${operation.id}:terminal`, sortSequence: 130 + index,
        timestamp: finishedAt, kind: status === "completed" ? "tool-complete" : "tool-failed", status,
        title: `${operation.label} ${status === "completed" ? "completed" : status === "failed" ? "failed" : "interrupted"}`,
        summary: timelineText(status === "failed" ? operation.error : operation.outputPreview, BOARD_LIMITS.timelineSummaryChars),
        model: null, toolName, target, phase,
        durationMs: operation.durationMs ?? Math.max(0, finishedAt - startedAt),
        attentionType: status === "failed" ? "failed" : status === "interrupted" ? "interrupted" : null,
        sourceMetadata,
      });
    }
  });

  if (scanFinish !== null && scan.status !== "running" && scan.status !== "queued") {
    const status = scan.status === "failed" ? "failed" : scan.status === "cancelled" ? "interrupted" : "completed";
    candidates.push({
      ...base, id: `redteam:${scan.scanId}:scan:terminal`, fingerprint: `scan:${scan.scanId}:terminal`, sortSequence: 1000,
      timestamp: scanFinish, kind: status === "failed" ? "execution-failed" : status === "interrupted" ? "execution-interrupted" : "execution-complete",
      status, title: status === "failed" ? "Scan failed" : status === "interrupted" ? "Scan interrupted" : "Scan finished",
      summary: timelineText(status === "failed" ? scan.error : countSummary(scan), BOARD_LIMITS.timelineSummaryChars),
      model: null, toolName: null, target: null, phase: null,
      durationMs: scanStart === null ? null : Math.max(0, scanFinish - scanStart),
      attentionType: status === "failed" ? "failed" : status === "interrupted" ? "interrupted" : null,
      sourceMetadata: scanSource,
    });
  }
  return finalizeTimeline(executionKey, "redteam", candidates, {
    active: scan.status === "running" || scan.status === "queued",
    limit,
    sourceWarning:
      scan.operations.length === 0 && scan.status !== "running" && scan.status !== "queued"
        ? "Historical tool activity was not retained; phase milestones are shown."
        : scan.operations.length >= BOARD_LIMITS.redteamMaxOperationsPerScan
          ? "Redteam exposes only its bounded recent operation window."
          : null,
    fetchedAt,
  });
}
function statusFor(phase: RedteamWirePhase): BoardCardStatus {
  if (phase.state === "cancelled") return "interrupted";
  if (phase.state === "skipped") return "skipped";
  return phase.state;
}
function countSummary(scan: RedteamWireScan): string | null {
  const parts: string[] = [];
  if (scan.candidateCounts.total > 0) parts.push(`${scan.candidateCounts.total} candidate${scan.candidateCounts.total === 1 ? "" : "s"}`);
  if (scan.findingCounts.confirmed > 0) parts.push(`${scan.findingCounts.confirmed} confirmed`);
  if (scan.findingCounts.inconclusive > 0) parts.push(`${scan.findingCounts.inconclusive} inconclusive`);
  if (scan.findingCounts.rejected > 0) parts.push(`${scan.findingCounts.rejected} rejected`);
  return parts.length ? parts.join(" · ") : null;
}

function activeOperation(scan: RedteamWireScan, phaseId: string) {
  return [...scan.operations].reverse().find((operation) => operation.phaseId === phaseId && (operation.state === "running" || operation.state === "starting"))
    ?? [...scan.operations].reverse().find((operation) => operation.phaseId === phaseId && operation.state === "waiting")
    ?? null;
}

function normalizePhase(scan: RedteamWireScan, phase: RedteamWirePhase): BoardCard | null {
  if (!scan.scanId || !scan.title || !scan.status || !scan.startedAt || phase.id === "queued" || phase.id === "completed" || phase.state === "skipped") return null;
  const operation = phase.state === "running" ? activeOperation(scan, phase.id) : null;
  const status = statusFor(phase); const startedAt = epoch(operation?.startedAt ?? phase.startedAt); const completedAt = epoch(operation?.finishedAt ?? phase.finishedAt);
  const summary = previewText(phase.summary, BOARD_LIMITS.outputPreviewChars);
  const aggregate = phase.id === "verification" || phase.id === "reporting" ? countSummary(scan) : null;
  const outputPreview = [summary, aggregate].filter(Boolean).join(" · ") || previewText(operation?.outputPreview, BOARD_LIMITS.outputPreviewChars);
  const latest = previewText(operation?.latestActivity ?? operation?.task, BOARD_LIMITS.activityChars);
  const error = previewText(operation?.error ?? phase.error ?? (phase.state === "failed" ? scan.error : null), BOARD_LIMITS.outputPreviewChars);
  const cardStatus: BoardCardStatus = operation?.state === "starting" ? "starting" : status;
  const sequence = REDTEAM_PHASE_ORDER.indexOf(phase.id as (typeof REDTEAM_PHASE_ORDER)[number]);
  return {
    key: `redteam:${scan.scanId}:phase:${phase.id}`, parentKey: null, depth: 0, kind: operation ? "operation" : "phase", source: "redteam",
    title: phase.label, subtitle: `Redteam · ${scan.title}`, status: cardStatus, column: columnForStatus(cardStatus, operation ? "operation" : "phase"), threadId: null,
    providerId: null, providerLabel: null, model: operation?.actualModel ?? null, startedAt, completedAt,
    durationMs: operation?.durationMs ?? phase.durationMs ?? null,
    phaseTitle: operation?.toolName ? `Tool: ${operation.toolName}` : null, promptPreview: operation ? previewText(operation.task, BOARD_LIMITS.promptPreviewChars) : null,
    activity: latest && epoch(operation?.updatedAt ?? scan.updatedAt) !== null ? { text: latest, at: epoch(operation?.updatedAt ?? scan.updatedAt)!, kind: operation?.kind ?? "phase" } : null,
    outputPreview: outputPreview || null, errorPreview: error, tokens: null, toolCalls: null,
    waitingOn: phase.state === "queued" ? "Waiting for earlier Redteam phases" : operation?.state === "waiting" ? "Waiting for the current tool" : null,
    attention:
      cardStatus === "failed"
        ? { type: "failed", message: error ?? `Scan failed during ${phase.label}` }
        : cardStatus === "interrupted"
          ? { type: "interrupted", message: `Scan interrupted during ${phase.label}` }
          : null,
    planStatus: null, isRoot: false, scanId: scan.scanId, phaseId: phase.id, ...(operation ? { operationId: operation.id } : {}),
    parentThreadId: null, groupKey: `redteam:${scan.scanId}`, sequence: sequence < 0 ? null : sequence,
  };
}

/** Bounded newest-first operation feed for one scan (current + recent ops). */
function scanActivityFeed(scan: RedteamWireScan): BoardActivityFeed | null {
  if (!scan.scanId) return null;
  const entries: BoardActivityFeedEntry[] = [];
  for (let index = scan.operations.length - 1; index >= 0 && entries.length < BOARD_LIMITS.feedEntriesPerExecution; index -= 1) {
    const operation = scan.operations[index]!;
    const at = epoch(operation.updatedAt ?? operation.finishedAt ?? operation.startedAt);
    if (at === null) continue;
    const label = operation.toolName ?? (operation.kind === "inference" ? "model" : operation.kind === "agent-loop" ? "agent" : operation.kind);
    entries.push({
      id: operation.id,
      label: previewText(label, 80) ?? operation.kind,
      detail: previewText(operation.target ?? operation.latestActivity ?? operation.task ?? operation.label, BOARD_LIMITS.activityChars),
      at,
      kind: operation.kind,
    });
  }
  return { key: `redteam:${scan.scanId}`, entries };
}

export function normalizeRedteamSnapshot(snapshot: RedteamWireSnapshot): RedteamBoardResult {
  const cards: BoardCard[] = []; let active = false;
  const activityFeeds: BoardActivityFeed[] = [];
  const activeScans = snapshot.scans.filter((scan) => scan.status === "running" || scan.status === "queued");
  const latestTerminal = snapshot.scans.find((scan) => scan.status !== "running" && scan.status !== "queued");
  const selectedScans = latestTerminal ? [...activeScans, latestTerminal] : activeScans;
  for (const scan of selectedScans) {
    if (scan.status === "running" || scan.status === "queued") active = true;
    for (const phase of scan.phases) {
      const card = normalizePhase(scan, phase); if (card && cards.length < BOARD_LIMITS.redteamMaxCards) cards.push(card);
    }
    const feed = scanActivityFeed(scan); if (feed) activityFeeds.push(feed);
  }
  // Runtime-only fields change every snapshot; excluding them prevents timer ticks from becoming invalidation storms.
  const stable = snapshot.scans.map((scan) => ({ ...scan, operations: scan.operations.map(({ durationMs: _duration, ...operation }) => operation), phases: scan.phases.map(({ durationMs: _duration, ...phase }) => phase) }));
  return { cards, active, partial: cards.length >= BOARD_LIMITS.redteamMaxCards, fingerprint: JSON.stringify(stable), activityFeeds };
}

export interface RedteamGlobalResult extends GlobalSourceResult {
  active: boolean;
  fingerprint: string | null;
}

function scanStatus(scan: RedteamWireScan): BoardCardStatus {
  if (scan.status === "running") return "running";
  if (scan.status === "queued") return "queued";
  if (scan.status === "failed") return "failed";
  if (scan.status === "cancelled") return "interrupted";
  return "completed";
}

/** A scan can be partial after reload; keep it globally observable without inventing a phase. */
function fallbackScanCard(scan: RedteamWireScan, observedAt: number): BoardCard | null {
  if (!scan.scanId || !scan.title || !scan.status) return null;
  const status = scanStatus(scan);
  const startedAt = epoch(scan.startedAt);
  const completedAt = epoch(scan.finishedAt);
  const error = previewText(scan.error, BOARD_LIMITS.outputPreviewChars);
  return {
    key: `redteam:${scan.scanId}:scan`, parentKey: null, depth: 0, kind: "phase", source: "redteam",
    title: scan.currentPhaseId ? scan.currentPhaseId.replace(/-/g, " ") : "Redteam scan",
    subtitle: `Redteam · ${scan.title}`, status, column: columnForStatus(status, "phase"), threadId: null,
    providerId: null, providerLabel: null, model: null, startedAt, completedAt,
    durationMs: startedAt !== null && completedAt !== null ? Math.max(0, completedAt - startedAt) : null,
    phaseTitle: null, promptPreview: null,
    activity: status === "running" ? { text: "Scan running", at: epoch(scan.updatedAt) ?? observedAt, kind: "scan" } : null,
    outputPreview: countSummary(scan), errorPreview: error, tokens: null, toolCalls: null,
    waitingOn: status === "queued" ? "Waiting to start" : null,
    attention:
      status === "failed"
        ? { type: "failed", message: error ?? "Redteam scan failed" }
        : status === "interrupted"
          ? { type: "interrupted", message: "Redteam scan was cancelled" }
          : null,
    planStatus: null, isRoot: false, parentThreadId: null, groupKey: `redteam:${scan.scanId}`,
    scanId: scan.scanId, ...(scan.currentPhaseId ? { phaseId: scan.currentPhaseId } : {}), sequence: null,
  };
}

function stableFingerprint(snapshot: RedteamWireSnapshot): string {
  const stable = snapshot.scans.map((scan) => ({
    ...scan,
    operations: scan.operations.map(({ durationMs: _duration, ...operation }) => operation),
    phases: scan.phases.map(({ durationMs: _duration, ...phase }) => phase),
  }));
  return JSON.stringify(stable);
}

/** All bounded scans as generic execution groups for the global dashboard. */
export function normalizeRedteamGlobalSnapshot(snapshot: RedteamWireSnapshot): RedteamGlobalResult {
  const observedAt = epoch(snapshot.observedAt) ?? Date.now();
  const groups: GlobalExecutionGroup[] = [];
  let active = false;
  for (const scan of snapshot.scans.slice(0, BOARD_LIMITS.redteamMaxScans)) {
    if (!scan.scanId || !scan.title || !scan.status) continue;
    if (scan.status === "running" || scan.status === "queued") active = true;
    const cards = scan.phases
      .map((phase) => normalizePhase(scan, phase))
      .filter((card): card is BoardCard => card !== null)
      .slice(0, BOARD_LIMITS.redteamMaxCards);
    if (cards.length === 0) {
      const fallback = fallbackScanCard(scan, observedAt);
      if (fallback) cards.push(fallback);
    }
    if (cards.length === 0) continue;
    groups.push({
      key: `redteam:${scan.scanId}`,
      source: "redteam",
      title: `Redteam — ${scan.title}`,
      threadId: null,
      projectId: scan.projectId ?? null,
      scanId: scan.scanId,
      cards,
      updatedAt: epoch(scan.updatedAt ?? scan.finishedAt ?? scan.startedAt) ?? observedAt,
    });
  }
  return {
    groups,
    active,
    partial: snapshot.scans.length >= BOARD_LIMITS.redteamMaxScans,
    available: true,
    fingerprint: stableFingerprint(snapshot),
  };
}

export class RedteamBoardSource {
  private readonly bb: BbPluginApi; private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>(); private readonly inflight = new Map<string, { promise: Promise<RedteamBoardResult>; generation: number }>(); private readonly last = new Map<string, RedteamBoardResult>();
  private globalCache: CacheEntry | null = null;
  private globalInflight: { promise: Promise<RedteamGlobalResult>; generation: number } | null = null;
  private globalLast: RedteamGlobalResult | null = null;
  private generation = 0;
  constructor(bb: BbPluginApi, now: () => number = () => Date.now()) { this.bb = bb; this.now = now; }

  async collect(projectId: string | null, options?: { fresh?: boolean }): Promise<RedteamBoardResult> {
    if (!projectId) return { cards: [], active: false, partial: false, fingerprint: null, activityFeeds: [] };
    const fresh = options?.fresh === true; const cached = this.cache.get(projectId);
    if (!fresh && cached && this.now() - cached.at < TTL_MS) return normalizeRedteamSnapshot(cached.snapshot);
    const generation = this.generation;
    const existing = this.inflight.get(projectId); if (existing?.generation === generation) return existing.promise;
    const request = this.load(projectId, generation).finally(() => {
      if (this.inflight.get(projectId)?.promise === request) this.inflight.delete(projectId);
    });
    this.inflight.set(projectId, { promise: request, generation }); return request;
  }

  private async load(projectId: string, generation: number): Promise<RedteamBoardResult> {
    try {
      const raw = await this.bb.sdk.plugins.callRpc({ pluginId: REDTEAM_PLUGIN_ID, method: SNAPSHOT_METHOD, input: { projectId, limit: BOARD_LIMITS.redteamMaxScans }, outputSchema: redteamObservabilityWireSchema });
      const snapshot = redteamObservabilityWireSchema.parse(raw);
      const result = normalizeRedteamSnapshot(snapshot);
      if (this.generation === generation) {
        this.cache.set(projectId, { at: this.now(), snapshot }); this.last.set(projectId, result);
      }
      return result;
    } catch {
      // Optional dependency: absent, disabled, old, malformed, or temporarily unavailable never breaks the BB source.
      return { cards: [], active: this.last.get(projectId)?.active ?? false, partial: false, fingerprint: this.last.get(projectId)?.fingerprint ?? null, activityFeeds: this.last.get(projectId)?.activityFeeds ?? [] };
    }
  }

  async poll(projectId: string): Promise<{ changed: boolean; active: boolean }> {
    const before = this.last.get(projectId); const after = await this.collect(projectId, { fresh: true });
    return { changed: before !== undefined && after.fingerprint !== null && before.fingerprint !== after.fingerprint, active: after.active };
  }

  async collectGlobal(options?: { fresh?: boolean }): Promise<RedteamGlobalResult> {
    const fresh = options?.fresh === true;
    if (!fresh && this.globalCache && this.now() - this.globalCache.at < TTL_MS) {
      return normalizeRedteamGlobalSnapshot(this.globalCache.snapshot);
    }
    const generation = this.generation;
    if (this.globalInflight?.generation === generation) return this.globalInflight.promise;
    const promise = this.loadGlobal(generation).finally(() => {
      if (this.globalInflight?.promise === promise) this.globalInflight = null;
    });
    this.globalInflight = { promise, generation };
    return promise;
  }

  private async loadGlobal(generation: number): Promise<RedteamGlobalResult> {
    try {
      const raw = await this.bb.sdk.plugins.callRpc({
        pluginId: REDTEAM_PLUGIN_ID,
        method: SNAPSHOT_METHOD,
        input: { limit: BOARD_LIMITS.redteamMaxScans },
        outputSchema: redteamObservabilityWireSchema,
      });
      const snapshot = redteamObservabilityWireSchema.parse(raw);
      const result = normalizeRedteamGlobalSnapshot(snapshot);
      if (this.generation === generation) {
        this.globalCache = { at: this.now(), snapshot };
        this.globalLast = result;
      }
      return result;
    } catch {
      // Keep the last disposable view to avoid flicker, but expose that this
      // optional source failed so the global page never presents it as fresh.
      return this.globalLast
        ? { ...this.globalLast, available: false }
        : { groups: [], active: false, partial: false, available: false, fingerprint: null };
    }
  }

  async pollGlobal(): Promise<{ changed: boolean; active: boolean }> {
    const before = this.globalLast;
    const after = await this.collectGlobal({ fresh: true });
    return {
      changed: before !== null && after.fingerprint !== null && before.fingerprint !== after.fingerprint,
      active: after.active,
    };
  }

  isActive(projectId: string | null): boolean { return projectId ? (this.last.get(projectId)?.active ?? false) : false; }

  isGlobalActive(): boolean { return this.globalLast?.active ?? false; }

  /**
   * Lazy timeline read. Reuse a fresh scoped/global snapshot when one already
   * powered the visible board; otherwise perform one bounded public Redteam
   * observability RPC. No historical store is created here.
   */
  async timeline(scanId: string, executionKey: string, limit: number): Promise<ExecutionTimeline> {
    const now = this.now();
    const cachedSnapshots = [
      ...(this.globalCache && now - this.globalCache.at < TTL_MS ? [this.globalCache.snapshot] : []),
      ...[...this.cache.values()]
        .filter((entry) => now - entry.at < TTL_MS)
        .map((entry) => entry.snapshot),
    ];
    let snapshot = cachedSnapshots.find((candidate) =>
      candidate.scans.some((scan) => scan.scanId === scanId),
    ) ?? null;
    if (snapshot === null) {
      await this.collectGlobal();
      snapshot = this.globalCache?.snapshot ?? null;
    }
    if (snapshot === null) throw new Error("Redteam timeline is unavailable");
    const normalized = normalizeRedteamTimeline(snapshot, scanId, executionKey, limit, now);
    if (normalized === null) throw new Error("Redteam execution was not found in the bounded snapshot");
    return normalized;
  }

  invalidate(): void { this.generation += 1; this.cache.clear(); this.globalCache = null; }
}
