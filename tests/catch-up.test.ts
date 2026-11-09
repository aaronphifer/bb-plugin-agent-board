import { describe, expect, it } from "vitest";
import { catchUpChanges, checkpointFor, mergeCheckpoint, parseCheckpoint } from "../lib/catch-up";
import { phaseCard as card, phaseExecution as execution, phaseSnapshot as snapshot } from "./vnext-fixtures";

describe("catch-up from observed state", () => {
  it("keeps completions recoverable after an incomplete visit advances wall time", () => {
    const initial = checkpointFor(snapshot({ active: [execution("a", { card: card({ status: "running", completedAt: null }) })], fetchedAt: 100 }));
    const incomplete = mergeCheckpoint(initial, snapshot({ active: [], recent: [], partial: true, fetchedAt: 300 }));
    const recovered = snapshot({ active: [], recent: [execution("a", { card: card({ status: "completed", completedAt: 200 }) })], fetchedAt: 400 });
    expect(catchUpChanges(recovered, incomplete)).toHaveLength(1);
    expect(incomplete.at).toBe(100);
  });
  it("establishes the first visit without making up history", () => {
    expect(catchUpChanges(snapshot(), null)).toEqual([]);
    expect(parseCheckpoint("bad")).toBeNull();
  });
  it("reports a new completed turn once and ignores unrelated updatedAt changes", () => {
    const running = snapshot({ active: [execution("a", { card: card({ status: "running" }) })], fetchedAt: 100 });
    const prior = checkpointFor(running);
    const done = snapshot({ active: [], recent: [execution("a", { updatedAt: 200, card: card({ status: "completed", completedAt: 200 }) })], fetchedAt: 300 });
    expect(catchUpChanges(done, prior).map(c => c.kind)).toEqual(["Turn finished"]);
    const seen = checkpointFor(done);
    expect(catchUpChanges({ ...done, recent: [{ ...done.recent[0]!, updatedAt: 400 }], fetchedAt: 500 }, seen)).toEqual([]);
  });
  it("does not erase absent executions in partial snapshots or accept future checkpoints", () => {
    const old = checkpointFor(snapshot({ active: [execution("old")], fetchedAt: 100 }));
    const merged = mergeCheckpoint(old, snapshot({ active: [], partial: true, fetchedAt: 200 }));
    expect(merged.executions.old).toBeDefined();
    expect(parseCheckpoint(JSON.stringify({ ...old, at: Date.now() + 60_000 }))).toBeNull();
  });
  it("distinguishes a rerun finishing from cosmetic changes and bounds saved observations", () => {
    const done = execution("a", { card: card({ status: "completed", completedAt: 100 }) });
    const old = checkpointFor(snapshot({ active: [], recent: [done], fetchedAt: 200 }));
    expect(catchUpChanges(snapshot({ active: [], recent: [{ ...done, card: { ...done.card, completedAt: 400 } }], fetchedAt: 500 }), old)).toHaveLength(1);
    expect(Object.keys(checkpointFor(snapshot({ active: Array.from({ length: 150 }, (_, i) => execution(String(i))) })).executions).length).toBeLessThanOrEqual(128);
  });
});
