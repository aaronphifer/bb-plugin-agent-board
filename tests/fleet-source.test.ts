import { describe, it, expect, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  FleetSource,
  fleetWireSchema,
  fleetCard,
  scopedFleetCards,
  addFleetGroups,
  fleetTimelineEvents,
} from "../lib/fleet-source";
import { buildGlobalDashboard } from "../lib/global-model";
import { buildFocusModel } from "../lib/focus-model";
import { job, wire, group, parent, scoped, NOW } from "./fleet-fixtures";
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
function source(load: () => Promise<unknown>, now: () => number = Date.now) {
  const call = vi.fn(load);
  const h = createFakePluginHost({
    pluginId: "agent-board",
    sdk: { plugins: { callRpc: call } },
  });
  return { s: new FleetSource(h.bb, now), call };
}
describe("optional Fleet wire source", () => {
  it.each(["missing", "disabled", "unknown_method", "RPC failure"])(
    "tolerates %s",
    async (message) => {
      const { s } = source(async () => {
        throw Error(message);
      });
      expect((await s.collect()).jobs).toEqual([]);
    },
  );
  it.each([
    {},
    null,
    { schemaVersion: 2, jobs: [] },
    { schemaVersion: 1, jobs: [{}] },
    wire([{ ...job(), origin: undefined } as never]),
  ])("rejects malformed/partial %j", async (raw) => {
    const { s } = source(async () => raw);
    expect((await s.collect()).jobs).toEqual([]);
  });
  it("empty jobs is healthy", async () => {
    const { s } = source(async () => wire());
    expect(await s.collect()).toMatchObject({ jobs: [], truncated: false });
  });
  it.each(["routing", "running", "completed", "failed", "cancelled"] as const)(
    "normalizes %s",
    (state) => {
      const c = fleetCard(job({ state }));
      expect(c.source).toBe("ollama-fleet");
      expect(c.status).toBe(
        state === "routing"
          ? "starting"
          : state === "cancelled"
            ? "interrupted"
            : state,
      );
    },
  );
  it("actual model, friendly name, label and operational activity only", () => {
    expect(fleetCard(job())).toMatchObject({
      title: "Validation review A",
      model: "qwen3-coder:30b",
      serverName: "Desktop PC",
      promptPreview: null,
      outputPreview: null,
      activity: { kind: "inference" },
    });
    expect(fleetCard(job()).latestPublicUpdate).toBeUndefined();
  });
  it("bounds and redacts display metadata and strips private/unknown fields", () => {
    const raw = {
      ...job(),
      label: "x".repeat(200),
      actualModel: "m".repeat(200),
      latestActivity: "token=ABC https://secret.invalid/path",
      errorPreview: "password=XYZ " + "e".repeat(500),
      prompt: "RAW_PROMPT",
      response: "RAW_RESPONSE",
      reasoning: "RAW_REASONING",
      server: { id: "pc", name: "Desktop PC", baseUrl: "http://PRIVATE" },
    };
    const parsed = fleetWireSchema.parse(wire([raw]));
    const c = fleetCard(parsed.jobs[0]);
    expect(c.title).toHaveLength(120);
    expect(c.model).toHaveLength(120);
    expect(c.errorPreview!.length).toBeLessThanOrEqual(360);
    expect(JSON.stringify(c)).not.toMatch(
      /ABC|XYZ|secret.invalid|RAW_|PRIVATE|baseUrl/,
    );
  });
  it("rejects over 20 input rows", () =>
    expect(
      fleetWireSchema.safeParse(wire(Array.from({ length: 21 }, () => job())))
        .success,
    ).toBe(false));
  it("shares TTL and inflight across consumers", async () => {
    const d = deferred<unknown>();
    const { s, call } = source(
      () => d.promise,
      () => 0,
    );
    const a = s.collect(),
      b = s.collect();
    d.resolve(wire([job()]));
    await Promise.all([a, b]);
    await s.collect();
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("stale running inflight cannot return or recache after terminal invalidation; no overlap", async () => {
    const old = deferred<unknown>();
    let count = 0;
    const { s, call } = source(() =>
      ++count === 1
        ? old.promise
        : Promise.resolve(wire([job({ state: "completed", revision: 3 })])),
    );
    const a = s.collect();
    await Promise.resolve();
    s.invalidate();
    const b = s.collect();
    old.resolve(wire([job()]));
    expect((await a).jobs[0].state).toBe("completed");
    expect((await b).jobs[0].state).toBe("completed");
    expect((await s.collect()).jobs[0].state).toBe("completed");
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("idle TTL 20s, no request without consumers", async () => {
    let now = 0;
    const { s, call } = source(
      async () => wire(),
      () => now,
    );
    await s.collect();
    for (now = 1000; now < 20000; now += 1000) await s.collect();
    expect(call).toHaveBeenCalledTimes(1);
    await s.collect();
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("unrelated invalidations preserve the idle 20-second request bound", async () => {
    let now = 0;
    const { s, call } = source(async () => wire(), () => now);
    await s.collect();
    for (now = 1000; now < 20000; now += 1000) {
      s.invalidate();
      await s.collect();
    }
    expect(call).toHaveBeenCalledTimes(1);
    await s.collect();
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("new route activity permits early discovery, repeated old activity does not", async () => {
    let now = 0;
    const { s, call } = source(async () => wire(), () => now);
    const cards = [{ ...parent(), activity: { text: "ollama_fleet_route", at: 1, kind: "tool" } }];
    await s.collect();
    now = 2500;
    s.hintFromCards(cards);
    await s.collect();
    expect(call).toHaveBeenCalledTimes(2);
    now = 5000;
    s.hintFromCards(cards);
    await s.collect();
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("poll and other views share 2.5-second active cache and publish pre-observed completion", async () => {
    let now = 0;
    let data = wire([job()]);
    const { s, call } = source(async () => data, () => now);
    await s.collect();
    now = 2499;
    await s.poll();
    expect(call).toHaveBeenCalledTimes(1);
    now = 2500;
    data = wire([job({ state: "completed", revision: 3 })]);
    await s.collect();
    expect(await s.poll()).toEqual({ changed: true, active: false });
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("timeout keeps the original transport and cannot create overlapping requests", async () => {
    vi.useFakeTimers();
    try {
      const d = deferred<unknown>();
      const { s, call } = source(() => d.promise);
      const a = s.collect();
      await vi.advanceTimersByTimeAsync(1500);
      expect((await a).jobs).toEqual([]);
      const b = s.collect(true);
      await vi.advanceTimersByTimeAsync(1500);
      await b;
      expect(call).toHaveBeenCalledTimes(1);
      d.resolve(wire());
    } finally {
      vi.useRealTimers();
    }
  });
});
describe("linking and logical grouping", () => {
  it("links only exact origin thread and project; excludes orphan/unrelated", () => {
    const data = wire([
      job(),
      job({ jobId: "b", origin: null }),
      job({ jobId: "c", origin: { threadId: "other", projectId: "p" } }),
      job({ jobId: "d", origin: { threadId: "parent", projectId: "wrong" } }),
    ]);
    expect(
      scopedFleetCards(data, new Map([["parent", "p"]])).cards.map(
        (c) => c.jobId,
      ),
    ).toEqual(["j1"]);
  });
  it("bounds scoped workers to eight per parent", () => {
    const result = scopedFleetCards(
      wire(Array.from({ length: 12 }, (_, i) => job({ jobId: String(i) }))),
      new Map([["parent", "p"]]),
    );
    expect(result.cards).toHaveLength(8);
    expect(result.partial).toBe(true);
  });
  it.each([1, 3, 8])(
    "parent + %i workers is one active execution with at most four compact workers",
    (n) => {
      const d = buildGlobalDashboard(
        addFleetGroups(
          [group()],
          wire(Array.from({ length: n }, (_, i) => job({ jobId: String(i) }))),
        ),
        { now: NOW },
      );
      expect(d.counts.active).toBe(1);
      expect(d.active[0].card.model).toBe("parent-model");
      expect(d.active[0].delegatedWorkerCount).toBe(n);
      expect(d.active[0].delegatedWorkers).toHaveLength(Math.min(4, n));
    },
  );
  it("two parents remain two executions", () => {
    const g2 = {
      ...group(parent({ threadId: "other", key: "thread:other" })),
      key: "bb:other",
      threadId: "other",
    };
    const groups = addFleetGroups(
      [group(), g2],
      wire([
        job(),
        job({ jobId: "b", origin: { threadId: "other", projectId: "p" } }),
      ]),
    );
    expect(groups.map((g) => g.delegatedWorkers?.length)).toEqual([1, 1]);
  });
  it("orphan active job is standalone", () => {
    const d = buildGlobalDashboard(
      addFleetGroups([], wire([job({ origin: null })])),
      { now: NOW },
    );
    expect(d.counts.active).toBe(1);
    expect(d.active[0].card).toMatchObject({
      source: "ollama-fleet",
      threadId: null,
      serverName: "Desktop PC",
    });
  });
  it("linked terminal jobs do not flood Recent; orphan terminal may appear", () => {
    const d = buildGlobalDashboard(
      addFleetGroups(
        [group(parent({ status: "completed" }))],
        wire([
          job({ state: "completed" }),
          job({ jobId: "orphan", origin: null, state: "completed" }),
        ]),
      ),
      { now: NOW },
    );
    expect(d.recent).toHaveLength(2);
    expect(
      d.recent.filter((e) => e.card.source === "ollama-fleet"),
    ).toHaveLength(1);
  });
  it("linked final failure is visible scoped but folded into parent attention", () => {
    const j = job({ state: "failed", errorPreview: "Generation failed" });
    expect(fleetCard(j).errorPreview).toBe("Generation failed");
    const d = buildGlobalDashboard(
      addFleetGroups(
        [
          group(
            parent({
              status: "failed",
              attention: { type: "failed", message: "Parent failed" },
            }),
          ),
        ],
        wire([j]),
      ),
      { now: NOW },
    );
    expect(d.attention).toHaveLength(1);
  });
  it("handled failure and fallback attempt do not create attention", () => {
    for (const j of [
      job({ state: "failed" }),
      job({ state: "completed", attemptCount: 2 }),
    ])
      expect(
        buildGlobalDashboard(
          addFleetGroups([group(parent({ status: "completed" }))], wire([j])),
          { now: NOW },
        ).attention,
      ).toEqual([]);
  });
  it("orphan failure creates attention", () =>
    expect(
      buildGlobalDashboard(
        addFleetGroups([], wire([job({ state: "failed", origin: null })])),
        { now: NOW },
      ).attention,
    ).toHaveLength(1));
  it("one worker uses focus; multiple workers keep individual Kanban", () => {
    expect(
      buildFocusModel(scoped([parent(), fleetCard(job())]))?.heroLabel,
    ).toBe("CURRENT DELEGATED WORK");
    expect(
      buildFocusModel(
        scoped([parent(), fleetCard(job()), fleetCard(job({ jobId: "b" }))]),
      ),
    ).toBeNull();
  });
});
describe("Fleet lifecycle timeline", () => {
  it.each(["completed", "failed", "cancelled"] as const)(
    "records %s with actual times, model/server and no inference internals",
    (state) => {
      const j = job({
        state,
        finishedAt: new Date(NOW).toISOString(),
        durationMs: 10000,
      });
      const events = fleetTimelineEvents([j], "bb:parent");
      expect(events.map((e) => e.kind)).toEqual([
        "delegation",
        "child-start",
        "model-selected",
        state === "failed"
          ? "child-failed"
          : state === "cancelled"
            ? "execution-interrupted"
            : "child-complete",
      ]);
      expect(events[0].timestamp).toBe(NOW - 10000);
      expect(events[2]).toMatchObject({
        timestamp: NOW,
        model: j.actualModel,
        summary: "Desktop PC",
      });
      expect(events.at(-1)?.durationMs).toBe(10000);
      expect(JSON.stringify(events)).not.toMatch(
        /prompt|response|reasoning|baseUrl/,
      );
    },
  );
  it("routing has no model event", () =>
    expect(
      fleetTimelineEvents(
        [job({ state: "routing", actualModel: null, server: null })],
        "bb:p",
      ).some((e) => e.kind === "model-selected"),
    ).toBe(false));
  it("orders multiple jobs chronologically", () => {
    const events = fleetTimelineEvents(
      [
        job(),
        job({ jobId: "b", startedAt: new Date(NOW - 20000).toISOString() }),
      ],
      "bb:p",
    );
    expect(events.map((e) => e.timestamp)).toEqual(
      events.map((e) => e.timestamp).sort((a, b) => a - b),
    );
  });
});
