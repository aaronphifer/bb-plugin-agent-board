// Generic execution-timeline normalization for public BB timeline/event rows.
// This module deliberately consumes only presentation-safe, allowlisted fields.
// It never reads activeThinking, reasoning events, tool output, stdout/stderr,
// file contents, user prompts, system/developer text, or raw event JSON.
import type {
  ExecutionTimeline,
  TimelineEvent,
  TimelineEventKind,
  TimelineEventStatus,
} from "../contract/rpc";
import {
  BOARD_LIMITS,
  previewText,
  publicUpdatePreview,
  redactOperationalText,
} from "./board-model";
import type { ThreadEventRow, TimelineResponse } from "./bb-source";

type UnknownRecord = Record<string, unknown>;

export interface TimelineCandidate extends TimelineEvent {
  fingerprint: string;
  sortSequence: number;
}

export interface NormalizeBbTimelineInput {
  executionKey: string;
  threadId: string;
  timeline: TimelineResponse;
  lifecycleEvents?: readonly ThreadEventRow[];
  lifecycleTruncated?: boolean;
  sourceWarning?: string | null;
  limit?: number;
  now?: number;
}

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function epoch(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
}

function safeText(value: unknown, max: number): string | null {
  const raw = text(value);
  return raw === null ? null : previewText(redactOperationalText(raw), max);
}

function safeTitle(value: unknown, fallback: string): string {
  return safeText(value, 120) ?? fallback;
}

function sourceMeta(sourceId: string, sequence: number | null): TimelineEvent["sourceMetadata"] {
  return { sourceId: sourceId.slice(0, 240), sequence };
}

function flattenRows(value: unknown): UnknownRecord[] {
  if (!Array.isArray(value)) return [];
  const rows: UnknownRecord[] = [];
  const visit = (items: unknown[]) => {
    for (const item of items) {
      const row = record(item);
      if (row === null || text(row.id) === null || text(row.kind) === null) continue;
      rows.push(row);
      if (row.kind === "turn" && Array.isArray(row.children)) visit(row.children);
    }
  };
  visit(value);
  return rows;
}

function rowSequence(row: UnknownRecord): number {
  return epoch(row.sourceSeqEnd) ?? epoch(row.sourceSeqStart) ?? Number.MAX_SAFE_INTEGER;
}

function statusOf(value: unknown): TimelineEventStatus | null {
  switch (value) {
    case "pending":
      return "pending";
    case "completed":
    case "done":
      return "completed";
    case "error":
    case "failed":
      return "failed";
    case "interrupted":
    case "cancelled":
    case "killed":
    case "stopped":
      return "interrupted";
    case "running":
    case "starting":
      return "running";
    case "waiting":
    case "paused":
      return "waiting";
    case "resolved":
    case "answered":
    case "granted":
      return "resolved";
    default:
      return null;
  }
}

function terminalKind(status: TimelineEventStatus | null, family: "execution" | "phase" | "tool" | "child"): TimelineEventKind | null {
  if (status === "completed") return `${family}-complete` as TimelineEventKind;
  if (status === "failed") return `${family}-failed` as TimelineEventKind;
  if (status === "interrupted") {
    if (family === "execution") return "execution-interrupted";
    if (family === "tool") return "tool-failed";
    if (family === "child") return "child-failed";
  }
  return null;
}

function presentation(row: UnknownRecord): UnknownRecord | null {
  return record(row.presentation);
}

function presentationDetail(row: UnknownRecord): string | null {
  return safeText(presentation(row)?.detail, BOARD_LIMITS.timelineSummaryChars);
}

function workLabel(row: UnknownRecord): string {
  const workKind = text(row.workKind) ?? "tool";
  const labels = record(presentation(row)?.label);
  const presented = row.status === "completed" ? labels?.completed : labels?.pending;
  if (text(presented)) return safeTitle(presented, "Tool activity");
  switch (workKind) {
    case "command": return "Command";
    case "file-read": return "Read file";
    case "file-change": return "Changed file";
    case "search": return "Search";
    case "web-search": return "Web search";
    case "web-fetch": return "Web fetch";
    case "image-view": return "Viewed image";
    case "tool": return safeTitle(row.toolName, "Tool");
    default: return safeTitle(workKind.replace(/-/g, " "), "Tool");
  }
}

function firstString(recordValue: unknown, keys: readonly string[]): string | null {
  const value = record(recordValue);
  if (value === null) return null;
  for (const key of keys) {
    const candidate = safeText(value[key], BOARD_LIMITS.timelineTargetChars);
    if (candidate !== null) return candidate;
  }
  return null;
}

/** Safe target only; never serializes arbitrary toolArgs or output. */
function targetForWork(row: UnknownRecord): string | null {
  switch (row.workKind) {
    case "command":
      return safeText(row.command, BOARD_LIMITS.timelineTargetChars);
    case "file-read":
    case "image-view":
      return safeText(row.path, BOARD_LIMITS.timelineTargetChars);
    case "file-change":
      return safeText(record(row.change)?.path, BOARD_LIMITS.timelineTargetChars);
    case "search": {
      const query = safeText(row.query, 140);
      const path = safeText(row.path, 90);
      return [query, path].filter(Boolean).join(" · ") || null;
    }
    case "web-search":
      return Array.isArray(row.queries)
        ? safeText(row.queries.find((item) => typeof item === "string"), BOARD_LIMITS.timelineTargetChars)
        : null;
    case "web-fetch":
      return safeText(row.url, BOARD_LIMITS.timelineTargetChars);
    case "tool":
      return presentationDetail(row) ?? firstString(row.toolArgs, ["path", "file", "query", "url", "target", "cmd"]);
    default:
      return presentationDetail(row);
  }
}

function duration(startedAt: number, completedAt: number | null, reported: unknown): number | null {
  const explicit = epoch(reported);
  if (explicit !== null) return explicit;
  return completedAt === null ? null : Math.max(0, completedAt - startedAt);
}

function makeCandidate(
  base: Pick<TimelineCandidate, "executionKey" | "source" | "threadId">,
  fields: Omit<TimelineCandidate, "executionKey" | "source" | "threadId">,
): TimelineCandidate {
  return { ...base, ...fields };
}

/** Deterministic chronological de-duplication; distinct source rows stay distinct. */
export function finalizeTimeline(
  executionKey: string,
  source: "bb" | "redteam",
  candidates: readonly TimelineCandidate[],
  options: {
    active: boolean;
    limit?: number;
    sourceTruncated?: boolean;
    sourceWarning?: string | null;
    fetchedAt?: number;
  },
): ExecutionTimeline {
  const limit = Math.min(
    Math.max(options.limit ?? BOARD_LIMITS.executionTimelineDefaultEvents, 1),
    BOARD_LIMITS.executionTimelineMaxEvents,
  );
  const byFingerprint = new Map<string, TimelineCandidate>();
  for (const candidate of candidates) {
    const previous = byFingerprint.get(candidate.fingerprint);
    if (
      previous === undefined ||
      candidate.timestamp > previous.timestamp ||
      (candidate.timestamp === previous.timestamp && candidate.sortSequence > previous.sortSequence)
    ) {
      byFingerprint.set(candidate.fingerprint, candidate);
    }
  }
  const ordered = [...byFingerprint.values()].sort(
    (a, b) => a.timestamp - b.timestamp || a.sortSequence - b.sortSequence || a.id.localeCompare(b.id),
  );
  const truncated = options.sourceTruncated === true || ordered.length > limit;
  const events = ordered.slice(-limit).map(({ fingerprint: _fingerprint, sortSequence: _sort, ...event }) => event);
  return {
    executionKey,
    source,
    events,
    active: options.active,
    truncated,
    sourceWarning: safeText(options.sourceWarning, 240),
    fetchedAt: Math.trunc(options.fetchedAt ?? Date.now()),
  };
}

function lifecycleCandidates(input: NormalizeBbTimelineInput, base: Pick<TimelineCandidate, "executionKey" | "source" | "threadId">): TimelineCandidate[] {
  const out: TimelineCandidate[] = [];
  for (const event of input.lifecycleEvents ?? []) {
    const eventRecord = event as unknown as UnknownRecord;
    const id = text(eventRecord.id);
    const type = text(eventRecord.type);
    const at = epoch(eventRecord.createdAt);
    const data = record(eventRecord.data);
    if (id === null || type === null || at === null || data === null) continue;
    const sequence = epoch(eventRecord.seq) ?? 0;
    const common = {
      executionKey: input.executionKey,
      source: "bb" as const,
      threadId: input.threadId,
      timestamp: at,
      model: null,
      toolName: null,
      target: null,
      phase: null,
      durationMs: null,
      sourceMetadata: sourceMeta(id, sequence),
      sortSequence: sequence,
    };
    if (type === "system/interaction/lifecycle") {
      const interaction = record(data.interaction);
      const interactionId = text(interaction?.id);
      const payload = record(interaction?.payload);
      const payloadKind = text(payload?.kind);
      const state = statusOf(interaction?.status);
      if (interactionId === null) continue;
      const family = payloadKind === "approval" ? "approval" : payloadKind === "user_question" ? "question" : null;
      if (family === null) continue;
      if (state === "pending") {
        const subject = record(payload?.subject);
        const toolName = safeText(subject?.toolName, 100);
        const prompt = Array.isArray(payload?.questions)
          ? safeText(record(payload.questions[0])?.prompt, BOARD_LIMITS.timelineSummaryChars)
          : null;
        out.push(makeCandidate(base, {
          ...common,
          id: `bb:${input.threadId}:interaction:${interactionId}:requested`,
          fingerprint: `interaction:${family}:${interactionId}:requested`,
          kind: family === "approval" ? "approval-requested" : "question-requested",
          status: "waiting",
          title: family === "approval" ? "Approval requested" : "Question requested",
          summary: family === "approval" ? safeText(payload?.reason, BOARD_LIMITS.timelineSummaryChars) : prompt,
          toolName,
          attentionType: "action-required",
        }));
      } else if (state === "resolved") {
        out.push(makeCandidate(base, {
          ...common,
          id: `bb:${input.threadId}:interaction:${interactionId}:resolved`,
          fingerprint: `interaction:${family}:${interactionId}:resolved`,
          kind: "resumed",
          status: "resolved",
          title: family === "approval" ? "Approval resolved" : "Question answered",
          summary: null,
          attentionType: null,
        }));
      }
      continue;
    }
    if (type === "system/thread-provisioning") {
      const provisioningId = text(data.provisioningId) ?? id;
      const state = text(data.status);
      if (state === "active") {
        out.push(makeCandidate(base, {
          ...common,
          id: `bb:${input.threadId}:provisioning:${provisioningId}:waiting`,
          fingerprint: `provisioning:${provisioningId}:waiting`,
          kind: "waiting",
          status: "waiting",
          title: "Waiting for provisioning",
          summary: null,
          attentionType: "waiting",
        }));
      } else if (state === "completed") {
        out.push(makeCandidate(base, {
          ...common,
          id: `bb:${input.threadId}:provisioning:${provisioningId}:resumed`,
          fingerprint: `provisioning:${provisioningId}:resumed`,
          kind: "resumed",
          status: "resolved",
          title: "Provisioning completed",
          summary: null,
          attentionType: null,
        }));
      }
      continue;
    }
    if (type === "system/thread/interrupted") {
      out.push(makeCandidate(base, {
        ...common,
        id: `bb:${input.threadId}:event:${id}:interrupted`,
        fingerprint: `event:${id}:interrupted`,
        kind: "execution-interrupted",
        status: "interrupted",
        title: "Execution interrupted",
        summary: safeText(data.reason, BOARD_LIMITS.timelineSummaryChars),
        attentionType: "interrupted",
      }));
      continue;
    }
    if (type === "client/turn/requested") {
      // This public event contains resolved execution options as well as the
      // user's input. Read only the proven execution model and deliberately
      // discard every input/message field.
      const execution = record(data.execution);
      const model = safeText(execution?.model, 160);
      if (model === null) continue;
      out.push(makeCandidate(base, {
        ...common,
        id: `bb:${input.threadId}:event:${id}:model`,
        fingerprint: `model:${model}`,
        kind: "model-selected",
        status: "running",
        title: "Model selected",
        summary: null,
        model,
        attentionType: null,
      }));
      continue;
    }
    if (type === "provider/modelFallback") {
      const model = safeText(data.fallbackModel, 160);
      if (model === null) continue;
      out.push(makeCandidate(base, {
        ...common,
        id: `bb:${input.threadId}:event:${id}:model`,
        fingerprint: `model:${model}`,
        kind: "model-selected",
        status: "running",
        title: "Fallback model selected",
        summary: safeText(data.message, BOARD_LIMITS.timelineSummaryChars),
        model,
        attentionType: null,
      }));
    }
  }
  return out;
}

/** Normalize one public BB timeline response into source-independent events. */
export function normalizeBbTimeline(input: NormalizeBbTimelineInput): ExecutionTimeline {
  const base = { executionKey: input.executionKey, source: "bb" as const, threadId: input.threadId };
  const rows = flattenRows(input.timeline.rows);
  const candidates = lifecycleCandidates(input, base);
  const failedTurnErrors = new Map<string, string>();
  for (const row of rows) {
    if (row.kind !== "system" || row.systemKind !== "error") continue;
    const turnId = text(row.turnId);
    if (turnId === null) continue;
    const summary = safeText(
      [safeText(row.title, 120), safeText(row.detail, 240)].filter(Boolean).join(" — "),
      BOARD_LIMITS.timelineSummaryChars,
    );
    if (summary !== null) failedTurnErrors.set(turnId, summary);
  }
  const seenModels = new Set(candidates.map((candidate) => candidate.model).filter((model): model is string => model !== null));

  for (const row of rows) {
    const id = text(row.id);
    const startedAt = epoch(row.startedAt) ?? epoch(row.createdAt);
    if (id === null || startedAt === null) continue;
    const sequence = rowSequence(row);
    const metadata = sourceMeta(id, sequence === Number.MAX_SAFE_INTEGER ? null : sequence);
    if (row.kind === "conversation") {
      // Only assistant-authored conversation rows are public updates. User
      // rows include user/system/developer/child messages and are all refused.
      if (row.role !== "assistant") continue;
      const summary = publicUpdatePreview(text(row.text));
      if (summary === null) continue;
      const turnId = text(row.turnId) ?? id;
      candidates.push(makeCandidate(base, {
        id: `bb:${input.threadId}:row:${id}:update`,
        fingerprint: `public:${turnId}:${summary}`,
        sortSequence: sequence,
        timestamp: epoch(row.createdAt) ?? startedAt,
        kind: "public-update",
        status: null,
        title: "Public update",
        summary,
        model: null,
        toolName: null,
        target: null,
        phase: null,
        durationMs: null,
        attentionType: null,
        sourceMetadata: metadata,
      }));
      continue;
    }
    if (row.kind === "turn") {
      const turnId = text(row.turnId) ?? id;
      const completedAt = epoch(row.completedAt);
      candidates.push(makeCandidate(base, {
        id: `bb:${input.threadId}:turn:${turnId}:start`,
        fingerprint: `turn:${turnId}:start`,
        sortSequence: sequence,
        timestamp: startedAt,
        kind: "execution-start",
        status: "running",
        title: "Execution started",
        summary: null,
        model: null,
        toolName: null,
        target: null,
        phase: null,
        durationMs: null,
        attentionType: null,
        sourceMetadata: metadata,
      }));
      const terminalStatus = statusOf(row.status);
      const kind = terminalKind(terminalStatus, "execution");
      if (completedAt !== null && kind !== null) {
        candidates.push(makeCandidate(base, {
          id: `bb:${input.threadId}:turn:${turnId}:terminal`,
          fingerprint: `turn:${turnId}:terminal`,
          sortSequence: sequence,
          timestamp: completedAt,
          kind,
          status: terminalStatus,
          title: terminalStatus === "completed" ? "Execution finished" : terminalStatus === "failed" ? "Execution failed" : "Execution interrupted",
          summary: terminalStatus === "failed" ? (failedTurnErrors.get(turnId) ?? null) : null,
          model: null,
          toolName: null,
          target: null,
          phase: null,
          durationMs: Math.max(0, completedAt - startedAt),
          attentionType: terminalStatus === "failed" ? "failed" : terminalStatus === "interrupted" ? "interrupted" : null,
          sourceMetadata: metadata,
        }));
      }
      continue;
    }
    if (row.kind === "system") {
      if (row.systemKind === "reconnect") {
        candidates.push(makeCandidate(base, {
          id: `bb:${input.threadId}:system:${id}:resumed`,
          fingerprint: `system:${id}:resumed`,
          sortSequence: sequence,
          timestamp: epoch(row.createdAt) ?? startedAt,
          kind: "resumed",
          status: "resolved",
          title: safeTitle(row.title, "Host reconnected"),
          summary: safeText(row.detail, BOARD_LIMITS.timelineSummaryChars),
          model: null,
          toolName: null,
          target: null,
          phase: null,
          durationMs: null,
          attentionType: null,
          sourceMetadata: metadata,
        }));
      }
      continue;
    }
    if (row.kind !== "work" || presentation(row)?.suppress === true) continue;
    const workKind = text(row.workKind);
    const completedAt = epoch(row.completedAt);
    const terminalStatus = statusOf(row.status);

    if (workKind === "approval" || workKind === "question") {
      const interactionId = text(row.interactionId) ?? id;
      const family = workKind;
      const pending = row.lifecycle === "waiting" || row.lifecycle === "pending" || row.lifecycle === "resolving";
      if (pending) {
        const question = Array.isArray(row.questions) ? record(row.questions[0]) : null;
        candidates.push(makeCandidate(base, {
          id: `bb:${input.threadId}:interaction:${interactionId}:requested`,
          fingerprint: `interaction:${family}:${interactionId}:requested`,
          sortSequence: sequence,
          timestamp: startedAt,
          kind: family === "approval" ? "approval-requested" : "question-requested",
          status: "waiting",
          title: family === "approval" ? "Approval requested" : "Question requested",
          summary: family === "question" ? safeText(question?.prompt, BOARD_LIMITS.timelineSummaryChars) : presentationDetail(row),
          model: null,
          toolName: family === "approval" ? safeText(record(row.target)?.toolName, 100) : null,
          target: null,
          phase: null,
          durationMs: null,
          attentionType: "action-required",
          sourceMetadata: metadata,
        }));
      } else if (
        completedAt !== null &&
        ((family === "approval" && row.lifecycle === "granted") ||
          (family === "question" && row.lifecycle === "answered"))
      ) {
        candidates.push(makeCandidate(base, {
          id: `bb:${input.threadId}:interaction:${interactionId}:resolved`,
          fingerprint: `interaction:${family}:${interactionId}:resolved`,
          sortSequence: sequence,
          timestamp: completedAt,
          kind: "resumed",
          status: "resolved",
          title: family === "approval" ? "Approval resolved" : "Question answered",
          summary: null,
          model: null,
          toolName: family === "approval" ? safeText(record(row.target)?.toolName, 100) : null,
          target: null,
          phase: null,
          durationMs: Math.max(0, completedAt - startedAt),
          attentionType: null,
          sourceMetadata: metadata,
        }));
      }
      continue;
    }

    if (workKind === "plan-steps") {
      candidates.push(makeCandidate(base, {
        id: `bb:${input.threadId}:row:${id}:phase-start`, fingerprint: `row:${id}:phase-start`, sortSequence: sequence,
        timestamp: startedAt, kind: "phase-start", status: "running", title: "Planning started",
        summary: null, model: null, toolName: null, target: null, phase: "Planning", durationMs: null,
        attentionType: null, sourceMetadata: metadata,
      }));
      const kind = terminalKind(terminalStatus, "phase");
      if (completedAt !== null && kind !== null) {
        candidates.push(makeCandidate(base, {
          id: `bb:${input.threadId}:row:${id}:phase-terminal`, fingerprint: `row:${id}:phase-terminal`, sortSequence: sequence,
          timestamp: completedAt, kind, status: terminalStatus,
          title: terminalStatus === "completed" ? "Planning completed" : "Planning failed",
          summary: presentationDetail(row), model: null, toolName: null, target: null, phase: "Planning",
          durationMs: duration(startedAt, completedAt, row.durationMs),
          attentionType: terminalStatus === "failed" ? "failed" : null, sourceMetadata: metadata,
        }));
      }
      continue;
    }

    if (workKind === "delegation") {
      const childRef = text(row.childRef);
      const title = safeTitle(row.description, "Delegated task");
      if (childRef === null) {
        candidates.push(makeCandidate(base, {
          id: `bb:${input.threadId}:row:${id}:delegation`, fingerprint: `row:${id}:delegation`, sortSequence: sequence,
          timestamp: startedAt, kind: "delegation", status: "running", title: "Delegated task",
          summary: title, model: null, toolName: safeText(row.toolName, 100), target: null, phase: null,
          durationMs: null, attentionType: null, sourceMetadata: metadata,
        }));
      } else {
        candidates.push(makeCandidate(base, {
          id: `bb:${input.threadId}:row:${id}:child-start`, fingerprint: `row:${id}:child-start`, sortSequence: sequence,
          timestamp: startedAt, kind: "child-start", status: "running", title: "Child started",
          summary: title, model: null, toolName: null, target: null, phase: null, durationMs: null,
          attentionType: null, sourceMetadata: metadata,
        }));
        const kind = terminalKind(terminalStatus, "child");
        if (completedAt !== null && kind !== null) {
          const summary = publicUpdatePreview(text(row.output));
          candidates.push(makeCandidate(base, {
            id: `bb:${input.threadId}:row:${id}:child-terminal`, fingerprint: `row:${id}:child-terminal`, sortSequence: sequence,
            timestamp: completedAt, kind, status: terminalStatus,
            title: terminalStatus === "completed" ? "Child completed" : terminalStatus === "interrupted" ? "Child interrupted" : "Child failed",
            summary: summary ?? title, model: null, toolName: null, target: null, phase: null,
            durationMs: duration(startedAt, completedAt, row.durationMs),
            attentionType: terminalStatus === "failed" ? "failed" : terminalStatus === "interrupted" ? "interrupted" : null,
            sourceMetadata: metadata,
          }));
        }
      }
      continue;
    }

    if (workKind === "workflow") {
      const workflow = record(row.workflow);
      const agents = Array.isArray(workflow?.agents) ? workflow.agents : [];
      for (const value of agents) {
        const agent = record(value);
        const index = epoch(agent?.index);
        const attempt = epoch(agent?.attempt) ?? 0;
        const agentStarted = epoch(agent?.startedAt) ?? epoch(agent?.queuedAt);
        if (agent === null || index === null || agentStarted === null) continue;
        const agentKey = `${id}:${index}:${attempt}`;
        const model = safeText(agent.model, 160);
        if (model !== null && !seenModels.has(model)) {
          seenModels.add(model);
          candidates.push(makeCandidate(base, {
            id: `bb:${input.threadId}:workflow:${agentKey}:model`, fingerprint: `model:${model}`, sortSequence: sequence,
            timestamp: agentStarted, kind: "model-selected", status: "running", title: "Model selected",
            summary: null, model, toolName: null, target: null, phase: safeText(agent.phaseTitle, 120),
            durationMs: null, attentionType: null, sourceMetadata: metadata,
          }));
        }
        const agentTitle = safeTitle(agent.label, "Child agent");
        candidates.push(makeCandidate(base, {
          id: `bb:${input.threadId}:workflow:${agentKey}:start`, fingerprint: `workflow:${agentKey}:start`, sortSequence: sequence,
          timestamp: agentStarted, kind: "child-start", status: "running", title: "Child started",
          summary: agentTitle, model, toolName: null, target: null, phase: safeText(agent.phaseTitle, 120),
          durationMs: null, attentionType: null, sourceMetadata: metadata,
        }));
        const agentStatus = statusOf(agent.state);
        const agentDuration = epoch(agent.durationMs);
        const agentCompleted = agentDuration === null ? null : agentStarted + agentDuration;
        const kind = terminalKind(agentStatus, "child");
        if (agentCompleted !== null && kind !== null) {
          candidates.push(makeCandidate(base, {
            id: `bb:${input.threadId}:workflow:${agentKey}:terminal`, fingerprint: `workflow:${agentKey}:terminal`, sortSequence: sequence,
            timestamp: agentCompleted, kind, status: agentStatus,
            title: agentStatus === "completed" ? "Child completed" : "Child failed",
            summary: safeText(agent.resultPreview ?? agent.error ?? agentTitle, BOARD_LIMITS.timelineSummaryChars),
            model, toolName: null, target: null, phase: safeText(agent.phaseTitle, 120), durationMs: agentDuration,
            attentionType: agentStatus === "failed" ? "failed" : null, sourceMetadata: metadata,
          }));
        }
      }
      continue;
    }

    const label = workLabel(row);
    const toolName = workKind === "command" ? "command" : workKind === "tool" ? safeText(row.toolName, 100) : safeText(workKind, 100);
    const target = targetForWork(row);
    candidates.push(makeCandidate(base, {
      id: `bb:${input.threadId}:row:${id}:tool-start`, fingerprint: `row:${id}:tool-start`, sortSequence: sequence,
      timestamp: startedAt, kind: "tool-start", status: "running", title: `${label} started`,
      summary: null, model: null, toolName, target, phase: null, durationMs: null,
      attentionType: null, sourceMetadata: metadata,
    }));
    const kind = terminalKind(terminalStatus, "tool");
    if (completedAt !== null && kind !== null) {
      candidates.push(makeCandidate(base, {
        id: `bb:${input.threadId}:row:${id}:tool-terminal`, fingerprint: `row:${id}:tool-terminal`, sortSequence: sequence,
        timestamp: completedAt, kind, status: terminalStatus,
        title: terminalStatus === "completed" ? `${label} completed` : terminalStatus === "interrupted" ? `${label} interrupted` : `${label} failed`,
        summary: terminalStatus === "failed" ? presentationDetail(row) : null,
        model: null, toolName, target, phase: null,
        durationMs: duration(startedAt, completedAt, row.durationMs),
        attentionType: terminalStatus === "failed" ? "failed" : terminalStatus === "interrupted" ? "interrupted" : null,
        sourceMetadata: metadata,
      }));
    }
  }

  const rowActive = rows.some((row) =>
    (row.kind === "turn" || row.kind === "work") &&
    (row.status === "pending" || row.taskStatus === "running" || row.lifecycle === "pending" || row.lifecycle === "waiting"),
  );
  // During provisioning, BB can publish the resolved turn request before the
  // first turn row exists. Treat that bounded startup window as active until
  // a later terminal execution event proves otherwise, so the open UI keeps
  // following realtime invalidations and the collector uses its active TTL.
  const latestRequestedAt = Math.max(
    -1,
    ...(input.lifecycleEvents ?? [])
      .filter((event) => event.type === "client/turn/requested")
      .map((event) => epoch(event.createdAt) ?? -1),
  );
  const latestTerminalAt = Math.max(
    -1,
    ...candidates
      .filter((candidate) =>
        candidate.kind === "execution-complete" ||
        candidate.kind === "execution-failed" ||
        candidate.kind === "execution-interrupted",
      )
      .map((candidate) => candidate.timestamp),
  );
  const active = rowActive || latestRequestedAt > latestTerminalAt;
  const page = record(input.timeline.timelinePage);
  return finalizeTimeline(input.executionKey, "bb", candidates, {
    active,
    limit: input.limit,
    sourceTruncated: page?.hasOlderRows === true || input.lifecycleTruncated === true,
    sourceWarning: input.sourceWarning,
    fetchedAt: input.now,
  });
}
