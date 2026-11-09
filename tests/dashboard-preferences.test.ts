import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, parsePreferences, readPreferences, saveView, writePreferences, applyWindow, type DashboardPreferences } from "../lib/dashboard-preferences";
import { phaseCard as card, phaseExecution as execution } from "./vnext-fixtures";

describe("bounded dashboard preferences", () => {
  it("recovers from invalid data or blocked browser storage", () => {
    expect(parsePreferences("bad")).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences('{"filters":{"project":42}}')).toEqual(DEFAULT_PREFERENCES);
    const blocked = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } };
    expect(readPreferences(blocked)).toEqual(DEFAULT_PREFERENCES);
    expect(writePreferences(DEFAULT_PREFERENCES, blocked)).toBe(false);
  });
  it("round trips filters/grouping/time windows and bounds saved views", () => {
    let value: DashboardPreferences = { ...DEFAULT_PREFERENCES, filters: { ...DEFAULT_PREFERENCES.filters, project: "value:p" }, grouping: "project", window: "day" };
    for (let i = 0; i < 10; i++) value = saveView(value, `View ${i}`);
    expect(value.saved).toHaveLength(8);
    expect(parsePreferences(JSON.stringify(value))).toEqual(value);
    expect(saveView(value, "  ")).toEqual(value);
  });
  it("time windows use completion/activity time and keep ongoing work", () => {
    const running = execution("active", { card: card({ status: "running", startedAt: 1 }) });
    const old = execution("old", { updatedAt: 2, card: card({ status: "completed", completedAt: 1 }) });
    expect(applyWindow([running, old], "day", 100_000_000)).toEqual([running]);
  });
});
