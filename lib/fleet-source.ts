// Optional public Fleet adapter. This schema belongs to Agent Board; no Fleet imports.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { BoardCard, TimelineEvent } from "../contract/rpc";
import type { GlobalExecutionGroup } from "./global-model";
import { columnForStatus, redactOperationalText } from "./board-model";

const display = (max: number) =>
  z
    .string()
    .max(4000)
    .transform((s) =>
      redactOperationalText(s)
        .replace(
          /\b(?:token|secret|api[_-]?key|authorization)\s*[:=]\s*\S+/gi,
          "[redacted]",
        )
        .replace(/https?:\/\/\S+/gi, "[redacted]")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, max),
    );
export const fleetJobWireSchema = z.object({
  jobId: z.string().min(1).max(80),
  revision: z.number().int().positive(),
  state: z.enum(["routing", "running", "completed", "failed", "cancelled"]),
  origin: z
    .object({
      threadId: z.string().min(1).max(120),
      projectId: z.string().min(1).max(120),
    })
    .nullable(),
  taskType: z.enum(["coding", "reasoning", "security", "general"]),
  label: display(120),
  actualModel: display(120).nullable(),
  server: z.object({ id: z.string().max(120), name: display(120) }).nullable(),
  startedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  attemptCount: z.number().int().nonnegative(),
  latestActivity: display(120).nullable(),
  errorPreview: display(360).nullable(),
});
export const fleetWireSchema = z.object({
  schemaVersion: z.literal(1),
  observedAt: z.iso.datetime(),
  truncated: z.boolean(),
  jobs: z.array(fleetJobWireSchema).max(20),
});
export type FleetJob = z.infer<typeof fleetJobWireSchema>;
export type FleetSnapshot = z.infer<typeof fleetWireSchema>;
export const fleetActive = (j: FleetJob) =>
  j.state === "routing" || j.state === "running";
const empty = (): FleetSnapshot => ({
  schemaVersion: 1,
  observedAt: new Date().toISOString(),
  truncated: false,
  jobs: [],
});

export function fleetCard(job: FleetJob): BoardCard {
  const status =
    job.state === "routing"
      ? "starting"
      : job.state === "cancelled"
        ? "interrupted"
        : job.state;
  return {
    key: `ollama-fleet:${job.jobId}`,
    parentKey: job.origin ? `thread:${job.origin.threadId}` : null,
    depth: job.origin ? 1 : 0,
    kind: "delegation",
    source: "ollama-fleet",
    title: job.label || `Local ${job.taskType} task`,
    subtitle: "Ollama Fleet",
    status,
    column:
      job.state === "routing"
        ? "active"
        : columnForStatus(status, "delegation"),
    threadId: null,
    providerId: "ollama-fleet",
    providerLabel: "Ollama Fleet",
    model: job.actualModel,
    serverName: job.server?.name ?? null,
    jobId: job.jobId,
    originThreadId: job.origin?.threadId,
    originProjectId: job.origin?.projectId,
    startedAt: Date.parse(job.startedAt),
    completedAt: job.finishedAt ? Date.parse(job.finishedAt) : null,
    durationMs: job.durationMs,
    phaseTitle: null,
    promptPreview: null,
    outputPreview: null,
    errorPreview: job.errorPreview,
    activity: job.latestActivity
      ? {
          text: job.latestActivity,
          at: Date.parse(job.updatedAt),
          kind: "inference",
        }
      : null,
    tokens: null,
    toolCalls: null,
    waitingOn: null,
    planStatus: null,
    isRoot: !job.origin,
    // Linked failures are subordinate to the parent's final outcome. The scoped card still shows them.
    attention:
      !job.origin && job.state === "failed"
        ? {
            type: "failed",
            message: job.errorPreview?.slice(0, 320) || "Generation failed",
          }
        : null,
  };
}

export function scopedFleetCards(
  snapshot: FleetSnapshot,
  threads: ReadonlyMap<string, string | null>,
): { cards: BoardCard[]; partial: boolean } {
  const counts = new Map<string, number>();
  let partial = snapshot.truncated;
  const cards: BoardCard[] = [];
  for (const j of snapshot.jobs) {
    if (
      !j.origin ||
      !threads.has(j.origin.threadId) ||
      threads.get(j.origin.threadId) !== j.origin.projectId
    )
      continue;
    const n = counts.get(j.origin.threadId) ?? 0;
    counts.set(j.origin.threadId, n + 1);
    if (n >= 8) {
      partial = true;
      continue;
    }
    cards.push(fleetCard(j));
  }
  return { cards, partial };
}

export function addFleetGroups(
  groups: GlobalExecutionGroup[],
  snapshot: FleetSnapshot,
): GlobalExecutionGroup[] {
  const result = groups.map((g) => ({ ...g, cards: [...g.cards] }));
  for (const j of snapshot.jobs) {
    const parent = j.origin
      ? result.find(
          (g) =>
            g.source === "bb" &&
            g.projectId === j.origin!.projectId &&
            (g.threadId === j.origin!.threadId ||
              g.cards.some(
                (c) => c.source === "bb" && c.threadId === j.origin!.threadId,
              )),
        )
      : undefined;
    if (parent) {
      parent.delegatedWorkers ??= [];
      parent.delegatedWorkers.push(fleetCard(j));
      parent.updatedAt = Math.max(parent.updatedAt, Date.parse(j.updatedAt));
    } else if (!j.origin) {
      result.push({
        key: `ollama-fleet:${j.jobId}`,
        source: "ollama-fleet",
        title: j.label,
        threadId: null,
        projectId: null,
        cards: [fleetCard(j)],
        updatedAt: Date.parse(j.updatedAt),
      });
    } else if (fleetActive(j)) {
      // The bounded BB page may omit an older known origin. Group by that exact origin,
      // never invent an orphan or infer ancestry from timing/model/title.
      const key = `bb:${j.origin.threadId}`;
      let group = result.find((g) => g.key === key);
      if (!group) {
        const c = fleetCard(j);
        group = {
          key,
          source: "bb",
          title: "BB delegated work",
          threadId: j.origin.threadId,
          projectId: j.origin.projectId,
          cards: [
            {
              ...c,
              key: `thread:${j.origin.threadId}`,
              source: "bb",
              kind: "thread",
              title: "BB delegated work",
              threadId: j.origin.threadId,
              parentKey: null,
              isRoot: true,
              model: null,
              serverName: null,
              jobId: undefined,
              providerId: null,
              providerLabel: null,
            },
          ],
          updatedAt: Date.parse(j.updatedAt),
        };
        result.push(group);
      }
      group.delegatedWorkers ??= [];
      group.delegatedWorkers.push(fleetCard(j));
    }
  }
  return result;
}

export function fleetTimelineEvents(
  jobs: readonly FleetJob[],
  executionKey: string,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const j of jobs) {
    const base: Omit<TimelineEvent, "id" | "kind" | "timestamp" | "title"> = {
      executionKey,
      source: "ollama-fleet",
      status: null,
      summary: null,
      model: null,
      toolName: null,
      target: null,
      phase: null,
      durationMs: null,
      threadId: j.origin?.threadId ?? null,
      attentionType: null,
      sourceMetadata: { sourceId: j.jobId, sequence: null },
    };
    const start = Date.parse(j.startedAt);
    events.push({
      ...base,
      id: `fleet:${j.jobId}:delegation`,
      kind: "delegation",
      timestamp: start,
      title: j.label,
      status: "running",
    });
    events.push({
      ...base,
      id: `fleet:${j.jobId}:start`,
      kind: "child-start",
      timestamp: start,
      title: j.label,
      status: "running",
    });
    // V1 has no model-selection timestamp or attempt history. Use the record's
    // update time and describe observation, never backdate a selection event.
    if (j.actualModel)
      events.push({
        ...base,
        id: `fleet:${j.jobId}:model`,
        kind: "model-selected",
        timestamp: Date.parse(j.updatedAt),
        title: "Actual model recorded",
        model: j.actualModel,
        summary: j.server?.name ?? null,
      });
    if (j.finishedAt)
      events.push({
        ...base,
        id: `fleet:${j.jobId}:terminal`,
        timestamp: Date.parse(j.finishedAt),
        title: j.label,
        kind:
          j.state === "failed"
            ? "child-failed"
            : j.state === "cancelled"
              ? "execution-interrupted"
              : "child-complete",
        status:
          j.state === "failed"
            ? "failed"
            : j.state === "cancelled"
              ? "interrupted"
              : "completed",
        durationMs: j.durationMs,
        summary: j.errorPreview,
      });
  }
  return events.sort((a, b) => a.timestamp - b.timestamp);
}

/** One cache/inflight shared by all board, global and timeline consumers. */
export class FleetSource {
  private generation = 0;
  private cache: { snapshot: FleetSnapshot; at: number } | null = null;
  private inflight: Promise<FleetSnapshot> | null = null;
  private transport: Promise<unknown> | null = null;
  private routeHint = false;
  private routeHints = new Map<string, string>();
  private polledFingerprint: string | null = null;
  constructor(
    private bb: BbPluginApi,
    private now: () => number = Date.now,
  ) {}
  invalidate() {
    this.generation++;

  }
  hintFromCards(cards: readonly BoardCard[]) {
    for (const c of cards) {
      if (!/ollama_fleet_route|fleet_route/.test(c.activity?.text ?? "")) continue;
      const fingerprint = `${c.activity?.at}:${c.activity?.text}`;
      if (this.routeHints.get(c.key) === fingerprint) continue;
      this.routeHints.delete(c.key);
      this.routeHints.set(c.key, fingerprint);
      if (this.routeHints.size > 100) this.routeHints.delete(this.routeHints.keys().next().value!);
      this.routeHint = true;
    }
  }
  isActive() {
    return this.cache?.snapshot.jobs.some(fleetActive) ?? false;
  }
  async collect(fresh = false): Promise<FleetSnapshot> {
    if (this.inflight) return this.inflight;
    const age = this.cache ? this.now() - this.cache.at : Infinity;
    const ttl = this.isActive() ? 2500 : this.routeHint ? 2000 : 20000;
    if (this.cache && age < ttl && !fresh) return this.cache.snapshot;
    const request = this.load().finally(() => {
      if (this.inflight === request) this.inflight = null;
    });
    this.inflight = request;
    return request;
  }
  private async load(): Promise<FleetSnapshot> {
    // Invalidating an in-flight read does not launch an overlapping RPC. Discard
    // its result and retry sequentially; neither caller nor cache sees stale RUNNING.
    for (;;) {
      const generation = this.generation;
      let snapshot: FleetSnapshot;
      try {
        snapshot = fleetWireSchema.parse(await this.request());
      } catch {
        snapshot = empty();
      }
      if (generation !== this.generation) continue;
      this.routeHint = false;
      this.cache = { snapshot, at: this.now() };
      this.polledFingerprint ??= this.fingerprint(snapshot);
      return snapshot;
    }
  }
  private async request(): Promise<unknown> {
    if (!this.transport) {
      const pending = Promise.resolve().then(() =>
        this.bb.sdk.plugins.callRpc({
          pluginId: "ollama-fleet",
          method: "fleet_observability_snapshot",
          input: { limit: 20 },
          outputSchema: fleetWireSchema,
        }),
      );
      this.transport = pending;
      void pending.then(
        () => {
          if (this.transport === pending) this.transport = null;
        },
        () => {
          if (this.transport === pending) this.transport = null;
        },
      );
    }
    // SDK 0.4.34 callRpc has no AbortSignal. Bound consumer latency but retain
    // the physical inflight request after timeout, so retries cannot overlap it.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.transport,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error("Fleet unavailable")), 1500);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private fingerprint(s: FleetSnapshot) {
    return JSON.stringify(s.jobs.map(j => [j.jobId, j.revision, j.state]));
  }
  async poll() {
    const before = this.polledFingerprint;
    const after = await this.collect();
    this.polledFingerprint = this.fingerprint(after);
    return {
      changed: before !== this.polledFingerprint,
      active: after.jobs.some(fleetActive),
    };
  }
}
